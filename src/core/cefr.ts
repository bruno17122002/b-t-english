import type { Cefr } from '@shared/content'
import { CEFR_LEVELS } from '@shared/content'

export const cefrIndex = (level: Cefr): number => CEFR_LEVELS.indexOf(level)

export const cefrAt = (index: number): Cefr => CEFR_LEVELS[Math.max(0, Math.min(CEFR_LEVELS.length - 1, index))] as Cefr

export const nextCefr = (level: Cefr): Cefr | null =>
  cefrIndex(level) < CEFR_LEVELS.length - 1 ? cefrAt(cefrIndex(level) + 1) : null

export function minCefr(a: Cefr, b: Cefr): Cefr {
  return cefrIndex(a) <= cefrIndex(b) ? a : b
}

/** Average of several skill levels, rounded down (a learner is B1 overall only when skills are B1 on average). */
export function averageCefr(levels: Cefr[]): Cefr {
  if (levels.length === 0) return 'A1'
  const avg = levels.reduce((s, l) => s + cefrIndex(l), 0) / levels.length
  return cefrAt(Math.floor(avg + 1e-9))
}

/**
 * Approximate cumulative guided learning hours needed to reach each level
 * (Cambridge English guidance: A2 ≈ 180–200 h, B1 ≈ 350–400 h, B2 ≈ 500–600 h,
 * C1 ≈ 700–800 h, C2 ≈ 1000–1200 h). Self-study pace varies; used only for projections.
 */
export const CUMULATIVE_HOURS: Record<Cefr, number> = {
  A1: 90,
  A2: 190,
  B1: 375,
  B2: 550,
  C1: 750,
  C2: 1100,
}

/** Rough IELTS band ↔ CEFR mapping (IELTS 4.0–5.0 ≈ B1, 5.5–6.5 ≈ B2, 7.0–8.0 ≈ C1, 8.5+ ≈ C2). */
export function ieltsToCefr(band: number): Cefr {
  if (band >= 8.5) return 'C2'
  if (band >= 7) return 'C1'
  if (band >= 5.5) return 'B2'
  if (band >= 4) return 'B1'
  if (band >= 3) return 'A2'
  return 'A1'
}

export const SELF_LEVEL_TO_CEFR = {
  beginner: 'A1',
  elementary: 'A2',
  intermediate: 'B1',
  upper: 'B2',
  advanced: 'C1',
} as const satisfies Record<string, Cefr>
export type SelfReportedLevel = keyof typeof SELF_LEVEL_TO_CEFR
