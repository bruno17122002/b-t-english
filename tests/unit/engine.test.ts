import { describe, expect, it } from 'vitest'
import type { AssessmentItem } from '../../src/shared/content'
import { estimateLevel, nextAssessmentItem } from '../../src/core/assessment'
import { averageCefr, CUMULATIVE_HOURS, ieltsToCefr, nextCefr } from '../../src/core/cefr'
import { addDays, diffDays, isoWeekKey, localDateKey, weekStart } from '../../src/core/dates'
import {
  computeRegions,
  computeStreak,
  evaluateAchievements,
  generateDailyQuests,
  generateWeeklyQuests,
  levelFromXp,
  xpForActivity,
  xpToNextLevel,
  type AchievementStats,
} from '../../src/core/game'
import { buildDailyPlan, buildOfflineRoadmap, projectProgress, weakestSkills } from '../../src/core/roadmap'
import { FsrsScheduler, formatInterval, newCard, retrievability } from '../../src/core/srs'
import { compareWords, normalizeAnswer, pickBlanks, readingWpm, speakingMetrics, splitSentences, textMetrics } from '../../src/core/text'

const T0 = new Date('2026-03-02T09:00:00Z')
const DAY = 86_400_000

describe('FSRS scheduler (ts-fsrs adapter)', () => {
  const s = new FsrsScheduler()

  it('starts new cards due immediately and graduates them through learning steps', () => {
    const c0 = newCard(T0)
    expect(c0.state).toBe('new')
    expect(c0.dueAt).toBe(T0.toISOString())
    const c1 = s.review(c0, 3, T0)
    expect(c1.state).toBe('learning')
    expect(new Date(c1.dueAt).getTime() - T0.getTime()).toBe(10 * 60_000)
    const c2 = s.review(c1, 3, new Date(c1.dueAt))
    expect(c2.state).toBe('review')
    expect(c2.scheduledDays).toBeGreaterThanOrEqual(1)
  })

  it('orders intervals Again < Hard < Good < Easy and labels them', () => {
    const p = s.preview(newCard(T0), T0)
    const t = (r: 1 | 2 | 3 | 4) => new Date(p[r].dueAt).getTime()
    expect(t(1)).toBeLessThan(t(2))
    expect(t(2)).toBeLessThan(t(3))
    expect(t(3)).toBeLessThan(t(4))
    expect(p[1].label).toBe('1m')
    expect(p[4].label).toMatch(/d$/)
  })

  it('grows stability on successful reviews and counts lapses on failure', () => {
    let c = s.review(newCard(T0), 4, T0)
    const firstStability = c.stability
    c = s.review(c, 3, new Date(new Date(c.dueAt).getTime()))
    expect(c.stability).toBeGreaterThan(firstStability)
    const lapsed = s.review(c, 1, new Date(new Date(c.dueAt).getTime() + DAY))
    expect(lapsed.lapses).toBe(1)
    expect(lapsed.state).toBe('relearning')
  })

  it('retrievability is 0.9 after exactly one stability period and decays monotonically', () => {
    expect(retrievability(10, 10)).toBeCloseTo(0.9, 3)
    expect(retrievability(0, 5)).toBeCloseTo(1, 5)
    expect(retrievability(20, 10)).toBeLessThan(retrievability(10, 10))
    expect(retrievability(5, 0)).toBe(0)
    expect(s.currentRetrievability(newCard(T0), T0)).toBe(0)
  })

  it('formats intervals', () => {
    expect(formatInterval(30_000)).toBe('1m')
    expect(formatInterval(90 * 60_000)).toBe('2h')
    expect(formatInterval(3 * DAY)).toBe('3d')
    expect(formatInterval(90 * DAY)).toBe('3mo')
    expect(formatInterval(800 * DAY)).toBe('2.2y')
  })
})

describe('XP, levels and streaks', () => {
  it('uses a gently growing level curve', () => {
    expect(xpToNextLevel(1)).toBe(100)
    expect(xpToNextLevel(2)).toBe(145)
    expect(levelFromXp(0)).toEqual({ level: 1, xpIntoLevel: 0, xpForNextLevel: 100 })
    expect(levelFromXp(100).level).toBe(2)
    expect(levelFromXp(244)).toEqual({ level: 2, xpIntoLevel: 144, xpForNextLevel: 145 })
    expect(levelFromXp(-5).level).toBe(1)
  })

  it('never lowers base XP for poor quality but rewards good work', () => {
    expect(xpForActivity('reading_done', { score: 0 })).toBe(15)
    expect(xpForActivity('reading_done', { score: 1 })).toBe(23)
    expect(xpForActivity('speaking_done', { minutes: 2 })).toBe(20)
  })

  it('counts consecutive days and bridges one missed day per week', () => {
    const today = '2026-03-10'
    expect(computeStreak(['2026-03-08', '2026-03-09', '2026-03-10'], today).current).toBe(3)
    const bridged = computeStreak(['2026-03-07', '2026-03-08', '2026-03-10'], today)
    expect(bridged.current).toBe(3)
    expect(bridged.restDaysUsedRecently).toEqual(['2026-03-09'])
    expect(bridged.restDayAvailable).toBe(false)
    expect(computeStreak(['2026-03-06', '2026-03-07', '2026-03-10'], today).current).toBe(1)
  })

  it('keeps yesterday’s streak alive while today is still pending', () => {
    const s = computeStreak(['2026-03-08', '2026-03-09'], '2026-03-10')
    expect(s.current).toBe(2)
    expect(s.activeToday).toBe(false)
    expect(computeStreak([], '2026-03-10')).toMatchObject({ current: 0, longest: 0 })
  })

  it('unlocks the mastery region only when every skill region reaches stage 2', () => {
    const low = computeRegions({ vocabulary: 500, grammar: 500, reading: 500, listening: 500, writing: 500, speaking: 100 })
    expect(low.find((r) => r.key === 'mastery-challenge')?.unlocked).toBe(false)
    const high = computeRegions({ vocabulary: 400, grammar: 400, reading: 400, listening: 400, writing: 400, speaking: 400 })
    const mastery = high.find((r) => r.key === 'mastery-challenge')
    expect(mastery?.unlocked).toBe(true)
    expect(high.find((r) => r.key === 'vocabulary-forest')).toMatchObject({ stage: 2, stageXp: 0, nextStageXp: 500 })
  })

  it('generates stable, personalised quests', () => {
    const a = generateDailyQuests({ dateKey: '2026-03-10', dailyMinutes: 20, dueCards: 12, weakestSkills: ['speaking', 'listening'] })
    const b = generateDailyQuests({ dateKey: '2026-03-10', dailyMinutes: 20, dueCards: 12, weakestSkills: ['speaking', 'listening'] })
    expect(a).toEqual(b)
    expect(a).toHaveLength(3)
    expect(a[0]?.key).toBe('review-words')
    expect(a[1]?.key).toBe('speak')
    expect(generateDailyQuests({ dateKey: '2026-03-10', dailyMinutes: 20, dueCards: 0, weakestSkills: [] })[0]?.key).toBe('learn-words')
    const weekly = generateWeeklyQuests({ weekKey: '2026-W11', dailyMinutes: 30 })
    expect(weekly[0]?.key).toBe('week-active')
    expect(new Set(weekly.map((q) => q.key)).size).toBe(3)
  })

  it('evaluates achievements against real stats', () => {
    const stats: AchievementStats = {
      words: 30, reviews: 0, listening: 0, reading: 0, writing: 1, speakingSeconds: 0, cinemaScenes: 0, storiesCompleted: 0,
      goodEndings: 0, longestStreak: 3, level: 1, assessments: 1, tutorMessages: 0, grammar: 0, activeDays: 3, perfectQuizzes: 0, questsCompleted: 0,
    }
    const res = evaluateAchievements(stats, new Set(['first-steps']))
    const unlocked = res.filter((r) => r.newlyUnlocked).map((r) => r.key)
    expect(unlocked).toEqual(expect.arrayContaining(['word-collector', 'first-draft', 'streak-3']))
    expect(unlocked).not.toContain('first-steps')
  })
})

describe('CEFR, assessment and roadmap', () => {
  it('maps IELTS bands and averages levels conservatively', () => {
    expect(ieltsToCefr(6.5)).toBe('B2')
    expect(ieltsToCefr(5)).toBe('B1')
    expect(averageCefr(['A2', 'B1', 'B1', 'B2'])).toBe('B1')
    expect(averageCefr([])).toBe('A1')
    expect(nextCefr('C2')).toBeNull()
    expect(CUMULATIVE_HOURS.B2).toBeGreaterThan(CUMULATIVE_HOURS.B1)
  })

  const bank: AssessmentItem[] = (['A1', 'A2', 'B1', 'B2', 'C1', 'C2'] as const).flatMap((cefr) =>
    [1, 2].map((n) => ({ id: `${cefr}-${n}`, skill: 'grammar' as const, cefr, prompt: 'q', options: ['a', 'b', 'c'], answerIndex: 0 })),
  )

  it('adapts difficulty up after a correct answer and down after a wrong one', () => {
    const first = nextAssessmentItem(bank, [], 'A2')
    expect(first?.cefr).toBe('A2')
    const up = nextAssessmentItem(bank, [{ itemId: 'A2-1', cefr: 'A2', correct: true }], 'A2')
    expect(up?.cefr).toBe('B1')
    const down = nextAssessmentItem(bank, [{ itemId: 'A2-1', cefr: 'A2', correct: false }], 'A2')
    expect(down?.cefr).toBe('A1')
    const done = nextAssessmentItem(bank, Array.from({ length: 6 }, (_, i) => ({ itemId: `x${i}`, cefr: 'A1' as const, correct: true })), 'A2')
    expect(done).toBeNull()
  })

  it('estimates the highest level answered reliably', () => {
    const r = estimateLevel([
      { itemId: '1', cefr: 'A2', correct: true },
      { itemId: '2', cefr: 'B1', correct: true },
      { itemId: '3', cefr: 'B2', correct: false },
      { itemId: '4', cefr: 'B1', correct: true },
      { itemId: '5', cefr: 'B2', correct: false },
    ])
    expect(r.cefr).toBe('B1')
    expect(r.correct).toBe(3)
    expect(estimateLevel([]).cefr).toBe('A1')
  })

  it('projects hours and weeks to the target level', () => {
    const p = projectProgress({ current: 'A2', currentScore: 0, target: 'B2', dailyMinutes: 30 })
    expect(p.hoursNeeded).toBe(CUMULATIVE_HOURS.B1 - CUMULATIVE_HOURS.A1)
    expect(p.milestones.map((m) => m.cefr)).toEqual(['B1', 'B2'])
    expect(p.estimatedWeeks).toBe(Math.ceil(p.hoursNeeded / 3))
    expect(projectProgress({ current: 'B2', currentScore: 50, target: 'B1', dailyMinutes: 30 }).hoursNeeded).toBe(0)
  })

  it('builds a 12-week offline roadmap focused on weak skills', () => {
    const skills = [
      { skill: 'vocabulary' as const, cefr: 'A2' as const, score: 40 },
      { skill: 'speaking' as const, cefr: 'A1' as const, score: 10 },
      { skill: 'listening' as const, cefr: 'A1' as const, score: 50 },
    ]
    expect(weakestSkills(skills, 1)).toEqual(['speaking'])
    const r = buildOfflineRoadmap({ displayName: 'Lan', dailyMinutes: 20, targetCefr: 'B2', interests: ['travel'], purposes: ['ielts'], skills, grammarTopics: [{ id: 'g', title: 'Present simple', cefr: 'A1' }] })
    expect(r.weeks).toHaveLength(12)
    expect(r.weeks[0]?.status).toBe('current')
    expect(r.summary.prioritySkills[0]).toBe('speaking')
    expect(r.summary.longTermGoals.join(' ')).toContain('IELTS')
  })

  it('builds a stable daily plan that fits the time budget', () => {
    const input = {
      dateKey: '2026-03-10',
      dailyMinutes: 30,
      focusSkills: ['listening' as const],
      levels: { listening: 'A2' as const },
      library: [
        { module: 'listening' as const, ref: 'l1', title: 'At the station', cefr: 'A2' as const, minutes: 10 },
        { module: 'reading' as const, ref: 'r1', title: 'Night market', cefr: 'A2' as const, minutes: 10 },
        { module: 'cinema' as const, ref: 'c1', title: 'Window seat', cefr: 'A2' as const, minutes: 10 },
      ],
      completedRefs: new Set<string>(),
      dueCards: 12,
    }
    const a = buildDailyPlan(input)
    expect(buildDailyPlan(input)).toEqual(a)
    expect(a[0]?.module).toBe('vocabulary')
    expect(a.reduce((s, l) => s + l.estimatedMinutes, 0)).toBeLessThanOrEqual(40)
  })
})

describe('text metrics', () => {
  it('splits sentences and measures writing', () => {
    expect(splitSentences('I like tea. However, my brother prefers coffee! Do you?')).toHaveLength(3)
    const m = textMetrics('I like tea. However, my brother prefers coffee because it is stronger.')
    expect(m.words).toBe(12)
    expect(m.sentences).toBe(2)
    expect(m.linkingWords).toBe(2)
    expect(['A1', 'A2', 'B1', 'B2', 'C1', 'C2']).toContain(m.heuristicCefr)
  })

  it('compares spoken words with the target', () => {
    const c = compareWords('I would like a cup of tea', 'I like a cup of the tea')
    expect(c.missing).toEqual(['would'])
    expect(c.extra).toEqual(['the'])
    expect(c.matched).toBe(6)
    expect(c.accuracy).toBeCloseTo(6 / 7)
  })

  it('measures speaking from voiced segments', () => {
    const m = speakingMetrics({ durationSec: 10, segments: [{ start: 0.5, end: 3 }, { start: 4, end: 8 }], transcript: 'one two three four five six seven eight nine ten', target: null })
    expect(m.speakingSec).toBe(6.5)
    expect(m.pauseCount).toBe(1)
    expect(m.longestPauseSec).toBe(1)
    expect(m.wordsPerMinute).toBe(92)
    expect(m.wordAccuracy).toBeNull()
  })

  it('normalises answers and picks deterministic blanks', () => {
    expect(normalizeAnswer('  Don’t   STOP!! ')).toBe("don't stop")
    const s = 'The travellers waited patiently beside the quiet river'
    expect(pickBlanks(s, 2, 7)).toEqual(pickBlanks(s, 2, 7))
    expect(pickBlanks(s, 2, 7)).toHaveLength(2)
    expect(readingWpm(300, 120)).toBe(150)
    expect(readingWpm(300, 0)).toBe(0)
  })
})

describe('local dates', () => {
  it('handles day arithmetic, ISO weeks and week starts', () => {
    expect(addDays('2026-02-28', 1)).toBe('2026-03-01')
    expect(addDays('2024-02-28', 1)).toBe('2024-02-29')
    expect(diffDays('2026-03-10', '2026-03-01')).toBe(9)
    expect(isoWeekKey(new Date(2026, 0, 1))).toBe('2026-W01')
    expect(isoWeekKey(new Date(2027, 0, 1))).toBe('2026-W53')
    expect(weekStart('2026-03-08')).toBe('2026-03-02')
    expect(localDateKey(new Date(2026, 4, 9))).toBe('2026-05-09')
  })
})
