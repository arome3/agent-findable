import { fetchAllData, extractBrandName } from './utils'

const ANTHROPIC_BASE = process.env.ANTHROPIC_MPP_URL || 'https://api.anthropic.com'

// ── Local interfaces ─────────────────────────────────────────────────

export interface SourceEntry {
  category: string
  present: boolean
  confidence: 'high' | 'medium' | 'low'
  details: string
  sentiment?: 'positive' | 'neutral' | 'negative' | 'mixed'
  namedSources?: string[]
}

export interface SourcesResult {
  brand: string
  url: string | null
  sourceMap: SourceEntry[]
  topInfluencers: string[]
  citationGaps: string[]
  recommendations: string[]
  overallCitationStrength: 'strong' | 'moderate' | 'weak'
  generatedAt: string
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

// ── Query 1: Per-category presence assessment ────────────────────────

async function querySourcePresence(brand: string): Promise<any> {
  try {
    const res = await fetch(`${ANTHROPIC_BASE}/v1/messages`, {
      method: 'POST',
      headers: makeHeaders(),
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 800,
        messages: [{
          role: 'user',
          content: `For the brand "${brand}", assess its presence in each of these external source categories. For each category, rate presence as true/false and confidence as high/medium/low.\n\nCategories: reddit, wikipedia, news_media, review_sites, comparison_articles, forums, official_docs, social_media\n\nReturn JSON: { "sources": [{ "category": "reddit", "present": true, "confidence": "high", "details": "..." }] }. Return ONLY valid JSON.`,
        }],
      }),
    })
    if (!res.ok) return { sources: [] }
    const data = (await res.json()) as any
    return JSON.parse(stripFences(data.content?.[0]?.text || '{}'))
  } catch {
    return { sources: [] }
  }
}

// ── Query 2: Named sources + sentiment per category ──────────────────

async function querySourceDetails(brand: string): Promise<any> {
  try {
    const res = await fetch(`${ANTHROPIC_BASE}/v1/messages`, {
      method: 'POST',
      headers: makeHeaders(),
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 800,
        messages: [{
          role: 'user',
          content: `For the brand "${brand}", list specific named sources where it's discussed or mentioned, organized by category. Include the sentiment (positive/neutral/negative/mixed) for each category.\n\nCategories: reddit, wikipedia, news_media, review_sites, comparison_articles, forums\n\nReturn JSON: { "details": [{ "category": "reddit", "namedSources": ["r/subreddit1", "r/subreddit2"], "sentiment": "positive" }] }. Return ONLY valid JSON.`,
        }],
      }),
    })
    if (!res.ok) return { details: [] }
    const data = (await res.json()) as any
    return JSON.parse(stripFences(data.content?.[0]?.text || '{}'))
  } catch {
    return { details: [] }
  }
}

// ── Query 3: Influence ranking + gaps + recommendations ──────────────

async function querySourceInfluence(brand: string): Promise<any> {
  try {
    const res = await fetch(`${ANTHROPIC_BASE}/v1/messages`, {
      method: 'POST',
      headers: makeHeaders(),
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 800,
        messages: [{
          role: 'user',
          content: `For the brand "${brand}", which external source categories most influence how AI systems perceive and cite it? Rank the top influencers, identify gaps where the brand is missing, and provide actionable recommendations.\n\nReturn JSON: { "topInfluencers": ["category1: reason", "category2: reason"], "citationGaps": ["gap1", "gap2"], "recommendations": ["rec1", "rec2"] }. Return ONLY valid JSON.`,
        }],
      }),
    })
    if (!res.ok) return { topInfluencers: [], citationGaps: [], recommendations: [] }
    const data = (await res.json()) as any
    return JSON.parse(stripFences(data.content?.[0]?.text || '{}'))
  } catch {
    return { topInfluencers: [], citationGaps: [], recommendations: [] }
  }
}

// ── Main export ──────────────────────────────────────────────────────

export async function mapSources(url?: string, brand?: string): Promise<SourcesResult> {
  let brandName = brand || ''
  let baseUrl: string | null = null

  if (url) {
    const data = await fetchAllData(url)
    baseUrl = data.baseUrl
    if (!brandName) {
      brandName = extractBrandName(data.mainPage.body, new URL(data.baseUrl).hostname)
    }
  }

  if (!brandName) throw new Error('Could not determine brand name')

  // Run all 3 queries in parallel
  const [presence, details, influence] = await Promise.all([
    querySourcePresence(brandName),
    querySourceDetails(brandName),
    querySourceInfluence(brandName),
  ])

  // Merge presence + details
  const sourceMap: SourceEntry[] = (presence.sources || []).map((s: any) => {
    const detail = (details.details || []).find((d: any) => d.category === s.category)
    return {
      category: s.category,
      present: s.present ?? false,
      confidence: s.confidence || 'low',
      details: s.details || '',
      sentiment: detail?.sentiment || undefined,
      namedSources: detail?.namedSources || undefined,
    }
  })

  const presentCount = sourceMap.filter((s) => s.present).length
  const overallCitationStrength: SourcesResult['overallCitationStrength'] =
    presentCount >= 6 ? 'strong' : presentCount >= 3 ? 'moderate' : 'weak'

  return {
    brand: brandName,
    url: baseUrl,
    sourceMap,
    topInfluencers: influence.topInfluencers || [],
    citationGaps: influence.citationGaps || [],
    recommendations: influence.recommendations || [],
    overallCitationStrength,
    generatedAt: new Date().toISOString(),
  }
}
