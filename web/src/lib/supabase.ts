// Minimal Supabase REST client for the PWA (no SDK). Mirrors src/main/kernel/cloud/client.ts:
// email one-time code (/auth/v1/otp → /auth/v1/verify type=email), refresh_token grant, PostgREST, RPC, Functions.
//
// Storage trade-off: in a browser there is no OS key store (DPAPI) like on the desktop, so the session
// (access + refresh token) lives in localStorage. Any script running on this origin could read it, so the app
// ships no third-party scripts, uses a strict same-origin build, and "Đăng xuất" revokes the refresh token on
// the server (scope=global is NOT used here: signing out on the phone must not sign out the desktop).
// Everything is injectable (storage, fetch, clock) so it runs under Vitest in Node.

export interface KV {
  get(key: string): string | null
  set(key: string, value: string): void
  remove(key: string): void
}

export interface CloudConfig {
  url: string
  anonKey: string
}

export interface Session {
  accessToken: string
  refreshToken: string
  /** Epoch milliseconds when the access token expires. */
  expiresAt: number
  user: { id: string; email: string }
}

export type CloudErrorCode =
  | 'not_configured'
  | 'not_signed_in'
  | 'invalid_code'
  | 'invalid_email'
  | 'invalid_config'
  | 'rate_limited'
  | 'network'
  | 'server'
  | 'forbidden'
  | 'not_found'
  | 'bad_request'

export class CloudError extends Error {
  constructor(
    readonly code: CloudErrorCode,
    message: string,
    readonly status?: number,
  ) {
    super(message)
    this.name = 'CloudError'
  }
}

export const STORAGE_KEYS = { config: 'lq.cloud.config', session: 'lq.cloud.session' } as const

/** Memory-backed KV (tests, private browsing fallback). */
export function memoryKV(seed: Record<string, string> = {}): KV {
  const m = new Map(Object.entries(seed))
  return {
    get: (k) => m.get(k) ?? null,
    set: (k, v) => void m.set(k, v),
    remove: (k) => void m.delete(k),
  }
}

/** Validates and normalises a server URL + anon key. Throws CloudError('invalid_config'). */
export function normalizeConfig(url: string, anonKey: string): CloudConfig {
  let u: URL
  try {
    u = new URL(url.trim())
  } catch {
    throw new CloudError('invalid_config', 'URL không hợp lệ.')
  }
  const local = u.hostname === 'localhost' || u.hostname === '127.0.0.1'
  if (u.protocol !== 'https:' && !(local && u.protocol === 'http:'))
    throw new CloudError('invalid_config', 'URL máy chủ phải dùng https://')
  const key = anonKey.trim()
  if (!/^[A-Za-z0-9._-]{20,}$/.test(key)) throw new CloudError('invalid_config', 'Anon key không đúng định dạng.')
  return { url: u.origin, anonKey: key }
}

export function isValidEmail(email: string): boolean {
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim())
}

/** Converts a GoTrue token response into a Session. */
export function parseSession(j: unknown, nowMs: number): Session {
  const d = j as {
    access_token?: string
    refresh_token?: string
    expires_in?: number
    expires_at?: number
    user?: { id?: string; email?: string }
  } | null
  if (!d?.access_token || !d.refresh_token || !d.user?.id)
    throw new CloudError('server', 'Phản hồi đăng nhập không hợp lệ.')
  const expiresAt = d.expires_at ? d.expires_at * 1000 : nowMs + (d.expires_in ?? 3600) * 1000
  return {
    accessToken: d.access_token,
    refreshToken: d.refresh_token,
    expiresAt,
    user: { id: d.user.id, email: d.user.email ?? '' },
  }
}

function codeForStatus(status: number): CloudErrorCode {
  if (status === 429) return 'rate_limited'
  if (status === 401) return 'not_signed_in'
  if (status === 403) return 'forbidden'
  if (status === 404) return 'not_found'
  if (status >= 500) return 'server'
  return 'bad_request'
}

async function failure(res: Response): Promise<CloudError> {
  const body = await res.text().catch(() => '')
  let message = ''
  try {
    const j = JSON.parse(body) as { msg?: string; message?: string; error_description?: string; error?: string }
    message = j.msg ?? j.message ?? j.error_description ?? j.error ?? ''
  } catch {
    message = body.slice(0, 200)
  }
  return new CloudError(codeForStatus(res.status), message || `HTTP ${res.status}`, res.status)
}

export interface ClientDeps {
  storage: KV
  fetchImpl?: typeof fetch
  now?: () => number
  /** Build-time defaults (VITE_CLOUD_URL / VITE_CLOUD_ANON_KEY). */
  defaults?: { url?: string; anonKey?: string }
}

export class SupabaseClient {
  private refreshing: Promise<Session> | null = null
  private listeners = new Set<() => void>()
  private readonly doFetch: typeof fetch
  private readonly now: () => number

  constructor(private readonly deps: ClientDeps) {
    // Bound so the browser never sees `fetch` called with a foreign `this` ("Illegal invocation").
    this.doFetch = deps.fetchImpl ?? globalThis.fetch.bind(globalThis)
    this.now = deps.now ?? (() => Date.now())
  }

  // ---------- configuration ----------
  /** Config from the setup screen (localStorage) or, failing that, from the build env. */
  config(): CloudConfig | null {
    const raw = this.deps.storage.get(STORAGE_KEYS.config)
    if (raw) {
      try {
        const c = JSON.parse(raw) as Partial<CloudConfig>
        if (c.url && c.anonKey) return { url: c.url.replace(/\/+$/, ''), anonKey: c.anonKey }
      } catch {
        /* fall through to defaults */
      }
    }
    const url = this.deps.defaults?.url ?? ''
    const anonKey = this.deps.defaults?.anonKey ?? ''
    return url && anonKey ? { url: url.replace(/\/+$/, ''), anonKey } : null
  }

  /** True when the server comes from the build env (setup screen is not needed). */
  hasBuiltInConfig(): boolean {
    return !!(this.deps.defaults?.url && this.deps.defaults.anonKey)
  }

  configure(url: string, anonKey: string): CloudConfig {
    const cfg = normalizeConfig(url, anonKey)
    if (this.config()?.url !== cfg.url) this.deps.storage.remove(STORAGE_KEYS.session)
    this.deps.storage.set(STORAGE_KEYS.config, JSON.stringify(cfg))
    this.emit()
    return cfg
  }

  clearConfig(): void {
    this.deps.storage.remove(STORAGE_KEYS.config)
    this.deps.storage.remove(STORAGE_KEYS.session)
    this.emit()
  }

  private requireConfig(): CloudConfig {
    const cfg = this.config()
    if (!cfg) throw new CloudError('not_configured', 'Chưa cấu hình máy chủ.')
    return cfg
  }

  // ---------- session ----------
  session(): Session | null {
    const raw = this.deps.storage.get(STORAGE_KEYS.session)
    if (!raw) return null
    try {
      const s = JSON.parse(raw) as Session
      return s?.accessToken && s.refreshToken && s.user?.id ? s : null
    } catch {
      return null
    }
  }

  private saveSession(s: Session) {
    this.deps.storage.set(STORAGE_KEYS.session, JSON.stringify(s))
    this.emit()
  }

  private clearSession() {
    this.deps.storage.remove(STORAGE_KEYS.session)
    this.emit()
  }

  onChange(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => void this.listeners.delete(listener)
  }

  private emit() {
    for (const l of this.listeners) {
      try {
        l()
      } catch {
        /* listeners never break the client */
      }
    }
  }

  // ---------- transport ----------
  private async raw(path: string, init: RequestInit & { auth?: 'user' | 'anon' } = {}): Promise<Response> {
    const cfg = this.requireConfig()
    const { auth, ...rest } = init
    const headers = new Headers(rest.headers)
    headers.set('apikey', cfg.anonKey)
    headers.set('authorization', `Bearer ${auth === 'anon' ? cfg.anonKey : await this.accessToken()}`)
    if (rest.body && !headers.has('content-type')) headers.set('content-type', 'application/json')
    try {
      return await this.doFetch(`${cfg.url}${path}`, { ...rest, headers })
    } catch {
      throw new CloudError('network', 'Không kết nối được máy chủ.')
    }
  }

  /** Authenticated request; refreshes the token once on 401. Throws CloudError on non-2xx. */
  async request(path: string, init: RequestInit = {}): Promise<Response> {
    let res = await this.raw(path, init)
    if (res.status === 401 && this.session()) {
      await this.refresh(true)
      res = await this.raw(path, init)
    }
    if (!res.ok) throw await failure(res)
    return res
  }

  async json<T>(path: string, init: RequestInit = {}): Promise<T> {
    const res = await this.request(path, init)
    const text = await res.text()
    return (text ? JSON.parse(text) : null) as T
  }

  rpc<T>(fn: string, args: Record<string, unknown> = {}): Promise<T> {
    return this.json<T>(`/rest/v1/rpc/${encodeURIComponent(fn)}`, { method: 'POST', body: JSON.stringify(args) })
  }

  invoke<T>(name: string, body: unknown): Promise<T> {
    return this.json<T>(`/functions/v1/${encodeURIComponent(name)}`, { method: 'POST', body: JSON.stringify(body) })
  }

  // ---------- auth ----------
  async sendCode(email: string): Promise<void> {
    const clean = email.trim().toLowerCase()
    if (!isValidEmail(clean)) throw new CloudError('invalid_email', 'Email không hợp lệ.')
    const res = await this.raw('/auth/v1/otp', {
      method: 'POST',
      auth: 'anon',
      body: JSON.stringify({ email: clean, create_user: true }),
    })
    if (!res.ok) throw await failure(res)
  }

  async verifyCode(email: string, code: string): Promise<Session> {
    const token = code.replace(/\s+/g, '')
    if (!/^\d{6}$/.test(token)) throw new CloudError('invalid_code', 'Mã gồm 6 chữ số.')
    const res = await this.raw('/auth/v1/verify', {
      method: 'POST',
      auth: 'anon',
      body: JSON.stringify({ type: 'email', email: email.trim().toLowerCase(), token }),
    })
    if (res.status === 400 || res.status === 401 || res.status === 403)
      throw new CloudError('invalid_code', 'Mã không đúng hoặc đã hết hạn.', res.status)
    if (!res.ok) throw await failure(res)
    const s = parseSession(await res.json(), this.now())
    this.saveSession(s)
    return s
  }

  /** Valid access token, refreshed when it expires within 60 s. */
  async accessToken(): Promise<string> {
    const s = this.session()
    if (!s) throw new CloudError('not_signed_in', 'Bạn chưa đăng nhập.')
    if (s.expiresAt - this.now() > 60_000) return s.accessToken
    return (await this.refresh()).accessToken
  }

  /** Refreshes the session (deduplicated). A rejected refresh token signs the user out locally. */
  async refresh(force = false): Promise<Session> {
    if (this.refreshing) return this.refreshing
    const s = this.session()
    if (!s) throw new CloudError('not_signed_in', 'Bạn chưa đăng nhập.')
    if (!force && s.expiresAt - this.now() > 60_000) return s
    this.refreshing = (async () => {
      const res = await this.raw('/auth/v1/token?grant_type=refresh_token', {
        method: 'POST',
        auth: 'anon',
        body: JSON.stringify({ refresh_token: s.refreshToken }),
      })
      if (res.status === 400 || res.status === 401) {
        this.clearSession()
        throw new CloudError('not_signed_in', 'Phiên đăng nhập đã hết hạn.', res.status)
      }
      if (!res.ok) throw await failure(res)
      const next = parseSession(await res.json(), this.now())
      this.saveSession(next)
      return next
    })()
    try {
      return await this.refreshing
    } finally {
      this.refreshing = null
    }
  }

  /** Revokes this device's refresh token (scope=local) and forgets the session. */
  async signOut(): Promise<void> {
    if (this.session() && this.config()) {
      try {
        await this.raw('/auth/v1/logout?scope=local', { method: 'POST' })
      } catch {
        /* offline: the local session is removed anyway */
      }
    }
    this.clearSession()
  }
}
