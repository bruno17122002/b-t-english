// Grammar Kingdom business logic: topic mastery, recommendations, drill grading and AI extras.
// Free of Electron imports so it runs under Vitest.
import type { Cefr, GrammarTopic } from '@shared/content'
import { CEFR_LEVELS } from '@shared/content'
import { cefrIndex } from '@core/cefr'
import type { Kernel } from '../../../main/kernel'
import { UserError } from '../../../main/ipc/router'
import {
  checkAnswer,
  fillGap,
  type GeneratedExercises,
  type GrammarAnswerResult,
  type GrammarCastle,
  type GrammarExercise,
  type GrammarOverview,
  type GrammarRecommendation,
  type GrammarSubmitResult,
  type GrammarTopicCard,
  type GrammarTopicView,
  type MistakeExplanation,
  type RecurringGrammarMistake,
  type TopicStatus,
} from '../contract'
import { explainPrompt, exerciseLeak, exercisesPrompt } from './prompts'

export const MASTERY_THRESHOLD = 0.8

const CASTLE_NAMES: Record<Cefr, { en: string; vi: string }> = {
  A1: { en: 'Foundation Keep', vi: 'Thành Nền Móng' },
  A2: { en: 'Timekeeper Tower', vi: 'Tháp Thời Gian' },
  B1: { en: 'Castle of Connections', vi: 'Lâu đài Kết Nối' },
  B2: { en: 'Citadel of Precision', vi: 'Thành trì Chính Xác' },
  C1: { en: 'Summit Palace', vi: 'Cung điện Đỉnh Cao' },
  C2: { en: 'Crown of Mastery', vi: 'Vương miện Bậc Thầy' },
}

interface AttemptRow {
  content_ref: string
  score: number | null
  details: string | null
  created_at: string
}

interface AttemptDetails {
  correct: number
  total: number
}

type SubmitAnswer = { exerciseId: string; given: string; exercise?: GrammarExercise }

const parseDetails = (s: string | null): AttemptDetails => {
  try {
    const v = JSON.parse(s ?? '{}') as Partial<AttemptDetails>
    return { correct: Number(v.correct ?? 0), total: Number(v.total ?? 0) }
  } catch {
    return { correct: 0, total: 0 }
  }
}

const statusOf = (mastery: number, attempts: number): TopicStatus =>
  mastery >= MASTERY_THRESHOLD ? 'mastered' : attempts > 0 ? 'learning' : 'new'

const norm = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

/** Maps a recorded mistake pattern (a topic title, or free text from other modules) to a topic. */
export function matchTopic(pattern: string, topics: GrammarTopic[]): GrammarTopic | null {
  const p = norm(pattern)
  if (!p) return null
  const exact = topics.find((t) => norm(t.title) === p)
  if (exact) return exact
  // Keyword match on the topic id ("gr-past-simple" → "past simple").
  let best: { topic: GrammarTopic; score: number } | null = null
  for (const t of topics) {
    const key = t.id.replace(/^gr-/, '').replace(/-/g, ' ')
    const words = key.split(' ').filter((w) => w.length > 2)
    if (!words.length) continue
    if (p.includes(key)) return t
    const hits = words.filter((w) => p.includes(w)).length
    const score = hits / words.length
    if (score >= 0.99 && (!best || score > best.score)) best = { topic: t, score }
  }
  return best?.topic ?? null
}

export class GrammarService {
  constructor(private readonly kernel: Kernel) {}

  private topics(): GrammarTopic[] {
    return this.kernel.content.grammar()
  }

  private topicOrThrow(id: string): GrammarTopic {
    const t = this.topics().find((x) => x.id === id)
    if (!t) throw new UserError('not_found', 'Không tìm thấy chủ điểm ngữ pháp này.')
    return t
  }

  private attempts(): AttemptRow[] {
    return this.kernel.db.all<AttemptRow>(
      "SELECT content_ref, score, details, created_at FROM lesson_attempts WHERE module = 'grammar' AND content_ref IS NOT NULL ORDER BY created_at ASC, id ASC",
    )
  }

  private grammarMistakes(): RecurringGrammarMistake[] {
    const topics = this.topics()
    return this.kernel.learner
      .mistakes(100)
      .filter((m) => m.category === 'grammar')
      .map((m) => ({
        pattern: m.pattern,
        example: m.example,
        correction: m.correction,
        count: m.count,
        topicId: matchTopic(m.pattern, topics)?.id ?? null,
      }))
  }

  private grammarLevel(): { cefr: Cefr; score: number } {
    const s = this.kernel.learner.skillLevels().find((k) => k.skill === 'grammar')
    return { cefr: s?.cefr ?? 'A1', score: s?.score ?? 0 }
  }

  private cards(): GrammarTopicCard[] {
    const byTopic = new Map<string, AttemptRow[]>()
    for (const a of this.attempts()) byTopic.set(a.content_ref, [...(byTopic.get(a.content_ref) ?? []), a])
    const mistakeCounts = new Map<string, number>()
    for (const m of this.grammarMistakes())
      if (m.topicId) mistakeCounts.set(m.topicId, (mistakeCounts.get(m.topicId) ?? 0) + m.count)
    return this.topics().map((t) => {
      const rows = byTopic.get(t.id) ?? []
      const mastery = rows.reduce((b, r) => Math.max(b, r.score ?? 0), 0)
      const last = rows[rows.length - 1]
      return {
        id: t.id,
        title: t.title,
        cefr: t.cefr,
        summaryEn: t.summaryEn,
        exerciseCount: t.exercises.length,
        mastery,
        attempts: rows.length,
        lastScore: last?.score ?? null,
        lastAt: last?.created_at ?? null,
        mistakeCount: mistakeCounts.get(t.id) ?? 0,
        status: statusOf(mastery, rows.length),
      }
    })
  }

  /** Picks the next topic: recurring mistakes first, then the first unmastered topic at/below the learner's level. */
  recommend(cards: GrammarTopicCard[], level: Cefr): GrammarRecommendation | null {
    const lvl = cefrIndex(level)
    const open = cards.filter((c) => c.status !== 'mastered')
    const make = (c: GrammarTopicCard, reason: GrammarRecommendation['reason']): GrammarRecommendation => {
      const texts: Record<GrammarRecommendation['reason'], [string, string]> = {
        mistakes: [
          `You keep making mistakes with this (${c.mistakeCount}×). Let's fix it for good.`,
          `Bạn hay mắc lỗi ở chủ điểm này (${c.mistakeCount} lần). Cùng sửa dứt điểm nhé.`,
        ],
        level: [
          `Core grammar for your level (${level}) that you have not mastered yet.`,
          `Ngữ pháp cốt lõi ở trình độ của bạn (${level}) mà bạn chưa thành thạo.`,
        ],
        'next-level': [
          `You have conquered your level – time to climb to ${c.cefr}.`,
          `Bạn đã chinh phục trình độ hiện tại – hãy tiến lên ${c.cefr}.`,
        ],
        review: ['Keep this topic fresh with a quick review.', 'Ôn nhanh để giữ kiến thức luôn vững.'],
      }
      const [reasonEn, reasonVi] = texts[reason]
      return { topicId: c.id, title: c.title, cefr: c.cefr, reason, reasonEn, reasonVi }
    }
    const withMistakes = open
      .filter((c) => c.mistakeCount > 0 && cefrIndex(c.cefr) <= lvl + 1)
      .sort((a, b) => b.mistakeCount - a.mistakeCount || cefrIndex(a.cefr) - cefrIndex(b.cefr))
    if (withMistakes[0]) return make(withMistakes[0], 'mistakes')
    const atLevel = open.filter((c) => cefrIndex(c.cefr) <= lvl)
    // Prefer topics already started (finish what you began), then course order.
    const started = atLevel.find((c) => c.status === 'learning')
    if (started) return make(started, 'level')
    if (atLevel[0]) return make(atLevel[0], 'level')
    const above = open.sort((a, b) => cefrIndex(a.cefr) - cefrIndex(b.cefr))[0]
    if (above) return make(above, 'next-level')
    const stalest = [...cards].sort((a, b) => (a.lastAt ?? '').localeCompare(b.lastAt ?? ''))[0]
    return stalest ? make(stalest, 'review') : null
  }

  overview(): GrammarOverview {
    const cards = this.cards()
    const level = this.grammarLevel()
    const castles: GrammarCastle[] = CEFR_LEVELS.flatMap((cefr) => {
      const topics = cards.filter((c) => c.cefr === cefr)
      if (!topics.length) return []
      return [
        {
          cefr,
          name: CASTLE_NAMES[cefr],
          topics,
          mastered: topics.filter((t) => t.status === 'mastered').length,
          aboveLevel: cefrIndex(cefr) > cefrIndex(level.cefr),
        },
      ]
    })
    return {
      level: level.cefr,
      levelScore: level.score,
      castles,
      recommended: this.recommend(cards, level.cefr),
      totals: {
        topics: cards.length,
        mastered: cards.filter((c) => c.status === 'mastered').length,
        attempts: cards.reduce((s, c) => s + c.attempts, 0),
        exercises: cards.reduce((s, c) => s + c.exerciseCount, 0),
      },
      recurringMistakes: this.grammarMistakes().slice(0, 6),
      aiAvailable: this.kernel.ai.isAvailable(),
    }
  }

  topic(id: string): GrammarTopicView {
    const topic = this.topicOrThrow(id)
    const cards = this.cards()
    const card = cards.find((c) => c.id === id) as GrammarTopicCard
    const all = this.topics()
    const idx = all.findIndex((t) => t.id === id)
    const next =
      all.slice(idx + 1).find((t) => cards.find((c) => c.id === t.id)?.status !== 'mastered') ?? all[idx + 1] ?? null
    const attempts = this.attempts()
      .filter((a) => a.content_ref === id)
      .slice(-8)
      .reverse()
      .map((a) => ({ score: a.score ?? 0, createdAt: a.created_at, ...parseDetails(a.details) }))
    return {
      topic,
      mastery: card.mastery,
      status: card.status,
      attempts,
      mistakeCount: card.mistakeCount,
      nextTopic: next ? { id: next.id, title: next.title, cefr: next.cefr } : null,
      aiAvailable: this.kernel.ai.isAvailable(),
      learnerLevel: this.grammarLevel().cefr,
    }
  }

  submit(input: { topicId: string; durationSec: number; answers: SubmitAnswer[] }): GrammarSubmitResult {
    const topic = this.topicOrThrow(input.topicId)
    const results: GrammarAnswerResult[] = []
    const wrong: { ex: GrammarExercise; given: string }[] = []
    for (const a of input.answers) {
      const ex = topic.exercises.find((e) => e.id === a.exerciseId) ?? a.exercise
      if (!ex) throw new UserError('invalid_input', `Bài tập ${a.exerciseId} không thuộc chủ điểm này.`)
      const correct = checkAnswer(ex, a.given)
      results.push({ exerciseId: a.exerciseId, given: a.given, correct, expected: ex.answer })
      if (!correct) wrong.push({ ex, given: a.given })
    }
    const correct = results.filter((r) => r.correct).length
    const total = results.length
    const score = total ? correct / total : 0
    const previousMastery = this.cards().find((c) => c.id === topic.id)?.mastery ?? 0
    const nowIso = this.kernel.now().toISOString()
    const durationSec = Math.round(input.durationSec)

    this.kernel.db.run(
      `INSERT INTO lesson_attempts(module, content_ref, title, score, duration_sec, details, created_at)
       VALUES ('grammar', ?, ?, ?, ?, ?, ?)`,
      [
        topic.id,
        topic.title,
        score,
        durationSec,
        JSON.stringify({ correct, total, wrong: wrong.map((w) => w.ex.id) }),
        nowIso,
      ],
    )
    for (const w of wrong.slice(0, 10)) {
      this.kernel.learner.recordMistake({
        category: 'grammar',
        pattern: topic.title,
        example: `${w.ex.prompt} → ${w.given || '(blank)'}`,
        correction: w.ex.type === 'gap' ? fillGap(w.ex.prompt, w.ex.answer) : w.ex.answer,
      })
    }
    const minutes = Math.max(1, Math.min(30, durationSec ? durationSec / 60 : total * 0.4))
    const reward = this.kernel.progress.record({
      type: 'grammar_done',
      module: 'grammar',
      skill: 'grammar',
      minutes,
      score,
      ref: topic.id,
      title: topic.title,
    })
    // Skill progress scales with quality and size of the drill (0.5..3).
    const delta = total < 3 ? 0.5 : Math.min(3, Math.max(0.5, 0.5 + 2.5 * score * Math.min(1, total / 6)))
    const skill = this.kernel.learner.addSkillProgress('grammar', Math.round(delta * 10) / 10)
    const mastery = Math.max(previousMastery, score)
    return {
      topicId: topic.id,
      score,
      correct,
      total,
      previousMastery,
      mastery,
      masteredNow: previousMastery < MASTERY_THRESHOLD && mastery >= MASTERY_THRESHOLD,
      results,
      mistakesRecorded: Math.min(10, wrong.length),
      reward,
      skill,
    }
  }

  async generate(topicId: string): Promise<GeneratedExercises> {
    const topic = this.topicOrThrow(topicId)
    const level = this.grammarLevel().cefr
    const res = await this.kernel.ai.run(exercisesPrompt, { topic }, { level })
    const stamp = this.kernel.now().getTime().toString(36)
    const exercises: GrammarExercise[] = res.data.exercises
      .filter((e) => !exerciseLeak(e))
      .map((e, i) => ({
        id: `ai-${topic.id}-${stamp}-${i + 1}`,
        type: e.type,
        prompt: e.prompt,
        options: e.type === 'mcq' ? e.options : [],
        answer: e.answer,
        explanation: e.explanation,
      }))
    return { topicId: topic.id, level, exercises, provider: res.provider }
  }

  async explain(input: { topicId: string; exercise: GrammarExercise; given: string }): Promise<MistakeExplanation> {
    const topic = this.topicOrThrow(input.topicId)
    const res = await this.kernel.ai.run(explainPrompt, { topic, exercise: input.exercise, given: input.given })
    return { ...res.data, provider: res.provider }
  }
}
