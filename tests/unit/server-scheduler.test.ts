// Server notification scheduler: due items in the learner's time zone, notification_log de-duplication (also for
// overlapping runs), evening reminder skipped after studying, reports from synced rows, catch-up and HTTP auth.
import { describe, expect, it } from 'vitest'
import { handleScheduler, readEnv } from '../../supabase/functions/_shared/handlers'
import { AiQuota } from '../../supabase/functions/_shared/quota'
import { SupabaseRest } from '../../supabase/functions/_shared/rest'
import { runScheduler } from '../../supabase/functions/_shared/scheduler'
import { TelegramBot } from '../../supabase/functions/_shared/telegram'
import {
  activity,
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
} from '../helpers/fakeEdge'

function setup(opts: { ai?: boolean; schedules?: unknown; linked?: boolean } = {}) {
  const sb = new FakePostgrest()
  const tg = new FakeTelegramApi()
  const ai = new FakeAi()
  const fetch = combinedFetch(sb, tg)
  const rest = new SupabaseRest(SUPABASE_URL, SERVICE_KEY, fetch)
  sb.seed('profiles', [{ user_id: USER, timezone: TZ }])
  sb.seed('notification_schedules', [
    { user_id: USER, data: opts.schedules ?? { version: 1, schedules: {}, reminderTime: '20:00' } },
  ])
  if (opts.linked !== false) sb.seed('telegram_links', [{ user_id: USER, chat_id: CHAT }])
  sb.seed('sync_rows', learnerFixture())
  const run = (iso: string) =>
    runScheduler({
      rest,
      tg: new TelegramBot('123456:TEST_TOKEN_abcdefghijklmnopqrstuvwxyz', fetch),
      ai: opts.ai ? ai : null,
      quota: new AiQuota(rest, 100),
      now: () => new Date(iso),
    })
  return { sb, tg, ai, run, fetch }
}

describe('server scheduler', () => {
  it('sends the morning brief at 07:00 local once and records it in notification_log', async () => {
    const { sb, tg, run } = setup()
    expect((await run('2026-11-04T23:58:00.000Z')).runs).toEqual([]) // 06:58 in Vietnam
    const res = await run('2026-11-05T00:01:00.000Z')
    expect(res.runs).toEqual([
      expect.objectContaining({ kind: 'morningBrief', key: '2026-11-05', result: 'sent', catchUp: false }),
    ])
    const msg = tg.sent()[0]?.body
    expect(msg?.chat_id).toBe(CHAT)
    expect(String(msg?.text)).toContain('☀️ Chào buổi sáng!')
    expect(String(msg?.text)).toContain('Chào buổi sáng, Lan!')
    expect(String(msg?.text)).toContain('Hôm qua bạn học 12 phút')
    expect(String(msg?.text)).toContain('Kế hoạch hôm nay: Airport announcements')
    expect(sb.rows('notification_log')).toEqual([
      expect.objectContaining({ user_id: USER, kind: 'morningBrief', period_key: '2026-11-05' }),
    ])
    tg.clear()
    expect((await run('2026-11-05T00:06:00.000Z')).runs).toEqual([])
    expect(tg.calls).toHaveLength(0)
  })

  it('never double-sends when two runs overlap', async () => {
    const { tg, run } = setup()
    const [a, b] = await Promise.all([run('2026-11-05T00:01:00.000Z'), run('2026-11-05T00:01:30.000Z')])
    const results = [...a.runs, ...b.runs].map((r) => r.result)
    expect(results.filter((r) => r === 'sent')).toHaveLength(1)
    expect(tg.sent()).toHaveLength(1)
  })

  it('skips the evening reminder when the learner already studied today (e.g. on Telegram)', async () => {
    const { sb, tg, run } = setup()
    sb.seed('notification_log', [
      { user_id: USER, kind: 'morningBrief', period_key: '2026-11-05', sent_at: '2026-11-05T00:01:00.000Z' },
    ])
    sb.seed('sync_rows', [
      syncRow(
        USER,
        'activity_log',
        'server:x',
        activity('2026-11-05T12:00:00.000Z', '2026-11-05', 'vocabulary', 'review_done', 1),
      ),
    ])
    const res = await run('2026-11-05T13:02:00.000Z') // 20:02
    expect(res.runs).toEqual([expect.objectContaining({ kind: 'eveningReminder', result: 'skipped' })])
    expect(tg.calls).toHaveLength(0)
    expect(sb.rows('notification_log').map((r) => r.kind)).toContain('eveningReminder')
  })

  it('sends the evening reminder with an AI text when the learner has not studied', async () => {
    const { sb, tg, ai, run } = setup({ ai: true })
    sb.seed('notification_log', [
      { user_id: USER, kind: 'morningBrief', period_key: '2026-11-05', sent_at: '2026-11-05T00:01:00.000Z' },
    ])
    ai.push('Bạn thường học lúc 20:00 – 15 phút luyện nghe tối nay nhé?')
    await run('2026-11-05T13:02:00.000Z')
    const text = String(tg.sent()[0]?.body.text)
    expect(text).toContain('⏰ Nhắc học')
    expect(text).toContain('15 phút luyện nghe')
    expect(ai.inputs[0]?.system).toContain('has not studied today')
    expect(sb.rows('ai_usage')).toEqual([expect.objectContaining({ requests: 1, day: '2026-11-05' })])
  })

  it('daily report at 21:30 is built from the synced rows (offline advice without AI)', async () => {
    const { sb, tg, run } = setup()
    sb.seed('notification_log', [
      { user_id: USER, kind: 'morningBrief', period_key: '2026-11-04', sent_at: '2026-11-04T00:01:00.000Z' },
      { user_id: USER, kind: 'eveningReminder', period_key: '2026-11-04', sent_at: '2026-11-04T13:01:00.000Z' },
    ])
    const res = await run('2026-11-04T14:31:00.000Z') // Wednesday 21:31
    expect(res.runs.map((r) => `${r.kind}:${r.result}`)).toEqual(['dailyReport:sent'])
    const text = String(tg.sent()[0]?.body.text)
    expect(text).toContain('📊 Ngày 04/11/2026</b> · offline')
    expect(text).toContain('Học: <b>12 phút</b> · 1/1 ngày')
    const markup = tg.sent()[0]?.body.reply_markup as { inline_keyboard: { callback_data: string }[][] }
    expect(markup.inline_keyboard[0]?.[0]?.callback_data).toMatch(/^coach:advice:[a-z0-9]{10}$/)
    expect(sb.rows('bot_pending')).toEqual([expect.objectContaining({ kind: 'report', user_id: USER })])
  })

  it('catches up the weekly and monthly reports on Monday (missed on Sunday / the 1st)', async () => {
    const { tg, run } = setup()
    const res = await run('2026-11-02T03:00:00.000Z') // Monday 10:00
    const map = Object.fromEntries(res.runs.map((r) => [r.kind, r]))
    expect(map.weeklyReport).toMatchObject({ key: '2026-W44', catchUp: true, result: 'sent' })
    expect(map.monthlyReport).toMatchObject({ key: '2026-10', catchUp: true, result: 'sent' })
    const texts = tg.sent().map((c) => String(c.body.text))
    expect(texts.some((t) => t.includes('Tuần 44 · 26/10–01/11'))).toBe(true)
    expect(texts.some((t) => t.includes('Tháng 10/2026'))).toBe(true)
  })

  it('ignores users without a linked chat or with Telegram turned off for a schedule', async () => {
    const a = setup({ linked: false })
    expect(await a.run('2026-11-05T00:01:00.000Z')).toEqual({ users: 0, runs: [] })
    const b = setup({ schedules: { schedules: { morningBrief: { channels: { app: true, telegram: false } } } } })
    expect((await b.run('2026-11-05T00:01:00.000Z')).runs).toEqual([])
  })

  it('uses the learner time zone from profiles (fallback: the zone pushed by the desktop)', async () => {
    const { sb, tg, run } = setup({ schedules: { schedules: {}, timezone: 'America/New_York' } })
    sb.tables.set('profiles', [])
    await run('2026-11-05T12:01:00.000Z') // 07:01 in New York
    expect(String(tg.sent()[0]?.body.text)).toContain('Chào buổi sáng')
    expect(sb.rows('notification_log')[0]).toMatchObject({ period_key: '2026-11-05' })
  })

  it('removes stale button data and keeps other users untouched', async () => {
    const { sb, run } = setup()
    sb.seed('bot_pending', [
      { id: 'old', user_id: OTHER, kind: 'quiz', data: {}, created_at: '2026-11-01T00:00:00.000Z' },
      { id: 'new', user_id: OTHER, kind: 'quiz', data: {}, created_at: '2026-11-04T23:00:00.000Z' },
    ])
    await run('2026-11-05T00:01:00.000Z')
    expect(sb.rows('bot_pending').map((r) => r.id)).toEqual(['new'])
  })
})

describe('scheduler HTTP handler', () => {
  it('requires the shared secret', async () => {
    const { fetch } = setup()
    const env = readEnv(
      (k) =>
        ({
          SUPABASE_URL,
          SUPABASE_SERVICE_ROLE_KEY: SERVICE_KEY,
          TELEGRAM_BOT_TOKEN: '123456:TEST_TOKEN_abcdefghijklmnopqrstuvwxyz',
          SCHEDULER_SECRET: 'cron-secret-xyz',
        })[k],
    )
    const req = (headers: Record<string, string>) =>
      new Request('https://x/functions/v1/scheduler', { method: 'POST', headers, body: '{}' })
    expect((await handleScheduler(req({}), env, { fetchImpl: fetch })).status).toBe(401)
    const ok = await handleScheduler(req({ 'x-scheduler-secret': 'cron-secret-xyz' }), env, {
      fetchImpl: fetch,
      services: { ai: null },
      now: () => new Date('2026-11-05T00:01:00.000Z'),
    })
    expect(ok.status).toBe(200)
    expect(await ok.json()).toEqual({ ok: true, users: 1, sent: 1 })
    const bearer = await handleScheduler(req({ authorization: 'Bearer cron-secret-xyz' }), env, {
      fetchImpl: fetch,
      services: { ai: null },
    })
    expect(bearer.status).toBe(200)
  })
})
