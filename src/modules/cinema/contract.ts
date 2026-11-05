// IPC contract for the cinema module (channel names start with 'cinema:'), plus the plain types and the pure
// story-navigation logic shared by main and renderer. They live in this file because the tsconfig projects
// only include `src/modules/*/contract.ts` from the module root.
import { z } from 'zod'
import { CefrSchema, StoryGenreSchema, type CinemaStory, type Scene } from '@shared/content'
import { channel, NoInput, type ChannelDef } from '@shared/ipc'
import type { ProviderId, Reward, StoryProgress, StorySummaryView } from '@shared/types'

// ---------- types ----------
export type { StoryProgress, StorySummaryView }

export type EndingType = 'good' | 'neutral' | 'bad'

export interface CinemaLibrary {
  stories: (StorySummaryView & { favorite: boolean; startBackdrop: Scene['backdrop']; startMood: Scene['mood'] })[]
  aiAvailable: boolean
}

export interface StoryDetail {
  story: CinemaStory
  source: 'builtin' | 'ai'
  progress: StoryProgress | null
}

export interface AdvanceResult {
  progress: StoryProgress
  /** Reward for the scene just played (cinema_scene). */
  sceneReward: Reward
  /** Reward for finishing the story (story_completed), when the scene was an ending. */
  storyReward: Reward | null
  quiz: { correct: number; total: number }
  choice: { quality: 'great' | 'ok' | 'awkward'; feedbackVi: string } | null
  ending: NonNullable<Scene['ending']> | null
}

export interface GeneratedStoryResult {
  summary: StorySummaryView
  provider: ProviderId
}

// ---------- story navigation ----------
// Pure player reducer (line → quiz → choice → next scene → ending) and graph analysis (reachability, cycles,
// dead ends). Shared by main (validation) and renderer (player).

export type PlayerPhase = 'lines' | 'quiz' | 'choice' | 'feedback' | 'ending'

/** A scene the player has just left; the renderer syncs it to main with `cinema:advance`. */
export interface SceneExit {
  seq: number
  sceneId: string
  optionIndex: number | null
  /** One entry per quiz question of the scene (-1 = not answered). */
  quizAnswers: number[]
  ending: boolean
}

export interface PlayerState {
  sceneId: string
  /** Index of the last revealed line of the current scene. */
  lineIndex: number
  phase: PlayerPhase
  path: string[]
  quizAnswers: (number | null)[]
  choiceIndex: number | null
  lastExit: SceneExit | null
}

export type PlayerAction =
  | { type: 'next' }
  | { type: 'revealAll' }
  | { type: 'answer'; index: number; choice: number }
  | { type: 'choose'; optionIndex: number }
  | { type: 'reset'; sceneId: string; path?: string[]; completed?: boolean }

export function sceneById(story: CinemaStory, id: string): Scene | undefined {
  return story.scenes.find((s) => s.id === id)
}

const emptyAnswers = (scene: Scene | undefined): (number | null)[] =>
  Array.from({ length: scene?.quiz?.length ?? 0 }, () => null)

/** Initial player state at a scene (start of story, resume point, or a completed story's ending). */
export function initPlayer(story: CinemaStory, sceneId?: string, path?: string[], completed = false): PlayerState {
  const id = sceneId && sceneById(story, sceneId) ? sceneId : story.startSceneId
  const scene = sceneById(story, id)
  const p = path?.length ? path : [id]
  const done = completed && !!scene?.ending
  return {
    sceneId: id,
    lineIndex: done ? Math.max(0, (scene?.lines.length ?? 1) - 1) : 0,
    phase: done ? 'ending' : 'lines',
    path: p[p.length - 1] === id ? p : [...p, id],
    quizAnswers: emptyAnswers(scene),
    choiceIndex: null,
    lastExit: null,
  }
}

function exitOf(state: PlayerState, ending: boolean, optionIndex: number | null): SceneExit {
  return {
    seq: (state.lastExit?.seq ?? 0) + 1,
    sceneId: state.sceneId,
    optionIndex,
    quizAnswers: state.quizAnswers.map((a) => (a === null ? -1 : a)),
    ending,
  }
}

function enter(story: CinemaStory, state: PlayerState, nextId: string, exit: SceneExit): PlayerState {
  const next = sceneById(story, nextId)
  if (!next) return state
  return {
    sceneId: nextId,
    lineIndex: 0,
    phase: 'lines',
    path: [...state.path, nextId],
    quizAnswers: emptyAnswers(next),
    choiceIndex: null,
    lastExit: exit,
  }
}

/** After lines (and quiz): open the choice, finish on an ending, or continue to the linear next scene. */
function decide(story: CinemaStory, state: PlayerState, scene: Scene): PlayerState {
  if (scene.choice) return { ...state, phase: 'choice' }
  if (scene.ending) return { ...state, phase: 'ending', lastExit: exitOf(state, true, null) }
  if (scene.nextSceneId) return enter(story, state, scene.nextSceneId, exitOf(state, false, null))
  return state
}

export function playerReducer(story: CinemaStory, state: PlayerState, action: PlayerAction): PlayerState {
  const scene = sceneById(story, state.sceneId)
  if (action.type === 'reset') return initPlayer(story, action.sceneId, action.path, action.completed)
  if (!scene) return state
  switch (action.type) {
    case 'revealAll':
      return state.phase === 'lines' ? { ...state, lineIndex: scene.lines.length - 1 } : state
    case 'next': {
      if (state.phase === 'lines') {
        if (state.lineIndex < scene.lines.length - 1) return { ...state, lineIndex: state.lineIndex + 1 }
        if (scene.quiz?.length) return { ...state, phase: 'quiz' }
        return decide(story, state, scene)
      }
      if (state.phase === 'quiz') {
        if (state.quizAnswers.some((a) => a === null)) return state
        return decide(story, state, scene)
      }
      if (state.phase === 'feedback' && state.choiceIndex !== null) {
        const opt = scene.choice?.options[state.choiceIndex]
        return opt ? enter(story, state, opt.nextSceneId, exitOf(state, false, state.choiceIndex)) : state
      }
      return state
    }
    case 'answer': {
      if (state.phase !== 'quiz') return state
      if (action.index < 0 || action.index >= state.quizAnswers.length || state.quizAnswers[action.index] !== null)
        return state
      const quizAnswers = [...state.quizAnswers]
      quizAnswers[action.index] = action.choice
      return { ...state, quizAnswers }
    }
    case 'choose': {
      if (state.phase !== 'choice' || !scene.choice?.options[action.optionIndex]) return state
      return { ...state, phase: 'feedback', choiceIndex: action.optionIndex }
    }
  }
}

/** Target of leaving `scene` (with the chosen option when it has a choice); null for endings. */
export function exitTarget(scene: Scene, optionIndex?: number | null): string | null {
  if (scene.choice) return scene.choice.options[optionIndex ?? -1]?.nextSceneId ?? null
  return scene.nextSceneId ?? null
}

export interface StoryAnalysis {
  unreachable: string[]
  /** Scenes that cannot continue (no valid exit and no ending). */
  deadEnds: string[]
  /** True when some path loops forever (a reachable cycle). */
  cyclic: boolean
  endings: string[]
  /** Number of distinct start→ending paths (capped at 10 000). */
  pathCount: number
  longestPath: number
}

export function analyzeStory(story: CinemaStory): StoryAnalysis {
  const byId = new Map(story.scenes.map((s) => [s.id, s]))
  const successors = (s: Scene): string[] =>
    s.choice ? s.choice.options.map((o) => o.nextSceneId) : s.nextSceneId ? [s.nextSceneId] : []
  const reachable = new Set<string>()
  const deadEnds: string[] = []
  let cyclic = false
  const state = new Map<string, 'visiting' | 'done'>()
  const pathsFrom = new Map<string, { count: number; longest: number }>()

  const visit = (id: string): { count: number; longest: number } => {
    const scene = byId.get(id)
    if (!scene) return { count: 0, longest: 0 }
    reachable.add(id)
    const st = state.get(id)
    if (st === 'visiting') {
      cyclic = true
      return { count: 0, longest: 0 }
    }
    if (st === 'done') return pathsFrom.get(id) ?? { count: 0, longest: 0 }
    state.set(id, 'visiting')
    let res: { count: number; longest: number }
    if (scene.ending) res = { count: 1, longest: 1 }
    else {
      const next = successors(scene).filter((n) => byId.has(n))
      if (!next.length) deadEnds.push(id)
      res = { count: 0, longest: 0 }
      for (const n of next) {
        const r = visit(n)
        res.count = Math.min(10_000, res.count + r.count)
        if (r.count > 0) res.longest = Math.max(res.longest, r.longest + 1)
      }
      if (next.length && res.count === 0 && !cyclic) deadEnds.push(id)
    }
    state.set(id, 'done')
    pathsFrom.set(id, res)
    return res
  }
  const root = visit(story.startSceneId)
  return {
    unreachable: story.scenes.filter((s) => !reachable.has(s.id)).map((s) => s.id),
    deadEnds: [...new Set(deadEnds)],
    cyclic,
    endings: story.scenes.filter((s) => s.ending).map((s) => s.id),
    pathCount: root.count,
    longestPath: root.longest,
  }
}

/** Human-readable structural problems (used by the AI story check and tests); empty when the story is playable. */
export function storyProblems(story: CinemaStory): string[] {
  const a = analyzeStory(story)
  const out: string[] = []
  if (a.unreachable.length) out.push(`scenes not reachable from the start scene: ${a.unreachable.join(', ')}`)
  if (a.cyclic) out.push('the scene graph has a loop – every path must move forward to an ending')
  if (a.deadEnds.length) out.push(`scenes that never reach an ending: ${a.deadEnds.join(', ')}`)
  if (!a.endings.length) out.push('the story has no ending scene')
  return out
}

// ---------- channels ----------
const StoryId = z
  .string()
  .regex(/^[a-z0-9-]+$/)
  .max(120)
const SceneId = z.string().min(1).max(80)

export const cinemaContract = {
  'cinema:list': channel<CinemaLibrary>()(NoInput),
  'cinema:story': channel<StoryDetail>()(z.object({ id: StoryId })),
  /** Creates progress (or resumes it); `restart` starts the story again from the first scene. */
  'cinema:start': channel<StoryProgress>()(z.object({ id: StoryId, restart: z.boolean().optional() })),
  /** Leaves the current scene: grades its quiz, applies the choice and moves on (or finishes on an ending). */
  'cinema:advance': channel<AdvanceResult>()(
    z.object({
      id: StoryId,
      sceneId: SceneId,
      optionIndex: z.number().int().min(0).max(3).nullable().optional(),
      quizAnswers: z.array(z.number().int().min(-1).max(5)).max(10).default([]),
    }),
  ),
  'cinema:generate': channel<GeneratedStoryResult>()(
    z.object({
      genre: StoryGenreSchema,
      cefr: CefrSchema,
      length: z.enum(['short', 'medium']).default('short'),
      theme: z.string().trim().max(160).optional(),
    }),
  ),
  'cinema:deleteStory': channel<null>()(z.object({ id: StoryId })),
} satisfies Record<`cinema:${string}`, ChannelDef>
