// Supabase client for the optional online account (REST only – no SDK, so it is easy to test with a fake fetch).
// Signs in with an email one-time code, keeps the session encrypted in the KeyStore ('cloud'), refreshes the access
// token automatically and exposes small helpers for PostgREST, RPC, Storage and Edge Functions.
import type { KeyStore } from '../secure/keyStore'
import type { SettingsService } from '../settings/settings'

export const CLOUD_FLAGS = {
  url: 'cloud.url',
  anonKey: 'cloud.anonKey',
  deviceId: 'cloud.deviceId',
} as const

export interface CloudSession {
  accessToken: string
  refreshToken: string
  /** Epoch milliseconds when the access token expires. */
  expiresAt: number
  user: { id: string; email: string }
}

export interface CloudStatus {
  configured: boolean
  url: string | null
  signedIn: boolean
  email: string | null
  userId: string | null
  deviceId: string | null
}

export class CloudError extends Error {
  constructor(
    readonly code:
      | 'not_configured'
      | 'not_signed_in'
      | 'invalid_code'
      | 'rate_limited'
      | 'network'
      | 'server'
      | 'forbidden'
      | 'bad_request',
    message: string,
    readonly status?: number,
  ) {
    super(message)
    this.name = 'CloudError'
  }
}

const MESSAGES_VI: Record<CloudError['code'], string> = {
  not_configured: 'Chưa cấu hình máy chủ. Vào Cài đặt → Tài khoản để nhập URL và anon key của Supabase.',
  not_signed_in: 'Bạn chưa đăng nhập tài khoản online.',
  invalid_code: 'Mã đăng nhập không đúng hoặc đã hết hạn. Hãy yêu cầu mã mới.',
  rate_limited: 'Gửi yêu cầu quá nhanh. Đợi một chút rồi thử lại.',
  network: 'Không kết nối được máy chủ. Kiểm tra Internet.',
  server: 'Máy chủ đang lỗi. Thử lại sau.',
  forbidden: 'Không có quyền truy cập dữ liệu này.',
  bad_request: 'Yêu cầu không hợp lệ.',
}

export const cloudMessage = (code: CloudError['code']) => MESSAGES_VI[code]

export interface CloudClientDeps {
  keys: KeyStore
  settings: SettingsService
  fetchImpl?: typeof fetch
  now?: () => Date
  /** Build-time defaults (LQ_CLOUD_URL / LQ_CLOUD_ANON_KEY). */
  defaults?: { url?: string; anonKey?: string }
}

export class CloudClient {
  private refreshing: Promise<CloudSession> | null = null
  private listeners: ((s: CloudStatus) => void)[] = []

  constructor(private readonly deps: CloudClientDeps) {}

  private get fetch() {
    return this.deps.fetchImpl ?? fetch
  }
  private now() {
    return (this.deps.now ?? (() => new Date()))().getTime()
  }

  // ---------- configuration ----------
  config(): { url: string; anonKey: string } | null {
    const url = this.deps.settings.getFlag(CLOUD_FLAGS.url) ?? this.deps.defaults?.url ?? ''
    const anonKey = this.deps.settings.getFlag(CLOUD_FLAGS.anonKey) ?? this.deps.defaults?.anonKey ?? ''
    return url && anonKey ? { url: url.replace(/\/+$/, ''), anonKey } : null
  }

  configure(url: string, anonKey: string): void {
    const u = new URL(url.trim())
    if (u.protocol !== 'https:' && u.hostname !== 'localhost' && u.hostname !== '127.0.0.1')
      throw new CloudError('bad_request', 'URL máy chủ phải dùng https://')
    if (!/^[A-Za-z0-9._-]{20,}$/.test(anonKey.trim()))
      throw new CloudError('bad_request', 'Anon key không đúng định dạng.')
    const changed = this.config()?.url !== u.origin
    this.deps.settings.setFlag(CLOUD_FLAGS.url, u.origin)
    this.deps.settings.setFlag(CLOUD_FLAGS.anonKey, anonKey.trim())
    if (changed) this.clearSession()
    this.emit()
  }

  deviceId(): string {
    let id = this.deps.settings.getFlag(CLOUD_FLAGS.deviceId)
    if (!id) {
      id = crypto.randomUUID()
      this.deps.settings.setFlag(CLOUD_FLAGS.deviceId, id)
    }
    return id
  }

  // ---------- session ----------
  session(): CloudSession | null {
    const raw = this.deps.keys.get('cloud')
    if (!raw) return null
    try {
      return JSON.parse(Buffer.from(raw, 'base64url').toString('utf8')) as CloudSession
    } catch {
      return null
    }
  }

  private saveSession(s: CloudSession) {
    // base64url keeps the stored value free of whitespace (KeyStore rejects whitespace).
    this.deps.keys.set('cloud', Buffer.from(JSON.stringify(s), 'utf8').toString('base64url'))
    this.emit()
  }

  private clearSession() {
    this.deps.keys.remove('cloud')
    this.emit()
  }

  status(): CloudStatus {
    const cfg = this.config()
    const s = this.session()
    return {
      configured: !!cfg,
      url: cfg?.url ?? null,
      signedIn: !!s,
      email: s?.user.email ?? null,
      userId: s?.user.id ?? null,
      deviceId: this.deps.settings.getFlag(CLOUD_FLAGS.deviceId),
    }
  }

  isSignedIn(): boolean {
    return !!this.config() && !!this.session()
  }

  onChange(listener: (s: CloudStatus) => void): () => void {
    this.listeners.push(listener)
    return () => {
      this.listeners = this.listeners.filter((l) => l !== listener)
    }
  }

  private emit() {
    const st = this.status()
    for (const l of this.listeners) {
      try {
        l(st)
      } catch {
        /* ignore */
      }
    }
  }

  // ---------- low-level HTTP ----------
  private requireConfig() {
    const cfg = this.config()
    if (!cfg) throw new CloudError('not_configured', MESSAGES_VI.not_configured)
    return cfg
  }

  private async raw(path: string, init: RequestInit & { auth?: 'user' | 'anon' } = {}): Promise<Response> {
    const cfg = this.requireConfig()
    const headers = new Headers(init.headers)
    headers.set('apikey', cfg.anonKey)
    if (init.auth !== 'anon') {
      const token = await this.accessToken()
      headers.set('authorization', `Bearer ${token}`)
    } else headers.set('authorization', `Bearer ${cfg.anonKey}`)
    let res: Response
    try {
      res = await this.fetch(`${cfg.url}${path}`, { ...init, headers })
    } catch {
      throw new CloudError('network', MESSAGES_VI.network)
    }
    return res
  }

  private static async fail(res: Response): Promise<never> {
    const body = await res.text().catch(() => '')
    let message = ''
    try {
      const j = JSON.parse(body) as { msg?: string; message?: string; error_description?: string; error?: string }
      message = j.msg ?? j.message ?? j.error_description ?? j.error ?? ''
    } catch {
      message = body.slice(0, 200)
    }
    const code: CloudError['code'] =
      res.status === 429
        ? 'rate_limited'
        : res.status === 401
          ? 'not_signed_in'
          : res.status === 403
            ? 'forbidden'
            : res.status >= 500
              ? 'server'
              : 'bad_request'
    throw new CloudError(code, message ? `${MESSAGES_VI[code]} (${message})` : MESSAGES_VI[code], res.status)
  }

  /** Authenticated request; refreshes the token once on 401. */
  async request(path: string, init: RequestInit = {}): Promise<Response> {
    let res = await this.raw(path, init)
    if (res.status === 401 && this.session()) {
      await this.refresh(true)
      res = await this.raw(path, init)
    }
    if (!res.ok) await CloudClient.fail(res)
    return res
  }

  async json<T>(path: string, init: RequestInit = {}): Promise<T> {
    const headers = new Headers(init.headers)
    if (init.body && !headers.has('content-type')) headers.set('content-type', 'application/json')
    const res = await this.request(path, { ...init, headers })
    const text = await res.text()
    return (text ? JSON.parse(text) : null) as T
  }

  /** PostgREST RPC call: POST /rest/v1/rpc/<fn>. */
  rpc<T>(fn: string, args: Record<string, unknown> = {}): Promise<T> {
    return this.json<T>(`/rest/v1/rpc/${encodeURIComponent(fn)}`, { method: 'POST', body: JSON.stringify(args) })
  }

  /** Edge Function call: POST /functions/v1/<name>. */
  invoke<T>(name: string, body: unknown): Promise<T> {
    return this.json<T>(`/functions/v1/${encodeURIComponent(name)}`, { method: 'POST', body: JSON.stringify(body) })
  }

  // ---------- storage ----------
  async upload(bucket: string, path: string, data: Uint8Array, contentType = 'application/octet-stream') {
    await this.request(`/storage/v1/object/${bucket}/${path.split('/').map(encodeURIComponent).join('/')}`, {
      method: 'POST',
      headers: { 'content-type': contentType, 'x-upsert': 'true' },
      body: Buffer.from(data),
    })
  }

  async download(bucket: string, path: string): Promise<Uint8Array> {
    const res = await this.request(
      `/storage/v1/object/authenticated/${bucket}/${path.split('/').map(encodeURIComponent).join('/')}`,
    )
    return new Uint8Array(await res.arrayBuffer())
  }

  list(bucket: string, prefix: string) {
    return this.json<{ name: string; created_at: string; updated_at: string; metadata?: { size?: number } }[]>(
      `/storage/v1/object/list/${bucket}`,
      { method: 'POST', body: JSON.stringify({ prefix, limit: 100, sortBy: { column: 'created_at', order: 'desc' } }) },
    )
  }

  async remove(bucket: string, paths: string[]) {
    await this.json(`/storage/v1/object/${bucket}`, { method: 'DELETE', body: JSON.stringify({ prefixes: paths }) })
  }

  // ---------- auth ----------
  async sendCode(email: string): Promise<void> {
    const clean = email.trim().toLowerCase()
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(clean)) throw new CloudError('bad_request', 'Email không hợp lệ.')
    const res = await this.raw('/auth/v1/otp', {
      method: 'POST',
      auth: 'anon',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: clean, create_user: true }),
    })
    if (!res.ok) await CloudClient.fail(res)
  }

  async verifyCode(email: string, code: string): Promise<CloudStatus> {
    const res = await this.raw('/auth/v1/verify', {
      method: 'POST',
      auth: 'anon',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'email', email: email.trim().toLowerCase(), token: code.trim() }),
    })
    if (res.status === 400 || res.status === 403 || res.status === 401)
      throw new CloudError('invalid_code', MESSAGES_VI.invalid_code)
    if (!res.ok) await CloudClient.fail(res)
    this.saveSession(this.toSession(await res.json()))
    return this.status()
  }

  private toSession(j: unknown): CloudSession {
    const d = j as {
      access_token: string
      refresh_token: string
      expires_in?: number
      expires_at?: number
      user: { id: string; email?: string }
    }
    if (!d?.access_token || !d.refresh_token || !d.user?.id)
      throw new CloudError('server', 'Phản hồi đăng nhập không hợp lệ.')
    const expiresAt = d.expires_at ? d.expires_at * 1000 : this.now() + (d.expires_in ?? 3600) * 1000
    return {
      accessToken: d.access_token,
      refreshToken: d.refresh_token,
      expiresAt,
      user: { id: d.user.id, email: d.user.email ?? '' },
    }
  }

  /** Valid access token, refreshed when it expires within 60 s. */
  async accessToken(): Promise<string> {
    const s = this.session()
    if (!s) throw new CloudError('not_signed_in', MESSAGES_VI.not_signed_in)
    if (s.expiresAt - this.now() > 60_000) return s.accessToken
    return (await this.refresh()).accessToken
  }

  private async refresh(force = false): Promise<CloudSession> {
    if (this.refreshing) return this.refreshing
    const s = this.session()
    if (!s) throw new CloudError('not_signed_in', MESSAGES_VI.not_signed_in)
    if (!force && s.expiresAt - this.now() > 60_000) return s
    this.refreshing = (async () => {
      const res = await this.raw('/auth/v1/token?grant_type=refresh_token', {
        method: 'POST',
        auth: 'anon',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ refresh_token: s.refreshToken }),
      })
      if (res.status === 400 || res.status === 401) {
        this.clearSession() // refresh token revoked (signed out elsewhere)
        throw new CloudError('not_signed_in', MESSAGES_VI.not_signed_in)
      }
      if (!res.ok) await CloudClient.fail(res)
      const next = this.toSession(await res.json())
      this.saveSession(next)
      return next
    })()
    try {
      return await this.refreshing
    } finally {
      this.refreshing = null
    }
  }

  async signOut(): Promise<void> {
    if (this.session() && this.config()) {
      try {
        await this.raw('/auth/v1/logout?scope=global', { method: 'POST' })
      } catch {
        /* offline: the local session is removed anyway */
      }
    }
    this.clearSession()
  }
}
