import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { Mppx, tempo } from 'mppx/server'
import { Mppx as MppxClient, tempo as tempoClient } from 'mppx/client'
import { privateKeyToAccount } from 'viem/accounts'
import { runAllChecks } from './checks'
import { checkAICitation } from './citation'
import { buildScanResult, buildCompareResult } from './scoring'
import { generateBoostReport } from './boost'
import { saveResult, getHistory, listMonitored } from './monitor'
import { normalizeUrl } from './utils'
import { generatePOV } from './pov'
import landingHtml from './landing.html' with { type: 'text' }

// ── USDC on Tempo ─────────────────────────────────────────────────────
const USDC = '0x20c000000000000000000000b9537d11c60e8b50' as const

// ── MPP Server: charge callers ────────────────────────────────────────
const mppx = Mppx.create({
  methods: [
    tempo({
      currency: USDC,
      recipient: process.env.RECIPIENT_ADDRESS as `0x${string}`,
    }),
  ],
  secretKey: process.env.MPP_SECRET_KEY,
})

// ── MPP Client: pay upstream services (Firecrawl, Anthropic) ──────────
if (process.env.MPP_PRIVATE_KEY) {
  MppxClient.create({
    methods: [
      tempoClient({
        account: privateKeyToAccount(
          process.env.MPP_PRIVATE_KEY as `0x${string}`,
        ),
      }),
    ],
  })
}

// ── Hono App ──────────────────────────────────────────────────────────
const app = new Hono()

app.use('*', cors())

// ── GET /ui — Landing Page ────────────────────────────────────────────

app.get('/ui', (c) => {
  return c.html(landingHtml as unknown as string)
})

// ── GET / — Free Discovery ────────────────────────────────────────────

app.get('/', (c) => {
  return c.json({
    name: 'AgentFindable',
    description: 'AI Agent Findability & Citability Audit API — powered by MPP',
    version: '2.0.0',
    endpoints: {
      'GET /': {
        description: 'Service discovery (free)',
        price: '$0.00',
      },
      'GET /llms.txt': {
        description: 'Our llms.txt (free)',
        price: '$0.00',
      },
      'POST /scan': {
        description: 'Full 12-category AI findability & citability audit',
        price: '$0.10 (or $0.15 with AI citation test)',
        input: '{ "url": "https://example.com", "citation?": true }',
        output: '0-100 score, letter grade, 11-12 category breakdowns, citability analysis',
      },
      'POST /compare': {
        description: 'Benchmark up to 5 URLs with competitive insights',
        price: '$0.50',
        input: '{ "urls": ["url1", "url2", ...], "citation?": true }',
        output: 'Ranked comparison with competitive insights',
      },
      'POST /boost': {
        description: 'AI-generated fix guide with ready-to-deploy files',
        price: '$0.30',
        input: '{ "url": "https://example.com", "scan_result?": {...} }',
        output: 'Prioritized fixes + generated llms.txt, robots.txt, AGENTS.md, security.txt',
      },
      'POST /pov': {
        description: "Agent's Eye View — what an AI agent sees, knows, and can do with your site",
        price: '$0.20',
        input: '{ "url?": "https://example.com", "brand?": "Stripe" }',
        output: 'Identity, AI knowledge accuracy check, discoverable actions, content extract, permissions, recommendations',
      },
      'GET /monitor': {
        description: 'Retrieve scan history & score trend for a URL (free)',
        price: '$0.00',
        input: '?url=https://example.com',
        output: 'Score history, trend (improving/declining/stable), latest result',
      },
    },
    categories: [
      'llms.txt (8%)',
      'robots.txt AI Bots (8%)',
      'Content Readability (8%)',
      'Structured Data Depth (10%)',
      'Agent Protocols (5%)',
      'MCP Readiness (4%)',
      'Sitemap (3%)',
      'Freshness Signals (12%)',
      'Citability & Evidence (15%)',
      'Security & Trust (5%)',
      'Crawlability & Rendering (10%)',
      'AI Citation Reality (12%) — optional, live AI query test',
    ],
    researchBacked: [
      'Content with statistics gets 30-40% higher AI visibility',
      'Schema.org markup increases AI citations by 50%',
      'FAQPage schema is the #1 most effective type for AI citations',
      'Last-Modified header is the #1 missing freshness signal (57% of sites)',
      '18.9% of sites are completely invisible to AI crawlers (JS rendering)',
      '93% of AI search sessions end without a website click — visibility IS the product',
    ],
    payment: {
      method: 'MPP (Micropayment Protocol)',
      currency: 'USDC on Tempo',
    },
  })
})

// ── GET /llms.txt ─────────────────────────────────────────────────────

app.get('/llms.txt', (c) => {
  return c.text(`# AgentFindable

> AI Agent Findability & Citability Audit API. Analyzes websites across 12 categories including freshness signals, citability evidence, JS rendering, and live AI citation testing. Powered by MPP micropayments.

## Endpoints

- [POST /scan]: Full 12-category findability audit ($0.10 via MPP, $0.15 with citation test)
- [POST /compare]: Benchmark up to 5 competitors ($0.50 via MPP)
- [POST /boost]: AI-generated fix guide with ready-to-deploy files ($0.30 via MPP)
- [GET /monitor?url=...]: Track score history and trends (free)

## Categories Analyzed (12)

- llms.txt presence, format, and llms-full.txt availability
- robots.txt AI bot permissions (14 bots checked)
- Content readability: semantic HTML, meta tags, language attributes
- Structured data depth: FAQPage, Article, E-E-A-T types, author/date properties
- Agent protocols: AGENTS.md, ai-plugin.json, OpenAPI
- MCP readiness: .well-known/mcp.json
- Sitemap availability and validity
- Freshness signals: Last-Modified header, datePublished/dateModified schema, ETag
- Citability & evidence: statistics, outbound references, Q&A structure, content depth
- Security & trust: HTTPS, security.txt, HSTS, security headers
- Crawlability & rendering: JS framework detection, SSR verification, response time
- AI citation reality: live test of whether AI systems mention your brand

## Research-Backed Scoring

Scoring weights are based on 200+ AI search audits and academic GEO research.

## API Usage

Send a POST request with JSON body containing a "url" field. Payment handled via MPP.
`)
})

// ── POST /scan — Findability Audit ($0.10 / $0.15 with citation) ──────

app.post('/scan', async (c) => {
  try {
    const mppReq = c.req.raw.clone() as unknown as Request
    const body = await c.req.json<{ url: string; citation?: boolean }>()

    if (!body.url) {
      return c.json({ error: 'Missing "url" field' }, 400)
    }

    const withCitation = body.citation === true
    const amount = withCitation ? '0.15' : '0.10'

    const result = await mppx.charge({ amount })(mppReq)
    if (result.status === 402) return result.challenge

    let baseUrl: string
    try {
      baseUrl = normalizeUrl(body.url)
    } catch (e: any) {
      return result.withReceipt(Response.json({ error: e.message }, { status: 400 }))
    }

    // Run 11 sync checks
    const { categories, fetchedData } = await runAllChecks(baseUrl)

    // Optional AI citation test
    let citationTest = undefined
    if (withCitation) {
      try {
        const citation = await checkAICitation(baseUrl, fetchedData.mainPage.body)
        categories.push(citation.category)
        citationTest = citation.citationTest
      } catch (err: any) {
        console.error(`Citation test error: ${err.message}`)
      }
    }

    const scanResult = buildScanResult(baseUrl, categories)
    if (citationTest) scanResult.citationTest = citationTest

    // Auto-save to monitor history
    saveResult(baseUrl, scanResult).catch(() => {})

    return result.withReceipt(Response.json(scanResult))
  } catch (error: any) {
    return Response.json({ error: error.message || 'Internal server error' }, { status: 500 })
  }
})

// ── POST /compare — Competitive Benchmark ($0.50) ─────────────────────

app.post('/compare', async (c) => {
  try {
    const mppReq = c.req.raw.clone() as unknown as Request
    const body = await c.req.json<{ urls: string[]; citation?: boolean }>()

    if (!body.urls || !Array.isArray(body.urls) || body.urls.length < 2) {
      return c.json({ error: 'Need at least 2 URLs in "urls" array' }, 400)
    }
    if (body.urls.length > 5) {
      return c.json({ error: 'Maximum 5 URLs per comparison' }, 400)
    }

    const result = await mppx.charge({ amount: '0.50' })(mppReq)
    if (result.status === 402) return result.challenge

    // Normalize all URLs
    let normalizedUrls: string[]
    try {
      normalizedUrls = body.urls.map(normalizeUrl)
    } catch (e: any) {
      return result.withReceipt(Response.json({ error: e.message }, { status: 400 }))
    }

    // Run scans in parallel
    const scanPromises = normalizedUrls.map(async (url) => {
      const { categories, fetchedData } = await runAllChecks(url)

      if (body.citation) {
        try {
          const citation = await checkAICitation(url, fetchedData.mainPage.body)
          categories.push(citation.category)
          const scanResult = buildScanResult(url, categories)
          scanResult.citationTest = citation.citationTest
          return scanResult
        } catch {}
      }

      return buildScanResult(url, categories)
    })

    const results = await Promise.all(scanPromises)

    // Save all to monitor
    for (const r of results) {
      saveResult(r.url, r).catch(() => {})
    }

    const compareResult = buildCompareResult(results)

    return result.withReceipt(Response.json(compareResult))
  } catch (error: any) {
    return Response.json({ error: error.message || 'Internal server error' }, { status: 500 })
  }
})

// ── POST /boost — AI Fix Guide ($0.30) ────────────────────────────────

app.post('/boost', async (c) => {
  try {
    const mppReq = c.req.raw.clone() as unknown as Request
    const body = await c.req.json<{ url: string; scan_result?: any }>()

    if (!body.url) {
      return c.json({ error: 'Missing "url" field' }, 400)
    }

    const result = await mppx.charge({ amount: '0.30' })(mppReq)
    if (result.status === 402) return result.challenge

    let baseUrl: string
    try {
      baseUrl = normalizeUrl(body.url)
    } catch (e: any) {
      return result.withReceipt(Response.json({ error: e.message }, { status: 400 }))
    }

    // Use provided scan_result or run a fresh scan
    let scanResult = body.scan_result
    if (!scanResult) {
      const { categories } = await runAllChecks(baseUrl)
      scanResult = buildScanResult(baseUrl, categories)
    }

    const boostResult = await generateBoostReport(baseUrl, scanResult)

    return result.withReceipt(Response.json(boostResult))
  } catch (error: any) {
    return Response.json({ error: error.message || 'Internal server error' }, { status: 500 })
  }
})

// ── POST /pov — Agent's Eye View ($0.20) ──────────────────────────────

app.post('/pov', async (c) => {
  try {
    const mppReq = c.req.raw.clone() as unknown as Request
    const body = await c.req.json<{ url?: string; brand?: string }>()

    if (!body.url && !body.brand) {
      return c.json({ error: 'Provide "url" and/or "brand" field' }, 400)
    }

    const result = await mppx.charge({ amount: '0.20' })(mppReq)
    if (result.status === 402) return result.challenge

    let baseUrl: string | undefined
    if (body.url) {
      try {
        baseUrl = normalizeUrl(body.url)
      } catch (e: any) {
        return result.withReceipt(Response.json({ error: e.message }, { status: 400 }))
      }
    }

    const pov = await generatePOV(baseUrl, body.brand)

    return result.withReceipt(Response.json(pov))
  } catch (error: any) {
    return Response.json({ error: error.message || 'Internal server error' }, { status: 500 })
  }
})

// ── GET /monitor — Score History & Trend (free) ───────────────────────

app.get('/monitor', async (c) => {
  const url = c.req.query('url')

  if (!url) {
    // List all monitored URLs
    const urls = await listMonitored()
    return c.json({ monitored: urls, count: urls.length })
  }

  try {
    const baseUrl = normalizeUrl(url)
    const entry = await getHistory(baseUrl)

    if (!entry) {
      return c.json({ error: 'No scan history for this URL. Run a /scan first.' }, 404)
    }

    return c.json(entry)
  } catch (e: any) {
    return c.json({ error: e.message }, 400)
  }
})

// ── Start Server ──────────────────────────────────────────────────────
const port = Number(process.env.PORT || 3000)

export default {
  port,
  fetch: app.fetch,
}

console.log(`AgentFindable v2 running on http://localhost:${port}`)
console.log(`  GET  /           — Service discovery (free)`)
console.log(`  GET  /llms.txt   — Our llms.txt (free)`)
console.log(`  POST /scan       — 12-category audit ($0.10 / $0.15 with citation)`)
console.log(`  POST /compare    — Competitive benchmark ($0.50, up to 5 URLs)`)
console.log(`  POST /boost      — AI fix guide ($0.30)`)
console.log(`  GET  /monitor    — Score history & trend (free)`)
