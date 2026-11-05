// In-app Telegram bot against a fake Bot API: token handling, pairing, authorisation, commands, FSRS review
// buttons, AI tutor memory, word saving, vision and voice paths, 409 conflicts and token secrecy.
import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import type { TelegramStatus } from '../../src/shared/telegram'
import type { Kernel } from '../../src/main/kernel'
import type { TgUpdate } from '../../src/main/kernel/telegram/api'
import { MEMORY_LIMIT } from '../../src/main/kernel/telegram/context'
import { TELEGRAM_FLAGS } from '../../src/main/kernel/telegram/legacy'
import { TelegramService } from '../../src/main/kernel/telegram/service'
import { OpenAIProvider } from '../../src/main/kernel/ai/openai'
import { makeApp } from '../helpers/kernel'

const TOKEN = '123456789:AAHfakeTokenForIntegration_abcdefgh'
const SECRET = TOKEN.split(':')[1] as string
const GEMINI_KEY = 'AIzaSyFAKEKEY_abcdefghijklmnopqrstuv'
const ME = 777
const STRANGER = 999

interface Call {
  method: string
  body: Record<string, unknown>
}

/** Emulates the Bot API (and optionally other hosts such as Gemini or Pollinations). */
class FakeTelegram {
  readonly calls: Call[] = []
  readonly urls: string[] = []
  /** Updates returned (all at once) by the next getUpdates call. */
  readonly queue: TgUpdate[] = []
  readonly files = new Map<string, Uint8Array>()
  conflict = false
  networkDown = false
  private nextUpdate = 1
  private nextMessage = 100
  other: (url: string, init: RequestInit) => Promise<Response> | Response = () => {
    throw new Error('unexpected host')
  }

  readonly impl = (async (input: string | URL, init: RequestInit = {}) => {
    const url = String(input)
    this.urls.push(url)
    if (url.startsWith('https://api.telegram.org/file/bot')) {
      const filePath = url.split('/').slice(6).join('/')
      const data = this.files.get(filePath.replace(/^files\//, ''))
      return data ? new Response(Buffer.from(data), { status: 200 }) : new Response('nope', { status: 404 })
    }
    const m = /^https:\/\/api\.telegram\.org\/bot([^/]+)\/(\w+)$/.exec(url)
    if (!m) return this.other(url, init)
    if (this.networkDown) throw new TypeError(`fetch failed: ${url}`)
    const [, token, method] = m as unknown as [string, string, string]
    const body = await this.parse(init.body)
    this.calls.push({ method, body })
    if (token !== TOKEN) return this.reply({ ok: false, error_code: 401, description: 'Unauthorized' }, 401)
    switch (method) {
      case 'getMe':
        return this.reply({
          ok: true,
          result: { id: 123456789, is_bot: true, username: 'lq_test_bot', first_name: 'LQ' },
        })
      case 'getUpdates':
        if (this.conflict)
          return this.reply(
            { ok: false, error_code: 409, description: 'Conflict: terminated by other getUpdates request' },
            409,
          )
        await new Promise((r) => setTimeout(r, 2))
        return this.reply({ ok: true, result: this.queue.splice(0) })
      case 'getFile':
        return this.reply({
          ok: true,
          result: { file_id: body.file_id, file_path: `files/${String(body.file_id)}`, file_size: 10 },
        })
      case 'sendMessage':
      case 'sendPhoto':
      case 'sendAudio':
      case 'sendVoice':
      case 'sendDocument':
        return this.reply({
          ok: true,
          result: { message_id: ++this.nextMessage, chat: { id: Number(body.chat_id), type: 'private' }, date: 0 },
        })
      default:
        return this.reply({ ok: true, result: true })
    }
  }) as unknown as typeof fetch

  private reply(body: unknown, status = 200) {
    return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
  }

  private async parse(body: unknown): Promise<Record<string, unknown>> {
    if (typeof body === 'string') return JSON.parse(body) as Record<string, unknown>
    if (body instanceof FormData) {
      const out: Record<string, unknown> = {}
      for (const [k, v] of body.entries()) {
        out[k] =
          typeof v === 'string'
            ? v
            : { file: true, name: (v as File).name, type: v.type, size: (await v.arrayBuffer()).byteLength }
      }
      return out
    }
    return {}
  }

  push(...updates: Omit<TgUpdate, 'update_id'>[]) {
    this.queue.push(...updates.map((u) => ({ update_id: this.nextUpdate++, ...u })))
  }

  text(chatId: number, text: string, extra: Record<string, unknown> = {}) {
    this.push({
      message: {
        message_id: this.nextMessage++,
        chat: { id: chatId, type: 'private' },
        from: { id: chatId, first_name: 'Garen' },
        date: 0,
        text,
        ...extra,
      },
    })
  }

  press(chatId: number, data: string, messageId = 5) {
    this.push({
      callback_query: {
        id: `cb${this.nextUpdate}`,
        from: { id: chatId, first_name: 'Garen' },
        message: { message_id: messageId, chat: { id: chatId, type: 'private' }, date: 0 },
        data,
      },
    })
  }

  of(method: string) {
    return this.calls.filter((c) => c.method === method)
  }

  /** Text of every message sent to `chatId` (HTML). */
  sentTo(chatId: number): string[] {
    return this.calls
      .filter((c) => ['sendMessage', 'editMessageText'].includes(c.method) && String(c.body.chat_id) === String(chatId))
      .map((c) => String(c.body.text))
  }

  lastButtons(method = 'sendMessage'): { text: string; callback_data: string }[] {
    const c = this.of(method).at(-1)
    const markup = c?.body.reply_markup as { inline_keyboard?: { text: string; callback_data: string }[][] } | undefined
    return (markup?.inline_keyboard ?? []).flat()
  }

  reset() {
    this.calls.length = 0
  }
}

async function setup(opts: { mockAi?: boolean; linked?: boolean; token?: boolean } = {}) {
  const fake = new FakeTelegram()
  const app = await makeApp({ fetchImpl: fake.impl, mockAi: opts.mockAi ?? true, telegram: 'real' })
  const svc = app.kernel.telegram as TelegramService
  if (opts.token ?? true) await app.call('telegram:setToken', { token: TOKEN })
  if (opts.linked ?? true) app.kernel.settings.setFlag(TELEGRAM_FLAGS.chatId, String(ME))
  fake.reset()
  const poll = () => svc.pollOnce(0)
  return { ...app, fake, svc, poll }
}

const rows = (k: Kernel, sql: string, p: (string | number)[] = []) => Number(k.db.value(sql, p) ?? 0)

describe('Telegram bot: token and pairing', () => {
  it('is wired into the kernel and stays offline until configured', async () => {
    const { kernel, fake, call } = await setup({ token: false, linked: false })
    expect(kernel.telegram).toBeInstanceOf(TelegramService)
    const st = await call<TelegramStatus>('telegram:status')
    expect(st).toMatchObject({
      hasToken: false,
      tokenHint: null,
      chatLinked: false,
      pairingCode: null,
      connected: false,
    })
    expect(st.imageProvider).toBe('pollinations')
    expect(st.imageModel).toBe('gemini-2.5-flash-image')
    expect(fake.urls).toHaveLength(0)
  })

  it('validates, verifies and masks the token', async () => {
    const { kernel, fake, call, dir } = await setup({ token: false, linked: false })
    await expect(call('telegram:setToken', { token: 'not a token at all' })).rejects.toMatchObject({
      ipc: { code: 'telegram_invalid_format' },
    })
    await expect(
      call('telegram:setToken', { token: '123456789:AAHwrongTokenForIntegration_zzzzzz' }),
    ).rejects.toMatchObject({ ipc: { code: 'telegram_invalid_token' } })
    expect(kernel.keys.has('telegram')).toBe(false)

    const st = await call<TelegramStatus>('telegram:setToken', { token: TOKEN })
    expect(st).toMatchObject({ hasToken: true, tokenHint: `••••${TOKEN.slice(-4)}`, botUsername: 'lq_test_bot' })
    expect(st.chatLinked).toBe(false)
    expect(st.pairingCode).toMatch(/^\d{6}$/)
    expect(JSON.stringify(st)).not.toContain(SECRET)
    // Stored encrypted: the key file never contains the token in plain text.
    const keyFile = fs.readFileSync(path.join(dir, 'secure', 'keys.bin'), 'utf8')
    expect(keyFile).not.toContain(SECRET)
    // The command menu is published (Vietnamese default + English).
    const menus = fake.of('setMyCommands')
    expect(menus).toHaveLength(2)
    expect((menus[0]?.body.commands as { command: string }[]).map((c) => c.command)).toEqual(
      expect.arrayContaining(['start', 'help', 'today', 'review', 'word', 'quiz', 'anh', 'reset']),
    )
    expect(menus[1]?.body.language_code).toBe('en')

    const removed = await call<TelegramStatus>('telegram:removeToken')
    expect(removed).toMatchObject({ hasToken: false, tokenHint: null, botUsername: null })
  })

  it('pairs the chat that sends the code; strangers only get a short notice', async () => {
    const { fake, poll, call, kernel } = await setup({ linked: false })
    const code = (await call<TelegramStatus>('telegram:status')).pairingCode as string
    fake.text(STRANGER, 'hello bot')
    await poll()
    expect(fake.sentTo(STRANGER)).toHaveLength(1)
    expect(fake.sentTo(STRANGER)[0]).toContain('chưa được liên kết')

    fake.text(ME, `/start ${code}`)
    await poll()
    const st = await call<TelegramStatus>('telegram:status')
    expect(st).toMatchObject({ chatLinked: true, connected: true, pairingCode: null })
    expect(kernel.settings.getFlag(TELEGRAM_FLAGS.chatId)).toBe(String(ME))
    expect(fake.sentTo(ME).join('\n')).toContain('Đã liên kết')
    // The offset is persisted so a restart does not handle the same updates again.
    expect(Number(kernel.settings.getFlag(TELEGRAM_FLAGS.offset))).toBeGreaterThan(1)

    // After linking, other chats are ignored completely.
    fake.reset()
    fake.text(STRANGER, `/start ${code}`)
    fake.press(STRANGER, 'review:start')
    await poll()
    expect(fake.sentTo(STRANGER)).toHaveLength(0)
    expect(fake.of('answerCallbackQuery')[0]?.body.text).toBe('Không được phép.')

    // Unlinking shows a fresh pairing code; the bare code (without /start) also pairs.
    const unlinked = await call<TelegramStatus>('telegram:unlink')
    expect(unlinked.chatLinked).toBe(false)
    fake.text(ME, unlinked.pairingCode as string)
    await poll()
    expect((await call<TelegramStatus>('telegram:status')).chatLinked).toBe(true)
  })

  it('rotates the pairing code after repeated wrong guesses and accepts the old bot chat id', async () => {
    const { fake, poll, call } = await setup({ linked: false })
    const first = (await call<TelegramStatus>('telegram:status')).pairingCode as string
    const wrong = first === '000000' ? '111111' : '000000'
    for (let i = 0; i < 5; i++) fake.text(STRANGER, `/start ${wrong}`)
    await poll()
    expect((await call<TelegramStatus>('telegram:status')).pairingCode).not.toBe(first)

    const legacy = await setup({ linked: false })
    legacy.kernel.settings.setFlag(TELEGRAM_FLAGS.chatId, '123456') // imported from the Python bot's config.json
    const st = await legacy.call<TelegramStatus>('telegram:status')
    expect(st).toMatchObject({ chatLinked: true, connected: true, pairingCode: null })
  })

  it('send() returns false until token and chat are configured', async () => {
    const { kernel, fake, call } = await setup({ token: false, linked: false })
    expect(kernel.telegram.isConnected()).toBe(false)
    expect(await kernel.telegram.send({ text: 'hi' })).toBe(false)
    await call('telegram:setToken', { token: TOKEN })
    expect(await kernel.telegram.send({ text: 'hi' })).toBe(false)
    kernel.settings.setFlag(TELEGRAM_FLAGS.chatId, String(ME))
    expect(kernel.telegram.isConnected()).toBe(true)
    expect(await kernel.telegram.send({ text: 'a < b', buttons: [[{ text: 'Go', data: 'review:start' }]] })).toBe(true)
    expect(fake.sentTo(ME).at(-1)).toBe('a &lt; b')
    expect(fake.lastButtons()).toEqual([{ text: 'Go', callback_data: 'review:start' }])
    expect(await call('telegram:test')).toEqual({ ok: true })
    fake.networkDown = true
    expect(await kernel.telegram.send({ text: 'offline' })).toBe(false)
  })

  it('reports a 409 conflict (another bot instance) in the status', async () => {
    const { fake, poll, call } = await setup()
    fake.conflict = true
    const res = await poll()
    expect(res).toMatchObject({ ok: false, code: 'conflict' })
    const st = await call<TelegramStatus>('telegram:status')
    expect(st.polling).toBe('conflict')
    expect(st.lastErrorCode).toBe('conflict')
    expect(st.lastError).toContain('409')
    fake.conflict = false
    await poll()
    expect((await call<TelegramStatus>('telegram:status')).polling).toBe('running')
  })

  it('never exposes the token in status, IPC results or logs', async () => {
    const { kernel, fake, poll, call, svc } = await setup()
    const logs: string[] = []
    kernel.log = { info: (m) => logs.push(m), warn: (m) => logs.push(m), error: (m) => logs.push(m) }
    fake.networkDown = true // the thrown error message contains the full URL with the token
    const res = await poll()
    expect(res.code).toBe('network')
    expect(await kernel.telegram.send({ text: 'x' })).toBe(false)
    const test = await call('telegram:test')
    fake.networkDown = false
    await call('telegram:setToken', { token: TOKEN })
    const outputs = JSON.stringify([await call('telegram:status'), test, svc.status(), logs])
    expect(logs.length).toBeGreaterThan(0)
    expect(outputs).not.toContain(SECRET)
  })

  it('runs and stops the polling loop', async () => {
    const { fake, svc } = await setup()
    const stop = svc.start()
    await new Promise((r) => setTimeout(r, 60))
    stop()
    const n = fake.of('getUpdates').length
    expect(n).toBeGreaterThan(0)
    await new Promise((r) => setTimeout(r, 40))
    expect(fake.of('getUpdates').length).toBeLessThanOrEqual(n + 1)
    expect(svc.status().polling).toBe('stopped')
  })
})

describe('Telegram bot: commands', () => {
  it('/help lists built-in and module commands with bilingual descriptions', async () => {
    const { kernel, fake, poll, call } = await setup()
    kernel.telegram.registerCommand({
      name: 'coachtest',
      description: { en: 'Coach report', vi: 'Báo cáo huấn luyện' },
      run: async (ctx) => ({ text: `report for ${ctx.args || 'today'}` }),
    })
    fake.text(ME, '/help')
    fake.text(ME, '/coachtest week')
    fake.text(ME, '/nothing')
    await poll()
    const [help, coach, unknown] = fake.sentTo(ME)
    for (const c of ['/start', '/help', '/today', '/review', '/word', '/quiz', '/anh', '/reset', '/coachtest'])
      expect(help).toContain(c)
    expect(help).toContain('Báo cáo huấn luyện')
    expect(help).toContain('Coach report')
    expect(coach).toBe('report for week')
    expect(unknown).toContain('/help')
    const st = await call<TelegramStatus>('telegram:status')
    expect(st.commands.map((c) => c.name)).toContain('coachtest')
  })

  it('/today summarises plan, quests, due cards and streak', async () => {
    const { kernel, fake, poll } = await setup()
    const today = new Date()
    const key = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`
    kernel.db.run(
      "INSERT INTO lessons(date, module, title, estimated_minutes, status, position) VALUES (?, 'listening', 'Podcast: <morning>', 10, 'done', 0)",
      [key],
    )
    kernel.db.run(
      "INSERT INTO lessons(date, module, title, estimated_minutes, status, position) VALUES (?, 'grammar', 'Past simple', 15, 'todo', 1)",
      [key],
    )
    kernel.vocab.save({ word: 'improve', meaningVi: 'cải thiện', sourceModule: 'manual' })
    fake.text(ME, '/today')
    await poll()
    const html = fake.sentTo(ME)[0] as string
    expect(html).toContain('Hôm nay')
    expect(html).toContain('Chuỗi')
    expect(html).toContain('Kế hoạch hôm nay</b> (1/2)')
    expect(html).toContain('Podcast: &lt;morning&gt;')
    expect(html).toContain('Nhiệm vụ ngày')
    expect(html).toContain('Thẻ từ cần ôn: <b>1</b>')
    expect(fake.lastButtons().map((b) => b.callback_data)).toEqual(['review:start', 'quiz:new', 'word:new'])
  })

  it('/review runs a full FSRS button cycle', async () => {
    const { kernel, fake, poll } = await setup()
    const { item } = kernel.vocab.save({
      word: 'resilient',
      ipa: '/rɪˈzɪliənt/',
      meaningVi: 'kiên cường',
      meaningEn: 'able to recover quickly',
      examples: ['She is resilient.'],
      sourceModule: 'manual',
    })
    fake.text(ME, '/review')
    await poll()
    expect(fake.sentTo(ME)[0]).toContain('<b>resilient</b>')
    expect(fake.sentTo(ME)[0]).not.toContain('kiên cường')
    expect(fake.lastButtons()[0]?.callback_data).toBe(`review:show:${item.id}`)

    fake.press(ME, `review:show:${item.id}`, 41)
    await poll()
    const shown = fake.of('editMessageText').at(-1)
    expect(shown?.body.message_id).toBe(41)
    expect(String(shown?.body.text)).toContain('kiên cường')
    const rate = fake.lastButtons('editMessageText').map((b) => b.callback_data)
    expect(rate).toEqual([1, 2, 3, 4].map((r) => `review:rate:${item.id}:${r}`))

    fake.press(ME, `review:rate:${item.id}:3`, 41)
    await poll()
    const after = kernel.vocab.get(item.id)
    expect(after?.review.reps).toBe(1)
    expect(after?.review.state).not.toBe('new')
    expect(rows(kernel, 'SELECT COUNT(*) FROM review_logs WHERE vocab_id = ?', [item.id])).toBe(1)
    expect(rows(kernel, "SELECT COUNT(*) FROM activity_log WHERE action = 'review_done'")).toBe(1)
    expect(String(fake.of('editMessageText').at(-1)?.body.text)).toContain('✅ <b>resilient</b>')
    expect(fake.of('answerCallbackQuery').at(-1)?.body.text).toBe('Đã lưu kết quả ôn tập')
    expect(fake.sentTo(ME).at(-1)).toContain('Không còn thẻ nào cần ôn')

    // A second tap on an old button does not review the card twice.
    fake.press(ME, `review:rate:${item.id}:4`, 41)
    await poll()
    expect(kernel.vocab.get(item.id)?.review.reps).toBe(1)
    expect(fake.of('answerCallbackQuery').at(-1)?.body.text).toContain('đã được chấm')
  })

  it('/word offers a Save button that stores the word in the vocab hub', async () => {
    const { kernel, fake, poll } = await setup()
    fake.text(ME, '/word')
    await poll()
    const html = fake.sentTo(ME)[0] as string
    expect(html).toContain('Từ của ngày')
    const save = fake.lastButtons().find((b) => b.callback_data.startsWith('save:'))
    expect(save).toBeDefined()
    const word = /<b>([^<]+)<\/b> \//.exec(html)?.[1] as string
    expect(kernel.vocab.findByWord(word)).toBeNull()
    fake.press(ME, save?.callback_data as string)
    await poll()
    const saved = kernel.vocab.findByWord(word)
    expect(saved?.sourceModule).toBe('tutor')
    expect(saved?.examples.length).toBeGreaterThan(0)
    expect(fake.of('answerCallbackQuery').at(-1)?.body.text).toContain('Đã lưu')
  })

  it('/quiz asks a multiple-choice question and records progress', async () => {
    const { kernel, fake, poll } = await setup()
    fake.text(ME, '/quiz')
    await poll()
    expect(fake.sentTo(ME)[0]).toContain('Quiz nhanh')
    const buttons = fake.lastButtons()
    expect(buttons.map((b) => b.text)).toEqual(['A', 'B', 'C', 'D'])
    fake.press(ME, buttons[1]?.callback_data as string, 50) // the mock's answer is B
    await poll()
    const result = String(fake.of('editMessageText').at(-1)?.body.text)
    expect(result).toContain('Chính xác')
    expect(result).toContain('💡')
    const ev = kernel.db.get<{ module: string; action: string; score: number }>(
      "SELECT module, action, score FROM activity_log WHERE ref = 'telegram-quiz'",
    )
    expect(ev).toMatchObject({ module: 'tutor', score: 1 })
    expect(['grammar_done', 'reading_done']).toContain(ev?.action)
  })

  it('/anh draws with Pollinations (English prompt, caption with the vocabulary) and can be switched off', async () => {
    const { fake, poll, call } = await setup()
    const pollUrls: string[] = []
    fake.other = (url) => {
      pollUrls.push(url)
      return new Response(Buffer.from([0xff, 0xd8, 0xff, 0xe0]), {
        status: 200,
        headers: { 'content-type': 'image/jpeg' },
      })
    }
    fake.text(ME, '/anh 3 loại trái cây kèm phiên âm')
    await poll()
    expect(pollUrls).toHaveLength(1)
    expect(pollUrls[0]).toMatch(/^https:\/\/image\.pollinations\.ai\/prompt\/simple%20colorful/)
    expect(pollUrls[0]).toContain('no%20text')
    expect(pollUrls[0]).toContain('width=1024&height=1024&nologo=true')
    expect(decodeURIComponent(pollUrls[0] as string)).not.toContain('trái cây') // only the English prompt leaves
    const photo = fake.of('sendPhoto')[0]
    expect(photo?.body.photo).toMatchObject({ file: true, size: 4 })
    expect(String(photo?.body.caption)).toContain('apple')
    expect(fake.sentTo(ME)[0]).toContain('Đang vẽ')

    // Natural request, Gemini image model (mock returns a PNG).
    await call('telegram:updateSettings', { imageProvider: 'gemini', imageModel: 'gemini-2.5-flash-image' })
    fake.text(ME, 'vẽ cho mình con mèo đang học tiếng Anh')
    await poll()
    expect(fake.of('sendPhoto')).toHaveLength(2)
    expect(pollUrls).toHaveLength(1)

    await call('telegram:updateSettings', { imageProvider: 'off' })
    fake.text(ME, '/anh a cat')
    await poll()
    expect(fake.sentTo(ME).at(-1)).toContain('đang tắt')
  })
})

describe('Telegram bot: AI tutor', () => {
  it('answers free text with corrections, keeps a bounded memory and counts as study', async () => {
    const { kernel, fake, poll } = await setup()
    fake.text(ME, 'I go to school yesterday')
    await poll()
    const html = fake.sentTo(ME)[0] as string
    expect(html).toContain('Sửa lỗi')
    expect(html).toContain('<b>went</b>')
    expect(html).toContain('Từ mới')
    expect(fake.lastButtons()[0]?.callback_data).toMatch(/^save:/)
    expect(fake.of('sendChatAction')[0]?.body.action).toBe('typing')
    expect(rows(kernel, 'SELECT COUNT(*) FROM telegram_messages')).toBe(2)
    expect(rows(kernel, "SELECT COUNT(*) FROM activity_log WHERE action = 'tutor_message' AND module = 'tutor'")).toBe(
      1,
    )
    expect(kernel.learner.mistakes().map((m) => m.pattern)).toContain('past simple with past time markers')

    for (let i = 0; i < 25; i++) fake.text(ME, `Message number ${i}`)
    await poll()
    expect(rows(kernel, 'SELECT COUNT(*) FROM telegram_messages WHERE chat_id = ?', [String(ME)])).toBe(MEMORY_LIMIT)
    const svc = kernel.telegram as TelegramService
    const history = svc.features.memory.history(String(ME))
    expect(history[0]?.role).toBe('user')
    expect(history.at(-2)?.content).toBe('Message number 24')

    fake.text(ME, '/reset')
    await poll()
    expect(rows(kernel, 'SELECT COUNT(*) FROM telegram_messages')).toBe(0)
  })

  it('without an AI key, explains how to add one', async () => {
    const { fake, poll } = await setup({ mockAi: false })
    fake.text(ME, 'Hello teacher')
    fake.text(ME, '/word')
    await poll()
    const [noKey, word] = fake.sentTo(ME)
    expect(noKey).toContain('Chưa có API key AI')
    expect(word).toContain('Từ của ngày') // offline dictionary still works
    expect(word).toContain('offline')
  })

  it('sends photos to the vision model with the image inline', async () => {
    const { kernel, fake, poll } = await setup({ mockAi: false })
    kernel.ai.setKey('gemini', GEMINI_KEY)
    const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xdb, 1, 2, 3])
    fake.files.set('big', jpeg)
    const geminiBodies: { url: string; body: Record<string, unknown>; headers: unknown }[] = []
    fake.other = async (url, init) => {
      geminiBodies.push({ url, body: JSON.parse(String(init.body)) as Record<string, unknown>, headers: init.headers })
      const out = {
        reply: 'Bài viết tay của bạn khá tốt!',
        corrections: [
          {
            original: 'He go',
            correction: 'He goes',
            explanationVi: 'Ngôi thứ ba số ít thêm -s.',
            category: 'grammar',
          },
        ],
        newWords: [],
        pronunciationTips: [],
        correctedSentence: null,
      }
      return new Response(
        JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(out) }] }, finishReason: 'STOP' }] }),
        { status: 200 },
      )
    }
    fake.text(ME, '', {
      text: undefined,
      caption: 'Chữa giúp mình bài này',
      photo: [
        { file_id: 'small', width: 90, height: 90 },
        { file_id: 'big', width: 1280, height: 960 },
      ],
    })
    await poll()
    expect(fake.of('getFile')[0]?.body.file_id).toBe('big')
    expect(geminiBodies).toHaveLength(1)
    const call = geminiBodies[0] as (typeof geminiBodies)[number]
    expect(call.url).toContain('generativelanguage.googleapis.com')
    expect(call.url).not.toContain(GEMINI_KEY)
    const contents = call.body.contents as {
      role: string
      parts: { text?: string; inlineData?: { mimeType: string; data: string } }[]
    }[]
    const last = contents.at(-1)
    expect(last?.parts[0]?.text).toBe('Chữa giúp mình bài này')
    expect(last?.parts[1]?.inlineData).toEqual({ mimeType: 'image/jpeg', data: Buffer.from(jpeg).toString('base64') })
    expect(JSON.stringify(call.body.systemInstruction)).toContain('photo')
    const html = fake.sentTo(ME)[0] as string
    expect(html).toContain('Bài viết tay của bạn khá tốt!')
    expect(html).toContain('<b>He goes</b>')
  })

  it('OpenAI vision requests carry the image as a data URL', async () => {
    const bodies: Record<string, unknown>[] = []
    const impl = (async (_url: string, init: RequestInit) => {
      bodies.push(JSON.parse(String(init.body)) as Record<string, unknown>)
      return new Response(JSON.stringify({ choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }] }), {
        status: 200,
      })
    }) as unknown as typeof fetch
    const p = new OpenAIProvider('sk-proj-FAKEKEY1234567890abcdefgh', 'gpt-4.1-mini', impl)
    await p.generate({
      system: 'sys',
      messages: [{ role: 'user', content: 'What is this?' }],
      image: { data: new Uint8Array([1, 2, 3]), mimeType: 'image/png' },
    })
    const messages = bodies[0]?.messages as { role: string; content: unknown }[]
    expect(messages.at(-1)?.content).toEqual([
      { type: 'text', text: 'What is this?' },
      { type: 'image_url', image_url: { url: 'data:image/png;base64,AQID' } },
    ])
  })

  it('transcribes voice messages, corrects them and sends the corrected sentence as audio', async () => {
    const { kernel, fake, poll } = await setup()
    fake.files.set('v1', new Uint8Array([0x4f, 0x67, 0x67, 0x53, 0, 0, 0]))
    fake.text(ME, '', { text: undefined, voice: { file_id: 'v1', duration: 4, mime_type: 'audio/ogg' } })
    await poll()
    expect(fake.of('getFile')[0]?.body.file_id).toBe('v1')
    expect(fake.urls.some((u) => u.startsWith('https://api.telegram.org/file/bot') && u.endsWith('/files/v1'))).toBe(
      true,
    )
    const html = fake.sentTo(ME)[0] as string
    expect(html).toContain('Mình nghe được')
    expect(html).toContain('I like learning English every day.') // mock transcription
    expect(html).toContain('Phát âm')
    const audio = fake.calls.find((c) => ['sendAudio', 'sendVoice', 'sendDocument'].includes(c.method))
    expect(audio).toBeDefined()
    expect(String(audio?.body.caption)).toContain('Câu đúng')
    const ev = kernel.db.get<{ module: string; skill: string }>(
      "SELECT module, skill FROM activity_log WHERE action = 'speaking_done'",
    )
    expect(ev).toEqual({ module: 'tutor', skill: 'speaking' })
    expect(rows(kernel, "SELECT COUNT(*) FROM telegram_messages WHERE content LIKE '[thoại]%'")).toBe(1)
  })
})
