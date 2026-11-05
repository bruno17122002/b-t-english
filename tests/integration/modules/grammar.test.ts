import { describe, expect, it } from 'vitest'
import type { LearnerMistake } from '../../../src/shared/types'
import type {
  GeneratedExercises,
  GrammarOverview,
  GrammarSubmitResult,
  GrammarTopicView,
  MistakeExplanation,
} from '../../../src/modules/grammar/contract'
import { GeneratedExercisesSchema, exerciseLeak, exercisesPrompt } from '../../../src/modules/grammar/main/prompts'
import { matchTopic } from '../../../src/modules/grammar/main/service'
import { makeApp } from '../../helpers/kernel'

describe('grammar module', () => {
  it('lists topics grouped into CEFR castles with mastery and a recommendation', async () => {
    const { call } = await makeApp()
    const ov = await call<GrammarOverview>('grammar:overview')
    expect(ov.totals.topics).toBe(20)
    expect(ov.totals.exercises).toBeGreaterThanOrEqual(140)
    expect(ov.castles.map((c) => c.cefr)).toEqual(['A1', 'A2', 'B1', 'B2', 'C1'])
    expect(ov.castles.flatMap((c) => c.topics).every((t) => t.mastery === 0 && t.status === 'new')).toBe(true)
    // Fresh learner (self-reported beginner → A1): first A1 topic recommended.
    expect(ov.recommended).toMatchObject({ topicId: 'gr-to-be', reason: 'level' })
    expect(ov.aiAvailable).toBe(true)
  })

  it('returns a topic with explanation, patterns, examples, mistakes and exercises', async () => {
    const { call } = await makeApp()
    const view = await call<GrammarTopicView>('grammar:topic', { id: 'gr-past-simple' })
    expect(view.topic.explanationVi.length).toBeGreaterThan(20)
    expect(view.topic.patterns.length).toBeGreaterThan(0)
    expect(view.topic.examples.length).toBeGreaterThanOrEqual(2)
    expect(view.topic.commonMistakes.length).toBeGreaterThan(0)
    expect(view.topic.exercises.length).toBeGreaterThanOrEqual(4)
    expect(view.status).toBe('new')
    expect(view.nextTopic).not.toBeNull()
    await expect(call('grammar:topic', { id: 'gr-nope' })).rejects.toThrow(/not_found/)
  })

  it('grades a drill on the server, stores the attempt, awards XP and records mistakes', async () => {
    const { call, kernel } = await makeApp()
    const topic = kernel.content.grammar().find((t) => t.id === 'gr-to-be')!
    const answers = topic.exercises.map((e, i) => ({
      exerciseId: e.id,
      // First answer wrong on purpose; gap answers typed in a sloppy way to test the lenient check.
      given: i === 0 ? 'banana' : e.type === 'gap' ? `  ${e.answer.toUpperCase()}. ` : e.answer,
    }))
    const res = await call<GrammarSubmitResult>('grammar:submit', { topicId: topic.id, durationSec: 180, answers })
    expect(res.total).toBe(topic.exercises.length)
    expect(res.correct).toBe(topic.exercises.length - 1)
    expect(res.results[0]).toMatchObject({ correct: false, expected: topic.exercises[0]!.answer })
    expect(res.reward.xpGained).toBeGreaterThan(0)
    expect(res.mistakesRecorded).toBe(1)
    expect(res.masteredNow).toBe(true)
    expect(res.skill.skill).toBe('grammar')

    const rows = kernel.db.all<{ module: string; content_ref: string; score: number }>(
      'SELECT module, content_ref, score FROM lesson_attempts',
    )
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ module: 'grammar', content_ref: 'gr-to-be' })
    expect(rows[0]!.score).toBeCloseTo(res.score)

    const mistakes = await call<LearnerMistake[]>('learner:mistakes')
    expect(mistakes[0]).toMatchObject({ category: 'grammar', pattern: topic.title, count: 1 })
    expect(mistakes[0]!.correction).toContain(topic.exercises[0]!.answer)

    const ov = await call<GrammarOverview>('grammar:overview')
    const card = ov.castles.flatMap((c) => c.topics).find((t) => t.id === 'gr-to-be')!
    expect(card.status).toBe('mastered')
    expect(card.attempts).toBe(1)
    expect(ov.totals.mastered).toBe(1)
    expect(ov.recurringMistakes[0]).toMatchObject({ topicId: 'gr-to-be' })
    expect(ov.recommended?.topicId).not.toBe('gr-to-be')

    const activity = kernel.db.all<{ action: string }>("SELECT action FROM activity_log WHERE module = 'grammar'")
    expect(activity.map((a) => a.action)).toEqual(['grammar_done'])
  })

  it('recommends a topic the learner keeps getting wrong', async () => {
    const { call, kernel } = await makeApp()
    const topic = kernel.content.grammar().find((t) => t.id === 'gr-present-simple')!
    const res = await call<GrammarSubmitResult>('grammar:submit', {
      topicId: topic.id,
      answers: topic.exercises.map((e) => ({ exerciseId: e.id, given: 'xyz' })),
    })
    expect(res.score).toBe(0)
    const ov = await call<GrammarOverview>('grammar:overview')
    expect(ov.recommended).toMatchObject({ topicId: 'gr-present-simple', reason: 'mistakes' })
  })

  it('accepts AI extras in a submission and rejects unknown exercises', async () => {
    const { call } = await makeApp()
    const extra = {
      id: 'ai-x-1',
      type: 'gap',
      prompt: 'She ___ (be) a teacher.',
      options: [],
      answer: "is/'s",
      explanation: 'be',
    }
    const ok = await call<GrammarSubmitResult>('grammar:submit', {
      topicId: 'gr-to-be',
      answers: [{ exerciseId: 'ai-x-1', given: "'s", exercise: extra }],
    })
    expect(ok.correct).toBe(1)
    await expect(
      call('grammar:submit', { topicId: 'gr-to-be', answers: [{ exerciseId: 'ghost', given: 'x' }] }),
    ).rejects.toThrow(/invalid_input/)
  })

  it('generates 6 schema-valid AI exercises (mock) and explains a mistake', async () => {
    const { call, kernel } = await makeApp()
    const gen = await call<GeneratedExercises>('grammar:generate', { topicId: 'gr-present-simple' })
    expect(gen.provider).toBe('mock')
    expect(gen.exercises).toHaveLength(6)
    expect(new Set(gen.exercises.map((e) => e.id)).size).toBe(6)
    for (const e of gen.exercises) {
      expect(exerciseLeak(e)).toBeNull()
      if (e.type === 'mcq') expect(e.options).toContain(e.answer)
      else expect(e.prompt).toContain('___')
    }
    // The mock output itself must satisfy the schema and the leak check used against real providers.
    const topic = kernel.content.grammar()[1]!
    const ctx = kernel.ai.context(undefined, 'grammar')
    const mock = exercisesPrompt.mock({ topic }, ctx)
    expect(GeneratedExercisesSchema.safeParse(mock).success).toBe(true)
    expect(exercisesPrompt.check?.({ topic }, mock)).toBeNull()

    const ex = gen.exercises[0]!
    const expl = await call<MistakeExplanation>('grammar:explain', {
      topicId: 'gr-present-simple',
      exercise: ex,
      given: 'live',
    })
    expect(expl.explanationVi).toContain(ex.answer)
    expect(expl.correctedSentence).not.toContain('___')
  })

  it('check() rejects AI exercises whose prompt already contains the answer', async () => {
    const { kernel } = await makeApp()
    const topic = kernel.content.grammar()[0]!
    const good = exercisesPrompt.mock({ topic }, kernel.ai.context())
    const leaky = {
      exercises: [
        {
          type: 'gap' as const,
          prompt: 'She goes to school. She ___ by bus.',
          options: [],
          answer: 'goes',
          explanation: 'x',
        },
        ...good.exercises.slice(1),
      ],
    }
    expect(exercisesPrompt.check?.({ topic }, leaky)).toMatch(/already contains the answer/)
    expect(exerciseLeak({ type: 'gap', prompt: 'I want to ___ (go) home.', answer: 'go' })).not.toBeNull()
    expect(exerciseLeak({ type: 'gap', prompt: 'She ___ (live) here.', answer: 'lives' })).toBeNull()
  })

  it('maps mistake patterns from other modules to topics', async () => {
    const { kernel } = await makeApp()
    const topics = kernel.content.grammar()
    expect(matchTopic('Past simple', topics)?.id).toBe('gr-past-simple')
    expect(matchTopic(topics[3]!.title, topics)?.id).toBe(topics[3]!.id)
    expect(matchTopic('spelling of colour', topics)).toBeNull()
  })

  it('reports ai_no_key for AI channels when no key is configured, while drills still work', async () => {
    const { call, router } = await makeApp({ mockAi: false })
    const ov = await call<GrammarOverview>('grammar:overview')
    expect(ov.aiAvailable).toBe(false)
    const gen = await router.dispatch('grammar:generate', { topicId: 'gr-to-be' })
    expect(gen).toMatchObject({ ok: false, error: { code: 'ai_no_key', hint: 'ai-settings' } })
    const ex = { id: 'e', type: 'mcq', prompt: 'I ___ happy.', options: ['am', 'is'], answer: 'am', explanation: '' }
    const expl = await router.dispatch('grammar:explain', { topicId: 'gr-to-be', exercise: ex, given: 'is' })
    expect(expl).toMatchObject({ ok: false, error: { code: 'ai_no_key' } })
    const sub = await router.dispatch('grammar:submit', {
      topicId: 'gr-to-be',
      answers: [{ exerciseId: 'gr-to-be-e1', given: 'is' }],
    })
    expect(sub.ok).toBe(true)
  })
})
