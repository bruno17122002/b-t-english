// "Bot chạy trên server" mode of Settings → Telegram. The central bot runs as a Supabase Edge Function
// (supabase/functions/telegram-bot); this side only needs the online account (CloudClient):
// - link status from telegram_links, pairing codes via RPC create_link_code(), unlinking (DELETE own row);
// - pushes the coach schedules (read-only use of the coach module's 'coach.schedules' flag) to
//   notification_schedules so the server scheduler sends briefs, reminders and reports even when the PC is off.
// While in server mode the local TelegramService does not poll and does not send (no double messages).
import type { TelegramLinkCode, TelegramMode, TelegramServerStatus } from '@shared/telegram'
import type { Kernel } from '..'
import { CloudError } from '../cloud/client'
import { TELEGRAM_FLAGS } from './legacy'

/** Settings flag owned by the coach module (read only here). */
export const COACH_SCHEDULES_FLAG = 'coach.schedules'
const CODE_TTL_MS = 15 * 60_000
const USERNAME = /^[A-Za-z0-9_]{3,64}$/

interface PushedMarker {
  hash: string
  userId: string
  at: string
}

export interface SchedulesPayload {
  version: 1
  /** Parsed coach.schedules JSON ({} = coach defaults); the server merges it over the same defaults. */
  schedules: Record<string, unknown>
  /** Default time of the evening reminder (Settings → General). */
  reminderTime: string
  /** IANA zone of this PC (fallback when profiles.timezone is not set). */
  timezone: string
  updatedAt: string
}

const hashOf = (s: string) => {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return (h >>> 0).toString(36)
}

export class TelegramServerLink {
  private watching = false

  constructor(private readonly k: Kernel) {}

  // ---------- mode ----------
  mode(): TelegramMode {
    return this.k.settings.getFlag(TELEGRAM_FLAGS.mode) === 'server' ? 'server' : 'local'
  }

  serverBot(): string | null {
    const v = (this.k.settings.getFlag(TELEGRAM_FLAGS.serverBot) ?? '').replace(/^@/, '').trim()
    return USERNAME.test(v) ? v : null
  }

  setServerBot(username: string): void {
    this.k.settings.setFlag(TELEGRAM_FLAGS.serverBot, username.replace(/^@/, '').trim())
  }

  /** Switches the mode. Entering server mode pushes the schedules; leaving it removes them from the server. */
  async setMode(mode: TelegramMode): Promise<void> {
    const before = this.mode()
    this.k.settings.setFlag(TELEGRAM_FLAGS.mode, mode)
    if (before === mode) return
    this.k.log.info(`Telegram mode: ${mode}`)
    if (!this.k.cloud.isSignedIn()) return
    try {
      if (mode === 'server') await this.pushSchedules(true)
      else await this.removeSchedules()
    } catch (err) {
      this.k.log.warn(`telegram mode switch: schedule sync failed (${err instanceof CloudError ? err.code : 'error'})`)
    }
  }

  // ---------- status ----------
  private pushedMarker(): PushedMarker | null {
    try {
      const m = JSON.parse(this.k.settings.getFlag(TELEGRAM_FLAGS.schedulesPushed) ?? 'null') as PushedMarker | null
      return m && typeof m.hash === 'string' ? m : null
    } catch {
      return null
    }
  }

  async status(): Promise<TelegramServerStatus> {
    const cloud = this.k.cloud.status()
    const marker = this.pushedMarker()
    const base: TelegramServerStatus = {
      mode: this.mode(),
      cloud: { configured: cloud.configured, signedIn: cloud.signedIn && cloud.configured, email: cloud.email },
      linked: false,
      link: null,
      serverBot: this.serverBot(),
      schedulesPushedAt: marker && marker.userId === cloud.userId ? marker.at : null,
      error: null,
    }
    if (!base.cloud.signedIn) return base
    try {
      const rows = await this.k.cloud.json<{ username: string | null; linked_at: string }[]>(
        '/rest/v1/telegram_links?select=*',
      )
      const row = rows?.[0]
      return row ? { ...base, linked: true, link: { username: row.username ?? null, linkedAt: row.linked_at } } : base
    } catch (err) {
      if (err instanceof CloudError && err.code === 'not_signed_in')
        return { ...base, cloud: { ...base.cloud, signedIn: false } }
      return { ...base, error: err instanceof Error ? err.message : 'Không đọc được trạng thái liên kết.' }
    }
  }

  // ---------- linking ----------
  async createLinkCode(): Promise<TelegramLinkCode> {
    const raw = await this.k.cloud.rpc<string>('create_link_code')
    const code = String(raw ?? '').trim()
    if (!/^\d{6}$/.test(code)) throw new CloudError('server', 'Máy chủ trả về mã liên kết không hợp lệ.')
    const bot = this.serverBot()
    return {
      code,
      expiresAt: new Date(this.k.now().getTime() + CODE_TTL_MS).toISOString(),
      startCommand: `/start ${code}`,
      deepLink: bot ? `https://t.me/${bot}?start=${code}` : null,
      serverBot: bot,
    }
  }

  private userId(): string {
    const id = this.k.cloud.status().userId
    if (!id || !this.k.cloud.isSignedIn()) throw new CloudError('not_signed_in', 'Bạn chưa đăng nhập tài khoản online.')
    return id
  }

  async unlink(): Promise<void> {
    const uid = this.userId()
    await this.k.cloud.json(`/rest/v1/telegram_links?user_id=eq.${encodeURIComponent(uid)}`, { method: 'DELETE' })
    this.k.log.info('server Telegram link removed')
  }

  // ---------- schedules ----------
  payload(): SchedulesPayload {
    let schedules: Record<string, unknown> = {}
    try {
      const parsed = JSON.parse(this.k.settings.getFlag(COACH_SCHEDULES_FLAG) ?? '{}') as unknown
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) schedules = parsed as Record<string, unknown>
    } catch {
      schedules = {}
    }
    let timezone = 'Asia/Ho_Chi_Minh'
    try {
      timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || timezone
    } catch {
      /* keep default */
    }
    return {
      version: 1,
      schedules,
      reminderTime: this.k.settings.get().reminderTime,
      timezone,
      updatedAt: this.k.now().toISOString(),
    }
  }

  /**
   * Upserts the schedules into notification_schedules. Without `force` nothing is sent when they did not change
   * since the last push for this account (cheap enough to call every minute).
   */
  async pushSchedules(force = false): Promise<{ pushed: boolean; at: string | null }> {
    const uid = this.userId()
    const data = this.payload()
    const hash = hashOf(JSON.stringify({ s: data.schedules, r: data.reminderTime, t: data.timezone }))
    const marker = this.pushedMarker()
    if (!force && marker && marker.hash === hash && marker.userId === uid) return { pushed: false, at: marker.at }
    await this.k.cloud.json('/rest/v1/notification_schedules?on_conflict=user_id', {
      method: 'POST',
      headers: { prefer: 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify([{ user_id: uid, data, updated_at: data.updatedAt }]),
    })
    const at = data.updatedAt
    this.k.settings.setFlag(TELEGRAM_FLAGS.schedulesPushed, JSON.stringify({ hash, userId: uid, at }))
    this.k.log.info('coach schedules pushed to the server')
    return { pushed: true, at }
  }

  /** Back to local mode: the server must stop sending scheduled messages. */
  async removeSchedules(): Promise<void> {
    const uid = this.userId()
    await this.k.cloud.json(`/rest/v1/notification_schedules?user_id=eq.${encodeURIComponent(uid)}`, {
      method: 'DELETE',
    })
    this.k.settings.setFlag(TELEGRAM_FLAGS.schedulesPushed, '')
  }

  /** Safe background push: only in server mode while signed in; never throws. */
  async autoPush(): Promise<void> {
    if (this.mode() !== 'server' || !this.k.cloud.isSignedIn()) return
    try {
      await this.pushSchedules(false)
    } catch (err) {
      this.k.log.warn(`coach schedule push failed: ${err instanceof CloudError ? err.code : 'error'}`)
    }
  }

  /**
   * Keeps the server copy of the schedules fresh: on sign-in and once a minute when they changed (the coach module
   * stores them in a settings flag, so a cheap hash comparison detects edits). Returns the stop function.
   */
  watch(intervalMs = 60_000): () => void {
    if (this.watching) return () => undefined
    this.watching = true
    let wasSignedIn = this.k.cloud.isSignedIn()
    const off = this.k.cloud.onChange((s) => {
      if (s.signedIn && !wasSignedIn) void this.autoPush()
      wasSignedIn = s.signedIn
    })
    const first = setTimeout(() => void this.autoPush(), 15_000)
    const timer = setInterval(() => void this.autoPush(), intervalMs)
    return () => {
      this.watching = false
      off()
      clearTimeout(first)
      clearInterval(timer)
    }
  }
}
