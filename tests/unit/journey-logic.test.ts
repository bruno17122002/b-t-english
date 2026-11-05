import { describe, expect, it } from 'vitest'
import {
  TIPS,
  currentWeekIndex,
  dayPart,
  deriveWeekStatus,
  estimateFromOtherSkills,
  heuristicSpeakingCefr,
  relatedGrammarTopics,
  routeForPlanItem,
  skillForModule,
  tipForDate,
} from '../../src/modules/journey/main/logic'
import { SKILLS } from '../../src/shared/types'
import { RoadmapAiSchema, roadmapPrompt, writingPlacementPrompt } from '../../src/modules/journey/main/prompts'

describe('journey logic', () => {
  it('maps plan items to module routes', () => {
    expect(routeForPlanItem('reading', 'city-life')).toBe('/reading/city-life')
    expect(routeForPlanItem('listening', null)).toBe('/listening')
    expect(routeForPlanItem('cinema', 'detective-night')).toBe('/cinema/detective-night')
    expect(routeForPlanItem('grammar', 'present-simple')).toBe('/grammar/present-simple')
    expect(routeForPlanItem('writing', 'my-day')).toBe('/writing?prompt=my-day')
    expect(routeForPlanItem('speaking', 'intro-yourself')).toBe('/speaking?prompt=intro-yourself')
    expect(routeForPlanItem('vocabulary', null, 'Review 12 due words')).toBe('/vocabulary/review')
    expect(routeForPlanItem('vocabulary', null, 'Collect 10 new words')).toBe('/vocabulary')
    expect(routeForPlanItem('journey', 'a1-basic-greetings')).toBe('/journey/course/a1-basic-greetings')
    // Unsafe refs never reach a route.
    expect(routeForPlanItem('reading', '../../settings')).toBe('/reading')
  })

  it('credits the right skill for each module', () => {
    expect(skillForModule('cinema')).toBe('listening')
    expect(skillForModule('reading')).toBe('reading')
    expect(skillForModule('journey')).toBeNull()
  })

  it('computes the current roadmap week and display statuses', () => {
    expect(currentWeekIndex('2026-11-02', '2026-11-02')).toBe(1)
    expect(currentWeekIndex('2026-11-02', '2026-11-08')).toBe(1)
    expect(currentWeekIndex('2026-11-02', '2026-11-09')).toBe(2)
    expect(currentWeekIndex('2026-11-10', '2026-11-02')).toBe(1)
    expect(deriveWeekStatus('done', 2, 2)).toBe('done')
    expect(deriveWeekStatus('upcoming', 2, 2)).toBe('current')
    expect(deriveWeekStatus('current', 1, 2)).toBe('upcoming')
  })

  it('estimates skipped productive skills one level below receptive skills', () => {
    expect(estimateFromOtherSkills(['B1', 'B1', 'B2', 'B1'])).toBe('A2')
    expect(estimateFromOtherSkills(['A1', 'A1'])).toBe('A1')
    expect(estimateFromOtherSkills([])).toBe('A1')
  })

  it('caps the offline speaking estimate by speaking rate', () => {
    expect(heuristicSpeakingCefr('B2', 50, 40)).toBe('A2')
    expect(heuristicSpeakingCefr('B2', 120, 40)).toBe('B2')
    expect(heuristicSpeakingCefr('A2', 140, 40)).toBe('B1')
    expect(heuristicSpeakingCefr('C1', null, 3)).toBe('A1')
  })

  it('splits the day into parts and picks a stable tip', () => {
    expect(dayPart(7)).toBe('morning')
    expect(dayPart(13)).toBe('afternoon')
    expect(dayPart(19)).toBe('evening')
    expect(dayPart(2)).toBe('night')
    expect(tipForDate('2026-11-05')).toEqual(tipForDate('2026-11-05'))
    expect(TIPS).toContainEqual(tipForDate('2026-01-01'))
  })

  it('suggests grammar topics related to a syllabus lesson', () => {
    const topics = [
      { id: 'present-simple', title: 'Present simple', cefr: 'A1' as const },
      { id: 'past-simple', title: 'Past simple', cefr: 'A2' as const },
      { id: 'conditionals', title: 'Second conditional', cefr: 'B1' as const },
    ]
    const res = relatedGrammarTopics(
      { title: 'Talking about the past', cefr: 'A2', grammar: ['I {verb} yesterday (past simple)'] },
      topics,
    )
    expect(res[0]?.id).toBe('past-simple')
    expect(relatedGrammarTopics({ title: 'Hello', cefr: 'C2', grammar: [] }, topics)).toEqual([])
  })
})

describe('journey prompts', () => {
  it('has valid deterministic mocks', () => {
    const ctx = {} as Parameters<typeof roadmapPrompt.mock>[1]
    const input = {
      displayName: 'Lan',
      dailyMinutes: 20,
      targetCefr: 'B2' as const,
      targetIelts: 6.5,
      learningStyle: 'mixed',
      interests: ['travel'],
      purposes: ['ielts'],
      // buildOfflineRoadmap expects all six skills (the learner service always provides them).
      skills: SKILLS.map((skill) => ({ skill, cefr: 'A2' as const, score: 10 })),
      grammarTopics: [{ id: 'g', title: 'Past simple', cefr: 'A2' as const }],
      projection: { currentCefr: 'A2' as const, hoursNeeded: 300, estimatedWeeks: 40, milestones: [] },
    }
    const a = roadmapPrompt.mock(input, ctx)
    expect(RoadmapAiSchema.safeParse(a).success).toBe(true)
    expect(roadmapPrompt.mock(input, ctx)).toEqual(a)
    const w = writingPlacementPrompt.mock(
      { task: 't', text: 'I live in Hue. I like rice and tea. I study English every night.' },
      ctx,
    )
    expect(writingPlacementPrompt.schema.safeParse(w).success).toBe(true)
  })
})
