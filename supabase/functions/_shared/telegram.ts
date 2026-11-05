// Telegram Bot API client for the central server bot (webhook mode): sendMessage with HTML and inline keyboards
// (split into ≤ 4000-character parts, plain-text fallback on HTML errors), editMessageText, answerCallbackQuery,
// chat actions and file downloads for photos and voice messages. Port of src/main/kernel/telegram/api.ts.
import { callbackDataOk, redactToken, splitHtml, stripHtml, TELEGRAM_CHUNK } from './format.ts'
import type { FetchLike } from './rest.ts'

const BASE = 'https://api.telegram.org'
/** Telegram's download limit for bots. */
export const MAX_DOWNLOAD = 20 * 1024 * 1024

export interface TelegramButton {
  text: string
  /** Callback data, at most 64 bytes. */
  data: string
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
  username?: string
}
export interface TgMessage {
  message_id: number
  chat: TgChat
  from?: TgUser
  date: number
  text?: string
  caption?: string
  photo?: { file_id: string; width: number; height: number; file_size?: number }[]
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

export class TelegramError extends Error {
  constructor(
    readonly status: number,
    readonly detail: string,
  ) {
    super(`telegram ${status}: ${redactToken(detail).slice(0, 200)}`)
    this.name = 'TelegramError'
  }
}

export const keyboard = (buttons?: TelegramButton[][]) => {
  const rows = (buttons ?? [])
    .map((row) =>
      row.filter((b) => b.text && callbackDataOk(b.data)).map((b) => ({ text: b.text, callback_data: b.data })),
    )
    .filter((row) => row.length)
  return rows.length ? { inline_keyboard: rows } : undefined
}

export class TelegramBot {
  constructor(
    private readonly token: string,
    private readonly fetchImpl: FetchLike = (input, init) => fetch(input, init),
  ) {}

  private async call<T>(method: string, body: Record<string, unknown>): Promise<T> {
    let res: Response
    try {
      res = await this.fetchImpl(`${BASE}/bot${this.token}/${method}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      })
    } catch (err) {
      throw new TelegramError(0, err instanceof Error ? err.message : String(err))
    }
    const data = (await res.json().catch(() => null)) as {
      ok?: boolean
      result?: T
      description?: string
      error_code?: number
    } | null
    if (res.ok && data?.ok) return data.result as T
    throw new TelegramError(data?.error_code ?? res.status, data?.description ?? '')
  }

  /** Sends HTML (split when long); buttons go on the last part. Returns the last message id. */
  async sendMessage(chatId: number | string, html: string, buttons?: TelegramButton[][]): Promise<number | null> {
    let lastId: number | null = null
    const parts = splitHtml(html, TELEGRAM_CHUNK)
    for (const [i, part] of parts.entries()) {
      const base = {
        chat_id: chatId,
        link_preview_options: { is_disabled: true },
        reply_markup: i === parts.length - 1 ? keyboard(buttons) : undefined,
      }
      try {
        lastId = (await this.call<TgMessage>('sendMessage', { ...base, text: part, parse_mode: 'HTML' })).message_id
      } catch (err) {
        if (err instanceof TelegramError && err.status === 400 && /parse|entit/i.test(err.detail))
          lastId = (await this.call<TgMessage>('sendMessage', { ...base, text: stripHtml(part) })).message_id
        else throw err
      }
    }
    return lastId
  }

  async editMessageText(chatId: number | string, messageId: number, html: string, buttons?: TelegramButton[][]) {
    try {
      await this.call('editMessageText', {
        chat_id: chatId,
        message_id: messageId,
        text: splitHtml(html, TELEGRAM_CHUNK)[0] ?? '…',
        parse_mode: 'HTML',
        link_preview_options: { is_disabled: true },
        reply_markup: keyboard(buttons) ?? { inline_keyboard: [] },
      })
    } catch (err) {
      if (err instanceof TelegramError && /not modified/i.test(err.detail)) return
      throw err
    }
  }

  async answerCallbackQuery(id: string, text?: string): Promise<void> {
    await this.call('answerCallbackQuery', { callback_query_id: id, ...(text ? { text: text.slice(0, 190) } : {}) })
  }

  async sendChatAction(chatId: number | string, action: 'typing' | 'upload_photo'): Promise<void> {
    await this.call('sendChatAction', { chat_id: chatId, action })
  }

  async setMyCommands(commands: { command: string; description: string }[], languageCode?: string) {
    await this.call('setMyCommands', { commands, ...(languageCode ? { language_code: languageCode } : {}) })
  }

  getFile(fileId: string): Promise<{ file_id: string; file_path?: string; file_size?: number }> {
    return this.call('getFile', { file_id: fileId })
  }

  /** Downloads a file the user sent (photo, voice…), at most 20 MB. */
  async download(fileId: string): Promise<Uint8Array> {
    const info = await this.getFile(fileId)
    if (!info.file_path) throw new TelegramError(400, 'file has no path')
    if ((info.file_size ?? 0) > MAX_DOWNLOAD) throw new TelegramError(413, 'file too large')
    let res: Response
    try {
      res = await this.fetchImpl(`${BASE}/file/bot${this.token}/${info.file_path}`, { method: 'GET' })
    } catch (err) {
      throw new TelegramError(0, err instanceof Error ? err.message : String(err))
    }
    if (!res.ok) throw new TelegramError(res.status, 'download failed')
    const bytes = new Uint8Array(await res.arrayBuffer())
    if (bytes.byteLength > MAX_DOWNLOAD) throw new TelegramError(413, 'file too large')
    return bytes
  }
}
