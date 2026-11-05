// Minimal Telegram Bot API client over fetch. The bot token is part of the URL path (that is how the Bot API
// works), so URLs are never logged and every error message passes through redactToken().
import type { TelegramButton } from './port'
import { callbackDataOk, redactToken, splitHtml, stripHtml, TELEGRAM_CHUNK } from './format'

const BASE = 'https://api.telegram.org'
/** Telegram's own download limit for bots. */
const MAX_DOWNLOAD = 20 * 1024 * 1024

export type TelegramErrorCode =
  | 'invalid_token'
  | 'conflict'
  | 'rate_limited'
  | 'forbidden'
  | 'bad_request'
  | 'server_error'
  | 'network'
  | 'timeout'
  | 'cancelled'
  | 'too_large'

const MESSAGES_VI: Record<TelegramErrorCode, string> = {
  invalid_token: 'Token bot không hợp lệ hoặc đã bị thu hồi (401). Lấy lại token từ @BotFather.',
  conflict:
    'Telegram báo 409: một chương trình khác đang chạy cùng bot này (ví dụ bot Python cũ). Hãy tắt chương trình đó.',
  rate_limited: 'Telegram đang giới hạn tốc độ gửi tin. Thử lại sau ít giây.',
  forbidden: 'Bot không gửi được tin cho bạn (có thể bạn đã chặn bot hoặc chưa bấm Start).',
  bad_request: 'Telegram từ chối yêu cầu.',
  server_error: 'Máy chủ Telegram đang lỗi. Thử lại sau.',
  network: 'Không kết nối được tới Telegram. Kiểm tra Internet.',
  timeout: 'Telegram phản hồi quá lâu.',
  cancelled: 'Đã hủy yêu cầu.',
  too_large: 'File quá lớn (Telegram cho bot tải tối đa 20 MB).',
}

export class TelegramApiError extends Error {
  /** Telegram's description (or the network error), token-free. */
  readonly detail: string

  constructor(
    readonly code: TelegramErrorCode,
    detail = '',
    readonly status?: number,
    readonly retryAfterSec?: number,
  ) {
    const clean = redactToken(detail).slice(0, 300)
    super(`${code}${clean ? `: ${clean.slice(0, 200)}` : ''}`)
    this.name = 'TelegramApiError'
    this.detail = clean
  }

  get userMessage(): string {
    return MESSAGES_VI[this.code]
  }
}

export interface TgUser {
  id: number
  is_bot?: boolean
  first_name?: string
  username?: string
}
export interface TgChat {
  id: number
  type: string
  first_name?: string
  username?: string
}
export interface TgPhotoSize {
  file_id: string
  width: number
  height: number
  file_size?: number
}
export interface TgMessage {
  message_id: number
  chat: TgChat
  from?: TgUser
  date: number
  text?: string
  caption?: string
  photo?: TgPhotoSize[]
  document?: { file_id: string; mime_type?: string; file_name?: string; file_size?: number }
  voice?: { file_id: string; duration: number; mime_type?: string; file_size?: number }
  audio?: { file_id: string; duration: number; mime_type?: string; file_size?: number }
}
export interface TgCallbackQuery {
  id: string
  from: TgUser
  message?: TgMessage
  data?: string
}
export interface TgUpdate {
  update_id: number
  message?: TgMessage
  callback_query?: TgCallbackQuery
}

interface TgResponse<T> {
  ok: boolean
  result?: T
  description?: string
  error_code?: number
  parameters?: { retry_after?: number }
}

export interface FileUpload {
  data: Uint8Array
  filename: string
  mimeType?: string
}

export type ChatAction = 'typing' | 'upload_photo' | 'upload_voice' | 'record_voice'

const keyboard = (buttons?: TelegramButton[][]) => {
  const rows = (buttons ?? [])
    .map((row) =>
      row.filter((b) => b.text && callbackDataOk(b.data)).map((b) => ({ text: b.text, callback_data: b.data })),
    )
    .filter((row) => row.length)
  return rows.length ? { inline_keyboard: rows } : undefined
}

export function classifyTelegramError(status: number, description = ''): TelegramErrorCode {
  if (status === 401 || status === 404) return 'invalid_token' // a malformed token in the path yields 404
  if (status === 409) return 'conflict'
  if (status === 429) return 'rate_limited'
  if (status === 403) return 'forbidden'
  if (status === 413) return 'too_large'
  if (status >= 500) return 'server_error'
  if (/unauthorized/i.test(description)) return 'invalid_token'
  return 'bad_request'
}

export class TelegramApi {
  constructor(
    private readonly token: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  /** Numeric bot id (the part of the token before the colon) – not secret. */
  get botId(): string {
    return this.token.split(':')[0] ?? ''
  }

  private async request<T>(
    method: string,
    body?: Record<string, unknown> | FormData,
    opts: { timeoutMs?: number; signal?: AbortSignal } = {},
  ): Promise<T> {
    if (opts.signal?.aborted) throw new TelegramApiError('cancelled')
    const controller = new AbortController()
    const onAbort = () => controller.abort()
    opts.signal?.addEventListener('abort', onAbort)
    let timedOut = false
    const timer = setTimeout(() => {
      timedOut = true
      controller.abort()
    }, opts.timeoutMs ?? 30_000)
    let res: Response
    try {
      const isForm = typeof FormData !== 'undefined' && body instanceof FormData
      res = await this.fetchImpl(`${BASE}/bot${this.token}/${method}`, {
        method: 'POST',
        headers: isForm ? undefined : { 'content-type': 'application/json' },
        body: isForm ? body : JSON.stringify(body ?? {}),
        signal: controller.signal,
      })
    } catch (err) {
      if (opts.signal?.aborted) throw new TelegramApiError('cancelled')
      if (timedOut) throw new TelegramApiError('timeout')
      throw new TelegramApiError('network', err instanceof Error ? err.message : String(err))
    } finally {
      clearTimeout(timer)
      opts.signal?.removeEventListener('abort', onAbort)
    }
    let data: TgResponse<T>
    try {
      data = (await res.json()) as TgResponse<T>
    } catch {
      throw new TelegramApiError(res.ok ? 'bad_request' : classifyTelegramError(res.status), 'invalid JSON', res.status)
    }
    if (res.ok && data.ok) return data.result as T
    const status = data.error_code ?? res.status
    throw new TelegramApiError(
      classifyTelegramError(status, data.description),
      data.description ?? '',
      status,
      data.parameters?.retry_after,
    )
  }

  getMe(signal?: AbortSignal): Promise<TgUser> {
    return this.request<TgUser>('getMe', {}, { signal, timeoutMs: 20_000 })
  }

  /** Long polling: waits up to `timeoutSec` for new updates. */
  getUpdates(offset: number | null, timeoutSec = 25, signal?: AbortSignal): Promise<TgUpdate[]> {
    return this.request<TgUpdate[]>(
      'getUpdates',
      {
        ...(offset !== null ? { offset } : {}),
        timeout: timeoutSec,
        allowed_updates: ['message', 'callback_query'],
      },
      { signal, timeoutMs: (timeoutSec + 15) * 1000 },
    )
  }

  /** Sends HTML, split into several messages when longer than 4000 characters. Buttons go on the last part. */
  async sendMessage(
    chatId: string,
    html: string,
    opts: { buttons?: TelegramButton[][]; signal?: AbortSignal } = {},
  ): Promise<number | null> {
    const parts = splitHtml(html, TELEGRAM_CHUNK)
    let lastId: number | null = null
    for (const [i, part] of parts.entries()) {
      const markup = i === parts.length - 1 ? keyboard(opts.buttons) : undefined
      const base = { chat_id: chatId, link_preview_options: { is_disabled: true }, reply_markup: markup }
      try {
        const msg = await this.request<TgMessage>('sendMessage', { ...base, text: part, parse_mode: 'HTML' }, opts)
        lastId = msg.message_id
      } catch (err) {
        // Malformed HTML from a caller must not swallow the message: retry as plain text.
        if (err instanceof TelegramApiError && err.code === 'bad_request' && /parse|entit/i.test(err.detail)) {
          const msg = await this.request<TgMessage>('sendMessage', { ...base, text: stripHtml(part) }, opts)
          lastId = msg.message_id
        } else throw err
      }
    }
    return lastId
  }

  private async upload(
    method: 'sendPhoto' | 'sendAudio' | 'sendVoice' | 'sendDocument',
    field: string,
    chatId: string,
    file: FileUpload,
    captionHtml?: string,
    buttons?: TelegramButton[][],
  ): Promise<number> {
    const form = new FormData()
    form.append('chat_id', chatId)
    if (captionHtml) {
      form.append('caption', captionHtml)
      form.append('parse_mode', 'HTML')
    }
    const markup = keyboard(buttons)
    if (markup) form.append('reply_markup', JSON.stringify(markup))
    const blob = new Blob([Buffer.from(file.data)], { type: file.mimeType ?? 'application/octet-stream' })
    form.append(field, blob, file.filename)
    const msg = await this.request<TgMessage>(method, form, { timeoutMs: 120_000 })
    return msg.message_id
  }

  async sendPhoto(chatId: string, file: FileUpload, captionHtml?: string, buttons?: TelegramButton[][]) {
    try {
      return await this.upload('sendPhoto', 'photo', chatId, file, captionHtml, buttons)
    } catch (err) {
      // Very large or unusual images are rejected by sendPhoto but accepted as documents.
      if (err instanceof TelegramApiError && (err.code === 'bad_request' || err.code === 'too_large'))
        return this.upload('sendDocument', 'document', chatId, file, captionHtml, buttons)
      throw err
    }
  }

  sendAudio(chatId: string, file: FileUpload, captionHtml?: string, buttons?: TelegramButton[][]) {
    return this.upload('sendAudio', 'audio', chatId, file, captionHtml, buttons)
  }

  /** Any file (e.g. WAV audio, which sendAudio does not accept). */
  sendDocument(chatId: string, file: FileUpload, captionHtml?: string, buttons?: TelegramButton[][]) {
    return this.upload('sendDocument', 'document', chatId, file, captionHtml, buttons)
  }

  /** Voice notes must be OGG/Opus; other formats go through sendAudio. */
  sendVoice(chatId: string, file: FileUpload, captionHtml?: string, buttons?: TelegramButton[][]) {
    return this.upload('sendVoice', 'voice', chatId, file, captionHtml, buttons)
  }

  async sendChatAction(chatId: string, action: ChatAction): Promise<void> {
    await this.request<boolean>('sendChatAction', { chat_id: chatId, action }, { timeoutMs: 10_000 })
  }

  async answerCallbackQuery(id: string, text?: string): Promise<void> {
    await this.request<boolean>(
      'answerCallbackQuery',
      { callback_query_id: id, ...(text ? { text: text.slice(0, 190) } : {}) },
      { timeoutMs: 10_000 },
    )
  }

  async editMessageText(chatId: string, messageId: number, html: string, buttons?: TelegramButton[][]): Promise<void> {
    const text = splitHtml(html, TELEGRAM_CHUNK)[0] ?? '…'
    try {
      await this.request('editMessageText', {
        chat_id: chatId,
        message_id: messageId,
        text,
        parse_mode: 'HTML',
        link_preview_options: { is_disabled: true },
        reply_markup: keyboard(buttons) ?? { inline_keyboard: [] },
      })
    } catch (err) {
      if (err instanceof TelegramApiError && /not modified/i.test(err.detail)) return
      throw err
    }
  }

  getFile(fileId: string): Promise<{ file_id: string; file_path?: string; file_size?: number }> {
    return this.request('getFile', { file_id: fileId })
  }

  /** Downloads a file the user sent (photo, voice…). */
  async downloadFile(fileId: string): Promise<Uint8Array> {
    const info = await this.getFile(fileId)
    if (!info.file_path) throw new TelegramApiError('bad_request', 'file has no path')
    if ((info.file_size ?? 0) > MAX_DOWNLOAD) throw new TelegramApiError('too_large')
    let res: Response
    try {
      res = await this.fetchImpl(`${BASE}/file/bot${this.token}/${info.file_path}`, { method: 'GET' })
    } catch (err) {
      throw new TelegramApiError('network', err instanceof Error ? err.message : String(err))
    }
    if (!res.ok) throw new TelegramApiError(classifyTelegramError(res.status), `download failed`, res.status)
    const bytes = new Uint8Array(await res.arrayBuffer())
    if (bytes.byteLength > MAX_DOWNLOAD) throw new TelegramApiError('too_large')
    return bytes
  }

  async setMyCommands(commands: { command: string; description: string }[], languageCode?: string): Promise<void> {
    await this.request('setMyCommands', {
      commands: commands.slice(0, 100),
      ...(languageCode ? { language_code: languageCode } : {}),
    })
  }
}
