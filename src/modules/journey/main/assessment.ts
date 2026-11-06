// Adaptive placement assessment: one staircase per objective skill (vocabulary, grammar, reading, listening),
// optional writing/speaking tasks estimated by AI (or offline heuristics), persisted in assessments tables.
import type { AssessmentItem, Cefr } from '@shared/content'
import { ASSESSMENT_SKILLS } from '@shared/content'
import type { AssessmentItemView, AssessmentResult, Skill, SkillLevel, SkillResult } from '@shared/types'
import { ITEMS_PER_SKILL, estimateLevel, nextAssessmentItem, type AnsweredItem } from '@core/assessment'
import { SELF_LEVEL_TO_CEFR, averageCefr, minCefr } from '@core/cefr'
import { optionOrder, pickOne, rngFor } from '@core/shuffle'
import { textMetrics, tokenizeWords } from '@core/text'
import type { Kernel } from '../../../main/kernel'
import { AiError } from '../../../main/kernel/ai/types'
import { UserError } from '../../../main/ipc/router'
import { estimateFromOtherSkills, heuristicSpeakingCefr } from './logic'
import type { AssessmentSession, AssessmentSummary, ObjectiveSkill, ProductiveEstimate } from '../contract'
import { speakingPlacementPrompt, writingPlacementPrompt } from './prompts'

/** Productive tasks: one of each is picked per attempt so a retake is not the same test. */
export const WRITING_TASKS = [
  {
    en: 'Write 3–5 sentences about yourself: where you live, what you do every day and why you want to learn English.',
    vi: 'Viết 3–5 câu giới thiệu bản thân: bạn sống ở đâu, hằng ngày làm gì và vì sao muốn học tiếng Anh.',
  },
  {
    en: 'Write 3–5 sentences about your last weekend: where you went, who you were with and what you enjoyed most.',
    vi: 'Viết 3–5 câu về cuối tuần vừa rồi: bạn đã đi đâu, đi cùng ai và thích điều gì nhất.',
  },
  {
    en: 'Write 3–5 sentences describing a person you admire and explain why.',
    vi: 'Viết 3–5 câu mô tả một người bạn ngưỡng mộ và giải thích vì sao.',
  },
  {
    en: 'Write 3–5 sentences about your job or studies: what you do, what you like and what is difficult.',
    vi: 'Viết 3–5 câu về công việc hoặc việc học của bạn: bạn làm gì, thích gì và điều gì khó.',
  },
  {
    en: 'Write 3–5 sentences about a trip you would like to take and what you hope to do there.',
    vi: 'Viết 3–5 câu về một chuyến đi bạn muốn thực hiện và bạn mong làm gì ở đó.',
  },
  {
    en: 'Write 3–5 sentences giving your opinion: is it better to live in a big city or in the countryside? Why?',
    vi: 'Viết 3–5 câu nêu ý kiến: sống ở thành phố lớn hay ở nông thôn thì tốt hơn? Vì sao?',
  },
] as const
export const SPEAKING_TASKS = [
  {
    en: 'Talk for 30–60 seconds: describe your favourite place in your city and explain why you like it.',
    vi: 'Nói trong 30–60 giây: mô tả nơi bạn thích nhất ở thành phố của bạn và giải thích vì sao.',
  },
  {
    en: 'Talk for 30–60 seconds: describe your daily routine on a typical weekday.',
    vi: 'Nói trong 30–60 giây: mô tả một ngày thường trong tuần của bạn.',
  },
  {
    en: 'Talk for 30–60 seconds: describe a meal you really enjoy and when you usually have it.',
    vi: 'Nói trong 30–60 giây: mô tả một món ăn bạn rất thích và bạn thường ăn khi nào.',
  },
  {
    en: 'Talk for 30–60 seconds: describe a skill you would like to learn and explain why.',
    vi: 'Nói trong 30–60 giây: mô tả một kỹ năng bạn muốn học và giải thích vì sao.',
  },
  {
    en: 'Talk for 30–60 seconds: describe a festival or holiday in your country and what people do.',
    vi: 'Nói trong 30–60 giây: mô tả một lễ hội hoặc ngày lễ ở nước bạn và mọi người làm gì.',
  },
  {
    en: 'Talk for 30–60 seconds: do you prefer studying alone or with other people? Give your reasons.',
    vi: 'Nói trong 30–60 giây: bạn thích học một mình hay học cùng người khác? Nêu lý do.',
  },
] as const
type Task = (typeof WRITING_TASKS)[number] | (typeof SPEAKING_TASKS)[number]

interface AssessmentRow {
  id: number
  started_at: string
  completed_at: string | null
  start_level: Cefr
  overall_cefr: Cefr | null
  results: string | null
}

interface AnswerRow {
  skill: string
  item_id: string
  cefr: Cefr
  correct: number
  response: string | null
  created_at: string
}

const OBJECTIVE: readonly ObjectiveSkill[] = ASSESSMENT_SKILLS

/** Highest level the staircase starts at; strong learners climb quickly, weak ones are not discouraged. */
const START_CAP: Cefr = 'B2'

export class AssessmentService {
  constructor(private readonly k: Kernel) {}

  private bank(skill: ObjectiveSkill): AssessmentItem[] {
    return this.k.content.assessment().filter((i) => i.skill === skill)
  }

  private row(id: number): AssessmentRow {
    const r = this.k.db.get<AssessmentRow>('SELECT * FROM assessments WHERE id = ?', [id])
    if (!r) throw new UserError('not_found', 'Không tìm thấy bài kiểm tra đầu vào.')
    return r
  }

  private answers(id: number): AnswerRow[] {
    return this.k.db.all<AnswerRow>(
      'SELECT skill, item_id, cefr, correct, response, created_at FROM assessment_answers WHERE assessment_id = ? ORDER BY id',
      [id],
    )
  }

  private answered(rows: AnswerRow[], skill: ObjectiveSkill): AnsweredItem[] {
    return rows
      .filter((r) => r.skill === skill)
      .map((r) => ({ itemId: r.item_id, cefr: r.cefr, correct: r.correct === 1 }))
  }

  /**
   * Every random choice of an attempt derives from this key, so each attempt gets different items, option
   * order and tasks, while resuming (and the double-click guard, which recomputes `next`) stays stable.
   */
  private seed(row: AssessmentRow): string {
    return `assessment:${row.id}:${row.started_at}`
  }

  private tasks(row: AssessmentRow): { writing: Task; speaking: Task } {
    return {
      writing: pickOne(WRITING_TASKS, rngFor(`${this.seed(row)}:writing`)) ?? WRITING_TASKS[0],
      speaking: pickOne(SPEAKING_TASKS, rngFor(`${this.seed(row)}:speaking`)) ?? SPEAKING_TASKS[0],
    }
  }

  /** Display order of an item's options: `order[shownIndex] = index in the bank`. */
  private optionOrder(row: AssessmentRow, item: AssessmentItem): number[] {
    return optionOrder(item.options, rngFor(`${this.seed(row)}:options:${item.id}`))
  }

  /** Objective skill currently being tested and its next item. */
  private next(
    row: AssessmentRow,
    rows: AnswerRow[],
  ): { skill: ObjectiveSkill; item: AssessmentItem; index: number } | null {
    for (const skill of OBJECTIVE) {
      const done = this.answered(rows, skill)
      const rng = rngFor(`${this.seed(row)}:${skill}:${done.length}`)
      const item = nextAssessmentItem(this.bank(skill), done, row.start_level, undefined, rng)
      if (item) return { skill, item, index: done.length }
    }
    return null
  }

  private productive(rows: AnswerRow[], skill: 'writing' | 'speaking'): ProductiveEstimate | null {
    const r = [...rows].reverse().find((a) => a.skill === skill)
    if (!r?.response) return null
    try {
      const parsed = JSON.parse(r.response) as Omit<ProductiveEstimate, 'skill' | 'cefr'>
      return { ...parsed, skill, cefr: r.cefr }
    } catch {
      return null
    }
  }

  session(id: number): AssessmentSession {
    const row = this.row(id)
    const rows = this.answers(id)
    const nxt = row.completed_at ? null : this.next(row, rows)
    const progress = OBJECTIVE.map((skill) => {
      const answered = this.answered(rows, skill)
      const total = Math.min(ITEMS_PER_SKILL, this.bank(skill).length)
      const done = nextAssessmentItem(this.bank(skill), answered, row.start_level) === null
      return { skill, answered: answered.length, total: done ? answered.length : total, done }
    })
    let current: AssessmentItemView | null = null
    if (nxt) {
      current = {
        id: nxt.item.id,
        skill: nxt.item.skill,
        cefr: nxt.item.cefr,
        prompt: nxt.item.prompt,
        ...(nxt.item.passage ? { passage: nxt.item.passage } : {}),
        options: this.optionOrder(row, nxt.item).map((i) => nxt.item.options[i] ?? ''),
        index: nxt.index + 1,
        total: Math.min(ITEMS_PER_SKILL, this.bank(nxt.skill).length),
      }
    }
    return {
      id: row.id,
      startedAt: row.started_at,
      startLevel: row.start_level,
      completedAt: row.completed_at,
      current,
      progress,
      answeredTotal: progress.reduce((s, p) => s + p.answered, 0),
      objectiveTotal: progress.reduce((s, p) => s + p.total, 0),
      writing: this.productive(rows, 'writing'),
      speaking: this.productive(rows, 'speaking'),
      aiAvailable: this.k.ai.isAvailable(),
      tasks: this.tasks(row),
    }
  }

  start(resume = true): AssessmentSession {
    if (resume) {
      const open = this.k.db.get<{ id: number }>(
        'SELECT id FROM assessments WHERE completed_at IS NULL ORDER BY id DESC LIMIT 1',
      )
      if (open) return this.session(open.id)
    }
    const profile = this.k.learner.profile()
    const startLevel = minCefr(SELF_LEVEL_TO_CEFR[profile.selfReportedLevel], START_CAP)
    const res = this.k.db.run('INSERT INTO assessments(started_at, start_level) VALUES (?, ?)', [
      this.k.now().toISOString(),
      startLevel,
    ])
    return this.session(res.lastInsertRowid)
  }

  answer(id: number, itemId: string, choice: number): AssessmentSession {
    const row = this.row(id)
    if (row.completed_at) throw new UserError('assessment_done', 'Bài kiểm tra này đã hoàn thành.')
    const rows = this.answers(id)
    const nxt = this.next(row, rows)
    if (!nxt) throw new UserError('assessment_objective_done', 'Phần trắc nghiệm đã xong.')
    // Answers must follow the adaptive order; a stale double-click on an old item is ignored.
    if (nxt.item.id !== itemId) {
      if (rows.some((r) => r.item_id === itemId)) return this.session(id)
      throw new UserError('assessment_order', 'Câu hỏi không khớp với tiến trình bài kiểm tra. Hãy tải lại trang.')
    }
    if (choice >= nxt.item.options.length) throw new UserError('invalid_input', 'Lựa chọn không hợp lệ.')
    // `choice` is the position on screen; options are shown shuffled, so map it back to the bank's index.
    const original = this.optionOrder(row, nxt.item)[choice] ?? -1
    const correct = original === nxt.item.answerIndex
    this.k.db.run(
      `INSERT INTO assessment_answers(assessment_id, skill, item_id, cefr, correct, response, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [id, nxt.skill, itemId, nxt.item.cefr, correct ? 1 : 0, String(original), this.k.now().toISOString()],
    )
    return this.session(id)
  }

  private saveProductive(id: number, est: ProductiveEstimate, text: string): ProductiveEstimate {
    const { skill, cefr, ...rest } = est
    const itemId = `${skill}-task`
    this.k.db.transaction(() => {
      this.k.db.run('DELETE FROM assessment_answers WHERE assessment_id = ? AND item_id = ?', [id, itemId])
      this.k.db.run(
        `INSERT INTO assessment_answers(assessment_id, skill, item_id, cefr, correct, response, created_at)
         VALUES (?, ?, ?, ?, 1, ?, ?)`,
        [id, skill, itemId, cefr, JSON.stringify({ ...rest, text: text.slice(0, 3000) }), this.k.now().toISOString()],
      )
    })
    return est
  }

  async writing(id: number, text: string): Promise<ProductiveEstimate> {
    const row = this.row(id)
    if (row.completed_at) throw new UserError('assessment_done', 'Bài kiểm tra này đã hoàn thành.')
    const m = textMetrics(text)
    if (m.words < 8) throw new UserError('too_short', 'Hãy viết ít nhất 3 câu (khoảng 8 từ trở lên).')
    let est: ProductiveEstimate | null = null
    let fallback = ''
    if (this.k.ai.isAvailable()) {
      try {
        const res = await this.k.ai.run(writingPlacementPrompt, { task: this.tasks(row).writing.en, text })
        est = {
          skill: 'writing',
          cefr: res.data.cefr,
          score: Math.round(res.data.score),
          method: 'ai',
          note: res.data.comment,
          strengths: res.data.strengths,
          improvements: res.data.improvements,
          provider: res.provider,
        }
      } catch (err) {
        if (!(err instanceof AiError)) throw err
        fallback = 'AI không phản hồi, đã dùng ước lượng thô. '
        this.k.log.warn(`journey: writing placement AI failed (${err.code}), using heuristic`)
      }
    }
    est ??= {
      skill: 'writing',
      cefr: m.heuristicCefr,
      score: 40,
      method: 'heuristic',
      note: `${fallback}Ước lượng thô dựa trên độ dài câu, độ đa dạng từ vựng và từ nối (${m.words} từ, ${m.sentences} câu).`,
      strengths: m.linkingWords > 0 ? ['Có dùng từ nối / uses linking words'] : [],
      improvements: m.avgSentenceLength < 8 ? ['Viết câu dài hơn, nối ý bằng because, but, so'] : [],
      provider: null,
    }
    return this.saveProductive(id, est, text)
  }

  async speaking(id: number, transcript: string, durationSec: number): Promise<ProductiveEstimate> {
    const row = this.row(id)
    if (row.completed_at) throw new UserError('assessment_done', 'Bài kiểm tra này đã hoàn thành.')
    const words = tokenizeWords(transcript).length
    const wordsPerMinute = durationSec >= 5 ? Math.round((words / durationSec) * 60) : null
    let est: ProductiveEstimate | null = null
    let fallback = ''
    if (this.k.ai.isAvailable()) {
      try {
        const res = await this.k.ai.run(speakingPlacementPrompt, {
          task: this.tasks(row).speaking.en,
          transcript,
          durationSec,
          wordsPerMinute,
        })
        est = {
          skill: 'speaking',
          cefr: res.data.cefr,
          score: Math.round(res.data.score),
          method: 'ai',
          note: res.data.comment,
          strengths: res.data.strengths,
          improvements: res.data.improvements,
          provider: res.provider,
        }
      } catch (err) {
        if (!(err instanceof AiError)) throw err
        fallback = 'AI không phản hồi, đã dùng ước lượng thô. '
      }
    }
    if (!est) {
      const m = textMetrics(transcript)
      est = {
        skill: 'speaking',
        cefr: heuristicSpeakingCefr(m.heuristicCefr, wordsPerMinute, words),
        score: 35,
        method: 'heuristic',
        note: `${fallback}Ước lượng thô từ bản ghi (${words} từ${wordsPerMinute ? `, ${wordsPerMinute} từ/phút` : ''}); chưa đánh giá phát âm.`,
        strengths: [],
        improvements: [],
        provider: null,
      }
    }
    return this.saveProductive(id, est, transcript)
  }

  private toResult(row: AssessmentRow): AssessmentResult | null {
    if (!row.completed_at || !row.overall_cefr || !row.results) return null
    try {
      return {
        id: row.id,
        completedAt: row.completed_at,
        overall: row.overall_cefr,
        skills: JSON.parse(row.results) as SkillResult[],
      }
    } catch {
      return null
    }
  }

  finish(id: number): AssessmentResult {
    const row = this.row(id)
    const existing = this.toResult(row)
    if (existing) return existing
    const rows = this.answers(id)
    if (this.next(row, rows)) throw new UserError('assessment_incomplete', 'Bạn chưa hoàn thành phần trắc nghiệm.')

    const skills: SkillResult[] = OBJECTIVE.map((skill) => {
      const est = estimateLevel(this.answered(rows, skill))
      return {
        skill,
        cefr: est.cefr,
        score: est.score,
        correct: est.correct,
        answered: est.answered,
        estimated: false,
        method: 'adaptive-test' as const,
        note: `${est.correct}/${est.answered} correct`,
      }
    })
    const receptive = skills.map((s) => s.cefr)
    for (const skill of ['writing', 'speaking'] as const) {
      const p = this.productive(rows, skill)
      if (p) {
        skills.push({ skill, cefr: p.cefr, score: p.score, estimated: true, method: p.method, note: p.note })
      } else {
        skills.push({
          skill,
          cefr: estimateFromOtherSkills(receptive),
          score: 30,
          estimated: true,
          method: 'skipped',
          note: 'Estimated from your other skills (task skipped). / Ước lượng từ các kỹ năng khác vì bạn bỏ qua phần này.',
        })
      }
    }
    const overall = averageCefr(skills.map((s) => s.cefr))
    const nowIso = this.k.now().toISOString()
    this.k.db.transaction(() => {
      this.k.db.run('UPDATE assessments SET completed_at = ?, overall_cefr = ?, results = ? WHERE id = ?', [
        nowIso,
        overall,
        JSON.stringify(skills),
        id,
      ])
      for (const s of skills) {
        this.k.learner.setSkillLevel({
          skill: s.skill,
          cefr: s.cefr,
          score: s.score,
          source: 'assessment',
          estimated: s.estimated,
        })
      }
    })
    const minutes = Math.min(60, Math.max(1, Math.round((Date.parse(nowIso) - Date.parse(row.started_at)) / 60000)))
    const correct = skills.reduce((n, s) => n + (s.correct ?? 0), 0)
    const answered = skills.reduce((n, s) => n + (s.answered ?? 0), 0)
    this.k.progress.record({
      type: 'assessment_done',
      module: 'journey',
      skill: null,
      minutes,
      score: answered ? correct / answered : undefined,
      ref: `assessment:${id}`,
      title: `Placement test – ${overall}`,
    })
    return this.toResult(this.row(id)) as AssessmentResult
  }

  latest(): AssessmentResult | null {
    const row = this.k.db.get<AssessmentRow>(
      'SELECT * FROM assessments WHERE completed_at IS NOT NULL ORDER BY completed_at DESC, id DESC LIMIT 1',
    )
    return row ? this.toResult(row) : null
  }

  history(): AssessmentSummary[] {
    return this.k.db
      .all<{ id: number; completed_at: string; overall_cefr: Cefr }>(
        'SELECT id, completed_at, overall_cefr FROM assessments WHERE completed_at IS NOT NULL ORDER BY completed_at DESC LIMIT 20',
      )
      .map((r) => ({ id: r.id, completedAt: r.completed_at, overall: r.overall_cefr }))
  }

  /** Skip placement: every skill takes the self-reported level, marked as a self estimate. */
  skip(): SkillLevel[] {
    const cefr = SELF_LEVEL_TO_CEFR[this.k.learner.profile().selfReportedLevel]
    const all: Skill[] = ['vocabulary', 'grammar', 'reading', 'listening', 'writing', 'speaking']
    this.k.db.transaction(() => {
      for (const skill of all) this.k.learner.setSkillLevel({ skill, cefr, score: 0, source: 'self', estimated: true })
    })
    return this.k.learner.skillLevels()
  }
}
