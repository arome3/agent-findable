import type { FetchResult, FetchedData } from './types'

// ── Fetch helpers ─────────────────────────────────────────────────────

export async function safeFetch(url: string, timeoutMs = 8000): Promise<string | null> {
  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    const res = await fetch(url, {
      signal: controller.signal,
      redirect: 'follow',
      headers: { 'User-Agent': 'AgentFindable/1.0' },
    })
    clearTimeout(timer)
    if (!res.ok) return null
    return await res.text()
  } catch {
    return null
  }
}

export async function safeFetchWithMeta(url: string, timeoutMs = 8000): Promise<FetchResult> {
  try {
    const start = performance.now()
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    const res = await fetch(url, {
      signal: controller.signal,
      redirect: 'follow',
      headers: { 'User-Agent': 'AgentFindable/1.0' },
    })
    const body = await res.text()
    clearTimeout(timer)
    const responseTimeMs = Math.round(performance.now() - start)

    const headers: Record<string, string> = {}
    res.headers.forEach((v, k) => { headers[k.toLowerCase()] = v })

    return { body: res.ok ? body : null, headers, status: res.status, responseTimeMs }
  } catch {
    return { body: null, headers: {}, status: 0, responseTimeMs: 0 }
  }
}

export async function fetchAllData(url: string): Promise<FetchedData> {
  const baseUrl = normalizeUrl(url)

  const [llmsTxt, llmsFullTxt, robotsTxt, mainPage, agentsMd, aiPlugin, mcpJson, sitemap, securityTxt1, securityTxt2] =
    await Promise.all([
      safeFetch(`${baseUrl}/llms.txt`),
      safeFetch(`${baseUrl}/llms-full.txt`),
      safeFetch(`${baseUrl}/robots.txt`),
      safeFetchWithMeta(baseUrl),
      safeFetch(`${baseUrl}/AGENTS.md`),
      safeFetch(`${baseUrl}/.well-known/ai-plugin.json`),
      safeFetch(`${baseUrl}/.well-known/mcp.json`),
      safeFetch(`${baseUrl}/sitemap.xml`),
      safeFetch(`${baseUrl}/.well-known/security.txt`),
      safeFetch(`${baseUrl}/security.txt`),
    ])

  return {
    llmsTxt,
    llmsFullTxt,
    robotsTxt,
    mainPage,
    agentsMd,
    aiPlugin,
    mcpJson,
    sitemap,
    securityTxt: securityTxt1 || securityTxt2,
    baseUrl,
  }
}

// ── robots.txt parser ─────────────────────────────────────────────────

export interface RobotRule {
  userAgent: string
  disallow: string[]
  allow: string[]
}

export function parseRobotsTxt(content: string): RobotRule[] {
  const rules: RobotRule[] = []
  let current: RobotRule | null = null

  for (const line of content.split('\n')) {
    const trimmed = line.split('#')[0]!.trim()
    if (!trimmed) continue

    const colonIdx = trimmed.indexOf(':')
    if (colonIdx === -1) continue
    const directive = trimmed.slice(0, colonIdx).trim().toLowerCase()
    const value = trimmed.slice(colonIdx + 1).trim()

    if (directive === 'user-agent') {
      current = { userAgent: value, disallow: [], allow: [] }
      rules.push(current)
    } else if (current) {
      if (directive === 'disallow' && value) current.disallow.push(value)
      if (directive === 'allow') current.allow.push(value)
    }
  }
  return rules
}

export function isAgentBlocked(rules: RobotRule[], agentName: string): boolean {
  const specificRule = rules.find(
    (r) => r.userAgent.toLowerCase() === agentName.toLowerCase(),
  )
  if (specificRule) {
    if (specificRule.disallow.some((d) => d === '/' || d === '/*')) {
      return !specificRule.allow.some((a) => a === '/' || a === '/*')
    }
    return false
  }
  const wildcard = rules.find((r) => r.userAgent === '*')
  if (wildcard) {
    if (wildcard.disallow.some((d) => d === '/' || d === '/*')) {
      return !wildcard.allow.some((a) => a === '/' || a === '/*')
    }
  }
  return false
}

// ── HTML extraction ───────────────────────────────────────────────────

export function extractJsonLd(html: string): any[] {
  const blocks: any[] = []
  const regex =
    /<script[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi
  let match
  while ((match = regex.exec(html)) !== null) {
    try { blocks.push(JSON.parse(match[1]!)) } catch {}
  }
  return blocks
}

export function extractMetaTags(html: string): Record<string, string> {
  const tags: Record<string, string> = {}
  const r1 = /<meta[^>]+(name|property)\s*=\s*["']([^"']+)["'][^>]*content\s*=\s*["']([^"']*?)["'][^>]*\/?>/gi
  const r2 = /<meta[^>]+content\s*=\s*["']([^"']*?)["'][^>]+(name|property)\s*=\s*["']([^"']+)["'][^>]*\/?>/gi
  let m
  while ((m = r1.exec(html)) !== null) if (m[2] && m[3] !== undefined) tags[m[2]] = m[3]
  while ((m = r2.exec(html)) !== null) if (m[3] && m[1] !== undefined) tags[m[3]] = m[1]
  return tags
}

export function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

// ── JS Framework Detection ────────────────────────────────────────────

export interface FrameworkInfo {
  name: string
  ssrDetected: boolean
  clientOnlyRisk: boolean
}

export function detectFramework(html: string): FrameworkInfo | null {
  const hasContent = stripHtml(html).length > 500

  if (html.includes('__NEXT_DATA__') || html.includes('_next/static')) {
    return { name: 'Next.js', ssrDetected: html.includes('__NEXT_DATA__'), clientOnlyRisk: !hasContent }
  }
  if (html.includes('__NUXT__') || html.includes('_nuxt/')) {
    return { name: 'Nuxt.js', ssrDetected: html.includes('__NUXT__'), clientOnlyRisk: !hasContent }
  }
  if (html.includes('data-reactroot') || html.includes('_reactRootContainer') || html.includes('react-root')) {
    return { name: 'React', ssrDetected: hasContent, clientOnlyRisk: !hasContent }
  }
  if (html.includes('data-v-') || (html.includes('id="app"') && html.includes('vue'))) {
    return { name: 'Vue.js', ssrDetected: hasContent, clientOnlyRisk: !hasContent }
  }
  if (html.includes('ng-version') || html.includes('_nghost')) {
    return { name: 'Angular', ssrDetected: hasContent, clientOnlyRisk: !hasContent }
  }
  if (html.includes('__sveltekit') || html.includes('data-sveltekit')) {
    return { name: 'SvelteKit', ssrDetected: true, clientOnlyRisk: false }
  }
  if (html.includes('___gatsby')) {
    return { name: 'Gatsby', ssrDetected: true, clientOnlyRisk: false }
  }
  if (html.includes('data-astro') || /astro-[\w]+/.test(html)) {
    return { name: 'Astro', ssrDetected: true, clientOnlyRisk: false }
  }
  if (html.includes('wp-content') || html.includes('wp-includes')) {
    return { name: 'WordPress', ssrDetected: true, clientOnlyRisk: false }
  }
  return null
}

// ── Evidence / Citability Analysis ────────────────────────────────────

export interface EvidenceAnalysis {
  statisticCount: number
  outboundLinkCount: number
  hasQAStructure: boolean
  firstParagraphQuality: 'excellent' | 'good' | 'poor'
  hasAuthorInfo: boolean
  wordCount: number
}

export function analyzeEvidence(html: string): EvidenceAnalysis {
  const text = stripHtml(html)

  const statistics = text.match(
    /\d+(?:\.\d+)?%|\$[\d,.]+[BMK]?|\d{1,3}(?:,\d{3})+|\d+x\b|\d+\+?\s*(?:million|billion|thousand|users|customers|companies)/gi,
  ) || []

  const externalLinks = (
    html.match(/<a[^>]+href\s*=\s*["']https?:\/\/[^"']+["']/gi) || []
  ).length

  const hasQA =
    /<(dt|summary)[^>]*>[^<]*\?/i.test(html) ||
    html.includes('"@type":"FAQPage"') ||
    html.includes('"@type": "FAQPage"') ||
    (html.match(/<h[2-4][^>]*>[^<]*\?<\/h[2-4]>/gi) || []).length >= 2

  const firstText = text.slice(0, 400).trim()
  let firstParagraphQuality: 'excellent' | 'good' | 'poor' = 'poor'
  if (firstText.length > 200 && !/^(Welcome|Home|Loading|Menu|Navigation|Skip)/i.test(firstText)) {
    firstParagraphQuality = /\d/.test(firstText) ? 'excellent' : 'good'
  } else if (firstText.length > 80) {
    firstParagraphQuality = 'good'
  }

  const hasAuthorInfo =
    (/<meta[^>]*name\s*=\s*["']author["'][^>]*content\s*=\s*["'][^"']+["']/i.test(html)) ||
    html.includes('"@type":"Person"') ||
    html.includes('"@type": "Person"') ||
    /<[^>]*class\s*=\s*["'][^"']*author[^"']*["']/i.test(html)

  const wordCount = text.split(/\s+/).filter((w) => w.length > 0).length

  return {
    statisticCount: statistics.length,
    outboundLinkCount: externalLinks,
    hasQAStructure: hasQA,
    firstParagraphQuality,
    hasAuthorInfo,
    wordCount,
  }
}

// ── Brand name extraction ─────────────────────────────────────────────

export function extractBrandName(html: string | null, domain: string): string {
  if (html) {
    // Prefer og:site_name (most reliable)
    const ogMatch = html.match(/<meta[^>]*property\s*=\s*["']og:site_name["'][^>]*content\s*=\s*["']([^"']+)["']/i)
      ?? html.match(/<meta[^>]*content\s*=\s*["']([^"']+)["'][^>]*property\s*=\s*["']og:site_name["']/i)
    if (ogMatch?.[1]) return ogMatch[1].trim()

    // Parse title tag — prefer the non-generic part
    const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i)
    if (titleMatch?.[1]) {
      const genericWords = new Set(['home', 'about', 'contact', 'welcome', 'blog', 'news', 'main', 'index', 'page'])
      const parts = titleMatch[1].trim().split(/\s*[-|–—:·]\s*/).filter((p) => p.length > 1)
      const brand = parts.find((p) => !genericWords.has(p.toLowerCase().trim())) ?? parts[0]
      if (brand && brand.length > 1 && brand.length < 40) return brand.trim()
    }
  }
  // Fall back to capitalized domain name
  const name = domain.replace(/^www\./, '').split('.')[0] ?? domain
  return name.charAt(0).toUpperCase() + name.slice(1)
}

// ── URL helpers ───────────────────────────────────────────────────────

export function normalizeUrl(url: string): string {
  try {
    const u = new URL(url)
    return `${u.protocol}//${u.host}`
  } catch {
    if (!url.startsWith('http')) {
      return normalizeUrl('https://' + url)
    }
    throw new Error(`Invalid URL: ${url}`)
  }
}
