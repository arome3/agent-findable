export type CheckStatus = 'pass' | 'warn' | 'fail'

export interface CheckDetail {
  name: string
  status: CheckStatus
  message: string
  data?: Record<string, unknown>
}

export interface CategoryResult {
  name: string
  weight: number
  score: number
  checks: CheckDetail[]
}

export type LetterGrade =
  | 'A+' | 'A' | 'A-'
  | 'B+' | 'B' | 'B-'
  | 'C+' | 'C' | 'C-'
  | 'D+' | 'D' | 'D-'
  | 'F'

export interface ScanResult {
  url: string
  score: number
  grade: LetterGrade
  summary: string
  categories: CategoryResult[]
  citationTest?: CitationTestResult
  scannedAt: string
}

export interface CitationTestResult {
  brandName: string
  mentionRate: number
  sentiment: 'positive' | 'neutral' | 'negative' | 'unknown'
  queries: CitationQuery[]
}

export interface CitationQuery {
  query: string
  mentioned: boolean
  sentiment: 'positive' | 'neutral' | 'negative'
  excerpt: string
}

export interface CompareResult {
  results: ScanResult[]
  ranking: { url: string; score: number; grade: LetterGrade }[]
  insights: string[]
}

export interface MonitorEntry {
  url: string
  history: { score: number; grade: LetterGrade; scannedAt: string }[]
  trend: 'improving' | 'declining' | 'stable' | 'new'
  latestResult: ScanResult
}

export interface BoostFix {
  priority: number
  category: string
  title: string
  description: string
  effort: 'low' | 'medium' | 'high'
  impact: 'low' | 'medium' | 'high'
}

export interface BoostResult {
  url: string
  fixes: BoostFix[]
  generatedFiles: {
    'llms.txt'?: string
    'robots.txt'?: string
    'AGENTS.md'?: string
    'security.txt'?: string
  }
  scanResult: ScanResult
}

// ── Fetch layer types ─────────────────────────────────────────────────

export interface FetchResult {
  body: string | null
  headers: Record<string, string>
  status: number
  responseTimeMs: number
}

export interface FetchedData {
  llmsTxt: string | null
  llmsFullTxt: string | null
  robotsTxt: string | null
  mainPage: FetchResult
  agentsMd: string | null
  aiPlugin: string | null
  mcpJson: string | null
  sitemap: string | null
  securityTxt: string | null
  baseUrl: string
}
