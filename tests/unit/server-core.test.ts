// Server building blocks: per-user daily AI quota, the user-scoped REST helper, the Gemini request format
// (JSON mode, inline image/audio, error mapping), the Telegram client and FSRS on synced rows.
import { describe, expect, it } from 'vitest'
import { AiError, Gemini, generateJson, InvalidOutput } from '../../supabase/functions/_shared/gemini'
import { AiQuota, DailyLimitError, parseLimit } from '../../supabase/functions/_shared/quota'
import { SupabaseRest } from '../../supabase/functions/_shared/rest'
import { newScheduleRow, previewRow, reviewRow, sortDue, type ScheduleRow } from '../../supabase/functions/_shared/srs'
import { TelegramBot } from '../../supabase/functions/_shared/telegram'
import { FakeAi, FakePostgrest, FakeTelegramApi, OTHER, SERVICE_KEY, SUPABASE_URL, USER } from '../helpers/fakeEdge'

describe('daily AI quota', () => {
  it('counts per user and day and stops at the limit', async () => {
    const sb = new FakePostgrest()
    const rest = new SupabaseRest(SUPABASE_URL, SERVICE_KEY, sb.fetch)
    const q = new AiQuota(rest, 2)
    expect(await q.consume(USER, '2026-11-05')).toBe(1)
    expect(await q.consume(USER, '2026-11-05')).toBe(2)
    await expect(q.consume(USER, '2026-11-05')).rejects.toBeInstanceOf(DailyLimitError)
    expect(await q.consume(USER, '2026-11-06')).toBe(1)
    expect(await q.consume(OTHER, '2026-11-05')).toBe(1)
    expect(sb.rows('ai_usage')).toHaveLength(3)
    const ai = new FakeAi().push('a', 'b')
    const metered = q.metered(ai, OTHER, '2026-11-05')
    expect(await metered.generate({ system: '', messages: [] })).toBe('a')
    await expect(metered.generate({ system: '', messages: [] })).rejects.toBeInstanceOf(DailyLimitError)
    expect(ai.inputs).toHaveLength(1)
    expect(new DailyLimitError(100).userMessage).toContain('100 lượt AI')
  })

  it('reads AI_DAILY_LIMIT with a default of 100', () => {
    expect(parseLimit(undefined)).toBe(100)
    expect(parseLimit('25')).toBe(25)
    expect(parseLimit('abc')).toBe(100)
    expect(parseLimit('-1')).toBe(100)
  })
})

describe('user-scoped REST helper', () => {
  it('adds user_id to every filter and every inserted row, uses the service key', async () => {
    const sb = new FakePostgrest()
    const rest = new SupabaseRest(`${SUPABASE_URL}/`, SERVICE_KEY, sb.fetch)
    const u = rest.forUser(USER)
    await u.insert('bot_messages', [{ role: 'user', content: 'x', user_id: OTHER }])
    await u.select('bot_messages', [['user_id', `eq.${OTHER}`]])
    await u.update('bot_messages', [['role', 'eq.user']], { content: 'y', user_id: OTHER })
    await u.remove('bot_messages')
    const [ins, sel, upd, del] = sb.calls
    expect((ins?.body as { user_id: string }[])[0]?.user_id).toBe(USER)
    expect(sel?.params.getAll('user_id')).toEqual([`eq.${USER}`])
    expect(upd?.params.get('user_id')).toBe(`eq.${USER}`)
    expect(upd?.body).toEqual({ content: 'y' })
    expect(del?.params.get('user_id')).toBe(`eq.${USER}`)
    expect(sb.calls.every((c) => c.auth === `Bearer ${SERVICE_KEY}`)).toBe(true)
    expect(() => rest.forUser('not-a-uuid')).toThrow()
    await expect(rest.remove('bot_messages', [])).rejects.toThrow(/without filter/)
  })
})

describe('Gemini client', () => {
  it('sends JSON mode, the system prompt, history roles and inline media', async () => {
    const seen: { url: string; headers: Headers; body: Record<string, unknown> }[] = []
    const fetchImpl = async (url: string, init?: RequestInit) => {
      seen.push({ url, headers: new Headers(init?.headers), body: JSON.parse(String(init?.body)) })
      return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: '{"ok":true}' }] } }] }), {
        status: 200,
      })
    }
    const g = new Gemini('AIza-test-key', 'gemini-2.5-flash', fetchImpl)
    const out = await g.generate({
      system: 'SYS',
      messages: [
        { role: 'user', content: 'hi' },
        { role: 'assistant', content: 'hello' },
        { role: 'user', content: 'look' },
      ],
      image: { data: new Uint8Array([104, 105]), mimeType: 'image/png' },
      audio: { data: new Uint8Array([1]), mimeType: 'audio/ogg' },
      json: true,
    })
    expect(out).toBe('{"ok":true}')
    const req = seen[0]!
    expect(req.url).toBe('https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent')
    expect(req.headers.get('x-goog-api-key')).toBe('AIza-test-key')
    expect(req.url).not.toContain('AIza')
    expect(req.body.systemInstruction).toEqual({ parts: [{ text: 'SYS' }] })
    const contents = req.body.contents as { role: string; parts: Record<string, unknown>[] }[]
    expect(contents.map((c) => c.role)).toEqual(['user', 'model', 'user'])
    expect(contents[2]?.parts).toEqual([
      { text: 'look' },
      { inlineData: { mimeType: 'image/png', data: 'aGk=' } },
      { inlineData: { mimeType: 'audio/ogg', data: 'AQ==' } },
    ])
    expect((req.body.generationConfig as Record<string, unknown>).responseMimeType).toBe('application/json')
  })

  it('maps HTTP errors and safety blocks to AiError codes', async () => {
    const answer = (status: number, body: unknown) => async () => new Response(JSON.stringify(body), { status })
    const code = async (g: Gemini) => {
      try {
        await g.generate({ system: '', messages: [{ role: 'user', content: 'x' }] })
        return 'none'
      } catch (err) {
        return err instanceof AiError ? err.code : 'other'
      }
    }
    expect(await code(new Gemini('k', 'm', answer(429, { error: { message: 'Quota exceeded' } })))).toBe('quota')
    expect(await code(new Gemini('k', 'm', answer(429, { error: { message: 'slow down' } })))).toBe('rate_limited')
    expect(await code(new Gemini('k', 'm', answer(400, { error: { message: 'API key not valid' } })))).toBe(
      'invalid_key',
    )
    expect(await code(new Gemini('k', 'm', answer(503, {})))).toBe('server')
    expect(await code(new Gemini('k', 'm', answer(200, { promptFeedback: { blockReason: 'SAFETY' } })))).toBe(
      'safety_blocked',
    )
    expect(await code(new Gemini('', 'm', answer(200, {})))).toBe('no_key')
  })

  it('generateJson strips code fences and repairs once', async () => {
    const ai = new FakeAi().push('```json\n{"a":1}\n```')
    expect(await generateJson(ai, { system: '', messages: [{ role: 'user', content: 'q' }] }, (raw) => raw)).toEqual({
      a: 1,
    })
    const ai2 = new FakeAi().push('{"a":0}', '{"a":2}')
    const v = (raw: unknown) => {
      if ((raw as { a: number }).a < 1) throw new InvalidOutput('a must be ≥ 1.')
      return raw
    }
    expect(await generateJson(ai2, { system: '', messages: [{ role: 'user', content: 'q' }] }, v)).toEqual({ a: 2 })
    expect(ai2.inputs[1]?.messages.at(-1)?.content).toContain('a must be ≥ 1.')
  })
})

describe('Telegram client', () => {
  it('sends HTML with an inline keyboard, splits long messages and downloads files', async () => {
    const tg = new FakeTelegramApi()
    const bot = new TelegramBot('123456:TEST_TOKEN_abcdefghijklmnopqrstuvwxyz', tg.fetch)
    await bot.sendMessage(1, '<b>hi</b>', [
      [
        { text: 'A', data: 'quiz:a:x:0' },
        { text: 'too long', data: 'x'.repeat(65) },
      ],
    ])
    expect(tg.calls[0]?.body).toMatchObject({
      chat_id: 1,
      text: '<b>hi</b>',
      parse_mode: 'HTML',
      reply_markup: { inline_keyboard: [[{ text: 'A', callback_data: 'quiz:a:x:0' }]] },
    })
    tg.clear()
    await bot.sendMessage(1, `${'line\n'.repeat(1200)}`, [[{ text: 'B', data: 'b' }]])
    expect(tg.calls.length).toBeGreaterThan(1)
    expect(tg.calls.at(-1)?.body.reply_markup).toBeDefined()
    expect(tg.calls[0]?.body.reply_markup).toBeUndefined()
    tg.files.set('files/f1', new Uint8Array([7, 8]))
    expect([...(await bot.download('f1'))]).toEqual([7, 8])
  })
})

describe('FSRS on synced review_schedules rows', () => {
  const now = new Date('2026-11-05T03:00:00.000Z')
  it('reviews a new card into learning steps and keeps extra columns', () => {
    const row = { ...newScheduleRow('mitigate', now), vocab_id: 9 }
    expect(previewRow(row, now)).toEqual({ 1: '1m', 2: '6m', 3: '10m', 4: expect.stringMatching(/d$/) })
    const { next, log } = reviewRow(row, 3, now, 4000)
    expect(next).toMatchObject({
      state: 'learning',
      vocab_id: 9,
      word_key: 'mitigate',
      reps: 1,
      last_review_at: now.toISOString(),
    })
    expect(new Date(next.due_at).getTime() - now.getTime()).toBe(10 * 60_000)
    expect(log).toMatchObject({ rating: 3, state_before: 'new', elapsed_days: 0, duration_ms: 4000 })
  })

  it('orders due cards like the desktop (reviews before new cards, oldest first)', () => {
    const base = newScheduleRow('a', now)
    const rows: ScheduleRow[] = [
      { ...base, word_key: 'new-old', due_at: '2026-11-01T00:00:00.000Z' },
      { ...base, word_key: 'rev-late', state: 'review', due_at: '2026-11-04T00:00:00.000Z' },
      { ...base, word_key: 'rev-early', state: 'review', due_at: '2026-11-02T00:00:00.000Z' },
      { ...base, word_key: 'future', state: 'review', due_at: '2026-11-09T00:00:00.000Z' },
    ]
    expect(sortDue(rows, now).map((r) => r.word_key)).toEqual(['rev-early', 'rev-late', 'new-old'])
  })
})
