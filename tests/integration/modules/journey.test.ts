import { describe, expect, it } from 'vitest'
import type { AssessmentResult, Profile, SkillLevel, VocabItem } from '../../../src/shared/types'
import type {
  AssessmentSession,
  CourseLessonDetail,
  CourseOverview,
  DashboardData,
  LessonCompleteResult,
  PlanStatusResult,
  ProductiveEstimate,
  RoadmapView,
  SaveWordsResult,
  TodayPlan,
} from '../../../src/modules/journey/contract'
import { ITEMS_PER_SKILL } from '../../../src/core/assessment'
import { makeApp } from '../../helpers/kernel'

type App = Awaited<ReturnType<typeof makeApp>>

/** Answers the objective part; `correct` decides whether each answer is right. */
async function answerAll(
  app: App,
  session: AssessmentSession,
  correct: (n: number) => boolean,
): Promise<AssessmentSession> {
  const bank = app.kernel.content.assessment()
  let s = session
  let n = 0
  while (s.current) {
    const item = bank.find((i) => i.id === s.current?.id)
    expect(item).toBeDefined()
    if (!item) break
    // The renderer never receives the answer key.
    expect(JSON.stringify(s.current)).not.toContain('answerIndex')
    // Options are shown shuffled: answer by the position of the option text on screen.
    const right = item.options[item.answerIndex]
    const shown = s.current.options
    expect([...shown].sort()).toEqual([...item.options].sort())
    const choice = correct(n) ? shown.indexOf(right ?? '') : shown.findIndex((o) => o !== right)
    s = await app.call<AssessmentSession>('journey:assessmentAnswer', { id: s.id, itemId: item.id, choice })
    n++
    if (n > 40) throw new Error('assessment did not terminate')
  }
  return s
}

describe('journey: onboarding', () => {
  it('saves the onboarding profile and can skip placement from the self-reported level', async () => {
    const app = await makeApp()
    const profile = await app.call<Profile>('learner:updateProfile', {
      displayName: 'Minh',
      selfReportedLevel: 'intermediate',
      purposes: ['ielts', 'work'],
      targetCefr: 'B2',
      targetIelts: 6.5,
      interests: ['travel', 'technology'],
      dailyMinutes: 30,
      learningStyle: 'auditory',
    })
    expect(profile.onboardingCompletedAt).toBeNull()
    const levels = await app.call<SkillLevel[]>('journey:placementSkip')
    expect(levels).toHaveLength(6)
    expect(levels.every((l) => l.cefr === 'B1' && l.source === 'self' && l.estimated)).toBe(true)
    const done = await app.call<Profile>('learner:updateProfile', { onboardingCompleted: true })
    expect(done.onboardingCompletedAt).not.toBeNull()
    expect(done.interests).toEqual(['travel', 'technology'])
    expect(done.targetIelts).toBe(6.5)
    expect(done.overallCefr).toBe('B1')
  })
})

describe('journey: placement assessment', () => {
  it('runs start → answers → writing → result, persists answers and sets skill levels', async () => {
    const app = await makeApp()
    await app.call('learner:updateProfile', { selfReportedLevel: 'elementary' })
    const start = await app.call<AssessmentSession>('journey:assessmentStart')
    expect(start.startLevel).toBe('A2')
    expect(start.current?.skill).toBe('vocabulary')
    expect(start.current?.index).toBe(1)
    expect(start.progress.map((p) => p.skill)).toEqual(['vocabulary', 'grammar', 'reading', 'listening'])

    // Resuming returns the same open assessment.
    const resumed = await app.call<AssessmentSession>('journey:assessmentStart')
    expect(resumed.id).toBe(start.id)

    // Out-of-order answers are rejected.
    await expect(
      app.call('journey:assessmentAnswer', { id: start.id, itemId: 'not-the-current-item', choice: 0 }),
    ).rejects.toThrow(/assessment_order/)

    // Finishing before the objective part is done is refused.
    await expect(app.call('journey:assessmentFinish', { id: start.id })).rejects.toThrow(/assessment_incomplete/)

    const afterObjective = await answerAll(app, start, () => true)
    expect(afterObjective.current).toBeNull()
    expect(afterObjective.answeredTotal).toBe(4 * ITEMS_PER_SKILL)
    expect(afterObjective.progress.every((p) => p.done)).toBe(true)

    const listening = app.kernel.db.all<{ item_id: string }>(
      "SELECT item_id FROM assessment_answers WHERE assessment_id = ? AND skill = 'listening'",
      [start.id],
    )
    expect(listening).toHaveLength(ITEMS_PER_SKILL)

    const writing = await app.call<ProductiveEstimate>('journey:assessmentWriting', {
      id: start.id,
      text: 'I live in Da Nang with my family. I work in a small office near the beach. I want to learn English because I want a better job and I love travelling.',
    })
    expect(writing.method).toBe('ai')
    expect(writing.provider).toBe('mock')

    const result = await app.call<AssessmentResult>('journey:assessmentFinish', { id: start.id })
    expect(result.skills).toHaveLength(6)
    const vocab = result.skills.find((s) => s.skill === 'vocabulary')
    expect(vocab?.method).toBe('adaptive-test')
    expect(vocab?.estimated).toBe(false)
    expect(vocab?.correct).toBe(ITEMS_PER_SKILL)
    // All answers right → the staircase climbs well above the A2 start.
    expect(['B2', 'C1', 'C2']).toContain(vocab?.cefr)
    expect(result.skills.find((s) => s.skill === 'writing')?.method).toBe('ai')
    const speaking = result.skills.find((s) => s.skill === 'speaking')
    expect(speaking).toMatchObject({ method: 'skipped', estimated: true })

    const row = app.kernel.db.get<{ completed_at: string | null; overall_cefr: string }>(
      'SELECT * FROM assessments WHERE id = ?',
      [start.id],
    )
    expect(row?.completed_at).not.toBeNull()
    expect(row?.overall_cefr).toBe(result.overall)

    const skills = await app.call<SkillLevel[]>('learner:skills')
    expect(skills.every((s) => s.source === 'assessment')).toBe(true)
    expect(skills.find((s) => s.skill === 'vocabulary')?.cefr).toBe(vocab?.cefr)
    expect(skills.find((s) => s.skill === 'speaking')?.estimated).toBe(true)

    const events = app.kernel.db.all<{ action: string }>(
      "SELECT action FROM activity_log WHERE action = 'assessment_done'",
    )
    expect(events).toHaveLength(1)

    // Finishing twice is idempotent and does not award XP twice.
    const again = await app.call<AssessmentResult>('journey:assessmentFinish', { id: start.id })
    expect(again.id).toBe(result.id)
    expect(app.kernel.db.all("SELECT 1 FROM activity_log WHERE action = 'assessment_done'")).toHaveLength(1)

    const latest = await app.call<AssessmentResult | null>('journey:assessmentLatest')
    expect(latest?.id).toBe(start.id)
    // Retaking starts a fresh assessment.
    const retake = await app.call<AssessmentSession>('journey:assessmentStart')
    expect(retake.id).not.toBe(start.id)
  })

  it('gives each retake different questions, option order and tasks, but keeps a resumed attempt stable', async () => {
    const app = await makeApp()
    await app.call('learner:updateProfile', { selfReportedLevel: 'elementary' })
    const first = await app.call<AssessmentSession>('journey:assessmentStart')
    const again = await app.call<AssessmentSession>('journey:assessmentStart')
    expect(again.current).toEqual(first.current)
    expect(again.tasks).toEqual(first.tasks)

    const attempts: AssessmentSession[] = [first]
    for (let i = 0; i < 7; i++)
      attempts.push(await app.call<AssessmentSession>('journey:assessmentStart', { resume: false }))
    const signature = (s: AssessmentSession) => `${s.current?.id}|${s.current?.options.join('/')}`
    expect(new Set(attempts.map(signature)).size).toBeGreaterThan(3)
    expect(new Set(attempts.map((s) => s.current?.id)).size).toBeGreaterThan(1)
    expect(new Set(attempts.map((s) => s.tasks.writing.en)).size).toBeGreaterThan(1)
    // Every attempt still starts at the learner's level.
    expect(attempts.every((s) => s.current?.cefr === 'A2')).toBe(true)
  })

  it('places a struggling learner low and grades writing offline without AI', async () => {
    const app = await makeApp({ mockAi: false })
    const start = await app.call<AssessmentSession>('journey:assessmentStart')
    expect(start.aiAvailable).toBe(false)
    const s = await answerAll(app, start, () => false)
    expect(s.current).toBeNull()
    const writing = await app.call<ProductiveEstimate>('journey:assessmentWriting', {
      id: s.id,
      text: 'My name is Lan. I am a student. I like cats and music very much.',
    })
    expect(writing.method).toBe('heuristic')
    expect(writing.provider).toBeNull()
    const speaking = await app.call<ProductiveEstimate>('journey:assessmentSpeaking', {
      id: s.id,
      transcript: 'I like the park near my house because it is quiet and green and I can walk there every evening',
      durationSec: 20,
    })
    expect(speaking.method).toBe('heuristic')
    const result = await app.call<AssessmentResult>('journey:assessmentFinish', { id: s.id })
    expect(result.skills.find((x) => x.skill === 'grammar')?.cefr).toBe('A1')
    expect(result.overall).toBe('A1')
    expect(result.skills.find((x) => x.skill === 'speaking')?.method).toBe('heuristic')
  })
})

describe('journey: roadmap', () => {
  it('generates an AI roadmap (mock), deactivates the previous one and keeps notes', async () => {
    const app = await makeApp()
    await app.call('learner:updateProfile', { interests: ['travel', 'movies'], dailyMinutes: 30, purposes: ['ielts'] })
    expect(await app.call('journey:roadmap')).toBeNull()
    const first = await app.call<RoadmapView>('journey:roadmapGenerate')
    expect(first.source).toBe('ai')
    expect(first.provider).toBe('mock')
    expect(first.weeks).toHaveLength(12)
    expect(first.currentWeek).toBe(1)
    expect(first.weeks[0]?.status).toBe('current')
    expect(first.summary.projection.hoursNeeded).toBeGreaterThan(0)
    expect(first.summary.projection.note).toMatch(/guided learning hours/)
    expect(first.summary.interestThemes.join(' ')).toMatch(/Travel/)

    const noted = await app.call<RoadmapView>('journey:roadmapNotes', { notes: 'Focus on listening before work.' })
    expect(noted.userNotes).toBe('Focus on listening before work.')
    const week2 = first.weeks[1]
    if (!week2) throw new Error('missing week')
    const marked = await app.call<RoadmapView>('journey:roadmapWeek', { weekId: week2.id, status: 'done' })
    expect(marked.weeks[1]?.status).toBe('done')

    const second = await app.call<RoadmapView>('journey:roadmapGenerate', { useAi: false })
    expect(second.source).toBe('offline')
    expect(second.id).not.toBe(first.id)
    expect(second.userNotes).toBe('Focus on listening before work.')
    const active = app.kernel.db.all('SELECT id FROM roadmaps WHERE is_active = 1')
    expect(active).toHaveLength(1)
    // Week ids of the old roadmap can no longer be changed.
    await expect(app.call('journey:roadmapWeek', { weekId: week2.id, status: 'done' })).rejects.toThrow(/not_found/)
  })

  it('falls back to the offline builder when no AI key is configured', async () => {
    const app = await makeApp({ mockAi: false })
    const r = await app.call<RoadmapView>('journey:roadmapGenerate')
    expect(r.source).toBe('offline')
    expect(r.provider).toBeNull()
    expect(r.weeks).toHaveLength(12)
    expect(r.summary.dailyRoutine.length).toBeGreaterThan(0)
    expect((await app.call<RoadmapView>('journey:roadmap'))?.id).toBe(r.id)
  })
})

describe('journey: daily plan & dashboard', () => {
  it('keeps the plan stable for a day, marks items done with progress and builds a new plan tomorrow', async () => {
    let now = new Date(2026, 10, 5, 9, 0, 0)
    const app = await makeApp({ now: () => now })
    await app.call('learner:updateProfile', { dailyMinutes: 45 })
    await app.call('vocab:save', { word: 'journey', sourceModule: 'manual', meaningVi: 'hành trình' })
    const first = await app.call<TodayPlan>('journey:today')
    expect(first.date).toBe('2026-11-05')
    expect(first.lessons.length).toBeGreaterThan(1)
    expect(first.lessons[0]?.module).toBe('vocabulary')
    expect(first.lessons[0]?.route).toBe('/vocabulary/review')
    for (const l of first.lessons) expect(l.route.startsWith('/')).toBe(true)

    now = new Date(2026, 10, 5, 18, 30, 0)
    const again = await app.call<TodayPlan>('journey:today')
    expect(again.lessons.map((l) => [l.id, l.title])).toEqual(first.lessons.map((l) => [l.id, l.title]))

    const target = first.lessons.find((l) => l.module !== 'vocabulary') ?? first.lessons[0]
    if (!target) throw new Error('empty plan')
    const before = app.kernel.progress.totalXp()
    const res = await app.call<PlanStatusResult>('journey:planStatus', { id: target.id, status: 'done' })
    expect(res.reward?.xpGained).toBeGreaterThan(0)
    expect(app.kernel.progress.totalXp()).toBeGreaterThan(before)
    expect(res.plan.doneCount).toBe(1)
    expect(
      app.kernel.db.all("SELECT 1 FROM activity_log WHERE action = 'lesson_completed' AND module = 'journey'"),
    ).toHaveLength(1)

    // Marking done twice does not award XP twice.
    const twice = await app.call<PlanStatusResult>('journey:planStatus', { id: target.id, status: 'done' })
    expect(twice.reward).toBeNull()

    const other = first.lessons.find((l) => l.id !== target.id)
    if (other) {
      const skipped = await app.call<PlanStatusResult>('journey:planStatus', { id: other.id, status: 'skipped' })
      expect(skipped.plan.lessons.find((l) => l.id === other.id)?.status).toBe('skipped')
    }

    now = new Date(2026, 10, 6, 8, 0, 0)
    const tomorrow = await app.call<TodayPlan>('journey:today')
    expect(tomorrow.date).toBe('2026-11-06')
    expect(tomorrow.lessons.every((l) => l.status === 'todo')).toBe(true)
    expect(tomorrow.lessons.map((l) => l.id).some((id) => first.lessons.some((f) => f.id === id))).toBe(false)
  })

  it('auto-completes a plan item that was done in its module today', async () => {
    const now = new Date(2026, 10, 5, 10, 0, 0)
    const app = await makeApp({ now: () => now })
    const plan = await app.call<TodayPlan>('journey:today')
    const item = plan.lessons.find((l) => l.contentRef && l.module !== 'vocabulary')
    if (!item?.contentRef) throw new Error('expected a content lesson')
    app.kernel.progress.record({
      type: 'reading_done',
      module: item.module,
      ref: item.contentRef,
      title: item.title,
      minutes: 5,
    })
    const after = await app.call<TodayPlan>('journey:today')
    const updated = after.lessons.find((l) => l.id === item.id)
    expect(updated?.status).toBe('done')
    expect(updated?.autoDone).toBe(true)
  })

  it('returns dashboard data with plan, tip and roadmap summary', async () => {
    const app = await makeApp()
    const empty = await app.call<DashboardData>('journey:dashboard')
    expect(empty.roadmap).toBeNull()
    expect(empty.lastAssessment).toBeNull()
    expect(empty.continue).toBeNull()
    expect(empty.tip.vi.length).toBeGreaterThan(10)
    await app.call('journey:roadmapGenerate')
    const reading = app.kernel.content.reading()[0]
    if (!reading) throw new Error('no reading content')
    app.kernel.progress.record({
      type: 'reading_done',
      module: 'reading',
      ref: reading.id,
      title: reading.title,
      minutes: 5,
    })
    const full = await app.call<DashboardData>('journey:dashboard')
    expect(full.roadmap?.currentWeek).toBe(1)
    expect(full.roadmap?.weekTheme).toBeTruthy()
    expect(full.continue).toMatchObject({ module: 'reading', route: `/reading/${reading.id}` })
  })
})

describe('journey: course (Sprigo syllabus)', () => {
  it('serves the syllabus, completes lessons and saves lesson words to the word bank', async () => {
    const app = await makeApp()
    const course = await app.call<CourseOverview>('journey:course')
    expect(course.levels.map((l) => l.cefr)).toEqual(['A1', 'A2', 'B1', 'B2', 'C1', 'C2'])
    expect(course.total).toBeGreaterThan(200)
    expect(course.completed).toBe(0)
    expect(course.attribution).toBe('Course outline adapted from Sprigo (MIT)')
    expect(course.license).toBe('MIT')

    const firstId = course.levels[0]?.units[0]?.lessons[0]?.id
    if (!firstId) throw new Error('no lessons')
    const lesson = await app.call<CourseLessonDetail>('journey:courseLesson', { id: firstId })
    expect(lesson.prevId).toBeNull()
    expect(lesson.nextId).toBeTruthy()
    expect(lesson.vocabulary.length).toBeGreaterThan(0)
    expect(lesson.completed).toBe(false)

    const done = await app.call<LessonCompleteResult>('journey:courseComplete', { id: firstId, completed: true })
    expect(done.lesson.completed).toBe(true)
    expect(done.reward?.xpGained).toBeGreaterThan(0)
    const attempts = app.kernel.db.all<{ module: string; content_ref: string }>(
      'SELECT module, content_ref FROM lesson_attempts',
    )
    expect(attempts).toEqual([{ module: 'journey', content_ref: firstId }])
    const again = await app.call<LessonCompleteResult>('journey:courseComplete', { id: firstId, completed: true })
    expect(again.reward).toBeNull()

    const after = await app.call<CourseOverview>('journey:course')
    expect(after.completed).toBe(1)
    expect(after.levels[0]?.units[0]?.completed).toBe(1)

    const saved = await app.call<SaveWordsResult>('journey:courseSaveWords', { id: firstId })
    expect(saved.saved).toBe(lesson.vocabulary.length)
    expect(saved.lesson.vocabulary.every((w) => w.saved)).toBe(true)
    const word = await app.call<{ items: VocabItem[] }>('vocab:list', { sourceModule: 'manual' })
    expect(word.items.length).toBe(lesson.vocabulary.length)
    expect(word.items[0]?.sourceRef).toBe(`course:${firstId}`)
    const savedAgain = await app.call<SaveWordsResult>('journey:courseSaveWords', { id: firstId })
    expect(savedAgain.saved).toBe(0)
    expect(savedAgain.existing).toBe(lesson.vocabulary.length)

    const undone = await app.call<LessonCompleteResult>('journey:courseComplete', { id: firstId, completed: false })
    expect(undone.lesson.completed).toBe(false)

    await expect(app.call('journey:courseLesson', { id: 'does-not-exist' })).rejects.toThrow(/not_found/)
    await expect(app.call('journey:courseLesson', { id: '../etc' })).rejects.toThrow(/invalid_input/)
  })
})
