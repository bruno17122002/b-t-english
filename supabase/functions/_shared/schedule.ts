// Notification schedules on the server: the same kinds, defaults, catch-up windows and period keys as the desktop
// coach scheduler (src/modules/coach/main/scheduler.ts), computed in the learner's time zone. Instead of the
// desktop's "last sent" flag, sent occurrences are recorded in notification_log (primary key user_id, kind, period_key).
import { addDays, dateKeyIn, dayOfMonth, isoWeekKey, monthStart, validTimeZone, weekdayOf, zonedTime } from './dates.ts'
import type { CoachPeriod } from './habits.ts'

export type ScheduleKind = 'morningBrief' | 'eveningReminder' | 'dailyReport' | 'weeklyReport' | 'monthlyReport'

export interface ScheduleConfig {
  enabled: boolean
  time: string
  channels: { app: boolean; telegram: boolean }
  weekday?: number
  dayOfMonth?: number
}

export type ScheduleMap = Record<ScheduleKind, ScheduleConfig>

export const SCHEDULE_KINDS: ScheduleKind[] = [
  'morningBrief',
  'eveningReminder',
  'dailyReport',
  'weeklyReport',
  'monthlyReport',
]

export function defaultSchedules(eveningTime = '20:00'): ScheduleMap {
  const both = { app: true, telegram: true }
  return {
    morningBrief: { enabled: true, time: '07:00', channels: both },
    eveningReminder: { enabled: true, time: eveningTime, channels: both },
    dailyReport: { enabled: true, time: '21:30', channels: { app: false, telegram: true } },
    weeklyReport: { enabled: true, time: '20:00', weekday: 0, channels: both },
    monthlyReport: { enabled: true, time: '09:00', dayOfMonth: 1, channels: both },
  }
}

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/

export function mergeSchedule(base: ScheduleConfig, patch: unknown): ScheduleConfig {
  if (!patch || typeof patch !== 'object') return base
  const p = patch as Partial<ScheduleConfig>
  const next: ScheduleConfig = {
    enabled: typeof p.enabled === 'boolean' ? p.enabled : base.enabled,
    time: typeof p.time === 'string' && TIME.test(p.time) ? p.time : base.time,
    channels: {
      app: typeof p.channels?.app === 'boolean' ? p.channels.app : base.channels.app,
      telegram: typeof p.channels?.telegram === 'boolean' ? p.channels.telegram : base.channels.telegram,
    },
  }
  const valid = (v: unknown, lo: number, hi: number): v is number =>
    typeof v === 'number' && Number.isInteger(v) && v >= lo && v <= hi
  const weekday = valid(p.weekday, 0, 6) ? p.weekday : base.weekday
  if (weekday !== undefined) next.weekday = weekday
  const dom = valid(p.dayOfMonth, 1, 28) ? p.dayOfMonth : base.dayOfMonth
  if (dom !== undefined) next.dayOfMonth = dom
  return next
}

/** Content of notification_schedules.data as pushed by the desktop app. */
export interface PushedSchedules {
  version?: number
  /** Parsed coach.schedules JSON (may be partial or empty: defaults fill the gaps). */
  schedules?: unknown
  /** General reminder time of the desktop (default of the evening reminder). */
  reminderTime?: string
  /** IANA zone of the desktop (fallback when profiles.timezone is missing). */
  timezone?: string
  updatedAt?: string
}

export function parsePushedSchedules(data: unknown): { schedules: ScheduleMap; timezone: string | null } {
  const d = (data && typeof data === 'object' ? data : {}) as PushedSchedules & Record<string, unknown>
  // Accept both {schedules: {...}} and a bare schedule map.
  const stored = (d.schedules && typeof d.schedules === 'object' ? d.schedules : d) as Record<string, unknown>
  const defaults = defaultSchedules(
    typeof d.reminderTime === 'string' && TIME.test(d.reminderTime) ? d.reminderTime : '20:00',
  )
  const schedules = { ...defaults }
  for (const kind of SCHEDULE_KINDS) schedules[kind] = mergeSchedule(defaults[kind], stored[kind])
  return { schedules, timezone: validTimeZone(d.timezone) ? d.timezone : null }
}

/** Reported period and the date key inside it, for a schedule occurrence on `day` (learner's calendar). */
export function reportTarget(kind: ScheduleKind, day: string): { period: CoachPeriod; ref: string } | null {
  if (kind === 'dailyReport') return { period: 'day', ref: day }
  if (kind === 'weeklyReport') {
    const wd = weekdayOf(day)
    return { period: 'week', ref: wd === 0 || wd === 6 ? day : addDays(day, -7) }
  }
  if (kind === 'monthlyReport') return { period: 'month', ref: monthStart(day, -1) }
  return null
}

export interface Occurrence {
  kind: ScheduleKind
  at: Date
  /** Learner-calendar day of the occurrence. */
  day: string
  /** Period key: day for daily kinds, ISO week of the reported week, YYYY-MM of the reported month. */
  key: string
  until: Date
}

export function lastOccurrence(kind: ScheduleKind, cfg: ScheduleConfig, now: Date, tz: string): Occurrence | null {
  const today = dateKeyIn(now, tz)
  if (kind === 'morningBrief' || kind === 'eveningReminder' || kind === 'dailyReport') {
    const t = zonedTime(today, cfg.time, tz)
    if (t > now) return null
    return { kind, at: t, day: today, key: today, until: zonedTime(addDays(today, 1), '00:00', tz) }
  }
  if (kind === 'weeklyReport') {
    const weekday = cfg.weekday ?? 0
    for (let back = 0; back < 8; back++) {
      const day = addDays(today, -back)
      if (weekdayOf(day) !== weekday) continue
      const t = zonedTime(day, cfg.time, tz)
      if (t > now) continue
      const target = reportTarget(kind, day)
      return { kind, at: t, day, key: isoWeekKey(target?.ref ?? day), until: zonedTime(addDays(day, 2), '00:00', tz) }
    }
    return null
  }
  const dom = cfg.dayOfMonth ?? 1
  for (let back = 0; back < 2; back++) {
    const day = dayOfMonth(today, -back, dom)
    const t = zonedTime(day, cfg.time, tz)
    if (t > now) continue
    const target = reportTarget(kind, day)
    return { kind, at: t, day, key: (target?.ref ?? '').slice(0, 7), until: zonedTime(addDays(day, 3), '00:00', tz) }
  }
  return null
}

export interface DueSchedule extends Occurrence {
  catchUp: boolean
}

/**
 * Telegram schedules that must run now: enabled with the Telegram channel, the latest occurrence has passed, it is
 * still inside its catch-up window and `${kind}:${key}` is not in `sent`.
 */
export function dueSchedules(now: Date, schedules: ScheduleMap, sent: Set<string>, tz: string): DueSchedule[] {
  const out: DueSchedule[] = []
  for (const kind of SCHEDULE_KINDS) {
    const cfg = schedules[kind]
    if (!cfg?.enabled || !cfg.channels.telegram) continue
    const occ = lastOccurrence(kind, cfg, now, tz)
    if (!occ || now >= occ.until || sent.has(`${kind}:${occ.key}`)) continue
    out.push({ ...occ, catchUp: now.getTime() - occ.at.getTime() > 5 * 60_000 })
  }
  return out
}
