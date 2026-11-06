// Tutor business logic: conversations, structured replies, mistake memory and XP. No Electron imports.
import type { TutorConversation, TutorStyle } from '@shared/types'
import { TUTOR_STYLES } from '@shared/types'
import { cleanInline } from '@core/text'
import type { Kernel } from '../../../main/kernel'
import { UserError } from '../../../main/ipc/router'
import {
  CORRECTION_CATEGORIES,
  DEFAULT_TITLE,
  type TutorChatMessage,
  type TutorConversationView,
  type TutorCorrection,
  type TutorNewWord,
  type TutorSendResult,
  type TutorThread,
} from '../contract'
import { clip, compressLine, SUMMARY_REFRESH_AFTER, windowHistory, type HistoryWindow } from './history'
import { tutorReplyPrompt, tutorSummaryPrompt, type TutorReplyInput, type TutorReplyOutput } from './prompts'

interface ConversationRow {
  id: number
  mode: string
  title: string
  created_at: string
  updated_at: string
  message_count: number
}

interface MessageRow {
  id: number
  conversation_id: number
  role: 'user' | 'assistant'
  content: string
  created_at: string
  corrections: string | null
  new_words: string | null
  follow_up: string | null
}

const MAX_THREAD_MESSAGES = 500

const parseList = <T>(s: string | null): T[] => {
  if (!s) return []
  try {
    const v = JSON.parse(s) as unknown
    return Array.isArray(v) ? (v as T[]) : []
  } catch {
    return []
  }
}

const asMode = (m: string): TutorStyle =>
  (TUTOR_STYLES as readonly string[]).includes(m) ? (m as TutorStyle) : 'friendly'
const norm = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^\p{L}\p{N}']+/gu, ' ')
    .trim()
const likeEscape = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`)

/** Drops empty, unchanged and duplicate corrections and caps their number. */
export function cleanCorrections(raw: TutorReplyOutput['corrections']): (TutorCorrection & { pattern: string })[] {
  const seen = new Set<string>()
  const out: (TutorCorrection & { pattern: string })[] = []
  for (const c of raw) {
    const original = c.original.trim()
    const correction = c.correction.trim()
    // 'i' → 'I' is a real fix, so compare exactly here (case-insensitive only for duplicates below).
    if (!original || !correction || original === correction) continue
    const key = `${norm(original)}→${norm(correction)}`
    if (seen.has(key)) continue
    seen.add(key)
    const category = (CORRECTION_CATEGORIES as readonly string[]).includes(c.category) ? c.category : 'grammar'
    out.push({
      original: original.slice(0, 300),
      correction: correction.slice(0, 300),
      explanationVi: c.explanationVi.trim().slice(0, 600),
      category,
      pattern: (c.pattern?.trim() || `${original} → ${correction}`).slice(0, 120),
    })
    if (out.length >= 6) break
  }
  return out
}

export function cleanNewWords(raw: TutorReplyOutput['newWords']): TutorNewWord[] {
  const seen = new Set<string>()
  const out: TutorNewWord[] = []
  for (const w of raw) {
    const word = w.word.trim().replace(/\s+/g, ' ')
    const key = word.toLowerCase()
    if (!word || seen.has(key)) continue
    seen.add(key)
    out.push({
      word: word.slice(0, 80),
      meaningVi: w.meaningVi.trim().slice(0, 300),
      example: w.example.trim().slice(0, 400),
    })
    if (out.length >= 4) break
  }
  return out
}

export class TutorService {
  private readonly summarizing = new Set<number>()

  constructor(private readonly k: Kernel) {}

  // ---------- conversations ----------
  private convRow(id: number): ConversationRow | undefined {
    return this.k.db.get<ConversationRow>(
      `SELECT c.*, (SELECT COUNT(*) FROM tutor_messages m WHERE m.conversation_id = c.id) AS message_count
       FROM tutor_conversations c WHERE c.id = ?`,
      [id],
    )
  }

  private toConversation(r: ConversationRow): TutorConversation {
    return {
      id: r.id,
      mode: asMode(r.mode),
      title: r.title,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
      messageCount: Number(r.message_count ?? 0),
    }
  }

  private requireConversation(id: number): TutorConversation {
    const row = this.convRow(id)
    if (!row) throw new UserError('not_found', 'Không tìm thấy cuộc hội thoại này.')
    return this.toConversation(row)
  }

  list(query?: string): TutorConversationView[] {
    const q = query?.trim() ?? ''
    const params: string[] = []
    let where = ''
    if (q) {
      const like = `%${likeEscape(q)}%`
      where = `WHERE c.title LIKE ? ESCAPE '\\' OR EXISTS (SELECT 1 FROM tutor_messages m WHERE m.conversation_id = c.id AND m.content LIKE ? ESCAPE '\\')`
      params.push(like, like)
    }
    const rows = this.k.db.all<ConversationRow & { last_message: string | null }>(
      `SELECT c.*,
        (SELECT COUNT(*) FROM tutor_messages m WHERE m.conversation_id = c.id) AS message_count,
        (SELECT content FROM tutor_messages m WHERE m.conversation_id = c.id ORDER BY m.id DESC LIMIT 1) AS last_message
       FROM tutor_conversations c ${where} ORDER BY c.updated_at DESC, c.id DESC LIMIT 200`,
      params,
    )
    return rows.map((r) => {
      let match = ''
      if (q) {
        const hit = this.k.db.value<string>(
          `SELECT content FROM tutor_messages WHERE conversation_id = ? AND content LIKE ? ESCAPE '\\' ORDER BY id DESC LIMIT 1`,
          [r.id, `%${likeEscape(q)}%`],
        )
        if (hit) {
          const i = hit.toLowerCase().indexOf(q.toLowerCase())
          match = clip(hit.slice(Math.max(0, i - 40), i + q.length + 60), 120)
        }
      }
      return { ...this.toConversation(r), lastMessage: clip(r.last_message ?? '', 120), match }
    })
  }

  create(mode: TutorStyle, title?: string): TutorConversation {
    const now = this.k.now().toISOString()
    const { lastInsertRowid } = this.k.db.run(
      'INSERT INTO tutor_conversations(mode, title, created_at, updated_at) VALUES (?, ?, ?, ?)',
      [mode, cleanInline(title ?? '', 80) || DEFAULT_TITLE, now, now],
    )
    return this.requireConversation(lastInsertRowid)
  }

  rename(id: number, title: string): TutorConversation {
    this.requireConversation(id)
    this.k.db.run('UPDATE tutor_conversations SET title = ? WHERE id = ?', [
      cleanInline(title, 80) || DEFAULT_TITLE,
      id,
    ])
    return this.requireConversation(id)
  }

  setMode(id: number, mode: TutorStyle): TutorConversation {
    this.requireConversation(id)
    this.k.db.run('UPDATE tutor_conversations SET mode = ? WHERE id = ?', [mode, id])
    return this.requireConversation(id)
  }

  delete(id: number): void {
    this.k.db.transaction(() => {
      // Explicit cascade (foreign keys are on, but module tables may predate a constraint change).
      this.k.db.run(
        'DELETE FROM tutor_message_meta WHERE message_id IN (SELECT id FROM tutor_messages WHERE conversation_id = ?)',
        [id],
      )
      this.k.db.run('DELETE FROM tutor_messages WHERE conversation_id = ?', [id])
      this.k.db.run('DELETE FROM tutor_conversation_state WHERE conversation_id = ?', [id])
      this.k.db.run('DELETE FROM tutor_conversations WHERE id = ?', [id])
    })
  }

  // ---------- messages ----------
  private toMessage(r: MessageRow): TutorChatMessage {
    return {
      id: r.id,
      conversationId: r.conversation_id,
      role: r.role,
      content: r.content,
      createdAt: r.created_at,
      corrections: parseList<TutorCorrection>(r.corrections),
      newWords: parseList<TutorNewWord>(r.new_words),
      followUpQuestion: r.follow_up ?? '',
    }
  }

  private messages(conversationId: number, limit = MAX_THREAD_MESSAGES): TutorChatMessage[] {
    return this.k.db
      .all<MessageRow>(
        `SELECT * FROM (
           SELECT m.*, x.corrections, x.new_words, x.follow_up FROM tutor_messages m
           LEFT JOIN tutor_message_meta x ON x.message_id = m.id
           WHERE m.conversation_id = ? ORDER BY m.id DESC LIMIT ?
         ) ORDER BY id ASC`,
        [conversationId, limit],
      )
      .map((r) => this.toMessage(r))
  }

  get(id: number): TutorThread | null {
    const row = this.convRow(id)
    if (!row) return null
    return { conversation: this.toConversation(row), messages: this.messages(id) }
  }

  private state(conversationId: number): { summary: string; uptoId: number } {
    const r = this.k.db.get<{ summary: string; summarized_upto: number }>(
      'SELECT summary, summarized_upto FROM tutor_conversation_state WHERE conversation_id = ?',
      [conversationId],
    )
    return { summary: r?.summary ?? '', uptoId: r?.summarized_upto ?? 0 }
  }

  private window(conversationId: number): HistoryWindow {
    const rows = this.k.db.all<{ id: number; role: 'user' | 'assistant'; content: string }>(
      'SELECT id, role, content FROM tutor_messages WHERE conversation_id = ? ORDER BY id',
      [conversationId],
    )
    const st = this.state(conversationId)
    return windowHistory(rows, { summary: st.summary, summarizedUptoId: st.uptoId })
  }

  /** Builds the model input for a new learner message (exposed for tests: history must stay bounded). */
  buildPromptInput(
    conversationId: number,
    text: string,
    viaVoice = false,
  ): { input: TutorReplyInput; window: HistoryWindow } {
    const conv = this.requireConversation(conversationId)
    const win = this.window(conversationId)
    return {
      input: { mode: conv.mode, message: text.trim(), history: win.recent, summary: win.summary, viaVoice },
      window: win,
    }
  }

  async send(conversationId: number, text: string, viaVoice = false): Promise<TutorSendResult> {
    const conv = this.requireConversation(conversationId)
    const message = text.trim()
    const { input } = this.buildPromptInput(conversationId, message, viaVoice)
    // The AI call happens before anything is written, so a failure (no key, quota…) leaves no half-saved turn.
    const { data, provider } = await this.k.ai.run(tutorReplyPrompt, input)
    const corrections = cleanCorrections(data.corrections)
    const newWords = cleanNewWords(data.newWords)
    const followUp = (data.followUpQuestion ?? '').trim().slice(0, 400)
    const nowIso = this.k.now().toISOString()

    const ids = this.k.db.transaction(() => {
      const user = this.k.db.run(
        'INSERT INTO tutor_messages(conversation_id, role, content, created_at) VALUES (?, ?, ?, ?)',
        [conversationId, 'user', message, nowIso],
      ).lastInsertRowid
      this.k.db.run(
        'INSERT INTO tutor_message_meta(message_id, corrections, new_words, follow_up, provider) VALUES (?, ?, ?, ?, ?)',
        [
          user,
          JSON.stringify(
            corrections.map(({ original, correction, explanationVi, category }) => ({
              original,
              correction,
              explanationVi,
              category,
            })),
          ),
          '[]',
          '',
          provider,
        ],
      )
      const assistant = this.k.db.run(
        'INSERT INTO tutor_messages(conversation_id, role, content, created_at) VALUES (?, ?, ?, ?)',
        [conversationId, 'assistant', data.reply.trim(), nowIso],
      ).lastInsertRowid
      this.k.db.run(
        'INSERT INTO tutor_message_meta(message_id, corrections, new_words, follow_up, provider) VALUES (?, ?, ?, ?, ?)',
        [assistant, '[]', JSON.stringify(newWords), followUp, provider],
      )
      const title = conv.title === DEFAULT_TITLE ? clip(message, 48) : conv.title
      this.k.db.run('UPDATE tutor_conversations SET updated_at = ?, title = ? WHERE id = ?', [
        nowIso,
        title,
        conversationId,
      ])
      for (const c of corrections) {
        this.k.learner.recordMistake({
          category: c.category,
          pattern: c.pattern,
          example: c.original,
          correction: c.correction,
        })
      }
      return { user, assistant }
    })

    const skill = viaVoice ? 'speaking' : 'writing'
    const reward = this.k.progress.record({
      type: 'tutor_message',
      module: 'tutor',
      skill,
      minutes: 1,
      ref: `tutor:${conversationId}`,
      title: conv.title === DEFAULT_TITLE ? clip(message, 48) : conv.title,
    })
    // Small, rate-limited skill credit: every 5th substantial learner message of a conversation.
    const learnerTurns = Number(
      this.k.db.value("SELECT COUNT(*) FROM tutor_messages WHERE conversation_id = ? AND role = 'user'", [
        conversationId,
      ]) ?? 0,
    )
    if (message.split(/\s+/).length >= 6 && learnerTurns % 5 === 0) {
      this.k.learner.addSkillProgress(skill, corrections.length <= 1 ? 1 : 0.5)
    }

    // Long chats: refresh the rolling summary in the background (best-effort, never blocks the reply).
    void this.summarizeIfNeeded(conversationId).catch((err: unknown) =>
      this.k.log.warn(`tutor summary failed: ${err instanceof Error ? err.message : String(err)}`),
    )

    const thread = this.messages(conversationId, 2)
    const userMessage = thread.find((m) => m.id === ids.user) as TutorChatMessage
    const assistantMessage = thread.find((m) => m.id === ids.assistant) as TutorChatMessage
    return {
      conversation: this.requireConversation(conversationId),
      userMessage,
      assistantMessage,
      xpGained: reward.xpGained,
    }
  }

  /** Folds messages that fell out of the prompt window into the stored summary. Returns true when it ran. */
  async summarizeIfNeeded(conversationId: number): Promise<boolean> {
    if (this.summarizing.has(conversationId) || !this.k.ai.isAvailable()) return false
    const win = this.window(conversationId)
    if (win.unsummarized.length < SUMMARY_REFRESH_AFTER) return false
    this.summarizing.add(conversationId)
    try {
      const st = this.state(conversationId)
      const { data } = await this.k.ai.run(tutorSummaryPrompt, {
        previous: st.summary,
        lines: win.unsummarized.map((m) => compressLine(m, 240)),
      })
      if (!this.convRow(conversationId)) return false
      this.k.db.run(
        `INSERT INTO tutor_conversation_state(conversation_id, summary, summarized_upto, updated_at) VALUES (?, ?, ?, ?)
         ON CONFLICT(conversation_id) DO UPDATE SET summary = excluded.summary, summarized_upto = excluded.summarized_upto,
         updated_at = excluded.updated_at`,
        [conversationId, clip(data, 700), win.lastDroppedId, this.k.now().toISOString()],
      )
      return true
    } finally {
      this.summarizing.delete(conversationId)
    }
  }
}
