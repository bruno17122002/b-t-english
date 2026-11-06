// Central Telegram bot (Edge Function logic) against a fake PostgREST, a fake Bot API and a scripted AI:
// linking with /start <code>, unlinked chats, command routing, FSRS review buttons writing sync rows, saving words,
// quiz, tutor memory, quota, photo/voice, webhook authentication and per-user filtering of every query.
import { describe, expect, it } from 'vitest'
import { ServerBot, UNLINKED_HTML } from '../../supabase/functions/_shared/bot'
import { handleTelegramWebhook, readEnv } from '../../supabase/functions/_shared/handlers'
import { AiQuota } from '../../supabase/functions/_shared/quota'
import { SupabaseRest } from '../../supabase/functions/_shared/rest'
import { TelegramBot, type TgUpdate } from '../../supabase/functions/_shared/telegram'
import {
  CHAT,
  combinedFetch,
  FakeAi,
  FakePostgrest,
  FakeTelegramApi,
  learnerFixture,
  OTHER,
  SERVICE_KEY,
  SUPABASE_URL,
  syncRow,
  TZ,
  USER,
  type Row,
} from '../helpers/fakeEdge'

const NOW = '2026-11-05T03:00:00.000Z' // Thursday 10:00 in Vietnam

function setup(opts: { linked?: boolean; ai?: boolean; limit?: number; fixture?: boolean } = {}) {
  const sb = new FakePostgrest()
  const tg = new FakeTelegramApi()
  const ai = new FakeAi()
  const fetch = combinedFetch(sb, tg)
  const rest = new SupabaseRest(SUPABASE_URL, SERVICE_KEY, fetch)
  let t = Date.parse(NOW)
  let ids = 0
  let updateId = 1
  const bot = new ServerBot({
    rest,
    tg: new TelegramBot('123456:TEST_TOKEN_abcdefghijklmnopqrstuvwxyz', fetch),
    ai: opts.ai === false ? null : ai,
    quota: new AiQuota(rest, opts.limit ?? 100),
    now: () => new Date(t),
    uuid: () => `uuid-${++ids}`,
  })
  sb.seed('profiles', [{ user_id: USER, timezone: TZ, display_name: 'Lan' }])
  if (opts.linked !== false)
    sb.seed('telegram_links', [{ user_id: USER, chat_id: CHAT, username: 'lan', linked_at: NOW }])
  if (opts.fixture !== false) sb.seed('sync_rows', learnerFixture())
  const chat = (id: number, type = 'private') => ({ id, type })
  const send = (message: Record<string, unknown>, chatId = CHAT, type = 'private') =>
    bot.handleUpdate({
      update_id: updateId++,
      message: {
        message_id: 50,
        chat: chat(chatId, type),
        from: { id: chatId, first_name: 'Lan', username: 'lan' },
        date: 0,
        ...message,
      },
    } as TgUpdate)
  const say = (text: string, chatId = CHAT, type = 'private') => send({ text }, chatId, type)
  const press = (data: string, chatId = CHAT) =>
    bot.handleUpdate({
      update_id: updateId++,
      callback_query: {
        id: `cq${updateId}`,
        from: { id: chatId },
        message: { message_id: 100, chat: chat(chatId), date: 0 },
        data,
      },
    })
  const lastButtons = () => {
    const calls = tg.calls.filter((c) => c.method === 'sendMessage' || c.method === 'editMessageText')
    const markup = calls[calls.length - 1]?.body.reply_markup as
      { inline_keyboard: { text: string; callback_data: string }[][] } | undefined
    return markup?.inline_keyboard.flat() ?? []
  }
  const rows = (tbl: string) => sb.rows('sync_rows').filter((r) => r.tbl === tbl && r.user_id === USER)
  return { sb, tg, ai, bot, say, send, press, lastButtons, rows, advance: (ms: number) => (t += ms) }
}

/** Every call on a per-user table carries user_id=eq.<user> (or stamps user_id on inserted rows). */
function expectUserScoped(sb: FakePostgrest, user = USER) {
  const perUser = ['sync_rows', 'bot_messages', 'ai_usage', 'notification_log', 'profiles']
  for (const c of sb.calls.filter((x) => perUser.includes(x.table))) {
    if (c.method === 'POST') for (const r of c.body as Row[]) expect(r.user_id).toBe(user)
    else expect(c.params.get('user_id')).toBe(`eq.${user}`)
  }
}

describe('server bot – linking', () => {
  it('links a chat with a valid /start code, consumes the code and greets', async () => {
    const { sb, tg, say } = setup({ linked: false })
    sb.seed('link_codes', [{ code: '123456', user_id: OTHER, expires_at: '2026-11-05T03:10:00.000Z' }])
    await say('/start 123456', 888)
    expect(sb.rows('telegram_links')).toEqual([
      expect.objectContaining({ user_id: OTHER, chat_id: 888, username: 'lan' }),
    ])
    expect(sb.rows('link_codes')).toHaveLength(0)
    expect(tg.texts()[0]).toContain('Đã liên kết với B&amp;T English')
    expect(tg.texts()[0]).toContain('/review')
  })

  it('moves a chat to the account of the new code (one chat ↔ one account)', async () => {
    const { sb, say } = setup()
    sb.seed('link_codes', [{ code: '654321', user_id: OTHER, expires_at: '2026-11-05T03:10:00.000Z' }])
    await say('/start 654321')
    expect(sb.rows('telegram_links')).toEqual([expect.objectContaining({ user_id: OTHER, chat_id: CHAT })])
  })

  it('rejects expired or wrong codes and blocks after 5 failures', async () => {
    const { sb, tg, say } = setup({ linked: false })
    sb.seed('link_codes', [
      { code: '111111', user_id: OTHER, expires_at: '2026-11-05T02:59:00.000Z' },
      { code: '222222', user_id: OTHER, expires_at: '2026-11-05T03:10:00.000Z' },
    ])
    await say('/start 111111', 888)
    expect(tg.texts()[0]).toContain('không đúng hoặc đã hết hạn')
    for (let i = 0; i < 4; i++) await say(`/start 99999${i}`, 888)
    tg.clear()
    await say('/start 222222', 888)
    expect(tg.texts()[0]).toContain('quá nhiều lần')
    expect(sb.rows('telegram_links')).toHaveLength(0)
  })

  it('explains how to link to unlinked private chats and ignores groups', async () => {
    const { tg, say, press } = setup({ linked: false })
    await say('hello', 888)
    await say('/today', 888)
    expect(tg.texts()).toEqual([UNLINKED_HTML, UNLINKED_HTML])
    expect(UNLINKED_HTML).toContain('/start 123456')
    tg.clear()
    await say('hello', -100, 'group')
    expect(tg.calls).toHaveLength(0)
    await press('review:start', 888)
    expect(tg.calls).toEqual([
      { method: 'answerCallbackQuery', body: { callback_query_id: expect.any(String), text: 'Không được phép.' } },
    ])
  })
})

describe('server bot – commands', () => {
  it('routes /help, /start, unknown commands and /today with synced data in the learner time zone', async () => {
    const { tg, say, sb } = setup()
    await say('/help')
    await say('/start')
    await say('/nope')
    await say('/today')
    const [help, start, unknown, today] = tg.texts()
    for (const c of ['/today', '/review', '/word', '/quiz', '/report', '/advice', '/habits', '/plan', '/reset'])
      expect(help).toContain(c)
    expect(start).toContain('Chào bạn!')
    expect(unknown).toContain('Mình chưa biết lệnh /nope')
    expect(today).toContain('Hôm nay – Thứ 5, 05/11/2026')
    expect(today).toContain('Chuỗi: <b>4 ngày</b> (hôm nay chưa học)')
    expect(today).toContain('Kế hoạch hôm nay</b> (1/2)')
    expect(today).toContain('Airport announcements')
    expect(today).toContain('Thẻ từ cần ôn: <b>1</b>')
    expectUserScoped(sb)
  })

  it('/reset clears only this learner’s chat memory', async () => {
    const { sb, tg, say } = setup()
    sb.seed('bot_messages', [
      { user_id: USER, role: 'user', content: 'hi' },
      { user_id: OTHER, role: 'user', content: 'other' },
    ])
    await say('/reset')
    expect(sb.rows('bot_messages').map((r) => r.user_id)).toEqual([OTHER])
    expect(tg.texts()[0]).toContain('Đã xóa lịch sử')
  })
})

describe('server bot – FSRS review buttons', () => {
  it('show → rate writes review_schedules, review_logs, activity_log and xp_events sync rows', async () => {
    const { sb, tg, say, press, lastButtons, rows } = setup()
    await say('/review')
    expect(tg.texts()[0]).toContain('<b>resilient</b>')
    expect(tg.texts()[0]).toContain('còn 1 thẻ')
    const show = lastButtons().find((b) => b.text.includes('Hiện đáp án'))?.callback_data as string
    expect(show).toMatch(/^review:show:[a-z0-9]{10}$/)
    await press(show)
    const edit = tg.sent('editMessageText')[0]?.body
    expect(edit?.text).toContain('kiên cường')
    expect(edit?.text).toContain('She is resilient.')
    const rate = lastButtons()
    expect(rate.map((b) => b.callback_data)).toEqual([1, 2, 3, 4].map((r) => `${show.replace('show', 'rate')}:${r}`))
    expect(rate[2]?.text).toMatch(/🙂 Nhớ · \d+d/)
    const seqBefore = rows('review_schedules').find((r) => r.row_key === 'resilient')?.seq as number

    tg.clear()
    await press(rate[2]?.callback_data as string)
    const sched = rows('review_schedules').find((r) => r.row_key === 'resilient') as Row
    const data = sched.data as Row
    expect(data).toMatchObject({ state: 'review', reps: 3, last_review_at: NOW, vocab_id: 5, word_key: 'resilient' })
    expect(new Date(String(data.due_at)).getTime()).toBeGreaterThan(Date.parse(NOW) + 3 * 86_400_000)
    // Newer than the stored version even though that device clock was ahead, and a fresh seq for the pull cursor.
    expect(sched.client_updated_at).toBe('2026-11-06T00:00:00.001Z')
    expect(sched.seq as number).toBeGreaterThan(seqBefore)
    expect(rows('review_logs')).toEqual([
      expect.objectContaining({
        row_key: 'server:uuid-1',
        client_updated_at: NOW,
        data: expect.objectContaining({
          rating: 3,
          state_before: 'review',
          word_key: 'resilient',
          vocab_id: 5,
          reviewed_at: NOW,
        }),
      }),
    ])
    expect(rows('activity_log').filter((r) => String(r.row_key).startsWith('server:'))).toEqual([
      expect.objectContaining({
        data: expect.objectContaining({
          action: 'review_done',
          module: 'vocabulary',
          date: '2026-11-05',
          xp: 1,
          title: 'resilient',
        }),
      }),
    ])
    expect(rows('xp_events')).toEqual([
      expect.objectContaining({ data: expect.objectContaining({ amount: 1, source: 'review_done' }) }),
    ])
    expect(tg.sent('answerCallbackQuery')[0]?.body.text).toBe('Đã lưu kết quả ôn tập')
    expect(tg.sent('editMessageText')[0]?.body.text).toContain('✅ <b>resilient</b> – 🙂 Nhớ')
    expect(tg.sent('sendMessage')[0]?.body.text).toContain('Không còn thẻ nào cần ôn')

    // Double tap: the pending card is gone → no second review.
    tg.clear()
    await press(rate[2]?.callback_data as string)
    expect(tg.sent('answerCallbackQuery')[0]?.body.text).toBe('Thẻ này đã được chấm rồi.')
    expect(rows('review_logs')).toHaveLength(1)
    expectUserScoped(sb)
  })

  it('stop and expired buttons', async () => {
    const { tg, press } = setup()
    await press('review:stop')
    expect(tg.sent('editMessageText')[0]?.body.text).toContain('Đã dừng ôn thẻ')
    await press('whatever:1')
    expect(tg.sent('answerCallbackQuery')[1]?.body.text).toBe('Nút này đã hết hạn.')
  })
})

describe('server bot – words, quiz and tutor', () => {
  const WORD = {
    word: 'mitigate',
    ipa: '/ˈmɪtɪɡeɪt/',
    pos: 'verb',
    meaningVi: 'giảm nhẹ',
    meaningEn: 'to make less severe',
    examples: ['Trees mitigate heat.', 'We must mitigate the risks.'],
    collocations: ['mitigate the impact'],
    tipVi: 'Hay dùng trong Writing Task 2.',
    cefr: 'C1',
  }

  it('/word saves the word as vocabulary + a new FSRS card; the AI call counts against the quota', async () => {
    const { sb, tg, ai, say, press, lastButtons, rows } = setup()
    ai.push(WORD)
    await say('/word')
    expect(tg.texts()[0]).toContain('<b>mitigate</b>')
    expect(ai.inputs[0]?.messages[0]?.content).toContain('resilient') // avoid list = saved words
    const save = lastButtons().find((b) => b.text.includes('Lưu'))?.callback_data as string
    await press(save)
    const v = rows('vocabulary').find((r) => r.row_key === 'mitigate')?.data as Row
    expect(v).toMatchObject({ word: 'mitigate', word_key: 'mitigate', meaning_vi: 'giảm nhẹ', source_ref: 'telegram' })
    expect(JSON.parse(String(v.examples))).toEqual(WORD.examples)
    expect(rows('review_schedules').find((r) => r.row_key === 'mitigate')?.data).toMatchObject({
      state: 'new',
      reps: 0,
      word_key: 'mitigate',
    })
    expect(tg.sent('answerCallbackQuery')[0]?.body.text).toContain('Đã lưu “mitigate”')
    await press(save)
    expect(tg.sent('answerCallbackQuery')[1]?.body.text).toContain('đã có trong kho từ')
    expect(sb.rows('ai_usage')).toEqual([expect.objectContaining({ user_id: USER, day: '2026-11-05', requests: 1 })])
  })

  it('/word falls back to built-in words without AI', async () => {
    const { tg, say } = setup({ ai: false })
    await say('/word')
    expect(tg.texts()[0]).toContain('Từ của ngày')
    expect(tg.texts()[0]).toContain('Từ có sẵn')
    expect(tg.texts()[0]).not.toContain('<b>resilient</b>')
  })

  it('/quiz targets the weakest skill and records the answer', async () => {
    const { tg, ai, say, press, lastButtons, rows } = setup()
    ai.push({
      passage: null,
      question: 'Yesterday I ___ to the library.',
      options: ['go', 'went', 'have gone', 'am going'],
      answerIndex: 1,
      explanationVi: 'Có "Yesterday" nên dùng quá khứ đơn.',
      topic: 'past simple',
    })
    await say('/quiz')
    expect(tg.texts()[0]).toContain('Quiz nhanh</b> · Ngữ pháp')
    expect(ai.inputs[0]?.system).toContain('past simple with past time markers')
    const b = lastButtons().find((x) => x.text === 'B')?.callback_data as string
    await press(b)
    expect(tg.sent('editMessageText')[0]?.body.text).toContain('Chính xác!')
    const act = rows('activity_log').find((r) => String(r.row_key).startsWith('server:'))?.data as Row
    expect(act).toMatchObject({ action: 'grammar_done', score: 1, skill: 'grammar', xp: 18 })
    await press(b)
    expect(tg.sent('answerCallbackQuery')[1]?.body.text).toContain('hết hạn')
  })

  it('free text goes to the tutor with learner context and the last 20 messages of memory', async () => {
    const { sb, tg, ai, say, rows } = setup()
    const answer = {
      reply: 'Câu của bạn gần đúng rồi!',
      corrections: [
        {
          original: 'go',
          correction: 'went',
          explanationVi: 'Quá khứ đơn.',
          category: 'grammar',
          pattern: 'past simple',
        },
      ],
      newWords: [{ word: 'library', ipa: '/ˈlaɪbrəri/', meaningVi: 'thư viện', example: 'I went to the library.' }],
      pronunciationTips: [],
      correctedSentence: null,
    }
    ai.push(answer, { ...answer, corrections: [], reply: 'Tốt lắm!' })
    await say('Yesterday I go to the library')
    const first = tg.texts()[0] as string
    expect(first).toContain('<s>go</s> → <b>went</b>')
    expect(first).toContain('📌 <b>Từ mới</b>')
    expect(ai.inputs[0]?.system).toContain('Flashcards due now: 1.')
    expect(ai.inputs[0]?.system).toContain('Latest coach report (week 2026-W44)')
    expect(sb.rows('bot_messages').map((m) => m.role)).toEqual(['user', 'assistant'])
    await say('Thanks!')
    expect(ai.inputs[1]?.messages.map((m) => m.role)).toEqual(['user', 'assistant', 'user'])
    expect(ai.inputs[1]?.messages[0]?.content).toBe('Yesterday I go to the library')
    expect(rows('activity_log').filter((r) => (r.data as Row).action === 'tutor_message')).toHaveLength(2)
    expectUserScoped(sb)
  })

  it('keeps at most 40 stored messages and sends only the last 20 to the AI', async () => {
    const { sb, ai, say } = setup()
    sb.seed(
      'bot_messages',
      Array.from({ length: 45 }, (_, i) => ({ user_id: USER, role: i % 2 ? 'assistant' : 'user', content: `m${i}` })),
    )
    ai.push({ reply: 'ok' })
    await say('next')
    expect(ai.inputs[0]?.messages.length).toBeLessThanOrEqual(21)
    expect(ai.inputs[0]?.messages[0]?.role).toBe('user')
    expect(sb.rows('bot_messages').filter((m) => m.user_id === USER)).toHaveLength(40)
  })

  it('stops at the daily AI limit without calling the model', async () => {
    const { sb, tg, ai, say } = setup({ limit: 2 })
    sb.seed('ai_usage', [{ user_id: USER, day: '2026-11-05', requests: 2 }])
    await say('Can you help me?')
    expect(ai.inputs).toHaveLength(0)
    expect(tg.texts()[0]).toContain('hết 2 lượt AI')
  })

  it('photos go to Gemini vision, voice messages as inline audio with transcript feedback', async () => {
    const { tg, ai, send, rows } = setup()
    tg.files.set('files/ph-big', new Uint8Array([1, 2, 3]))
    tg.files.set('files/voice1', new Uint8Array([9, 9]))
    ai.push({ reply: 'Bài viết tốt!' })
    await send({
      photo: [
        { file_id: 'ph-small', width: 90, height: 90 },
        { file_id: 'ph-big', width: 900, height: 900 },
      ],
      caption: 'check my essay',
    })
    expect(ai.inputs[0]?.image).toEqual({ data: new Uint8Array([1, 2, 3]), mimeType: 'image/jpeg' })
    expect(ai.inputs[0]?.messages.at(-1)?.content).toBe('check my essay')
    expect(tg.texts()[0]).toContain('Bài viết tốt!')

    ai.push({
      reply: 'Nghe ổn!',
      transcript: 'I go to school yesterday',
      corrections: [{ original: 'go', correction: 'went', explanationVi: '', category: 'grammar' }],
      pronunciationTips: ['school /skuːl/'],
      correctedSentence: 'I went to school yesterday.',
    })
    await send({ voice: { file_id: 'voice1', duration: 30, mime_type: 'audio/ogg' } })
    expect(ai.inputs[1]?.audio).toEqual({ data: new Uint8Array([9, 9]), mimeType: 'audio/ogg' })
    expect(ai.inputs[1]?.system).toContain('VOICE MESSAGE')
    const text = tg.texts()[1] as string
    expect(text).toContain('Mình nghe được:</b> <i>I go to school yesterday</i>')
    expect(text).toContain('Câu nên nói:</b> I went to school yesterday.')
    expect(
      rows('activity_log').some((r) => (r.data as Row).action === 'speaking_done' && (r.data as Row).minutes === 0.5),
    ).toBe(true)
  })

  it('AI failures produce a friendly message', async () => {
    const { tg, ai, say } = setup()
    ai.push('not json', 'still not json')
    await say('hello there')
    expect(tg.texts()[0]).toContain('AI trả lời không hợp lệ')
  })
})

describe('server bot – coach commands', () => {
  it('/report tuan, /habits and the advice button', async () => {
    const { tg, ai, say, press, lastButtons } = setup({ ai: false })
    await say('/report tuần')
    expect(tg.texts()[0]).toContain('📊 Tuần 45 · 02/11–08/11</b> · offline')
    expect(tg.texts()[0]).toContain('Học: <b>47 phút</b> · 3/4 ngày')
    const advice = lastButtons()[0]?.callback_data as string
    await press(advice)
    expect(tg.texts()[1]).toContain('🧠 Lời khuyên – Tuần 45')
    await say('/habits')
    expect(tg.texts()[2]).toContain('📈 Thói quen học')
    expect(tg.texts()[2]).toContain('28 ngày qua')
    expect(ai.inputs).toHaveLength(0)
  })
})

describe('telegram-bot webhook handler', () => {
  const env = readEnv(
    (k) =>
      ({
        SUPABASE_URL,
        SUPABASE_SERVICE_ROLE_KEY: SERVICE_KEY,
        TELEGRAM_BOT_TOKEN: '123456:TEST_TOKEN_abcdefghijklmnopqrstuvwxyz',
        TELEGRAM_WEBHOOK_SECRET: 'hook-secret-123',
      })[k],
  )

  it('requires the secret header and answers 200 for handled updates', async () => {
    const sb = new FakePostgrest()
    const tg = new FakeTelegramApi()
    const fetchImpl = combinedFetch(sb, tg)
    sb.seed('telegram_links', [{ user_id: USER, chat_id: CHAT }])
    sb.seed('sync_rows', [syncRow(USER, 'user_profile', 'singleton', { display_name: 'Lan' })])
    const update = {
      update_id: 1,
      message: { message_id: 1, chat: { id: CHAT, type: 'private' }, date: 0, text: '/help' },
    }
    const post = (headers: Record<string, string>) =>
      new Request('https://x/functions/v1/telegram-bot', { method: 'POST', headers, body: JSON.stringify(update) })
    expect((await handleTelegramWebhook(post({}), env, { fetchImpl })).status).toBe(401)
    expect(
      (await handleTelegramWebhook(post({ 'x-telegram-bot-api-secret-token': 'wrong' }), env, { fetchImpl })).status,
    ).toBe(401)
    expect((await handleTelegramWebhook(new Request('https://x', { method: 'GET' }), env, { fetchImpl })).status).toBe(
      405,
    )
    expect(tg.calls).toHaveLength(0)
    const ok = await handleTelegramWebhook(post({ 'x-telegram-bot-api-secret-token': 'hook-secret-123' }), env, {
      fetchImpl,
      services: { ai: null },
    })
    expect(ok.status).toBe(200)
    expect(tg.texts()[0]).toContain('Lệnh / Commands')
    // Missing secrets → 500 with the names (never the values).
    const res = await handleTelegramWebhook(
      post({}),
      readEnv(() => undefined),
      { fetchImpl },
    )
    expect(res.status).toBe(500)
    expect(await res.json()).toMatchObject({ missing: expect.arrayContaining(['telegramToken', 'webhookSecret']) })
  })

  it('still answers 200 when handling fails (no Telegram retry storm)', async () => {
    const sb = new FakePostgrest()
    const tg = new FakeTelegramApi()
    sb.failNext = { table: 'telegram_links', status: 500 }
    const logs: string[] = []
    const res = await handleTelegramWebhook(
      new Request('https://x', {
        method: 'POST',
        headers: { 'x-telegram-bot-api-secret-token': 'hook-secret-123' },
        body: JSON.stringify({
          update_id: 9,
          message: { message_id: 1, chat: { id: 1, type: 'private' }, date: 0, text: 'hi' },
        }),
      }),
      env,
      { fetchImpl: combinedFetch(sb, tg), log: (m) => logs.push(m) },
    )
    expect(res.status).toBe(200)
    expect(logs[0]).toContain('update 9 failed')
    expect(logs.join(' ')).not.toContain('TEST_TOKEN')
  })
})
