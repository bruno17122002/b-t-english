// FSRS-5 spaced repetition scheduler.
// Formulas follow the published FSRS-5 algorithm (open-spaced-repetition/fsrs4anki wiki,
// "The Algorithm"), using its 19 default parameters trained on ~20k Anki collections.

export type Rating = 1 | 2 | 3 | 4 // Again, Hard, Good, Easy
export type CardState = 'new' | 'learning' | 'review' | 'relearning'

export interface CardMemory {
  state: CardState
  stability: number // days until retrievability falls to 90 %
  difficulty: number // 1 (easy) .. 10 (hard)
  reps: number
  lapses: number
  lastReviewAt: string | null // ISO timestamp
  dueAt: string // ISO timestamp
  scheduledDays: number
}

export const FSRS5_DEFAULT_WEIGHTS = [
  0.4072, 1.1829, 3.1262, 15.4722, 7.2102, 0.5316, 1.0651, 0.0234, 1.616, 0.1544, 1.0824, 1.9813, 0.0953, 0.2975,
  2.2042, 0.2407, 2.9466, 0.5034, 0.6567,
] as const

const DECAY = -0.5
const FACTOR = 19 / 81 // chosen so that R(S, S) = 0.9
const DAY_MS = 86_400_000
const MIN_STABILITY = 0.01

export interface SchedulerOptions {
  requestRetention?: number // desired probability of recall at review time
  maximumInterval?: number // days
  weights?: readonly number[]
  /** Short learning steps (minutes) for new / lapsed cards before they graduate to day intervals. */
  learningStepsMinutes?: { again: number; hard: number }
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))

export function newCard(now: Date): CardMemory {
  return {
    state: 'new',
    stability: 0,
    difficulty: 0,
    reps: 0,
    lapses: 0,
    lastReviewAt: null,
    dueAt: now.toISOString(),
    scheduledDays: 0,
  }
}

export function retrievability(elapsedDays: number, stability: number): number {
  if (stability <= 0) return 0
  return Math.pow(1 + (FACTOR * Math.max(0, elapsedDays)) / stability, DECAY)
}

export class FsrsScheduler {
  private readonly w: readonly number[]
  private readonly retention: number
  private readonly maxInterval: number
  private readonly steps: { again: number; hard: number }

  constructor(opts: SchedulerOptions = {}) {
    this.w = opts.weights ?? FSRS5_DEFAULT_WEIGHTS
    if (this.w.length !== 19) throw new Error('FSRS-5 requires 19 weights')
    this.retention = clamp(opts.requestRetention ?? 0.9, 0.7, 0.99)
    this.maxInterval = opts.maximumInterval ?? 36500
    this.steps = opts.learningStepsMinutes ?? { again: 1, hard: 6 }
  }

  private wi(i: number): number {
    return this.w[i] as number
  }

  initStability(r: Rating): number {
    return Math.max(this.wi(r - 1), MIN_STABILITY)
  }

  initDifficulty(r: Rating): number {
    return clamp(this.wi(4) - Math.exp(this.wi(5) * (r - 1)) + 1, 1, 10)
  }

  nextDifficulty(d: number, r: Rating): number {
    const delta = -this.wi(6) * (r - 3)
    const damped = d + (delta * (10 - d)) / 9 // linear damping (FSRS-5)
    const reverted = this.wi(7) * this.initDifficulty(4) + (1 - this.wi(7)) * damped // mean reversion
    return clamp(reverted, 1, 10)
  }

  nextRecallStability(d: number, s: number, r: number, rating: Rating): number {
    const hardPenalty = rating === 2 ? this.wi(15) : 1
    const easyBonus = rating === 4 ? this.wi(16) : 1
    return (
      s *
      (1 +
        Math.exp(this.wi(8)) *
          (11 - d) *
          Math.pow(s, -this.wi(9)) *
          (Math.exp(this.wi(10) * (1 - r)) - 1) *
          hardPenalty *
          easyBonus)
    )
  }

  nextForgetStability(d: number, s: number, r: number): number {
    const sf =
      this.wi(11) * Math.pow(d, -this.wi(12)) * (Math.pow(s + 1, this.wi(13)) - 1) * Math.exp(this.wi(14) * (1 - r))
    return Math.max(MIN_STABILITY, Math.min(sf, s))
  }

  shortTermStability(s: number, rating: Rating): number {
    return Math.max(MIN_STABILITY, s * Math.exp(this.wi(17) * (rating - 3 + this.wi(18))))
  }

  /** Interval in whole days that yields the requested retention for stability s. */
  nextInterval(s: number): number {
    const interval = (s / FACTOR) * (Math.pow(this.retention, 1 / DECAY) - 1)
    return clamp(Math.round(interval), 1, this.maxInterval)
  }

  review(card: CardMemory, rating: Rating, now: Date): CardMemory {
    const elapsedDays = card.lastReviewAt
      ? Math.max(0, (now.getTime() - new Date(card.lastReviewAt).getTime()) / DAY_MS)
      : 0
    let { stability, difficulty, lapses } = card
    let state: CardState

    if (card.state === 'new' || card.reps === 0) {
      stability = this.initStability(rating)
      difficulty = this.initDifficulty(rating)
    } else if (elapsedDays < 1) {
      // Same-day review: short-term stability update, difficulty still moves.
      stability = this.shortTermStability(stability, rating)
      difficulty = this.nextDifficulty(difficulty, rating)
    } else {
      const r = retrievability(elapsedDays, stability)
      difficulty = this.nextDifficulty(difficulty, rating)
      stability =
        rating === 1
          ? this.nextForgetStability(card.difficulty, stability, r)
          : this.nextRecallStability(card.difficulty, stability, r, rating)
    }

    let dueMs: number
    let scheduledDays = 0
    if (rating === 1) {
      if (card.state === 'review') lapses += 1
      state = card.state === 'new' || card.state === 'learning' ? 'learning' : 'relearning'
      dueMs = now.getTime() + this.steps.again * 60_000
    } else if (rating === 2 && (card.state === 'new' || card.state === 'learning' || card.state === 'relearning')) {
      state = card.state === 'relearning' ? 'relearning' : 'learning'
      dueMs = now.getTime() + this.steps.hard * 60_000
    } else {
      state = 'review'
      scheduledDays = this.nextInterval(stability)
      dueMs = now.getTime() + scheduledDays * DAY_MS
    }

    return {
      state,
      stability,
      difficulty,
      reps: card.reps + 1,
      lapses,
      lastReviewAt: now.toISOString(),
      dueAt: new Date(dueMs).toISOString(),
      scheduledDays,
    }
  }

  /** Preview the next due interval for each rating – shown on flashcard buttons. */
  preview(card: CardMemory, now: Date): Record<Rating, { dueAt: string; label: string }> {
    const out = {} as Record<Rating, { dueAt: string; label: string }>
    for (const r of [1, 2, 3, 4] as Rating[]) {
      const next = this.review(card, r, now)
      out[r] = { dueAt: next.dueAt, label: formatInterval(new Date(next.dueAt).getTime() - now.getTime()) }
    }
    return out
  }

  /** Current probability of recall – used for "memory strength" display. */
  currentRetrievability(card: CardMemory, now: Date): number {
    if (!card.lastReviewAt || card.stability <= 0) return 0
    const days = (now.getTime() - new Date(card.lastReviewAt).getTime()) / DAY_MS
    return retrievability(days, card.stability)
  }
}

export function formatInterval(ms: number): string {
  const min = Math.round(ms / 60_000)
  if (min < 60) return `${Math.max(1, min)}m`
  const hours = Math.round(min / 60)
  if (hours < 24) return `${hours}h`
  const days = Math.round(hours / 24)
  if (days < 31) return `${days}d`
  const months = Math.round(days / 30)
  if (months < 12) return `${months}mo`
  return `${(days / 365).toFixed(1)}y`
}
