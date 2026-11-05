// Pure helpers for the reading module (shared by main and renderer, unit-tested).
import type { Cefr, Question } from '@shared/content'
import { CEFR_LEVELS } from '@shared/content'
import { countWords } from '@core/text'

/** Comfortable reading speed (words per minute) used for time estimates at each level. */
const LEVEL_WPM: Record<Cefr, number> = { A1: 70, A2: 90, B1: 120, B2: 150, C1: 180, C2: 210 }

export function estimateMinutes(words: number, cefr: Cefr): number {
  return Math.max(1, Math.round(words / LEVEL_WPM[cefr]))
}

/** Target speed the learner can aim for at a level (used to colour WPM results). */
export function targetWpm(cefr: Cefr): number {
  return LEVEL_WPM[cefr]
}

export function splitParagraphs(body: string): string[] {
  return body
    .split(/\n\s*\n|\r?\n/)
    .map((p) => p.trim())
    .filter(Boolean)
}

export function passageWordCount(body: string): number {
  return countWords(body)
}

export interface RecommendCandidate {
  id: string
  cefr: Cefr
  readCount: number
}

/**
 * Picks passages for the learner's reading level: unread passages at the level first, then i+1
 * (one level above), then one level below, then re-reads. Stable order inside each tier.
 */
export function recommendPassages(passages: RecommendCandidate[], level: Cefr, limit = 4): string[] {
  const li = CEFR_LEVELS.indexOf(level)
  const tier = (p: RecommendCandidate): number => {
    const d = CEFR_LEVELS.indexOf(p.cefr) - li
    const base = d === 0 ? 0 : d === 1 ? 1 : d === -1 ? 2 : 3 + Math.abs(d)
    return base + (p.readCount > 0 ? 10 : 0)
  }
  return passages
    .map((p, i) => ({ p, i, t: tier(p) }))
    .filter((x) => x.t < 10 + 2) // never recommend far-off levels that were already read
    .sort((a, b) => a.t - b.t || a.i - b.i)
    .slice(0, limit)
    .map((x) => x.p.id)
}

export function scoreQuiz(
  questions: Pick<Question, 'answerIndex'>[],
  answers: number[],
): { correct: boolean[]; count: number } {
  const correct = questions.map((q, i) => answers[i] === q.answerIndex)
  return { correct, count: correct.filter(Boolean).length }
}

/** Turns a title/topic into an id fragment matching /^[a-z0-9-]+$/. */
export function slugify(s: string, max = 40): string {
  const slug = s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/gi, 'd')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, max)
    .replace(/-+$/g, '')
  return slug || 'passage'
}
