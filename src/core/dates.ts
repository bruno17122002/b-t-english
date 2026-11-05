// Local-calendar date helpers. Learning days follow the learner's local midnight, not UTC.

const pad = (n: number) => String(n).padStart(2, '0')

export function localDateKey(d: Date = new Date()): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

export function parseDateKey(key: string): Date {
  const [y, m, d] = key.split('-').map(Number)
  return new Date(y ?? 1970, (m ?? 1) - 1, d ?? 1)
}

export function addDays(key: string, days: number): string {
  const d = parseDateKey(key)
  d.setDate(d.getDate() + days)
  return localDateKey(d)
}

export function diffDays(a: string, b: string): number {
  // Round to tolerate DST shifts.
  return Math.round((parseDateKey(a).getTime() - parseDateKey(b).getTime()) / 86_400_000)
}

/** ISO-8601 week key, e.g. 2026-W45 (weeks start on Monday). */
export function isoWeekKey(d: Date = new Date()): string {
  const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()))
  const day = date.getUTCDay() || 7
  date.setUTCDate(date.getUTCDate() + 4 - day)
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1))
  const week = Math.ceil(((date.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7)
  return `${date.getUTCFullYear()}-W${pad(week)}`
}

/** Monday of the week containing the given date key. */
export function weekStart(key: string): string {
  const d = parseDateKey(key)
  const day = d.getDay() || 7
  return addDays(key, 1 - day)
}

/** Deterministic 32-bit hash for seeding per-day choices. */
export function hashString(s: string): number {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

/** Small seeded PRNG (mulberry32) so daily quests / plans are stable within a day. */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
