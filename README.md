# AgentFindable

**AI Agent Findability & Citability Audit API — powered by MPP**

Most websites are invisible to AI agents. AgentFindable is the first pay-per-request API that audits any website across 13 research-backed categories, detects AI hallucinations about your brand, maps external citation sources, and tests prompt visibility — all without subscriptions or API keys.

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
| `POST /scan` | $0.10 | Full 13-category findability & citability audit |
| `POST /scan` | $0.15 | With live AI citation test (`"citation": true`) |
| `POST /pov` | $0.20 | Agent's Eye View — what AI sees, knows, and can do with your site |
| `POST /hallcheck` | $0.25 | Hallucination detector — ground truth vs AI perception |
| `POST /prompts` | $0.15 | Prompt discovery & batch visibility testing |
| `POST /sources` | $0.20 | External citation source mapping |
| `POST /compare` | $0.50 | Benchmark up to 5 competitors side-by-side |
| `POST /boost` | $0.30 | AI-generated fix guide with ready-to-deploy files |
| `GET /monitor` | Free | Score history & trend tracking |

## What It Audits (13 Categories)

| Category | Weight | What It Checks |
|----------|--------|----------------|
| **Citability & Evidence** | 15% | Statistics, outbound references, Q&A structure, content depth |
| **Freshness Signals** | 12% | Last-Modified header, ETag, datePublished/dateModified schema |
| **AI Citation Reality** | 12% | Live test: does AI mention your brand? (optional) |
| **Structured Data Depth** | 10% | JSON-LD, FAQPage/Article types, E-E-A-T signals, author/dates |
| **Crawlability & Rendering** | 10% | JS framework detection, SSR verification, response time |
| **llms.txt** | 8% | Exists, valid format (H1 + blockquote), links, llms-full.txt |
| **robots.txt AI Bots** | 8% | 14 AI crawlers checked (GPTBot, ClaudeBot, PerplexityBot, etc.) |
| **Content Readability** | 8% | Semantic HTML, meta tags, heading hierarchy, lang attribute |
| **External Citation Signals** | 8% | Reddit presence/sentiment, Wikipedia, review site listings |
| **Agent Protocols** | 5% | AGENTS.md, ai-plugin.json, OpenAPI spec |
| **Security & Trust** | 5% | HTTPS, security.txt, HSTS, security headers |
| **MCP Readiness** | 4% | .well-known/mcp.json manifest |
| **Sitemap** | 3% | /sitemap.xml or robots.txt Sitemap directive |

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

## Example: Hallucination Detector

35% of brands report AI hallucination damage. Find out what AI gets wrong about your brand — before your customers do.

```bash
# Full hallucination check (website ground truth vs AI perception)
tempo request -t -X POST \
  --json '{"url":"https://vercel.com"}' \
  https://lucid-nature-production.up.railway.app/hallcheck

# Brand-only (what AI believes, no ground truth comparison)
tempo request -t -X POST \
  --json '{"brand":"Vercel"}' \
  https://lucid-nature-production.up.railway.app/hallcheck
```

Returns:

```json
{
  "brand": "Vercel",
  "url": "https://vercel.com",
  "groundTruth": {
    "name": "Vercel", "description": "Vercel is the AI Cloud...",
    "products": ["Next.js", "v0", "Vercel AI SDK"], "industry": "..."
  },
  "aiPerception": {
    "description": "Frontend hosting platform...",
    "products": ["Next.js", "Turborepo"]
  },
  "hallucinations": [
    {
      "field": "description", "type": "outdated", "severity": "high",
      "websiteSays": "Vercel is the AI Cloud",
      "aiSays": "Frontend hosting platform"
    }
  ],
  "hallucinationRate": 0.4,
  "riskLevel": "high",
  "verifiedFacts": ["Founding date verified: 2015"],
  "unverifiedClaims": ["AI doesn't know about: v0, Vercel AI SDK"],
  "recommendations": ["Fix 1 high-severity hallucination immediately..."]
}
```

**How it works:** Programmatic Jaccard similarity on descriptions, exact match on dates, set intersection on products — then AI classifies discrepancy type (fabrication, outdated, inaccuracy, omission, confusion) and severity. No "AI judging AI" problem.

## Example: Prompt Discovery & Testing

Discover which real-world prompts surface your brand — and which don't.

```bash
tempo request -t -X POST \
  --json '{"url":"https://stripe.com","industry":"payments"}' \
  https://lucid-nature-production.up.railway.app/prompts
```

Returns:

```json
{
  "brand": "Stripe",
  "mentionRate": 0.72,
  "visibilityScore": 68,
  "prompts": [
    { "prompt": "What is Stripe?", "category": "brand_query", "mentioned": true, "sentiment": "positive" },
    { "prompt": "Best payments tools 2026", "category": "industry_query", "mentioned": true, "sentiment": "positive" },
    { "prompt": "Alternatives to Stripe", "category": "comparison_query", "mentioned": true, "sentiment": "neutral" }
  ],
  "categoryBreakdown": [
    { "category": "brand_query", "promptCount": 3, "mentionCount": 3, "mentionRate": 1.0 },
    { "category": "problem_solving", "promptCount": 2, "mentionCount": 0, "mentionRate": 0.0 }
  ],
  "blindSpots": ["problem_solving: 2 prompts tested, 0 mentions"],
  "strongPrompts": ["What is Stripe?", "Best payments tools 2026"],
  "recommendations": ["You have 1 blind spot category where AI never mentions you..."]
}
```

Tests ~18 prompts across 5 categories (brand, industry, comparison, recommendation, problem-solving) using batch testing (4 per API call) for efficiency.

## Example: External Citation Sources

82% of AI invisibility stems from weak external mentions. Map where AI learns about your brand.

```bash
tempo request -t -X POST \
  --json '{"brand":"Stripe"}' \
  https://lucid-nature-production.up.railway.app/sources
```

Returns:

```json
{
  "brand": "Stripe",
  "sourceMap": [
    { "category": "reddit", "present": true, "confidence": "high", "sentiment": "positive",
      "namedSources": ["r/stripe", "r/webdev", "r/startups"] },
    { "category": "wikipedia", "present": true, "confidence": "high" },
    { "category": "review_sites", "present": true, "confidence": "high",
      "namedSources": ["G2", "Capterra", "TrustPilot"] },
    { "category": "forums", "present": false, "confidence": "medium" }
  ],
  "topInfluencers": ["reddit: Primary driver of AI recommendations", "wikipedia: Authority signal"],
  "citationGaps": ["Limited forum presence outside Reddit"],
  "overallCitationStrength": "strong",
  "recommendations": ["Increase forum presence beyond Reddit..."]
}
```

Reddit drives 46.7% of Perplexity citations. Source mapping shows exactly where to invest.

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
- Reddit drives **46.7%** of Perplexity AI search citations
- **82%** of AI invisibility stems from weak external mentions
- **35%** of brands report hallucination damage from AI systems

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
