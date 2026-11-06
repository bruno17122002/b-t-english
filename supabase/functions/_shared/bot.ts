// The central Telegram bot (webhook). Same commands, wording and HTML as the in-app bot
// (src/main/kernel/telegram/builtins.ts + the coach commands), but multi-user: a chat is linked to an account with
// `/start <code>` (link_codes → telegram_links), data comes from sync_rows and results are written back to sync_rows
// so the desktops pull them on their next sync. AI runs on the server key with a per-user daily quota.
import { AiError, type AiModel, type Media } from './gemini.ts'
import {
  adviceHtml,
  aiAdvice,
  habitsHtml,
  offlineAdvice,
  parsePeriodArg,
  planHtml,
  reportHtml,
  type AdviceContext,
  type CoachReport,
} from './coach.ts'
import { dateKeyIn, hashString } from './dates.ts'
import { esc, parseCommand, truncate } from './format.ts'
import { planDates, profile28, statsFor, type CoachPeriod } from './habits.ts'
import {
  dueCount,
  examplesOf,
  learnerContext,
  learnerLine,
  loadLearner,
  loadTimezone,
  nextUpdatedAt,
  overallCefr,
  pushRows,
  todayReply,
  wordKeyOf,
  SKILL_VI,
  type LearnerData,
  type OutRow,
  type SyncRow,
  type VocabRow,
} from './learner.ts'
import { PendingStore } from './pending.ts'
import {
  OFFLINE_WORDS,
  QUIZ_SKILLS,
  quizPrompt,
  runTutor,
  wordOfDay,
  type Quiz,
  type QuizSkill,
  type TutorMode,
  type TutorOutput,
  type WordOfDay,
} from './prompts.ts'
import { DailyLimitError, type AiQuota } from './quota.ts'
import { eq, type SupabaseRest, type UserRest } from './rest.ts'
import { newScheduleRow, previewRow, reviewRow, sortDue, type Rating, type ScheduleRow } from './srs.ts'
import {
  TelegramError,
  type TelegramBot,
  type TelegramButton,
  type TgCallbackQuery,
  type TgMessage,
  type TgUpdate,
} from './telegram.ts'

export interface Reply {
  html?: string
  buttons?: TelegramButton[][]
  /** Callbacks only: replace the message holding the pressed button. */
  edit?: boolean
  /** Callbacks only: short pop-up (answerCallbackQuery). */
  toast?: string
}
type Replies = Reply | Reply[]

export interface BotDeps {
  rest: SupabaseRest
  tg: TelegramBot
  /** Server Gemini model; null when GEMINI_API_KEY is not set. */
  ai: AiModel | null
  quota: AiQuota
  botUsername?: string | null
  now?: () => Date
  uuid?: () => string
  log?: (msg: string) => void
}

interface Ctx {
  userId: string
  user: UserRest
  chatId: number
  firstName?: string
  args: string
  now: Date
}

export const RATING_LABEL: Record<Rating, string> = { 1: '😵 Quên', 2: '😐 Khó', 3: '🙂 Nhớ', 4: '😎 Dễ' }
const CEFR_ORDER = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2']
const LINK_MAX_FAILURES = 5
const LINK_WINDOW_MS = 15 * 60_000
export const MEMORY_TURNS = 20
const MEMORY_KEEP = 40

/** Commands shown in /help and published with setMyCommands (see supabase/README.md). */
export const COMMANDS: { name: string; en: string; vi: string }[] = [
  { name: 'start', en: 'Welcome and how to use the bot', vi: 'Chào mừng và hướng dẫn' },
  { name: 'help', en: 'List all commands', vi: 'Danh sách lệnh' },
  {
    name: 'today',
    en: "Today's plan, quests, due cards and streak",
    vi: 'Kế hoạch hôm nay, nhiệm vụ, thẻ cần ôn, chuỗi ngày',
  },
  { name: 'review', en: 'Review due flashcards (FSRS)', vi: 'Ôn thẻ từ đến hạn (FSRS)' },
  { name: 'word', en: 'Word of the day', vi: 'Từ vựng của ngày' },
  { name: 'quiz', en: 'Quick question on your weakest point', vi: 'Câu hỏi nhanh về điểm yếu của bạn' },
  { name: 'report', en: 'Habit report: /report day|week|month', vi: 'Báo cáo thói quen: /report ngay|tuan|thang' },
  { name: 'advice', en: 'Fresh AI analysis of your study habits', vi: 'AI phân tích thói quen học ngay bây giờ' },
  { name: 'habits', en: 'Quick habit statistics', vi: 'Thống kê thói quen nhanh' },
  { name: 'plan', en: 'AI study plan for tomorrow', vi: 'Kế hoạch học ngày mai do AI đề xuất' },
  { name: 'reset', en: 'Clear the chat memory', vi: 'Xóa lịch sử trò chuyện' },
]

export const UNLINKED_HTML = [
  '🔒 <b>Tài khoản Telegram này chưa được liên kết với B&amp;T English.</b>',
  '',
  'Cách liên kết:',
  '1. Mở B&amp;T English trên máy tính → Cài đặt → Tài khoản và đăng nhập tài khoản online.',
  '2. Vào Cài đặt → Telegram → chọn <b>Bot chạy trên server</b> → bấm <b>Tạo mã liên kết</b>.',
  '3. Gửi cho mình <code>/start 123456</code> (thay bằng mã 6 số, hiệu lực 15 phút).',
].join('\n')

export function helpHtml(welcome: boolean): string {
  return [
    welcome
      ? '👋 <b>Chào bạn! Mình là gia sư IELTS của B&amp;T English</b> 🎓'
      : '🎓 <b>B&amp;T English – gia sư IELTS</b>',
    '',
    `Cứ nhắn tự nhiên bằng tiếng Việt hoặc tiếng Anh: hỏi ngữ pháp, từ vựng, nhờ sửa câu, chấm bài Writing, luyện Speaking… Mình biết trình độ, lỗi hay gặp và kế hoạch hôm nay của bạn, và nhớ ~${MEMORY_TURNS} tin gần nhất.`,
    '📷 Gửi ảnh (bài viết tay, bài tập, biểu đồ Task 1) – mình đọc và chữa.',
    '🎙 Gửi tin nhắn thoại bằng tiếng Anh – mình sửa lỗi và góp ý phát âm.',
    '☁️ Bot chạy trên server: dùng được cả khi máy tính tắt; kết quả ôn tập tự đồng bộ về app.',
    '',
    '<b>Lệnh / Commands</b>',
    ...COMMANDS.map((c) => `/${c.name} – ${esc(c.vi)} · <i>${esc(c.en)}</i>`),
  ].join('\n')
}

function relativeDue(dueAt: string, now: Date): string {
  const mins = Math.max(0, Math.round((new Date(dueAt).getTime() - now.getTime()) / 60_000))
  if (mins < 60) return `${Math.max(1, mins)} phút nữa`
  const hours = Math.round(mins / 60)
  if (hours < 24) return `${hours} giờ nữa`
  return `${Math.round(hours / 24)} ngày nữa`
}

const XP = { review_done: 1, word_saved: 2, grammar_done: 12, reading_done: 15, tutor_message: 2, speaking_done: 10 }
const TUTOR_DAILY_XP_CAP = 20

export function errorReply(err: unknown): Reply {
  if (err instanceof DailyLimitError) return { html: esc(err.userMessage) }
  if (err instanceof AiError) return { html: `⚠️ ${esc(err.userMessage)}` }
  return { html: '⚠️ Có lỗi khi xử lý tin này. Bạn thử lại sau ít phút nhé.' }
}

export const noAiReply = (): Reply => ({
  html: '🔑 Máy chủ chưa bật AI (thiếu GEMINI_API_KEY). Bạn vẫn dùng được /today, /review, /habits và /report.',
})

type PendingWord = {
  word: string
  ipa?: string
  pos?: string
  meaningVi: string
  meaningEn?: string
  examples: string[]
  collocations?: string[]
  cefr?: string | null
  notes?: string
}

export class ServerBot {
  private readonly pending: PendingStore
  private readonly now: () => Date
  private readonly uuid: () => string
  private readonly log: (msg: string) => void

  constructor(private readonly d: BotDeps) {
    this.now = d.now ?? (() => new Date())
    this.uuid = d.uuid ?? (() => crypto.randomUUID())
    this.log = d.log ?? (() => undefined)
    this.pending = new PendingStore(d.rest, this.now)
  }

  // ---------- entry ----------
  async handleUpdate(u: TgUpdate): Promise<void> {
    if (u.callback_query) return this.handleCallback(u.callback_query)
    if (u.message) return this.handleMessage(u.message)
  }

  private async linkedUser(chatId: number): Promise<string | null> {
    const rows = await this.d.rest.select<{ user_id: string }>('telegram_links', [['chat_id', eq(chatId)]], {
      select: 'user_id',
      limit: 1,
    })
    return rows[0]?.user_id ?? null
  }

  private async send(chatId: number, replies: Replies): Promise<void> {
    for (const r of Array.isArray(replies) ? replies : [replies])
      if (r.html) await this.d.tg.sendMessage(chatId, r.html, r.buttons)
  }

  private async handleMessage(msg: TgMessage): Promise<void> {
    const chatId = msg.chat.id
    const text = (msg.text ?? msg.caption ?? '').trim()
    const cmd = text ? parseCommand(text, this.d.botUsername) : null
    if (cmd?.name === 'start' && /^\d{6}$/.test(cmd.args.replace(/\s+/g, ''))) {
      await this.send(chatId, await this.link(msg, cmd.args.replace(/\s+/g, '')))
      return
    }
    const userId = await this.linkedUser(chatId)
    if (!userId) {
      if (msg.chat.type === 'private') await this.send(chatId, { html: UNLINKED_HTML })
      return
    }
    const ctx: Ctx = {
      userId,
      user: this.d.rest.forUser(userId),
      chatId,
      firstName: msg.from?.first_name,
      args: cmd?.args ?? '',
      now: this.now(),
    }
    let replies: Replies
    try {
      replies = await this.route(ctx, msg, text, cmd?.name ?? null)
    } catch (err) {
      this.log(
        `message handling failed: ${err instanceof Error ? `${err.name} ${err.message}` : String(err)}`.slice(0, 300),
      )
      replies = errorReply(err)
    }
    await this.send(chatId, replies)
  }

  private async route(ctx: Ctx, msg: TgMessage, text: string, command: string | null): Promise<Replies> {
    if (command) {
      switch (command) {
        case 'start':
          return { html: helpHtml(true) }
        case 'help':
          return { html: helpHtml(false) }
        case 'today':
          return todayReply(await loadLearner(ctx.user, ctx.now, { skipVocab: true }), ctx.now)
        case 'review':
          return this.nextCard(ctx)
        case 'word':
          return this.wordOfDay(ctx)
        case 'quiz':
          return this.quiz(ctx)
        case 'report':
          return this.reportReply(ctx, parsePeriodArg(ctx.args))
        case 'advice':
          return this.adviceReply(ctx)
        case 'habits':
          return this.habitsReply(ctx)
        case 'plan':
          return this.planReply(ctx)
        case 'reset':
          await ctx.user.remove('bot_messages')
          return { html: '🧹 Đã xóa lịch sử trò chuyện. Bắt đầu chủ đề mới nhé!' }
        case 'anh':
        case 've':
        case 'draw':
          return { html: '🎨 Tạo ảnh chỉ có ở bot chạy trên máy tính (Cài đặt → Telegram → "Bot chạy trên máy này").' }
        default:
          return { html: `Mình chưa biết lệnh /${esc(command)}. Gõ /help để xem danh sách lệnh.` }
      }
    }
    const image = this.imageOf(msg)
    if (image) return this.onPhoto(ctx, image, text)
    if (msg.voice || msg.audio) return this.onVoice(ctx, msg)
    if (!text) return { html: 'Mình đọc được chữ, ảnh và tin nhắn thoại thôi 🙂 (chưa xem được sticker hay video).' }
    return this.onText(ctx, text)
  }

  // ---------- linking ----------
  private async link(msg: TgMessage, code: string): Promise<Reply> {
    const chatId = msg.chat.id
    if (msg.chat.type !== 'private') return { html: 'Hãy liên kết trong cuộc trò chuyện riêng với bot.' }
    const now = this.now()
    const failKey = `linkfail:${chatId}`
    const fails = await this.pending.getGlobal<{ count: number; since: string }>(failKey)
    const recentFails =
      fails && now.getTime() - new Date(fails.data.since).getTime() < LINK_WINDOW_MS ? fails.data.count : 0
    if (recentFails >= LINK_MAX_FAILURES)
      return { html: '⛔ Bạn đã nhập sai mã quá nhiều lần. Đợi 15 phút rồi tạo mã mới trong app nhé.' }
    const rows = await this.d.rest.select<{ code: string; user_id: string }>(
      'link_codes',
      [
        ['code', eq(code)],
        ['expires_at', `gt.${now.toISOString()}`],
      ],
      { limit: 1 },
    )
    const found = rows[0]
    if (!found) {
      await this.pending.putGlobal(failKey, 'linkfail', {
        count: recentFails + 1,
        since: recentFails ? (fails?.data.since ?? now.toISOString()) : now.toISOString(),
      })
      return {
        html: '❌ Mã liên kết không đúng hoặc đã hết hạn (mã chỉ dùng được 15 phút). Tạo mã mới trong B&amp;T English → Cài đặt → Telegram rồi gửi lại <code>/start &lt;mã&gt;</code>.',
      }
    }
    const user = this.d.rest.forUser(found.user_id)
    // A chat belongs to one account: drop an older link of this chat, then link (replacing the user's old chat).
    await this.d.rest.remove('telegram_links', [['chat_id', eq(chatId)]])
    await user.insert(
      'telegram_links',
      [{ chat_id: chatId, username: msg.from?.username ?? null, linked_at: now.toISOString() }],
      { onConflict: 'user_id', resolution: 'merge' },
    )
    await user.remove('link_codes')
    if (fails) await this.pending.removeGlobal(failKey)
    this.log('telegram chat linked')
    return {
      html: `🔗 <b>Đã liên kết với B&amp;T English!</b> Từ giờ mình nhận lệnh và gửi nhắc học cho tài khoản này.\n\n${helpHtml(true)}`,
    }
  }

  // ---------- callbacks ----------
  private async handleCallback(cq: TgCallbackQuery): Promise<void> {
    const chatId = cq.message?.chat.id ?? cq.from.id
    const userId = await this.linkedUser(chatId)
    if (!userId) {
      await this.d.tg.answerCallbackQuery(cq.id, 'Không được phép.').catch(() => undefined)
      return
    }
    const ctx: Ctx = {
      userId,
      user: this.d.rest.forUser(userId),
      chatId,
      firstName: cq.from.first_name,
      args: '',
      now: this.now(),
    }
    const data = cq.data ?? ''
    let replies: Reply[]
    try {
      const r = await this.callback(ctx, data)
      replies = Array.isArray(r) ? r : [r]
    } catch (err) {
      this.log(`callback failed: ${err instanceof Error ? err.message : String(err)}`.slice(0, 300))
      replies = [errorReply(err)]
    }
    const toast = replies.find((r) => r.toast)?.toast
    await this.d.tg.answerCallbackQuery(cq.id, toast).catch(() => undefined)
    for (const r of replies) {
      if (!r.html) continue
      if (r.edit && cq.message) {
        try {
          await this.d.tg.editMessageText(chatId, cq.message.message_id, r.html, r.buttons)
          continue
        } catch {
          /* old or deleted message: send a new one */
        }
      }
      await this.d.tg.sendMessage(chatId, r.html, r.buttons)
    }
  }

  private async callback(ctx: Ctx, data: string): Promise<Replies> {
    const [prefix, action, id, extra] = data.split(':')
    switch (prefix) {
      case 'review':
        if (action === 'start') return this.nextCard(ctx)
        if (action === 'stop') return { edit: true, html: '⏹ Đã dừng ôn thẻ. Gõ /review để ôn tiếp bất cứ lúc nào.' }
        if (action === 'show') return this.showAnswer(ctx, id ?? '')
        if (action === 'rate') return this.rate(ctx, id ?? '', Number(extra))
        break
      case 'save':
        return this.saveWord(ctx, action ?? '')
      case 'word':
        return this.wordOfDay(ctx)
      case 'quiz':
        if (action === 'new') return this.quiz(ctx)
        if (action === 'a') return this.answerQuiz(ctx, id ?? '', Number(extra))
        break
      case 'coach':
        if (action === 'advice') {
          if (id === 'new') return this.adviceReply(ctx)
          const p = await this.pending.get<CoachReport>(ctx.userId, id ?? '', 'report')
          return p ? { html: adviceHtml(p.data) } : { toast: 'Báo cáo đã hết hạn – gõ /report để tạo mới.' }
        }
        if (action === 'plan') return this.planReply(ctx)
        if (action === 'habits') return this.habitsReply(ctx)
        if (action === 'report') return this.reportReply(ctx, parsePeriodArg(id ?? 'day'))
        if (action === 'apply') return { toast: 'Mở B&T English → AI Coach để áp dụng kế hoạch vào Hành trình.' }
        break
    }
    return { toast: 'Nút này đã hết hạn.' }
  }

  // ---------- AI helpers ----------
  private ai(ctx: Ctx, tz: string): AiModel | null {
    return this.d.ai ? this.d.quota.metered(this.d.ai, ctx.userId, dateKeyIn(ctx.now, tz)) : null
  }

  private typing(chatId: number) {
    return this.d.tg.sendChatAction(chatId, 'typing').catch(() => undefined)
  }

  private activityRows(
    ctx: Ctx,
    tz: string,
    a: {
      module: string
      action: keyof typeof XP
      title: string
      skill: string
      minutes: number
      xp: number
      score?: number | null
      ref?: string
    },
  ): OutRow[] {
    const iso = ctx.now.toISOString()
    const date = dateKeyIn(ctx.now, tz)
    const rows: OutRow[] = [
      {
        tbl: 'activity_log',
        row_key: `server:${this.uuid()}`,
        client_updated_at: iso,
        data: {
          module: a.module,
          action: a.action,
          title: a.title.slice(0, 200),
          ref: a.ref ?? '',
          skill: a.skill,
          minutes: Math.round(a.minutes * 100) / 100,
          xp: a.xp,
          date,
          created_at: iso,
          score: a.score ?? null,
          source: 'telegram-server',
        },
      },
    ]
    if (a.xp > 0)
      rows.push({
        tbl: 'xp_events',
        row_key: `server:${this.uuid()}`,
        client_updated_at: iso,
        data: { amount: a.xp, source: a.action, skill: a.skill, ref: a.ref ?? null, date, created_at: iso },
      })
    return rows
  }

  private async syncRow(user: UserRest, tbl: string, key: string): Promise<SyncRow | null> {
    const rows = await user.select<SyncRow>(
      'sync_rows',
      [
        ['tbl', eq(tbl)],
        ['row_key', eq(key)],
        ['deleted', 'eq.false'],
      ],
      { select: 'tbl,row_key,data,client_updated_at', limit: 1 },
    )
    return rows[0] ?? null
  }

  // ---------- review ----------
  private async dueRows(ctx: Ctx): Promise<ScheduleRow[]> {
    const rows: SyncRow[] = []
    for (let page = 0; page < 10; page++) {
      const batch = await ctx.user.select<SyncRow>(
        'sync_rows',
        [
          ['tbl', eq('review_schedules')],
          ['deleted', 'eq.false'],
          ['data->>due_at', `lte.${ctx.now.toISOString()}`],
        ],
        { select: 'tbl,row_key,data,client_updated_at', order: 'row_key.asc', limit: 1000, offset: page * 1000 },
      )
      rows.push(...batch)
      if (batch.length < 1000) break
    }
    return sortDue(
      rows.map((r) => ({ ...(r.data as ScheduleRow), word_key: String(r.data.word_key ?? r.row_key) })),
      ctx.now,
    )
  }

  async nextCard(ctx: Ctx): Promise<Reply> {
    const due = await this.dueRows(ctx)
    const card = due[0]
    if (!card) return { html: '🎉 Không còn thẻ nào cần ôn lúc này. Lưu thêm từ mới bằng /word nhé!' }
    const vocab = (await this.syncRow(ctx.user, 'vocabulary', card.word_key))?.data as VocabRow | undefined
    const word = String(vocab?.word ?? card.word_key)
    const pid = await this.pending.put(ctx.userId, 'review', { wordKey: card.word_key, shownAt: ctx.now.toISOString() })
    return {
      html: [
        `🃏 <b>Ôn thẻ</b> · còn ${due.length} thẻ`,
        '',
        `<b>${esc(word)}</b>${vocab?.pos ? ` <i>(${esc(String(vocab.pos))})</i>` : ''}`,
        '',
        'Nhớ lại nghĩa và cách dùng của từ này, rồi bấm “Hiện đáp án”.',
      ].join('\n'),
      buttons: [[{ text: '👀 Hiện đáp án', data: `review:show:${pid}` }], [{ text: '⏹ Dừng', data: 'review:stop' }]],
    }
  }

  private async showAnswer(ctx: Ctx, pid: string): Promise<Reply> {
    const p = await this.pending.get<{ wordKey: string }>(ctx.userId, pid, 'review')
    if (!p) return { toast: 'Thẻ này đã được chấm rồi.' }
    const [sched, vocabRow] = await Promise.all([
      this.syncRow(ctx.user, 'review_schedules', p.data.wordKey),
      this.syncRow(ctx.user, 'vocabulary', p.data.wordKey),
    ])
    if (!sched) return { toast: 'Thẻ này không còn trong kho từ.' }
    const row = { ...(sched.data as ScheduleRow), word_key: p.data.wordKey }
    const v = (vocabRow?.data ?? { word: p.data.wordKey, word_key: p.data.wordKey }) as VocabRow
    const preview = previewRow(row, ctx.now)
    const label = (r: Rating) => `${RATING_LABEL[r]} · ${preview[r]}`
    const lines = [
      `🃏 <b>${esc(String(v.word))}</b>${v.ipa ? ` ${esc(String(v.ipa))}` : ''}${v.pos ? ` <i>(${esc(String(v.pos))})</i>` : ''}`,
    ]
    if (v.meaning_vi) lines.push(`🇻🇳 ${esc(String(v.meaning_vi))}`)
    if (v.meaning_en) lines.push(`🇬🇧 <i>${esc(String(v.meaning_en))}</i>`)
    const ex = examplesOf(v)[0]
    if (ex) lines.push('', `📝 ${esc(ex)}`)
    lines.push('', 'Bạn nhớ từ này thế nào?')
    return {
      edit: true,
      html: lines.join('\n'),
      buttons: [
        [
          { text: label(1), data: `review:rate:${pid}:1` },
          { text: label(2), data: `review:rate:${pid}:2` },
        ],
        [
          { text: label(3), data: `review:rate:${pid}:3` },
          { text: label(4), data: `review:rate:${pid}:4` },
        ],
      ],
    }
  }

  private async rate(ctx: Ctx, pid: string, rating: number): Promise<Replies> {
    if (![1, 2, 3, 4].includes(rating)) return { toast: 'Nút không hợp lệ.' }
    const p = await this.pending.take<{ wordKey: string; shownAt: string }>(ctx.userId, pid, 'review')
    if (!p) return { toast: 'Thẻ này đã được chấm rồi.' }
    const [sched, vocabRow, tz] = await Promise.all([
      this.syncRow(ctx.user, 'review_schedules', p.data.wordKey),
      this.syncRow(ctx.user, 'vocabulary', p.data.wordKey),
      loadTimezone(ctx.user),
    ])
    if (!sched) return { toast: 'Thẻ này không còn trong kho từ.' }
    const row = { ...(sched.data as ScheduleRow), word_key: p.data.wordKey }
    const durationMs = Math.max(0, ctx.now.getTime() - new Date(p.data.shownAt).getTime())
    const { next, log } = reviewRow(row, rating as Rating, ctx.now, durationMs)
    const word = String(vocabRow?.data.word ?? p.data.wordKey)
    await pushRows(ctx.user, [
      {
        tbl: 'review_schedules',
        row_key: p.data.wordKey,
        data: next,
        client_updated_at: nextUpdatedAt(ctx.now, sched.client_updated_at),
      },
      {
        tbl: 'review_logs',
        row_key: `server:${this.uuid()}`,
        client_updated_at: ctx.now.toISOString(),
        data: { ...log, vocab_id: row.vocab_id ?? null, word_key: p.data.wordKey },
      },
      ...this.activityRows(ctx, tz, {
        module: 'vocabulary',
        action: 'review_done',
        title: word,
        skill: 'vocabulary',
        ref: row.vocab_id ? String(row.vocab_id) : '',
        minutes: Math.min(2, Math.max(0.1, durationMs / 60_000 || 0.2)),
        xp: XP.review_done,
      }),
    ])
    return [
      {
        edit: true,
        toast: 'Đã lưu kết quả ôn tập',
        html: `✅ <b>${esc(word)}</b> – ${RATING_LABEL[rating as Rating]}\nLần ôn tiếp: ${relativeDue(next.due_at, ctx.now)}`,
      },
      await this.nextCard(ctx),
    ]
  }

  // ---------- words ----------
  private async savedWordKeys(ctx: Ctx): Promise<string[]> {
    const rows = await ctx.user.select<{ row_key: string }>(
      'sync_rows',
      [
        ['tbl', eq('vocabulary')],
        ['deleted', 'eq.false'],
      ],
      { select: 'row_key', order: 'client_updated_at.desc', limit: 1000 },
    )
    return rows.map((r) => r.row_key)
  }

  private saveButton(pid: string, label: string): TelegramButton {
    return { text: label, data: `save:${pid}` }
  }

  async wordOfDay(ctx: Ctx): Promise<Reply> {
    const [data, saved] = await Promise.all([
      loadLearner(ctx.user, ctx.now, { skipVocab: true, sinceDays: 7 }),
      this.savedWordKeys(ctx),
    ])
    const date = dateKeyIn(ctx.now, data.timezone)
    const recent = await this.pending.recent<PendingWord>(ctx.userId, 'word', 6)
    const avoid = [...new Set([...saved, ...recent.map((r) => wordKeyOf(r.data.word))])]
    let w: WordOfDay | null = null
    let offline = false
    const ai = this.ai(ctx, data.timezone)
    if (ai) {
      try {
        w = await wordOfDay(
          ai,
          recent.length ? `${date} (#${recent.length + 1})` : date,
          avoid.slice(0, 80),
          learnerLine(data),
          overallCefr(data.profile),
        )
      } catch (err) {
        if (!(err instanceof DailyLimitError) && !(err instanceof AiError)) throw err
        this.log(`word of the day AI failed: ${err instanceof AiError ? err.code : 'quota'}`)
      }
    }
    if (!w) {
      const pool = OFFLINE_WORDS.filter((x) => !avoid.includes(wordKeyOf(x.word)))
      w =
        (pool.length ? pool : OFFLINE_WORDS)[
          (hashString(date) + recent.length) % (pool.length || OFFLINE_WORDS.length)
        ] ?? null
      offline = true
    }
    if (!w) return noAiReply()
    const isSaved = saved.includes(wordKeyOf(w.word))
    const pid = isSaved
      ? null
      : await this.pending.put<PendingWord>(ctx.userId, 'word', {
          word: w.word,
          ipa: w.ipa,
          pos: w.pos,
          meaningVi: w.meaningVi,
          meaningEn: w.meaningEn,
          examples: w.examples,
          collocations: w.collocations,
          cefr: w.cefr,
          notes: w.tipVi,
        })
    const html = [
      `📖 <b>Từ của ngày</b>${w.cefr ? ` · ${w.cefr}` : ''}`,
      '',
      `<b>${esc(w.word)}</b> ${esc(w.ipa)}${w.pos ? ` <i>(${esc(w.pos)})</i>` : ''}`,
      `🇻🇳 ${esc(w.meaningVi)}`,
      `🇬🇧 <i>${esc(w.meaningEn)}</i>`,
      '',
      ...w.examples.slice(0, 2).map((x) => `📝 ${esc(x)}`),
      w.collocations.length ? `🔗 ${esc(w.collocations.slice(0, 4).join(' · '))}` : null,
      w.tipVi ? `💡 ${esc(w.tipVi)}` : null,
      offline ? '\n<i>(Từ có sẵn – AI đang tạm nghỉ hoặc đã hết lượt hôm nay.)</i>' : null,
    ]
      .filter((l): l is string => l !== null)
      .join('\n')
    return {
      html,
      buttons: [
        [...(pid ? [this.saveButton(pid, '💾 Lưu vào kho từ')] : []), { text: '🔁 Từ khác', data: 'word:new' }],
      ],
    }
  }

  private async saveWord(ctx: Ctx, pid: string): Promise<Reply> {
    const p = await this.pending.get<PendingWord>(ctx.userId, pid, 'word')
    if (!p) return { toast: 'Nút này đã hết hạn – hỏi lại từ đó nhé.' }
    const w = p.data
    const key = wordKeyOf(w.word)
    if (await this.syncRow(ctx.user, 'vocabulary', key)) return { toast: `“${w.word}” đã có trong kho từ.` }
    const tz = await loadTimezone(ctx.user)
    const iso = ctx.now.toISOString()
    await pushRows(ctx.user, [
      {
        tbl: 'vocabulary',
        row_key: key,
        client_updated_at: iso,
        data: {
          word: w.word.slice(0, 80),
          word_key: key,
          ipa: w.ipa ?? '',
          pos: w.pos ?? '',
          meaning_vi: w.meaningVi,
          meaning_en: w.meaningEn ?? '',
          examples: JSON.stringify(w.examples ?? []),
          context: '',
          source_module: 'tutor',
          source_ref: 'telegram',
          collocations: JSON.stringify(w.collocations ?? []),
          idioms: '[]',
          phrasal_verbs: '[]',
          cefr: w.cefr ?? null,
          topic: '',
          notes: w.notes ?? '',
          is_favorite: 0,
          created_at: iso,
          updated_at: iso,
        },
      },
      { tbl: 'review_schedules', row_key: key, client_updated_at: iso, data: newScheduleRow(key, ctx.now) },
      ...this.activityRows(ctx, tz, {
        module: 'vocabulary',
        action: 'word_saved',
        title: w.word,
        skill: 'vocabulary',
        minutes: 0,
        xp: XP.word_saved,
      }),
    ])
    return { toast: `Đã lưu “${w.word}” vào kho từ ✅` }
  }

  // ---------- quiz ----------
  private weakestQuizSkill(d: LearnerData): QuizSkill {
    const rank = (x: QuizSkill) => CEFR_ORDER.indexOf(d.skills.find((l) => l.skill === x)?.cefr ?? 'B1')
    return [...QUIZ_SKILLS].sort((a, b) => rank(a) - rank(b))[0] ?? 'grammar'
  }

  async quiz(ctx: Ctx): Promise<Reply> {
    if (!this.d.ai) return noAiReply()
    const data = await loadLearner(ctx.user, ctx.now, { skipVocab: true, sinceDays: 3 })
    const ai = this.ai(ctx, data.timezone) as AiModel
    const skill = this.weakestQuizSkill(data)
    const focus = data.mistakes
      .slice(0, 5)
      .map((m) => `[${m.category}] ${m.pattern}${m.correction ? ` → ${m.correction}` : ''}`)
    const recent = (await this.pending.recent<{ quiz: Quiz }>(ctx.userId, 'quiz', 8)).map((r) => r.data.quiz.question)
    await this.typing(ctx.chatId)
    const quiz = await quizPrompt(ai, skill, focus, recent, learnerLine(data))
    const qid = await this.pending.put(ctx.userId, 'quiz', { quiz, skill, startedAt: ctx.now.toISOString() })
    const letters = ['A', 'B', 'C', 'D']
    const lines = [`❓ <b>Quiz nhanh</b> · ${SKILL_VI[skill] ?? skill}`, '']
    if (quiz.passage) lines.push(`<blockquote>${esc(quiz.passage)}</blockquote>`)
    lines.push(`<b>${esc(quiz.question)}</b>`, '', ...quiz.options.map((o, i) => `${letters[i]}. ${esc(o)}`))
    return {
      html: lines.join('\n'),
      buttons: [
        quiz.options.slice(0, 2).map((_, i) => ({ text: letters[i] ?? '?', data: `quiz:a:${qid}:${i}` })),
        quiz.options.slice(2, 4).map((_, i) => ({ text: letters[i + 2] ?? '?', data: `quiz:a:${qid}:${i + 2}` })),
      ],
    }
  }

  private async answerQuiz(ctx: Ctx, qid: string, choice: number): Promise<Reply> {
    const p = await this.pending.take<{ quiz: Quiz; skill: QuizSkill; startedAt: string }>(ctx.userId, qid, 'quiz')
    if (!p) return { toast: 'Câu hỏi đã hết hạn – gõ /quiz để làm câu mới.' }
    const { quiz, skill } = p.data
    const correct = choice === quiz.answerIndex
    const minutes = Math.min(3, Math.max(0.5, (ctx.now.getTime() - new Date(p.data.startedAt).getTime()) / 60_000))
    const action = skill === 'reading' ? 'reading_done' : 'grammar_done'
    const base = XP[action]
    const tz = await loadTimezone(ctx.user)
    await pushRows(
      ctx.user,
      this.activityRows(ctx, tz, {
        module: 'tutor',
        action,
        title: `Telegram quiz: ${quiz.topic || quiz.question.slice(0, 60)}`,
        skill,
        minutes,
        xp: base + (correct ? Math.round(base * 0.5) : 0),
        score: correct ? 1 : 0,
        ref: 'telegram-quiz',
      }),
    )
    const letters = ['A', 'B', 'C', 'D']
    const lines = [`❓ <b>Quiz nhanh</b> · ${SKILL_VI[skill] ?? skill}`, '']
    if (quiz.passage) lines.push(`<blockquote>${esc(quiz.passage)}</blockquote>`)
    lines.push(
      `<b>${esc(quiz.question)}</b>`,
      '',
      ...quiz.options.map(
        (o, i) => `${i === quiz.answerIndex ? '✅' : i === choice ? '❌' : '▫️'} ${letters[i]}. ${esc(o)}`,
      ),
      '',
      correct ? '🎉 <b>Chính xác!</b>' : `Đáp án đúng: <b>${letters[quiz.answerIndex]}</b>`,
      `💡 ${esc(quiz.explanationVi)}`,
    )
    return {
      edit: true,
      toast: correct ? '🎉 Chính xác!' : '❌ Chưa đúng',
      html: lines.join('\n'),
      buttons: [[{ text: '❓ Câu khác', data: 'quiz:new' }]],
    }
  }

  // ---------- coach ----------
  async report(ctx: Ctx, period: CoachPeriod, data?: LearnerData, ref?: string): Promise<CoachReport> {
    const d = data ?? (await loadLearner(ctx.user, ctx.now, { skipVocab: true, sinceDays: 100 }))
    return buildReport(d, period, ctx.now, this.ai(ctx, d.timezone), ref, this.log)
  }

  private async reportReply(ctx: Ctx, period: CoachPeriod): Promise<Reply> {
    await this.typing(ctx.chatId)
    const r = await this.report(ctx, period)
    const pid = await this.pending.put(ctx.userId, 'report', r)
    return { html: reportHtml(r), buttons: [[{ text: 'Xem lời khuyên chi tiết', data: `coach:advice:${pid}` }]] }
  }

  private async adviceReply(ctx: Ctx): Promise<Reply> {
    await this.typing(ctx.chatId)
    return { html: adviceHtml(await this.report(ctx, 'week')) }
  }

  private async planReply(ctx: Ctx): Promise<Reply> {
    await this.typing(ctx.chatId)
    return { html: planHtml(await this.report(ctx, 'day')) }
  }

  private async habitsReply(ctx: Ctx): Promise<Reply> {
    const d = await loadLearner(ctx.user, ctx.now, { skipVocab: true, sinceDays: 35 })
    return {
      html: habitsHtml(statsFor(d, 'week', ctx.now), profile28(d, ctx.now)),
      buttons: [[{ text: 'Lời khuyên AI', data: 'coach:advice:new' }]],
    }
  }

  // ---------- tutor ----------
  private async history(ctx: Ctx) {
    const rows = await ctx.user.select<{ role: 'user' | 'assistant'; content: string }>('bot_messages', [], {
      select: 'role,content',
      order: 'id.desc',
      limit: MEMORY_TURNS,
    })
    const msgs = rows.reverse().map((r) => ({ role: r.role, content: r.content }))
    while (msgs.length && msgs[0]?.role !== 'user') msgs.shift()
    return msgs
  }

  private async remember(ctx: Ctx, user: string, assistant: string): Promise<void> {
    await ctx.user.insert('bot_messages', [
      { role: 'user', content: user.slice(0, 4000) },
      { role: 'assistant', content: assistant.slice(0, 4000) },
    ])
    const ids = await ctx.user.select<{ id: number }>('bot_messages', [], {
      select: 'id',
      order: 'id.desc',
      limit: 1,
      offset: MEMORY_KEEP,
    })
    if (ids[0]) await ctx.user.remove('bot_messages', [['id', `lte.${ids[0].id}`]])
  }

  private async tutor(
    ctx: Ctx,
    message: string,
    mode: TutorMode,
    media: { image?: Media; audio?: Media } = {},
  ): Promise<{ out: TutorOutput; data: LearnerData }> {
    const [data, history] = await Promise.all([
      loadLearner(ctx.user, ctx.now, { skipVocab: true, sinceDays: 14 }),
      this.history(ctx),
    ])
    const ai = this.ai(ctx, data.timezone) as AiModel
    await this.typing(ctx.chatId)
    const out = await runTutor(ai, {
      message,
      history,
      context: learnerContext(data, ctx.now),
      learnerLine: learnerLine(data),
      mode,
      surface: 'telegram',
      ...media,
    })
    const said = mode === 'voice' ? out.transcript || message : message
    const prefix = mode === 'photo' ? '[ảnh] ' : mode === 'voice' ? '[thoại] ' : ''
    await this.remember(ctx, `${prefix}${said}`, out.reply)
    return { out, data }
  }

  private tutorXp(d: LearnerData, now: Date): number {
    const today = dateKeyIn(now, d.timezone)
    const used = d.activities
      .filter((a) => a.date === today && a.action === 'tutor_message')
      .reduce((s, a) => s + a.xp, 0)
    return Math.max(0, Math.min(XP.tutor_message, TUTOR_DAILY_XP_CAP - used))
  }

  private async renderTutor(ctx: Ctx, out: TutorOutput, transcript?: string): Promise<Reply> {
    const parts: string[] = []
    if (transcript) parts.push(`🎙 <b>Mình nghe được:</b> <i>${esc(transcript)}</i>`, '')
    parts.push(esc(out.reply))
    if (out.corrections.length) {
      parts.push('', '✏️ <b>Sửa lỗi</b>')
      for (const c of out.corrections) {
        parts.push(`• <s>${esc(c.original)}</s> → <b>${esc(c.correction)}</b>`)
        if (c.explanationVi) parts.push(`   <i>${esc(c.explanationVi)}</i>`)
      }
    }
    if (out.pronunciationTips.length)
      parts.push('', '🗣 <b>Phát âm</b>', ...out.pronunciationTips.map((t) => `• ${esc(t)}`))
    if (transcript && out.correctedSentence) parts.push('', `✅ <b>Câu nên nói:</b> ${esc(out.correctedSentence)}`)
    const words = out.newWords.slice(0, 3)
    if (words.length)
      parts.push(
        '',
        '📌 <b>Từ mới</b>',
        ...words.map((w) => `• <b>${esc(w.word)}</b>${w.ipa ? ` ${esc(w.ipa)}` : ''} – ${esc(w.meaningVi)}`),
      )
    const buttons: TelegramButton[] = []
    for (const w of words) {
      const pid = await this.pending.put<PendingWord>(ctx.userId, 'word', {
        word: w.word,
        ipa: w.ipa,
        meaningVi: w.meaningVi,
        examples: w.example ? [w.example] : [],
      })
      buttons.push(this.saveButton(pid, `💾 ${truncate(w.word, 24)}`))
    }
    return { html: parts.join('\n'), buttons: buttons.length ? [buttons] : undefined }
  }

  async onText(ctx: Ctx, text: string): Promise<Reply> {
    if (!this.d.ai) return noAiReply()
    const { out, data } = await this.tutor(ctx, text, 'text')
    await pushRows(
      ctx.user,
      this.activityRows(ctx, data.timezone, {
        module: 'tutor',
        action: 'tutor_message',
        title: 'Telegram',
        skill: 'writing',
        minutes: 1,
        xp: this.tutorXp(data, ctx.now),
      }),
    )
    return this.renderTutor(ctx, out)
  }

  private imageOf(msg: TgMessage): { fileId: string; mimeType: string } | null {
    const largest = msg.photo?.[msg.photo.length - 1]
    if (largest) return { fileId: largest.file_id, mimeType: 'image/jpeg' }
    const doc = msg.document
    if (doc?.mime_type?.startsWith('image/')) return { fileId: doc.file_id, mimeType: doc.mime_type }
    return null
  }

  async onPhoto(ctx: Ctx, ref: { fileId: string; mimeType: string }, caption: string): Promise<Reply> {
    if (!this.d.ai) return noAiReply()
    let data: Uint8Array
    try {
      data = await this.d.tg.download(ref.fileId)
    } catch (err) {
      if (err instanceof TelegramError && err.status === 413) return { html: '⚠️ Ảnh quá lớn (tối đa 20 MB).' }
      return { html: '⚠️ Mình không tải được ảnh này, bạn gửi lại nhé.' }
    }
    const question =
      caption || 'Đây là ảnh mình gửi. Hãy xem và giúp mình (nếu là bài viết hoặc bài tập tiếng Anh thì chữa giúp).'
    const { out, data: learner } = await this.tutor(ctx, question, 'photo', { image: { data, mimeType: ref.mimeType } })
    await pushRows(
      ctx.user,
      this.activityRows(ctx, learner.timezone, {
        module: 'tutor',
        action: 'tutor_message',
        title: 'Telegram photo',
        skill: 'writing',
        minutes: 2,
        xp: this.tutorXp(learner, ctx.now),
      }),
    )
    return this.renderTutor(ctx, out)
  }

  async onVoice(ctx: Ctx, msg: TgMessage): Promise<Reply> {
    const v = msg.voice ?? msg.audio
    if (!v) return { html: '' }
    if (!this.d.ai) return noAiReply()
    let audio: Uint8Array
    try {
      audio = await this.d.tg.download(v.file_id)
    } catch (err) {
      if (err instanceof TelegramError && err.status === 413)
        return { html: '⚠️ Tin thoại quá dài. Hãy gửi đoạn ngắn hơn (dưới 2 phút).' }
      return { html: '⚠️ Mình không tải được tin thoại này, bạn gửi lại nhé.' }
    }
    const mimeType = v.mime_type || (msg.voice ? 'audio/ogg' : 'audio/mpeg')
    const { out, data } = await this.tutor(ctx, '(Tin nhắn thoại – nghe file âm thanh đính kèm.)', 'voice', {
      audio: { data: audio, mimeType },
    })
    const transcript = out.transcript?.trim() ?? ''
    if (!transcript) return { html: '🤔 Mình chưa nghe rõ. Bạn nói lại chậm hơn và gần micro hơn nhé.' }
    const seconds = Math.max(1, Math.round(v.duration || 0))
    const minutes = Math.max(0.2, seconds / 60)
    await pushRows(
      ctx.user,
      this.activityRows(ctx, data.timezone, {
        module: 'tutor',
        action: 'speaking_done',
        title: 'Telegram voice message',
        skill: 'speaking',
        minutes,
        xp: XP.speaking_done + Math.round(Math.min(minutes, 30) * 5),
      }),
    )
    return this.renderTutor(ctx, out, transcript)
  }
}

/** Coach report from synced data: offline advice, improved by AI when available (falls back silently). */
export async function buildReport(
  d: LearnerData,
  period: CoachPeriod,
  now: Date,
  ai: AiModel | null,
  ref?: string,
  log: (msg: string) => void = () => undefined,
): Promise<CoachReport> {
  const stats = statsFor(d, period, now, ref)
  const today = dateKeyIn(now, d.timezone)
  const ctx: AdviceContext = {
    planDates: planDates(period, today),
    overallCefr: overallCefr(d.profile),
    targetIelts: d.profile.targetIelts,
    dailyGoalMinutes: d.profile.dailyMinutes,
    dueCards: dueCount(d, now),
  }
  const offline = offlineAdvice(stats, ctx)
  let advice = offline
  let source: 'ai' | 'offline' = 'offline'
  if (ai) {
    try {
      advice = await aiAdvice(ai, stats, ctx, d.skills, learnerLine(d), offline)
      source = 'ai'
    } catch (err) {
      log(
        `coach report AI failed: ${err instanceof AiError ? err.code : err instanceof DailyLimitError ? 'quota' : String(err)}`,
      )
      if (!(err instanceof AiError) && !(err instanceof DailyLimitError)) throw err
    }
  }
  return { period, label: stats.label, stats, advice, source }
}
