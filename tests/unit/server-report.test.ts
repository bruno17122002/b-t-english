// Reports and learner context from fixture sync rows: habit statistics in the learner's time zone, deltas, offline
// advice, validated/sanitised AI advice with fallback, /today and the tutor context block.
import { describe, expect, it } from 'vitest'
import { buildReport } from '../../supabase/functions/_shared/bot'
import {
  adviceHtml,
  parsePeriodArg,
  planHtml,
  reportHtml,
  validateAdvice,
} from '../../supabase/functions/_shared/coach'
import { InvalidOutput } from '../../supabase/functions/_shared/gemini'
import { periodRange, profile28, statsFor } from '../../supabase/functions/_shared/habits'
import {
  buildLearner,
  dueCount,
  learnerContext,
  nextUpdatedAt,
  todayReply,
  type SyncRow,
} from '../../supabase/functions/_shared/learner'
import { FakeAi, learnerFixture, TZ, USER } from '../helpers/fakeEdge'

const NOW = new Date('2026-11-05T03:00:00.000Z')
const data = () => buildLearner(learnerFixture(USER) as unknown as SyncRow[], TZ)

describe('server habit statistics from synced rows', () => {
  it('computes the week in the learner zone with deltas against the previous week', () => {
    const s = statsFor(data(), 'week', NOW)
    expect(s).toMatchObject({
      key: '2026-W45',
      from: '2026-11-02',
      to: '2026-11-08',
      activeDays: 3,
      studyMinutes: 47,
      elapsedDays: 4,
    })
    expect(s.label.vi).toBe('Tuần 45 · 02/11–08/11')
    // 13:00Z = 20:00 in Vietnam
    expect(s.preferredHours).toEqual([20])
    expect(s.hourHistogram[20]).toBe(47)
    expect(s.deltas?.studyMinutes).toMatchObject({ previous: 40, current: 47, change: 7 })
    expect(s.weakestSkills).toEqual(['listening', 'writing'])
    expect(s.plan).toMatchObject({ done: 1, total: 2 })
    expect(s.reviewBacklog).toBe(1)
  })

  it('day and month ranges, 28-day profile and period arguments', () => {
    const d = data()
    expect(statsFor(d, 'day', NOW, '2026-11-04')).toMatchObject({ studyMinutes: 12, activeDays: 1 })
    expect(periodRange('month', '2026-11-05', -1)).toMatchObject({
      key: '2026-10',
      from: '2026-10-01',
      to: '2026-10-31',
    })
    expect(profile28(d, NOW)).toMatchObject({ activeDays: 6, studyMinutes: 87 })
    expect(parsePeriodArg('tuần')).toBe('week')
    expect(parsePeriodArg('THANG')).toBe('month')
    expect(parsePeriodArg('')).toBe('day')
  })
})

describe('server reports', () => {
  it('offline report without AI', async () => {
    const r = await buildReport(data(), 'week', NOW, null)
    expect(r.source).toBe('offline')
    expect(r.advice.nextPeriodPlan.map((p) => p.day)).toEqual([
      '2026-11-06',
      '2026-11-07',
      '2026-11-08',
      '2026-11-09',
      '2026-11-10',
      '2026-11-11',
      '2026-11-12',
    ])
    const html = reportHtml(r)
    expect(html).toContain('📊 Tuần 45 · 02/11–08/11</b> · offline')
    expect(html).toContain('🕘 Giờ học nhiều nhất: 20:00')
    expect(adviceHtml(r)).toContain('<b>IELTS:</b> Bạn đang ở B1')
    expect(planHtml(r)).toContain('Áp dụng kế hoạch')
  })

  it('AI advice is validated: unknown routes mapped, plan days outside the period dropped', async () => {
    const ai = new FakeAi().push({
      headline: 'Tuần học khá đều',
      summary: 'Bạn học 47 phút.',
      strengths: ['Đều đặn'],
      concerns: ['Ít luyện viết'],
      recommendations: [
        { title: 'Luyện nghe', why: 'Yếu nhất', action: 'Nghe 15 phút', route: '/listening/abc?x=1', minutes: 15 },
        { title: 'Lạ', why: '-', action: 'Hack', route: '/admin', minutes: 999 },
      ],
      bestStudyTimes: ['20:00–21:00'],
      nextPeriodPlan: [
        { day: '2026-11-06', focus: 'Nghe', modules: ['listening', 'bogus'], activities: ['Bài nghe'], minutes: 30 },
        { day: '2030-01-01', focus: 'X', modules: ['reading'], activities: ['Y'], minutes: 30 },
      ],
      motivation: 'Cố lên!',
      ieltsOutlook: 'Khoảng 6 tháng.',
    })
    const r = await buildReport(data(), 'day', NOW, ai)
    expect(r.source).toBe('ai')
    expect(r.advice.recommendations.map((x) => [x.route, x.minutes])).toEqual([
      ['/listening', 15],
      ['/journey', 180],
    ])
    expect(r.advice.nextPeriodPlan).toEqual([
      { day: '2026-11-06', focus: 'Nghe', modules: ['listening'], activities: ['Bài nghe'], minutes: 30 },
    ])
    expect(ai.inputs[0]?.system).toContain('exactly one entry for each of these dates: 2026-11-06')
    expect(JSON.parse(ai.inputs[0]?.messages[0]?.content ?? '{}').habitStats.studyMinutes).toBe(0)
  })

  it('falls back to the offline advice after an invalid answer and a failed repair round', async () => {
    const ai = new FakeAi().push('{"headline": ""}', 'nope')
    const r = await buildReport(data(), 'week', NOW, ai)
    expect(r.source).toBe('offline')
    expect(ai.inputs).toHaveLength(2)
    expect(ai.inputs[1]?.messages.at(-1)?.content).toContain('Your answer was invalid')
    expect(() =>
      validateAdvice(
        { headline: 'x', summary: 'y', recommendations: [] },
        { planDates: [], overallCefr: 'B1', targetIelts: 6.5, dailyGoalMinutes: 20, dueCards: 0 },
        r.advice,
      ),
    ).toThrow(InvalidOutput)
  })
})

describe('server learner context', () => {
  it('builds the tutor context and /today like the in-app bot', () => {
    const d = data()
    expect(dueCount(d, NOW)).toBe(1)
    const ctx = learnerContext(d, NOW)
    expect(ctx).toContain('Name: Lan; overall CEFR B1, target B2 (IELTS 6.5); daily goal 30 min.')
    expect(ctx).toContain('- [grammar] past simple with past time markers → went (×4)')
    expect(ctx).toContain("Today's plan: 1/2 done. Still to do: Airport announcements (listening).")
    expect(ctx).toContain('Interests: travel, music.')
    const today = todayReply(d, NOW)
    expect(today.buttons[0]?.map((b) => b.data)).toEqual(['review:start', 'quiz:new', 'word:new'])
  })

  it('nextUpdatedAt never goes backwards', () => {
    expect(nextUpdatedAt(NOW, '2026-11-01T00:00:00.000Z')).toBe(NOW.toISOString())
    expect(nextUpdatedAt(NOW, '2026-11-09T00:00:00.000Z')).toBe('2026-11-09T00:00:00.001Z')
    expect(nextUpdatedAt(NOW, null)).toBe(NOW.toISOString())
  })
})
