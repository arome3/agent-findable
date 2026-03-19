import type { CategoryResult, CheckDetail, CheckStatus, FetchedData } from './types'
import {
  safeFetch,
  parseRobotsTxt,
  isAgentBlocked,
  extractJsonLd,
  extractMetaTags,
  stripHtml,
  detectFramework,
  analyzeEvidence,
  fetchAllData,
} from './utils'

const AI_BOTS = [
  'GPTBot', 'OAI-SearchBot', 'ChatGPT-User',
  'anthropic-ai', 'ClaudeBot', 'claude-web',
  'PerplexityBot', 'Perplexity-User',
  'Google-Extended', 'Applebot-Extended',
  'Meta-ExternalAgent', 'Amazonbot', 'Bytespider', 'CCBot',
]

function chk(name: string, status: CheckStatus, message: string, data?: Record<string, unknown>): CheckDetail {
  return { name, status, message, ...(data ? { data } : {}) }
}

function catScore(checks: CheckDetail[]): number {
  if (checks.length === 0) return 0
  const total = checks.reduce((s, c) =>
    s + (c.status === 'pass' ? 100 : c.status === 'warn' ? 50 : 0), 0)
  return Math.round(total / checks.length)
}

// ── 1. llms.txt (8%) ─────────────────────────────────────────────────

export function checkLlmsTxt(data: FetchedData): CategoryResult {
  const checks: CheckDetail[] = []
  const raw = data.llmsTxt

  if (!raw) {
    checks.push(chk('exists', 'fail', 'llms.txt not found'))
  } else {
    checks.push(chk('exists', 'pass', 'llms.txt exists'))

    const hasH1 = /^#\s+.+/m.test(raw)
    const hasBlockquote = /^>\s+.+/m.test(raw)
    if (hasH1 && hasBlockquote) {
      checks.push(chk('format', 'pass', 'Valid llms.txt format (H1 + blockquote)'))
    } else if (hasH1 || hasBlockquote) {
      checks.push(chk('format', 'warn',
        `Partial format (missing ${!hasH1 ? 'H1 heading' : 'blockquote description'})`))
    } else {
      checks.push(chk('format', 'fail', 'Does not follow llms.txt spec format'))
    }

    const linkRegex = /\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g
    const links: string[] = []
    let m
    while ((m = linkRegex.exec(raw)) !== null) if (m[2]) links.push(m[2])
    const plainUrlRegex = /(?:^|\s)(https?:\/\/\S+)/gm
    while ((m = plainUrlRegex.exec(raw)) !== null) {
      if (m[1] && !links.includes(m[1])) links.push(m[1])
    }

    if (links.length > 0) {
      checks.push(chk('has_links', 'pass', `Contains ${links.length} link(s)`))
    } else {
      checks.push(chk('has_links', 'warn', 'No links found in llms.txt'))
    }
  }

  // llms-full.txt bonus
  if (data.llmsFullTxt) {
    checks.push(chk('llms_full', 'pass', 'llms-full.txt also available (comprehensive version)'))
  } else {
    checks.push(chk('llms_full', 'warn', 'No llms-full.txt found (recommended for deep context)'))
  }

  return { name: 'llms.txt', weight: 0.08, score: catScore(checks), checks }
}

// ── 2. robots.txt AI Bots (8%) ────────────────────────────────────────

export function checkRobotsTxt(data: FetchedData): CategoryResult {
  const checks: CheckDetail[] = []
  const raw = data.robotsTxt

  if (!raw) {
    checks.push(chk('exists', 'fail', 'robots.txt not found'))
    return { name: 'robots.txt AI Bots', weight: 0.08, score: 0, checks }
  }

  checks.push(chk('exists', 'pass', 'robots.txt exists'))

  const rules = parseRobotsTxt(raw)
  let blocked = 0
  const blockedNames: string[] = []

  for (const bot of AI_BOTS) {
    if (isAgentBlocked(rules, bot)) {
      blocked++
      blockedNames.push(bot)
    }
  }

  if (blocked === 0) {
    checks.push(chk('ai_bots', 'pass', `All ${AI_BOTS.length} AI bots allowed`))
  } else if (blocked < AI_BOTS.length) {
    checks.push(chk('ai_bots', 'warn',
      `${blocked}/${AI_BOTS.length} AI bots blocked: ${blockedNames.join(', ')}`,
      { blockedBots: blockedNames }))
  } else {
    checks.push(chk('ai_bots', 'fail', `All ${AI_BOTS.length} AI bots blocked`))
  }

  return { name: 'robots.txt AI Bots', weight: 0.08, score: catScore(checks), checks }
}

// ── 3. Content Readability (8%) ───────────────────────────────────────

export function checkContentReadability(html: string | null): CategoryResult {
  const checks: CheckDetail[] = []

  if (!html) {
    checks.push(chk('accessible', 'fail', 'Could not fetch main page'))
    return { name: 'Content Readability', weight: 0.08, score: 0, checks }
  }

  const text = stripHtml(html)

  // Text content volume
  if (text.length > 500) {
    checks.push(chk('text_content', 'pass', `Substantial text (${text.length} chars)`))
  } else if (text.length > 100) {
    checks.push(chk('text_content', 'warn', `Limited text (${text.length} chars)`))
  } else {
    checks.push(chk('text_content', 'fail', `Very little text (${text.length} chars)`))
  }

  // Meta tags
  const meta = extractMetaTags(html)
  const hasDesc = !!meta['description'] || !!meta['og:description']
  const hasTitle = !!meta['og:title'] || /<title[^>]*>.+<\/title>/i.test(html)
  if (hasDesc && hasTitle) {
    checks.push(chk('meta_tags', 'pass', 'Meta description and title present'))
  } else if (hasDesc || hasTitle) {
    checks.push(chk('meta_tags', 'warn', `Missing ${!hasTitle ? 'title' : 'meta description'}`))
  } else {
    checks.push(chk('meta_tags', 'fail', 'No meta description or title found'))
  }

  // Heading hierarchy
  const headings = html.match(/<h[1-6][^>]*>/gi) || []
  if (headings.length >= 3) {
    checks.push(chk('headings', 'pass', `Good heading structure (${headings.length} headings)`))
  } else if (headings.length >= 1) {
    checks.push(chk('headings', 'warn', `Minimal headings (${headings.length})`))
  } else {
    checks.push(chk('headings', 'fail', 'No headings found'))
  }

  // Semantic HTML elements
  const semanticTags = ['<main', '<article', '<section', '<nav', '<aside', '<header', '<footer']
  const foundSemantic = semanticTags.filter((tag) => html.toLowerCase().includes(tag))
  if (foundSemantic.length >= 3) {
    checks.push(chk('semantic_html', 'pass', `Good semantic HTML (${foundSemantic.length} landmark elements)`))
  } else if (foundSemantic.length >= 1) {
    checks.push(chk('semantic_html', 'warn', `Minimal semantic HTML (${foundSemantic.length} landmark elements)`))
  } else {
    checks.push(chk('semantic_html', 'fail', 'No semantic HTML landmarks (<main>, <article>, etc.)'))
  }

  // Language attribute
  if (/<html[^>]*lang\s*=\s*["'][^"']+["']/i.test(html)) {
    checks.push(chk('lang_attr', 'pass', 'HTML lang attribute set'))
  } else {
    checks.push(chk('lang_attr', 'warn', 'Missing HTML lang attribute'))
  }

  return { name: 'Content Readability', weight: 0.08, score: catScore(checks), checks }
}

// ── 4. Structured Data Depth (10%) ────────────────────────────────────

export function checkStructuredDataDepth(html: string | null): CategoryResult {
  const checks: CheckDetail[] = []

  if (!html) {
    checks.push(chk('accessible', 'fail', 'Could not fetch main page'))
    return { name: 'Structured Data Depth', weight: 0.10, score: 0, checks }
  }

  const jsonLd = extractJsonLd(html)

  if (jsonLd.length > 0) {
    checks.push(chk('json_ld', 'pass', `Found ${jsonLd.length} JSON-LD block(s)`))
  } else {
    checks.push(chk('json_ld', 'fail', 'No JSON-LD structured data found'))
    return { name: 'Structured Data Depth', weight: 0.10, score: catScore(checks), checks }
  }

  // Extract all @types (including from @graph)
  const types: string[] = jsonLd.flatMap((block) => {
    const result: string[] = []
    if (block['@type']) result.push(...[block['@type']].flat())
    if (Array.isArray(block['@graph'])) {
      for (const g of block['@graph']) {
        if (g['@type']) result.push(...[g['@type']].flat())
      }
    }
    return result
  }).filter(Boolean)

  if (types.length > 0) {
    checks.push(chk('schema_types', 'pass',
      `Schema.org types: ${[...new Set(types)].join(', ')}`,
      { types: [...new Set(types)] }))
  } else {
    checks.push(chk('schema_types', 'warn', 'JSON-LD found but no @type detected'))
  }

  // High-value types for AI citations (FAQPage is the #1 most effective)
  const highValueTypes = ['FAQPage', 'Article', 'BlogPosting', 'HowTo', 'Product', 'Review', 'AggregateRating']
  const foundHigh = types.filter((t) => highValueTypes.includes(t))
  if (foundHigh.length > 0) {
    checks.push(chk('citation_types', 'pass',
      `High-citation types: ${[...new Set(foundHigh)].join(', ')} (50%+ more AI citations)`))
  } else {
    checks.push(chk('citation_types', 'warn',
      'No high-citation types (FAQPage, Article, HowTo, Product) — these get 50% more AI citations'))
  }

  // E-E-A-T types (Organization, Person with credentials)
  const eeatTypes = ['Organization', 'Person', 'LocalBusiness']
  const foundEeat = types.filter((t) => eeatTypes.includes(t))
  if (foundEeat.length > 0) {
    checks.push(chk('eeat_types', 'pass', `E-E-A-T types: ${[...new Set(foundEeat)].join(', ')}`))
  } else {
    checks.push(chk('eeat_types', 'warn', 'No E-E-A-T types (Organization, Person) — AI values authority signals'))
  }

  // Check for author / datePublished / dateModified in schema
  const allObjects = jsonLd.flatMap((b) =>
    Array.isArray(b['@graph']) ? b['@graph'] : [b],
  )
  const hasAuthorSchema = allObjects.some((o) => o.author)
  const hasDatePublished = allObjects.some((o) => o.datePublished)
  const hasDateModified = allObjects.some((o) => o.dateModified)

  if (hasAuthorSchema && hasDatePublished) {
    checks.push(chk('schema_detail', 'pass',
      `Schema includes author${hasDateModified ? ', datePublished, dateModified' : ' and datePublished'}`))
  } else if (hasAuthorSchema || hasDatePublished) {
    checks.push(chk('schema_detail', 'warn',
      `Schema missing ${!hasAuthorSchema ? 'author' : 'datePublished'} — AI uses these for trust`))
  } else {
    checks.push(chk('schema_detail', 'warn', 'Schema lacks author and date properties — reduces AI trust'))
  }

  return { name: 'Structured Data Depth', weight: 0.10, score: catScore(checks), checks }
}

// ── 5. Agent Protocols (5%) ───────────────────────────────────────────

export function checkAgentProtocols(agentsMd: string | null, aiPlugin: string | null): CategoryResult {
  const checks: CheckDetail[] = []

  if (agentsMd) {
    checks.push(chk('agents_md', 'pass', 'AGENTS.md exists'))
  } else {
    checks.push(chk('agents_md', 'fail', 'AGENTS.md not found'))
  }

  if (aiPlugin) {
    try {
      const parsed = JSON.parse(aiPlugin)
      if (parsed.schema_version && parsed.name_for_model) {
        checks.push(chk('ai_plugin', 'pass', 'Valid ai-plugin.json manifest'))
      } else {
        checks.push(chk('ai_plugin', 'warn', 'ai-plugin.json exists but may be incomplete'))
      }
    } catch {
      checks.push(chk('ai_plugin', 'warn', 'ai-plugin.json exists but is not valid JSON'))
    }
  } else {
    checks.push(chk('ai_plugin', 'fail', 'ai-plugin.json not found'))
  }

  let hasOpenApi = false
  if (aiPlugin) {
    try { if (JSON.parse(aiPlugin).api?.url) hasOpenApi = true } catch {}
  }
  checks.push(hasOpenApi
    ? chk('openapi', 'pass', 'OpenAPI spec referenced in ai-plugin.json')
    : chk('openapi', 'warn', 'No OpenAPI spec discoverable'))

  return { name: 'Agent Protocols', weight: 0.05, score: catScore(checks), checks }
}

// ── 6. MCP Readiness (4%) ─────────────────────────────────────────────

export function checkMcpReadiness(data: FetchedData): CategoryResult {
  const checks: CheckDetail[] = []
  const mcpJson = data.mcpJson

  if (mcpJson) {
    checks.push(chk('mcp_exists', 'pass', '.well-known/mcp.json exists'))
    try {
      const parsed = JSON.parse(mcpJson)
      if (parsed.name && (parsed.tools || parsed.resources || parsed.prompts)) {
        checks.push(chk('mcp_valid', 'pass', 'Valid MCP manifest structure'))
      } else {
        checks.push(chk('mcp_valid', 'warn', 'MCP manifest exists but may be incomplete'))
      }
    } catch {
      checks.push(chk('mcp_valid', 'fail', 'mcp.json is not valid JSON'))
    }
  } else {
    // Check if MCP is referenced elsewhere (llms.txt, HTML, docs)
    const allText = [data.llmsTxt, data.llmsFullTxt, data.mainPage.body].filter(Boolean).join(' ').toLowerCase()
    const hasMcpReference = allText.includes('mcp') && (
      allText.includes('model context protocol') ||
      allText.includes('mcp server') ||
      allText.includes('mcp-server') ||
      allText.includes('agent-toolkit') ||
      /mcp[_-]?sdk/i.test(allText)
    )

    if (hasMcpReference) {
      checks.push(chk('mcp_exists', 'warn',
        '.well-known/mcp.json not found, but MCP is referenced in site content — consider adding a discoverable manifest'))
    } else {
      checks.push(chk('mcp_exists', 'fail', '.well-known/mcp.json not found'))
    }
  }

  return { name: 'MCP Readiness', weight: 0.04, score: catScore(checks), checks }
}

// ── 7. Sitemap (3%) ──────────────────────────────────────────────────

export async function checkSitemap(sitemapRaw: string | null, robotsTxt: string | null, baseUrl: string): Promise<CategoryResult> {
  const checks: CheckDetail[] = []

  let raw = sitemapRaw

  // If /sitemap.xml not found, check robots.txt for Sitemap: directive
  if (!raw && robotsTxt) {
    const sitemapMatch = robotsTxt.match(/^Sitemap:\s*(\S+)/mi)
    if (sitemapMatch?.[1]) {
      const sitemapUrl = sitemapMatch[1]
      raw = await safeFetch(sitemapUrl)
      if (raw) {
        checks.push(chk('exists', 'pass', `Sitemap found via robots.txt: ${sitemapUrl}`))
      }
    }
  }

  if (!raw) {
    checks.push(chk('exists', 'fail', 'No sitemap found at /sitemap.xml or in robots.txt Sitemap directive'))
    return { name: 'Sitemap', weight: 0.03, score: 0, checks }
  }

  if (checks.length === 0) {
    checks.push(chk('exists', 'pass', 'sitemap.xml exists'))
  }

  if (/<urlset/i.test(raw) || /<sitemapindex/i.test(raw)) {
    checks.push(chk('valid_xml', 'pass', 'Valid sitemap structure'))
  } else {
    checks.push(chk('valid_xml', 'fail', 'Does not appear to be valid sitemap XML'))
  }

  const urlCount = (raw.match(/<loc>/gi) || []).length
  if (urlCount > 0) {
    checks.push(chk('has_urls', 'pass', `Contains ${urlCount} URL(s)`))
  } else {
    checks.push(chk('has_urls', 'fail', 'No URLs found in sitemap'))
  }

  return { name: 'Sitemap', weight: 0.03, score: catScore(checks), checks }
}

// ── 8. Freshness Signals (12%) ────────────────────────────────────────

export function checkFreshnessSignals(data: FetchedData): CategoryResult {
  const checks: CheckDetail[] = []
  const headers = data.mainPage.headers
  const html = data.mainPage.body

  // Last-Modified header (#1 missing signal in 200+ audits)
  const lastModified = headers['last-modified']
  if (lastModified) {
    checks.push(chk('last_modified', 'pass', `Last-Modified header: ${lastModified}`))
  } else {
    checks.push(chk('last_modified', 'fail',
      'No Last-Modified header — #1 missing freshness signal (absent on 57% of audited sites)'))
  }

  // ETag header
  if (headers['etag']) {
    checks.push(chk('etag', 'pass', 'ETag header present (server tracks content changes)'))
  } else {
    checks.push(chk('etag', 'warn', 'No ETag header'))
  }

  // Schema datePublished / dateModified
  if (html) {
    const jsonLd = extractJsonLd(html)
    const allObjects = jsonLd.flatMap((b) =>
      Array.isArray(b['@graph']) ? b['@graph'] : [b],
    )
    const types: string[] = allObjects.flatMap((o) => o['@type'] ? [o['@type']].flat() : [])
    const isArticlePage = types.some((t) =>
      ['Article', 'BlogPosting', 'NewsArticle', 'TechArticle', 'HowTo'].includes(t))
    const datePublished = allObjects.find((o) => o.datePublished)?.datePublished
    const dateModified = allObjects.find((o) => o.dateModified)?.dateModified

    if (datePublished) {
      checks.push(chk('date_published', 'pass', `Schema datePublished: ${datePublished}`))
    } else if (isArticlePage) {
      checks.push(chk('date_published', 'fail', 'No datePublished in schema — critical for article pages'))
    } else {
      checks.push(chk('date_published', 'warn', 'No datePublished in schema — helps AI assess content freshness'))
    }

    if (dateModified) {
      checks.push(chk('date_modified', 'pass', `Schema dateModified: ${dateModified}`))
    } else {
      checks.push(chk('date_modified', 'warn', 'No dateModified in schema — AI prefers recently updated content'))
    }

    // Meta article:published_time / article:modified_time
    const meta = extractMetaTags(html)
    if (meta['article:published_time'] || meta['article:modified_time']) {
      checks.push(chk('og_dates', 'pass', 'Open Graph article date meta tags present'))
    } else {
      checks.push(chk('og_dates', 'warn', 'No article:published_time or article:modified_time meta tags'))
    }
  } else {
    checks.push(chk('date_published', 'fail', 'Could not analyze page for date signals'))
  }

  return { name: 'Freshness Signals', weight: 0.12, score: catScore(checks), checks }
}

// ── 9. Citability & Evidence (15%) ────────────────────────────────────

export function checkCitabilityEvidence(html: string | null): CategoryResult {
  const checks: CheckDetail[] = []

  if (!html) {
    checks.push(chk('accessible', 'fail', 'Could not fetch main page'))
    return { name: 'Citability & Evidence', weight: 0.15, score: 0, checks }
  }

  const evidence = analyzeEvidence(html)

  // Statistics and data points (30-40% higher AI visibility)
  if (evidence.statisticCount >= 5) {
    checks.push(chk('statistics', 'pass',
      `${evidence.statisticCount} data points found — content with stats gets 30-40% more AI citations`))
  } else if (evidence.statisticCount >= 1) {
    checks.push(chk('statistics', 'warn',
      `Only ${evidence.statisticCount} data point(s) — add more statistics for better AI citability`))
  } else {
    checks.push(chk('statistics', 'fail',
      'No statistics or data points — content with stats gets 30-40% more AI citations'))
  }

  // Outbound citations/references
  if (evidence.outboundLinkCount >= 5) {
    checks.push(chk('citations', 'pass',
      `${evidence.outboundLinkCount} outbound references — shows research credibility`))
  } else if (evidence.outboundLinkCount >= 1) {
    checks.push(chk('citations', 'warn',
      `Only ${evidence.outboundLinkCount} outbound reference(s) — add citations to boost credibility`))
  } else {
    checks.push(chk('citations', 'fail',
      'No outbound references — machine-readable citations appeared in only 6% of audited sites'))
  }

  // Q&A structure (FAQPage is most effective for AI citations)
  if (evidence.hasQAStructure) {
    checks.push(chk('qa_structure', 'pass',
      'Q&A / FAQ structure detected — the most effective format for AI citations'))
  } else {
    checks.push(chk('qa_structure', 'warn',
      'No Q&A structure — FAQ-style content is the single most effective format for AI citations'))
  }

  // First paragraph quality
  if (evidence.firstParagraphQuality === 'excellent') {
    checks.push(chk('first_paragraph', 'pass',
      'Opening content is direct and data-rich — AI retrieval scores opening content heaviest'))
  } else if (evidence.firstParagraphQuality === 'good') {
    checks.push(chk('first_paragraph', 'warn',
      'Opening content is adequate but could include more data — first 200 words matter most for AI'))
  } else {
    checks.push(chk('first_paragraph', 'fail',
      'Opening content is weak or generic — AI evaluates first 200 words for retrieval relevance'))
  }

  // Author information (E-E-A-T)
  if (evidence.hasAuthorInfo) {
    checks.push(chk('author_info', 'pass', 'Author information detected (E-E-A-T signal)'))
  } else {
    checks.push(chk('author_info', 'warn',
      'No author information — AI values E-E-A-T signals for trust and citability'))
  }

  // Word count (substantial content)
  if (evidence.wordCount >= 800) {
    checks.push(chk('content_depth', 'pass',
      `Substantial content depth (${evidence.wordCount} words)`))
  } else if (evidence.wordCount >= 300) {
    checks.push(chk('content_depth', 'warn',
      `Moderate content depth (${evidence.wordCount} words) — comprehensive content ranks higher in AI`))
  } else {
    checks.push(chk('content_depth', 'fail',
      `Thin content (${evidence.wordCount} words) — AI prefers comprehensive, authoritative pages`))
  }

  return { name: 'Citability & Evidence', weight: 0.15, score: catScore(checks), checks }
}

// ── 10. Security & Trust (5%) ─────────────────────────────────────────

export function checkSecurityTrust(data: FetchedData): CategoryResult {
  const checks: CheckDetail[] = []
  const headers = data.mainPage.headers

  // HTTPS
  if (data.baseUrl.startsWith('https://')) {
    checks.push(chk('https', 'pass', 'HTTPS enabled'))
  } else {
    checks.push(chk('https', 'fail', 'Not using HTTPS — required for AI trust'))
  }

  // security.txt
  if (data.securityTxt) {
    checks.push(chk('security_txt', 'pass', 'security.txt present'))
  } else {
    checks.push(chk('security_txt', 'warn', 'No security.txt (RFC 9116)'))
  }

  // HSTS
  if (headers['strict-transport-security']) {
    checks.push(chk('hsts', 'pass', 'Strict-Transport-Security header present'))
  } else {
    checks.push(chk('hsts', 'warn', 'No Strict-Transport-Security header'))
  }

  // X-Content-Type-Options
  if (headers['x-content-type-options']) {
    checks.push(chk('xcto', 'pass', 'X-Content-Type-Options header present'))
  } else {
    checks.push(chk('xcto', 'warn', 'No X-Content-Type-Options header'))
  }

  return { name: 'Security & Trust', weight: 0.05, score: catScore(checks), checks }
}

// ── 11. Crawlability & Rendering (10%) ────────────────────────────────

export function checkCrawlabilityRendering(data: FetchedData): CategoryResult {
  const checks: CheckDetail[] = []
  const html = data.mainPage.body
  const responseTime = data.mainPage.responseTimeMs

  if (!html) {
    checks.push(chk('accessible', 'fail', 'Could not fetch main page'))
    return { name: 'Crawlability & Rendering', weight: 0.10, score: 0, checks }
  }

  // JS Framework detection
  const framework = detectFramework(html)
  if (framework) {
    if (framework.clientOnlyRisk) {
      checks.push(chk('js_rendering', 'fail',
        `${framework.name} detected — appears client-side rendered. AI crawlers cannot execute JavaScript`,
        { framework: framework.name }))
    } else if (framework.ssrDetected) {
      checks.push(chk('js_rendering', 'pass',
        `${framework.name} with SSR detected — content accessible to AI crawlers`,
        { framework: framework.name }))
    } else {
      checks.push(chk('js_rendering', 'warn',
        `${framework.name} detected — verify SSR is enabled for AI crawler access`,
        { framework: framework.name }))
    }
  } else {
    checks.push(chk('js_rendering', 'pass', 'No JS framework detected — content is server-rendered'))
  }

  // Text-to-script ratio
  const scriptContent = (html.match(/<script[\s\S]*?<\/script>/gi) || []).join('').length
  const totalLength = html.length
  const scriptRatio = scriptContent / totalLength

  if (scriptRatio < 0.3) {
    checks.push(chk('script_ratio', 'pass',
      `Low script ratio (${(scriptRatio * 100).toFixed(0)}%) — content is in HTML, not JS`))
  } else if (scriptRatio < 0.6) {
    checks.push(chk('script_ratio', 'warn',
      `Moderate script ratio (${(scriptRatio * 100).toFixed(0)}%) — some content may be JS-dependent`))
  } else {
    checks.push(chk('script_ratio', 'fail',
      `High script ratio (${(scriptRatio * 100).toFixed(0)}%) — most content likely requires JS execution`))
  }

  // <noscript> fallback
  if (/<noscript/i.test(html)) {
    checks.push(chk('noscript', 'pass', '<noscript> fallback present'))
  } else if (framework) {
    checks.push(chk('noscript', 'warn', 'No <noscript> fallback — provide content for non-JS crawlers'))
  }

  // Response time
  if (responseTime > 0) {
    if (responseTime < 500) {
      checks.push(chk('response_time', 'pass',
        `Fast response (${responseTime}ms) — crawlers prioritize fast sites`))
    } else if (responseTime < 2000) {
      checks.push(chk('response_time', 'warn',
        `Moderate response time (${responseTime}ms) — aim for < 500ms`))
    } else {
      checks.push(chk('response_time', 'fail',
        `Slow response (${responseTime}ms) — slow sites get crawled less often`))
    }
  }

  // Content-Type header
  const contentType = data.mainPage.headers['content-type'] || ''
  if (contentType.includes('text/html')) {
    checks.push(chk('content_type', 'pass', 'Correct Content-Type header'))
  } else if (contentType) {
    checks.push(chk('content_type', 'warn', `Unexpected Content-Type: ${contentType}`))
  } else {
    checks.push(chk('content_type', 'warn', 'No Content-Type header'))
  }

  return { name: 'Crawlability & Rendering', weight: 0.10, score: catScore(checks), checks }
}

// ── Orchestrator ──────────────────────────────────────────────────────

export async function runAllChecks(url: string): Promise<{
  categories: CategoryResult[]
  fetchedData: FetchedData
}> {
  const data = await fetchAllData(url)

  const sitemapResult = await checkSitemap(data.sitemap, data.robotsTxt, data.baseUrl)

  const categories = [
    checkLlmsTxt(data),
    checkRobotsTxt(data),
    checkContentReadability(data.mainPage.body),
    checkStructuredDataDepth(data.mainPage.body),
    checkAgentProtocols(data.agentsMd, data.aiPlugin),
    checkMcpReadiness(data),
    sitemapResult,
    checkFreshnessSignals(data),
    checkCitabilityEvidence(data.mainPage.body),
    checkSecurityTrust(data),
    checkCrawlabilityRendering(data),
  ]

  return { categories, fetchedData: data }
}
