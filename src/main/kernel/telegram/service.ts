// In-app Telegram bot. Long-polls the Bot API while B&T English runs, answers only the linked chat, pairs a
// new chat with a 6-digit code shown in Settings, and lets modules register commands and button callbacks.
// No network activity happens until start() (or an explicit settings action such as setToken).
import { randomInt } from 'node:crypto'
import {
  DEFAULT_IMAGE_MODEL,
  IMAGE_PROVIDERS,
  type ImageProvider,
  type TelegramPollingState,
  type TelegramStatus,
} from '@shared/telegram'
import type { Kernel } from '..'
import {
  TelegramApi,
  TelegramApiError,
  type ChatAction,
  type TgCallbackQuery,
  type TgMessage,
  type TgUpdate,
} from './api'
import { BotFeatures, errorReply, type CallbackHandler, type Replies } from './builtins'
import { BOT_TOKEN_RE, CAPTION_LIMIT, escapeHtml, isImageRequest, parseCommand, redactToken, truncate } from './format'
import { TELEGRAM_FLAGS } from './legacy'
import type { TelegramCommand, TelegramContext, TelegramPort, TelegramReply } from './port'
import { TelegramServerLink } from './server'

export interface TelegramServiceOptions {
  fetchImpl?: typeof fetch
  /** Long-polling timeout in seconds (25 in the app). */
  pollTimeoutSec?: number
}

export interface PollResult {
  ok: boolean
  code?: string
  handled: number
  retryAfterMs?: number
}

/** Pairing attempts with a wrong code before the code is replaced. */
const MAX_PAIRING_ATTEMPTS = 5
const COMMAND_ALIASES: Record<string, string> = { ve: 'anh', draw: 'anh' }

const toList = (r: Replies): TelegramReply[] => (Array.isArray(r) ? r : r ? [r] : [])
const hasContent = (r: TelegramReply) => !!(r.text || r.html || r.photo || r.audio)

export class TelegramService implements TelegramPort {
  private readonly commands = new Map<string, TelegramCommand>()
  private readonly callbacks = new Map<string, CallbackHandler>()
  private apiCache: { token: string; api: TelegramApi } | null = null
  private pairingCode: string | null = null
  private pairingFailures = 0
  private state: TelegramPollingState = 'stopped'
  private lastError: { code: string; message: string } | null = null
  private running = false
  /** Set by stop(): a long poll that still completes afterwards must not flip the state back. */
  private stopped = false
  private wakeController = new AbortController()
  private syncedBot: string | null = null
  private readonly ignoredChats = new Set<string>()
  readonly fetchImpl: typeof fetch
  readonly features: BotFeatures
  /** "Bot chạy trên server" mode: link status, pairing codes and schedule push through the online account. */
  readonly server: TelegramServerLink
  private stopWatch: (() => void) | null = null

  constructor(
    readonly k: Kernel,
    private readonly opts: TelegramServiceOptions = {},
  ) {
    this.fetchImpl = opts.fetchImpl ?? ((...args: Parameters<typeof fetch>) => fetch(...args))
    this.features = new BotFeatures(this)
    this.features.register()
    this.server = new TelegramServerLink(k)
  }

  /** True while the central server bot is used: this app neither polls nor sends. */
  serverMode(): boolean {
    return this.server.mode() === 'server'
  }

  /** Switches between the local bot and the server bot (wakes the polling loop). */
  async setMode(mode: 'local' | 'server', serverBot?: string): Promise<void> {
    if (serverBot !== undefined) this.server.setServerBot(serverBot)
    await this.server.setMode(mode)
    if (mode === 'server') this.state = 'stopped'
    else if (this.running) this.state = 'running'
    this.wake()
  }

  // ---------- configuration ----------
  private token(): string | null {
    return this.k.keys.get('telegram')
  }

  api(): TelegramApi | null {
    const token = this.token()
    if (!token) {
      this.apiCache = null
      return null
    }
    if (this.apiCache?.token !== token) this.apiCache = { token, api: new TelegramApi(token, this.fetchImpl) }
    return this.apiCache.api
  }

  chatId(): string | null {
    const v = this.k.settings.getFlag(TELEGRAM_FLAGS.chatId)?.trim()
    return v && /^-?\d+$/.test(v) ? v : null
  }

  private offset(): number | null {
    const v = Number(this.k.settings.getFlag(TELEGRAM_FLAGS.offset) ?? '')
    return Number.isInteger(v) && v > 0 ? v : null
  }

  imageProvider(): ImageProvider {
    const v = this.k.settings.getFlag(TELEGRAM_FLAGS.imageProvider)
    return (IMAGE_PROVIDERS as readonly string[]).includes(v ?? '') ? (v as ImageProvider) : 'pollinations'
  }

  imageModel(): string {
    return this.k.settings.getFlag(TELEGRAM_FLAGS.imageModel)?.trim() || DEFAULT_IMAGE_MODEL
  }

  private currentPairingCode(): string {
    this.pairingCode ??= String(randomInt(0, 1_000_000)).padStart(6, '0')
    return this.pairingCode
  }

  isConnected(): boolean {
    return !this.serverMode() && this.token() !== null && this.chatId() !== null
  }

  status(): TelegramStatus {
    const hasToken = this.token() !== null
    const chatLinked = this.chatId() !== null
    const server = this.serverMode()
    return {
      mode: server ? 'server' : 'local',
      connected: !server && hasToken && chatLinked,
      hasToken,
      tokenHint: this.k.keys.hint('telegram'),
      botUsername: hasToken ? this.k.settings.getFlag(TELEGRAM_FLAGS.botUsername) || null : null,
      chatLinked,
      pairingCode: hasToken && !chatLinked ? this.currentPairingCode() : null,
      polling: server ? 'stopped' : hasToken ? this.state : this.running ? 'idle' : 'stopped',
      lastError: this.lastError?.message ?? null,
      lastErrorCode: this.lastError?.code ?? null,
      imageProvider: this.imageProvider(),
      imageModel: this.imageModel(),
      encryptionAvailable: this.k.keys.encryptionAvailable,
      commands: this.commandList().map((c) => ({ name: c.name, description: c.description })),
    }
  }

  /** Verifies the token with getMe, stores it encrypted and wakes the polling loop. */
  async setToken(token: string): Promise<TelegramStatus> {
    const clean = token.trim()
    if (!BOT_TOKEN_RE.test(clean)) throw new TelegramApiError('bad_request', 'token format')
    const candidate = new TelegramApi(clean, this.fetchImpl)
    const me = await candidate.getMe()
    const previousBot = this.api()?.botId ?? null
    const res = this.k.keys.set('telegram', clean)
    if (previousBot !== candidate.botId) this.k.settings.setFlag(TELEGRAM_FLAGS.offset, '')
    this.k.settings.setFlag(TELEGRAM_FLAGS.botUsername, me.username ?? '')
    this.lastError = null
    this.state = this.running ? 'running' : 'stopped'
    this.pairingCode = null
    this.pairingFailures = 0
    this.syncedBot = null
    this.k.log.info(`Telegram bot token saved for @${me.username ?? '?'} (persisted=${res.persisted})`)
    await this.syncBot(candidate)
    this.wake()
    return this.status()
  }

  removeToken(): TelegramStatus {
    this.k.keys.remove('telegram')
    this.k.settings.setFlag(TELEGRAM_FLAGS.offset, '')
    this.k.settings.setFlag(TELEGRAM_FLAGS.botUsername, '')
    this.apiCache = null
    this.pairingCode = null
    this.lastError = null
    this.syncedBot = null
    this.k.log.info('Telegram bot token removed')
    this.wake()
    return this.status()
  }

  unlink(): TelegramStatus {
    this.k.settings.setFlag(TELEGRAM_FLAGS.chatId, '')
    this.pairingCode = null
    this.pairingFailures = 0
    this.k.log.info('Telegram chat unlinked')
    return this.status()
  }

  updateSettings(patch: { imageProvider?: ImageProvider; imageModel?: string }): TelegramStatus {
    if (patch.imageProvider) this.k.settings.setFlag(TELEGRAM_FLAGS.imageProvider, patch.imageProvider)
    if (patch.imageModel !== undefined) this.k.settings.setFlag(TELEGRAM_FLAGS.imageModel, patch.imageModel.trim())
    return this.status()
  }

  /** Sends a test message to the linked chat, reporting why it failed. */
  async sendTest(): Promise<{ ok: boolean; error?: string }> {
    const api = this.api()
    const chat = this.chatId()
    if (!api) return { ok: false, error: 'Chưa có token bot.' }
    if (!chat) return { ok: false, error: 'Chưa liên kết với chat Telegram nào.' }
    try {
      await this.deliver(api, chat, {
        html: '✅ <b>B&amp;T English</b> đã kết nối với Telegram!\nGõ /help để xem các lệnh, hoặc nhắn một câu tiếng Anh để mình sửa giúp.',
      })
      return { ok: true }
    } catch (err) {
      return { ok: false, error: this.describe(err).message }
    }
  }

  // ---------- port ----------
  registerCommand(cmd: TelegramCommand): void {
    const name = cmd.name.toLowerCase()
    if (!/^[a-z0-9_]{1,32}$/.test(name)) throw new Error(`Invalid Telegram command name: ${cmd.name}`)
    if (this.commands.has(name)) this.k.log.warn(`Telegram command /${name} registered twice – the last one wins`)
    this.commands.set(name, { ...cmd, name })
    this.syncedBot = null // re-publish the command menu on the next poll
  }

  registerCallback(prefix: string, handler: CallbackHandler): void {
    if (!/^[a-z0-9_-]{1,20}$/i.test(prefix)) throw new Error(`Invalid Telegram callback prefix: ${prefix}`)
    this.callbacks.set(prefix, handler)
  }

  commandList(): TelegramCommand[] {
    return [...this.commands.values()]
  }

  async send(reply: TelegramReply | TelegramReply[]): Promise<boolean> {
    // Server mode: the server scheduler delivers Telegram messages; sending here too would double them.
    if (this.serverMode()) return false
    const api = this.api()
    const chat = this.chatId()
    if (!api || !chat) return false
    try {
      await this.deliver(api, chat, reply)
      return true
    } catch (err) {
      this.k.log.warn(`telegram send failed: ${this.describe(err).code}`)
      return false
    }
  }

  // ---------- BotHost ----------
  async chatAction(chatId: string, action: ChatAction): Promise<void> {
    await this.api()
      ?.sendChatAction(chatId, action)
      .catch(() => undefined)
  }

  async notice(chatId: string, reply: TelegramReply): Promise<void> {
    const api = this.api()
    if (api) await this.deliver(api, chatId, reply).catch(() => undefined)
  }

  async download(fileId: string): Promise<Uint8Array> {
    const api = this.api()
    if (!api) throw new TelegramApiError('invalid_token')
    return api.downloadFile(fileId)
  }

  // ---------- polling ----------
  /** Starts the long-polling loop; returns the stop function (called on quit). */
  start(): () => void {
    if (!this.running) {
      this.running = true
      this.stopped = false
      this.state = 'running'
      void this.loop()
      this.stopWatch = this.server.watch()
    }
    return () => this.stop()
  }

  stop(): void {
    this.running = false
    this.stopped = true
    this.state = 'stopped'
    this.stopWatch?.()
    this.stopWatch = null
    this.wake()
  }

  /** Interrupts the current wait or long poll (token changed, stopping). */
  private wake(): void {
    this.wakeController.abort()
    this.wakeController = new AbortController()
  }

  private idle(ms: number): Promise<void> {
    const signal = this.wakeController.signal
    return new Promise((resolve) => {
      if (signal.aborted) return resolve()
      const t = setTimeout(resolve, ms)
      signal.addEventListener('abort', () => {
        clearTimeout(t)
        resolve()
      })
    })
  }

  private async loop(): Promise<void> {
    let backoff = 3_000
    this.k.log.info('Telegram polling started')
    while (this.running) {
      if (this.serverMode()) {
        // The central server bot answers (webhook); polling here would steal nothing but must not run anyway.
        await this.idle(10 * 60_000)
        continue
      }
      if (!this.token()) {
        await this.idle(10 * 60_000)
        continue
      }
      const res = await this.pollOnce()
      if (!this.running) break
      if (res.ok || res.code === 'cancelled') {
        backoff = 3_000
        continue
      }
      let wait: number
      switch (res.code) {
        case 'invalid_token':
          wait = 10 * 60_000 // until the learner fixes the token (setToken wakes the loop)
          break
        case 'conflict':
          wait = 30_000
          break
        case 'rate_limited':
          wait = res.retryAfterMs ?? 5_000
          break
        case 'network':
        case 'timeout':
        case 'server_error':
          wait = backoff
          backoff = Math.min(backoff * 2, 120_000)
          break
        default:
          wait = 10_000
      }
      await this.idle(wait)
    }
    this.k.log.info('Telegram polling stopped')
  }

  /** Publishes the command menu and refreshes the bot's username once per token. */
  private async syncBot(api: TelegramApi): Promise<void> {
    if (this.syncedBot === api.botId) return
    try {
      const me = await api.getMe(this.wakeController.signal)
      this.k.settings.setFlag(TELEGRAM_FLAGS.botUsername, me.username ?? '')
      const cmds = this.commandList()
      await api.setMyCommands(cmds.map((c) => ({ command: c.name, description: truncate(c.description.vi, 250) })))
      await api.setMyCommands(
        cmds.map((c) => ({ command: c.name, description: truncate(c.description.en, 250) })),
        'en',
      )
      this.syncedBot = api.botId
    } catch (err) {
      const e = this.describe(err)
      if (e.code === 'invalid_token' || e.code === 'cancelled') throw err
      this.k.log.warn(`telegram setMyCommands failed: ${e.code}`)
    }
  }

  /** One getUpdates round: fetches, persists the offset and handles every update. Never throws. */
  async pollOnce(timeoutSec = this.opts.pollTimeoutSec ?? 25): Promise<PollResult> {
    if (this.serverMode()) return { ok: false, code: 'server_mode', handled: 0 }
    const api = this.api()
    if (!api) return { ok: false, code: 'no_token', handled: 0 }
    let updates: TgUpdate[]
    try {
      await this.syncBot(api)
      updates = await api.getUpdates(this.offset(), timeoutSec, this.wakeController.signal)
    } catch (err) {
      const e = this.describe(err)
      if (e.code === 'cancelled') return { ok: false, code: 'cancelled', handled: 0 }
      this.lastError = { code: e.code, message: e.message }
      if (!this.stopped) this.state = e.code === 'conflict' ? 'conflict' : 'error'
      this.k.log.warn(`telegram polling failed: ${e.code}`)
      return {
        ok: false,
        code: e.code,
        handled: 0,
        retryAfterMs: err instanceof TelegramApiError && err.retryAfterSec ? err.retryAfterSec * 1000 : undefined,
      }
    }
    if (!this.stopped) this.state = 'running'
    this.lastError = null
    let handled = 0
    for (const u of updates) {
      // Persist first: a message that crashes the handler must not be fetched again forever.
      this.k.settings.setFlag(TELEGRAM_FLAGS.offset, String(u.update_id + 1))
      try {
        await this.handleUpdate(api, u)
        handled++
      } catch (err) {
        this.k.log.error(
          `telegram update ${u.update_id} failed: ${redactToken(err instanceof Error ? err.message : String(err))}`,
        )
      }
    }
    return { ok: true, handled }
  }

  private describe(err: unknown): { code: string; message: string } {
    if (err instanceof TelegramApiError) {
      if (err.code === 'bad_request' && err.detail === 'token format')
        return {
          code: 'invalid_format',
          message: 'Token không đúng định dạng. Token từ @BotFather có dạng 123456789:AAH… (không có dấu cách).',
        }
      if (err.code === 'conflict')
        return {
          code: 'conflict',
          message:
            'Telegram báo 409: một chương trình khác đang dùng bot này (ví dụ bot Python cũ chạy bằng Task Scheduler "IELTS Telegram chatbot"). Hãy tắt chương trình đó – B&T English sẽ tự kết nối lại.',
        }
      return { code: err.code, message: err.userMessage }
    }
    return { code: 'internal', message: 'Lỗi không mong muốn khi kết nối Telegram.' }
  }

  /** User-facing message for an error thrown by setToken() and friends. */
  errorMessage(err: unknown): { code: string; message: string } {
    return this.describe(err)
  }

  // ---------- updates ----------
  async handleUpdate(api: TelegramApi, u: TgUpdate): Promise<void> {
    if (u.callback_query) return this.handleCallback(api, u.callback_query)
    if (u.message) return this.handleMessage(api, u.message)
  }

  private async handlePairing(api: TelegramApi, msg: TgMessage, text: string): Promise<void> {
    const chatId = String(msg.chat.id)
    if (msg.chat.type !== 'private') return
    const cmd = parseCommand(text, this.k.settings.getFlag(TELEGRAM_FLAGS.botUsername))
    const candidate = (cmd?.name === 'start' ? cmd.args : text).replace(/\s+/g, '')
    const code = this.currentPairingCode()
    if (candidate && candidate === code) {
      this.k.settings.setFlag(TELEGRAM_FLAGS.chatId, chatId)
      this.pairingCode = null
      this.pairingFailures = 0
      this.k.log.info('Telegram chat linked by pairing code')
      await this.deliver(api, chatId, [
        { html: '🔗 <b>Đã liên kết với B&amp;T English!</b> Từ giờ mình chỉ trả lời tài khoản này.' },
        this.features.help(true),
      ])
      return
    }
    if (/^\d{6}$/.test(candidate) && ++this.pairingFailures >= MAX_PAIRING_ATTEMPTS) {
      this.pairingCode = null // too many wrong guesses: show a fresh code in the app
      this.pairingFailures = 0
      this.k.log.warn('Telegram pairing code rotated after repeated wrong attempts')
    }
    await api.sendMessage(
      chatId,
      '🔒 Bot này thuộc về một người dùng B&amp;T English và chưa được liên kết.\nNếu đây là bot của bạn: mở B&amp;T English → Cài đặt → Telegram rồi gửi mã ghép đôi 6 số hiển thị ở đó, ví dụ <code>/start 123456</code>.',
    )
  }

  private async handleMessage(api: TelegramApi, msg: TgMessage): Promise<void> {
    const chatId = String(msg.chat.id)
    const text = (msg.text ?? msg.caption ?? '').trim()
    const linked = this.chatId()
    if (!linked) return this.handlePairing(api, msg, text)
    if (chatId !== linked) {
      if (!this.ignoredChats.has(chatId)) {
        this.ignoredChats.add(chatId)
        this.k.log.warn('telegram: ignored a message from a chat that is not linked')
      }
      return
    }
    const ctx: TelegramContext = { chatId, args: '', firstName: msg.from?.first_name }
    let replies: Replies
    try {
      replies = await this.route(ctx, msg, text)
    } catch (err) {
      this.k.log.warn(
        `telegram message handling failed: ${redactToken(err instanceof Error ? `${err.name} ${err.message}` : String(err)).slice(0, 200)}`,
      )
      replies = errorReply(err)
    }
    await this.deliver(api, chatId, replies)
  }

  private async route(ctx: TelegramContext, msg: TgMessage, text: string): Promise<Replies> {
    const cmd = text ? parseCommand(text, this.k.settings.getFlag(TELEGRAM_FLAGS.botUsername)) : null
    if (cmd) {
      const name = COMMAND_ALIASES[cmd.name] ?? cmd.name
      if (name === 'anh' && this.features.hasImage(msg)) {
        const image = await this.features.downloadImage(msg)
        return this.features.draw(ctx, cmd.args, image ?? undefined)
      }
      const command = this.commands.get(name)
      if (!command) return { html: `Mình chưa biết lệnh /${escapeHtml(cmd.name)}. Gõ /help để xem danh sách lệnh.` }
      return command.run({ ...ctx, args: cmd.args })
    }
    if (this.features.hasImage(msg)) return this.features.onPhoto(ctx, msg, text)
    if (msg.voice || msg.audio) return this.features.onVoice(ctx, msg)
    if (!text) return { text: 'Mình đọc được chữ, ảnh và tin nhắn thoại thôi 🙂 (chưa xem được sticker hay video).' }
    if (isImageRequest(text)) return this.features.draw(ctx, text)
    return this.features.onText(ctx, text)
  }

  private async handleCallback(api: TelegramApi, cq: TgCallbackQuery): Promise<void> {
    const chatId = String(cq.message?.chat.id ?? cq.from.id)
    if (!this.chatId() || chatId !== this.chatId()) {
      await api.answerCallbackQuery(cq.id, 'Không được phép.').catch(() => undefined)
      return
    }
    const data = cq.data ?? ''
    const handler = this.callbacks.get(data.split(':')[0] ?? '')
    if (!handler) {
      await api.answerCallbackQuery(cq.id, 'Nút này đã hết hạn.').catch(() => undefined)
      return
    }
    const ctx: TelegramContext = { chatId, args: data, firstName: cq.from.first_name }
    let replies: TelegramReply[]
    try {
      replies = toList(await handler(data, ctx))
    } catch (err) {
      this.k.log.warn(`telegram callback failed: ${this.describe(err).code}`)
      replies = [errorReply(err)]
    }
    const toast = replies.find((r) => r.toast)?.toast
    await api.answerCallbackQuery(cq.id, toast).catch(() => undefined)
    for (const r of replies) {
      if (!hasContent(r)) continue
      if (r.edit && cq.message && !r.photo && !r.audio) {
        try {
          await api.editMessageText(chatId, cq.message.message_id, r.html ?? escapeHtml(r.text ?? ''), r.buttons)
          continue
        } catch {
          /* old or deleted message: fall back to a new one */
        }
      }
      await this.deliverOne(api, chatId, r)
    }
  }

  // ---------- sending ----------
  private async deliver(api: TelegramApi, chatId: string, replies: Replies): Promise<void> {
    for (const r of toList(replies)) if (hasContent(r)) await this.deliverOne(api, chatId, r)
  }

  private async deliverOne(api: TelegramApi, chatId: string, r: TelegramReply): Promise<void> {
    const html = r.html ?? (r.text ? escapeHtml(r.text) : '')
    let buttonsUsed = false
    if (r.photo) {
      const caption = r.photo.caption ? escapeHtml(r.photo.caption) : html.length <= CAPTION_LIMIT ? html : ''
      const captionIsText = !r.photo.caption && !!html && html.length <= CAPTION_LIMIT
      const mimeType = /\.png$/i.test(r.photo.filename) ? 'image/png' : 'image/jpeg'
      const attach = captionIsText || !html ? r.buttons : undefined
      await api.sendPhoto(
        chatId,
        { data: r.photo.data, filename: r.photo.filename, mimeType },
        truncate(caption, 1024) || undefined,
        attach,
      )
      buttonsUsed = !!attach
      if (html && !captionIsText) {
        await api.sendMessage(chatId, html, { buttons: r.buttons })
        buttonsUsed = true
      }
    } else if (html) {
      await api.sendMessage(chatId, html, { buttons: r.buttons })
      buttonsUsed = true
    }
    if (r.audio) {
      const file = { data: r.audio.data, filename: r.audio.filename, mimeType: r.audio.mimeType }
      const caption = r.audio.caption ? truncate(escapeHtml(r.audio.caption), 1024) : undefined
      const buttons = buttonsUsed ? undefined : r.buttons
      const mime = r.audio.mimeType.toLowerCase()
      if (/ogg|opus/.test(mime)) await api.sendVoice(chatId, file, caption, buttons)
      else if (/mpeg|mp3|mp4|m4a|aac/.test(mime)) await api.sendAudio(chatId, file, caption, buttons)
      else await api.sendDocument(chatId, file, caption, buttons)
    }
  }
}
