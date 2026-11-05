// Progress numbers computed from synced log rows (daily_stats is not synced – it is derived, like on the desktop).
import { addDays, localDateKey, parseDateKey, weekStart } from '@core/dates'
import { computeStreak, levelFromXp, levelTitle } from '@core/game'
import type { StreakInfo } from '@shared/types'
import {
  ActivitySchema,
  CoachReportSchema,
  LessonSchema,
  tableRows,
  UserProfileSchema,
  XpEventSchema,
  type Activity,
  type CoachReport,
  type Lesson,
  type SyncCache,
  type UserProfile,
  type XpEvent,
} from './sync'

export interface Bucket {
  key: string
  minutes: number
  words: number
  reviews: number
  xp: number
  lessons: number
}

const emptyBucket = (key: string): Bucket => ({ key, minutes: 0, words: 0, reviews: 0, xp: 0, lessons: 0 })

function add(b: Bucket, a: Activity) {
  b.minutes += a.minutes
  b.xp += a.xp
  if (a.action === 'word_saved') b.words++
  if (a.action === 'review_done') b.reviews++
  if (a.action === 'lesson_completed') b.lessons++
}

const round1 = (b: Bucket): Bucket => ({ ...b, minutes: Math.round(b.minutes * 10) / 10 })

/** Distinct local days with any activity (the desktop's definition of an "active day"). */
export function activeDays(activities: Activity[]): string[] {
  return [...new Set(activities.map((a) => a.date))].sort()
}

export function totalXp(events: XpEvent[]): number {
  return events.reduce((s, e) => s + e.amount, 0)
}

/** One bucket per day, oldest first, ending today. */
export function dailySeries(activities: Activity[], today: string, days: number): Bucket[] {
  const from = addDays(today, -(days - 1))
  const map = new Map<string, Bucket>()
  for (let i = 0; i < days; i++) {
    const k = addDays(from, i)
    map.set(k, emptyBucket(k))
  }
  for (const a of activities) {
    const b = map.get(a.date)
    if (b) add(b, a)
  }
  return [...map.values()].map(round1)
}

/** One bucket per week (key = Monday), oldest first, ending with the current week. */
export function weeklySeries(activities: Activity[], today: string, weeks: number): Bucket[] {
  const current = weekStart(today)
  const map = new Map<string, Bucket>()
  for (let i = weeks - 1; i >= 0; i--) {
    const k = addDays(current, -7 * i)
    map.set(k, emptyBucket(k))
  }
  for (const a of activities) {
    const b = map.get(weekStart(a.date))
    if (b) add(b, a)
  }
  return [...map.values()].map(round1)
}

const monthKey = (dateKey: string) => dateKey.slice(0, 7)

/** One bucket per calendar month (key = YYYY-MM), oldest first, ending with the current month. */
export function monthlySeries(activities: Activity[], today: string, months: number): Bucket[] {
  const d = parseDateKey(today)
  const map = new Map<string, Bucket>()
  for (let i = months - 1; i >= 0; i--) {
    const k = localDateKey(new Date(d.getFullYear(), d.getMonth() - i, 1)).slice(0, 7)
    map.set(k, emptyBucket(k))
  }
  for (const a of activities) {
    const b = map.get(monthKey(a.date))
    if (b) add(b, a)
  }
  return [...map.values()].map(round1)
}

export function sumBuckets(buckets: Bucket[]): Bucket {
  const t = emptyBucket('total')
  for (const b of buckets) {
    t.minutes += b.minutes
    t.words += b.words
    t.reviews += b.reviews
    t.xp += b.xp
    t.lessons += b.lessons
  }
  return round1(t)
}

export interface Overview {
  today: string
  streak: StreakInfo
  totalXp: number
  todayXp: number
  level: number
  levelTitle: string
  xpIntoLevel: number
  xpForNextLevel: number
  todayMinutes: number
  dailyGoal: number
  lessons: Lesson[]
  profile: UserProfile | null
}

export function todaysLessons(lessons: Lesson[], today: string): Lesson[] {
  return lessons.filter((l) => l.date === today).sort((a, b) => a.position - b.position || a.id - b.id)
}

export function overview(cache: SyncCache, now: Date): Overview {
  const today = localDateKey(now)
  const activities = tableRows(cache, 'activity_log', ActivitySchema).map((r) => r.row)
  const xp = tableRows(cache, 'xp_events', XpEventSchema).map((r) => r.row)
  const lessons = tableRows(cache, 'lessons', LessonSchema).map((r) => r.row)
  const profile = tableRows(cache, 'user_profile', UserProfileSchema)[0]?.row ?? null
  const total = totalXp(xp)
  const lvl = levelFromXp(total)
  return {
    today,
    streak: computeStreak(activeDays(activities), today),
    totalXp: total,
    todayXp: xp.filter((e) => e.date === today).reduce((s, e) => s + e.amount, 0),
    level: lvl.level,
    levelTitle: levelTitle(lvl.level),
    xpIntoLevel: lvl.xpIntoLevel,
    xpForNextLevel: lvl.xpForNextLevel,
    todayMinutes: Math.round(activities.filter((a) => a.date === today).reduce((s, a) => s + a.minutes, 0) * 10) / 10,
    dailyGoal: profile?.daily_minutes ?? 20,
    lessons: todaysLessons(lessons, today),
    profile,
  }
}

export function activities(cache: SyncCache): Activity[] {
  return tableRows(cache, 'activity_log', ActivitySchema).map((r) => r.row)
}

/** Coach reports, newest first. */
export function coachReports(cache: SyncCache): (CoachReport & { key: string })[] {
  return tableRows(cache, 'coach_reports', CoachReportSchema)
    .map(({ key, row }) => ({ ...row, key }))
    .sort((a, b) => b.created_at.localeCompare(a.created_at) || b.id - a.id)
}
