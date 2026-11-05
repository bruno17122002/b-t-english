// Desktop side of "Bot chạy trên server": mode switch (local polling and sending stop), link status from
// telegram_links, pairing codes via RPC create_link_code, unlinking, and pushing the coach schedules to
// notification_schedules on mode switch / sign-in / change – all against a fake Supabase (fake fetch).
import { describe, expect, it, vi } from 'vitest'
import type { TelegramLinkCode, TelegramServerStatus, TelegramStatus } from '../../src/shared/telegram'
import { TELEGRAM_FLAGS } from '../../src/main/kernel/telegram/legacy'
import type { TelegramService } from '../../src/main/kernel/telegram/service'
import { makeApp } from '../helpers/kernel'

const URL_ = 'https://tgsrv.supabase.co'
const ANON = 'anon-key-telegram-server-tests-0123456789'
const UID = '33333333-3333-4333-8333-333333333333'
const EMAIL = 'lan@example.com'
const BOT_TOKEN = '123456789:AAHfakeTokenForServerModeTest_abcdef'

interface Req {
  method: string
  path: string
  search: string
  headers: Headers
  body: unknown
}

/** Just enough Supabase for the Telegram settings page: OTP sign-in, telegram_links, link codes, schedules. */
class FakeCloudServer {
  readonly requests: Req[] = []
  readonly telegramCalls: string[] = []
  links: { user_id: string; chat_id: number; username: string | null; linked_at: string }[] = []
  schedules = new Map<string, { data: Record<string, unknown>; updated_at: string }>()
  down = false
  private nextCode = 123456

  readonly fetch = async (input: string | URL | Request, init: RequestInit = {}): Promise<Response> => {
    const url = new URL(String(input))
    if (url.hostname === 'api.telegram.org') {
      this.telegramCalls.push(url.pathname)
      return new Response(JSON.stringify({ ok: true, result: [] }), { status: 200 })
    }
    const headers = new Headers(init.headers)
    const body = typeof init.body === 'string' ? (JSON.parse(init.body) as unknown) : undefined
    const method = (init.method ?? 'GET').toUpperCase()
    this.requests.push({ method, path: url.pathname, search: url.search, headers, body })
    if (this.down) throw new TypeError('fetch failed')
    const json = (status: number, b?: unknown) => new Response(b === undefined ? null : JSON.stringify(b), { status })
    if (url.pathname === '/auth/v1/otp') return json(200, {})
    if (url.pathname === '/auth/v1/verify')
      return json(200, {
        access_token: 'acc-1',
        refresh_token: 'ref-1',
        expires_in: 3600,
        user: { id: UID, email: EMAIL },
      })
    if (headers.get('authorization') !== 'Bearer acc-1') return json(401, { message: 'JWT expired' })
    const uidFilter = url.searchParams.get('user_id')
    switch (`${method} ${url.pathname}`) {
      case 'GET /rest/v1/telegram_links':
        return json(
          200,
          this.links.filter((l) => l.user_id === UID),
        ) // RLS: own row only
      case 'DELETE /rest/v1/telegram_links':
        if (uidFilter === `eq.${UID}`) this.links = this.links.filter((l) => l.user_id !== UID)
        return json(204)
      case 'POST /rest/v1/rpc/create_link_code':
        return json(200, String(this.nextCode++))
      case 'POST /rest/v1/notification_schedules': {
        const [row] = body as { user_id: string; data: Record<string, unknown>; updated_at: string }[]
        if (!row || row.user_id !== UID) return json(403, { message: 'row-level security' })
        this.schedules.set(row.user_id, { data: row.data, updated_at: row.updated_at })
        return json(201)
      }
      case 'DELETE /rest/v1/notification_schedules':
        if (uidFilter === `eq.${UID}`) this.schedules.delete(UID)
        return json(204)
      default:
        return json(404, { message: 'not found' })
    }
  }

  count(method: string, path: string) {
    return this.requests.filter((r) => r.method === method && r.path === path).length
  }
}

async function setup(opts: { signIn?: boolean } = {}) {
  const server = new FakeCloudServer()
  const app = await makeApp({
    telegram: 'real',
    fetchImpl: server.fetch,
    now: () => new Date('2026-11-05T03:00:00.000Z'),
  })
  const svc = app.kernel.telegram as TelegramService
  app.kernel.cloud.configure(URL_, ANON)
  const signIn = async () => {
    await app.kernel.cloud.sendCode(EMAIL)
    await app.kernel.cloud.verifyCode(EMAIL, '123456')
  }
  if (opts.signIn !== false) await signIn()
  server.requests.length = 0
  return { ...app, server, svc, signIn }
}

describe('Telegram server mode – status and mode switch', () => {
  it('defaults to local mode; signed out, the server status needs no network', async () => {
    const { call, server } = await setup({ signIn: false })
    const st = await call<TelegramServerStatus>('telegram:serverStatus')
    expect(st).toEqual({
      mode: 'local',
      cloud: { configured: true, signedIn: false, email: null },
      linked: false,
      link: null,
      serverBot: null,
      schedulesPushedAt: null,
      error: null,
    })
    expect((await call<TelegramStatus>('telegram:status')).mode).toBe('local')
    expect(server.requests).toHaveLength(0)
    await expect(call('telegram:createLinkCode')).rejects.toMatchObject({
      ipc: { code: 'cloud_not_signed_in', hint: 'account-settings' },
    })
    await expect(call('telegram:pushSchedules')).rejects.toMatchObject({ ipc: { code: 'cloud_not_signed_in' } })
  })

  it('switching to server mode stops local polling/sending and pushes the schedules; back to local removes them', async () => {
    const { call, server, svc, kernel } = await setup()
    kernel.keys.set('telegram', BOT_TOKEN)
    kernel.settings.setFlag(TELEGRAM_FLAGS.chatId, '777')
    expect(svc.isConnected()).toBe(true)

    const st = await call<TelegramServerStatus>('telegram:setMode', { mode: 'server', serverBot: '@lq_server_bot' })
    expect(st).toMatchObject({ mode: 'server', serverBot: 'lq_server_bot', cloud: { signedIn: true, email: EMAIL } })
    expect(st.schedulesPushedAt).toBe('2026-11-05T03:00:00.000Z')
    const pushed = server.schedules.get(UID)
    expect(pushed?.data).toMatchObject({
      version: 1,
      schedules: {},
      reminderTime: '20:00',
      timezone: expect.any(String),
    })
    const post = server.requests.find((r) => r.method === 'POST' && r.path === '/rest/v1/notification_schedules')
    expect(post?.search).toBe('?on_conflict=user_id')
    expect(post?.headers.get('prefer')).toContain('resolution=merge-duplicates')

    // The local bot is silent: no polling, no sending, coach falls back to Windows notifications only.
    expect(svc.isConnected()).toBe(false)
    expect(await svc.send({ text: 'hi' })).toBe(false)
    expect(await svc.pollOnce(0)).toMatchObject({ ok: false, code: 'server_mode' })
    expect(await call<TelegramStatus>('telegram:status')).toMatchObject({
      mode: 'server',
      connected: false,
      polling: 'stopped',
    })
    expect(server.telegramCalls).toHaveLength(0)

    await call('telegram:setMode', { mode: 'local' })
    expect(server.schedules.has(UID)).toBe(false)
    expect(server.count('DELETE', '/rest/v1/notification_schedules')).toBe(1)
    expect(svc.isConnected()).toBe(true)
    expect((await call<TelegramServerStatus>('telegram:serverStatus')).schedulesPushedAt).toBeNull()
  })
})

describe('Telegram server mode – linking', () => {
  it('creates a link code, reads the link from telegram_links and unlinks', async () => {
    const { call, server } = await setup()
    await call('telegram:setMode', { mode: 'server', serverBot: 'lq_server_bot' })
    const code = await call<TelegramLinkCode>('telegram:createLinkCode')
    expect(code).toEqual({
      code: '123456',
      expiresAt: '2026-11-05T03:15:00.000Z',
      startCommand: '/start 123456',
      deepLink: 'https://t.me/lq_server_bot?start=123456',
      serverBot: 'lq_server_bot',
    })
    const rpc = server.requests.find((r) => r.path === '/rest/v1/rpc/create_link_code')
    expect(rpc?.method).toBe('POST')
    expect(rpc?.headers.get('apikey')).toBe(ANON)
    expect((await call<TelegramServerStatus>('telegram:serverStatus')).linked).toBe(false)

    // The learner sends /start 123456 to the server bot, which inserts the link row.
    server.links.push({ user_id: UID, chat_id: 777, username: 'lan_tg', linked_at: '2026-11-05T03:01:00.000Z' })
    server.links.push({
      user_id: '44444444-4444-4444-8444-444444444444',
      chat_id: 888,
      username: 'other',
      linked_at: 'x',
    })
    const linked = await call<TelegramServerStatus>('telegram:serverStatus')
    expect(linked).toMatchObject({ linked: true, link: { username: 'lan_tg', linkedAt: '2026-11-05T03:01:00.000Z' } })
    expect(server.requests.find((r) => r.path === '/rest/v1/telegram_links')?.search).toBe('?select=*')

    const after = await call<TelegramServerStatus>('telegram:unlinkServer')
    expect(after.linked).toBe(false)
    const del = server.requests.find((r) => r.method === 'DELETE' && r.path === '/rest/v1/telegram_links')
    expect(del?.search).toBe(`?user_id=eq.${UID}`)
    expect(server.links.map((l) => l.chat_id)).toEqual([888])
  })

  it('a deep link needs the bot username; a network error shows in the status instead of failing', async () => {
    const { call, server } = await setup()
    const code = await call<TelegramLinkCode>('telegram:createLinkCode')
    expect(code.deepLink).toBeNull()
    expect(code.startCommand).toMatch(/^\/start \d{6}$/)
    await expect(call('telegram:setMode', { mode: 'server', serverBot: 'bad name!' })).rejects.toMatchObject({
      ipc: { code: 'invalid_input' },
    })
    server.down = true
    const st = await call<TelegramServerStatus>('telegram:serverStatus')
    expect(st.cloud.signedIn).toBe(true)
    expect(st.error).toContain('Không kết nối được máy chủ')
  })
})

describe('Telegram server mode – schedule push', () => {
  it('pushes coach schedule changes (only when they changed) and on demand', async () => {
    const { call, server, svc } = await setup()
    await call('telegram:setMode', { mode: 'server' })
    expect(server.count('POST', '/rest/v1/notification_schedules')).toBe(1)
    await svc.server.autoPush()
    expect(server.count('POST', '/rest/v1/notification_schedules')).toBe(1) // unchanged → no request

    await call('coach:updateSchedules', { morningBrief: { time: '06:15' }, weeklyReport: { weekday: 6 } })
    await svc.server.autoPush()
    expect(server.count('POST', '/rest/v1/notification_schedules')).toBe(2)
    const data = server.schedules.get(UID)?.data as { schedules: Record<string, { time?: string; weekday?: number }> }
    expect(data.schedules.morningBrief?.time).toBe('06:15')
    expect(data.schedules.weeklyReport?.weekday).toBe(6)

    const res = await call<{ pushed: boolean; at: string }>('telegram:pushSchedules')
    expect(res).toEqual({ pushed: true, at: '2026-11-05T03:00:00.000Z' })
    expect(server.count('POST', '/rest/v1/notification_schedules')).toBe(3)
  })

  it('pushes on sign-in while in server mode (background watcher), never in local mode', async () => {
    const { call, server, svc, signIn, kernel } = await setup({ signIn: false })
    const stop = svc.server.watch(3_600_000)
    try {
      await signIn()
      await new Promise((r) => setTimeout(r, 20))
      expect(server.count('POST', '/rest/v1/notification_schedules')).toBe(0) // local mode
      await kernel.cloud.signOut()
      await call('telegram:setMode', { mode: 'server' }) // signed out: nothing to push yet
      expect(server.count('POST', '/rest/v1/notification_schedules')).toBe(0)
      await signIn()
      await vi.waitFor(() => expect(server.count('POST', '/rest/v1/notification_schedules')).toBe(1))
    } finally {
      stop()
    }
  })
})
