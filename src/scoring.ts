import type { CategoryResult, LetterGrade, ScanResult, CompareResult } from './types'

const GRADE_THRESHOLDS: [number, LetterGrade][] = [
  [97, 'A+'], [93, 'A'], [90, 'A-'],
  [87, 'B+'], [83, 'B'], [80, 'B-'],
  [77, 'C+'], [73, 'C'], [70, 'C-'],
  [67, 'D+'], [63, 'D'], [60, 'D-'],
]

function getGrade(score: number): LetterGrade {
  for (const [threshold, grade] of GRADE_THRESHOLDS) {
    if (score >= threshold) return grade
  }
  return 'F'
}

function generateSummary(
  score: number,
  grade: LetterGrade,
  categories: CategoryResult[],
): string {
  const strong = categories.filter((c) => c.score >= 80).map((c) => c.name)
  const weak = categories.filter((c) => c.score < 50).map((c) => c.name)

  let summary = `Overall score: ${score}/100 (${grade}). `
  if (strong.length) summary += `Strong: ${strong.join(', ')}. `
  if (weak.length) summary += `Needs work: ${weak.join(', ')}.`
  if (!strong.length && !weak.length)
    summary += 'Moderate performance across all categories.'

  return summary.trim()
}

/**
 * Compute weighted score. Normalizes weights to handle optional categories
 * (e.g., when AI Citation test is excluded, remaining weights sum to < 1.0).
 */
export function computeScore(categories: CategoryResult[]): {
  score: number
  grade: LetterGrade
  summary: string
} {
  const totalWeight = categories.reduce((sum, cat) => sum + cat.weight, 0)
  const score = Math.round(
    categories.reduce((sum, cat) => sum + cat.score * cat.weight, 0) / totalWeight,
  )
  const grade = getGrade(score)
  const summary = generateSummary(score, grade, categories)
  return { score, grade, summary }
}

export function buildScanResult(
  url: string,
  categories: CategoryResult[],
): ScanResult {
  const { score, grade, summary } = computeScore(categories)
  return {
    url,
    score,
    grade,
    summary,
    categories,
    scannedAt: new Date().toISOString(),
  }
}

/**
 * Build a comparison report from multiple scan results.
 */
export function buildCompareResult(results: ScanResult[]): CompareResult {
  const ranking = results
    .map((r) => ({ url: r.url, score: r.score, grade: r.grade }))
    .sort((a, b) => b.score - a.score)

  const insights: string[] = []

  if (ranking.length >= 2) {
    const best = ranking[0]!
    const worst = ranking[ranking.length - 1]!
    insights.push(`${best.url} leads with ${best.score}/100 (${best.grade})`)
    insights.push(`${worst.url} trails at ${worst.score}/100 (${worst.grade})`)

    const gap = best.score - worst.score
    if (gap > 30) {
      insights.push(`Large gap of ${gap} points between best and worst — significant competitive advantage`)
    }

    // Find categories where the worst site could improve most
    if (worst.score < best.score) {
      const worstResult = results.find((r) => r.url === worst.url)
      if (worstResult) {
        const weakest = [...worstResult.categories]
          .sort((a, b) => a.score - b.score)
          .slice(0, 3)
          .map((c) => c.name)
        insights.push(`${worst.url} should prioritize: ${weakest.join(', ')}`)
      }
    }

    // Find universally weak categories
    const allCatNames = results[0]!.categories.map((c) => c.name)
    for (const catName of allCatNames) {
      const scores = results.map((r) =>
        r.categories.find((c) => c.name === catName)?.score ?? 0,
      )
      const avg = scores.reduce((a, b) => a + b, 0) / scores.length
      if (avg < 30) {
        insights.push(`"${catName}" is weak across ALL competitors (avg ${Math.round(avg)}/100) — industry-wide gap`)
      }
    }
  }

  return { results, ranking, insights }
}
