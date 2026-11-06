// Clock abuse: the kernel clock jumps back a day / a year, forward a year, crosses midnight by two seconds,
// and runs through 23 h / 25 h DST days (America/New_York). Streak, quests, FSRS due dates, the coach
// scheduler, statistics and the daily plan must keep working: no crash, no NaN / Infinity, no negative counts.
import { afterEach, describe, expect, it } from 'vitest'
import type { VocabItem } from '../../src/shared/types'
import { addDays, diffDays, isoWeekKey, localDateKey } from '../../src/core/dates'
import { defaultSchedules, dueSchedules } from '../../src/modules/coach/main/scheduler'
import { makeApp } from '../helpers/kernel'

type App = Awaited<ReturnType<typeof makeApp>>

/** Keys whose numbers may legitimately be negative (offsets, deltas, trends). */
const SIGNED = /offset|delta|change|diff|trend|previous|lat|lng|slope/i

function badNumbers(value: unknown, path = '$', out: string[] = []): string[] {
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) out.push(`${path} = ${value}`)
    else if (value < 0 && !SIGNED.test(path)) out.push(`${path} = ${value}`)
  } else if (Array.isArray(value)) value.forEach((v, i) => badNumbers(v, `${path}[${i}]`, out))
  else if (value && typeof value === 'object' && !(value instanceof Uint8Array))
    for (const [k, v] of Object.entries(value)) badNumbers(v, `${path}.${k}`, out)
  return out
}

const READS: [string, unknown?][] = [
  ['app:bootstrap'],
  ['progress:game'],
  ['progress:quests'],
  ['progress:stats'],
  ['progress:achievements'],
  ['progress:activity'],
  ['vocab:stats'],
  ['vocab:due'],
  ['vocab:list', { sort: 'due' }],
  ['journey:today'],
  ['journey:dashboard'],
  ['coach:overview', { period: 'day' }],
  ['coach:overview', { period: 'week' }],
  ['coach:overview', { period: 'month', offset: -1 }],
  ['coach:schedules'],
  ['grammar:overview'],
  ['reading:library'],
  ['listening:list'],
  ['cinema:list'],
]

async function exercise(app: App, label: string) {
  const problems: string[] = []
  for (const [ch, payload] of READS) {
    const res = await app.router.dispatch(ch, payload)
    if (!res.ok) problems.push(`${label} ${ch}: ${res.error.code} ${res.error.message}`)
    else problems.push(...badNumbers(res.data, ch).map((p) => `${label} ${p}`))
  }
  // Writes that depend on "now": a review, a new word, an activity, a report.
  const due = await app.call<VocabItem[]>('vocab:list', { limit: 5 })
  for (const rating of [1, 3] as const) {
    const id = (due as unknown as { items: VocabItem[] }).items[0]?.id
    if (!id) break
    const r = await app.router.dispatch('vocab:review', { id, rating, durationMs: 4000 })
    if (!r.ok) problems.push(`${label} vocab:review: ${r.error.code}`)
    else {
      const item = r.data as VocabItem
      problems.push(...badNumbers(item.review, 'review').map((p) => `${label} ${p}`))
      if (Number.isNaN(Date.parse(item.review.dueAt))) problems.push(`${label} dueAt ${item.review.dueAt}`)
      if (item.review.scheduledDays < 0) problems.push(`${label} scheduledDays ${item.review.scheduledDays}`)
    }
  }
  const saved = await app.router.dispatch('vocab:save', { word: `w-${label}`, sourceModule: 'manual' })
  if (!saved.ok) problems.push(`${label} vocab:save: ${saved.error.code}`)
  const rep = await app.router.dispatch('coach:generateReport', { period: 'day', useAi: false })
  if (!rep.ok) problems.push(`${label} coach:generateReport: ${rep.error.code} ${rep.error.message}`)
  else problems.push(...badNumbers(rep.data, 'report').map((p) => `${label} ${p}`))
  const tick = await app.router.dispatch('coach:sendTest', { channel: 'app' })
  if (!tick.ok) problems.push(`${label} coach:sendTest: ${tick.error.code}`)
  // Review logs never store negative elapsed time; every due date parses.
  const negElapsed = Number(app.kernel.db.value('SELECT COUNT(*) FROM review_logs WHERE elapsed_days < 0') ?? 0)
  if (negElapsed) problems.push(`${label} ${negElapsed} review_logs with negative elapsed_days`)
  const badDue = app.kernel.db
    .all<{ due_at: string }>('SELECT due_at FROM review_schedules')
    .filter((r) => Number.isNaN(Date.parse(r.due_at)))
  if (badDue.length) problems.push(`${label} invalid due_at ${badDue[0]?.due_at}`)
  return problems
}

async function seeded(clock: { now: Date }) {
  const app = await makeApp({ now: () => clock.now })
  for (const w of ['harbour', 'beacon', 'drift', 'shore'])
    await app.call('vocab:save', { word: w, sourceModule: 'manual' })
  const { items } = await app.call<{ items: VocabItem[] }>('vocab:list')
  for (const it of items) await app.call('vocab:review', { id: it.id, rating: 3 })
  const topic = app.kernel.content.grammar()[0]!
  await app.call('grammar:submit', {
    topicId: topic.id,
    answers: topic.exercises.map((e) => ({ exerciseId: e.id, given: e.answer })),
    durationSec: 300,
  })
  await app.call('journey:today')
  return app
}

const originalTz = process.env.TZ
afterEach(() => {
  if (originalTz === undefined) delete process.env.TZ
  else process.env.TZ = originalTz
})

describe('clock jumps', () => {
  const start = new Date(2026, 10, 5, 10, 0, 0) // local Thursday 5 Nov 2026, 10:00

  it.each([
    ['back one day', -86_400_000],
    ['back one year', -365 * 86_400_000],
    ['forward one year', 365 * 86_400_000],
    ['back one minute', -60_000],
  ])('survives the clock jumping %s', async (label, delta) => {
    const clock = { now: new Date(start) }
    const app = await seeded(clock)
    clock.now = new Date(start.getTime() + delta)
    const problems = await exercise(app, label)
    // …and coming back to the real time again.
    clock.now = new Date(start.getTime() + 3_600_000)
    problems.push(...(await exercise(app, `${label} → back to now`)))
    expect(problems).toEqual([])
    expect(app.kernel.db.value('PRAGMA integrity_check')).toBe('ok')
  })

  it('crosses midnight 23:59:59 → 00:00:01 without losing the streak or double-creating quests', async () => {
    const clock = { now: new Date(2026, 10, 5, 23, 59, 59) }
    const app = await seeded(clock)
    const before = await app.call<{ streak: { current: number } }>('progress:game')
    expect(before.streak.current).toBe(1)
    clock.now = new Date(2026, 10, 6, 0, 0, 1)
    const problems = await exercise(app, 'midnight')
    expect(problems).toEqual([])
    const after = await app.call<{ streak: { current: number } }>('progress:game')
    expect(after.streak.current).toBe(2)
    const dupQuests = app.kernel.db.all(
      'SELECT period, period_key, quest_key, COUNT(*) c FROM quests GROUP BY period, period_key, quest_key HAVING c > 1',
    )
    expect(dupQuests).toEqual([])
    expect(
      app.kernel.db.all<{ date: string }>('SELECT DISTINCT date FROM activity_log ORDER BY date').map((r) => r.date),
    ).toEqual(['2026-11-05', '2026-11-06'])
  })

  it('a review dated before the previous review (clock moved back) keeps FSRS values finite', async () => {
    const clock = { now: new Date(start) }
    const app = await makeApp({ now: () => clock.now })
    const { item } = await app.call<{ item: VocabItem }>('vocab:save', { word: 'tide', sourceModule: 'manual' })
    clock.now = new Date(start.getTime() + 10 * 86_400_000)
    await app.call('vocab:review', { id: item.id, rating: 3 })
    clock.now = new Date(start.getTime() - 30 * 86_400_000)
    for (const rating of [1, 2, 3, 4] as const) {
      const r = await app.call<VocabItem>('vocab:review', { id: item.id, rating })
      expect(badNumbers(r.review)).toEqual([])
      expect(Date.parse(r.review.dueAt)).not.toBeNaN()
    }
    const logs = app.kernel.db.all<{ elapsed_days: number }>('SELECT elapsed_days FROM review_logs')
    expect(logs.every((l) => Number.isFinite(l.elapsed_days) && l.elapsed_days >= 0)).toBe(true)
  })
})

describe('daylight saving time (America/New_York)', () => {
  it('date keys, diffs and ISO weeks stay calendar-correct on 23 h and 25 h days', () => {
    process.env.TZ = 'America/New_York'
    // 8 Mar 2026: clocks go forward (23 h day); 1 Nov 2026: clocks go back (25 h day).
    expect(new Date(2026, 2, 8, 12).getTimezoneOffset()).not.toBe(new Date(2026, 2, 7, 12).getTimezoneOffset())
    expect(addDays('2026-03-07', 1)).toBe('2026-03-08')
    expect(addDays('2026-03-08', 1)).toBe('2026-03-09')
    expect(addDays('2026-10-31', 1)).toBe('2026-11-01')
    expect(addDays('2026-11-01', 1)).toBe('2026-11-02')
    expect(diffDays('2026-03-09', '2026-03-07')).toBe(2)
    expect(diffDays('2026-11-02', '2026-10-31')).toBe(2)
    expect(localDateKey(new Date(2026, 2, 8, 23, 59, 59))).toBe('2026-03-08')
    expect(localDateKey(new Date(2026, 10, 1, 0, 30))).toBe('2026-11-01')
    expect(isoWeekKey(new Date(2026, 10, 1, 23, 30))).toBe('2026-W44')
    expect(isoWeekKey(new Date(2026, 10, 2, 0, 30))).toBe('2026-W45')
  })

  it('the app keeps a consistent streak and plan through both DST switches', async () => {
    process.env.TZ = 'America/New_York'
    const clock = { now: new Date(2026, 2, 7, 23, 30) }
    const app = await seeded(clock)
    const problems: string[] = []
    for (const d of [
      new Date(2026, 2, 8, 0, 30),
      new Date(2026, 2, 8, 3, 30), // just after the skipped hour
      new Date(2026, 2, 9, 0, 0, 1),
      new Date(2026, 9, 31, 23, 59, 59),
      new Date(2026, 10, 1, 1, 30), // the repeated hour
      new Date(2026, 10, 2, 0, 0, 1),
    ]) {
      clock.now = d
      problems.push(...(await exercise(app, d.toString().slice(0, 24))))
    }
    expect(problems).toEqual([])
  })
})

describe('coach scheduler under clock abuse', () => {
  it('does not resend an older occurrence after the clock moved back', () => {
    const schedules = defaultSchedules()
    const now = new Date(2026, 10, 6, 21, 0)
    const sent = Object.fromEntries(dueSchedules(now, schedules, {}).map((d) => [d.kind, d.key]))
    expect(Object.keys(sent).length).toBeGreaterThan(0)
    // Clock jumps back one day: what was already sent "tomorrow" is not sent again.
    expect(dueSchedules(new Date(2026, 10, 5, 21, 0), schedules, sent)).toEqual([])
    // A year back means the stored keys came from a wrong clock that was fixed: reminders must not stop for a year.
    expect(dueSchedules(new Date(2025, 10, 6, 21, 0), schedules, sent).length).toBeGreaterThan(0)
    // Moving forward again behaves normally.
    expect(dueSchedules(new Date(2026, 10, 7, 21, 0), schedules, sent).length).toBeGreaterThan(0)
  })

  it('handles invalid dates and the end of the year', () => {
    const schedules = defaultSchedules()
    expect(() => dueSchedules(new Date(Number.NaN), schedules, {})).not.toThrow()
    expect(dueSchedules(new Date(Number.NaN), schedules, {})).toEqual([])
    const nye = dueSchedules(new Date(2026, 11, 31, 23, 59, 59), schedules, {})
    for (const d of nye) expect(d.key).toMatch(/^\d{4}-/)
    expect(diffDays(addDays('2026-12-31', 1), '2026-12-31')).toBe(1)
  })
})
