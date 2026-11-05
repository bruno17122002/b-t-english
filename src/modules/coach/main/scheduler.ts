// Pure scheduling logic of the coach module: default schedules, parsing of stored JSON and the due-time
// computation with catch-up (once, inside the same period) and double-send protection via last-sent keys.
import { addDays, isoWeekKey, localDateKey, parseDateKey } from '@core/dates'
import type { CoachPeriod, ScheduleConfig, ScheduleKind, ScheduleMap } from '../types'

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

/** Merges stored (possibly partial or malformed) JSON over the defaults. */
export function parseSchedules(raw: string | null, defaults: ScheduleMap): ScheduleMap {
  let stored: Partial<Record<ScheduleKind, Partial<ScheduleConfig>>> = {}
  try {
    stored = raw ? (JSON.parse(raw) as typeof stored) : {}
  } catch {
    stored = {}
  }
  const out = { ...defaults }
  for (const kind of SCHEDULE_KINDS) out[kind] = mergeSchedule(defaults[kind], stored?.[kind])
  return out
}

export function mergeSchedule(base: ScheduleConfig, patch: Partial<ScheduleConfig> | undefined): ScheduleConfig {
  if (!patch || typeof patch !== 'object') return base
  const next: ScheduleConfig = {
    enabled: typeof patch.enabled === 'boolean' ? patch.enabled : base.enabled,
    time: typeof patch.time === 'string' && TIME.test(patch.time) ? patch.time : base.time,
    channels: {
      app: typeof patch.channels?.app === 'boolean' ? patch.channels.app : base.channels.app,
      telegram: typeof patch.channels?.telegram === 'boolean' ? patch.channels.telegram : base.channels.telegram,
    },
  }
  const valid = (v: unknown, lo: number, hi: number): v is number =>
    typeof v === 'number' && Number.isInteger(v) && v >= lo && v <= hi
  const weekday = valid(patch.weekday, 0, 6) ? patch.weekday : base.weekday
  if (weekday !== undefined) next.weekday = weekday
  const dom = valid(patch.dayOfMonth, 1, 28) ? patch.dayOfMonth : base.dayOfMonth
  if (dom !== undefined) next.dayOfMonth = dom
  return next
}

const at = (dateKey: string, time: string): Date => {
  const d = parseDateKey(dateKey)
  const [h, m] = time.split(':').map(Number)
  d.setHours(h ?? 0, m ?? 0, 0, 0)
  return d
}

/** Reported period and its key for a schedule occurrence. */
export function reportTarget(kind: ScheduleKind, occurrence: Date): { period: CoachPeriod; ref: string } | null {
  const day = localDateKey(occurrence)
  if (kind === 'dailyReport') return { period: 'day', ref: day }
  if (kind === 'weeklyReport') {
    // Sent on the weekend → the week that is ending; on another weekday → the previous (complete) week.
    const wd = occurrence.getDay()
    return { period: 'week', ref: wd === 0 || wd === 6 ? day : addDays(day, -7) }
  }
  if (kind === 'monthlyReport') {
    const prev = new Date(occurrence.getFullYear(), occurrence.getMonth() - 1, 1)
    return { period: 'month', ref: localDateKey(prev) }
  }
  return null
}

export interface Occurrence {
  kind: ScheduleKind
  /** Scheduled time of the most recent occurrence ≤ now. */
  at: Date
  /** Last-sent key: day for daily kinds, ISO week of the reported week, YYYY-MM of the reported month. */
  key: string
  /** Latest moment the occurrence may still be caught up. */
  until: Date
}

/** Most recent occurrence of a schedule at or before `now` (null if none qualifies). */
export function lastOccurrence(kind: ScheduleKind, cfg: ScheduleConfig, now: Date): Occurrence | null {
  const today = localDateKey(now)
  if (kind === 'morningBrief' || kind === 'eveningReminder' || kind === 'dailyReport') {
    const t = at(today, cfg.time)
    if (t > now) return null
    // Catch-up only on the same day.
    return { kind, at: t, key: today, until: at(addDays(today, 1), '00:00') }
  }
  if (kind === 'weeklyReport') {
    const weekday = cfg.weekday ?? 0
    for (let back = 0; back < 8; back++) {
      const day = addDays(today, -back)
      if (parseDateKey(day).getDay() !== weekday) continue
      const t = at(day, cfg.time)
      if (t > now) continue
      const target = reportTarget(kind, t)
      // Catch-up until the end of the following day.
      return { kind, at: t, key: isoWeekKey(parseDateKey(target?.ref ?? day)), until: at(addDays(day, 2), '00:00') }
    }
    return null
  }
  const dom = cfg.dayOfMonth ?? 1
  for (let back = 0; back < 2; back++) {
    const first = new Date(now.getFullYear(), now.getMonth() - back, dom)
    const t = at(localDateKey(first), cfg.time)
    if (t > now) continue
    const target = reportTarget(kind, t)
    // Catch-up within three days of the scheduled day.
    return { kind, at: t, key: (target?.ref ?? '').slice(0, 7), until: at(addDays(localDateKey(first), 3), '00:00') }
  }
  return null
}

export interface DueSchedule extends Occurrence {
  /** True when the scheduled time was missed by more than 5 minutes (the app was off or asleep). */
  catchUp: boolean
}

/**
 * Schedules that must run now: enabled, the latest occurrence has passed, it is still inside its catch-up
 * window and it was not sent before (lastSent[kind] !== key).
 */
export function dueSchedules(
  now: Date,
  schedules: ScheduleMap,
  lastSent: Partial<Record<ScheduleKind, string>>,
): DueSchedule[] {
  const out: DueSchedule[] = []
  for (const kind of SCHEDULE_KINDS) {
    const cfg = schedules[kind]
    if (!cfg?.enabled || (!cfg.channels.app && !cfg.channels.telegram)) continue
    const occ = lastOccurrence(kind, cfg, now)
    if (!occ || now >= occ.until || lastSent[kind] === occ.key) continue
    out.push({ ...occ, catchUp: now.getTime() - occ.at.getTime() > 5 * 60_000 })
  }
  return out
}

/** Next scheduled time of each enabled schedule (for display). */
export function nextRuns(now: Date, schedules: ScheduleMap): { kind: ScheduleKind; at: string }[] {
  const out: { kind: ScheduleKind; at: string }[] = []
  for (const kind of SCHEDULE_KINDS) {
    const cfg = schedules[kind]
    if (!cfg.enabled) continue
    const today = localDateKey(now)
    for (let ahead = 0; ahead < 62; ahead++) {
      const day = addDays(today, ahead)
      const d = parseDateKey(day)
      if (kind === 'weeklyReport' && d.getDay() !== (cfg.weekday ?? 0)) continue
      if (kind === 'monthlyReport' && d.getDate() !== (cfg.dayOfMonth ?? 1)) continue
      const t = at(day, cfg.time)
      if (t <= now) continue
      out.push({ kind, at: t.toISOString() })
      break
    }
  }
  return out.sort((a, b) => (a.at < b.at ? -1 : 1))
}
