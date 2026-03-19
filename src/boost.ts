import type { ScanResult, BoostResult, BoostFix } from './types'
import { safeFetch, normalizeUrl } from './utils'

const ANTHROPIC_BASE = process.env.ANTHROPIC_MPP_URL || 'https://api.anthropic.com'
const FIRECRAWL_BASE = process.env.FIRECRAWL_MPP_URL || 'https://api.firecrawl.dev'

async function fetchRenderedPage(url: string): Promise<string | null> {
  try {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' }
    if (process.env.FIRECRAWL_API_KEY) {
      headers['Authorization'] = `Bearer ${process.env.FIRECRAWL_API_KEY}`
    }
    const res = await fetch(`${FIRECRAWL_BASE}/v1/scrape`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ url, formats: ['markdown'] }),
    })
    if (!res.ok) return null
    const data = (await res.json()) as any
    return data.data?.markdown || null
  } catch {
    return null
  }
}

function buildPrompt(url: string, scanResult: ScanResult, pageContent?: string): string {
  const categoryBreakdown = scanResult.categories
    .sort((a, b) => a.score - b.score)
    .map((c) => {
      const failedChecks = c.checks
        .filter((ch) => ch.status !== 'pass')
        .map((ch) => `    - [${ch.status.toUpperCase()}] ${ch.message}`)
        .join('\n')
      return `- ${c.name} (${c.score}/100, weight: ${(c.weight * 100).toFixed(0)}%):\n${failedChecks || '    All checks passed'}`
    })
    .join('\n')

  const citationInfo = scanResult.citationTest
    ? `\nAI Citation Test Results:
- Brand: ${scanResult.citationTest.brandName}
- Mention Rate: ${Math.round(scanResult.citationTest.mentionRate * 100)}%
- Sentiment: ${scanResult.citationTest.sentiment}
- Queries tested: ${scanResult.citationTest.queries.map((q) => `"${q.query}" → ${q.mentioned ? 'MENTIONED' : 'NOT mentioned'}`).join('; ')}`
    : ''

  return `You are an AI agent findability expert. A website has been audited across 12 categories covering technical infrastructure, content quality, citability, freshness, security, and AI citation reality.

Website: ${url}
Overall Score: ${scanResult.score}/100 (${scanResult.grade})
${citationInfo}

Detailed Breakdown (sorted by weakest first):
${categoryBreakdown}

${pageContent ? `Page Content (first 4000 chars):\n${pageContent.slice(0, 4000)}` : ''}

KEY RESEARCH FINDINGS TO INFORM YOUR RECOMMENDATIONS:
- Content with statistics gets 30-40% higher AI visibility
- Pages with Schema.org markup get 50% more AI citations
- FAQPage schema is the single most effective type for AI citations
- "No Last-Modified header" is the #1 missing signal (57% of sites lack it)
- Machine-readable citations/references appear in only 6% of sites
- First 200 words matter most for AI retrieval scoring
- AI models cross-check schema data against visible page content
- 18.9% of sites are completely invisible to AI crawlers due to JS rendering

Generate a JSON response with:
1. "fixes": Array of prioritized fixes. Each fix has: priority (1=highest, up to 10), category (matching category name), title (actionable verb phrase), description (specific implementation guidance with code examples where helpful), effort ("low"/"medium"/"high"), impact ("low"/"medium"/"high"). Sort by impact DESC, effort ASC.
2. "generatedFiles": Object with keys "llms.txt", "robots.txt", "AGENTS.md", "security.txt" — each containing recommended file contents for this specific website. Make them specific to this site, not generic templates.

Focus on the weakest categories first. For each fix, explain WHY it matters for AI visibility with specific data.

Respond ONLY with valid JSON, no markdown code fences.`
}

function parseBoostResponse(url: string, scanResult: ScanResult, text: string): BoostResult {
  try {
    let jsonStr = text.trim()
    if (jsonStr.startsWith('```')) {
      jsonStr = jsonStr.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '')
    }
    const parsed = JSON.parse(jsonStr)
    return {
      url,
      fixes: (parsed.fixes || []) as BoostFix[],
      generatedFiles: parsed.generatedFiles || {},
      scanResult,
    }
  } catch {
    return {
      url,
      fixes: generateDefaultFixes(scanResult),
      generatedFiles: {},
      scanResult,
    }
  }
}

function generateDefaultFixes(scanResult: ScanResult): BoostFix[] {
  const fixes: BoostFix[] = []
  let priority = 1

  // Sort categories by: low score * high weight = highest priority
  const sorted = [...scanResult.categories].sort(
    (a, b) => a.score * a.weight - b.score * b.weight,
  )

  for (const cat of sorted) {
    if (cat.score < 80) {
      for (const c of cat.checks.filter((c) => c.status !== 'pass')) {
        fixes.push({
          priority: Math.min(priority, 10),
          category: cat.name,
          title: `Fix: ${c.name}`,
          description: c.message,
          effort: c.status === 'fail' ? 'medium' : 'low',
          impact: cat.weight >= 0.10 ? 'high' : cat.weight >= 0.05 ? 'medium' : 'low',
        })
        priority++
      }
    }
  }

  return fixes.slice(0, 15)
}

export async function generateBoostReport(
  url: string,
  scanResult: ScanResult,
): Promise<BoostResult> {
  const pageContent =
    (await fetchRenderedPage(url)) || (await safeFetch(normalizeUrl(url)))

  const prompt = buildPrompt(url, scanResult, pageContent || undefined)

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
        model: 'claude-sonnet-4-20250514',
        max_tokens: 4096,
        messages: [{ role: 'user', content: prompt }],
      }),
    })

    if (!res.ok) {
      console.error(`Anthropic API error: ${res.status}`)
      // Fall back to default fixes
      return {
        url,
        fixes: generateDefaultFixes(scanResult),
        generatedFiles: {},
        scanResult,
      }
    }

    const data = (await res.json()) as any
    const text = data.content?.[0]?.text || ''
    return parseBoostResponse(url, scanResult, text)
  } catch (err: any) {
    console.error(`Boost generation error: ${err.message}`)
    return {
      url,
      fixes: generateDefaultFixes(scanResult),
      generatedFiles: {},
      scanResult,
    }
  }
}
