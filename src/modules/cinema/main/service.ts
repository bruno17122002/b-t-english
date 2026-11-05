// Cinema Mode business logic: story library (bundled + AI-generated), progress persistence, scene rewards
// and AI story generation. Free of Electron imports so it runs under Vitest.
import { CinemaStorySchema, type CinemaStory, type Scene } from '@shared/content'
import type { Reward, StoryProgress, StorySummaryView } from '@shared/types'
import type { Kernel } from '../../../main/kernel'
import { UserError } from '../../../main/ipc/router'
import {
  sceneById,
  type AdvanceResult,
  type CinemaLibrary,
  type EndingType,
  type GeneratedStoryResult,
  type StoryDetail,
} from '../contract'
import { storyPrompt, type StoryInput } from './prompts'

interface ProgressRow {
  story_id: string
  current_scene_id: string
  path: string
  choices: string
  quiz_correct: number
  quiz_total: number
  ending_type: EndingType | null
  started_at: string
  updated_at: string
  completed_at: string | null
}

interface StoryRow {
  id: string
  data: string
  created_at: string
}

export const ENDING_SCORE: Record<EndingType, number> = { good: 1, neutral: 0.6, bad: 0.3 }
const ENDING_SKILL: Record<EndingType, number> = { good: 2, neutral: 1.5, bad: 1 }

const parseJson = <T>(s: string, fallback: T): T => {
  try {
    return JSON.parse(s) as T
  } catch {
    return fallback
  }
}

const toProgress = (r: ProgressRow): StoryProgress => ({
  storyId: r.story_id,
  currentSceneId: r.current_scene_id,
  path: parseJson<string[]>(r.path, []),
  choices: parseJson<StoryProgress['choices']>(r.choices, []),
  quizCorrect: r.quiz_correct,
  quizTotal: r.quiz_total,
  completedAt: r.completed_at,
  endingType: r.ending_type,
})

export const slugify = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/g, 'd')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/g, '')

export class CinemaService {
  constructor(private readonly kernel: Kernel) {}

  // ---------- stories ----------
  private aiStories(): { story: CinemaStory; createdAt: string }[] {
    const rows = this.kernel.db.all<StoryRow>(
      "SELECT id, data, created_at FROM stories WHERE source = 'ai' ORDER BY created_at DESC",
    )
    const out: { story: CinemaStory; createdAt: string }[] = []
    for (const r of rows) {
      const parsed = CinemaStorySchema.safeParse(parseJson<unknown>(r.data, null))
      if (parsed.success && parsed.data.id === r.id) out.push({ story: parsed.data, createdAt: r.created_at })
      else this.kernel.log.warn(`cinema: skipping invalid AI story ${r.id}`)
    }
    return out
  }

  private find(id: string): { story: CinemaStory; source: 'builtin' | 'ai' } | null {
    const builtin = this.kernel.content.stories().find((s) => s.id === id)
    if (builtin) return { story: builtin, source: 'builtin' }
    const ai = this.aiStories().find((s) => s.story.id === id)
    return ai ? { story: ai.story, source: 'ai' } : null
  }

  private storyOrThrow(id: string): { story: CinemaStory; source: 'builtin' | 'ai' } {
    const found = this.find(id)
    if (!found) throw new UserError('not_found', 'Không tìm thấy bộ phim này.')
    return found
  }

  private summary(story: CinemaStory, source: 'builtin' | 'ai', progress: StoryProgress | null): StorySummaryView {
    return {
      id: story.id,
      title: story.title,
      genre: story.genre,
      cefr: story.cefr,
      synopsisEn: story.synopsisEn,
      synopsisVi: story.synopsisVi,
      source,
      sceneCount: story.scenes.length,
      progress,
    }
  }

  list(): CinemaLibrary {
    const progress = new Map(
      this.kernel.db.all<ProgressRow>('SELECT * FROM story_progress').map((r) => [r.story_id, toProgress(r)]),
    )
    const favorites = new Set(this.kernel.settings.favorites('story').map((f) => f.ref))
    const all = [
      ...this.kernel.content.stories().map((s) => ({ story: s, source: 'builtin' as const })),
      ...this.aiStories().map((s) => ({ story: s.story, source: 'ai' as const })),
    ]
    return {
      stories: all.map(({ story, source }) => {
        const start = sceneById(story, story.startSceneId)
        return {
          ...this.summary(story, source, progress.get(story.id) ?? null),
          favorite: favorites.has(story.id),
          startBackdrop: start?.backdrop ?? 'city-night',
          startMood: start?.mood ?? 'calm',
        }
      }),
      aiAvailable: this.kernel.ai.isAvailable(),
    }
  }

  story(id: string): StoryDetail {
    const { story, source } = this.storyOrThrow(id)
    return { story, source, progress: this.progress(id) }
  }

  // ---------- progress ----------
  progress(id: string): StoryProgress | null {
    const row = this.kernel.db.get<ProgressRow>('SELECT * FROM story_progress WHERE story_id = ?', [id])
    return row ? toProgress(row) : null
  }

  start(id: string, restart = false): StoryProgress {
    const { story } = this.storyOrThrow(id)
    const existing = this.progress(id)
    // Resume unless asked to restart (or the saved scene no longer exists, e.g. content was updated).
    if (existing && !restart && sceneById(story, existing.currentSceneId)) return existing
    const now = this.kernel.now().toISOString()
    this.kernel.db.run(
      `INSERT INTO story_progress(story_id, current_scene_id, path, choices, quiz_correct, quiz_total, ending_type, started_at, updated_at, completed_at)
       VALUES (?, ?, ?, '[]', 0, 0, NULL, ?, ?, NULL)
       ON CONFLICT(story_id) DO UPDATE SET current_scene_id = excluded.current_scene_id, path = excluded.path, choices = '[]',
       quiz_correct = 0, quiz_total = 0, ending_type = NULL, started_at = excluded.started_at, updated_at = excluded.updated_at, completed_at = NULL`,
      [id, story.startSceneId, JSON.stringify([story.startSceneId]), now, now],
    )
    return this.progress(id) as StoryProgress
  }

  advance(input: { id: string; sceneId: string; optionIndex?: number | null; quizAnswers: number[] }): AdvanceResult {
    const { story } = this.storyOrThrow(input.id)
    const progress = this.progress(input.id) ?? this.start(input.id)
    if (progress.completedAt)
      throw new UserError('story_completed', 'Phim đã kết thúc. Hãy xem lại từ đầu để chọn hướng khác.')
    if (progress.currentSceneId !== input.sceneId)
      throw new UserError('scene_mismatch', 'Tiến độ phim đã thay đổi. Hãy tải lại trang để tiếp tục.')
    const scene = sceneById(story, input.sceneId) as Scene

    // Quiz (graded here, never trusted from the renderer).
    const questions = scene.quiz ?? []
    const correct = questions.filter((q, i) => input.quizAnswers[i] === q.answerIndex).length
    const total = questions.length

    // Exit: choice, linear continuation or ending.
    let next: string | null = null
    let choice: AdvanceResult['choice'] = null
    const choices = [...progress.choices]
    if (scene.choice) {
      const opt = input.optionIndex != null ? scene.choice.options[input.optionIndex] : undefined
      if (!opt) throw new UserError('invalid_input', 'Hãy chọn một lựa chọn để tiếp tục.')
      next = opt.nextSceneId
      choice = { quality: opt.quality, feedbackVi: opt.feedbackVi }
      choices.push({ sceneId: scene.id, optionIndex: input.optionIndex as number, quality: opt.quality })
    } else if (scene.nextSceneId) {
      next = scene.nextSceneId
    }
    const ending = !next && scene.ending ? scene.ending : null
    if (!next && !ending) throw new UserError('broken_story', 'Cảnh phim này không có lối đi tiếp.')

    const nowIso = this.kernel.now().toISOString()
    const path = next ? [...progress.path, next] : progress.path
    this.kernel.db.run(
      `UPDATE story_progress SET current_scene_id = ?, path = ?, choices = ?, quiz_correct = quiz_correct + ?, quiz_total = quiz_total + ?,
       ending_type = ?, completed_at = ?, updated_at = ? WHERE story_id = ?`,
      [
        next ?? scene.id,
        JSON.stringify(path),
        JSON.stringify(choices),
        correct,
        total,
        ending?.type ?? null,
        ending ? nowIso : null,
        nowIso,
        story.id,
      ],
    )

    const minutes = Math.max(1, Math.min(2, Math.round(scene.lines.length * 0.25 * 10) / 10))
    const sceneReward = this.kernel.progress.record({
      type: 'cinema_scene',
      module: 'cinema',
      skill: 'listening',
      minutes,
      score: total
        ? correct / total
        : choice
          ? choice.quality === 'great'
            ? 1
            : choice.quality === 'ok'
              ? 0.6
              : 0.2
          : undefined,
      ref: `${story.id}#${scene.id}`,
      title: `${story.title} · ${scene.title}`,
    })
    let storyReward: Reward | null = null
    if (ending) {
      storyReward = this.kernel.progress.record({
        type: 'story_completed',
        module: 'cinema',
        skill: 'listening',
        score: ENDING_SCORE[ending.type],
        ref: story.id,
        title: story.title,
      })
      this.kernel.learner.addSkillProgress('listening', ENDING_SKILL[ending.type])
    }
    return {
      progress: this.progress(story.id) as StoryProgress,
      sceneReward,
      storyReward,
      quiz: { correct, total },
      choice,
      ending,
    }
  }

  // ---------- AI stories ----------
  async generate(input: StoryInput): Promise<GeneratedStoryResult> {
    const res = await this.kernel.ai.run(storyPrompt, input, { level: input.cefr })
    const stamp = this.kernel.now().getTime().toString(36)
    const id = `ai-${slugify(res.data.title) || 'story'}-${stamp}`
    const story = CinemaStorySchema.parse({ ...res.data, id, genre: input.genre, cefr: input.cefr })
    this.kernel.db.run(
      'INSERT OR REPLACE INTO stories(id, source, genre, title, cefr, data, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [
        story.id,
        'ai',
        story.genre,
        story.title.slice(0, 200),
        story.cefr,
        JSON.stringify(story),
        this.kernel.now().toISOString(),
      ],
    )
    return { summary: this.summary(story, 'ai', null), provider: res.provider }
  }

  deleteStory(id: string): null {
    const found = this.find(id)
    if (!found) throw new UserError('not_found', 'Không tìm thấy bộ phim này.')
    if (found.source !== 'ai') throw new UserError('forbidden', 'Không thể xóa phim có sẵn của ứng dụng.')
    this.kernel.db.transaction(() => {
      this.kernel.db.run("DELETE FROM stories WHERE id = ? AND source = 'ai'", [id])
      this.kernel.db.run('DELETE FROM story_progress WHERE story_id = ?', [id])
      this.kernel.db.run("DELETE FROM favorites WHERE kind = 'story' AND ref = ?", [id])
    })
    return null
  }
}
