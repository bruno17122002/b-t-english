// Pure habit analytics of the coach module (no DB, no Electron): period ranges, study-session clustering,
// histograms, consistency score, anomaly detection and period-over-period deltas. Unit tested.
import type { Cefr } from '@shared/content'
import type { Skill } from '@shared/types'
import { SKILLS } from '@shared/types'
import { addDays, diffDays, isoWeekKey, parseDateKey, weekStart } from '@core/dates'
import { computeStreak } from '@core/game'
import { weakestSkills } from '@core/roadmap'
import type {
  Bilingual,
  CoachPeriod,
  DailyHabit,
  Delta,
  DeltaKey,
  HabitAnomaly,
  HabitStats,
  StudySession,
} from '../types'

// ---------- periods ----------
export interface PeriodRange {
  period: CoachPeriod
  key: string
  from: string
  to: string
  label: Bilingual
}

const pad = (n: number) => String(n).padStart(2, '0')
const dm = (key: string) => `${key.slice(8, 10)}/${key.slice(5, 7)}`

/** Range of the day / ISO week (Mon–Sun) / calendar month containing `today`, shifted by `offset` periods. */
export function periodRange(period: CoachPeriod, today: string, offset = 0): PeriodRange {
  if (period === 'day') {
    const d = addDays(today, offset)
    const label = `${dm(d)}/${d.slice(0, 4)}`
    return { period, key: d, from: d, to: d, label: { en: label, vi: `Ngày ${label}` } }
  }
  if (period === 'week') {
    const from = addDays(weekStart(today), offset * 7)
    const to = addDays(from, 6)
    const key = isoWeekKey(parseDateKey(from))
    const n = key.slice(-2)
    return {
      period,
      key,
      from,
      to,
      label: { en: `Week ${n} · ${dm(from)}–${dm(to)}`, vi: `Tuần ${n} · ${dm(from)}–${dm(to)}` },
    }
  }
  const base = parseDateKey(today)
  const first = new Date(base.getFullYear(), base.getMonth() + offset, 1)
  const last = new Date(first.getFullYear(), first.getMonth() + 1, 0)
  const from = `${first.getFullYear()}-${pad(first.getMonth() + 1)}-01`
  const to = `${last.getFullYear()}-${pad(last.getMonth() + 1)}-${pad(last.getDate())}`
  const mm = `${pad(first.getMonth() + 1)}/${first.getFullYear()}`
  return { period, key: from.slice(0, 7), from, to, label: { en: mm, vi: `Tháng ${mm}` } }
}

/** Number of days of [from, to] that have started by `today` (at least 1). */
export function elapsedDays(from: string, to: string, today: string): number {
  const end = to < today ? to : today
  return Math.max(1, diffDays(end, from) + 1)
}

/** Every date key in [from, to]. */
export function dateKeys(from: string, to: string): string[] {
  const out: string[] = []
  for (let d = from; d <= to && out.length < 400; d = addDays(d, 1)) out.push(d)
  return out
}

/** Local hour (0..23) of an ISO timestamp. */
export const hourOf = (iso: string) => new Date(iso).getHours()

/** Monday = 0 … Sunday = 6. */
export const weekdayIndex = (dateKey: string) => (parseDateKey(dateKey).getDay() + 6) % 7

export function median(values: number[]): number {
  if (!values.length) return 0
  const s = [...values].sort((a, b) => a - b)
  const mid = Math.floor(s.length / 2)
  return s.length % 2 ? (s[mid] as number) : ((s[mid - 1] as number) + (s[mid] as number)) / 2
}

const round1 = (n: number) => Math.round(n * 10) / 10

/** Indexes of the `n` largest positive values (ties: lower index first). */
export function topIndexes(values: number[], n: number): number[] {
  return values
    .map((v, i) => ({ v, i }))
    .filter((x) => x.v > 0)
    .sort((a, b) => b.v - a.v || a.i - b.i)
    .slice(0, n)
    .map((x) => x.i)
}

// ---------- raw data ----------
export interface RawActivity {
  createdAt: string
  date: string
  module: string
  action: string
  skill: Skill | null
  minutes: number
  score: number | null
}

export interface RawSession {
  id: string
  startedAt: string
  lastActiveAt: string
  date: string
  activeSeconds: number
}

export interface RawView {
  module: string
  date: string
  hour: number
  activeSeconds: number
}

export interface HabitInput {
  range: PeriodRange
  today: string
  activities: RawActivity[]
  sessions: RawSession[]
  views: RawView[]
  reviews: { reviewedAt: string; rating: number }[]
  plan: { date: string; status: 'todo' | 'done' | 'skipped' }[]
  quests: { completed: boolean }[]
  /** Evening reminders / morning briefs sent in the range. */
  reminders: { sentAt: string }[]
  /** Every active day up to the end of the range (for the streak). */
  allActiveDays: string[]
  reviewBacklog: number
  skillLevels: { skill: Skill; cefr: Cefr; score: number }[]
  dailyGoalMinutes: number
}

/** Skill credited by a module when the activity row has none. */
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

// ---------- study sessions ----------
/** Clusters learning activities into study sessions: a gap of more than `gapMinutes` starts a new session. */
export function clusterStudySessions(activities: RawActivity[], gapMinutes = 30): StudySession[] {
  const items = activities
    .map((a) => {
      const end = new Date(a.createdAt).getTime()
      return { start: end - Math.max(0, a.minutes) * 60_000, end, minutes: Math.max(0, a.minutes) }
    })
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
  return out.map((s) => ({
    start: new Date(s.start).toISOString(),
    end: new Date(s.end).toISOString(),
    minutes: round1(s.minutes),
    activities: s.activities,
  }))
}

// ---------- consistency ----------
/**
 * 0..100: 70 % for the share of elapsed days with study, 30 % for regular start times (share of study
 * sessions starting within ±2 h of the learner's most common start hour).
 */
export function consistencyScore(activeDays: number, elapsed: number, startHours: number[]): number {
  if (!activeDays || !elapsed) return 0
  const ratio = Math.min(1, activeDays / elapsed)
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

// ---------- anomalies ----------
export const SKILL_VI: Record<Skill, string> = {
  vocabulary: 'từ vựng',
  grammar: 'ngữ pháp',
  reading: 'đọc',
  listening: 'nghe',
  writing: 'viết',
  speaking: 'nói',
}

/** Longest run of consecutive days without study inside [from, end]. */
export function longestGap(activeDays: Set<string>, from: string, end: string): number {
  let best = 0
  let run = 0
  for (const d of dateKeys(from, end)) {
    run = activeDays.has(d) ? 0 : run + 1
    best = Math.max(best, run)
  }
  return best
}

export function detectAnomalies(s: Omit<HabitStats, 'anomalies' | 'deltas'>, today: string): HabitAnomaly[] {
  const out: HabitAnomaly[] = []
  const end = s.to < today ? s.to : today
  const active = new Set(s.daily.filter((d) => d.studyMinutes > 0 || d.activities > 0).map((d) => d.date))
  if (s.period !== 'day') {
    const gap = longestGap(active, s.from, end)
    if (!active.size && s.elapsedDays >= 2) {
      out.push({
        code: 'no_activity',
        severity: 'warning',
        en: `No study at all in ${s.elapsedDays} days.`,
        vi: `Chưa học buổi nào trong ${s.elapsedDays} ngày.`,
      })
    } else if (gap >= 3) {
      out.push({
        code: 'long_gap',
        severity: 'warning',
        en: `A gap of ${gap} days without study.`,
        vi: `Có ${gap} ngày liền không học.`,
      })
    }
    const maxDay = Math.max(0, ...s.daily.map((d) => d.studyMinutes))
    if (
      s.activeDays >= 1 &&
      s.studyMinutes >= 40 &&
      maxDay >= 40 &&
      maxDay / s.studyMinutes >= 0.6 &&
      s.elapsedDays >= 4
    )
      out.push({
        code: 'cramming',
        severity: 'warning',
        en: `${Math.round((maxDay / s.studyMinutes) * 100)}% of the study time was crammed into one day.`,
        vi: `${Math.round((maxDay / s.studyMinutes) * 100)}% thời gian học dồn vào một ngày (học dồn).`,
      })
  }
  const weak = s.weakestSkills[0]
  if (weak && s.studyMinutes >= 30 && s.weakSkillShare < 0.1)
    out.push({
      code: 'skipping_weak_skill',
      severity: 'warning',
      en: `Your weakest skill (${weak}) got less than 10% of the study time.`,
      vi: `Kỹ năng yếu nhất (${SKILL_VI[weak]}) chỉ chiếm dưới 10% thời gian học.`,
    })
  const late = [23, 0, 1, 2, 3, 4].reduce((n, h) => n + (s.hourHistogram[h] ?? 0), 0)
  if (s.studyMinutes >= 20 && late / s.studyMinutes >= 0.4)
    out.push({
      code: 'late_night',
      severity: 'info',
      en: 'Much of the study happens after 23:00 – memory works better after sleep-friendly sessions.',
      vi: 'Phần lớn thời gian học diễn ra sau 23:00 – học sớm hơn giúp ghi nhớ tốt hơn.',
    })
  if (s.plan.total >= 3 && s.plan.rate !== null && s.plan.rate < 0.4)
    out.push({
      code: 'low_plan_completion',
      severity: 'warning',
      en: `Only ${Math.round(s.plan.rate * 100)}% of the planned lessons were completed.`,
      vi: `Chỉ hoàn thành ${Math.round(s.plan.rate * 100)}% bài trong kế hoạch.`,
    })
  if (s.reviewBacklog >= 30)
    out.push({
      code: 'review_backlog',
      severity: 'warning',
      en: `${s.reviewBacklog} flashcards are overdue.`,
      vi: `${s.reviewBacklog} thẻ từ đang quá hạn ôn.`,
    })
  if (s.appMinutes >= 20 && s.appMinutes >= s.studyMinutes * 2 + 15)
    out.push({
      code: 'app_without_study',
      severity: 'info',
      en: 'You spend much more time browsing the app than finishing activities.',
      vi: 'Bạn mở ứng dụng lâu nhưng ít hoàn thành bài học.',
    })
  return out
}

// ---------- main computation ----------
export function computeHabitStats(input: HabitInput): HabitStats {
  const { range, today } = input
  const end = range.to < today ? range.to : today
  const elapsed = elapsedDays(range.from, range.to, today)
  const inRange = (d: string) => d >= range.from && d <= range.to
  const acts = input.activities.filter((a) => inRange(a.date))
  const sessions = input.sessions.filter((s) => inRange(s.date))
  const views = input.views.filter((v) => inRange(v.date))

  const daily = new Map<string, DailyHabit>(
    dateKeys(range.from, range.to).map((d) => [d, { date: d, studyMinutes: 0, appMinutes: 0, activities: 0 }]),
  )
  const hourHistogram = new Array<number>(24).fill(0)
  const appHourHistogram = new Array<number>(24).fill(0)
  const weekdayMinutes = new Array<number>(7).fill(0)
  const modules = new Map<string, { module: string; studyMinutes: number; appMinutes: number; activities: number }>()
  const mod = (m: string) => {
    let row = modules.get(m)
    if (!row) modules.set(m, (row = { module: m, studyMinutes: 0, appMinutes: 0, activities: 0 }))
    return row
  }
  const skillMinutes = Object.fromEntries(SKILLS.map((s) => [s, 0])) as Record<Skill, number>
  const scoresByDay = new Map<string, number[]>()
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
    const h = hourOf(a.createdAt)
    hourHistogram[h] = (hourHistogram[h] ?? 0) + m
    const wd = weekdayIndex(a.date)
    weekdayMinutes[wd] = (weekdayMinutes[wd] ?? 0) + m
    const row = mod(a.module)
    row.studyMinutes += m
    row.activities++
    const sk = activitySkill(a)
    if (sk) skillMinutes[sk] += m
    if (a.score !== null && a.score !== undefined && Number.isFinite(a.score)) {
      const list = scoresByDay.get(a.date) ?? []
      list.push(Math.max(0, Math.min(1, a.score)))
      scoresByDay.set(a.date, list)
    }
    if (a.action === 'word_saved') wordsSaved++
  }
  let appSeconds = 0
  for (const v of views) {
    const m = v.activeSeconds / 60
    const d = daily.get(v.date)
    if (d) d.appMinutes += m
    appHourHistogram[v.hour] = (appHourHistogram[v.hour] ?? 0) + m
    mod(v.module).appMinutes += m
    appSeconds += v.activeSeconds
  }
  // Sessions carry the authoritative app time; views may miss the last unflushed seconds.
  const sessionSeconds = sessions.reduce((n, s) => n + s.activeSeconds, 0)
  const appMinutes = Math.max(appSeconds, sessionSeconds) / 60

  const activeDaySet = new Set(acts.map((a) => a.date))
  const activeDays = activeDaySet.size
  const study = clusterStudySessions(acts)
  const startHours = study.map((s) => hourOf(s.start))
  const totalSkill = SKILLS.reduce((n, s) => n + skillMinutes[s], 0)
  const weakest = weakestSkills(input.skillLevels, 2)
  const weakMinutes = weakest.reduce((n, s) => n + skillMinutes[s], 0)
  const allScores = [...scoresByDay.values()].flat()
  const reviews = input.reviews
  const planCounted = input.plan.filter((p) => p.date <= end)
  const planDone = planCounted.filter((p) => p.status === 'done').length
  const planSkipped = planCounted.filter((p) => p.status === 'skipped').length
  const reminderFollowed = input.reminders.filter((r) => {
    const t = new Date(r.sentAt).getTime()
    return input.activities.some((a) => {
      const at = new Date(a.createdAt).getTime()
      return at >= t && at - t <= 2 * 3_600_000
    })
  }).length
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
    activeDays,
    studyMinutes: round1(studyMinutes),
    appMinutes: round1(appMinutes),
    avgMinutesPerActiveDay: activeDays ? round1(studyMinutes / activeDays) : 0,
    dailyGoalMinutes: input.dailyGoalMinutes,
    goalRate: input.dailyGoalMinutes ? round1((studyMinutes / (input.dailyGoalMinutes * elapsed)) * 100) / 100 : 0,
    appSessions: {
      count: sessions.length,
      medianMinutes: round1(median(sessions.map((s) => s.activeSeconds / 60))),
      totalMinutes: round1(sessionSeconds / 60),
    },
    studySessions: {
      count: study.length,
      medianMinutes: round1(median(study.map((s) => s.minutes))),
      longestMinutes: Math.max(0, ...study.map((s) => s.minutes)),
      list: study.slice(-60),
    },
    firstStudyAt: study[0]?.start ?? null,
    lastStudyAt: study[study.length - 1]?.end ?? null,
    hourHistogram: hourHistogram.map(round1),
    appHourHistogram: appHourHistogram.map(round1),
    weekdayMinutes: weekdayMinutes.map(round1),
    preferredHours: topIndexes(hourHistogram, 3),
    preferredWeekdays: topIndexes(weekdayMinutes, 2),
    moduleMix: [...modules.values()]
      .map((r) => ({ ...r, studyMinutes: round1(r.studyMinutes), appMinutes: round1(r.appMinutes) }))
      .sort((a, b) => b.studyMinutes - a.studyMinutes || b.appMinutes - a.appMinutes),
    skillMix: SKILLS.map((s) => ({
      skill: s,
      minutes: round1(skillMinutes[s]),
      share: totalSkill ? Math.round((skillMinutes[s] / totalSkill) * 100) / 100 : 0,
    })),
    weakestSkills: weakest,
    weakSkillShare: totalSkill ? Math.round((weakMinutes / totalSkill) * 100) / 100 : 0,
    avgScore: allScores.length
      ? Math.round((allScores.reduce((a, b) => a + b, 0) / allScores.length) * 100) / 100
      : null,
    scoreTrend: [...scoresByDay.entries()]
      .sort(([a], [b]) => (a < b ? -1 : 1))
      .map(([date, list]) => ({
        date,
        score: Math.round((list.reduce((a, b) => a + b, 0) / list.length) * 100) / 100,
      })),
    reviews: reviews.length,
    reviewAccuracy: reviews.length
      ? Math.round((reviews.filter((r) => r.rating >= 3).length / reviews.length) * 100) / 100
      : null,
    wordsSaved,
    reviewBacklog: input.reviewBacklog,
    plan: {
      done: planDone,
      total: planCounted.length,
      skipped: planSkipped,
      rate: planCounted.length ? Math.round((planDone / planCounted.length) * 100) / 100 : null,
    },
    quests: { completed: input.quests.filter((q) => q.completed).length, total: input.quests.length },
    streak: { current: streak.current, longest: streak.longest },
    consistency: consistencyScore(activeDays, elapsed, startHours),
    daily: [...daily.values()].map((d) => ({
      ...d,
      studyMinutes: round1(d.studyMinutes),
      appMinutes: round1(d.appMinutes),
    })),
    reminders: {
      sent: input.reminders.length,
      followed: reminderFollowed,
      rate: input.reminders.length ? Math.round((reminderFollowed / input.reminders.length) * 100) / 100 : null,
    },
  }
  return { ...base, anomalies: detectAnomalies(base, today), deltas: null }
}

// ---------- deltas ----------
export function delta(current: number, previous: number): Delta {
  const change = round1(current - previous)
  return { current, previous, change, pct: previous ? Math.round(((current - previous) / previous) * 100) : null }
}

const DELTA_PICK: Record<DeltaKey, (s: HabitStats) => number> = {
  studyMinutes: (s) => s.studyMinutes,
  appMinutes: (s) => s.appMinutes,
  activeDays: (s) => s.activeDays,
  studySessions: (s) => s.studySessions.count,
  avgScore: (s) => Math.round((s.avgScore ?? 0) * 100),
  consistency: (s) => s.consistency,
  wordsSaved: (s) => s.wordsSaved,
  reviews: (s) => s.reviews,
  planRate: (s) => Math.round((s.plan.rate ?? 0) * 100),
}

/** Attaches period-over-period deltas (avgScore and planRate in percentage points). */
export function withDeltas(current: HabitStats, previous: HabitStats): HabitStats {
  const deltas = Object.fromEntries(
    (Object.keys(DELTA_PICK) as DeltaKey[]).map((k) => [k, delta(DELTA_PICK[k](current), DELTA_PICK[k](previous))]),
  ) as Record<DeltaKey, Delta>
  return { ...current, deltas }
}

/** "21:00" style label of an hour. */
export const hourLabel = (h: number) => `${pad(h)}:00`

/** Plan dates starting tomorrow: one day for a daily report, seven for weekly/monthly reports. */
export function planDates(period: CoachPeriod, today: string): string[] {
  const n = period === 'day' ? 1 : 7
  return Array.from({ length: n }, (_, i) => addDays(today, i + 1))
}
