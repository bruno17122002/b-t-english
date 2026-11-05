import { describe, expect, it } from 'vitest'
import { classifyTelegramError, TelegramApi, TelegramApiError } from '../../src/main/kernel/telegram/api'
import { BotFeatures } from '../../src/main/kernel/telegram/builtins'
import {
  callbackDataOk,
  escapeHtml,
  isImageRequest,
  parseCommand,
  redactToken,
  splitHtml,
  stripHtml,
} from '../../src/main/kernel/telegram/format'

const TOKEN = '123456789:AAHfakeTokenForUnitTests_abcdefghijk'

describe('HTML helpers', () => {
  it('escapes and strips Telegram HTML', () => {
    expect(escapeHtml('a < b & "c" > d')).toBe('a &lt; b &amp; &quot;c&quot; &gt; d')
    expect(stripHtml('<b>Hi</b> &lt;3 &amp; <i>you</i>')).toBe('Hi <3 & you')
  })

  it('keeps short messages in one piece', () => {
    expect(splitHtml('<b>hello</b>')).toEqual(['<b>hello</b>'])
    expect(splitHtml('   ')).toEqual([])
  })

  it('splits long text at line breaks within the limit', () => {
    const line = 'x'.repeat(90)
    const text = Array.from({ length: 100 }, (_, i) => `${i} ${line}`).join('\n')
    const parts = splitHtml(text, 1000)
    expect(parts.length).toBeGreaterThan(8)
    for (const p of parts) expect(p.length).toBeLessThanOrEqual(1000)
    // No line is cut in the middle.
    for (const p of parts) for (const l of p.split('\n')) expect(l).toMatch(/^\d+ x{90}$/)
    expect(parts.join('\n')).toBe(text)
  })

  it('closes and re-opens tags that span a split', () => {
    const body = Array.from({ length: 60 }, (_, i) => `word${i} `.repeat(5)).join('\n')
    const parts = splitHtml(`<b>${body}</b> <a href="https://x.test/a b">link</a>`, 500)
    expect(parts.length).toBeGreaterThan(1)
    for (const p of parts) {
      expect(p.length).toBeLessThanOrEqual(500)
      const opens = (p.match(/<b>/g) ?? []).length
      const closes = (p.match(/<\/b>/g) ?? []).length
      expect(opens).toBe(closes)
    }
    expect(parts[1]?.startsWith('<b>')).toBe(true)
    expect(parts.at(-1)).toContain('<a href="https://x.test/a b">link</a>')
  })

  it('never cuts inside an HTML entity', () => {
    const long = '&amp;'.repeat(400) // one "word" of 2000 characters
    for (const p of splitHtml(long, 700)) expect(p).toMatch(/^(&amp;)+$/)
  })
})

describe('command parsing', () => {
  it('parses commands, arguments and bot mentions', () => {
    expect(parseCommand('/start 123456')).toEqual({ name: 'start', args: '123456' })
    expect(parseCommand('/HELP')).toEqual({ name: 'help', args: '' })
    expect(parseCommand('/anh@lq_bot  vẽ con mèo ')).toEqual({ name: 'anh', args: 'vẽ con mèo' })
    expect(parseCommand('/anh@lq_bot x', 'LQ_Bot')).toEqual({ name: 'anh', args: 'x' })
    expect(parseCommand('/anh@other_bot x', 'lq_bot')).toBeNull()
    expect(parseCommand('hello /start')).toBeNull()
    expect(parseCommand('/')).toBeNull()
    expect(parseCommand('/review\nline two')).toEqual({ name: 'review', args: 'line two' })
  })

  it('detects natural picture requests (and not look-alikes)', () => {
    expect(isImageRequest('vẽ cho mình con mèo đang đọc sách')).toBe(true)
    expect(isImageRequest('Tạo ảnh 4 loại trái cây')).toBe(true)
    expect(isImageRequest('cho mình xem hình minh họa từ family')).toBe(true)
    expect(isImageRequest('Can you draw a kitchen?')).toBe(true)
    expect(isImageRequest('Điều này ảnh hưởng đến điểm IELTS')).toBe(false)
    expect(isImageRequest('tạo hình thức câu bị động')).toBe(false)
    expect(isImageRequest('I go to school yesterday')).toBe(false)
  })

  it('checks callback data size and redacts tokens', () => {
    expect(callbackDataOk('review:rate:42:3')).toBe(true)
    expect(callbackDataOk('x'.repeat(65))).toBe(false)
    const text = `GET https://api.telegram.org/bot${TOKEN}/getUpdates failed; token ${TOKEN}`
    const red = redactToken(text)
    expect(red).not.toContain(TOKEN)
    expect(red).not.toContain(TOKEN.split(':')[1])
    expect(red).toContain('bot<redacted>')
  })

  it('builds Pollinations URLs without text in the image', () => {
    const url = BotFeatures.pollinationsUrl('a red apple  on a table', 7)
    expect(url).toMatch(/^https:\/\/image\.pollinations\.ai\/prompt\//)
    expect(url).toContain(encodeURIComponent('a red apple on a table, no text, no letters, no words'))
    expect(url).toContain('?width=1024&height=1024&nologo=true&seed=7')
  })
})

describe('Bot API client', () => {
  type Call = { url: string; body: Record<string, unknown> }
  const fake = (respond: (method: string, body: Record<string, unknown>) => Response | Error) => {
    const calls: Call[] = []
    const impl = (async (url: string, init: RequestInit) => {
      const body = typeof init.body === 'string' ? (JSON.parse(init.body) as Record<string, unknown>) : {}
      calls.push({ url, body })
      const r = respond(url.split('/').pop() ?? '', body)
      if (r instanceof Error) throw r
      return r
    }) as unknown as typeof fetch
    return { impl, calls }
  }
  const ok = (result: unknown) => new Response(JSON.stringify({ ok: true, result }), { status: 200 })
  const fail = (status: number, description: string, extra: Record<string, unknown> = {}) =>
    new Response(JSON.stringify({ ok: false, error_code: status, description, ...extra }), { status })

  it('maps Bot API errors', () => {
    expect(classifyTelegramError(401)).toBe('invalid_token')
    expect(classifyTelegramError(404)).toBe('invalid_token')
    expect(classifyTelegramError(409)).toBe('conflict')
    expect(classifyTelegramError(429)).toBe('rate_limited')
    expect(classifyTelegramError(403)).toBe('forbidden')
    expect(classifyTelegramError(502)).toBe('server_error')
    expect(classifyTelegramError(400, 'Bad Request: chat not found')).toBe('bad_request')
  })

  it('splits long messages and puts buttons on the last part', async () => {
    const f = fake(() => ok({ message_id: 1, chat: { id: 1, type: 'private' }, date: 0 }))
    const api = new TelegramApi(TOKEN, f.impl)
    const long = Array.from({ length: 120 }, (_, i) => `Line ${i} ${'y'.repeat(60)}`).join('\n')
    await api.sendMessage('42', long, { buttons: [[{ text: 'OK', data: 'x:1' }]] })
    expect(f.calls.length).toBe(Math.ceil(long.length / 4000))
    expect(f.calls.slice(0, -1).every((c) => c.body.reply_markup === undefined)).toBe(true)
    expect(f.calls.at(-1)?.body.reply_markup).toEqual({ inline_keyboard: [[{ text: 'OK', callback_data: 'x:1' }]] })
    expect(f.calls.every((c) => c.body.parse_mode === 'HTML' && String(c.body.text).length <= 4000)).toBe(true)
  })

  it('falls back to plain text when Telegram cannot parse the HTML', async () => {
    let n = 0
    const f = fake(() =>
      n++ === 0 ? fail(400, "Bad Request: can't parse entities: unclosed tag") : ok({ message_id: 2 }),
    )
    await new TelegramApi(TOKEN, f.impl).sendMessage('42', '<b>broken')
    expect(f.calls).toHaveLength(2)
    expect(f.calls[1]?.body.parse_mode).toBeUndefined()
    expect(f.calls[1]?.body.text).toBe('broken')
  })

  it('reports 401, 409 and 429 (with retry_after) and never leaks the token', async () => {
    const api = (r: Response | Error) => new TelegramApi(TOKEN, fake(() => r).impl)
    await expect(api(fail(401, 'Unauthorized')).getMe()).rejects.toMatchObject({ code: 'invalid_token' })
    await expect(
      api(fail(409, 'Conflict: terminated by other getUpdates request')).getUpdates(null, 0),
    ).rejects.toMatchObject({
      code: 'conflict',
    })
    await expect(
      api(fail(429, 'Too Many Requests: retry after 7', { parameters: { retry_after: 7 } })).sendMessage('1', 'hi'),
    ).rejects.toMatchObject({ code: 'rate_limited', retryAfterSec: 7 })
    const err = await api(new TypeError(`fetch failed: https://api.telegram.org/bot${TOKEN}/getMe`))
      .getMe()
      .catch((e: unknown) => e)
    expect(err).toBeInstanceOf(TelegramApiError)
    expect((err as TelegramApiError).code).toBe('network')
    expect(String((err as Error).message)).not.toContain(TOKEN)
  })

  it('uses long polling for message and callback updates', async () => {
    const f = fake(() => ok([]))
    await new TelegramApi(TOKEN, f.impl).getUpdates(5, 25)
    expect(f.calls[0]?.url).toMatch(/\/getUpdates$/)
    expect(f.calls[0]?.body).toEqual({ offset: 5, timeout: 25, allowed_updates: ['message', 'callback_query'] })
  })
})
