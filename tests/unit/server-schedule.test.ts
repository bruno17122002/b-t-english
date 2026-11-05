// Server calendar + schedule logic: time-zone helpers, due computation with catch-up windows in the learner's zone,
// period keys (day / ISO week / month), pushed schedule parsing and the streak port.
import { describe, expect, it } from 'vitest'
import {
  addDays,
  computeStreak,
  dateKeyIn,
  hourIn,
  isoWeekKey,
  weekStart,
  weekdayOf,
  zonedTime,
} from '../../supabase/functions/_shared/dates'
import {
  defaultSchedules,
  dueSchedules,
  lastOccurrence,
  parsePushedSchedules,
  reportTarget,
} from '../../supabase/functions/_shared/schedule'
import { parseCommand, safeEqual, splitHtml } from '../../supabase/functions/_shared/format'

const HCM = 'Asia/Ho_Chi_Minh'
const NY = 'America/New_York'
const at = (iso: string) => new Date(iso)

describe('server dates – time zones', () => {
  it('maps instants to the learner calendar day and hour', () => {
    expect(dateKeyIn(at('2026-11-04T17:30:00Z'), HCM)).toBe('2026-11-05') // 00:30 local
    expect(dateKeyIn(at('2026-11-04T16:59:00Z'), HCM)).toBe('2026-11-04')
    expect(hourIn('2026-11-05T13:00:00Z', HCM)).toBe(20)
    expect(hourIn('2026-11-05T13:00:00Z', 'UTC')).toBe(13)
  })

  it('converts a local wall-clock time to the right instant, also across DST', () => {
    expect(zonedTime('2026-11-05', '07:00', HCM).toISOString()).toBe('2026-11-05T00:00:00.000Z')
    expect(zonedTime('2026-11-05', '00:00', HCM).toISOString()).toBe('2026-11-04T17:00:00.000Z')
    // US daylight saving time ends on 2026-11-01.
    expect(zonedTime('2026-10-30', '07:00', NY).toISOString()).toBe('2026-10-30T11:00:00.000Z')
    expect(zonedTime('2026-11-02', '07:00', NY).toISOString()).toBe('2026-11-02T12:00:00.000Z')
  })

  it('date-key arithmetic is time-zone free', () => {
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01')
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28')
    expect(weekdayOf('2026-11-05')).toBe(4) // Thursday
    expect(weekStart('2026-11-08')).toBe('2026-11-02')
    expect(isoWeekKey('2026-11-05')).toBe('2026-W45')
    expect(isoWeekKey('2027-01-01')).toBe('2026-W53')
  })

  it('streak with a forgiving rest day matches the desktop rules', () => {
    expect(computeStreak(['2026-11-02', '2026-11-03', '2026-11-04'], '2026-11-05')).toMatchObject({
      current: 3,
      activeToday: false,
    })
    expect(computeStreak(['2026-11-01', '2026-11-03', '2026-11-04', '2026-11-05'], '2026-11-05').current).toBe(4)
    expect(computeStreak(['2026-10-30', '2026-11-04'], '2026-11-05').current).toBe(1)
  })
})

describe('server schedules – due computation in the learner time zone', () => {
  const schedules = defaultSchedules('20:00')

  it('the morning brief is due from 07:00 local until local midnight, once per day', () => {
    expect(lastOccurrence('morningBrief', schedules.morningBrief, at('2026-11-04T23:59:00Z'), HCM)).toBeNull() // 06:59
    const occ = lastOccurrence('morningBrief', schedules.morningBrief, at('2026-11-05T00:02:00Z'), HCM)
    expect(occ).toMatchObject({ key: '2026-11-05', day: '2026-11-05' })
    expect(occ?.until.toISOString()).toBe('2026-11-05T17:00:00.000Z')
    const due = dueSchedules(at('2026-11-05T00:02:00Z'), schedules, new Set(), HCM)
    expect(due.map((d) => d.kind)).toEqual(['morningBrief'])
    expect(due[0]?.catchUp).toBe(false)
    // Already sent (notification_log) → not due again.
    expect(dueSchedules(at('2026-11-05T00:30:00Z'), schedules, new Set(['morningBrief:2026-11-05']), HCM)).toEqual([])
  })

  it('catches up a missed morning brief later the same day, flagged as catch-up', () => {
    const due = dueSchedules(at('2026-11-05T05:00:00Z'), schedules, new Set(), HCM) // 12:00 local
    expect(due).toHaveLength(1)
    expect(due[0]).toMatchObject({ kind: 'morningBrief', catchUp: true })
  })

  it('the same UTC instant is a different day in another zone', () => {
    const now = at('2026-11-05T13:05:00Z') // 20:05 in Vietnam, 08:05 in New York
    const vn = dueSchedules(now, schedules, new Set(), HCM).map((d) => `${d.kind}:${d.key}`)
    const ny = dueSchedules(now, schedules, new Set(), NY).map((d) => `${d.kind}:${d.key}`)
    expect(vn).toEqual(['morningBrief:2026-11-05', 'eveningReminder:2026-11-05'])
    expect(ny).toEqual(['morningBrief:2026-11-05'])
  })

  it('weekly report: Sunday 20:00, key of the reported week, catch-up until the end of Monday', () => {
    const sunday = dueSchedules(at('2026-11-01T13:10:00Z'), schedules, new Set(), HCM)
    expect(sunday.find((d) => d.kind === 'weeklyReport')).toMatchObject({ key: '2026-W44', day: '2026-11-01' })
    const monday = dueSchedules(at('2026-11-02T10:00:00Z'), schedules, new Set(), HCM)
    expect(monday.find((d) => d.kind === 'weeklyReport')).toMatchObject({ key: '2026-W44', catchUp: true })
    const tuesday = dueSchedules(at('2026-11-03T03:00:00Z'), schedules, new Set(), HCM)
    expect(tuesday.find((d) => d.kind === 'weeklyReport')).toBeUndefined()
  })

  it('monthly report: day 1 at 09:00 reports the previous month, catch-up within three days', () => {
    const due = dueSchedules(at('2026-11-03T03:00:00Z'), schedules, new Set(), HCM)
    expect(due.find((d) => d.kind === 'monthlyReport')).toMatchObject({ key: '2026-10', day: '2026-11-01' })
    expect(
      dueSchedules(at('2026-11-04T03:00:00Z'), schedules, new Set(), HCM).some((d) => d.kind === 'monthlyReport'),
    ).toBe(false)
    expect(reportTarget('monthlyReport', '2026-01-01')).toEqual({ period: 'month', ref: '2025-12-01' })
    expect(reportTarget('weeklyReport', '2026-11-07')).toEqual({ period: 'week', ref: '2026-11-07' })
    expect(reportTarget('weeklyReport', '2026-11-04')).toEqual({ period: 'week', ref: '2026-10-28' })
  })

  it('only Telegram-enabled schedules are due on the server', () => {
    const s = parsePushedSchedules({
      schedules: { morningBrief: { channels: { app: true, telegram: false } } },
    }).schedules
    expect(dueSchedules(at('2026-11-05T00:02:00Z'), s, new Set(), HCM)).toEqual([])
  })
})

describe('server schedules – pushed data', () => {
  it('merges partial desktop JSON over the defaults and ignores invalid values', () => {
    const { schedules, timezone } = parsePushedSchedules({
      version: 1,
      schedules: {
        morningBrief: { time: '06:30' },
        eveningReminder: { enabled: false, time: '25:00' },
        weeklyReport: { weekday: 9 },
      },
      reminderTime: '21:00',
      timezone: 'Europe/Berlin',
    })
    expect(schedules.morningBrief).toMatchObject({ enabled: true, time: '06:30' })
    expect(schedules.eveningReminder).toMatchObject({ enabled: false, time: '21:00' })
    expect(schedules.weeklyReport.weekday).toBe(0)
    expect(schedules.dailyReport.channels).toEqual({ app: false, telegram: true })
    expect(timezone).toBe('Europe/Berlin')
  })

  it('accepts a bare schedule map, null data and an unknown time zone', () => {
    expect(parsePushedSchedules({ morningBrief: { enabled: false } }).schedules.morningBrief.enabled).toBe(false)
    expect(parsePushedSchedules(null).schedules).toEqual(defaultSchedules())
    expect(parsePushedSchedules({ timezone: 'Mars/Olympus' }).timezone).toBeNull()
  })
})

describe('server format helpers', () => {
  it('parses commands addressed to this bot only', () => {
    expect(parseCommand('/start 123456')).toEqual({ name: 'start', args: '123456' })
    expect(parseCommand('/Report@LqBot tuần', 'lqbot')).toEqual({ name: 'report', args: 'tuần' })
    expect(parseCommand('/report@other_bot', 'lqbot')).toBeNull()
    expect(parseCommand('hello /start')).toBeNull()
  })

  it('splits long HTML with balanced tags and compares secrets safely', () => {
    const parts = splitHtml(`<b>${'word '.repeat(2000)}</b>`, 4000)
    expect(parts.length).toBeGreaterThan(1)
    for (const p of parts) {
      expect(p.length).toBeLessThanOrEqual(4000)
      expect(p.startsWith('<b>')).toBe(true)
      expect(p.endsWith('</b>')).toBe(true)
    }
    expect(safeEqual('abc', 'abc')).toBe(true)
    expect(safeEqual('abc', 'abd')).toBe(false)
    expect(safeEqual('', '')).toBe(false)
  })
})
