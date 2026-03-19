import type { ScanResult, MonitorEntry } from './types'
import { existsSync, mkdirSync } from 'node:fs'
import { readdir } from 'node:fs/promises'

const DATA_DIR = './data/monitors'

function urlToKey(url: string): string {
  return Buffer.from(url).toString('base64url')
}

function ensureDir(): void {
  if (!existsSync(DATA_DIR)) {
    mkdirSync(DATA_DIR, { recursive: true })
  }
}

export async function saveResult(url: string, result: ScanResult): Promise<void> {
  ensureDir()
  const key = urlToKey(url)
  const filePath = `${DATA_DIR}/${key}.json`

  let history: ScanResult[] = []
  try {
    const existing = await Bun.file(filePath).text()
    history = JSON.parse(existing)
  } catch {}

  // Keep last 100 entries
  history.push(result)
  if (history.length > 100) history = history.slice(-100)

  await Bun.write(filePath, JSON.stringify(history, null, 2))
}

export async function getHistory(url: string): Promise<MonitorEntry | null> {
  ensureDir()
  const key = urlToKey(url)
  const filePath = `${DATA_DIR}/${key}.json`

  try {
    const raw = await Bun.file(filePath).text()
    const history: ScanResult[] = JSON.parse(raw)

    if (history.length === 0) return null

    const latest = history[history.length - 1]!
    const scores = history.map((h) => ({
      score: h.score,
      grade: h.grade,
      scannedAt: h.scannedAt,
    }))

    // Compute trend
    let trend: MonitorEntry['trend'] = 'new'
    if (scores.length >= 3) {
      const recent = scores.slice(-3).map((s) => s.score)
      const diff = recent[recent.length - 1]! - recent[0]!
      if (diff > 5) trend = 'improving'
      else if (diff < -5) trend = 'declining'
      else trend = 'stable'
    } else if (scores.length >= 2) {
      const diff = scores[scores.length - 1]!.score - scores[0]!.score
      if (diff > 3) trend = 'improving'
      else if (diff < -3) trend = 'declining'
      else trend = 'stable'
    }

    return { url, history: scores, trend, latestResult: latest }
  } catch {
    return null
  }
}

export async function listMonitored(): Promise<string[]> {
  ensureDir()
  try {
    const files = await readdir(DATA_DIR)
    return files
      .filter((f) => f.endsWith('.json'))
      .map((f) => {
        const key = f.replace('.json', '')
        return Buffer.from(key, 'base64url').toString()
      })
  } catch {
    return []
  }
}
