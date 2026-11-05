// Reading Adventure business logic. No Electron imports – fully testable with an in-memory kernel.
import { ReadingPassageSchema, type Cefr, type ReadingPassage } from '@shared/content'
import { readingWpm } from '@core/text'
import type { Kernel } from '../../../main/kernel'
import { UserError } from '../../../main/ipc/router'
import { estimateMinutes, passageWordCount, recommendPassages, scoreQuiz, slugify } from './lib'
import type {
  HighlightColor,
  PassageSource,
  PassageSummary,
  PassageView,
  ReadingHighlight,
  ReadingHistoryEntry,
  ReadingLibrary,
  ReadingResult,
  RetellFeedback,
  SentenceExplanation,
} from '../contract'
import { explainSentencePrompt, generatePassagePrompt, retellPrompt } from './prompts'

interface HistoryRow {
  id: number
  passage_id: string
  words: number
  seconds: number
  wpm: number
  quiz_correct: number
  quiz_total: number
  created_at: string
}

interface HighlightRow {
  id: number
  passage_id: string
  text: string
  note: string
  color: HighlightColor
  created_at: string
}

interface GeneratedRow {
  id: string
  data: string
  provider: string | null
  created_at: string
}

interface LoadedPassage {
  passage: ReadingPassage
  source: PassageSource
  createdAt: string | null
}

const toHighlight = (r: HighlightRow): ReadingHighlight => ({
  id: r.id,
  passageId: r.passage_id,
  text: r.text,
  note: r.note,
  color: r.color,
  createdAt: r.created_at,
})

export class ReadingService {
  constructor(private readonly k: Kernel) {}

  // ---------- passages ----------
  private generated(): LoadedPassage[] {
    const rows = this.k.db.all<GeneratedRow>(
      "SELECT id, data, provider, created_at FROM generated_content WHERE kind = 'reading' ORDER BY created_at DESC",
    )
    const out: LoadedPassage[] = []
    for (const r of rows) {
      try {
        const parsed = ReadingPassageSchema.safeParse(JSON.parse(r.data))
        if (parsed.success) out.push({ passage: parsed.data, source: 'ai', createdAt: r.created_at })
        else this.k.log.warn(`reading: generated passage ${r.id} is invalid and was skipped`)
      } catch {
        this.k.log.warn(`reading: generated passage ${r.id} is not valid JSON`)
      }
    }
    return out
  }

  private all(): LoadedPassage[] {
    return [
      ...this.k.content.reading().map((passage) => ({ passage, source: 'builtin' as const, createdAt: null })),
      ...this.generated(),
    ]
  }

  private find(id: string): LoadedPassage {
    const builtin = this.k.content.reading().find((p) => p.id === id)
    if (builtin) return { passage: builtin, source: 'builtin', createdAt: null }
    const found = this.generated().find((g) => g.passage.id === id)
    if (!found) throw new UserError('not_found', 'Không tìm thấy bài đọc này.')
    return found
  }

  readingLevel(): Cefr {
    return this.k.learner.skillLevels().find((s) => s.skill === 'reading')?.cefr ?? this.k.learner.overallCefr()
  }

  private summarize(
    l: LoadedPassage,
    stats: Map<string, { n: number; best: number | null; wpm: number | null; last: string }>,
  ): PassageSummary {
    const words = passageWordCount(l.passage.body)
    const s = stats.get(l.passage.id)
    return {
      id: l.passage.id,
      title: l.passage.title,
      category: l.passage.category,
      cefr: l.passage.cefr,
      topicTags: l.passage.topicTags,
      summaryVi: l.passage.summaryVi,
      words,
      minutes: estimateMinutes(words, l.passage.cefr),
      source: l.source,
      readCount: s?.n ?? 0,
      bestScore: s?.best ?? null,
      bestWpm: s?.wpm ?? null,
      lastReadAt: s?.last ?? null,
      createdAt: l.createdAt,
    }
  }

  private historyStats() {
    const rows = this.k.db.all<{
      passage_id: string
      n: number
      best: number | null
      wpm: number | null
      last: string
    }>(
      `SELECT passage_id, COUNT(*) AS n,
         MAX(CASE WHEN quiz_total > 0 THEN CAST(quiz_correct AS REAL) / quiz_total END) AS best,
         MAX(wpm) AS wpm, MAX(created_at) AS last
       FROM reading_history GROUP BY passage_id`,
    )
    return new Map(
      rows.map((r) => [
        r.passage_id,
        {
          n: Number(r.n),
          best: r.best === null ? null : Number(r.best),
          wpm: r.wpm === null ? null : Number(r.wpm),
          last: r.last,
        },
      ]),
    )
  }

  library(): ReadingLibrary {
    const stats = this.historyStats()
    const passages = this.all().map((l) => this.summarize(l, stats))
    const level = this.readingLevel()
    const agg = this.k.db.get<{ n: number; wpm: number | null; score: number | null }>(
      `SELECT COUNT(*) AS n, AVG(wpm) AS wpm,
         AVG(CASE WHEN quiz_total > 0 THEN CAST(quiz_correct AS REAL) / quiz_total END) AS score
       FROM reading_history`,
    )
    return {
      passages,
      readingLevel: level,
      recommended: recommendPassages(passages, level, 4),
      stats: {
        completed: Number(agg?.n ?? 0),
        averageWpm: agg?.wpm === null || agg?.wpm === undefined ? null : Math.round(Number(agg.wpm)),
        averageScore:
          agg?.score === null || agg?.score === undefined ? null : Math.round(Number(agg.score) * 100) / 100,
      },
    }
  }

  get(id: string): PassageView {
    const l = this.find(id)
    return {
      passage: l.passage,
      source: l.source,
      words: passageWordCount(l.passage.body),
      history: this.history({ passageId: id, limit: 20 }),
      highlights: this.highlights(id),
    }
  }

  // ---------- history ----------
  history(opts: { limit?: number; passageId?: string } = {}): ReadingHistoryEntry[] {
    const rows = opts.passageId
      ? this.k.db.all<HistoryRow>('SELECT * FROM reading_history WHERE passage_id = ? ORDER BY id DESC LIMIT ?', [
          opts.passageId,
          opts.limit ?? 50,
        ])
      : this.k.db.all<HistoryRow>('SELECT * FROM reading_history ORDER BY id DESC LIMIT ?', [opts.limit ?? 50])
    const titles = new Map(this.all().map((l) => [l.passage.id, l.passage.title]))
    return rows.map((r) => ({
      id: r.id,
      passageId: r.passage_id,
      title: titles.get(r.passage_id) ?? r.passage_id,
      words: r.words,
      seconds: r.seconds,
      wpm: r.wpm,
      quizCorrect: r.quiz_correct,
      quizTotal: r.quiz_total,
      createdAt: r.created_at,
    }))
  }

  complete(input: { id: string; seconds: number; answers: number[] }): ReadingResult {
    const { passage } = this.find(input.id)
    const words = passageWordCount(passage.body)
    const seconds = Math.max(1, Math.round(input.seconds))
    const wpm = readingWpm(words, seconds)
    const quiz = scoreQuiz(passage.questions, input.answers)
    const total = passage.questions.length
    const accuracy = total ? quiz.count / total : 0
    const nowIso = this.k.now().toISOString()
    const { lastInsertRowid } = this.k.db.run(
      `INSERT INTO reading_history(passage_id, words, seconds, wpm, quiz_correct, quiz_total, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [passage.id, words, seconds, wpm, quiz.count, total, nowIso],
    )
    const reward = this.k.progress.record({
      type: 'reading_done',
      module: 'reading',
      skill: 'reading',
      minutes: Math.round((seconds / 60) * 10) / 10,
      score: accuracy,
      ref: passage.id,
      title: passage.title,
    })
    const skill = this.k.learner.addSkillProgress('reading', this.progressDelta(passage.cefr, accuracy))
    return {
      entry: {
        id: lastInsertRowid,
        passageId: passage.id,
        title: passage.title,
        words,
        seconds,
        wpm,
        quizCorrect: quiz.count,
        quizTotal: total,
        createdAt: nowIso,
      },
      accuracy,
      correct: quiz.correct,
      reward,
      skill,
    }
  }

  /** 0.5..3 depending on quiz accuracy and how challenging the passage is for the learner. */
  private progressDelta(cefr: Cefr, accuracy: number): number {
    const order = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2']
    const diff = order.indexOf(cefr) - order.indexOf(this.readingLevel())
    const challenge = diff >= 1 ? 1.25 : diff === 0 ? 1 : diff === -1 ? 0.6 : 0.35
    return Math.round(Math.min(3, Math.max(0.5, (0.5 + 2.5 * accuracy) * challenge)) * 10) / 10
  }

  savedWords(): string[] {
    return this.k.db.all<{ word: string }>('SELECT word FROM vocabulary').map((r) => r.word.trim().toLowerCase())
  }

  // ---------- highlights ----------
  highlights(passageId: string): ReadingHighlight[] {
    return this.k.db
      .all<HighlightRow>('SELECT * FROM reading_highlights WHERE passage_id = ? ORDER BY id', [passageId])
      .map(toHighlight)
  }

  addHighlight(input: { passageId: string; text: string; note: string; color: HighlightColor }): ReadingHighlight {
    this.find(input.passageId)
    const { lastInsertRowid } = this.k.db.run(
      'INSERT INTO reading_highlights(passage_id, text, note, color, created_at) VALUES (?, ?, ?, ?, ?)',
      [input.passageId, input.text.trim(), input.note.trim(), input.color, this.k.now().toISOString()],
    )
    return this.highlightById(lastInsertRowid)
  }

  private highlightById(id: number): ReadingHighlight {
    const row = this.k.db.get<HighlightRow>('SELECT * FROM reading_highlights WHERE id = ?', [id])
    if (!row) throw new UserError('not_found', 'Không tìm thấy đoạn đánh dấu.')
    return toHighlight(row)
  }

  updateHighlight(input: { id: number; note?: string; color?: HighlightColor }): ReadingHighlight {
    const cur = this.highlightById(input.id)
    this.k.db.run('UPDATE reading_highlights SET note = ?, color = ? WHERE id = ?', [
      input.note !== undefined ? input.note.trim() : cur.note,
      input.color ?? cur.color,
      input.id,
    ])
    return this.highlightById(input.id)
  }

  deleteHighlight(id: number): null {
    this.k.db.run('DELETE FROM reading_highlights WHERE id = ?', [id])
    return null
  }

  // ---------- AI ----------
  async generate(input: { cefr: Cefr; category: ReadingPassage['category']; topic: string }): Promise<PassageSummary> {
    const avoidTitles = this.all().map((l) => l.passage.title)
    const res = await this.k.ai.run(generatePassagePrompt, { ...input, avoidTitles }, { level: input.cefr })
    const nowIso = this.k.now().toISOString()
    const stamp = this.k.now().getTime().toString(36)
    const id = `ai-${slugify(res.data.title, 36)}-${stamp}`
    const passage: ReadingPassage = {
      ...res.data,
      id,
      questions: res.data.questions.map((q, i) => ({ ...q, id: `${id}-q${i + 1}` })),
    }
    // Re-validate the final object so a stored passage can always be loaded again.
    const parsed = ReadingPassageSchema.parse(passage)
    this.k.db.run(
      `INSERT INTO generated_content(id, kind, cefr, title, data, provider, created_at) VALUES (?, 'reading', ?, ?, ?, ?, ?)`,
      [id, parsed.cefr, parsed.title, JSON.stringify(parsed), res.provider, nowIso],
    )
    return this.summarize({ passage: parsed, source: 'ai', createdAt: nowIso }, new Map())
  }

  deleteGenerated(id: string): null {
    const row = this.k.db.get<{ id: string }>("SELECT id FROM generated_content WHERE id = ? AND kind = 'reading'", [
      id,
    ])
    if (!row) throw new UserError('not_found', 'Chỉ xóa được bài đọc do AI tạo.')
    this.k.db.transaction(() => {
      this.k.db.run('DELETE FROM generated_content WHERE id = ?', [id])
      this.k.db.run('DELETE FROM reading_highlights WHERE passage_id = ?', [id])
    })
    return null
  }

  async explainSentence(input: {
    passageId?: string
    sentence: string
    context?: string
  }): Promise<SentenceExplanation> {
    const level = input.passageId ? this.find(input.passageId).passage.cefr : undefined
    const res = await this.k.ai.run(
      explainSentencePrompt,
      { sentence: input.sentence, context: input.context },
      level ? { level } : {},
    )
    return { sentence: input.sentence, ...res.data }
  }

  async retell(input: { id: string; text: string }): Promise<RetellFeedback> {
    const { passage } = this.find(input.id)
    const res = await this.k.ai.run(
      retellPrompt,
      { title: passage.title, body: passage.body, cefr: passage.cefr, retelling: input.text },
      { level: passage.cefr },
    )
    const d = res.data
    const covered = d.mainPoints.filter((p) => p.covered).length
    if (d.score >= 6) this.k.learner.addSkillProgress('reading', 0.5)
    return { ...d, coverage: d.mainPoints.length ? Math.round((covered / d.mainPoints.length) * 100) / 100 : 0 }
  }
}
