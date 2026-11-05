// Habit analytics for server reports: a time-zone aware port of src/modules/coach/main/analytics.ts (periods, study
// sessions, histograms, consistency, anomalies, deltas) fed from synced rows instead of SQLite.
import {
  addDays,
  computeStreak,
  dateKeyIn,
  diffDays,
  hourIn,
  isoWeekKey,
  monthEnd,
  monthStart,
  weekStart,
  weekdayOf,
} from './dates.ts'
import {
  dueCount,
  SKILLS,
  weakestSkills,
  type Cefr,
  type LearnerData,
  type RawActivity,
  type Skill,
} from './learner.ts'

export type CoachPeriod = 'day' | 'week' | 'month'

export interface Bilingual {
  en: string
  vi: string
}

export interface Delta {
  current: number
  previous: number
  change: number
  pct: number | null
}

export type DeltaKey =
  | 'studyMinutes'
  | 'appMinutes'
  | 'activeDays'
  | 'studySessions'
  | 'avgScore'
  | 'consistency'
  | 'wordsSaved'
  | 'reviews'
  | 'planRate'

export interface HabitAnomaly {
  code: string
  severity: 'info' | 'warning'
  en: string
  vi: string
}

export interface StudySession {
  start: string
  end: string
  minutes: number
  activities: number
}

export interface HabitStats {
  period: CoachPeriod
  key: string
  label: Bilingual
  from: string
  to: string
  elapsedDays: number
  activeDays: number
  studyMinutes: number
  appMinutes: number
  avgMinutesPerActiveDay: number
  dailyGoalMinutes: number
  goalRate: number
  appSessions: { count: number; medianMinutes: number; totalMinutes: number }
  studySessions: { count: number; medianMinutes: number; longestMinutes: number; list: StudySession[] }
  hourHistogram: number[]
  weekdayMinutes: number[]
  preferredHours: number[]
  preferredWeekdays: number[]
  moduleMix: { module: string; studyMinutes: number; activities: number }[]
  skillMix: { skill: Skill; minutes: number; share: number }[]
  weakestSkills: Skill[]
  weakSkillShare: number
  avgScore: number | null
  reviews: number
  reviewAccuracy: number | null
  wordsSaved: number
  reviewBacklog: number
  plan: { done: number; total: number; skipped: number; rate: number | null }
  quests: { completed: number; total: number }
  streak: { current: number; longest: number }
  consistency: number
  daily: { date: string; studyMinutes: number; activities: number }[]
  anomalies: HabitAnomaly[]
  deltas: Record<DeltaKey, Delta> | null
}

export interface PeriodRange {
  period: CoachPeriod
  key: string
  from: string
  to: string
  label: Bilingual
}

const pad = (x: number) => String(x).padStart(2, '0')
const dm = (key: string) => `${key.slice(8, 10)}/${key.slice(5, 7)}`
const round1 = (x: number) => Math.round(x * 10) / 10

export function periodRange(period: CoachPeriod, today: string, offset = 0): PeriodRange {
  if (period === 'day') {
    const d = addDays(today, offset)
    const label = `${dm(d)}/${d.slice(0, 4)}`
    return { period, key: d, from: d, to: d, label: { en: label, vi: `Ngày ${label}` } }
  }
  if (period === 'week') {
    const from = addDays(weekStart(today), offset * 7)
    const to = addDays(from, 6)
    const key = isoWeekKey(from)
    const wk = key.slice(-2)
    return {
      period,
      key,
      from,
      to,
      label: { en: `Week ${wk} · ${dm(from)}–${dm(to)}`, vi: `Tuần ${wk} · ${dm(from)}–${dm(to)}` },
    }
  }
  const from = monthStart(today, offset)
  const to = monthEnd(from)
  const mm = `${from.slice(5, 7)}/${from.slice(0, 4)}`
  return { period, key: from.slice(0, 7), from, to, label: { en: mm, vi: `Tháng ${mm}` } }
}

export function elapsedDays(from: string, to: string, today: string): number {
  const end = to < today ? to : today
  return Math.max(1, diffDays(end, from) + 1)
}

export function dateKeys(from: string, to: string): string[] {
  const out: string[] = []
  for (let d = from; d <= to && out.length < 400; d = addDays(d, 1)) out.push(d)
  return out
}

/** Monday = 0 … Sunday = 6. */
export const weekdayIndex = (key: string) => (weekdayOf(key) + 6) % 7

export function median(values: number[]): number {
  if (!values.length) return 0
  const v = [...values].sort((a, b) => a - b)
  const mid = Math.floor(v.length / 2)
  return v.length % 2 ? (v[mid] as number) : ((v[mid - 1] as number) + (v[mid] as number)) / 2
}

export function topIndexes(values: number[], k: number): number[] {
  return values
    .map((v, i) => ({ v, i }))
    .filter((x) => x.v > 0)
    .sort((a, b) => b.v - a.v || a.i - b.i)
    .slice(0, k)
    .map((x) => x.i)
}

export function skillForModule(module: string): Skill | null {
  switch (module) {
    case 'reading':
    case 'listening':
    case 'writing':
    case 'speaking':
    case 'grammar':
    case 'vocabulary':
      return module
    case 'cinema':
      return 'listening'
    case 'tutor':
      return 'speaking'
    default:
      return null
  }
}

const activitySkill = (a: RawActivity): Skill | null =>
  a.skill ?? (a.action === 'review_done' || a.action === 'word_saved' ? 'vocabulary' : skillForModule(a.module))

export function clusterStudySessions(activities: RawActivity[], gapMinutes = 30): StudySession[] {
  const items = activities
    .map((a) => {
      const end = new Date(a.createdAt).getTime()
      return { start: end - Math.max(0, a.minutes) * 60_000, end, minutes: Math.max(0, a.minutes) }
    })
    .filter((x) => Number.isFinite(x.end))
    .sort((a, b) => a.start - b.start)
  const out: { start: number; end: number; minutes: number; activities: number }[] = []
  for (const it of items) {
    const last = out[out.length - 1]
    if (last && it.start - last.end <= gapMinutes * 60_000) {
      last.end = Math.max(last.end, it.end)
      last.minutes += it.minutes
      last.activities++
    } else out.push({ ...it, activities: 1 })
  }
  return out.map((x) => ({
    start: new Date(x.start).toISOString(),
    end: new Date(x.end).toISOString(),
    minutes: round1(x.minutes),
    activities: x.activities,
  }))
}

export function consistencyScore(active: number, elapsed: number, startHours: number[]): number {
  if (!active || !elapsed) return 0
  const ratio = Math.min(1, active / elapsed)
  let regular = 0
  if (startHours.length) {
    const counts = new Array<number>(24).fill(0)
    for (const h of startHours) counts[h] = (counts[h] ?? 0) + 1
    const peak = topIndexes(counts, 1)[0] ?? 0
    const near = startHours.filter((h) => Math.min(Math.abs(h - peak), 24 - Math.abs(h - peak)) <= 2).length
    regular = near / startHours.length
  }
  return Math.round(100 * (0.7 * ratio + 0.3 * regular))
}

export const SKILL_VI_LOWER: Record<Skill, string> = {
  vocabulary: 'từ vựng',
  grammar: 'ngữ pháp',
  reading: 'đọc',
  listening: 'nghe',
  writing: 'viết',
  speaking: 'nói',
}

export function longestGap(active: Set<string>, from: string, end: string): number {
  let best = 0
  let run = 0
  for (const d of dateKeys(from, end)) {
    run = active.has(d) ? 0 : run + 1
    best = Math.max(best, run)
  }
  return best
}

export function detectAnomalies(st: Omit<HabitStats, 'anomalies' | 'deltas'>, today: string): HabitAnomaly[] {
  const out: HabitAnomaly[] = []
  const end = st.to < today ? st.to : today
  const active = new Set(st.daily.filter((d) => d.studyMinutes > 0 || d.activities > 0).map((d) => d.date))
  if (st.period !== 'day') {
    const gap = longestGap(active, st.from, end)
    if (!active.size && st.elapsedDays >= 2)
      out.push({
        code: 'no_activity',
        severity: 'warning',
        en: `No study at all in ${st.elapsedDays} days.`,
        vi: `Chưa học buổi nào trong ${st.elapsedDays} ngày.`,
      })
    else if (gap >= 3)
      out.push({
        code: 'long_gap',
        severity: 'warning',
        en: `A gap of ${gap} days without study.`,
        vi: `Có ${gap} ngày liền không học.`,
      })
    const maxDay = Math.max(0, ...st.daily.map((d) => d.studyMinutes))
    if (
      st.activeDays >= 1 &&
      st.studyMinutes >= 40 &&
      maxDay >= 40 &&
      maxDay / st.studyMinutes >= 0.6 &&
      st.elapsedDays >= 4
    )
      out.push({
        code: 'cramming',
        severity: 'warning',
        en: `${Math.round((maxDay / st.studyMinutes) * 100)}% of the study time was crammed into one day.`,
        vi: `${Math.round((maxDay / st.studyMinutes) * 100)}% thời gian học dồn vào một ngày (học dồn).`,
      })
  }
  const weak = st.weakestSkills[0]
  if (weak && st.studyMinutes >= 30 && st.weakSkillShare < 0.1)
    out.push({
      code: 'skipping_weak_skill',
      severity: 'warning',
      en: `Your weakest skill (${weak}) got less than 10% of the study time.`,
      vi: `Kỹ năng yếu nhất (${SKILL_VI_LOWER[weak]}) chỉ chiếm dưới 10% thời gian học.`,
    })
  const late = [23, 0, 1, 2, 3, 4].reduce((sum, h) => sum + (st.hourHistogram[h] ?? 0), 0)
  if (st.studyMinutes >= 20 && late / st.studyMinutes >= 0.4)
    out.push({
      code: 'late_night',
      severity: 'info',
      en: 'Much of the study happens after 23:00 – memory works better after sleep-friendly sessions.',
      vi: 'Phần lớn thời gian học diễn ra sau 23:00 – học sớm hơn giúp ghi nhớ tốt hơn.',
    })
  if (st.plan.total >= 3 && st.plan.rate !== null && st.plan.rate < 0.4)
    out.push({
      code: 'low_plan_completion',
      severity: 'warning',
      en: `Only ${Math.round(st.plan.rate * 100)}% of the planned lessons were completed.`,
      vi: `Chỉ hoàn thành ${Math.round(st.plan.rate * 100)}% bài trong kế hoạch.`,
    })
  if (st.reviewBacklog >= 30)
    out.push({
      code: 'review_backlog',
      severity: 'warning',
      en: `${st.reviewBacklog} flashcards are overdue.`,
      vi: `${st.reviewBacklog} thẻ từ đang quá hạn ôn.`,
    })
  return out
}

export interface HabitInput {
  range: PeriodRange
  today: string
  timezone: string
  activities: RawActivity[]
  sessions: { date: string; activeSeconds: number }[]
  reviews: { reviewedAt: string; rating: number }[]
  plan: { date: string; status: 'todo' | 'done' | 'skipped' }[]
  quests: { completed: boolean }[]
  allActiveDays: string[]
  reviewBacklog: number
  skillLevels: { skill: Skill; cefr: Cefr; score: number }[]
  dailyGoalMinutes: number
}

export function computeHabitStats(input: HabitInput): HabitStats {
  const { range, today, timezone } = input
  const end = range.to < today ? range.to : today
  const elapsed = elapsedDays(range.from, range.to, today)
  const inRange = (d: string) => d >= range.from && d <= range.to
  const acts = input.activities.filter((a) => inRange(a.date))
  const sessions = input.sessions.filter((x) => inRange(x.date))
  const daily = new Map(dateKeys(range.from, range.to).map((d) => [d, { date: d, studyMinutes: 0, activities: 0 }]))
  const hourHistogram = new Array<number>(24).fill(0)
  const weekdayMinutes = new Array<number>(7).fill(0)
  const modules = new Map<string, { module: string; studyMinutes: number; activities: number }>()
  const skillMinutes = Object.fromEntries(SKILLS.map((x) => [x, 0])) as Record<Skill, number>
  const scores: number[] = []
  let studyMinutes = 0
  let wordsSaved = 0
  for (const a of acts) {
    const m = Math.max(0, a.minutes)
    studyMinutes += m
    const d = daily.get(a.date)
    if (d) {
      d.studyMinutes += m
      d.activities++
    }
    const h = hourIn(a.createdAt, timezone)
    hourHistogram[h] = (hourHistogram[h] ?? 0) + m
    const wd = weekdayIndex(a.date)
    weekdayMinutes[wd] = (weekdayMinutes[wd] ?? 0) + m
    let row = modules.get(a.module)
    if (!row) modules.set(a.module, (row = { module: a.module, studyMinutes: 0, activities: 0 }))
    row.studyMinutes += m
    row.activities++
    const sk = activitySkill(a)
    if (sk) skillMinutes[sk] += m
    if (a.score !== null && Number.isFinite(a.score)) scores.push(Math.max(0, Math.min(1, a.score)))
    if (a.action === 'word_saved') wordsSaved++
  }
  const sessionSeconds = sessions.reduce((sum, x) => sum + x.activeSeconds, 0)
  const activeDaySet = new Set(acts.map((a) => a.date))
  const study = clusterStudySessions(acts)
  const startHours = study.map((x) => hourIn(x.start, timezone))
  const totalSkill = SKILLS.reduce((sum, x) => sum + skillMinutes[x], 0)
  const weakest = weakestSkills(input.skillLevels, 2)
  const weakMinutes = weakest.reduce((sum, x) => sum + skillMinutes[x], 0)
  const fromIso = range.from
  const reviews = input.reviews.filter((r) => {
    const day = r.reviewedAt ? dateKeyIn(new Date(r.reviewedAt), timezone) : ''
    return day >= fromIso && day <= range.to
  })
  const planCounted = input.plan.filter((p) => inRange(p.date) && p.date <= end)
  const planDone = planCounted.filter((p) => p.status === 'done').length
  const streak = computeStreak(
    input.allActiveDays.filter((d) => d <= end),
    end,
  )
  const base: Omit<HabitStats, 'anomalies' | 'deltas'> = {
    period: range.period,
    key: range.key,
    label: range.label,
    from: range.from,
    to: range.to,
    elapsedDays: elapsed,
    activeDays: activeDaySet.size,
    studyMinutes: round1(studyMinutes),
    appMinutes: round1(sessionSeconds / 60),
    avgMinutesPerActiveDay: activeDaySet.size ? round1(studyMinutes / activeDaySet.size) : 0,
    dailyGoalMinutes: input.dailyGoalMinutes,
    goalRate: input.dailyGoalMinutes ? round1((studyMinutes / (input.dailyGoalMinutes * elapsed)) * 100) / 100 : 0,
    appSessions: {
      count: sessions.length,
      medianMinutes: round1(median(sessions.map((x) => x.activeSeconds / 60))),
      totalMinutes: round1(sessionSeconds / 60),
    },
    studySessions: {
      count: study.length,
      medianMinutes: round1(median(study.map((x) => x.minutes))),
      longestMinutes: Math.max(0, ...study.map((x) => x.minutes)),
      list: study.slice(-60),
    },
    hourHistogram: hourHistogram.map(round1),
    weekdayMinutes: weekdayMinutes.map(round1),
    preferredHours: topIndexes(hourHistogram, 3),
    preferredWeekdays: topIndexes(weekdayMinutes, 2),
    moduleMix: [...modules.values()]
      .map((r) => ({ ...r, studyMinutes: round1(r.studyMinutes) }))
      .sort((a, b) => b.studyMinutes - a.studyMinutes),
    skillMix: SKILLS.map((x) => ({
      skill: x,
      minutes: round1(skillMinutes[x]),
      share: totalSkill ? Math.round((skillMinutes[x] / totalSkill) * 100) / 100 : 0,
    })),
    weakestSkills: weakest,
    weakSkillShare: totalSkill ? Math.round((weakMinutes / totalSkill) * 100) / 100 : 0,
    avgScore: scores.length ? Math.round((scores.reduce((a, b) => a + b, 0) / scores.length) * 100) / 100 : null,
    reviews: reviews.length,
    reviewAccuracy: reviews.length
      ? Math.round((reviews.filter((r) => r.rating >= 3).length / reviews.length) * 100) / 100
      : null,
    wordsSaved,
    reviewBacklog: input.reviewBacklog,
    plan: {
      done: planDone,
      total: planCounted.length,
      skipped: planCounted.filter((p) => p.status === 'skipped').length,
      rate: planCounted.length ? Math.round((planDone / planCounted.length) * 100) / 100 : null,
    },
    quests: { completed: input.quests.filter((q) => q.completed).length, total: input.quests.length },
    streak: { current: streak.current, longest: streak.longest },
    consistency: consistencyScore(activeDaySet.size, elapsed, startHours),
    daily: [...daily.values()].map((d) => ({ ...d, studyMinutes: round1(d.studyMinutes) })),
  }
  return { ...base, anomalies: detectAnomalies(base, today), deltas: null }
}

export function delta(current: number, previous: number): Delta {
  return {
    current,
    previous,
    change: round1(current - previous),
    pct: previous ? Math.round(((current - previous) / previous) * 100) : null,
  }
}

const DELTA_PICK: Record<DeltaKey, (x: HabitStats) => number> = {
  studyMinutes: (x) => x.studyMinutes,
  appMinutes: (x) => x.appMinutes,
  activeDays: (x) => x.activeDays,
  studySessions: (x) => x.studySessions.count,
  avgScore: (x) => Math.round((x.avgScore ?? 0) * 100),
  consistency: (x) => x.consistency,
  wordsSaved: (x) => x.wordsSaved,
  reviews: (x) => x.reviews,
  planRate: (x) => Math.round((x.plan.rate ?? 0) * 100),
}

export function withDeltas(current: HabitStats, previous: HabitStats): HabitStats {
  const deltas = Object.fromEntries(
    (Object.keys(DELTA_PICK) as DeltaKey[]).map((k) => [k, delta(DELTA_PICK[k](current), DELTA_PICK[k](previous))]),
  ) as Record<DeltaKey, Delta>
  return { ...current, deltas }
}

export const hourLabel = (h: number) => `${pad(h)}:00`

export function planDates(period: CoachPeriod, today: string): string[] {
  const k = period === 'day' ? 1 : 7
  return Array.from({ length: k }, (_, i) => addDays(today, i + 1))
}

// ---------- from synced learner data ----------
function habitInput(d: LearnerData, range: PeriodRange, now: Date): HabitInput {
  const today = dateKeyIn(now, d.timezone)
  return {
    range,
    today,
    timezone: d.timezone,
    activities: d.activities,
    sessions: d.sessions,
    reviews: d.reviews,
    plan: d.lessons,
    quests: d.quests.filter(
      (q) => q.period === 'daily' && q.periodKey >= range.from && q.periodKey <= range.to && q.periodKey <= today,
    ),
    allActiveDays: [...new Set(d.activities.map((a) => a.date))].sort(),
    reviewBacklog: dueCount(d, now),
    skillLevels: d.skills,
    dailyGoalMinutes: d.profile.dailyMinutes,
  }
}

/** Statistics of the period containing `ref` (default: today) with deltas against the previous period. */
export function statsFor(d: LearnerData, period: CoachPeriod, now: Date, ref?: string): HabitStats {
  const base = ref ?? dateKeyIn(now, d.timezone)
  const cur = computeHabitStats(habitInput(d, periodRange(period, base, 0), now))
  const prev = computeHabitStats(habitInput(d, periodRange(period, base, -1), now))
  return withDeltas(cur, prev)
}

/** Last 28 days profile (briefs, nudges, /habits). */
export function profile28(d: LearnerData, now: Date): HabitStats {
  const today = dateKeyIn(now, d.timezone)
  return computeHabitStats(
    habitInput(
      d,
      {
        period: 'month',
        key: `last28:${today}`,
        from: addDays(today, -27),
        to: today,
        label: { en: 'Last 28 days', vi: '28 ngày qua' },
      },
      now,
    ),
  )
}
