import type { CategoryResult, CheckDetail, CheckStatus, CitationTestResult, CitationQuery } from './types'
import { extractBrandName } from './utils'

const ANTHROPIC_BASE = process.env.ANTHROPIC_MPP_URL || 'https://api.anthropic.com'

function chk(name: string, status: CheckStatus, message: string, data?: Record<string, unknown>): CheckDetail {
  return { name, status, message, ...(data ? { data } : {}) }
}

function catScore(checks: CheckDetail[]): number {
  if (checks.length === 0) return 0
  return Math.round(
    checks.reduce((s, c) => s + (c.status === 'pass' ? 100 : c.status === 'warn' ? 50 : 0), 0) / checks.length,
  )
}

function generateQueries(brand: string, domain: string): string[] {
  // Generate industry-relevant queries that might naturally cite this brand
  return [
    `What is ${brand} and what services or products do they offer?`,
    `What are the best alternatives to ${brand} in their industry?`,
    `Would you recommend ${brand}? What are their strengths and weaknesses?`,
  ]
}

function analyzeSentiment(text: string, brand: string): 'positive' | 'neutral' | 'negative' {
  const lower = text.toLowerCase()
  const brandLower = brand.toLowerCase()

  // Find sentences mentioning the brand
  const sentences = text.split(/[.!?]+/).filter((s) => s.toLowerCase().includes(brandLower))
  if (sentences.length === 0) return 'neutral'

  const combined = sentences.join(' ').toLowerCase()
  const positiveWords = ['recommend', 'excellent', 'leading', 'popular', 'powerful', 'innovative',
    'trusted', 'reliable', 'great', 'best', 'top', 'well-known', 'reputable', 'strong']
  const negativeWords = ['avoid', 'poor', 'weak', 'controversial', 'problematic', 'limited',
    'expensive', 'criticized', 'concerns', 'issues', 'lacks']

  const posCount = positiveWords.filter((w) => combined.includes(w)).length
  const negCount = negativeWords.filter((w) => combined.includes(w)).length

  if (posCount > negCount + 1) return 'positive'
  if (negCount > posCount + 1) return 'negative'
  return 'neutral'
}

async function queryAI(
  query: string,
  brand: string,
  domain: string,
): Promise<CitationQuery> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'anthropic-version': '2023-06-01',
  }
  if (process.env.ANTHROPIC_API_KEY) {
    headers['x-api-key'] = process.env.ANTHROPIC_API_KEY
  }

  try {
    const res = await fetch(`${ANTHROPIC_BASE}/v1/messages`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 400,
        messages: [{ role: 'user', content: query }],
      }),
    })

    if (!res.ok) {
      return { query, mentioned: false, sentiment: 'neutral', excerpt: `API error: ${res.status}` }
    }

    const data = (await res.json()) as any
    const text: string = data.content?.[0]?.text || ''

    const brandLower = brand.toLowerCase()
    const domainLower = domain.replace(/^www\./, '').toLowerCase()
    const mentioned =
      text.toLowerCase().includes(brandLower) ||
      text.toLowerCase().includes(domainLower)

    return {
      query,
      mentioned,
      sentiment: mentioned ? analyzeSentiment(text, brand) : 'neutral',
      excerpt: text.slice(0, 250),
    }
  } catch (err: any) {
    return { query, mentioned: false, sentiment: 'neutral', excerpt: `Error: ${err.message}` }
  }
}

/**
 * Run live AI citation test — queries an AI model and checks
 * if the brand/domain is mentioned in responses.
 */
export async function checkAICitation(
  baseUrl: string,
  html: string | null,
): Promise<{ category: CategoryResult; citationTest: CitationTestResult }> {
  const domain = new URL(baseUrl).hostname
  const brand = extractBrandName(html, domain)
  const queries = generateQueries(brand, domain)

  // Run queries in parallel
  const results = await Promise.all(
    queries.map((q) => queryAI(q, brand, domain)),
  )

  const mentionRate = results.filter((r) => r.mentioned).length / results.length
  const sentiments = results.filter((r) => r.mentioned).map((r) => r.sentiment)
  const overallSentiment: CitationTestResult['sentiment'] =
    sentiments.length === 0
      ? 'unknown'
      : sentiments.filter((s) => s === 'positive').length >= sentiments.length / 2
        ? 'positive'
        : sentiments.filter((s) => s === 'negative').length >= sentiments.length / 2
          ? 'negative'
          : 'neutral'

  // Build checks
  const checks: CheckDetail[] = []

  if (mentionRate >= 0.8) {
    checks.push(chk('mention_rate', 'pass',
      `AI mentions ${brand} in ${Math.round(mentionRate * 100)}% of relevant queries`,
      { mentionRate, brand }))
  } else if (mentionRate >= 0.3) {
    checks.push(chk('mention_rate', 'warn',
      `AI mentions ${brand} in ${Math.round(mentionRate * 100)}% of queries — room to improve visibility`,
      { mentionRate, brand }))
  } else {
    checks.push(chk('mention_rate', 'fail',
      `AI rarely mentions ${brand} (${Math.round(mentionRate * 100)}%) — brand is largely invisible to AI`,
      { mentionRate, brand }))
  }

  if (overallSentiment === 'positive') {
    checks.push(chk('sentiment', 'pass', `AI describes ${brand} positively when mentioned`))
  } else if (overallSentiment === 'negative') {
    checks.push(chk('sentiment', 'fail', `AI describes ${brand} negatively — reputation issue`))
  } else if (overallSentiment === 'neutral') {
    checks.push(chk('sentiment', 'warn', `AI describes ${brand} neutrally — opportunity to strengthen positioning`))
  } else {
    checks.push(chk('sentiment', 'warn', `Could not assess sentiment (brand not mentioned enough)`))
  }

  // Check if domain URL is specifically referenced
  const domainMentions = results.filter((r) =>
    r.excerpt.toLowerCase().includes(domain.replace(/^www\./, '').toLowerCase()),
  )
  if (domainMentions.length > 0) {
    checks.push(chk('url_citation', 'pass', `AI references ${domain} URL directly`))
  } else {
    checks.push(chk('url_citation', 'warn',
      'AI does not cite the URL directly — only brand name. Domain-level citation is harder to earn.'))
  }

  const category: CategoryResult = {
    name: 'AI Citation Reality',
    weight: 0.12,
    score: catScore(checks),
    checks,
  }

  const citationTest: CitationTestResult = {
    brandName: brand,
    mentionRate,
    sentiment: overallSentiment,
    queries: results,
  }

  return { category, citationTest }
}
