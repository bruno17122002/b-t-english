// Writing Workshop business logic. No Electron imports – fully testable with an in-memory kernel.
import type { Cefr, WritingPrompt } from '@shared/content'
import { CEFR_LEVELS } from '@shared/content'
import type { ProviderId, TextMetrics, WritingFeedback, WritingSubmission } from '@shared/types'
import { textMetrics } from '@core/text'
import type { Kernel } from '../../../main/kernel'
import { toIpcError, UserError } from '../../../main/ipc/router'
import { wordDiff } from './diff'
import { averageScore, buildChecklist, checkFixes, markErrors } from './feedback'
import type {
  AiFailure,
  WritingCatalog,
  WritingHistoryItem,
  WritingPromptInfo,
  WritingRecheck,
  WritingSelfCorrectResult,
  WritingSubmissionView,
  WritingSubmitResult,
} from '../contract'
import { toWritingFeedback, writingFeedbackPrompt, writingRecheckPrompt, type FeedbackOutput } from './prompts'

interface SubmissionRow {
  id: number
  prompt_id: string | null
  task_type: string
  prompt_text: string
  original_text: string
  self_corrected_text: string | null
  feedback: string | null
  metrics: string
  provider: ProviderId | null
  created_at: string
}

export interface SubmitInput {
  promptId: string | null
  taskType: string
  promptText: string
  text: string
  minutes?: number
  analyze: boolean
}

function parseJson<T>(s: string | null): T | null {
  if (!s) return null
  try {
    return JSON.parse(s) as T
  } catch {
    return null
  }
}

const toSubmission = (r: SubmissionRow): WritingSubmission => ({
  id: r.id,
  promptId: r.prompt_id,
  taskType: r.task_type,
  promptText: r.prompt_text,
  originalText: r.original_text,
  selfCorrectedText: r.self_corrected_text,
  feedback: parseJson<WritingFeedback>(r.feedback),
  metrics: parseJson<TextMetrics>(r.metrics) ?? textMetrics(r.original_text),
  provider: r.provider,
  createdAt: r.created_at,
})

export class WritingService {
  constructor(private readonly k: Kernel) {}

  private prompt(id: string | null): WritingPrompt | null {
    return id ? (this.k.content.writingPrompts().find((p) => p.id === id) ?? null) : null
  }

  writingLevel(): Cefr {
    return this.k.learner.skillLevels().find((s) => s.skill === 'writing')?.cefr ?? this.k.learner.overallCefr()
  }

  private row(id: number): SubmissionRow {
    const r = this.k.db.get<SubmissionRow>('SELECT * FROM writing_submissions WHERE id = ?', [id])
    if (!r) throw new UserError('not_found', 'Không tìm thấy bài viết này.')
    return r
  }

  get(id: number): WritingSubmission {
    return toSubmission(this.row(id))
  }

  view(id: number): WritingSubmissionView {
    const submission = this.get(id)
    const prompt = this.prompt(submission.promptId)
    const fb = submission.feedback
    const errors = fb?.errors ?? []
    const revised = submission.selfCorrectedText
    return {
      submission,
      prompt,
      score: fb ? averageScore(fb.scores) : null,
      diff: fb ? wordDiff(submission.originalText, fb.correctedText) : null,
      marked: fb ? markErrors(submission.originalText, errors) : null,
      revisionDiff: revised !== null ? wordDiff(submission.originalText, revised) : null,
      fixes: revised !== null && fb ? checkFixes(errors, revised) : null,
      checklist: buildChecklist(
        submission.originalText,
        {
          taskType: submission.taskType,
          minWords: prompt?.minWords ?? 1,
          maxWords: prompt?.maxWords ?? 2000,
          hints: prompt?.hints ?? [],
        },
        submission.metrics,
      ),
    }
  }

  // ---------- catalog ----------
  catalog(): WritingCatalog {
    const stats = new Map<string, { attempts: number; best: number | null }>()
    for (const r of this.k.db.all<{ prompt_id: string; feedback: string | null }>(
      'SELECT prompt_id, feedback FROM writing_submissions WHERE prompt_id IS NOT NULL',
    )) {
      const s = stats.get(r.prompt_id) ?? { attempts: 0, best: null }
      s.attempts++
      const fb = parseJson<WritingFeedback>(r.feedback)
      if (fb?.scores) s.best = Math.max(s.best ?? 0, averageScore(fb.scores))
      stats.set(r.prompt_id, s)
    }
    const prompts: WritingPromptInfo[] = this.k.content
      .writingPrompts()
      .map((p) => ({ ...p, attempts: stats.get(p.id)?.attempts ?? 0, bestScore: stats.get(p.id)?.best ?? null }))
    const level = this.writingLevel()
    const li = CEFR_LEVELS.indexOf(level)
    const recommended = prompts
      .filter((p) => p.taskType !== 'free')
      .map((p, i) => {
        const d = CEFR_LEVELS.indexOf(p.cefr) - li
        const tier = (d === 0 ? 0 : d === 1 ? 1 : d === -1 ? 2 : 5) + (p.attempts ? 10 : 0)
        return { id: p.id, tier, i }
      })
      .filter((x) => x.tier < 5 || (x.tier >= 10 && x.tier < 13))
      .sort((a, b) => a.tier - b.tier || a.i - b.i)
      .slice(0, 3)
      .map((x) => x.id)
    return { prompts, writingLevel: level, recommended, aiAvailable: this.k.ai.isAvailable() }
  }

  // ---------- submit ----------
  async submit(input: SubmitInput): Promise<WritingSubmitResult> {
    const prompt = this.prompt(input.promptId)
    if (input.promptId && !prompt) throw new UserError('not_found', 'Không tìm thấy đề bài viết này.')
    const text = input.text.replace(/\r\n/g, '\n').trim()
    const metrics = textMetrics(text)
    if (metrics.words < 1) throw new UserError('too_short', 'Bài viết cần có ít nhất một từ tiếng Anh.')
    const taskType = prompt?.taskType ?? input.taskType
    const promptText = prompt ? prompt.instructions : input.promptText.trim()
    const nowIso = this.k.now().toISOString()
    const { lastInsertRowid: id } = this.k.db.run(
      `INSERT INTO writing_submissions(prompt_id, task_type, prompt_text, original_text, self_corrected_text, feedback, metrics, provider, created_at)
       VALUES (?, ?, ?, ?, NULL, NULL, ?, NULL, ?)`,
      [prompt?.id ?? null, taskType, promptText, text, JSON.stringify(metrics), nowIso],
    )

    let aiError: AiFailure | null = null
    let score: number | null = null
    if (input.analyze) {
      try {
        const fb = await this.runFeedback(id)
        score = averageScore(fb.scores)
      } catch (err) {
        aiError = toAiFailure(err)
        if (!aiError.code.startsWith('ai_')) throw err
      }
    }

    const minutes = input.minutes && input.minutes > 0 ? input.minutes : Math.min(60, Math.max(1, metrics.words / 15))
    const reward = this.k.progress.record({
      type: 'writing_submitted',
      module: 'writing',
      skill: 'writing',
      minutes: Math.round(minutes * 10) / 10,
      ...(score !== null ? { score: score / 10 } : {}),
      ref: String(id),
      title: prompt?.title ?? 'Free writing',
    })
    const skill = this.k.learner.addSkillProgress('writing', this.progressDelta(prompt, metrics, score))
    return { view: this.view(id), reward, skill, aiError }
  }

  /** 0.5..3: AI score (scaled by task difficulty) when available, otherwise length vs target. */
  private progressDelta(prompt: WritingPrompt | null, metrics: TextMetrics, score: number | null): number {
    const min = prompt?.minWords ?? 30
    const lengthFactor = Math.min(1, metrics.words / Math.max(1, min))
    if (score === null) return Math.round((0.5 + 0.5 * lengthFactor) * 10) / 10
    const d = prompt ? CEFR_LEVELS.indexOf(prompt.cefr) - CEFR_LEVELS.indexOf(this.writingLevel()) : 0
    const challenge = d >= 1 ? 1.2 : d === 0 ? 1 : d === -1 ? 0.7 : 0.4
    return (
      Math.round(Math.min(3, Math.max(0.5, (0.5 + 2.5 * (score / 10)) * challenge * (0.5 + 0.5 * lengthFactor))) * 10) /
      10
    )
  }

  /** Runs AI feedback for a stored submission, saves it and records recurring mistakes. */
  private async runFeedback(id: number): Promise<WritingFeedback> {
    const row = this.row(id)
    const prompt = this.prompt(row.prompt_id)
    const res = await this.k.ai.run(writingFeedbackPrompt, {
      text: row.original_text,
      taskType: row.task_type,
      promptTitle: prompt?.title ?? '',
      instructions: row.prompt_text,
      promptCefr: prompt?.cefr ?? null,
      minWords: prompt?.minWords ?? null,
      maxWords: prompt?.maxWords ?? null,
    })
    const feedback = toWritingFeedback(res.data)
    this.k.db.run('UPDATE writing_submissions SET feedback = ?, provider = ? WHERE id = ?', [
      JSON.stringify(feedback),
      res.provider,
      id,
    ])
    this.recordMistakes(res.data.errors)
    return feedback
  }

  private recordMistakes(errors: FeedbackOutput['errors']): void {
    for (const e of errors.slice(0, 10)) {
      const pattern = e.rule.trim() || `${e.original.trim()} → ${e.correction.trim()}`
      this.k.learner.recordMistake({ category: e.category, pattern, example: e.original, correction: e.correction })
    }
  }

  async analyze(id: number): Promise<WritingSubmissionView> {
    await this.runFeedback(id)
    return this.view(id)
  }

  // ---------- self-correction ----------
  async selfCorrect(input: { id: number; text: string; useAi: boolean }): Promise<WritingSelfCorrectResult> {
    const row = this.row(input.id)
    const revised = input.text.replace(/\r\n/g, '\n').trim()
    this.k.db.run('UPDATE writing_submissions SET self_corrected_text = ? WHERE id = ?', [revised, input.id])
    const feedback = parseJson<WritingFeedback>(row.feedback)
    const errors = feedback?.errors ?? []
    const { fixed, remaining } = checkFixes(errors, revised)
    const recheck: WritingRecheck = { fixed, remaining, ai: null, aiError: null }
    if (input.useAi && feedback) {
      try {
        const res = await this.k.ai.run(writingRecheckPrompt, { original: row.original_text, revised, errors })
        recheck.ai = res.data
      } catch (err) {
        recheck.aiError = toAiFailure(err)
        if (!recheck.aiError.code.startsWith('ai_')) throw err
      }
    }
    const firstTime = row.self_corrected_text === null
    if (firstTime && errors.length && fixed.length / errors.length >= 0.5)
      this.k.learner.addSkillProgress('writing', 0.5)
    return { view: this.view(input.id), recheck }
  }

  // ---------- history ----------
  history(opts: { limit?: number; promptId?: string } = {}): WritingHistoryItem[] {
    const rows = opts.promptId
      ? this.k.db.all<SubmissionRow>('SELECT * FROM writing_submissions WHERE prompt_id = ? ORDER BY id DESC LIMIT ?', [
          opts.promptId,
          opts.limit ?? 100,
        ])
      : this.k.db.all<SubmissionRow>('SELECT * FROM writing_submissions ORDER BY id DESC LIMIT ?', [opts.limit ?? 100])
    return rows.map((r) => {
      const s = toSubmission(r)
      const prompt = this.prompt(r.prompt_id)
      return {
        id: s.id,
        promptId: s.promptId,
        title: prompt?.title ?? (s.promptText ? s.promptText.slice(0, 60) : 'Free writing'),
        taskType: s.taskType,
        words: s.metrics.words,
        score: s.feedback ? averageScore(s.feedback.scores) : null,
        cefr: s.feedback?.cefrEstimate ?? null,
        heuristicCefr: s.metrics.heuristicCefr,
        ieltsBand: s.feedback?.ieltsBandEstimate ?? null,
        selfCorrected: s.selfCorrectedText !== null,
        createdAt: s.createdAt,
      }
    })
  }

  delete(id: number): null {
    this.k.db.run('DELETE FROM writing_submissions WHERE id = ?', [id])
    return null
  }
}

function toAiFailure(err: unknown): AiFailure {
  const e = toIpcError(err)
  return { code: e.code, message: e.message, ...(e.hint ? { hint: e.hint } : {}) }
}
