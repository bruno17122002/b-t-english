import { describe, expect, it } from 'vitest'
import type { CinemaStory } from '../../../src/shared/content'
import { CinemaStorySchema } from '../../../src/shared/content'
import type { Achievement, StoryProgress } from '../../../src/shared/types'
import type {
  AdvanceResult,
  CinemaLibrary,
  GeneratedStoryResult,
  StoryDetail,
} from '../../../src/modules/cinema/contract'
import { sceneById, storyProblems } from '../../../src/modules/cinema/contract'
import { storyPrompt } from '../../../src/modules/cinema/main/prompts'
import { makeApp } from '../../helpers/kernel'

type Call = <T = unknown>(channel: string, payload?: unknown) => Promise<T>

/** Plays a story from its current scene to an ending, always picking `pick(options)` and answering quizzes correctly. */
async function playToEnd(
  call: Call,
  story: CinemaStory,
  pick: (n: number) => number = () => 0,
): Promise<AdvanceResult> {
  let progress = await call<StoryProgress>('cinema:start', { id: story.id })
  for (let guard = 0; guard < 50; guard++) {
    const scene = sceneById(story, progress.currentSceneId)!
    const res = await call<AdvanceResult>('cinema:advance', {
      id: story.id,
      sceneId: scene.id,
      optionIndex: scene.choice ? pick(scene.choice.options.length) : null,
      quizAnswers: (scene.quiz ?? []).map((q) => q.answerIndex),
    })
    if (res.ending) return res
    progress = res.progress
  }
  throw new Error('story did not end')
}

describe('cinema module', () => {
  it('lists the bundled stories with summaries, start backdrop and no progress', async () => {
    const { call } = await makeApp()
    const lib = await call<CinemaLibrary>('cinema:list')
    expect(lib.stories).toHaveLength(7)
    expect(lib.stories.reduce((n, s) => n + s.sceneCount, 0)).toBe(80)
    for (const s of lib.stories) {
      expect(s.source).toBe('builtin')
      expect(s.progress).toBeNull()
      expect(s.synopsisVi.length).toBeGreaterThan(10)
      expect(s.startBackdrop).toBeTruthy()
    }
    await call('library:toggleFavorite', { kind: 'story', ref: 'the-lost-key', title: 'The Lost Key' })
    const again = await call<CinemaLibrary>('cinema:list')
    expect(again.stories.find((s) => s.id === 'the-lost-key')?.favorite).toBe(true)
  })

  it('starts, resumes and advances a story, persisting path, choices and quiz counts', async () => {
    const { call, kernel } = await makeApp()
    const { story } = await call<StoryDetail>('cinema:story', { id: 'the-lost-key' })
    const p0 = await call<StoryProgress>('cinema:start', { id: story.id })
    expect(p0).toMatchObject({
      currentSceneId: story.startSceneId,
      path: [story.startSceneId],
      quizTotal: 0,
      completedAt: null,
    })

    const s1 = sceneById(story, story.startSceneId)!
    const r1 = await call<AdvanceResult>('cinema:advance', {
      id: story.id,
      sceneId: s1.id,
      quizAnswers: (s1.quiz ?? []).map((q) => q.answerIndex),
    })
    expect(r1.progress.currentSceneId).toBe(s1.nextSceneId)
    expect(r1.sceneReward.xpGained).toBeGreaterThan(0)
    expect(r1.storyReward).toBeNull()

    // Resume returns the saved scene rather than restarting.
    const resumed = await call<StoryProgress>('cinema:start', { id: story.id })
    expect(resumed.currentSceneId).toBe(s1.nextSceneId)
    expect(resumed.path).toEqual([s1.id, s1.nextSceneId])

    // A choice scene requires an option and returns quality feedback.
    const choiceScene = sceneById(story, resumed.currentSceneId)!
    expect(choiceScene.choice).toBeTruthy()
    await expect(call('cinema:advance', { id: story.id, sceneId: choiceScene.id })).rejects.toThrow(/invalid_input/)
    const r2 = await call<AdvanceResult>('cinema:advance', {
      id: story.id,
      sceneId: choiceScene.id,
      optionIndex: 0,
      quizAnswers: [],
    })
    expect(r2.choice).toMatchObject({ quality: choiceScene.choice!.options[0]!.quality })
    expect(r2.progress.choices).toEqual([
      { sceneId: choiceScene.id, optionIndex: 0, quality: choiceScene.choice!.options[0]!.quality },
    ])

    // Out-of-sync scene ids are rejected.
    await expect(call('cinema:advance', { id: story.id, sceneId: s1.id })).rejects.toThrow(/scene_mismatch/)

    const row = kernel.db.get<{ path: string; choices: string }>(
      'SELECT path, choices FROM story_progress WHERE story_id = ?',
      [story.id],
    )
    expect(JSON.parse(row!.path)).toEqual(r2.progress.path)
    const scenes = kernel.db.all<{ action: string }>("SELECT action FROM activity_log WHERE module = 'cinema'")
    expect(scenes.map((s) => s.action)).toEqual(['cinema_scene', 'cinema_scene'])
  })

  it('grades scene quizzes on the server', async () => {
    const { call } = await makeApp()
    const { story } = await call<StoryDetail>('cinema:story', { id: 'window-seat' })
    let progress = await call<StoryProgress>('cinema:start', { id: story.id })
    // Walk until a scene with a quiz, answering it wrong.
    for (let i = 0; i < 20; i++) {
      const scene = sceneById(story, progress.currentSceneId)!
      if (scene.quiz?.length) {
        const res = await call<AdvanceResult>('cinema:advance', {
          id: story.id,
          sceneId: scene.id,
          optionIndex: scene.choice ? 0 : null,
          quizAnswers: scene.quiz.map((q) => (q.answerIndex + 1) % q.options.length),
        })
        expect(res.quiz).toEqual({ correct: 0, total: scene.quiz.length })
        expect(res.progress.quizTotal).toBe(scene.quiz.length)
        expect(res.progress.quizCorrect).toBe(0)
        return
      }
      progress = (
        await call<AdvanceResult>('cinema:advance', {
          id: story.id,
          sceneId: scene.id,
          optionIndex: scene.choice ? 0 : null,
        })
      ).progress
    }
    throw new Error('no quiz scene found')
  })

  it('completes a story: ending persisted, story_completed emitted, "the-end" unlocked, replay restarts', async () => {
    const { call, kernel } = await makeApp()
    const { story } = await call<StoryDetail>('cinema:story', { id: 'the-lost-key' })
    const end = await playToEnd(call, story)
    expect(end.ending).toBeTruthy()
    expect(end.storyReward).not.toBeNull()
    expect(end.progress.completedAt).not.toBeNull()
    expect(end.progress.endingType).toBe(end.ending!.type)
    expect(end.progress.quizTotal).toBeGreaterThan(0)
    expect(end.progress.quizCorrect).toBe(end.progress.quizTotal)
    const unlocked = [...end.sceneReward.achievementsUnlocked, ...end.storyReward!.achievementsUnlocked].map(
      (a) => a.key,
    )
    expect(unlocked).toContain('the-end')
    const achievements = await call<Achievement[]>('progress:achievements')
    expect(achievements.find((a) => a.key === 'the-end')?.unlockedAt).not.toBeNull()
    const completed = kernel.db.value("SELECT COUNT(*) FROM activity_log WHERE action = 'story_completed'")
    expect(Number(completed)).toBe(1)

    await expect(call('cinema:advance', { id: story.id, sceneId: end.progress.currentSceneId })).rejects.toThrow(
      /story_completed/,
    )
    const lib = await call<CinemaLibrary>('cinema:list')
    expect(lib.stories.find((s) => s.id === story.id)?.progress?.endingType).toBe(end.ending!.type)

    const replay = await call<StoryProgress>('cinema:start', { id: story.id, restart: true })
    expect(replay).toMatchObject({
      currentSceneId: story.startSceneId,
      path: [story.startSceneId],
      completedAt: null,
      endingType: null,
      quizTotal: 0,
    })
  })

  it('generates an original AI story (mock), stores it, lists it and lets you play it', async () => {
    const { call, kernel } = await makeApp()
    const gen = await call<GeneratedStoryResult>('cinema:generate', { genre: 'social', cefr: 'A2', length: 'short' })
    expect(gen.provider).toBe('mock')
    expect(gen.summary).toMatchObject({ source: 'ai', genre: 'social', cefr: 'A2' })
    expect(gen.summary.id).toMatch(/^ai-[a-z0-9-]+$/)
    const row = kernel.db.get<{ source: string; data: string }>('SELECT source, data FROM stories WHERE id = ?', [
      gen.summary.id,
    ])
    expect(row?.source).toBe('ai')
    expect(CinemaStorySchema.safeParse(JSON.parse(row!.data)).success).toBe(true)

    const lib = await call<CinemaLibrary>('cinema:list')
    expect(lib.stories).toHaveLength(8)
    expect(lib.stories.find((s) => s.id === gen.summary.id)?.source).toBe('ai')

    const { story, source } = await call<StoryDetail>('cinema:story', { id: gen.summary.id })
    expect(source).toBe('ai')
    expect(storyProblems(story)).toEqual([])
    const end = await playToEnd(call, story)
    expect(end.ending?.type).toBe('good')

    await call('cinema:deleteStory', { id: gen.summary.id })
    expect((await call<CinemaLibrary>('cinema:list')).stories).toHaveLength(7)
    await expect(call('cinema:deleteStory', { id: 'the-lost-key' })).rejects.toThrow(/forbidden/)
  })

  it('skips corrupted AI stories instead of crashing', async () => {
    const { call, kernel } = await makeApp()
    kernel.db.run(
      "INSERT INTO stories(id, source, genre, title, cefr, data, created_at) VALUES ('ai-broken', 'ai', 'travel', 'Broken', 'A1', '{\"id\":\"ai-broken\"}', '2026-01-01')",
    )
    const lib = await call<CinemaLibrary>('cinema:list')
    expect(lib.stories).toHaveLength(7)
    await expect(call('cinema:story', { id: 'ai-broken' })).rejects.toThrow(/not_found/)
  })

  it('story prompt check() rejects broken graphs and leaked quiz answers', async () => {
    const { kernel } = await makeApp()
    const input = { genre: 'travel' as const, cefr: 'B1' as const, length: 'short' as const }
    const mock = storyPrompt.mock(input, kernel.ai.context())
    expect(CinemaStorySchema.safeParse(mock).success).toBe(true)
    expect(storyPrompt.check?.(input, mock)).toBeNull()
    const orphan = { ...mock, scenes: [...mock.scenes, { ...mock.scenes[3]!, id: 's9' }] }
    expect(storyPrompt.check?.(input, orphan)).toMatch(/not reachable/)
    const loop = { ...mock, scenes: mock.scenes.map((s) => (s.id === 's1' ? { ...s, nextSceneId: 's1' } : s)) }
    expect(storyPrompt.check?.(input, loop)).toMatch(/loop|not reachable/)
    const leak = {
      ...mock,
      scenes: mock.scenes.map((s) =>
        s.id === 's1'
          ? {
              ...s,
              quiz: [
                {
                  ...s.quiz![0]!,
                  prompt: 'Is the garden on the roof?',
                  options: ['on the roof', 'at school'],
                  answerIndex: 0,
                },
              ],
            }
          : s,
      ),
    }
    expect(storyPrompt.check?.(input, leak)).toMatch(/contains the answer/)
  })

  it('offline: AI story generation returns ai_no_key, playing bundled stories still works', async () => {
    const { call, router } = await makeApp({ mockAi: false })
    const lib = await call<CinemaLibrary>('cinema:list')
    expect(lib.aiAvailable).toBe(false)
    const res = await router.dispatch('cinema:generate', { genre: 'travel', cefr: 'A1' })
    expect(res).toMatchObject({ ok: false, error: { code: 'ai_no_key', hint: 'ai-settings' } })
    const { story } = await call<StoryDetail>('cinema:story', { id: 'the-elevator' })
    const end = await playToEnd(call, story, (n) => n - 1)
    expect(end.ending).toBeTruthy()
  })
})
