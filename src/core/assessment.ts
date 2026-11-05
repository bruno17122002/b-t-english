// Adaptive placement test (one staircase per skill) and CEFR estimation.
import type { AssessmentItem, Cefr } from '@shared/content'
import { CEFR_LEVELS } from '@shared/content'
import { cefrAt, cefrIndex } from './cefr'

export const ITEMS_PER_SKILL = 6

export interface AnsweredItem {
  itemId: string
  cefr: Cefr
  correct: boolean
}

/**
 * Next item for a skill: start at `startLevel`, move one level up after a correct answer
 * and one level down after a wrong one (a simple up/down staircase), never repeating items.
 * Returns null when the skill is finished.
 */
export function nextAssessmentItem(
  bank: AssessmentItem[],
  answered: AnsweredItem[],
  startLevel: Cefr,
  maxItems = ITEMS_PER_SKILL,
): AssessmentItem | null {
  if (answered.length >= maxItems) return null
  const used = new Set(answered.map((a) => a.itemId))
  let target = cefrIndex(startLevel)
  const last = answered[answered.length - 1]
  if (last) target = cefrIndex(last.cefr) + (last.correct ? 1 : -1)
  target = Math.max(0, Math.min(CEFR_LEVELS.length - 1, target))
  // Search outward from the target level for an unused item.
  for (let dist = 0; dist < CEFR_LEVELS.length; dist++) {
    for (const idx of dist === 0 ? [target] : [target - dist, target + dist]) {
      if (idx < 0 || idx >= CEFR_LEVELS.length) continue
      const candidate = bank.find((i) => i.cefr === cefrAt(idx) && !used.has(i.id))
      if (candidate) return candidate
    }
  }
  return null
}

/**
 * Estimated level = highest level where the learner answered correctly and was right at least
 * half the time; levels below a demonstrated level are assumed mastered. Score (0–100) expresses
 * how secure the learner is inside that level.
 */
export function estimateLevel(answered: AnsweredItem[]): {
  cefr: Cefr
  score: number
  correct: number
  answered: number
} {
  const correct = answered.filter((a) => a.correct).length
  if (answered.length === 0) return { cefr: 'A1', score: 0, correct: 0, answered: 0 }
  let best = -1
  let bestAccuracy = 0
  for (let i = 0; i < CEFR_LEVELS.length; i++) {
    const atLevel = answered.filter((a) => cefrIndex(a.cefr) === i)
    const ok = atLevel.filter((a) => a.correct).length
    if (ok > 0 && ok / atLevel.length >= 0.5) {
      best = i
      bestAccuracy = ok / atLevel.length
    }
  }
  if (best < 0)
    return { cefr: 'A1', score: Math.round((correct / answered.length) * 50), correct, answered: answered.length }
  // Being right one level above would have promoted; failing above lowers confidence.
  const above = answered.filter((a) => cefrIndex(a.cefr) === best + 1)
  const aboveOk = above.filter((a) => a.correct).length
  const score = Math.round(Math.min(100, bestAccuracy * 70 + (above.length ? (aboveOk / above.length) * 30 : 15)))
  return { cefr: cefrAt(best), score, correct, answered: answered.length }
}
