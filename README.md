# AgentFindable

**AI Agent Findability & Citability Audit API — powered by MPP**

Most websites are invisible to AI agents. AgentFindable is the first pay-per-request API that audits any website across 12 research-backed categories and tells you exactly what to fix.

**Live API:** `https://lucid-nature-production.up.railway.app`

## Quick Start

```bash
# 1. Install Tempo CLI
curl -sSL https://tempo.xyz/install | bash

# 2. Fund your wallet
tempo wallet login
tempo wallet fund

# 3. Scan any website ($0.10)
tempo request -t -X POST \
  --json '{"url":"https://example.com"}' \
  https://lucid-nature-production.up.railway.app/scan
```

## Endpoints

| Endpoint | Price | Description |
|----------|-------|-------------|
| `GET /` | Free | Service discovery — returns API metadata |
| `GET /llms.txt` | Free | Our own llms.txt for AI agent discovery |
| `POST /scan` | $0.10 | Full 12-category findability & citability audit |
| `POST /scan` | $0.15 | With live AI citation test (`"citation": true`) |
| `POST /pov` | $0.20 | Agent's Eye View — what AI sees, knows, and can do with your site |
| `POST /compare` | $0.50 | Benchmark up to 5 competitors side-by-side |
| `POST /boost` | $0.30 | AI-generated fix guide with ready-to-deploy files |
| `GET /monitor` | Free | Score history & trend tracking |

## What It Audits (12 Categories)

| Category | Weight | What It Checks |
|----------|--------|----------------|
| **llms.txt** | 8% | Exists, valid format (H1 + blockquote), links, llms-full.txt |
| **robots.txt AI Bots** | 8% | 14 AI crawlers checked (GPTBot, ClaudeBot, PerplexityBot, etc.) |
| **Content Readability** | 8% | Semantic HTML, meta tags, heading hierarchy, lang attribute |
| **Structured Data Depth** | 10% | JSON-LD, FAQPage/Article types, E-E-A-T signals, author/dates |
| **Agent Protocols** | 5% | AGENTS.md, ai-plugin.json, OpenAPI spec |
| **MCP Readiness** | 4% | .well-known/mcp.json manifest |
| **Sitemap** | 3% | /sitemap.xml or robots.txt Sitemap directive |
| **Freshness Signals** | 12% | Last-Modified header, ETag, datePublished/dateModified schema |
| **Citability & Evidence** | 15% | Statistics, outbound references, Q&A structure, content depth |
| **Security & Trust** | 5% | HTTPS, security.txt, HSTS, security headers |
| **Crawlability & Rendering** | 10% | JS framework detection, SSR verification, response time |
| **AI Citation Reality** | 12% | Live test: does AI mention your brand? (optional) |

## Example: Scan

```bash
tempo request -t -X POST \
  --json '{"url":"https://stripe.com"}' \
  https://lucid-nature-production.up.railway.app/scan
```

Returns:

```json
{
  "url": "https://stripe.com",
  "score": 77,
  "grade": "C+",
  "summary": "Overall score: 77/100 (C+). Strong: llms.txt, robots.txt AI Bots...",
  "categories": [ ... ],
  "scannedAt": "2026-03-19T18:53:39.649Z"
}
```

## Example: Compare Competitors

```bash
tempo request -t -X POST \
  --json '{"urls":["https://stripe.com","https://anthropic.com","https://vercel.com"]}' \
  https://lucid-nature-production.up.railway.app/compare
```

Returns ranked comparison with auto-generated competitive insights:

```json
{
  "ranking": [
    { "url": "https://stripe.com", "score": 77, "grade": "C+" },
    { "url": "https://vercel.com", "score": 60, "grade": "D-" },
    { "url": "https://anthropic.com", "score": 57, "grade": "F" }
  ],
  "insights": [
    "\"Structured Data Depth\" is weak across ALL competitors (avg 27/100) — industry-wide gap",
    "\"MCP Readiness\" is weak across ALL competitors (avg 0/100) — industry-wide gap"
  ]
}
```

## Example: Agent's Eye View (POV)

See what an AI agent actually experiences when it encounters your site — or just check what AI knows about your brand.

```bash
# Full website analysis
tempo request -t -X POST \
  --json '{"url":"https://vercel.com"}' \
  https://lucid-nature-production.up.railway.app/pov

# Brand-only (no URL needed)
tempo request -t -X POST \
  --json '{"brand":"OpenAI"}' \
  https://lucid-nature-production.up.railway.app/pov

# Both (URL crawl + explicit brand name)
tempo request -t -X POST \
  --json '{"url":"https://vercel.com","brand":"Vercel"}' \
  https://lucid-nature-production.up.railway.app/pov
```

Returns:

```json
{
  "identity": { "brandName": "Vercel", "description": "...", "entityType": "...", "keyFacts": {} },
  "knowledge": {
    "selfDescription": "Vercel is the AI Cloud...",
    "aiPerception": "Vercel is a frontend hosting platform...",
    "accuracyIssues": ["AI describes Vercel as frontend hosting but they've rebranded to 'AI Cloud'"],
    "knowledgeGaps": ["AI focus", "Agentic workloads", "Agent skills/plugins"]
  },
  "actions": { "mcpTools": [], "discoveredCapabilities": ["AGENTS.md with agent-specific instructions"] },
  "content": { "llmsTxtAvailable": true, "structuredEntities": [...], "wordCount": 668 },
  "permissions": { "allowedBots": ["GPTBot", "ClaudeBot", ...], "blockedBots": [] },
  "agentSummary": "I'm an AI agent encountering Vercel. They provide an llms.txt file...",
  "recommendations": ["Add MCP server manifest", "Add structured data"]
}
```

## Example: Monitor Over Time

```bash
# Free — check score history
curl "https://lucid-nature-production.up.railway.app/monitor?url=https://stripe.com"
```

```json
{
  "url": "https://stripe.com",
  "history": [
    { "score": 69, "grade": "D+", "scannedAt": "2026-03-19T18:38:23Z" },
    { "score": 77, "grade": "C+", "scannedAt": "2026-03-19T18:53:39Z" }
  ],
  "trend": "improving"
}
```

## How Payment Works

When you hit any paid endpoint, the server returns `402 Payment Required` with an MPP challenge. Your Tempo wallet or mppx client automatically pays in USDC on the Tempo blockchain (~500ms finality), then retries the request with a payment proof.

You only pay for what you use. No subscriptions, no API keys, no accounts.

## Research Behind the Scoring

Scoring weights are calibrated against real-world data:

- Content with statistics gets **30-40% higher** AI visibility
- Pages with Schema.org markup get **50% more** AI citations
- FAQPage schema is the **#1 most effective** type for AI citations
- `Last-Modified` header is the **#1 missing** freshness signal (57% of sites)
- **18.9%** of sites are completely invisible to AI crawlers due to JS rendering
- **93%** of AI search sessions end without a click — visibility IS the product

Sources: [ALM Corp 200+ audit study](https://almcorp.com/blog/ai-search-audit-findings-website-visibility/), [GEO research (arXiv)](https://arxiv.org/pdf/2311.09735), [Schema.org citation data](https://dev.to/wilow445/schemaorg-is-your-secret-weapon-for-ai-citations-heres-the-data-1if3)

## Self-Hosting

```bash
git clone <repo>
cd agentfindable
bun install

# Configure .env
cp .env.example .env
# Set RECIPIENT_ADDRESS, MPP_PRIVATE_KEY, MPP_SECRET_KEY
# Get wallet info: tempo wallet -t whoami

bun run src/index.ts
```

## Tech Stack

- **Hono** — multi-runtime web framework
- **mppx** — MPP payment SDK (server + client)
- **Bun** — JavaScript runtime
- **viem** — Ethereum/Tempo wallet utilities

## License

MIT
