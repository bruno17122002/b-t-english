// Calendar helpers for the server. The Edge runtime clock is UTC, but learning days, schedules and reports follow the
// learner's own time zone (profiles.timezone), so everything here takes an IANA zone explicitly and never uses
// local Date getters. Date keys are "YYYY-MM-DD"; key arithmetic is done in UTC so it is time-zone free.

export const DEFAULT_TIMEZONE = 'Asia/Ho_Chi_Minh'

const pad = (n: number) => String(n).padStart(2, '0')

const formatters = new Map<string, Intl.DateTimeFormat>()

/** True when the runtime knows the IANA zone. */
export function validTimeZone(tz: string | null | undefined): tz is string {
  if (!tz) return false
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz })
    return true
  } catch {
    return false
  }
}

function formatter(tz: string): Intl.DateTimeFormat {
  let f = formatters.get(tz)
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    })
    formatters.set(tz, f)
  }
  return f
}

export interface ZonedParts {
  year: number
  month: number
  day: number
  hour: number
  minute: number
  second: number
}

/** Wall-clock fields of an instant in a time zone. */
export function zonedParts(d: Date, tz: string): ZonedParts {
  const out: Record<string, number> = {}
  for (const p of formatter(tz).formatToParts(d)) if (p.type !== 'literal') out[p.type] = Number(p.value)
  return {
    year: out.year ?? 1970,
    month: out.month ?? 1,
    day: out.day ?? 1,
    hour: (out.hour ?? 0) % 24,
    minute: out.minute ?? 0,
    second: out.second ?? 0,
  }
}

/** Calendar day of an instant in the zone. */
export function dateKeyIn(d: Date, tz: string): string {
  const p = zonedParts(d, tz)
  return `${p.year}-${pad(p.month)}-${pad(p.day)}`
}

/** Hour 0..23 of an ISO timestamp in the zone. */
export function hourIn(iso: string | Date, tz: string): number {
  return zonedParts(typeof iso === 'string' ? new Date(iso) : iso, tz).hour
}

/** Offset of the zone from UTC at an instant, in milliseconds (e.g. +7 h for Asia/Ho_Chi_Minh). */
export function tzOffsetMs(d: Date, tz: string): number {
  const p = zonedParts(d, tz)
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second)
  return asUtc - Math.floor(d.getTime() / 1000) * 1000
}

/** The instant at which the wall clock in `tz` shows `dateKey` `time` ("HH:MM"). */
export function zonedTime(dateKey: string, time: string, tz: string): Date {
  const [y, m, d] = dateKey.split('-').map(Number)
  const [h, min] = time.split(':').map(Number)
  const guess = Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1, h ?? 0, min ?? 0)
  let t = guess - tzOffsetMs(new Date(guess), tz)
  // Re-check once around DST transitions.
  const second = guess - tzOffsetMs(new Date(t), tz)
  if (second !== t) t = second
  return new Date(t)
}

// ---------- pure date-key arithmetic ----------
function keyToUtc(key: string): Date {
  const [y, m, d] = key.split('-').map(Number)
  return new Date(Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1))
}

function utcToKey(d: Date): string {
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`
}

export function addDays(key: string, days: number): string {
  const d = keyToUtc(key)
  d.setUTCDate(d.getUTCDate() + days)
  return utcToKey(d)
}

export function diffDays(a: string, b: string): number {
  return Math.round((keyToUtc(a).getTime() - keyToUtc(b).getTime()) / 86_400_000)
}

/** 0 = Sunday … 6 = Saturday. */
export function weekdayOf(key: string): number {
  return keyToUtc(key).getUTCDay()
}

/** First day of a month shifted by `monthOffset` months, as a key. */
export function monthStart(key: string, monthOffset = 0): string {
  const d = keyToUtc(key)
  return utcToKey(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + monthOffset, 1)))
}

/** Last day of the month containing `key`. */
export function monthEnd(key: string): string {
  const d = keyToUtc(key)
  return utcToKey(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)))
}

/** Day `dom` of the month containing `key` shifted by `monthOffset`. */
export function dayOfMonth(key: string, monthOffset: number, dom: number): string {
  const d = keyToUtc(key)
  return utcToKey(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + monthOffset, dom)))
}

/** ISO-8601 week key of a date key, e.g. 2026-W45. */
export function isoWeekKey(key: string): string {
  const date = keyToUtc(key)
  const day = date.getUTCDay() || 7
  date.setUTCDate(date.getUTCDate() + 4 - day)
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1))
  const week = Math.ceil(((date.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7)
  return `${date.getUTCFullYear()}-W${pad(week)}`
}

/** Monday of the week containing the key. */
export function weekStart(key: string): string {
  const day = weekdayOf(key) || 7
  return addDays(key, 1 - day)
}

export function hashString(s: string): number {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

// ---------- streak (port of computeStreak in src/core/game.ts) ----------
export interface StreakInfo {
  current: number
  longest: number
  activeToday: boolean
}

function longestStreak(days: string[]): number {
  const sorted = [...new Set(days)].sort()
  let best = 0
  let run = 0
  let lastRest: string | null = null
  for (let i = 0; i < sorted.length; i++) {
    const day = sorted[i] as string
    const prev = sorted[i - 1]
    if (!prev) run = 1
    else {
      const gap = diffDays(day, prev)
      if (gap === 1) run++
      else if (gap === 2 && (lastRest === null || diffDays(day, lastRest) > 7)) {
        run++
        lastRest = addDays(prev, 1)
      } else {
        run = 1
        lastRest = null
      }
    }
    best = Math.max(best, run)
  }
  return best
}

/** Streak with forgiving rest days, identical rules to the desktop app. */
export function computeStreak(activeDays: string[], today: string): StreakInfo {
  const set = new Set(activeDays)
  const activeToday = set.has(today)
  let cursor = activeToday ? today : addDays(today, -1)
  let current = 0
  let lastRest: string | null = null
  const earliest = activeDays.length ? activeDays.reduce((a, b) => (a < b ? a : b)) : today
  while (cursor >= earliest) {
    if (set.has(cursor)) {
      current++
      cursor = addDays(cursor, -1)
      continue
    }
    const prev = addDays(cursor, -1)
    const pendingToday = !activeToday && cursor === addDays(today, -1)
    const canRest =
      set.has(prev) && (current > 0 || pendingToday) && (lastRest === null || diffDays(lastRest, cursor) >= 7)
    if (!canRest) break
    lastRest = cursor
    cursor = prev
  }
  return { current, longest: Math.max(longestStreak(activeDays), current), activeToday }
}
