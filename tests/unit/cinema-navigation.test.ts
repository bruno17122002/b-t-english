import { describe, expect, it } from 'vitest'
import cinemaJson from '../../src/content/cinema.json'
import { CinemaStorySchema, type CinemaStory } from '../../src/shared/content'
import {
  analyzeStory,
  exitTarget,
  initPlayer,
  playerReducer,
  sceneById,
  storyProblems,
  type PlayerAction,
  type PlayerState,
} from '../../src/modules/cinema/contract'

const STORIES: CinemaStory[] = (cinemaJson as unknown[]).map((s) => CinemaStorySchema.parse(s))

const tiny: CinemaStory = CinemaStorySchema.parse({
  id: 'tiny',
  title: 'Tiny',
  genre: 'social',
  cefr: 'A1',
  synopsisEn: 'x',
  synopsisVi: 'x',
  setting: 'x',
  characters: [{ id: 'a', name: 'A', role: 'r', voiceGender: 'female', color: '#112233' }],
  startSceneId: 'one',
  scenes: [
    {
      id: 'one',
      title: 'One',
      backdrop: 'cafe',
      mood: 'calm',
      lines: [
        { characterId: 'narrator', text: 'Hi.', translationVi: 'Chào.' },
        { characterId: 'a', text: 'Hello.', translationVi: 'Xin chào.' },
      ],
      quiz: [{ id: 'q', type: 'mcq', prompt: 'Who?', options: ['A', 'B'], answerIndex: 0, explanation: 'A' }],
      nextSceneId: 'two',
    },
    {
      id: 'two',
      title: 'Two',
      backdrop: 'park',
      mood: 'warm',
      lines: [{ characterId: 'a', text: 'Choose.', translationVi: 'Chọn.' }],
      choice: {
        prompt: 'Pick',
        options: [
          { text: 'Nice', nextSceneId: 'good', quality: 'great', feedbackVi: 'Tốt' },
          { text: 'Rude', nextSceneId: 'bad', quality: 'awkward', feedbackVi: 'Chưa tốt' },
        ],
      },
    },
    {
      id: 'good',
      title: 'G',
      backdrop: 'park',
      mood: 'upbeat',
      lines: [{ characterId: 'a', text: 'Yay.', translationVi: 'Yay.' }],
      ending: { type: 'good', summaryEn: 'g', summaryVi: 'g' },
    },
    {
      id: 'bad',
      title: 'B',
      backdrop: 'park',
      mood: 'serious',
      lines: [{ characterId: 'a', text: 'Oh.', translationVi: 'Ồ.' }],
      ending: { type: 'bad', summaryEn: 'b', summaryVi: 'b' },
    },
  ],
})

const run = (story: CinemaStory, s: PlayerState, ...actions: PlayerAction[]) =>
  actions.reduce((st, a) => playerReducer(story, st, a), s)

describe('cinema player reducer', () => {
  it('reveals lines one by one, then the quiz, then moves to the next scene', () => {
    let s = initPlayer(tiny)
    expect(s).toMatchObject({ sceneId: 'one', lineIndex: 0, phase: 'lines', path: ['one'], quizAnswers: [null] })
    s = run(tiny, s, { type: 'next' })
    expect(s.lineIndex).toBe(1)
    s = run(tiny, s, { type: 'next' })
    expect(s.phase).toBe('quiz')
    // Cannot leave the quiz before answering.
    expect(run(tiny, s, { type: 'next' })).toBe(s)
    s = run(tiny, s, { type: 'answer', index: 0, choice: 1 })
    expect(run(tiny, s, { type: 'answer', index: 0, choice: 0 }).quizAnswers).toEqual([1]) // first answer sticks
    s = run(tiny, s, { type: 'next' })
    expect(s).toMatchObject({ sceneId: 'two', lineIndex: 0, phase: 'lines', path: ['one', 'two'] })
    expect(s.lastExit).toEqual({ seq: 1, sceneId: 'one', optionIndex: null, quizAnswers: [1], ending: false })
  })

  it('handles a choice with feedback and reaches an ending', () => {
    let s = initPlayer(tiny, 'two', ['one', 'two'])
    s = run(tiny, s, { type: 'next' })
    expect(s.phase).toBe('choice')
    expect(run(tiny, s, { type: 'next' })).toBe(s) // must choose
    expect(run(tiny, s, { type: 'choose', optionIndex: 7 })).toBe(s)
    s = run(tiny, s, { type: 'choose', optionIndex: 1 })
    expect(s).toMatchObject({ phase: 'feedback', choiceIndex: 1 })
    s = run(tiny, s, { type: 'next' })
    expect(s).toMatchObject({ sceneId: 'bad', path: ['one', 'two', 'bad'] })
    expect(s.lastExit).toMatchObject({ sceneId: 'two', optionIndex: 1, ending: false })
    s = run(tiny, s, { type: 'next' })
    expect(s.phase).toBe('ending')
    expect(s.lastExit).toMatchObject({ sceneId: 'bad', ending: true })
    expect(run(tiny, s, { type: 'next' })).toBe(s)
  })

  it('revealAll jumps to the last line and reset resumes a completed story at its ending', () => {
    const s = run(tiny, initPlayer(tiny), { type: 'revealAll' })
    expect(s.lineIndex).toBe(1)
    const done = run(tiny, s, { type: 'reset', sceneId: 'good', path: ['one', 'two', 'good'], completed: true })
    expect(done).toMatchObject({ sceneId: 'good', phase: 'ending', path: ['one', 'two', 'good'] })
    expect(initPlayer(tiny, 'missing').sceneId).toBe('one')
  })

  it('exitTarget follows choices and linear links', () => {
    expect(exitTarget(sceneById(tiny, 'one')!)).toBe('two')
    expect(exitTarget(sceneById(tiny, 'two')!, 0)).toBe('good')
    expect(exitTarget(sceneById(tiny, 'good')!)).toBeNull()
  })

  it('detects unreachable scenes, loops and dead ends', () => {
    expect(storyProblems(tiny)).toEqual([])
    const a = analyzeStory(tiny)
    expect(a.pathCount).toBe(2)
    expect(a.longestPath).toBe(3)
    const looped = {
      ...tiny,
      scenes: tiny.scenes.map((s) =>
        s.id === 'two'
          ? {
              ...s,
              choice: {
                prompt: 'p',
                options: [
                  { text: 't', nextSceneId: 'one', quality: 'ok' as const, feedbackVi: 'f' },
                  { text: 'u', nextSceneId: 'good', quality: 'ok' as const, feedbackVi: 'f' },
                ],
              },
            }
          : s,
      ),
    }
    expect(analyzeStory(looped).cyclic).toBe(true)
    expect(analyzeStory(looped).unreachable).toEqual(['bad'])
  })
})

describe('bundled cinema stories', () => {
  it('has 7 valid stories with 80 scenes', () => {
    expect(STORIES).toHaveLength(7)
    expect(STORIES.reduce((n, s) => n + s.scenes.length, 0)).toBe(80)
  })

  for (const story of STORIES) {
    it(`"${story.id}" is fully traversable: every scene reachable, every path ends`, () => {
      const a = analyzeStory(story)
      expect(a.unreachable).toEqual([])
      expect(a.cyclic).toBe(false)
      expect(a.deadEnds).toEqual([])
      expect(a.endings.length).toBeGreaterThan(0)

      // Drive the reducer through every combination of choices; each run must end in the 'ending' phase.
      const visited = new Set<string>()
      let endings = 0
      const explore = (state: PlayerState, depth: number) => {
        expect(depth).toBeLessThan(200)
        visited.add(state.sceneId)
        if (state.phase === 'ending') {
          endings++
          expect(sceneById(story, state.sceneId)?.ending).toBeTruthy()
          return
        }
        if (state.phase === 'choice') {
          const opts = sceneById(story, state.sceneId)!.choice!.options
          opts.forEach((_, i) =>
            explore(run(story, state, { type: 'choose', optionIndex: i }, { type: 'next' }), depth + 1),
          )
          return
        }
        if (state.phase === 'quiz') {
          const s = state.quizAnswers.reduce<PlayerState>(
            (st, _, i) => run(story, st, { type: 'answer', index: i, choice: 0 }),
            state,
          )
          explore(run(story, s, { type: 'next' }), depth + 1)
          return
        }
        const next = run(story, state, { type: 'next' })
        expect(next).not.toBe(state) // never stuck
        explore(next, depth + 1)
      }
      explore(initPlayer(story), 0)
      expect([...visited].sort()).toEqual(story.scenes.map((s) => s.id).sort())
      expect(endings).toBe(a.pathCount)
    })
  }
})
