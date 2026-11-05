// Speaking Studio business logic: prompts (built-in + Cadence scenarios), sessions with measured metrics,
// AI feedback, AI role-play turns and the Cadence pronunciation path.
import type { Cefr, SpeakingPrompt } from '@shared/content'
import type { ConversationScenario, PronunciationPack } from '@shared/packs'
import type { ProviderId, SpeakingFeedback, SpeakingMeasured, SpeakingSession } from '@shared/types'
import { alignIpa } from '@core/phonemes'
import type { Kernel } from '../../../main/kernel'
import { UserError } from '../../../main/ipc/router'
import { creditedSpeakingSeconds, measureSpeaking, samePhoneme, sessionScore } from './metrics'
import { theoryHtmlToBlocks } from './theory'
import type {
  PronCompleteResult,
  PronEstimateResult,
  PronLessonSummary,
  PronLessonView,
  PronModuleView,
  PronOverview,
  RecordingAnalysis,
  RoleplayReply,
  SpeakingMode,
  SpeakingPromptView,
  SpeakingSource,
  SpeakingSubmitResult,
} from '../contract'
import { phonemeEstimatePrompt, roleplayTurnPrompt, speakingFeedbackPrompt } from './prompts'
import { attributionOf, loadPronunciationPack } from './pronunciation'

export const CADENCE_PREFIX = 'cadence-'
export const EXAM_PASS_SCORE = 0.7

interface SessionRow {
  id: number
  mode: string
  prompt_id: string | null
  prompt: string
  transcript: string
  measured: string
  feedback: string | null
  provider: ProviderId | null
  created_at: string
}

const parseJson = <T>(s: string | null, fallback: T): T => {
  if (!s) return fallback
  try {
    return JSON.parse(s) as T
  } catch {
    return fallback
  }
}

const EMPTY_MEASURED: SpeakingMeasured = {
  durationSec: 0,
  speakingSec: 0,
  wordsPerMinute: null,
  pauseCount: 0,
  longestPauseSec: 0,
  wordAccuracy: null,
  matchedWords: null,
  missingWords: [],
  extraWords: [],
}

const toSession = (r: SessionRow): SpeakingSession => ({
  id: r.id,
  mode: r.mode,
  promptId: r.prompt_id,
  prompt: r.prompt,
  transcript: r.transcript,
  measured: { ...EMPTY_MEASURED, ...parseJson<Partial<SpeakingMeasured>>(r.measured, {}) },
  feedback: parseJson<SpeakingFeedback | null>(r.feedback, null),
  provider: r.provider,
  createdAt: r.created_at,
})

const NO_PACK = 'Gói nội dung phát âm bị lỗi hoặc thiếu. / The pronunciation pack is missing or invalid.'

function scenarioToPrompt(
  s: ConversationScenario,
): SpeakingPrompt & { source: SpeakingSource; scenario: SpeakingPromptView['scenario'] } {
  return {
    id: `${CADENCE_PREFIX}${s.id}`,
    kind: 'roleplay',
    cefr: s.cefr,
    title: s.title,
    instructionsVi:
      'Hội thoại theo kịch bản (Cadence): nghe câu của người đối thoại, đọc gợi ý rồi trả lời bằng giọng nói. Câu trả lời được so với câu mẫu – không cần khóa AI.',
    sentences: s.turns.map((t) => t.expectedResponse),
    aiRole: 'conversation coach',
    openingLine: s.turns[0]?.coachMessage,
    cueCard: [],
    durationSec: Math.min(600, Math.max(15, s.estimatedMinutes * 60)),
    source: 'cadence',
    scenario: {
      level: s.level,
      topic: s.topic,
      summary: s.summary,
      scenario: s.scenario,
      focus: s.focus,
      passScore: s.passScore,
      estimatedMinutes: s.estimatedMinutes,
      turns: s.turns,
    },
  }
}

export class SpeakingService {
  constructor(private readonly k: Kernel) {}

  // ---------- prompts ----------
  private allPrompts(): (SpeakingPrompt & { source: SpeakingSource; scenario: SpeakingPromptView['scenario'] })[] {
    const builtin = this.k.content.speakingPrompts().map((p) => ({ ...p, source: 'builtin' as const, scenario: null }))
    const pack = loadPronunciationPack().pack
    const cadence = pack ? [...pack.conversations].sort((a, b) => a.order - b.order).map(scenarioToPrompt) : []
    return [...builtin, ...cadence]
  }

  private promptStats(): Map<string, { attempts: number; best: number | null; last: string }> {
    const rows = this.k.db.all<SessionRow>('SELECT * FROM speaking_sessions WHERE prompt_id IS NOT NULL ORDER BY id')
    const map = new Map<string, { attempts: number; best: number | null; last: string }>()
    for (const r of rows) {
      const s = toSession(r)
      const score = sessionScore(s.measured, s.feedback)
      const cur = map.get(r.prompt_id as string) ?? { attempts: 0, best: null, last: r.created_at }
      cur.attempts++
      cur.last = r.created_at
      if (score !== null) cur.best = Math.max(cur.best ?? 0, score)
      map.set(r.prompt_id as string, cur)
    }
    return map
  }

  prompts(filter: { kind?: SpeakingPrompt['kind']; source?: SpeakingSource } = {}): SpeakingPromptView[] {
    const stats = this.promptStats()
    return this.allPrompts()
      .filter((p) => (!filter.kind || p.kind === filter.kind) && (!filter.source || p.source === filter.source))
      .map((p) => {
        const s = stats.get(p.id)
        return { ...p, attempts: s?.attempts ?? 0, bestScore: s?.best ?? null, lastAt: s?.last ?? null }
      })
  }

  prompt(id: string): SpeakingPromptView {
    const found = this.prompts().find((p) => p.id === id)
    if (!found) throw new UserError('not_found', 'Không tìm thấy bài luyện nói này. / Speaking prompt not found.')
    return found
  }

  history(input: { promptId?: string; limit?: number } = {}): SpeakingSession[] {
    const limit = input.limit ?? 30
    const rows = input.promptId
      ? this.k.db.all<SessionRow>('SELECT * FROM speaking_sessions WHERE prompt_id = ? ORDER BY id DESC LIMIT ?', [
          input.promptId,
          limit,
        ])
      : this.k.db.all<SessionRow>('SELECT * FROM speaking_sessions ORDER BY id DESC LIMIT ?', [limit])
    return rows.map(toSession)
  }

  private session(id: number): SpeakingSession {
    const row = this.k.db.get<SessionRow>('SELECT * FROM speaking_sessions WHERE id = ?', [id])
    if (!row) throw new UserError('not_found', 'Không tìm thấy lượt nói này. / Speaking session not found.')
    return toSession(row)
  }

  // ---------- sessions ----------
  submit(input: {
    mode: SpeakingMode
    promptId?: string | null
    prompt: string
    target?: string | null
    transcript: string | null
    analysis: RecordingAnalysis
  }): SpeakingSubmitResult {
    const promptView = input.promptId ? this.allPrompts().find((p) => p.id === input.promptId) : undefined
    if (input.promptId && !promptView && input.mode !== 'pronunciation') {
      // Pronunciation sessions reference lesson ids (m1-practice-a…); anything else must be a known prompt.
      throw new UserError('not_found', 'Không tìm thấy bài luyện nói này. / Speaking prompt not found.')
    }
    const transcript = input.transcript?.trim() ? input.transcript.trim() : null
    const measured = measureSpeaking(input.analysis, transcript, input.target?.trim() || null)
    const nowIso = this.k.now().toISOString()
    const id = this.k.db.run(
      `INSERT INTO speaking_sessions(mode, prompt_id, prompt, transcript, measured, feedback, provider, created_at)
       VALUES (?, ?, ?, ?, ?, NULL, NULL, ?)`,
      [
        input.mode,
        input.promptId ?? null,
        input.prompt.slice(0, 4000),
        transcript ?? '',
        JSON.stringify(measured),
        nowIso,
      ],
    ).lastInsertRowid
    const speakingSeconds = creditedSpeakingSeconds(measured, transcript)
    const score = sessionScore(measured, null)
    const minutes = Math.max(0.2, Math.round((Math.max(measured.durationSec, 10) / 60) * 10) / 10)
    const reward = this.k.progress.record({
      type: 'speaking_done',
      module: 'speaking',
      skill: 'speaking',
      minutes,
      speakingSeconds,
      ...(score !== null ? { score } : {}),
      ref: input.promptId ?? input.mode,
      title: promptView?.title ?? `Speaking · ${input.mode}`,
    })
    // More voiced time and higher accuracy move the speaking skill further (0.5..3).
    const timeFactor = Math.min(1, speakingSeconds / 45)
    const delta = Math.min(3, Math.max(0.5, 0.5 + timeFactor * (1 + (score ?? 0.6) * 1.5)))
    const skill = this.k.learner.addSkillProgress('speaking', Math.round(delta * 10) / 10)
    return { session: this.session(id), reward, skill, speakingSeconds, score }
  }

  async feedback(sessionId: number): Promise<SpeakingSession> {
    const s = this.session(sessionId)
    if (s.feedback) return s
    if (!s.transcript.trim())
      throw new UserError(
        'no_transcript',
        'Chưa có lời nói được chuyển thành chữ nên AI chưa thể nhận xét. / There is no transcript to give feedback on.',
      )
    const promptView = s.promptId ? this.allPrompts().find((p) => p.id === s.promptId) : undefined
    const level: Cefr =
      promptView?.cefr ??
      this.k.learner.skillLevels().find((l) => l.skill === 'speaking')?.cefr ??
      this.k.learner.overallCefr()
    const target =
      promptView && (s.mode === 'shadowing' || s.mode === 'repeat' || s.mode === 'scenario')
        ? promptView.sentences.join(' ')
        : null
    const res = await this.k.ai.run(
      speakingFeedbackPrompt,
      { mode: s.mode, prompt: s.prompt, target, transcript: s.transcript, measured: s.measured, cefr: level },
      { level },
    )
    const { mistakePatterns, ...feedback } = res.data
    this.k.db.run('UPDATE speaking_sessions SET feedback = ?, provider = ? WHERE id = ?', [
      JSON.stringify(feedback),
      res.provider,
      sessionId,
    ])
    for (const p of mistakePatterns.slice(0, 3)) {
      this.k.learner.recordMistake({
        category: p.category,
        pattern: p.pattern,
        example: p.example,
        correction: p.correction,
      })
    }
    return this.session(sessionId)
  }

  async roleplayTurn(input: {
    promptId: string
    history: { role: 'user' | 'assistant'; content: string }[]
    userText: string
  }): Promise<RoleplayReply> {
    const p = this.prompt(input.promptId)
    if (p.kind !== 'roleplay' && p.kind !== 'real-world')
      throw new UserError('invalid_input', 'Bài này không phải hội thoại nhập vai. / This prompt is not a role-play.')
    const res = await this.k.ai.run(
      roleplayTurnPrompt,
      {
        title: p.title,
        aiRole: p.aiRole ?? 'a friendly local person',
        openingLine: p.openingLine ?? 'Hello! How can I help you?',
        goalVi: p.instructionsVi,
        cefr: p.cefr,
        history: input.history,
        userText: input.userText,
      },
      { level: p.cefr },
    )
    return { ...res.data, provider: res.provider }
  }

  // ---------- pronunciation path ----------
  private pack(): PronunciationPack {
    const { pack, error } = loadPronunciationPack()
    if (!pack) {
      this.k.log.error(`speaking: pronunciation pack invalid: ${error ?? 'unknown'}`)
      throw new UserError('content_invalid', NO_PACK)
    }
    return pack
  }

  private lessonStats(): Map<string, { attempts: number; best: number }> {
    const rows = this.k.db.all<{ ref: string; n: number; best: number | null }>(
      `SELECT content_ref AS ref, COUNT(*) AS n, MAX(score) AS best FROM lesson_attempts
       WHERE module = 'speaking' AND content_ref IS NOT NULL GROUP BY content_ref`,
    )
    return new Map(rows.map((r) => [r.ref, { attempts: r.n, best: r.best ?? 0 }]))
  }

  private lessonSummary(
    l: PronunciationPack['modules'][number]['lessons'][number],
    stats: Map<string, { attempts: number; best: number }>,
  ): PronLessonSummary {
    const s = stats.get(l.id)
    const best = s ? s.best : null
    return {
      id: l.id,
      title: l.title,
      type: l.type,
      order: l.order,
      wordCount: l.words.length,
      attempts: s?.attempts ?? 0,
      bestScore: best,
      completed: !!s && (l.type !== 'exam' || (best ?? 0) >= EXAM_PASS_SCORE),
    }
  }

  private orderedLessons(pack: PronunciationPack) {
    return [...pack.modules]
      .sort((a, b) => a.order - b.order)
      .flatMap((m) => [...m.lessons].sort((a, b) => a.order - b.order).map((l) => ({ module: m, lesson: l })))
  }

  pronOverview(): PronOverview {
    const pack = this.pack()
    const stats = this.lessonStats()
    const modules: PronModuleView[] = [...pack.modules]
      .sort((a, b) => a.order - b.order)
      .map((m) => {
        const lessons = [...m.lessons].sort((a, b) => a.order - b.order).map((l) => this.lessonSummary(l, stats))
        return {
          id: m.id,
          order: m.order,
          title: m.title,
          description: m.description,
          phonemeFocus: m.phonemeFocus,
          focusSymbols: m.focusSymbols,
          lessons,
          completedLessons: lessons.filter((l) => l.completed).length,
        }
      })
    const next = modules.flatMap((m) => m.lessons).find((l) => !l.completed)
    return {
      attribution: attributionOf(pack),
      modules,
      phonemes: pack.phonemes,
      categories: pack.targets.categories,
      nextLessonId: next?.id ?? null,
    }
  }

  pronLesson(id: string): PronLessonView {
    const pack = this.pack()
    const ordered = this.orderedLessons(pack)
    const idx = ordered.findIndex((x) => x.lesson.id === id)
    const found = ordered[idx]
    if (!found) throw new UserError('not_found', 'Không tìm thấy bài phát âm này. / Pronunciation lesson not found.')
    const { module: m, lesson } = found
    const targetByWord = new Map(pack.targets.words.map((w) => [w.word.toLowerCase(), w]))
    const focus = new Set([...m.focusSymbols, ...m.phonemeFocus])
    return {
      module: { id: m.id, title: m.title, order: m.order, focusSymbols: m.focusSymbols, phonemeFocus: m.phonemeFocus },
      lesson: this.lessonSummary(lesson, this.lessonStats()),
      theory: lesson.theoryHtml ? theoryHtmlToBlocks(lesson.theoryHtml) : [],
      words: lesson.words.map((w) => {
        const t = targetByWord.get(w.word.toLowerCase())
        return {
          ...w,
          focusPhoneme: t?.focusPhoneme ?? w.phonemes.find((p) => focus.has(p)) ?? null,
          cue: t?.cue ?? null,
        }
      }),
      focusPhonemes: pack.phonemes.filter((p) => focus.has(p.symbol) || focus.has(p.ipa)),
      prevLessonId: ordered[idx - 1]?.lesson.id ?? null,
      nextLessonId: ordered[idx + 1]?.lesson.id ?? null,
      passScore: EXAM_PASS_SCORE,
      attribution: attributionOf(pack),
    }
  }

  async pronEstimate(input: { word: string; ipa: string; transcript: string }): Promise<PronEstimateResult> {
    const res = await this.k.ai.run(phonemeEstimatePrompt, {
      word: input.word,
      targetIpa: input.ipa,
      transcript: input.transcript,
    })
    const alignment = alignIpa(input.ipa, res.data.heardIpa, { isSame: samePhoneme })
    return {
      word: input.word,
      targetIpa: input.ipa,
      heardIpa: res.data.heardIpa,
      transcript: input.transcript,
      alignment,
      score: Math.round(alignment.accuracy * 100) / 100,
      confidence: res.data.confidence,
      tipVi: res.data.tipVi,
      provider: res.provider,
    }
  }

  pronComplete(input: {
    lessonId: string
    score: number
    durationSec: number
    speakingSec: number
    words?: { word: string; score: number; method: 'ai' | 'self' }[]
  }): PronCompleteResult {
    const pack = this.pack()
    const found = this.orderedLessons(pack).find((x) => x.lesson.id === input.lessonId)
    if (!found) throw new UserError('not_found', 'Không tìm thấy bài phát âm này. / Pronunciation lesson not found.')
    const { lesson, module: m } = found
    const score = lesson.type === 'theory' ? 1 : Math.round(input.score * 100) / 100
    const nowIso = this.k.now().toISOString()
    this.k.db.run(
      `INSERT INTO lesson_attempts(lesson_id, module, content_ref, title, score, duration_sec, details, created_at)
       VALUES (NULL, 'speaking', ?, ?, ?, ?, ?, ?)`,
      [
        lesson.id,
        `${m.title} · ${lesson.title}`.slice(0, 200),
        score,
        Math.round(input.durationSec),
        JSON.stringify({
          kind: 'pronunciation',
          type: lesson.type,
          words: input.words ?? [],
          speakingSec: input.speakingSec,
        }),
        nowIso,
      ],
    )
    const passed = lesson.type !== 'exam' || score >= EXAM_PASS_SCORE
    const minutes = Math.max(0.5, Math.round((Math.max(input.durationSec, 30) / 60) * 10) / 10)
    const reward = this.k.progress.record({
      type: 'speaking_done',
      module: 'speaking',
      skill: 'speaking',
      minutes: Math.min(minutes, 30),
      speakingSeconds: Math.round(input.speakingSec),
      score,
      ref: lesson.id,
      title: `Pronunciation · ${lesson.title}`,
    })
    const delta =
      lesson.type === 'theory' ? 0.5 : Math.min(3, 0.5 + score * 1.5 + (lesson.type === 'exam' && passed ? 1 : 0))
    const skill = this.k.learner.addSkillProgress('speaking', Math.round(delta * 10) / 10)
    const best = this.lessonStats().get(lesson.id)?.best ?? score
    return { passed, bestScore: best, reward, skill }
  }
}
