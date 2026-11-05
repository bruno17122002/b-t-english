// Flashcard review on the phone: builds the deck from synced vocabulary + review_schedules rows, picks due
// cards, schedules with the same FSRS adapter as the desktop (@core/srs) and turns one rating into the rows
// the desktop would have written: review_schedules (updated), review_logs, activity_log and xp_events (new).
import { localDateKey } from '@core/dates'
import { XP_RULES } from '@core/game'
import { FsrsScheduler, newCard, type CardMemory, type Rating } from '@core/srs'
import {
  rawRow,
  ReviewScheduleSchema,
  tableRows,
  VocabSchema,
  type PushRow,
  type ReviewSchedule,
  type SyncCache,
  type Vocab,
} from './sync'

export interface StudyCard {
  wordKey: string
  vocab: Vocab
  /** null when the word has no schedule row yet (treated as a new card, due now). */
  schedule: ReviewSchedule | null
  memory: CardMemory
}

export function scheduleToMemory(s: ReviewSchedule): CardMemory {
  return {
    state: s.state,
    stability: s.stability,
    difficulty: s.difficulty,
    reps: s.reps,
    lapses: s.lapses,
    lastReviewAt: s.last_review_at,
    dueAt: s.due_at,
    scheduledDays: s.scheduled_days,
    learningSteps: s.learning_steps,
  }
}

/** Joins vocabulary and review_schedules by word_key. */
export function buildDeck(cache: SyncCache, now: Date): StudyCard[] {
  const schedules = new Map(
    tableRows(cache, 'review_schedules', ReviewScheduleSchema).map((r) => [r.row.word_key, r.row]),
  )
  return tableRows(cache, 'vocabulary', VocabSchema).map(({ key, row }) => {
    const wordKey = row.word_key || key
    const schedule = schedules.get(wordKey) ?? null
    return { wordKey, vocab: row, schedule, memory: schedule ? scheduleToMemory(schedule) : newCard(now) }
  })
}

const dueMs = (c: StudyCard) => {
  const t = Date.parse(c.memory.dueAt)
  return Number.isFinite(t) ? t : 0
}

/** Due cards like the desktop: cards in learning/review first (oldest due first), new cards after. */
export function selectDue(deck: StudyCard[], now: Date, limit = 50): StudyCard[] {
  const t = now.getTime()
  return deck
    .filter((c) => dueMs(c) <= t)
    .sort((a, b) => {
      const an = a.memory.state === 'new' ? 1 : 0
      const bn = b.memory.state === 'new' ? 1 : 0
      return an - bn || dueMs(a) - dueMs(b) || a.wordKey.localeCompare(b.wordKey)
    })
    .slice(0, Math.max(0, limit))
}

export function countDue(deck: StudyCard[], now: Date): number {
  const t = now.getTime()
  return deck.reduce((n, c) => n + (dueMs(c) <= t ? 1 : 0), 0)
}

/**
 * client_updated_at for an edited row: now, or 1 ms after the stored version when this device's clock is
 * behind (sync_push keeps the newer client_updated_at, so a slow phone clock would otherwise lose the review).
 * Same rule as the server bot (supabase/functions/_shared/learner.ts nextUpdatedAt).
 */
export function nextUpdatedAt(now: Date, previous?: string | null): string {
  const prev = previous ? Date.parse(previous) : NaN
  return new Date(Number.isFinite(prev) && prev >= now.getTime() ? prev + 1 : now.getTime()).toISOString()
}

/** Minutes credited for one review – same formula as the desktop vocabulary hub. */
export function reviewMinutes(durationMs: number): number {
  return Math.min(2, Math.max(0.1, durationMs / 60_000 || 0.2))
}

export interface ReviewInput {
  card: StudyCard
  rating: Rating
  now: Date
  durationMs: number
  /** Existing raw review_schedules data (keeps columns the PWA does not know). */
  previousData?: Record<string, unknown> | null
  /** client_updated_at of the existing schedule row: the new version must be strictly newer (clock skew). */
  previousUpdatedAt?: string | null
  uuid: () => string
  scheduler?: FsrsScheduler
}

export interface ReviewOutput {
  rows: PushRow[]
  next: CardMemory
}

/** One rating → the rows to push. Append-only rows get row_key `web:<uuid>`. */
export function buildReviewRows(input: ReviewInput): ReviewOutput {
  const { card, rating, now } = input
  const scheduler = input.scheduler ?? new FsrsScheduler()
  const before = card.memory
  const next = scheduler.review(before, rating, now)
  const nowIso = now.toISOString()
  const date = localDateKey(now)
  const elapsed = before.lastReviewAt ? Math.max(0, (now.getTime() - Date.parse(before.lastReviewAt)) / 86_400_000) : 0
  const vocabId = card.schedule?.vocab_id || card.vocab.id || null
  const durationMs = Math.max(0, Math.round(input.durationMs))
  const xp = XP_RULES.review_done

  const schedule: Record<string, unknown> = {
    ...(input.previousData ?? {}),
    word_key: card.wordKey,
    ...(vocabId ? { vocab_id: vocabId } : {}),
    state: next.state,
    due_at: next.dueAt,
    stability: next.stability,
    difficulty: next.difficulty,
    reps: next.reps,
    lapses: next.lapses,
    scheduled_days: next.scheduledDays,
    last_review_at: next.lastReviewAt,
    learning_steps: next.learningSteps ?? 0,
  }
  const row = (tbl: string, row_key: string, data: Record<string, unknown>, updatedAt = nowIso): PushRow => ({
    tbl,
    row_key,
    data,
    deleted: false,
    client_updated_at: updatedAt,
  })
  return {
    next,
    rows: [
      row('review_schedules', card.wordKey, schedule, nextUpdatedAt(now, input.previousUpdatedAt)),
      row('review_logs', `web:${input.uuid()}`, {
        vocab_id: vocabId,
        word_key: card.wordKey,
        rating,
        state_before: before.state,
        elapsed_days: elapsed,
        scheduled_days: next.scheduledDays,
        duration_ms: durationMs,
        reviewed_at: nowIso,
      }),
      row('activity_log', `web:${input.uuid()}`, {
        module: 'vocabulary',
        action: 'review_done',
        title: card.vocab.word.slice(0, 200),
        ref: card.wordKey,
        skill: 'vocabulary',
        minutes: reviewMinutes(durationMs),
        xp,
        date,
        created_at: nowIso,
        score: null,
        source: 'web',
      }),
      row('xp_events', `web:${input.uuid()}`, {
        amount: xp,
        source: 'review_done',
        skill: 'vocabulary',
        ref: card.wordKey,
        date,
        created_at: nowIso,
      }),
    ],
  }
}

/** Convenience for the UI: builds rows for a card straight from the cache. */
export function reviewFromCache(
  cache: SyncCache,
  card: StudyCard,
  rating: Rating,
  now: Date,
  durationMs: number,
  uuid: () => string,
): ReviewOutput {
  return buildReviewRows({
    card,
    rating,
    now,
    durationMs,
    previousData: rawRow(cache, 'review_schedules', card.wordKey),
    previousUpdatedAt: cache.rows.review_schedules?.[card.wordKey]?.client_updated_at ?? null,
    uuid,
  })
}

/** Interval labels for the four rating buttons. */
export function previewLabels(card: StudyCard, now: Date, scheduler = new FsrsScheduler()): Record<Rating, string> {
  const p = scheduler.preview(card.memory, now)
  return { 1: p[1].label, 2: p[2].label, 3: p[3].label, 4: p[4].label }
}
