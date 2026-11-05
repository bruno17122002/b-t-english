// Built-in features of the Telegram bot: /start /help /today /review /word /quiz /anh /reset, the AI tutor
// for free text, photos (vision) and voice messages, and the inline-button callbacks they use.
import { localDateKey } from '@core/dates'
import type { Rating } from '@core/srs'
import type { ImageProvider } from '@shared/telegram'
import type { UserProviderId } from '@shared/types'
import type { Kernel } from '..'
import { AiError } from '../ai/types'
import { TelegramApiError, type ChatAction, type TgMessage } from './api'
import { ChatMemory, learnerContext, SKILL_VI, todayReply } from './context'
import { CAPTION_LIMIT, escapeHtml, isImageRequest, truncate } from './format'
import type { TelegramButton, TelegramCommand, TelegramContext, TelegramReply } from './port'
import {
  imagePlanPrompt,
  QUIZ_SKILLS,
  quizPrompt,
  tgTutorPrompt,
  wordOfDayPrompt,
  type Quiz,
  type QuizSkill,
  type TgTutorOutput,
  type TutorMode,
  type WordOfDay,
} from './prompts'

export type Replies = TelegramReply | TelegramReply[] | void
export type CallbackHandler = (data: string, ctx: TelegramContext) => Promise<Replies>

/** What the features need from the service (keeps this file free of polling / transport details). */
export interface BotHost {
  readonly k: Kernel
  readonly fetchImpl: typeof fetch
  registerCommand(cmd: TelegramCommand): void
  registerCallback(prefix: string, handler: CallbackHandler): void
  commandList(): TelegramCommand[]
  chatAction(chatId: string, action: ChatAction): Promise<void>
  /** Sends a message right away (progress notices such as "drawing…"); never throws. */
  notice(chatId: string, reply: TelegramReply): Promise<void>
  download(fileId: string): Promise<Uint8Array>
  imageProvider(): ImageProvider
  imageModel(): string
}

const esc = escapeHtml
const POLLINATIONS = 'https://image.pollinations.ai/prompt/'
const RATING_LABEL: Record<Rating, string> = { 1: '😵 Quên', 2: '😐 Khó', 3: '🙂 Nhớ', 4: '😎 Dễ' }
const CEFR_ORDER = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2']

/** Short-lived values referenced by inline buttons (callback data is limited to 64 bytes). */
class PendingStore<T> {
  private readonly items = new Map<string, T>()
  private seq = 0
  put(value: T): string {
    const id = `${(++this.seq).toString(36)}${Math.floor(Math.random() * 1296)
      .toString(36)
      .padStart(2, '0')}`
    this.items.set(id, value)
    if (this.items.size > 300) this.items.delete(this.items.keys().next().value as string)
    return id
  }
  get(id: string): T | undefined {
    return this.items.get(id)
  }
  delete(id: string): void {
    this.items.delete(id)
  }
}

type Pending =
  | {
      kind: 'word'
      word: {
        word: string
        ipa?: string
        pos?: string
        meaningVi: string
        meaningEn?: string
        examples: string[]
        collocations?: string[]
        cefr?: WordOfDay['cefr']
        notes?: string
      }
    }
  | { kind: 'quiz'; quiz: Quiz; skill: QuizSkill; startedAt: number }

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

export function noAiReply(): TelegramReply {
  return {
    html: [
      '🔑 <b>Chưa có API key AI</b>',
      'Mở Lingua Quest → Cài đặt → Nhà cung cấp AI và dán key Gemini (miễn phí tại aistudio.google.com) để mình trò chuyện, sửa bài, đọc ảnh và chấm phát âm.',
      '',
      'Trong lúc chờ, bạn vẫn dùng được: /today, /review và /word (từ điển offline).',
    ].join('\n'),
  }
}

export function errorReply(err: unknown): TelegramReply {
  if (err instanceof AiError) {
    return {
      html: `⚠️ ${esc(err.userMessage)}${err.code === 'no_key' || err.code === 'invalid_key' ? '\n(Cài đặt → Nhà cung cấp AI trong app Lingua Quest)' : ''}`,
    }
  }
  if (err instanceof TelegramApiError) return { html: `⚠️ ${esc(err.userMessage)}` }
  return { html: '⚠️ Có lỗi khi xử lý tin này, mình đã ghi vào nhật ký. Bạn thử lại nhé.' }
}

function relativeDue(dueAt: string, now: Date): string {
  const mins = Math.max(0, Math.round((new Date(dueAt).getTime() - now.getTime()) / 60_000))
  if (mins < 60) return `${Math.max(1, mins)} phút nữa`
  const hours = Math.round(mins / 60)
  if (hours < 24) return `${hours} giờ nữa`
  return `${Math.round(hours / 24)} ngày nữa`
}

export class BotFeatures {
  private readonly pending = new PendingStore<Pending>()
  /** Card id → time the card was shown (for review duration and double-tap protection). */
  private readonly reviewShown = new Map<number, number>()
  private readonly recentQuiz: string[] = []
  private wordRequests = 0
  readonly memory: ChatMemory

  constructor(private readonly host: BotHost) {
    this.memory = new ChatMemory(host.k)
  }

  private get k(): Kernel {
    return this.host.k
  }

  register(): void {
    const h = this.host
    const cmd = (
      name: string,
      en: string,
      vi: string,
      run: (ctx: TelegramContext) => Promise<TelegramReply | TelegramReply[] | void>,
    ) => h.registerCommand({ name, description: { en, vi }, run })
    cmd('start', 'Welcome and how to use the bot', 'Chào mừng và hướng dẫn', async () => this.help(true))
    cmd('help', 'List all commands', 'Danh sách lệnh', async () => this.help(false))
    cmd(
      'today',
      "Today's plan, quests, due cards and streak",
      'Kế hoạch hôm nay, nhiệm vụ, thẻ cần ôn, chuỗi ngày',
      async () => todayReply(this.k),
    )
    cmd('review', 'Review due flashcards (FSRS)', 'Ôn thẻ từ đến hạn (FSRS)', async () => this.nextCard())
    cmd('word', 'Word of the day', 'Từ vựng của ngày', async () => this.wordOfDay())
    cmd('quiz', 'Quick question on your weakest point', 'Câu hỏi nhanh về điểm yếu của bạn', async () => this.quiz())
    cmd('anh', 'Draw a picture: /anh <description>', 'Tạo ảnh minh họa: /anh <mô tả>', async (ctx) =>
      this.draw(ctx, ctx.args),
    )
    cmd('reset', 'Clear the chat memory', 'Xóa lịch sử trò chuyện', async (ctx) => {
      this.memory.clear(ctx.chatId)
      return { html: '🧹 Đã xóa lịch sử trò chuyện. Bắt đầu chủ đề mới nhé!' }
    })

    h.registerCallback('review', (data) => this.onReviewButton(data))
    h.registerCallback('save', async (data) => this.onSave(data))
    h.registerCallback('quiz', (data) => this.onQuizButton(data))
    h.registerCallback('word', async () => this.wordOfDay())
  }

  // ---------- help ----------
  help(welcome: boolean): TelegramReply {
    const lines = [
      welcome
        ? '👋 <b>Chào bạn! Mình là gia sư IELTS của Lingua Quest</b> 🎓'
        : '🎓 <b>Lingua Quest – gia sư IELTS</b>',
      '',
      'Cứ nhắn tự nhiên bằng tiếng Việt hoặc tiếng Anh: hỏi ngữ pháp, từ vựng, nhờ sửa câu, chấm bài Writing, luyện Speaking… Mình biết trình độ, lỗi hay gặp và kế hoạch hôm nay của bạn, và nhớ ~20 lượt gần nhất.',
      '📷 Gửi ảnh (bài viết tay, bài tập, biểu đồ Task 1) – mình đọc và chữa.',
      '🎙 Gửi tin nhắn thoại bằng tiếng Anh – mình sửa lỗi và góp ý phát âm.',
      '🎨 Cần hình minh họa – gõ /anh kèm mô tả, hoặc nhắn "vẽ …", "tạo ảnh …".',
      '',
      '<b>Lệnh / Commands</b>',
      ...this.host.commandList().map((c) => `/${c.name} – ${esc(c.description.vi)} · <i>${esc(c.description.en)}</i>`),
    ]
    return { html: lines.join('\n') }
  }

  // ---------- review ----------
  nextCard(): TelegramReply {
    const card = this.k.vocab.due(1)[0]
    if (!card) return { html: '🎉 Không còn thẻ nào cần ôn lúc này. Lưu thêm từ mới bằng /word nhé!' }
    const total = this.k.vocab.dueCount()
    this.reviewShown.set(card.id, this.k.now().getTime())
    return {
      html: [
        `🃏 <b>Ôn thẻ</b> · còn ${total} thẻ`,
        '',
        `<b>${esc(card.word)}</b>${card.pos ? ` <i>(${esc(card.pos)})</i>` : ''}`,
        '',
        'Nhớ lại nghĩa và cách dùng của từ này, rồi bấm “Hiện đáp án”.',
      ].join('\n'),
      buttons: [
        [{ text: '👀 Hiện đáp án', data: `review:show:${card.id}` }],
        [{ text: '⏹ Dừng', data: 'review:stop' }],
      ],
    }
  }

  private async onReviewButton(data: string): Promise<Replies> {
    const [, action, idText, ratingText] = data.split(':')
    if (action === 'start') return this.nextCard()
    if (action === 'stop') return { edit: true, html: '⏹ Đã dừng ôn thẻ. Gõ /review để ôn tiếp bất cứ lúc nào.' }
    const id = Number(idText)
    const item = Number.isInteger(id) ? this.k.vocab.get(id) : null
    if (!item) return { toast: 'Thẻ này không còn trong kho từ.' }
    if (action === 'show') {
      const preview = this.k.vocab.due(200).find((c) => c.id === id)?.preview
      if (!this.reviewShown.has(id)) this.reviewShown.set(id, this.k.now().getTime())
      const label = (r: Rating) => `${RATING_LABEL[r]}${preview ? ` · ${preview[r]}` : ''}`
      const lines = [
        `🃏 <b>${esc(item.word)}</b>${item.ipa ? ` ${esc(item.ipa)}` : ''}${item.pos ? ` <i>(${esc(item.pos)})</i>` : ''}`,
      ]
      if (item.meaningVi) lines.push(`🇻🇳 ${esc(item.meaningVi)}`)
      if (item.meaningEn) lines.push(`🇬🇧 <i>${esc(item.meaningEn)}</i>`)
      if (item.examples[0]) lines.push('', `📝 ${esc(item.examples[0])}`)
      lines.push('', 'Bạn nhớ từ này thế nào?')
      return {
        edit: true,
        html: lines.join('\n'),
        buttons: [
          [
            { text: label(1), data: `review:rate:${id}:1` },
            { text: label(2), data: `review:rate:${id}:2` },
          ],
          [
            { text: label(3), data: `review:rate:${id}:3` },
            { text: label(4), data: `review:rate:${id}:4` },
          ],
        ],
      }
    }
    if (action === 'rate') {
      const rating = Number(ratingText)
      if (![1, 2, 3, 4].includes(rating)) return { toast: 'Nút không hợp lệ.' }
      const shownAt = this.reviewShown.get(id)
      if (shownAt === undefined && new Date(item.review.dueAt).getTime() > this.k.now().getTime())
        return { toast: 'Thẻ này đã được chấm rồi.' }
      this.reviewShown.delete(id)
      const now = this.k.now()
      const updated = this.k.vocab.review(id, rating as Rating, shownAt !== undefined ? now.getTime() - shownAt : 0)
      return [
        {
          edit: true,
          toast: 'Đã lưu kết quả ôn tập',
          html: `✅ <b>${esc(item.word)}</b> – ${RATING_LABEL[rating as Rating]}\nLần ôn tiếp: ${relativeDue(updated.review.dueAt, now)}`,
        },
        this.nextCard(),
      ]
    }
    return { toast: 'Nút này đã hết hạn.' }
  }

  // ---------- saving words ----------
  private onSave(data: string): TelegramReply {
    const id = data.split(':')[1] ?? ''
    const p = this.pending.get(id)
    if (!p || p.kind !== 'word') return { toast: 'Nút này đã hết hạn – hỏi lại từ đó nhé.' }
    const w = p.word
    const res = this.k.vocab.save({
      word: w.word,
      ipa: w.ipa,
      pos: w.pos,
      meaningVi: w.meaningVi,
      meaningEn: w.meaningEn,
      examples: w.examples,
      collocations: w.collocations,
      cefr: w.cefr ?? null,
      notes: w.notes,
      sourceModule: 'tutor',
      sourceRef: 'telegram',
    })
    return { toast: res.created ? `Đã lưu “${w.word}” vào kho từ ✅` : `“${w.word}” đã có trong kho từ.` }
  }

  private saveButton(word: Pending & { kind: 'word' }, label?: string): TelegramButton {
    return { text: label ?? `💾 ${truncate(word.word.word, 24)}`, data: `save:${this.pending.put(word)}` }
  }

  // ---------- word of the day ----------
  async wordOfDay(): Promise<TelegramReply> {
    const date = localDateKey(this.k.now())
    const n = this.wordRequests++
    let w: WordOfDay
    let offline = false
    if (this.k.ai.isAvailable()) {
      const avoid = this.k.vocab.list({ sort: 'recent', limit: 80 }).items.map((i) => i.word)
      w = (await this.k.ai.run(wordOfDayPrompt, { date: n ? `${date} (#${n + 1})` : date, avoid })).data
    } else {
      const dict = this.k.content.dictionary().filter((e) => !this.k.vocab.findByWord(e.word))
      const seed = Number(date.replace(/\D/g, '')) + n
      const e = dict[seed % Math.max(1, dict.length)]
      if (!e) return noAiReply()
      offline = true
      w = {
        word: e.word,
        ipa: e.ipa,
        pos: e.pos,
        meaningVi: e.meaningVi,
        meaningEn: e.meaningEn,
        examples: e.example ? [e.example] : [],
        collocations: e.collocations ?? [],
        tipVi: '',
        cefr: e.cefr ?? null,
      }
    }
    const saved = this.k.vocab.findByWord(w.word) !== null
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
      offline ? '\n<i>(Từ điển offline – thêm API key AI để mình chọn từ hợp với bạn hơn.)</i>' : null,
    ]
      .filter((l): l is string => l !== null)
      .join('\n')
    const pendingWord: Pending & { kind: 'word' } = {
      kind: 'word',
      word: {
        word: w.word,
        ipa: w.ipa,
        pos: w.pos,
        meaningVi: w.meaningVi,
        meaningEn: w.meaningEn,
        examples: w.examples,
        collocations: w.collocations,
        cefr: w.cefr,
        notes: w.tipVi,
      },
    }
    return {
      html,
      buttons: [
        [
          ...(saved ? [] : [this.saveButton(pendingWord, '💾 Lưu vào kho từ')]),
          { text: '🔁 Từ khác', data: 'word:new' },
        ],
      ],
    }
  }

  // ---------- quiz ----------
  private weakestQuizSkill(): QuizSkill {
    const levels = this.k.learner.skillLevels()
    const rank = (s: QuizSkill) => CEFR_ORDER.indexOf(levels.find((l) => l.skill === s)?.cefr ?? 'B1')
    // Stable choice on ties, preferring grammar (where most recurring mistakes live).
    return [...QUIZ_SKILLS].sort((a, b) => rank(a) - rank(b))[0] ?? 'grammar'
  }

  async quiz(): Promise<TelegramReply> {
    if (!this.k.ai.isAvailable()) return noAiReply()
    const skill = this.weakestQuizSkill()
    const focus = this.k.learner
      .mistakes(5)
      .map((m) => `[${m.category}] ${m.pattern}${m.correction ? ` → ${m.correction}` : ''}`)
    const { data } = await this.k.ai.run(quizPrompt, { skill, focus, recent: this.recentQuiz })
    this.recentQuiz.unshift(data.question)
    this.recentQuiz.splice(8)
    const qid = this.pending.put({ kind: 'quiz', quiz: data, skill, startedAt: this.k.now().getTime() })
    const letters = ['A', 'B', 'C', 'D']
    const lines = [`❓ <b>Quiz nhanh</b> · ${SKILL_VI[skill] ?? skill}`, '']
    if (data.passage) lines.push(`<blockquote>${esc(data.passage)}</blockquote>`)
    lines.push(`<b>${esc(data.question)}</b>`, '', ...data.options.map((o, i) => `${letters[i]}. ${esc(o)}`))
    return {
      html: lines.join('\n'),
      buttons: [
        data.options.slice(0, 2).map((_, i) => ({ text: letters[i] ?? '?', data: `quiz:a:${qid}:${i}` })),
        data.options.slice(2, 4).map((_, i) => ({ text: letters[i + 2] ?? '?', data: `quiz:a:${qid}:${i + 2}` })),
      ],
    }
  }

  private async onQuizButton(data: string): Promise<Replies> {
    const [, action, qid, choiceText] = data.split(':')
    if (action === 'new') return this.quiz()
    const p = qid ? this.pending.get(qid) : undefined
    if (!p || p.kind !== 'quiz') return { toast: 'Câu hỏi đã hết hạn – gõ /quiz để làm câu mới.' }
    this.pending.delete(qid as string)
    const choice = Number(choiceText)
    const { quiz, skill } = p
    const correct = choice === quiz.answerIndex
    const minutes = Math.min(3, Math.max(0.5, (this.k.now().getTime() - p.startedAt) / 60_000))
    this.k.progress.record({
      type: skill === 'reading' ? 'reading_done' : 'grammar_done',
      module: 'tutor',
      skill,
      minutes,
      score: correct ? 1 : 0,
      ref: 'telegram-quiz',
      title: `Telegram quiz: ${quiz.topic || quiz.question.slice(0, 60)}`,
    })
    if (correct) this.k.learner.addSkillProgress(skill, 0.5)
    else if (quiz.topic)
      this.k.learner.recordMistake({
        category: skill,
        pattern: quiz.topic,
        example: quiz.question.slice(0, 200),
        correction: quiz.options[quiz.answerIndex] ?? '',
      })
    const letters = ['A', 'B', 'C', 'D']
    const lines = [`❓ <b>Quiz nhanh</b> · ${SKILL_VI[skill] ?? skill}`, '']
    if (quiz.passage) lines.push(`<blockquote>${esc(quiz.passage)}</blockquote>`)
    lines.push(
      `<b>${esc(quiz.question)}</b>`,
      '',
      ...quiz.options.map((o, i) => {
        const mark = i === quiz.answerIndex ? '✅' : i === choice ? '❌' : '▫️'
        return `${mark} ${letters[i]}. ${esc(o)}`
      }),
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

  // ---------- tutor ----------
  private renderTutor(data: TgTutorOutput, transcript?: string): TelegramReply {
    const parts: string[] = []
    if (transcript) parts.push(`🎙 <b>Mình nghe được:</b> <i>${esc(transcript)}</i>`, '')
    parts.push(esc(data.reply))
    if (data.corrections.length) {
      parts.push('', '✏️ <b>Sửa lỗi</b>')
      for (const c of data.corrections) {
        parts.push(`• <s>${esc(c.original)}</s> → <b>${esc(c.correction)}</b>`)
        if (c.explanationVi) parts.push(`   <i>${esc(c.explanationVi)}</i>`)
      }
    }
    if (data.pronunciationTips.length) {
      parts.push('', '🗣 <b>Phát âm</b>', ...data.pronunciationTips.map((t) => `• ${esc(t)}`))
    }
    if (transcript && data.correctedSentence) parts.push('', `✅ <b>Câu nên nói:</b> ${esc(data.correctedSentence)}`)
    const words = data.newWords.slice(0, 3)
    if (words.length) {
      parts.push(
        '',
        '📌 <b>Từ mới</b>',
        ...words.map((w) => `• <b>${esc(w.word)}</b>${w.ipa ? ` ${esc(w.ipa)}` : ''} – ${esc(w.meaningVi)}`),
      )
    }
    const buttons = words.length
      ? [
          words.map((w) =>
            this.saveButton({
              kind: 'word',
              word: {
                word: w.word,
                ipa: w.ipa,
                meaningVi: w.meaningVi,
                examples: w.example ? [w.example] : [],
              },
            }),
          ),
        ]
      : undefined
    return { html: parts.join('\n'), buttons }
  }

  private recordCorrections(data: TgTutorOutput): void {
    for (const c of data.corrections) {
      if (!c.pattern) continue
      try {
        this.k.learner.recordMistake({
          category: c.category,
          pattern: c.pattern,
          example: c.original,
          correction: c.correction,
        })
      } catch {
        /* never break the reply */
      }
    }
  }

  private async tutor(
    ctx: TelegramContext,
    message: string,
    mode: TutorMode,
    image?: { data: Uint8Array; mimeType: string },
  ): Promise<TgTutorOutput> {
    const history = this.memory.history(ctx.chatId, 20)
    const { data } = await this.k.ai.run(tgTutorPrompt, {
      message: message.slice(0, 3000),
      history,
      context: learnerContext(this.k),
      mode,
      ...(image ? { image } : {}),
    })
    const prefix = mode === 'photo' ? '[ảnh] ' : mode === 'voice' ? '[thoại] ' : ''
    this.memory.add(ctx.chatId, 'user', `${prefix}${message}`, mode)
    this.memory.add(ctx.chatId, 'assistant', data.reply)
    this.recordCorrections(data)
    return data
  }

  async onText(ctx: TelegramContext, text: string): Promise<Replies> {
    if (!this.k.ai.isAvailable()) return noAiReply()
    await this.host.chatAction(ctx.chatId, 'typing')
    const data = await this.tutor(ctx, text, 'text')
    this.k.progress.record({ type: 'tutor_message', module: 'tutor', skill: 'writing', minutes: 1, title: 'Telegram' })
    if (data.corrections.length === 0 && /[a-z]{3,}/i.test(text)) this.k.learner.addSkillProgress('writing', 0.5)
    return this.renderTutor(data)
  }

  private imageOf(msg: TgMessage): { fileId: string; mimeType: string } | null {
    const largest = msg.photo?.[msg.photo.length - 1]
    if (largest) return { fileId: largest.file_id, mimeType: 'image/jpeg' }
    const doc = msg.document
    if (doc?.mime_type?.startsWith('image/')) return { fileId: doc.file_id, mimeType: doc.mime_type }
    return null
  }

  hasImage(msg: TgMessage): boolean {
    return this.imageOf(msg) !== null
  }

  async downloadImage(msg: TgMessage): Promise<{ data: Uint8Array; mimeType: string } | null> {
    const ref = this.imageOf(msg)
    if (!ref) return null
    return { data: await this.host.download(ref.fileId), mimeType: ref.mimeType }
  }

  async onPhoto(ctx: TelegramContext, msg: TgMessage, caption: string): Promise<Replies> {
    let image: { data: Uint8Array; mimeType: string } | null
    try {
      image = await this.downloadImage(msg)
    } catch {
      return { html: '⚠️ Mình không tải được ảnh này, bạn gửi lại nhé.' }
    }
    if (!image) return { html: '⚠️ Mình không đọc được file này.' }
    if (caption && isImageRequest(caption)) return this.draw(ctx, caption, image)
    if (!this.k.ai.isAvailable()) return noAiReply()
    await this.host.chatAction(ctx.chatId, 'typing')
    const question =
      caption || 'Đây là ảnh mình gửi. Hãy xem và giúp mình (nếu là bài viết hoặc bài tập tiếng Anh thì chữa giúp).'
    const data = await this.tutor(ctx, question, 'photo', image)
    this.k.progress.record({
      type: 'tutor_message',
      module: 'tutor',
      skill: 'writing',
      minutes: 2,
      title: 'Telegram photo',
    })
    return this.renderTutor(data)
  }

  private ttsEngine(): UserProviderId | null {
    const cfg = this.k.ai.getConfig()
    if (cfg.mockMode) return 'gemini'
    const pref = this.k.settings.get().ttsEngine
    if ((pref === 'openai' || pref === 'gemini') && cfg.providers[pref].hasKey) return pref
    if (cfg.providers.openai.hasKey) return 'openai'
    if (cfg.providers.gemini.hasKey) return 'gemini'
    return null
  }

  async onVoice(ctx: TelegramContext, msg: TgMessage): Promise<Replies> {
    const v = msg.voice ?? msg.audio
    if (!v) return
    if (!this.k.ai.sttProviderId()) return noAiReply()
    await this.host.chatAction(ctx.chatId, 'typing')
    let audio: Uint8Array
    try {
      audio = await this.host.download(v.file_id)
    } catch (err) {
      if (err instanceof TelegramApiError && err.code === 'too_large')
        return { html: '⚠️ Tin thoại quá dài. Hãy gửi đoạn ngắn hơn (dưới 2 phút).' }
      return { html: '⚠️ Mình không tải được tin thoại này, bạn gửi lại nhé.' }
    }
    const mimeType = v.mime_type || (msg.voice ? 'audio/ogg' : 'audio/mpeg')
    const { text: transcript } = await this.k.ai.transcribe(audio, mimeType)
    if (!transcript.trim()) return { html: '🤔 Mình chưa nghe rõ. Bạn nói lại chậm hơn và gần micro hơn nhé.' }
    const data = this.k.ai.isAvailable() ? await this.tutor(ctx, transcript, 'voice') : null
    const seconds = Math.max(1, Math.round(v.duration || 0))
    this.k.progress.record({
      type: 'speaking_done',
      module: 'tutor',
      skill: 'speaking',
      minutes: Math.max(0.2, seconds / 60),
      speakingSeconds: seconds,
      title: 'Telegram voice message',
    })
    if (!data) return { html: `🎙 <b>Mình nghe được:</b> <i>${esc(transcript)}</i>` }
    this.k.learner.addSkillProgress('speaking', data.corrections.length ? 0.5 : 1)
    const replies: TelegramReply[] = [this.renderTutor(data, transcript)]
    const engine = data.correctedSentence ? this.ttsEngine() : null
    if (engine && data.correctedSentence) {
      try {
        const tts = await this.k.ai.synthesize(engine, data.correctedSentence, undefined, 0.9)
        const ext = tts.mimeType.includes('wav') ? 'wav' : tts.mimeType.includes('ogg') ? 'ogg' : 'mp3'
        replies.push({
          audio: {
            data: tts.audio,
            filename: `cau-dung.${ext}`,
            mimeType: tts.mimeType,
            caption: '🔊 Câu đúng – nghe rồi nói theo nhé',
          },
        })
      } catch (err) {
        this.k.log.warn(`telegram tts failed: ${err instanceof AiError ? err.code : 'error'}`)
      }
    }
    return replies
  }

  // ---------- images ----------
  async draw(ctx: TelegramContext, request: string, image?: { data: Uint8Array; mimeType: string }): Promise<Replies> {
    const provider = this.host.imageProvider()
    if (provider === 'off')
      return { html: '🎨 Tính năng tạo ảnh đang tắt. Bật lại trong Lingua Quest → Cài đặt → Telegram.' }
    const req = request.trim() || (image ? 'Hãy vẽ lại ảnh này cho rõ ràng, dễ học hơn.' : '')
    if (!req) return { html: 'Gõ /anh kèm mô tả, ví dụ:\n/anh 4 loại trái cây kèm phiên âm' }
    const recent = this.memory
      .history(ctx.chatId, 3)
      .map((m) => `${m.role === 'user' ? 'Learner' : 'Tutor'}: ${m.content.slice(0, 200)}`)
      .join('\n')

    if (provider === 'gemini') {
      await this.host.chatAction(ctx.chatId, 'upload_photo')
      try {
        const res = await this.k.ai.generateImage(
          `${req}\n\n(Requirements: a clear picture for a basic IELTS learner; any text in the image must be English, correctly spelled and as short as possible. After the image, write 1–3 short Vietnamese sentences of explanation, plain text without Markdown.)`,
          this.host.imageModel(),
          image,
        )
        this.memory.add(ctx.chatId, 'user', `${image ? '[kèm ảnh] ' : ''}${req}`, 'image')
        this.memory.add(ctx.chatId, 'assistant', `[Đã gửi 1 ảnh] ${res.text}`.trim())
        const ext = res.mimeType.includes('jpeg') ? 'jpg' : res.mimeType.split('/')[1] || 'png'
        return this.photoReplies(res.image, `lingua-quest.${ext}`, res.text)
      } catch (err) {
        if (err instanceof AiError && (err.code === 'quota' || err.code === 'rate_limited'))
          return {
            html: `💳 Model ảnh “${esc(this.host.imageModel())}” không có hạn mức miễn phí (hoặc đã hết). Bật thanh toán (billing) cho key Gemini tại aistudio.google.com, hoặc chuyển sang Pollinations (miễn phí) trong Cài đặt → Telegram.`,
          }
        throw err
      }
    }

    // Pollinations: AI writes an English prompt and a Vietnamese caption; the free service draws a picture without text.
    if (!this.k.ai.isAvailable()) return noAiReply()
    await this.host.notice(ctx.chatId, { text: '🎨 Đang vẽ, chờ mình khoảng 10–60 giây nhé…' })
    await this.host.chatAction(ctx.chatId, 'upload_photo')
    const { data: plan } = await this.k.ai.run(imagePlanPrompt, { request: req, recent, ...(image ? { image } : {}) })
    const picture = await this.fetchPollinations(plan.promptEn)
    if (!picture) return { html: '⚠️ Dịch vụ vẽ ảnh miễn phí đang bận hoặc lỗi, bạn thử lại sau ít phút nhé.' }
    this.memory.add(ctx.chatId, 'user', `${image ? '[kèm ảnh] ' : ''}${req}`, 'image')
    this.memory.add(ctx.chatId, 'assistant', `[Đã gửi 1 ảnh] ${plan.captionVi}`)
    return this.photoReplies(picture.data, `lingua-quest.${picture.ext}`, plan.captionVi)
  }

  private photoReplies(data: Uint8Array, filename: string, caption: string): TelegramReply[] {
    const text = caption.trim()
    if (text.length <= CAPTION_LIMIT) return [{ photo: { data, filename, ...(text ? { caption: text } : {}) } }]
    return [{ photo: { data, filename } }, { text }]
  }

  /** Builds the Pollinations URL (exported for tests through the class). */
  static pollinationsUrl(promptEn: string, seed: number): string {
    let prompt = promptEn.replace(/\s+/g, ' ').trim().slice(0, 800)
    if (!/no text/i.test(prompt)) prompt += ', no text, no letters, no words'
    return `${POLLINATIONS}${encodeURIComponent(prompt)}?width=1024&height=1024&nologo=true&seed=${seed}`
  }

  private async fetchPollinations(promptEn: string): Promise<{ data: Uint8Array; ext: string } | null> {
    const url = BotFeatures.pollinationsUrl(promptEn, Math.floor(Math.random() * 1_000_000))
    for (let attempt = 1; attempt <= 3; attempt++) {
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), 180_000)
      try {
        const res = await this.host.fetchImpl(url, {
          method: 'GET',
          headers: { 'user-agent': 'LinguaQuest/1.0' },
          signal: controller.signal,
        })
        const type = res.headers.get('content-type') ?? ''
        if (res.ok && type.startsWith('image/')) {
          const data = new Uint8Array(await res.arrayBuffer())
          if (data.byteLength) return { data, ext: type.includes('png') ? 'png' : 'jpg' }
        }
        const body = res.ok ? '' : await res.text().catch(() => '')
        const wait = Number(res.headers.get('retry-after') ?? /retry after (\d+)/i.exec(body)?.[1] ?? NaN)
        this.k.log.warn(`pollinations attempt ${attempt}: HTTP ${res.status} ${type}`)
        if ((res.status === 429 || res.status === 402) && Number.isFinite(wait)) {
          await sleep(Math.min(wait + 2, 60) * 1000)
          continue
        }
      } catch (err) {
        this.k.log.warn(`pollinations attempt ${attempt} failed: ${err instanceof Error ? err.name : 'error'}`)
      } finally {
        clearTimeout(timer)
      }
      if (attempt < 3) await sleep(3000)
    }
    return null
  }
}
