import type { FetchedData } from './types'
import {
  fetchAllData,
  extractJsonLd,
  extractMetaTags,
  stripHtml,
  extractBrandName,
  parseRobotsTxt,
  isAgentBlocked,
} from './utils'

const ANTHROPIC_BASE = process.env.ANTHROPIC_MPP_URL || 'https://api.anthropic.com'

const AI_BOTS = [
  'GPTBot', 'OAI-SearchBot', 'ChatGPT-User',
  'anthropic-ai', 'ClaudeBot', 'claude-web',
  'PerplexityBot', 'Perplexity-User',
  'Google-Extended', 'Applebot-Extended',
  'Meta-ExternalAgent', 'Amazonbot', 'Bytespider', 'CCBot',
]

// ── Types ─────────────────────────────────────────────────────────────

export interface AgentPOV {
  identity: {
    brandName: string
    url: string
    description: string
    entityType: string
    keyFacts: Record<string, string>
  }
  knowledge: {
    selfDescription: string
    aiPerception: string
    accuracyIssues: string[]
    knowledgeGaps: string[]
  }
  actions: {
    mcpTools: { name: string; description: string }[]
    apiEndpoints: { method: string; path: string; description: string }[]
    agentInstructions: string | null
    discoveredCapabilities: string[]
  }
  content: {
    llmsTxtAvailable: boolean
    llmsTxtSummary: string | null
    mainPageExtract: string
    structuredEntities: { type: string; name?: string; properties: string[] }[]
    keyPages: { title: string; url: string }[]
    wordCount: number
  }
  permissions: {
    allowedBots: string[]
    blockedBots: string[]
    restrictedPaths: string[]
    sitemapUrl: string | null
  }
  agentSummary: string
  recommendations: string[]
  raw: {
    llmsTxt: string | null
    agentsMd: string | null
  }
  generatedAt: string
}

// ── Identity extraction ───────────────────────────────────────────────

function extractIdentity(data: FetchedData): AgentPOV['identity'] {
  const html = data.mainPage.body || ''
  const brandName = extractBrandName(html, new URL(data.baseUrl).hostname)
  const meta = extractMetaTags(html)
  const jsonLd = extractJsonLd(html)
  const allObjects = jsonLd.flatMap((b) =>
    Array.isArray(b['@graph']) ? b['@graph'] : [b],
  )

  // Description: prefer meta > og:description > llms.txt blockquote > schema
  const description =
    meta['description'] ||
    meta['og:description'] ||
    (data.llmsTxt?.match(/^>\s*(.+)/m)?.[1]) ||
    allObjects.find((o) => o.description)?.description ||
    ''

  // Entity type from schema
  const types = allObjects.flatMap((o) => o['@type'] ? [o['@type']].flat() : []).filter(Boolean)
  const entityType = types.find((t: string) =>
    ['Organization', 'Corporation', 'LocalBusiness', 'Person', 'Product', 'SoftwareApplication', 'WebSite'].includes(t),
  ) || (types[0] as string) || 'Unknown'

  // Key facts from schema
  const keyFacts: Record<string, string> = {}
  const org = allObjects.find((o) => ['Organization', 'Corporation', 'LocalBusiness'].includes(o['@type']))
  if (org) {
    if (org.foundingDate) keyFacts['Founded'] = org.foundingDate
    if (org.url) keyFacts['URL'] = org.url
    if (org.address?.addressCountry) keyFacts['Country'] = org.address.addressCountry
    if (org.numberOfEmployees?.value) keyFacts['Employees'] = org.numberOfEmployees.value
    if (org.sameAs) keyFacts['Social Profiles'] = [org.sameAs].flat().length + ' linked'
  }
  if (meta['og:type']) keyFacts['OG Type'] = meta['og:type']
  if (meta['og:locale']) keyFacts['Locale'] = meta['og:locale']

  return { brandName, url: data.baseUrl, description, entityType, keyFacts }
}

// ── Knowledge check (AI perception vs reality) ────────────────────────

async function checkKnowledge(
  brandName: string,
  selfDescription: string,
  url: string,
): Promise<AgentPOV['knowledge']> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'anthropic-version': '2023-06-01',
  }
  if (process.env.ANTHROPIC_API_KEY) {
    headers['x-api-key'] = process.env.ANTHROPIC_API_KEY
  }

  let aiPerception = ''
  let accuracyIssues: string[] = []
  let knowledgeGaps: string[] = []

  try {
    const res = await fetch(`${ANTHROPIC_BASE}/v1/messages`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 800,
        messages: [{
          role: 'user',
          content: `Describe ${brandName} (${url}) in 2-3 sentences. What do they do? What industry are they in? What are their main products or services? Be specific and factual. If you're not sure about something, say so.`,
        }],
      }),
    })

    if (res.ok) {
      const data = (await res.json()) as any
      aiPerception = data.content?.[0]?.text || ''
    } else {
      aiPerception = `[Could not query AI: ${res.status}]`
    }
  } catch (err: any) {
    aiPerception = `[Error: ${err.message}]`
  }

  // Compare AI perception vs self-description
  if (aiPerception && selfDescription && !aiPerception.startsWith('[')) {
    try {
      const res = await fetch(`${ANTHROPIC_BASE}/v1/messages`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 600,
          messages: [{
            role: 'user',
            content: `Compare these two descriptions of "${brandName}":

WHAT THE WEBSITE SAYS ABOUT ITSELF:
"${selfDescription.slice(0, 500)}"

WHAT AN AI MODEL SAYS:
"${aiPerception.slice(0, 500)}"

List any factual discrepancies, outdated info, or things the AI got wrong. Also list important things the website describes that the AI doesn't know about. Format as JSON: {"accuracyIssues": ["..."], "knowledgeGaps": ["..."]}. If everything matches well, use empty arrays. Return ONLY JSON.`,
          }],
        }),
      })

      if (res.ok) {
        const data = (await res.json()) as any
        const text = data.content?.[0]?.text || '{}'
        try {
          let jsonStr = text.trim()
          if (jsonStr.startsWith('```')) jsonStr = jsonStr.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '')
          const parsed = JSON.parse(jsonStr)
          accuracyIssues = parsed.accuracyIssues || []
          knowledgeGaps = parsed.knowledgeGaps || []
        } catch {}
      }
    } catch {}
  }

  return { selfDescription, aiPerception, accuracyIssues, knowledgeGaps }
}

// ── Actions discovery ─────────────────────────────────────────────────

function discoverActions(data: FetchedData): AgentPOV['actions'] {
  const mcpTools: AgentPOV['actions']['mcpTools'] = []
  const apiEndpoints: AgentPOV['actions']['apiEndpoints'] = []
  const discoveredCapabilities: string[] = []

  // MCP tools
  if (data.mcpJson) {
    try {
      const mcp = JSON.parse(data.mcpJson)
      if (mcp.tools && Array.isArray(mcp.tools)) {
        for (const tool of mcp.tools) {
          mcpTools.push({ name: tool.name || 'unknown', description: tool.description || '' })
        }
        discoveredCapabilities.push(`MCP server with ${mcpTools.length} tool(s)`)
      }
      if (mcp.resources) discoveredCapabilities.push('MCP resources available')
      if (mcp.prompts) discoveredCapabilities.push('MCP prompts available')
    } catch {}
  }

  // AI Plugin / OpenAPI
  if (data.aiPlugin) {
    try {
      const plugin = JSON.parse(data.aiPlugin)
      if (plugin.name_for_model) {
        discoveredCapabilities.push(`AI Plugin: ${plugin.name_for_model} — ${plugin.description_for_model || ''}`)
      }
      if (plugin.api?.url) {
        discoveredCapabilities.push(`OpenAPI spec at: ${plugin.api.url}`)
      }
    } catch {}
  }

  // AGENTS.md instructions
  const agentInstructions = data.agentsMd

  if (agentInstructions) {
    discoveredCapabilities.push('AGENTS.md with agent-specific instructions')
  }

  // Detect interactive elements from HTML
  const html = data.mainPage.body || ''
  if (/<form/i.test(html)) discoveredCapabilities.push('HTML forms detected (potential interaction points)')
  if (/type\s*=\s*["']search["']/i.test(html) || /search/i.test(html.match(/<input[^>]*>/gi)?.join('') || ''))
    discoveredCapabilities.push('Search functionality detected')
  if (/\/api\//i.test(html) || /\/docs\//i.test(html))
    discoveredCapabilities.push('API/documentation links found in page')
  if (data.llmsTxt && /endpoint|api|post|get/i.test(data.llmsTxt))
    discoveredCapabilities.push('API endpoints described in llms.txt')

  if (discoveredCapabilities.length === 0) {
    discoveredCapabilities.push('No agent-discoverable actions found — this site is read-only to agents')
  }

  return { mcpTools, apiEndpoints, agentInstructions, discoveredCapabilities }
}

// ── Content extraction ────────────────────────────────────────────────

function extractContent(data: FetchedData): AgentPOV['content'] {
  const html = data.mainPage.body || ''
  const text = stripHtml(html)
  const jsonLd = extractJsonLd(html)

  // Structured entities
  const allObjects = jsonLd.flatMap((b) =>
    Array.isArray(b['@graph']) ? b['@graph'] : [b],
  )
  const structuredEntities = allObjects
    .filter((o) => o['@type'])
    .map((o) => ({
      type: [o['@type']].flat().join(', '),
      name: o.name || o.headline || undefined,
      properties: Object.keys(o).filter((k) => !k.startsWith('@')),
    }))

  // Key pages from navigation links + llms.txt
  const keyPages: { title: string; url: string }[] = []
  const navLinks = html.match(/<a[^>]+href\s*=\s*["']([^"'#]+)["'][^>]*>([^<]+)<\/a>/gi) || []
  const seen = new Set<string>()
  for (const link of navLinks.slice(0, 50)) {
    const match = link.match(/href\s*=\s*["']([^"'#]+)["'][^>]*>([^<]+)/i)
    if (match?.[1] && match?.[2]) {
      const href = match[1]
      const title = match[2].trim()
      if (title.length > 2 && title.length < 60 && !seen.has(href) && !href.startsWith('javascript')) {
        seen.add(href)
        keyPages.push({ title, url: href })
      }
    }
  }

  // llms.txt summary
  let llmsTxtSummary: string | null = null
  if (data.llmsTxt) {
    const lines = data.llmsTxt.split('\n').slice(0, 10).join('\n')
    llmsTxtSummary = lines.length > 500 ? lines.slice(0, 500) + '...' : lines
  }

  return {
    llmsTxtAvailable: !!data.llmsTxt,
    llmsTxtSummary,
    mainPageExtract: text.slice(0, 2000),
    structuredEntities,
    keyPages: keyPages.slice(0, 20),
    wordCount: text.split(/\s+/).filter((w) => w.length > 0).length,
  }
}

// ── Permissions ───────────────────────────────────────────────────────

function extractPermissions(data: FetchedData): AgentPOV['permissions'] {
  const allowedBots: string[] = []
  const blockedBots: string[] = []
  const restrictedPaths: string[] = []
  let sitemapUrl: string | null = null

  if (data.robotsTxt) {
    const rules = parseRobotsTxt(data.robotsTxt)
    for (const bot of AI_BOTS) {
      if (isAgentBlocked(rules, bot)) {
        blockedBots.push(bot)
      } else {
        allowedBots.push(bot)
      }
    }
    // Extract restricted paths from wildcard rule
    const wildcard = rules.find((r) => r.userAgent === '*')
    if (wildcard) {
      for (const d of wildcard.disallow) {
        if (d && d !== '/') restrictedPaths.push(d)
      }
    }
    // Extract sitemap
    const sitemapMatch = data.robotsTxt.match(/^Sitemap:\s*(\S+)/mi)
    if (sitemapMatch?.[1]) sitemapUrl = sitemapMatch[1]
  } else {
    // No robots.txt = all bots allowed by default
    allowedBots.push(...AI_BOTS)
  }

  return { allowedBots, blockedBots, restrictedPaths, sitemapUrl }
}

// ── Recommendations ───────────────────────────────────────────────────

function generateRecommendations(
  identity: AgentPOV['identity'],
  knowledge: AgentPOV['knowledge'],
  actions: AgentPOV['actions'],
  content: AgentPOV['content'],
  permissions: AgentPOV['permissions'],
): string[] {
  const recs: string[] = []

  if (!content.llmsTxtAvailable) {
    recs.push('Create an /llms.txt file — this is the primary way agents learn about your site. Without it, agents must parse raw HTML.')
  }

  if (actions.mcpTools.length === 0 && actions.apiEndpoints.length === 0 && !actions.agentInstructions) {
    recs.push('Your site has zero agent-discoverable actions. Agents can read your content but cannot interact with your services. Consider adding an MCP server, OpenAPI spec, or AGENTS.md.')
  }

  if (permissions.blockedBots.length > 0) {
    recs.push(`You're blocking ${permissions.blockedBots.length} AI bots (${permissions.blockedBots.slice(0, 3).join(', ')}...). These bots cannot crawl your content at all.`)
  }

  if (content.structuredEntities.length === 0) {
    recs.push('No structured data found. Agents rely on JSON-LD to understand entities, relationships, and facts. Without it, agents must guess what your site is about.')
  }

  if (knowledge.accuracyIssues.length > 0) {
    recs.push(`AI has ${knowledge.accuracyIssues.length} inaccuracy/inaccuracies about your brand. This means agents may give users wrong information about you. Fix by adding authoritative structured data and llms.txt.`)
  }

  if (knowledge.knowledgeGaps.length > 0) {
    recs.push(`AI is missing ${knowledge.knowledgeGaps.length} important thing(s) about your brand. Consider adding these to your llms.txt and structured data.`)
  }

  if (content.wordCount < 300) {
    recs.push('Very little extractable text. Agents see a near-empty page. Add meaningful content that describes your services.')
  }

  if (actions.discoveredCapabilities.length === 1 && actions.discoveredCapabilities[0]?.includes('read-only')) {
    recs.push('From an agent\'s perspective, your site is purely informational. To unlock agent commerce and interaction, expose an API via MCP or OpenAPI.')
  }

  return recs
}

// ── Agent summary (natural language) ──────────────────────────────────

function generateAgentSummary(
  identity: AgentPOV['identity'],
  actions: AgentPOV['actions'],
  content: AgentPOV['content'],
  permissions: AgentPOV['permissions'],
): string {
  const parts: string[] = []

  parts.push(`I'm an AI agent encountering ${identity.brandName} (${identity.url}).`)

  if (content.llmsTxtAvailable) {
    parts.push(`They provide an llms.txt file, so I have a clear overview of what they do.`)
  } else {
    parts.push(`No llms.txt — I have to parse their HTML to understand them.`)
  }

  if (permissions.blockedBots.length > 0) {
    parts.push(`${permissions.blockedBots.length}/${AI_BOTS.length} AI crawlers are blocked.`)
  } else {
    parts.push(`All AI crawlers are welcome.`)
  }

  if (actions.mcpTools.length > 0) {
    parts.push(`I can interact via ${actions.mcpTools.length} MCP tool(s): ${actions.mcpTools.map((t) => t.name).join(', ')}.`)
  } else if (actions.agentInstructions) {
    parts.push(`They have AGENTS.md with instructions for me.`)
  } else {
    parts.push(`I can only read — no APIs, MCP tools, or agent instructions are discoverable.`)
  }

  if (content.structuredEntities.length > 0) {
    parts.push(`I found ${content.structuredEntities.length} structured data entities to understand their business.`)
  } else {
    parts.push(`No structured data — I'm guessing what this site is about from raw text.`)
  }

  const readability = content.wordCount >= 800 ? 'rich content' : content.wordCount >= 300 ? 'moderate content' : 'very little text'
  parts.push(`The page has ${readability} (${content.wordCount} words).`)

  return parts.join(' ')
}

// ── Brand-only POV (no URL) ───────────────────────────────────────────

async function generateBrandOnlyPOV(brand: string): Promise<AgentPOV> {
  const knowledge = await checkKnowledge(brand, '', '')

  const empty: AgentPOV = {
    identity: {
      brandName: brand,
      url: '',
      description: '[No URL provided — brand-only analysis]',
      entityType: 'Unknown',
      keyFacts: {},
    },
    knowledge,
    actions: {
      mcpTools: [],
      apiEndpoints: [],
      agentInstructions: null,
      discoveredCapabilities: ['No URL provided — cannot discover website capabilities'],
    },
    content: {
      llmsTxtAvailable: false,
      llmsTxtSummary: null,
      mainPageExtract: '',
      structuredEntities: [],
      keyPages: [],
      wordCount: 0,
    },
    permissions: {
      allowedBots: [],
      blockedBots: [],
      restrictedPaths: [],
      sitemapUrl: null,
    },
    agentSummary: `I'm an AI agent asked about "${brand}". No website URL was provided, so I can only share what I know from training data. ${knowledge.aiPerception ? 'I do have knowledge about this brand.' : 'I have limited knowledge about this brand.'}`,
    recommendations: [
      'Provide a URL so I can analyze the full website — brand-only analysis is limited to AI training data.',
      ...(knowledge.knowledgeGaps.length > 0
        ? [`AI has knowledge gaps about ${brand}. A website with llms.txt and structured data would fill these.`]
        : []),
    ],
    raw: { llmsTxt: null, agentsMd: null },
    generatedAt: new Date().toISOString(),
  }

  return empty
}

// ── Main POV function ─────────────────────────────────────────────────

export async function generatePOV(url?: string, brand?: string): Promise<AgentPOV> {
  // Brand-only mode (no URL)
  if (!url && brand) {
    return generateBrandOnlyPOV(brand)
  }

  const data = await fetchAllData(url!)

  const identity = extractIdentity(data)
  // Override brand name if explicitly provided
  if (brand) identity.brandName = brand

  const actions = discoverActions(data)
  const content = extractContent(data)
  const permissions = extractPermissions(data)

  // Build self-description from all available sources
  const selfDescription = [
    identity.description,
    content.llmsTxtSummary,
    content.structuredEntities.map((e) => `${e.type}: ${e.name || 'unnamed'}`).join(', '),
  ].filter(Boolean).join(' | ')

  const knowledge = await checkKnowledge(identity.brandName, selfDescription, data.baseUrl)

  const recommendations = generateRecommendations(identity, knowledge, actions, content, permissions)
  const agentSummary = generateAgentSummary(identity, actions, content, permissions)

  return {
    identity,
    knowledge,
    actions,
    content,
    permissions,
    agentSummary,
    recommendations,
    raw: {
      llmsTxt: data.llmsTxt,
      agentsMd: data.agentsMd,
    },
    generatedAt: new Date().toISOString(),
  }
}
