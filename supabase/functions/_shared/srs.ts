// FSRS scheduling on the synced review_schedules rows (local column names), with exactly the parameters of the
// desktop FsrsScheduler (src/core/srs.ts): retention 0.9, no fuzz, short-term steps 1m/10m, relearning 10m.
// 'ts-fsrs' resolves from node_modules in Node/Vitest and through each function's deno.json import map in Deno.
import { createEmptyCard, fsrs, generatorParameters, State, type Card, type FSRS, type Grade } from 'ts-fsrs'

export type Rating = 1 | 2 | 3 | 4
export type CardState = 'new' | 'learning' | 'review' | 'relearning'

/** review_schedules row as stored by the desktop (plus word_key added for sync). */
export interface ScheduleRow {
  vocab_id?: number | null
  word_key: string
  state: CardState
  due_at: string
  stability: number
  difficulty: number
  reps: number
  lapses: number
  scheduled_days: number
  last_review_at: string | null
  learning_steps?: number
  [extra: string]: unknown
}

const TO_LIB: Record<CardState, State> = {
  new: State.New,
  learning: State.Learning,
  review: State.Review,
  relearning: State.Relearning,
}
const FROM_LIB: Record<State, CardState> = {
  [State.New]: 'new',
  [State.Learning]: 'learning',
  [State.Review]: 'review',
  [State.Relearning]: 'relearning',
}

let engine: FSRS | null = null
function scheduler(): FSRS {
  engine ??= fsrs(
    generatorParameters({
      request_retention: 0.9,
      maximum_interval: 36500,
      enable_fuzz: false,
      enable_short_term: true,
      learning_steps: ['1m', '10m'],
      relearning_steps: ['10m'],
    }),
  )
  return engine
}

const num = (v: unknown, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : Number(v) || d)

function toLib(row: ScheduleRow): Card {
  const state = TO_LIB[row.state] ?? State.New
  return {
    due: new Date(row.due_at),
    stability: num(row.stability),
    difficulty: num(row.difficulty),
    scheduled_days: num(row.scheduled_days),
    learning_steps: num(row.learning_steps),
    reps: num(row.reps),
    lapses: num(row.lapses),
    state,
    ...(row.last_review_at ? { last_review: new Date(row.last_review_at) } : {}),
  } as Card
}

/** A fresh schedule row for a newly saved word (due now). */
export function newScheduleRow(wordKey: string, now: Date): ScheduleRow {
  const c = createEmptyCard(now)
  return {
    vocab_id: null,
    word_key: wordKey,
    state: 'new',
    due_at: c.due.toISOString(),
    stability: c.stability,
    difficulty: c.difficulty,
    reps: c.reps,
    lapses: c.lapses,
    scheduled_days: c.scheduled_days,
    last_review_at: null,
    learning_steps: c.learning_steps,
  }
}

export interface ReviewResult {
  next: ScheduleRow
  /** review_logs columns (without id / vocab mapping). */
  log: {
    rating: Rating
    state_before: CardState
    elapsed_days: number
    scheduled_days: number
    duration_ms: number
    reviewed_at: string
  }
}

/** Applies a rating; keeps every extra column of the stored row (vocab_id, word_key…). */
export function reviewRow(row: ScheduleRow, rating: Rating, now: Date, durationMs = 0): ReviewResult {
  const card = scheduler().next(toLib(row), now, rating as Grade).card
  const elapsed = row.last_review_at ? (now.getTime() - new Date(row.last_review_at).getTime()) / 86_400_000 : 0
  const next: ScheduleRow = {
    ...row,
    state: FROM_LIB[card.state],
    due_at: card.due.toISOString(),
    stability: card.stability,
    difficulty: card.difficulty,
    reps: card.reps,
    lapses: card.lapses,
    scheduled_days: card.scheduled_days,
    last_review_at: card.last_review ? card.last_review.toISOString() : now.toISOString(),
    learning_steps: card.learning_steps,
  }
  return {
    next,
    log: {
      rating,
      state_before: row.state,
      elapsed_days: Math.max(0, elapsed),
      scheduled_days: card.scheduled_days,
      duration_ms: Math.max(0, Math.round(durationMs)),
      reviewed_at: now.toISOString(),
    },
  }
}

/** Interval labels for the four rating buttons ("1m", "10m", "3d"…). */
export function previewRow(row: ScheduleRow, now: Date): Record<Rating, string> {
  const all = scheduler().repeat(toLib(row), now)
  const out = {} as Record<Rating, string>
  for (const r of [1, 2, 3, 4] as Rating[]) out[r] = formatInterval(all[r as Grade].card.due.getTime() - now.getTime())
  return out
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

export function isDue(row: ScheduleRow, now: Date): boolean {
  return new Date(row.due_at).getTime() <= now.getTime()
}

/** Due cards ordered like the desktop: learning/review first, then new; oldest due first. */
export function sortDue(rows: ScheduleRow[], now: Date): ScheduleRow[] {
  return rows
    .filter((r) => isDue(r, now))
    .sort((a, b) => (a.state === 'new' ? 1 : 0) - (b.state === 'new' ? 1 : 0) || (a.due_at < b.due_at ? -1 : 1))
}
