// Spaced repetition scheduler. A thin adapter over ts-fsrs (MIT, open-spaced-repetition) that keeps
// the plain-data CardMemory shape stored in SQLite and the API the rest of the app already uses.
import {
  createEmptyCard,
  default_w,
  fsrs,
  generatorParameters,
  State,
  type Card,
  type FSRS,
  type Grade,
} from 'ts-fsrs'

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
  /** Position inside the short (re)learning steps; 0 once graduated. */
  learningSteps?: number
}

export interface SchedulerOptions {
  requestRetention?: number // desired probability of recall at review time
  maximumInterval?: number // days
  /** Short learning steps before a new card graduates to day intervals. */
  learningSteps?: `${number}m`[]
  relearningSteps?: `${number}m`[]
}

const DAY_MS = 86_400_000
const STATE_TO_LIB: Record<CardState, State> = {
  new: State.New,
  learning: State.Learning,
  review: State.Review,
  relearning: State.Relearning,
}
const STATE_FROM_LIB: Record<State, CardState> = {
  [State.New]: 'new',
  [State.Learning]: 'learning',
  [State.Review]: 'review',
  [State.Relearning]: 'relearning',
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))

function toLib(card: CardMemory): Card {
  return {
    due: new Date(card.dueAt),
    stability: card.stability,
    difficulty: card.difficulty,
    scheduled_days: card.scheduledDays,
    learning_steps: card.learningSteps ?? 0,
    reps: card.reps,
    lapses: card.lapses,
    state: STATE_TO_LIB[card.state],
    ...(card.lastReviewAt ? { last_review: new Date(card.lastReviewAt) } : {}),
  }
}

function fromLib(card: Card): CardMemory {
  return {
    state: STATE_FROM_LIB[card.state],
    stability: card.stability,
    difficulty: card.difficulty,
    reps: card.reps,
    lapses: card.lapses,
    lastReviewAt: card.last_review ? card.last_review.toISOString() : null,
    dueAt: card.due.toISOString(),
    scheduledDays: card.scheduled_days,
    learningSteps: card.learning_steps,
  }
}

export function newCard(now: Date): CardMemory {
  return fromLib(createEmptyCard(now))
}

// FSRS-6 forgetting curve: R(t, S) = (1 + factor * t / S) ^ -w20, with factor chosen so R(S, S) = 0.9.
const DECAY = -(default_w[20] ?? 0.1542)
const FACTOR = Math.pow(0.9, 1 / DECAY) - 1

/** Probability of recall after `elapsedDays` for a memory of the given stability. */
export function retrievability(elapsedDays: number, stability: number): number {
  if (stability <= 0) return 0
  return Math.pow(1 + (FACTOR * Math.max(0, elapsedDays)) / stability, DECAY)
}

export class FsrsScheduler {
  private readonly engine: FSRS

  constructor(opts: SchedulerOptions = {}) {
    this.engine = fsrs(
      generatorParameters({
        request_retention: clamp(opts.requestRetention ?? 0.9, 0.7, 0.99),
        maximum_interval: opts.maximumInterval ?? 36500,
        enable_fuzz: false, // deterministic intervals: easier to explain to the learner and to test
        enable_short_term: true,
        learning_steps: opts.learningSteps ?? ['1m', '10m'],
        relearning_steps: opts.relearningSteps ?? ['10m'],
      }),
    )
  }

  review(card: CardMemory, rating: Rating, now: Date): CardMemory {
    return fromLib(this.engine.next(toLib(card), now, rating as Grade).card)
  }

  /** Preview the next due interval for each rating – shown on flashcard buttons. */
  preview(card: CardMemory, now: Date): Record<Rating, { dueAt: string; label: string }> {
    const out = {} as Record<Rating, { dueAt: string; label: string }>
    const all = this.engine.repeat(toLib(card), now)
    for (const r of [1, 2, 3, 4] as Rating[]) {
      const due = all[r as Grade].card.due
      out[r] = { dueAt: due.toISOString(), label: formatInterval(due.getTime() - now.getTime()) }
    }
    return out
  }

  /** Current probability of recall – used for "memory strength" display. */
  currentRetrievability(card: CardMemory, now: Date): number {
    if (!card.lastReviewAt || card.stability <= 0 || card.state === 'new') return 0
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
