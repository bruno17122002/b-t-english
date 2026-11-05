import { describe, expect, it } from 'vitest'
import {
  defaultSchedules,
  dueSchedules,
  lastOccurrence,
  mergeSchedule,
  nextRuns,
  parseSchedules,
  reportTarget,
} from '../../src/modules/coach/main/scheduler'
import type { ScheduleMap } from '../../src/modules/coach/types'

// 2026-11-05 is a Thursday; 2026-11-08 a Sunday.
const t = (d: number, hh: number, mm = 0, month = 10) => new Date(2026, month, d, hh, mm)

function only(kind: keyof ScheduleMap, map = defaultSchedules()): ScheduleMap {
  const out = { ...map }
  for (const k of Object.keys(out) as (keyof ScheduleMap)[]) out[k] = { ...out[k], enabled: k === kind }
  return out
}

describe('dueSchedules', () => {
  it('fires daily schedules at their time, once per day', () => {
    const s = only('morningBrief')
    expect(dueSchedules(t(5, 6, 59), s, {})).toEqual([])
    const due = dueSchedules(t(5, 7, 0), s, {})
    expect(due).toHaveLength(1)
    expect(due[0]).toMatchObject({ kind: 'morningBrief', key: '2026-11-05', catchUp: false })
    // Already sent today → never twice.
    expect(dueSchedules(t(5, 7, 1), s, { morningBrief: '2026-11-05' })).toEqual([])
    expect(dueSchedules(t(5, 18, 0), s, { morningBrief: '2026-11-05' })).toEqual([])
    // Next day it is due again.
    expect(dueSchedules(t(6, 7, 0), s, { morningBrief: '2026-11-05' })[0]?.key).toBe('2026-11-06')
  })

  it('catches up once on the same day when the app was off at the scheduled time', () => {
    const s = only('eveningReminder')
    const due = dueSchedules(t(5, 22, 30), s, { eveningReminder: '2026-11-04' })
    expect(due[0]).toMatchObject({ kind: 'eveningReminder', key: '2026-11-05', catchUp: true })
    // Yesterday's missed reminder is not sent after midnight.
    expect(dueSchedules(t(6, 0, 30), s, { eveningReminder: '2026-11-04' })).toEqual([])
  })

  it('handles the weekly report with catch-up until the end of the next day', () => {
    const s = only('weeklyReport')
    expect(dueSchedules(t(8, 19, 59), s, {})).toEqual([])
    const sunday = dueSchedules(t(8, 20, 0), s, {})
    expect(sunday[0]).toMatchObject({ kind: 'weeklyReport', key: '2026-W45', catchUp: false })
    const monday = dueSchedules(t(9, 10, 0), s, {})
    expect(monday[0]).toMatchObject({ key: '2026-W45', catchUp: true })
    expect(dueSchedules(t(9, 10, 0), s, { weeklyReport: '2026-W45' })).toEqual([])
    expect(dueSchedules(t(10, 10, 0), s, {})).toEqual([])
    // Thursday: last Sunday is too old.
    expect(dueSchedules(t(5, 12, 0), s, {})).toEqual([])
  })

  it('handles the monthly report for the previous month', () => {
    const s = only('monthlyReport')
    const due = dueSchedules(t(1, 9, 0, 11), s, {})
    expect(due[0]).toMatchObject({ kind: 'monthlyReport', key: '2026-11' })
    expect(dueSchedules(t(3, 23, 0, 11), s, {})[0]?.catchUp).toBe(true)
    expect(dueSchedules(t(4, 0, 30, 11), s, {})).toEqual([])
    expect(dueSchedules(t(2, 9, 0, 11), s, { monthlyReport: '2026-11' })).toEqual([])
    // January 1st reports December of the previous year.
    expect(dueSchedules(new Date(2027, 0, 1, 9, 5), s, {})[0]?.key).toBe('2026-12')
  })

  it('skips disabled schedules and schedules without channels', () => {
    const s = defaultSchedules()
    s.morningBrief = { ...s.morningBrief, enabled: false }
    s.dailyReport = { ...s.dailyReport, channels: { app: false, telegram: false } }
    const kinds = dueSchedules(t(5, 23, 0), s, {}).map((d) => d.kind)
    expect(kinds).toEqual(['eveningReminder'])
  })

  it('maps occurrences to reported periods', () => {
    expect(reportTarget('dailyReport', t(5, 21, 30))).toEqual({ period: 'day', ref: '2026-11-05' })
    expect(reportTarget('weeklyReport', t(8, 20))).toEqual({ period: 'week', ref: '2026-11-08' })
    expect(reportTarget('weeklyReport', t(9, 8))).toEqual({ period: 'week', ref: '2026-11-02' })
    expect(reportTarget('monthlyReport', t(1, 9, 0, 11))).toEqual({ period: 'month', ref: '2026-11-01' })
    expect(reportTarget('morningBrief', t(5, 7))).toBeNull()
    expect(
      lastOccurrence('weeklyReport', { ...defaultSchedules().weeklyReport, weekday: 1, time: '08:00' }, t(9, 9))?.key,
    ).toBe('2026-W45')
  })
})

describe('schedule storage', () => {
  it('merges stored JSON over defaults and ignores invalid values', () => {
    const d = defaultSchedules('19:45')
    expect(d.eveningReminder.time).toBe('19:45')
    expect(parseSchedules('not json', d)).toEqual(d)
    const s = parseSchedules(
      JSON.stringify({
        morningBrief: { time: '06:30', channels: { telegram: false } },
        weeklyReport: { weekday: 9, time: '25:00' },
      }),
      d,
    )
    expect(s.morningBrief).toMatchObject({ enabled: true, time: '06:30', channels: { app: true, telegram: false } })
    expect(s.weeklyReport).toMatchObject({ time: '20:00', weekday: 0 })
    expect(mergeSchedule(d.monthlyReport, { dayOfMonth: 15 }).dayOfMonth).toBe(15)
  })

  it('lists the next runs in chronological order', () => {
    const runs = nextRuns(t(5, 12, 0), defaultSchedules())
    expect(runs.map((r) => r.kind)).toEqual([
      'eveningReminder',
      'dailyReport',
      'morningBrief',
      'weeklyReport',
      'monthlyReport',
    ])
    expect(new Date(runs[3]?.at ?? '').getDay()).toBe(0)
    expect(new Date(runs[4]?.at ?? '').getDate()).toBe(1)
  })
})
