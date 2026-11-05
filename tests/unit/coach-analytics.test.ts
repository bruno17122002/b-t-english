import { describe, expect, it } from 'vitest'
import {
  clusterStudySessions,
  computeHabitStats,
  consistencyScore,
  dateKeys,
  delta,
  elapsedDays,
  longestGap,
  median,
  periodRange,
  planDates,
  topIndexes,
  weekdayIndex,
  withDeltas,
  type HabitInput,
  type RawActivity,
} from '../../src/modules/coach/main/analytics'
import { offlineAdvice, sanitizeRoute } from '../../src/modules/coach/main/advice'
import { AdviceSchema } from '../../src/modules/coach/main/prompts'
import { parsePeriodArg } from '../../src/modules/coach/main/telegram'

const at = (date: string, hh: number, mm = 0) => {
  const [y, m, d] = date.split('-').map(Number)
  return new Date(y ?? 2026, (m ?? 1) - 1, d ?? 1, hh, mm).toISOString()
}

const act = (date: string, hh: number, minutes: number, extra: Partial<RawActivity> = {}): RawActivity => ({
  createdAt: at(date, hh),
  date,
  module: 'listening',
  action: 'listening_done',
  skill: 'listening',
  minutes,
  score: null,
  ...extra,
})

const SKILLS: HabitInput['skillLevels'] = [
  { skill: 'vocabulary', cefr: 'B1', score: 50 },
  { skill: 'grammar', cefr: 'B1', score: 50 },
  { skill: 'reading', cefr: 'B1', score: 60 },
  { skill: 'listening', cefr: 'B1', score: 70 },
  { skill: 'writing', cefr: 'A2', score: 10 },
  { skill: 'speaking', cefr: 'A2', score: 20 },
]

function input(
  today: string,
  activities: RawActivity[],
  period: 'day' | 'week' | 'month' = 'week',
  offset = 0,
): HabitInput {
  return {
    range: periodRange(period, today, offset),
    today,
    activities,
    sessions: [],
    views: [],
    reviews: [],
    plan: [],
    quests: [],
    reminders: [],
    allActiveDays: [...new Set(activities.map((a) => a.date))].sort(),
    reviewBacklog: 0,
    skillLevels: SKILLS,
    dailyGoalMinutes: 20,
  }
}

describe('coach periods', () => {
  it('computes day, ISO week and month ranges with offsets', () => {
    expect(periodRange('day', '2026-11-05')).toMatchObject({ key: '2026-11-05', from: '2026-11-05', to: '2026-11-05' })
    expect(periodRange('day', '2026-11-01', -1).key).toBe('2026-10-31')
    const w = periodRange('week', '2026-11-05')
    expect(w).toMatchObject({ key: '2026-W45', from: '2026-11-02', to: '2026-11-08' })
    expect(w.label.vi).toContain('Tuần 45')
    expect(periodRange('week', '2026-11-05', -1)).toMatchObject({ key: '2026-W44', from: '2026-10-26' })
    expect(periodRange('month', '2026-11-05')).toMatchObject({ key: '2026-11', from: '2026-11-01', to: '2026-11-30' })
    expect(periodRange('month', '2026-01-15', -1)).toMatchObject({
      key: '2025-12',
      from: '2025-12-01',
      to: '2025-12-31',
    })
    expect(periodRange('month', '2028-03-10', -1).to).toBe('2028-02-29')
  })

  it('counts elapsed days only up to today', () => {
    expect(elapsedDays('2026-11-02', '2026-11-08', '2026-11-05')).toBe(4)
    expect(elapsedDays('2026-10-26', '2026-11-01', '2026-11-05')).toBe(7)
    expect(dateKeys('2026-10-30', '2026-11-02')).toEqual(['2026-10-30', '2026-10-31', '2026-11-01', '2026-11-02'])
    expect(weekdayIndex('2026-11-02')).toBe(0)
    expect(weekdayIndex('2026-11-08')).toBe(6)
    expect(planDates('day', '2026-11-05')).toEqual(['2026-11-06'])
    expect(planDates('week', '2026-11-05')).toHaveLength(7)
  })
})

describe('coach analytics helpers', () => {
  it('median, top indexes, deltas and gaps', () => {
    expect(median([])).toBe(0)
    expect(median([5, 1, 3])).toBe(3)
    expect(median([4, 1, 3, 2])).toBe(2.5)
    expect(topIndexes([0, 5, 2, 5, 0], 2)).toEqual([1, 3])
    expect(delta(30, 20)).toEqual({ current: 30, previous: 20, change: 10, pct: 50 })
    expect(delta(5, 0).pct).toBeNull()
    expect(longestGap(new Set(['2026-11-01', '2026-11-05']), '2026-11-01', '2026-11-06')).toBe(3)
  })

  it('clusters activities into study sessions with a 30 minute gap', () => {
    const s = clusterStudySessions([
      act('2026-11-05', 20, 10), // 19:50–20:00
      { ...act('2026-11-05', 20, 15), createdAt: at('2026-11-05', 20, 20) }, // 20:05–20:20
      act('2026-11-05', 23, 5), // separate
    ])
    expect(s).toHaveLength(2)
    expect(s[0]).toMatchObject({ minutes: 25, activities: 2 })
    expect(s[1]).toMatchObject({ minutes: 5, activities: 1 })
  })

  it('scores consistency from active days and regular start times', () => {
    expect(consistencyScore(0, 7, [])).toBe(0)
    expect(consistencyScore(7, 7, [21, 21, 20, 22, 21, 21, 21])).toBe(100)
    expect(consistencyScore(7, 7, [8, 13, 18, 23, 3, 8, 13])).toBeLessThan(90)
    expect(consistencyScore(2, 7, [21, 21])).toBe(50)
  })
})

describe('computeHabitStats', () => {
  it('aggregates minutes, hours, weekdays, skills and scores for a week', () => {
    const acts = [
      act('2026-11-02', 21, 15, { score: 0.8 }),
      act('2026-11-03', 21, 10, { module: 'reading', action: 'reading_done', skill: 'reading', score: 0.6 }),
      act('2026-11-05', 9, 20, { module: 'grammar', action: 'grammar_done', skill: 'grammar', score: 1 }),
      act('2026-10-28', 20, 5), // previous week
    ]
    const s = computeHabitStats(input('2026-11-05', acts))
    expect(s.studyMinutes).toBe(45)
    expect(s.activeDays).toBe(3)
    expect(s.elapsedDays).toBe(4)
    expect(s.hourHistogram[21]).toBe(25)
    expect(s.hourHistogram[9]).toBe(20)
    expect(s.preferredHours[0]).toBe(21)
    expect(s.weekdayMinutes.slice(0, 4)).toEqual([15, 10, 0, 20])
    expect(s.avgScore).toBe(0.8)
    expect(s.studySessions.count).toBe(3)
    expect(s.studySessions.medianMinutes).toBe(15)
    expect(s.skillMix.find((m) => m.skill === 'grammar')?.minutes).toBe(20)
    expect(s.weakestSkills).toEqual(['writing', 'speaking'])
    expect(s.weakSkillShare).toBe(0)
    expect(s.streak.current).toBe(3) // Nov 4 is bridged as a rest day
    expect(s.daily).toHaveLength(7)
    expect(s.anomalies.map((a) => a.code)).toContain('skipping_weak_skill')

    const prev = computeHabitStats(input('2026-11-05', acts, 'week', -1))
    expect(prev.studyMinutes).toBe(5)
    const d = withDeltas(s, prev).deltas
    expect(d?.studyMinutes).toMatchObject({ current: 45, previous: 5, change: 40, pct: 800 })
    expect(d?.activeDays.change).toBe(2)
  })

  it('detects cramming, long gaps, backlog and app-without-study', () => {
    const cram = computeHabitStats({
      ...input('2026-11-08', [act('2026-11-02', 20, 5), act('2026-11-08', 20, 60, { skill: 'writing' })]),
      reviewBacklog: 40,
      views: [{ module: 'dashboard', date: '2026-11-04', hour: 10, activeSeconds: 200 * 60 }],
    })
    const codes = cram.anomalies.map((a) => a.code)
    expect(codes).toEqual(expect.arrayContaining(['cramming', 'long_gap', 'review_backlog', 'app_without_study']))
    expect(cram.appMinutes).toBe(200)
    expect(cram.moduleMix.find((m) => m.module === 'dashboard')?.appMinutes).toBe(200)

    const none = computeHabitStats(input('2026-11-05', []))
    expect(none.anomalies.map((a) => a.code)).toEqual(['no_activity'])
    expect(none.consistency).toBe(0)
  })

  it('measures plan completion and reminder effectiveness', () => {
    const s = computeHabitStats({
      ...input('2026-11-05', [act('2026-11-04', 21, 10)]),
      plan: [
        { date: '2026-11-03', status: 'done' },
        { date: '2026-11-04', status: 'todo' },
        { date: '2026-11-04', status: 'skipped' },
        { date: '2026-11-07', status: 'todo' }, // future – not counted
      ],
      reminders: [{ sentAt: at('2026-11-04', 20) }, { sentAt: at('2026-11-02', 20) }],
    })
    expect(s.plan).toMatchObject({ done: 1, total: 3, skipped: 1 })
    expect(s.plan.rate).toBe(0.33)
    expect(s.reminders).toEqual({ sent: 2, followed: 1, rate: 0.5 })
  })
})

describe('offline advice', () => {
  it('produces schema-valid advice with plan days for the requested dates', () => {
    const s = computeHabitStats(input('2026-11-05', [act('2026-11-02', 21, 15)]))
    const advice = offlineAdvice(s, {
      planDates: planDates('week', '2026-11-05'),
      overallCefr: 'B1',
      targetIelts: 6.5,
      dailyGoalMinutes: 20,
      dueCards: 3,
    })
    expect(AdviceSchema.safeParse(advice).success).toBe(true)
    expect(advice.nextPeriodPlan.map((d) => d.day)).toEqual(planDates('week', '2026-11-05'))
    expect(advice.recommendations.some((r) => r.route === '/vocabulary/review')).toBe(true)
    expect(advice.ieltsOutlook).toContain('6.5')
  })

  it('sanitises routes and parses Telegram period arguments', () => {
    expect(sanitizeRoute('/listening')).toBe('/listening')
    expect(sanitizeRoute('/listening/some-track?x=1')).toBe('/listening')
    expect(sanitizeRoute('https://evil.example')).toBe('/journey')
    expect(sanitizeRoute('/vocabulary/review/')).toBe('/vocabulary/review')
    expect(parsePeriodArg('')).toBe('day')
    expect(parsePeriodArg('ngày')).toBe('day')
    expect(parsePeriodArg('tuần')).toBe('week')
    expect(parsePeriodArg('Tuan')).toBe('week')
    expect(parsePeriodArg('week')).toBe('week')
    expect(parsePeriodArg('tháng')).toBe('month')
    expect(parsePeriodArg('month')).toBe('month')
  })
})
