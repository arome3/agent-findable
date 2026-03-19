import {
  fetchAllData,
  extractJsonLd,
  extractMetaTags,
  stripHtml,
  extractBrandName,
} from './utils'

const ANTHROPIC_BASE = process.env.ANTHROPIC_MPP_URL || 'https://api.anthropic.com'

// ── Local interfaces ─────────────────────────────────────────────────

export interface GroundTruth {
  name: string
  description: string
  industry: string
  foundingDate: string | null
  headquarters: string | null
  products: string[]
  socialProfiles: string[]
  url: string
  rawContent: string
}

export interface Hallucination {
  field: string
  websiteSays: string
  aiSays: string
  type: 'fabrication' | 'outdated' | 'inaccuracy' | 'omission' | 'confusion'
  severity: 'high' | 'medium' | 'low'
}

export interface HallcheckResult {
  brand: string
  url: string | null
  groundTruth: GroundTruth | null
  aiPerception: Record<string, any>
  hallucinations: Hallucination[]
  hallucinationRate: number
  riskLevel: 'critical' | 'high' | 'medium' | 'low'
  verifiedFacts: string[]
  unverifiedClaims: string[]
  recommendations: string[]
  generatedAt: string
}

// ── Shared headers ───────────────────────────────────────────────────

function makeHeaders(): Record<string, string> {
  const h: Record<string, string> = {
    'Content-Type': 'application/json',
    'anthropic-version': '2023-06-01',
  }
  if (process.env.ANTHROPIC_API_KEY) h['x-api-key'] = process.env.ANTHROPIC_API_KEY
  return h
}

function stripFences(text: string): string {
  let s = text.trim()
  if (s.startsWith('```')) s = s.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '')
  return s
}

// ── Step 1: Extract structured ground truth from website ─────────────

function extractGroundTruth(data: import('./types').FetchedData): GroundTruth {
  const html = data.mainPage.body || ''
  const meta = extractMetaTags(html)
  const jsonLd = extractJsonLd(html)
  const allObjects = jsonLd.flatMap((b) =>
    Array.isArray(b['@graph']) ? b['@graph'] : [b],
  )

  const name = extractBrandName(html, new URL(data.baseUrl).hostname)

  const description =
    meta['description'] ||
    meta['og:description'] ||
    data.llmsTxt?.match(/^>\s*(.+)/m)?.[1] ||
    allObjects.find((o) => o.description)?.description ||
    ''

  // Industry from schema @type or meta keywords
  const types: string[] = allObjects
    .flatMap((o) => (o['@type'] ? [o['@type']].flat() : []))
    .filter(Boolean)
  const industry =
    meta['keywords']?.split(',')[0]?.trim() ||
    types.find(
      (t: string) =>
        !['WebSite', 'WebPage', 'BreadcrumbList', 'SearchAction', 'ReadAction'].includes(t),
    ) ||
    ''

  // Organization data
  const org = allObjects.find((o) =>
    ['Organization', 'Corporation', 'LocalBusiness'].includes(o['@type']),
  )

  const foundingDate: string | null = org?.foundingDate || null
  const headquarters: string | null = org?.address
    ? typeof org.address === 'string'
      ? org.address
      : [org.address.addressLocality, org.address.addressRegion, org.address.addressCountry]
          .filter(Boolean)
          .join(', ')
    : null

  // Products from schema makesOffer + llms.txt links
  const products: string[] = []
  if (org?.makesOffer) {
    for (const offer of [org.makesOffer].flat()) {
      if (offer.name) products.push(offer.name)
      if (offer.itemOffered?.name) products.push(offer.itemOffered.name)
    }
  }
  if (data.llmsTxt) {
    const linkRegex = /\[([^\]]+)\]\(/g
    let m
    while ((m = linkRegex.exec(data.llmsTxt)) !== null) {
      if (m[1] && m[1].length < 60) products.push(m[1])
    }
  }

  const socialProfiles: string[] = org?.sameAs ? [org.sameAs].flat().filter(Boolean) : []
  const rawContent = stripHtml(html).slice(0, 2000)

  return {
    name,
    description,
    industry,
    foundingDate,
    headquarters,
    products: [...new Set(products)],
    socialProfiles,
    url: data.baseUrl,
    rawContent,
  }
}

// ── Step 2: Query AI for the same facts (2 parallel Haiku calls) ─────

async function queryAIFacts(brand: string): Promise<Record<string, any>> {
  try {
    const res = await fetch(`${ANTHROPIC_BASE}/v1/messages`, {
      method: 'POST',
      headers: makeHeaders(),
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 600,
        messages: [{
          role: 'user',
          content: `Provide factual information about ${brand} in JSON format: { "description": "...", "industry": "...", "founded": "...", "headquarters": "...", "products": [], "competitors": [], "pricing": "..." }. Be specific and factual. If you don't know a field, use null. Return ONLY valid JSON.`,
        }],
      }),
    })
    if (!res.ok) return { error: `API error: ${res.status}` }
    const data = (await res.json()) as any
    return JSON.parse(stripFences(data.content?.[0]?.text || '{}'))
  } catch (err: any) {
    return { error: err.message }
  }
}

async function queryAIMisconceptions(brand: string): Promise<{ misconceptions: string[] }> {
  try {
    const res = await fetch(`${ANTHROPIC_BASE}/v1/messages`, {
      method: 'POST',
      headers: makeHeaders(),
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 600,
        messages: [{
          role: 'user',
          content: `What are common misconceptions or frequently confused facts about ${brand}? What do people often get wrong? List 3-5 items. Return JSON: { "misconceptions": ["..."] }. Return ONLY valid JSON.`,
        }],
      }),
    })
    if (!res.ok) return { misconceptions: [] }
    const data = (await res.json()) as any
    return JSON.parse(stripFences(data.content?.[0]?.text || '{}'))
  } catch {
    return { misconceptions: [] }
  }
}

// ── Step 3: Programmatic comparison (NO AI call) ─────────────────────

function wordSimilarity(a: string, b: string): number {
  if (!a || !b) return 0
  const setA = new Set(a.toLowerCase().split(/\s+/).filter((w) => w.length > 2))
  const setB = new Set(b.toLowerCase().split(/\s+/).filter((w) => w.length > 2))
  if (setA.size === 0 || setB.size === 0) return 0
  const intersection = [...setA].filter((w) => setB.has(w)).length
  const union = new Set([...setA, ...setB]).size
  return intersection / union
}

function compareFactsProgrammatically(
  groundTruth: GroundTruth,
  aiFacts: Record<string, any>,
): { hallucinations: Hallucination[]; verifiedFacts: string[]; unverifiedClaims: string[] } {
  const hallucinations: Hallucination[] = []
  const verifiedFacts: string[] = []
  const unverifiedClaims: string[] = []

  // Description
  if (groundTruth.description && aiFacts.description) {
    const sim = wordSimilarity(groundTruth.description, aiFacts.description)
    if (sim > 0.3) {
      verifiedFacts.push(`Description is largely accurate (${Math.round(sim * 100)}% word overlap)`)
    } else if (sim > 0.1) {
      hallucinations.push({
        field: 'description',
        websiteSays: groundTruth.description.slice(0, 200),
        aiSays: (aiFacts.description as string).slice(0, 200),
        type: 'inaccuracy',
        severity: 'medium',
      })
    } else {
      hallucinations.push({
        field: 'description',
        websiteSays: groundTruth.description.slice(0, 200),
        aiSays: (aiFacts.description as string).slice(0, 200),
        type: 'inaccuracy',
        severity: 'high',
      })
    }
  }

  // Industry
  if (groundTruth.industry && aiFacts.industry) {
    const gtI = groundTruth.industry.toLowerCase()
    const aiI = (aiFacts.industry as string).toLowerCase()
    if (aiI.includes(gtI) || gtI.includes(aiI) || wordSimilarity(gtI, aiI) > 0.3) {
      verifiedFacts.push(`Industry classification matches: ${aiFacts.industry}`)
    } else {
      hallucinations.push({
        field: 'industry',
        websiteSays: groundTruth.industry,
        aiSays: aiFacts.industry as string,
        type: 'inaccuracy',
        severity: 'medium',
      })
    }
  }

  // Founding date
  if (groundTruth.foundingDate && aiFacts.founded) {
    const gt = groundTruth.foundingDate.toString()
    const ai = (aiFacts.founded || '').toString()
    if (ai.includes(gt) || gt.includes(ai)) {
      verifiedFacts.push(`Founding date verified: ${groundTruth.foundingDate}`)
    } else {
      hallucinations.push({
        field: 'foundingDate',
        websiteSays: gt,
        aiSays: ai,
        type: 'inaccuracy',
        severity: 'high',
      })
    }
  } else if (groundTruth.foundingDate && !aiFacts.founded) {
    unverifiedClaims.push(`AI doesn't know founding date (${groundTruth.foundingDate})`)
  }

  // Headquarters
  if (groundTruth.headquarters && aiFacts.headquarters) {
    const gtHQ = groundTruth.headquarters.toLowerCase().replace(/[,.\s]+/g, ' ').trim()
    const aiHQ = (aiFacts.headquarters as string).toLowerCase().replace(/[,.\s]+/g, ' ').trim()
    if (wordSimilarity(gtHQ, aiHQ) > 0.3) {
      verifiedFacts.push(`Headquarters location matches: ${aiFacts.headquarters}`)
    } else {
      hallucinations.push({
        field: 'headquarters',
        websiteSays: groundTruth.headquarters,
        aiSays: aiFacts.headquarters as string,
        type: 'inaccuracy',
        severity: 'low',
      })
    }
  }

  // Products (set intersection)
  if (
    groundTruth.products.length > 0 &&
    Array.isArray(aiFacts.products) &&
    aiFacts.products.length > 0
  ) {
    const gtSet = new Set(groundTruth.products.map((p) => p.toLowerCase()))
    const aiSet = new Set((aiFacts.products as string[]).map((p) => p.toLowerCase()))

    const fabricated = [...aiSet].filter(
      (p) => ![...gtSet].some((gp) => gp.includes(p) || p.includes(gp)),
    )
    if (fabricated.length > 0) {
      hallucinations.push({
        field: 'products',
        websiteSays: groundTruth.products.join(', '),
        aiSays: fabricated.join(', '),
        type: 'fabrication',
        severity: 'high',
      })
    }

    const unknown = [...gtSet].filter(
      (p) => ![...aiSet].some((ap) => ap.includes(p) || p.includes(ap)),
    )
    if (unknown.length > 0) {
      unverifiedClaims.push(`AI doesn't know about: ${unknown.join(', ')}`)
    }

    const verified = [...gtSet].filter(
      (p) => [...aiSet].some((ap) => ap.includes(p) || p.includes(ap)),
    )
    if (verified.length > 0) {
      verifiedFacts.push(`${verified.length} product(s) correctly identified`)
    }
  }

  return { hallucinations, verifiedFacts, unverifiedClaims }
}

// ── Step 4: AI classification of unstructured discrepancies ──────────

async function classifyDiscrepancies(
  brand: string,
  hallucinations: Hallucination[],
): Promise<Hallucination[]> {
  if (hallucinations.length === 0) return hallucinations

  const discrepancyList = hallucinations
    .map(
      (h, i) =>
        `${i + 1}. Field: ${h.field} | Website says: "${h.websiteSays}" | AI says: "${h.aiSays}"`,
    )
    .join('\n')

  try {
    const res = await fetch(`${ANTHROPIC_BASE}/v1/messages`, {
      method: 'POST',
      headers: makeHeaders(),
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 600,
        messages: [{
          role: 'user',
          content: `Here are factual discrepancies found between ${brand}'s website and AI knowledge. Categorize each by type and severity.\n\n${discrepancyList}\n\nReturn JSON: { "classified": [{ "index": 1, "type": "fabrication|outdated|inaccuracy|omission|confusion", "severity": "high|medium|low" }] }. Return ONLY valid JSON.`,
        }],
      }),
    })

    if (!res.ok) return hallucinations

    const data = (await res.json()) as any
    const parsed = JSON.parse(stripFences(data.content?.[0]?.text || '{}'))

    if (Array.isArray(parsed.classified)) {
      for (const c of parsed.classified) {
        const idx = (c.index || 0) - 1
        if (idx >= 0 && idx < hallucinations.length) {
          if (['fabrication', 'outdated', 'inaccuracy', 'omission', 'confusion'].includes(c.type)) {
            hallucinations[idx]!.type = c.type
          }
          if (['high', 'medium', 'low'].includes(c.severity)) {
            hallucinations[idx]!.severity = c.severity
          }
        }
      }
    }
  } catch {}

  return hallucinations
}

// ── Recommendations ──────────────────────────────────────────────────

function buildRecommendations(
  hallucinations: Hallucination[],
  unverifiedClaims: string[],
  groundTruth: GroundTruth | null,
): string[] {
  const recs: string[] = []

  const highSeverity = hallucinations.filter((h) => h.severity === 'high')
  if (highSeverity.length > 0) {
    recs.push(
      `Fix ${highSeverity.length} high-severity hallucination(s) immediately — AI is actively spreading wrong information about your brand.`,
    )
  }

  const fabrications = hallucinations.filter((h) => h.type === 'fabrication')
  if (fabrications.length > 0) {
    recs.push(
      `AI is fabricating ${fabrications.length} claim(s) about your brand. Add authoritative structured data to correct this.`,
    )
  }

  if (unverifiedClaims.length > 0) {
    recs.push(
      `AI doesn't know ${unverifiedClaims.length} important fact(s) about your brand. Add these to your llms.txt and schema markup.`,
    )
  }

  if (groundTruth && !groundTruth.description) {
    recs.push(
      'Your site lacks a clear meta description. AI models use this as a primary source for brand identity.',
    )
  }

  if (groundTruth && groundTruth.products.length === 0) {
    recs.push(
      'No products/services are discoverable from your site schema. Add makesOffer to your Organization schema.',
    )
  }

  if (recs.length === 0) {
    recs.push(
      'Your brand representation in AI is largely accurate. Continue maintaining structured data and llms.txt.',
    )
  }

  return recs
}

// ── Brand-only mode ──────────────────────────────────────────────────

async function hallcheckBrandOnly(brand: string): Promise<HallcheckResult> {
  const [aiFacts, misconceptions] = await Promise.all([
    queryAIFacts(brand),
    queryAIMisconceptions(brand),
  ])

  return {
    brand,
    url: null,
    groundTruth: null,
    aiPerception: aiFacts,
    hallucinations: [],
    hallucinationRate: 0,
    riskLevel: 'low',
    verifiedFacts: [],
    unverifiedClaims: misconceptions.misconceptions || [],
    recommendations: [
      'Provide a URL for full hallucination detection — brand-only mode can only show what AI believes, not what it gets wrong.',
      ...((misconceptions.misconceptions || []).length > 0
        ? [`AI has ${misconceptions.misconceptions.length} known misconception(s) about ${brand}.`]
        : []),
    ],
    generatedAt: new Date().toISOString(),
  }
}

// ── Main export ──────────────────────────────────────────────────────

export async function runHallcheck(url?: string, brand?: string): Promise<HallcheckResult> {
  if (!url && brand) return hallcheckBrandOnly(brand)

  const data = await fetchAllData(url!)

  // Step 1: Ground truth
  const groundTruth = extractGroundTruth(data)
  const brandName = brand || groundTruth.name

  // Step 2: AI queries (parallel)
  const [aiFacts, misconceptions] = await Promise.all([
    queryAIFacts(brandName),
    queryAIMisconceptions(brandName),
  ])

  // Step 3: Programmatic comparison
  const comparison = compareFactsProgrammatically(groundTruth, aiFacts)

  const unverifiedClaims = [
    ...comparison.unverifiedClaims,
    ...(misconceptions.misconceptions || []),
  ]

  // Step 4: AI classification
  const classifiedHallucinations = await classifyDiscrepancies(
    brandName,
    comparison.hallucinations,
  )

  // Rate & risk
  const totalFields = 5 // description, industry, foundingDate, headquarters, products
  const hallucinationRate =
    Math.round((classifiedHallucinations.length / totalFields) * 100) / 100

  const highCount = classifiedHallucinations.filter((h) => h.severity === 'high').length
  const riskLevel: HallcheckResult['riskLevel'] =
    highCount >= 3
      ? 'critical'
      : highCount >= 1
        ? 'high'
        : classifiedHallucinations.length >= 2
          ? 'medium'
          : 'low'

  return {
    brand: brandName,
    url: data.baseUrl,
    groundTruth,
    aiPerception: aiFacts,
    hallucinations: classifiedHallucinations,
    hallucinationRate,
    riskLevel,
    verifiedFacts: comparison.verifiedFacts,
    unverifiedClaims,
    recommendations: buildRecommendations(classifiedHallucinations, unverifiedClaims, groundTruth),
    generatedAt: new Date().toISOString(),
  }
}
