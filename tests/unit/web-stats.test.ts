import { describe, expect, it } from 'vitest'
import { addDays, localDateKey } from '@core/dates'
import { levelFromXp } from '@core/game'
import {
  activeDays,
  coachReports,
  dailySeries,
  monthlySeries,
  overview,
  sumBuckets,
  todaysLessons,
  totalXp,
  weeklySeries,
} from '../../web/src/lib/stats'
import { applyRows, emptyCache, type Activity, type SyncRow } from '../../web/src/lib/sync'

const act = (date: string, action: string, minutes: number, xp = 0): Activity => ({
  module: 'vocabulary',
  action,
  title: '',
  ref: '',
  skill: 'vocabulary',
  minutes,
  xp,
  date,
  created_at: `${date}T10:00:00.000Z`,
})

const TODAY = '2026-11-05' // Thursday
const ACTS: Activity[] = [
  act(TODAY, 'review_done', 0.5, 1),
  act(TODAY, 'review_done', 0.2, 1),
  act(TODAY, 'word_saved', 0.1, 2),
  act('2026-11-03', 'lesson_completed', 12, 20),
  act('2026-10-28', 'listening_done', 15, 15),
  act('2026-09-10', 'reading_done', 9, 15),
]

describe('web stats – aggregation', () => {
  it('buckets activity per day', () => {
    const days = dailySeries(ACTS, TODAY, 7)
    expect(days.map((d) => d.key)).toEqual([
      '2026-10-30',
      '2026-10-31',
      '2026-11-01',
      '2026-11-02',
      '2026-11-03',
      '2026-11-04',
      TODAY,
    ])
    const today = days.at(-1)
    expect(today).toMatchObject({ minutes: 0.8, reviews: 2, words: 1, xp: 4 })
    expect(days.find((d) => d.key === '2026-11-03')).toMatchObject({ minutes: 12, lessons: 1 })
  })

  it('buckets activity per ISO week (Monday keys) and per month', () => {
    const weeks = weeklySeries(ACTS, TODAY, 3)
    expect(weeks.map((w) => w.key)).toEqual(['2026-10-19', '2026-10-26', '2026-11-02'])
    expect(weeks[2]).toMatchObject({ minutes: 12.8, reviews: 2 })
    expect(weeks[1]?.minutes).toBe(15)
    const months = monthlySeries(ACTS, TODAY, 3)
    expect(months.map((m) => m.key)).toEqual(['2026-09', '2026-10', '2026-11'])
    expect(months.map((m) => m.minutes)).toEqual([9, 15, 12.8])
    expect(sumBuckets(months)).toMatchObject({ minutes: 36.8, xp: 54, reviews: 2, words: 1, lessons: 1 })
  })

  it('month buckets cross the year boundary', () => {
    expect(monthlySeries([], '2026-01-15', 3).map((m) => m.key)).toEqual(['2025-11', '2025-12', '2026-01'])
  })

  it('derives active days and total XP', () => {
    expect(activeDays(ACTS)).toEqual(['2026-09-10', '2026-10-28', '2026-11-03', TODAY])
    expect(
      totalXp([
        { amount: 5, source: 'x', skill: null, date: TODAY, created_at: '' },
        { amount: 7, source: 'y', skill: null, date: TODAY, created_at: '' },
      ]),
    ).toBe(12)
  })

  it('orders today lessons by position', () => {
    const l = (id: number, date: string, position: number) => ({
      id,
      date,
      module: 'reading',
      title: `L${id}`,
      description: '',
      estimated_minutes: 10,
      status: 'todo' as const,
      completed_at: null,
      position,
    })
    expect(todaysLessons([l(1, TODAY, 2), l(2, TODAY, 0), l(3, '2026-11-04', 1)], TODAY).map((x) => x.id)).toEqual([
      2, 1,
    ])
  })
})

describe('web stats – overview from synced rows', () => {
  it('computes streak, level, today minutes, lessons and profile goal', () => {
    const now = new Date(2026, 10, 5, 12, 0, 0) // local noon, 5 Nov 2026
    const today = localDateKey(now)
    const rows: SyncRow[] = []
    let seq = 0
    const add = (tbl: string, key: string, data: Record<string, unknown>) =>
      rows.push({ tbl, row_key: key, data, deleted: false, client_updated_at: '2026-11-05T00:00:00Z', seq: ++seq })
    for (let i = 0; i < 3; i++)
      add('activity_log', `d:${i}`, {
        module: 'vocabulary',
        action: 'review_done',
        minutes: 4,
        xp: 1,
        date: addDays(today, -i),
        created_at: '',
      })
    add('xp_events', 'd:1', { amount: 90, source: 'lesson_completed', date: addDays(today, -1), created_at: '' })
    add('xp_events', 'd:2', { amount: 30, source: 'review_done', date: today, created_at: '' })
    add('lessons', 'd:1', {
      id: 1,
      date: today,
      module: 'listening',
      title: 'Podcast',
      estimated_minutes: 15,
      status: 'done',
      position: 1,
    })
    add('lessons', 'd:2', { id: 2, date: today, module: 'speaking', title: 'Shadowing', position: 0 })
    add('user_profile', '1', { display_name: 'Lan', daily_minutes: 30, target_ielts: 6.5 })

    const ov = overview(applyRows(emptyCache('u'), rows, { pulled: true }), now)
    expect(ov.streak.current).toBe(3)
    expect(ov.streak.activeToday).toBe(true)
    expect(ov.totalXp).toBe(120)
    expect(ov.todayXp).toBe(30)
    expect(ov.level).toBe(levelFromXp(120).level)
    expect(ov.xpIntoLevel).toBe(20)
    expect(ov.todayMinutes).toBe(4)
    expect(ov.dailyGoal).toBe(30)
    expect(ov.profile?.target_ielts).toBe(6.5)
    expect(ov.lessons.map((l) => l.title)).toEqual(['Shadowing', 'Podcast'])
    expect(ov.lessons[0]?.status).toBe('todo')
  })

  it('lists coach reports newest first', () => {
    const rep = (key: string, created: string, seq: number): SyncRow => ({
      tbl: 'coach_reports',
      row_key: key,
      data: {
        id: seq,
        period: 'week',
        period_key: key,
        label: '{"en":"W","vi":"T"}',
        advice: '{"headline":"H"}',
        source: 'offline',
        created_at: created,
      },
      deleted: false,
      client_updated_at: created,
      seq,
    })
    const cache = applyRows(
      emptyCache('u'),
      [rep('a', '2026-10-01T00:00:00Z', 1), rep('b', '2026-11-01T00:00:00Z', 2)],
      { pulled: true },
    )
    expect(coachReports(cache).map((r) => r.key)).toEqual(['b', 'a'])
  })
})
