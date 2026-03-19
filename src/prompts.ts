import {
  fetchAllData,
  extractBrandName,
  extractMetaTags,
  extractJsonLd,
  stripHtml,
} from './utils'

const ANTHROPIC_BASE = process.env.ANTHROPIC_MPP_URL || 'https://api.anthropic.com'

// ── Local interfaces ─────────────────────────────────────────────────

export interface PromptResult {
  prompt: string
  category: string
  mentioned: boolean
  sentiment: 'positive' | 'neutral' | 'negative'
  excerpt: string
}

export interface CategoryBreakdown {
  category: string
  promptCount: number
  mentionCount: number
  mentionRate: number
}

export interface PromptsResult {
  brand: string
  url: string | null
  prompts: PromptResult[]
  mentionRate: number
  visibilityScore: number
  categoryBreakdown: CategoryBreakdown[]
  blindSpots: string[]
  strongPrompts: string[]
  recommendations: string[]
  generatedAt: string
}

interface BrandContext {
  name: string
  description: string
  products: string[]
  industry: string
  competitors: string[]
  topics: string[]
}

// ── Shared helpers ───────────────────────────────────────────────────

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

// ── Step 1: Extract brand context from website ───────────────────────

function extractBrandContext(data: import('./types').FetchedData, brandOverride?: string): BrandContext {
  const html = data.mainPage.body || ''
  const meta = extractMetaTags(html)
  const jsonLd = extractJsonLd(html)
  const allObjects = jsonLd.flatMap((b) =>
    Array.isArray(b['@graph']) ? b['@graph'] : [b],
  )

  const name = brandOverride || extractBrandName(html, new URL(data.baseUrl).hostname)
  const description = meta['description'] || meta['og:description'] || ''

  // Products from schema
  const products: string[] = []
  const org = allObjects.find((o) =>
    ['Organization', 'Corporation', 'LocalBusiness', 'SoftwareApplication'].includes(o['@type']),
  )
  if (org?.makesOffer) {
    for (const offer of [org.makesOffer].flat()) {
      if (offer.name) products.push(offer.name)
      if (offer.itemOffered?.name) products.push(offer.itemOffered.name)
    }
  }

  // Industry
  const types: string[] = allObjects
    .flatMap((o) => (o['@type'] ? [o['@type']].flat() : []))
    .filter(Boolean)
  const industry =
    meta['keywords']?.split(',')[0]?.trim() ||
    types.find((t: string) => !['WebSite', 'WebPage', 'BreadcrumbList'].includes(t)) ||
    ''

  // Topics from headings
  const headings = html.match(/<h[1-3][^>]*>([^<]+)<\/h[1-3]>/gi) || []
  const topics = headings
    .map((h: string) => h.replace(/<[^>]+>/g, '').trim())
    .filter((t: string) => t.length > 3 && t.length < 80)
    .slice(0, 10)

  // Competitors (from "vs" patterns on page)
  const competitors: string[] = []
  const text = stripHtml(html)
  const vsMatches = text.match(/\bvs\.?\s+(\w+)/gi) || []
  for (const m of vsMatches) {
    const comp = m.replace(/\bvs\.?\s+/i, '').trim()
    if (comp.length > 2 && comp.toLowerCase() !== name.toLowerCase()) {
      competitors.push(comp)
    }
  }

  return {
    name,
    description,
    products: [...new Set(products)],
    industry,
    competitors: [...new Set(competitors)],
    topics,
  }
}

// ── Step 2: Generate prompts (templates + AI enrichment) ─────────────

function generatePromptTemplates(ctx: BrandContext): { category: string; prompt: string }[] {
  const prompts: { category: string; prompt: string }[] = []
  const { name, industry, products, competitors } = ctx

  // Brand queries (3)
  prompts.push({ category: 'brand_query', prompt: `What is ${name}?` })
  prompts.push({ category: 'brand_query', prompt: `Is ${name} any good?` })
  prompts.push({ category: 'brand_query', prompt: `What does ${name} do?` })

  // Industry queries (2-4)
  if (industry) {
    prompts.push({ category: 'industry_query', prompt: `Best ${industry} tools 2026` })
    prompts.push({ category: 'industry_query', prompt: `What are the top ${industry} companies?` })
    prompts.push({ category: 'industry_query', prompt: `${industry} comparison guide` })
  }
  if (products.length > 0) {
    prompts.push({ category: 'industry_query', prompt: `How to choose a ${products[0]}?` })
  }

  // Comparison queries (2-3)
  prompts.push({ category: 'comparison_query', prompt: `Alternatives to ${name}` })
  if (competitors.length > 0) {
    prompts.push({ category: 'comparison_query', prompt: `${name} vs ${competitors[0]}` })
    if (competitors.length > 1) {
      prompts.push({ category: 'comparison_query', prompt: `Is ${name} or ${competitors[1]} better?` })
    }
  }

  // Recommendation queries (1-2)
  if (products.length > 0) {
    prompts.push({ category: 'recommendation_query', prompt: `What ${products[0]} should I use?` })
  }
  if (industry) {
    prompts.push({ category: 'recommendation_query', prompt: `What do experts recommend for ${industry}?` })
  }

  // Problem-solving queries (1-2)
  if (ctx.topics.length > 0) {
    prompts.push({ category: 'problem_solving', prompt: `How to ${ctx.topics[0]!.toLowerCase()}` })
  }
  if (products.length > 0) {
    prompts.push({ category: 'problem_solving', prompt: `Best way to use ${products[0]}` })
  }

  return prompts
}

async function generateCreativePrompts(
  ctx: BrandContext,
): Promise<{ category: string; prompt: string }[]> {
  try {
    const res = await fetch(`${ANTHROPIC_BASE}/v1/messages`, {
      method: 'POST',
      headers: makeHeaders(),
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 400,
        messages: [{
          role: 'user',
          content: `Generate 4 creative search prompts that a real person might ask an AI assistant, where "${ctx.name}" (${ctx.description.slice(0, 100)}) could potentially be recommended as an answer. Include comparison, recommendation, and problem-solving prompts. Return JSON: { "prompts": [{ "category": "comparison_query|recommendation_query|problem_solving", "prompt": "..." }] }. Return ONLY valid JSON.`,
        }],
      }),
    })
    if (!res.ok) return []
    const data = (await res.json()) as any
    const parsed = JSON.parse(stripFences(data.content?.[0]?.text || '{}'))
    return parsed.prompts || []
  } catch {
    return []
  }
}

// ── Step 3: Batch test prompts (4-5 per Haiku call) ──────────────────

async function batchTestPrompts(
  prompts: { category: string; prompt: string }[],
  brand: string,
  domain: string,
): Promise<PromptResult[]> {
  const brandLower = brand.toLowerCase()
  const domainLower = domain.replace(/^www\./, '').toLowerCase()
  const batchSize = 4

  const batches: { category: string; prompt: string }[][] = []
  for (let i = 0; i < prompts.length; i += batchSize) {
    batches.push(prompts.slice(i, i + batchSize))
  }

  const batchResults = await Promise.all(
    batches.map(async (batch) => {
      const numbered = batch.map((p, i) => `${i + 1}. ${p.prompt}`).join('\n')

      try {
        const res = await fetch(`${ANTHROPIC_BASE}/v1/messages`, {
          method: 'POST',
          headers: makeHeaders(),
          body: JSON.stringify({
            model: 'claude-haiku-4-5-20251001',
            max_tokens: 1200,
            messages: [{
              role: 'user',
              content: `For each of the following prompts, provide a brief answer (2-3 sentences each). Number your responses to match.\n\n${numbered}`,
            }],
          }),
        })

        if (!res.ok) {
          return batch.map((p) => ({
            prompt: p.prompt,
            category: p.category,
            mentioned: false,
            sentiment: 'neutral' as const,
            excerpt: `API error: ${res.status}`,
          }))
        }

        const data = (await res.json()) as any
        const text: string = data.content?.[0]?.text || ''
        const sections = text.split(/\n(?=\d+\.\s)/).filter(Boolean)

        return batch.map((p, i) => {
          const section = sections[i] || text.slice(i * 200, (i + 1) * 200) || ''
          const sectionLower = section.toLowerCase()
          const mentioned =
            sectionLower.includes(brandLower) ||
            (domainLower !== '' && sectionLower.includes(domainLower))

          let sentiment: 'positive' | 'neutral' | 'negative' = 'neutral'
          if (mentioned) {
            const posWords = ['recommend', 'excellent', 'leading', 'popular', 'great', 'best', 'top', 'trusted']
            const negWords = ['avoid', 'poor', 'weak', 'limited', 'expensive', 'concerns']
            const pos = posWords.filter((w) => sectionLower.includes(w)).length
            const neg = negWords.filter((w) => sectionLower.includes(w)).length
            if (pos > neg) sentiment = 'positive'
            else if (neg > pos) sentiment = 'negative'
          }

          return {
            prompt: p.prompt,
            category: p.category,
            mentioned,
            sentiment,
            excerpt: section.slice(0, 250),
          }
        })
      } catch (err: any) {
        return batch.map((p) => ({
          prompt: p.prompt,
          category: p.category,
          mentioned: false,
          sentiment: 'neutral' as const,
          excerpt: `Error: ${err.message}`,
        }))
      }
    }),
  )

  return batchResults.flat()
}

// ── Main export ──────────────────────────────────────────────────────

export async function discoverAndTestPrompts(
  url?: string,
  brand?: string,
  industry?: string,
): Promise<PromptsResult> {
  let ctx: BrandContext
  let baseUrl: string | null = null
  let domain = ''

  if (url) {
    const data = await fetchAllData(url)
    baseUrl = data.baseUrl
    domain = new URL(data.baseUrl).hostname
    ctx = extractBrandContext(data, brand)
    if (industry) ctx.industry = industry
  } else {
    ctx = {
      name: brand || '',
      description: '',
      products: [],
      industry: industry || '',
      competitors: [],
      topics: [],
    }
  }

  if (!ctx.name) throw new Error('Could not determine brand name')

  // Step 2: Generate prompts (templates + AI creative)
  const templatePrompts = generatePromptTemplates(ctx)
  const creativePrompts = await generateCreativePrompts(ctx)
  const allPrompts = [...templatePrompts, ...creativePrompts]

  // Step 3: Batch test
  const results = await batchTestPrompts(allPrompts, ctx.name, domain)

  // Metrics
  const mentionRate =
    results.length > 0 ? results.filter((r) => r.mentioned).length / results.length : 0

  // Visibility score (category-weighted)
  const categoryWeights: Record<string, number> = {
    brand_query: 1.5,
    industry_query: 1.0,
    comparison_query: 1.2,
    recommendation_query: 1.3,
    problem_solving: 0.8,
  }
  let weightedMentions = 0
  let totalWeight = 0
  for (const r of results) {
    const w = categoryWeights[r.category] || 1.0
    totalWeight += w
    if (r.mentioned) weightedMentions += w
  }
  const visibilityScore = totalWeight > 0 ? Math.round((weightedMentions / totalWeight) * 100) : 0

  // Category breakdown
  const cats = [...new Set(results.map((r) => r.category))]
  const categoryBreakdown: CategoryBreakdown[] = cats.map((cat) => {
    const cr = results.filter((r) => r.category === cat)
    return {
      category: cat,
      promptCount: cr.length,
      mentionCount: cr.filter((r) => r.mentioned).length,
      mentionRate:
        cr.length > 0
          ? Math.round((cr.filter((r) => r.mentioned).length / cr.length) * 100) / 100
          : 0,
    }
  })

  // Blind spots (0% mention categories)
  const blindSpots = categoryBreakdown
    .filter((c) => c.mentionRate === 0 && c.promptCount > 0)
    .map((c) => `${c.category}: ${c.promptCount} prompts tested, 0 mentions`)

  // Strong prompts (mentioned + positive)
  const strongPrompts = results
    .filter((r) => r.mentioned && r.sentiment === 'positive')
    .map((r) => r.prompt)

  // Recommendations
  const recommendations: string[] = []
  if (mentionRate < 0.3) {
    recommendations.push(
      `Your brand is mentioned in only ${Math.round(mentionRate * 100)}% of relevant prompts. Focus on building external mentions on Reddit, Wikipedia, and review sites.`,
    )
  }
  if (blindSpots.length > 0) {
    recommendations.push(
      `You have ${blindSpots.length} blind spot category/categories where AI never mentions you. Target these with content marketing.`,
    )
  }
  const compResults = results.filter((r) => r.category === 'comparison_query')
  if (compResults.length > 0 && compResults.every((r) => !r.mentioned)) {
    recommendations.push(
      'AI never recommends you in comparison queries. Create comparison pages and get listed on review sites.',
    )
  }
  if (strongPrompts.length === 0 && mentionRate > 0) {
    recommendations.push(
      'When AI mentions you, sentiment is neutral or negative. Improve your online reputation with case studies and reviews.',
    )
  }
  if (recommendations.length === 0) {
    recommendations.push(
      'Strong AI visibility across prompt categories. Continue maintaining external mentions and content quality.',
    )
  }

  return {
    brand: ctx.name,
    url: baseUrl,
    prompts: results,
    mentionRate: Math.round(mentionRate * 100) / 100,
    visibilityScore,
    categoryBreakdown,
    blindSpots,
    strongPrompts,
    recommendations,
    generatedAt: new Date().toISOString(),
  }
}
