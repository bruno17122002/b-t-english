import { describe, expect, it } from 'vitest'
import { localDateKey } from '@core/dates'
import { FsrsScheduler, newCard } from '@core/srs'
import {
  buildDeck,
  buildReviewRows,
  countDue,
  nextUpdatedAt,
  previewLabels,
  reviewFromCache,
  reviewMinutes,
  selectDue,
} from '../../web/src/lib/review'
import { applyRows, emptyCache, rawRow, type SyncCache, type SyncRow } from '../../web/src/lib/sync'

const NOW = new Date('2026-11-05T09:00:00.000Z')
const at = '2026-11-01T00:00:00.000Z'
const r = (tbl: string, row_key: string, data: Record<string, unknown>, seq = 1): SyncRow => ({
  tbl,
  row_key,
  data,
  deleted: false,
  client_updated_at: at,
  seq,
})
const vocab = (key: string, id: number) =>
  r('vocabulary', key, { id, word: key, word_key: key, meaning_vi: `nghĩa ${key}`, examples: '[]', created_at: at })
const schedule = (key: string, id: number, state: string, due: string, extra: Record<string, unknown> = {}) =>
  r('review_schedules', key, {
    vocab_id: id,
    word_key: key,
    state,
    due_at: due,
    stability: state === 'new' ? 0 : 5,
    difficulty: state === 'new' ? 0 : 5,
    reps: state === 'new' ? 0 : 3,
    lapses: 0,
    scheduled_days: state === 'new' ? 0 : 5,
    last_review_at: state === 'new' ? null : '2026-10-31T09:00:00.000Z',
    learning_steps: 0,
    ...extra,
  })

function fixture(): SyncCache {
  return applyRows(
    emptyCache('u1'),
    [
      vocab('apple', 1),
      vocab('banana', 2),
      vocab('cherry', 3),
      vocab('durian', 4),
      vocab('orphan', 5), // no schedule row → new card due now
      schedule('apple', 1, 'new', '2026-11-01T00:00:00.000Z'),
      schedule('banana', 2, 'review', '2026-11-04T00:00:00.000Z'),
      schedule('cherry', 3, 'review', '2026-11-03T00:00:00.000Z', { custom_column: 'keep me' }),
      schedule('durian', 4, 'review', '2026-11-20T00:00:00.000Z'), // not due
    ],
    { pulled: true },
  )
}

let n = 0
const uuid = () => `uuid-${++n}`

describe('web review – deck', () => {
  it('joins vocabulary and schedules by word_key', () => {
    const deck = buildDeck(fixture(), NOW)
    expect(deck).toHaveLength(5)
    const orphan = deck.find((c) => c.wordKey === 'orphan')
    expect(orphan?.schedule).toBeNull()
    expect(orphan?.memory.state).toBe('new')
    expect(deck.find((c) => c.wordKey === 'cherry')?.memory).toMatchObject({ state: 'review', stability: 5, reps: 3 })
  })

  it('selects due cards like the desktop: learning/review oldest first, then new cards', () => {
    const deck = buildDeck(fixture(), NOW)
    expect(selectDue(deck, NOW).map((c) => c.wordKey)).toEqual(['cherry', 'banana', 'apple', 'orphan'])
    expect(selectDue(deck, NOW, 2).map((c) => c.wordKey)).toEqual(['cherry', 'banana'])
    expect(countDue(deck, NOW)).toBe(4)
    expect(countDue(deck, new Date('2026-12-01T00:00:00Z'))).toBe(5)
  })

  it('previews interval labels for the four buttons', () => {
    const card = buildDeck(fixture(), NOW).find((c) => c.wordKey === 'apple')
    if (!card) throw new Error('missing')
    const labels = previewLabels(card, NOW)
    expect(labels[1]).toBe('1m')
    expect(Object.keys(labels)).toEqual(['1', '2', '3', '4'])
  })
})

describe('web review – rating to rows', () => {
  it('writes review_schedules, review_logs, activity_log and xp_events rows', () => {
    const cache = fixture()
    const card = buildDeck(cache, NOW).find((c) => c.wordKey === 'cherry')
    if (!card) throw new Error('missing')
    const { rows, next } = reviewFromCache(cache, card, 3, NOW, 4_000, uuid)
    expect(rows.map((x) => x.tbl)).toEqual(['review_schedules', 'review_logs', 'activity_log', 'xp_events'])
    expect(rows.every((x) => x.client_updated_at === NOW.toISOString() && !x.deleted)).toBe(true)

    const [sched, log, act, xp] = rows
    expect(sched?.row_key).toBe('cherry')
    expect(sched?.data).toMatchObject({
      word_key: 'cherry',
      vocab_id: 3,
      custom_column: 'keep me',
      state: next.state,
      due_at: next.dueAt,
      reps: 4,
      last_review_at: NOW.toISOString(),
    })
    // Same FSRS result as the desktop scheduler.
    const expected = new FsrsScheduler().review(card.memory, 3, NOW)
    expect(next).toEqual(expected)

    expect(log?.row_key).toMatch(/^web:uuid-\d+$/)
    expect(log?.data).toMatchObject({
      vocab_id: 3,
      word_key: 'cherry',
      rating: 3,
      state_before: 'review',
      duration_ms: 4000,
      reviewed_at: NOW.toISOString(),
    })
    expect(log?.data.elapsed_days).toBeCloseTo(5, 5)

    expect(act?.data).toMatchObject({
      module: 'vocabulary',
      action: 'review_done',
      skill: 'vocabulary',
      xp: 1,
      title: 'cherry',
      date: localDateKey(NOW),
    })
    expect(act?.data.minutes).toBe(0.1) // 4 s → clamped to the 0.1 min floor
    expect(xp?.data).toMatchObject({ amount: 1, source: 'review_done', skill: 'vocabulary', date: localDateKey(NOW) })
    expect(new Set([log?.row_key, act?.row_key, xp?.row_key]).size).toBe(3)
  })

  it('creates a schedule for a word that had none and moves a new card into learning', () => {
    const cache = fixture()
    const card = buildDeck(cache, NOW).find((c) => c.wordKey === 'orphan')
    if (!card) throw new Error('missing')
    const { rows, next } = buildReviewRows({
      card,
      rating: 3,
      now: NOW,
      durationMs: 0,
      previousData: rawRow(cache, 'review_schedules', 'orphan'),
      uuid,
    })
    expect(next.state).toBe('learning')
    expect(rows[0]?.data).toMatchObject({ word_key: 'orphan', vocab_id: 5, state: 'learning' })
    expect(rows[1]?.data).toMatchObject({ state_before: 'new', elapsed_days: 0 })
  })

  it('rated cards leave the due list once the rows are applied to the cache', () => {
    let cache = fixture()
    const card = buildDeck(cache, NOW).find((c) => c.wordKey === 'banana')
    if (!card) throw new Error('missing')
    const { rows } = reviewFromCache(cache, card, 4, NOW, 2_000, uuid)
    cache = applyRows(cache, rows)
    const deck = buildDeck(cache, NOW)
    expect(selectDue(deck, NOW).map((c) => c.wordKey)).not.toContain('banana')
    expect(deck.find((c) => c.wordKey === 'banana')?.memory.reps).toBe(4)
    expect(Object.keys(cache.rows.review_logs ?? {})).toHaveLength(1)
  })

  it('keeps the schedule version strictly newer than the stored one when the phone clock is behind', () => {
    expect(nextUpdatedAt(NOW, '2026-11-01T00:00:00.000Z')).toBe(NOW.toISOString())
    expect(nextUpdatedAt(NOW, '2026-11-05T09:30:00.000Z')).toBe('2026-11-05T09:30:00.001Z')
    expect(nextUpdatedAt(NOW, null)).toBe(NOW.toISOString())
    let cache = fixture()
    cache = applyRows(
      cache,
      [
        {
          ...schedule('banana', 2, 'review', '2026-11-04T00:00:00.000Z'),
          client_updated_at: '2026-11-06T00:00:00.000Z',
          seq: 50,
        },
      ],
      { pulled: true },
    )
    const card = buildDeck(cache, NOW).find((c) => c.wordKey === 'banana')
    if (!card) throw new Error('missing')
    const { rows } = reviewFromCache(cache, card, 3, NOW, 1_000, uuid)
    expect(rows[0]?.client_updated_at).toBe('2026-11-06T00:00:00.001Z')
    expect(rows[1]?.client_updated_at).toBe(NOW.toISOString())
  })

  it('credits review minutes with the desktop formula', () => {
    expect(reviewMinutes(0)).toBe(0.2)
    expect(reviewMinutes(3_000)).toBeCloseTo(0.1, 5)
    expect(reviewMinutes(30_000)).toBe(0.5)
    expect(reviewMinutes(10 * 60_000)).toBe(2)
  })

  it('new cards built locally match ts-fsrs empty cards', () => {
    const card = buildDeck(applyRows(emptyCache('u'), [vocab('x', 1)]), NOW)[0]
    expect(card?.memory).toEqual(newCard(NOW))
  })
})
