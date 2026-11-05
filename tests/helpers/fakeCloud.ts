// Desktop-side in-memory stand-in for a Supabase project (Auth email OTP, PostgREST, RPC, Storage), served
// through a fake fetch. It implements the semantics of supabase/migrations/0001_init.sql that the desktop relies
// on: sync_push last-writer-wins on client_updated_at, a global increasing seq cursor, the devices FK, RLS per
// user, delete_my_data and the private `backups/<uid>/` bucket. Used by tests/integration/cloud-*.test.ts.

export const FAKE_URL = 'https://lqtest.supabase.co'
export const FAKE_ANON = 'eyJhbGciOiJIUzI1NiJ9.anon-public-key.signature_abc123'

export interface FakeRequest {
  method: string
  path: string
  url: string
  headers: Record<string, string>
  body: unknown
}

interface SyncRow {
  user_id: string
  tbl: string
  row_key: string
  data: Record<string, unknown>
  deleted: boolean
  device_id: string | null
  client_updated_at: string
  server_updated_at: string
  seq: number
}

interface Session {
  userId: string
  access: string
  refresh: string
  accessValid: boolean
  refreshValid: boolean
}

interface Device {
  id: string
  user_id: string
  name: string
  platform: string
  app_version: string
  last_seen_at: string
}

interface PushRow {
  tbl: string
  row_key: string
  data: Record<string, unknown>
  deleted?: boolean
  client_updated_at: string
}

const json = (body: unknown, status = 200) =>
  new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })

/** Postgres renders timestamptz with an explicit offset – clients must parse, not compare strings. */
const pgTime = (iso: string) => new Date(iso).toISOString().replace('Z', '+00:00')

export class FakeCloud {
  readonly requests: FakeRequest[] = []
  readonly codes = new Map<string, string>()
  readonly users = new Map<string, string>() // email → user id
  readonly sessions: Session[] = []
  readonly rows = new Map<string, SyncRow>()
  readonly devices = new Map<string, Device>()
  readonly profiles = new Map<string, { user_id: string; display_name: string }>()
  readonly objects = new Map<string, { bytes: Uint8Array; created_at: string }>() // "<bucket>/<path>"
  /** Every sync_push call: device id and the rows it carried. */
  readonly pushes: { device: string | null; rows: { tbl: string; row_key: string; data: unknown }[] }[] = []
  seq = 0
  down = false
  rateLimitOtp = false
  expiresIn = 3600
  private n = 0
  private clock = Date.parse('2026-11-05T08:00:00.000Z')

  private nowIso() {
    this.clock += 1
    return new Date(this.clock).toISOString()
  }

  readonly fetch = (async (input: string | URL | Request, init: RequestInit = {}) => {
    const url = new URL(String(input))
    if (this.down) throw new TypeError('fetch failed')
    if (url.origin !== FAKE_URL) throw new TypeError(`unexpected host ${url.origin}`)
    const headers: Record<string, string> = {}
    new Headers(init.headers).forEach((v, k) => (headers[k] = v))
    const method = (init.method ?? 'GET').toUpperCase()
    let body: unknown = null
    if (typeof init.body === 'string') body = init.body ? JSON.parse(init.body) : null
    else if (init.body instanceof Uint8Array) body = new Uint8Array(init.body)
    this.requests.push({ method, path: url.pathname, url: url.pathname + url.search, headers, body })
    if (headers.apikey !== FAKE_ANON) return json({ message: 'Invalid API key' }, 401)
    return this.route(method, url, headers, body)
  }) as typeof fetch

  /** Latest OTP code e-mailed to `email`. */
  code(email: string): string {
    const c = this.codes.get(email.toLowerCase())
    if (!c) throw new Error(`no code sent to ${email}`)
    return c
  }

  userId(email: string): string {
    const id = this.users.get(email.toLowerCase())
    if (!id) throw new Error(`unknown user ${email}`)
    return id
  }

  /** Makes every current access token invalid (server-side expiry / key rotation). */
  expireAccessTokens() {
    for (const s of this.sessions) s.accessValid = false
  }

  revokeRefreshTokens() {
    for (const s of this.sessions) s.refreshValid = false
  }

  userRows(userId: string): SyncRow[] {
    return [...this.rows.values()].filter((r) => r.user_id === userId).sort((a, b) => a.seq - b.seq)
  }

  /** Writes a row as the server bot / PWA would (device_id null). */
  serverWrite(
    userId: string,
    row: {
      tbl: string
      row_key: string
      data: Record<string, unknown>
      deleted?: boolean
      client_updated_at?: string
    },
  ) {
    this.rows.set(`${userId}\u0000${row.tbl}\u0000${row.row_key}`, {
      user_id: userId,
      tbl: row.tbl,
      row_key: row.row_key,
      data: row.data,
      deleted: !!row.deleted,
      device_id: null,
      client_updated_at: row.client_updated_at ?? new Date().toISOString(),
      server_updated_at: this.nowIso(),
      seq: ++this.seq,
    })
  }

  private issue(userId: string): Session {
    this.n++
    const s: Session = {
      userId,
      access: `access-${userId}-${this.n}-${'x'.repeat(24)}`,
      refresh: `refresh-${userId}-${this.n}-${'y'.repeat(24)}`,
      accessValid: true,
      refreshValid: true,
    }
    this.sessions.push(s)
    return s
  }

  private sessionBody(s: Session, email: string) {
    return {
      access_token: s.access,
      refresh_token: s.refresh,
      token_type: 'bearer',
      expires_in: this.expiresIn,
      user: { id: s.userId, email },
    }
  }

  private emailOf(userId: string) {
    return [...this.users.entries()].find(([, id]) => id === userId)?.[0] ?? ''
  }

  private authUser(headers: Record<string, string>): string | null {
    const token = (headers.authorization ?? '').replace(/^Bearer /, '')
    return this.sessions.find((x) => x.access === token && x.accessValid)?.userId ?? null
  }

  private route(method: string, url: URL, headers: Record<string, string>, body: unknown): Response {
    const p = url.pathname
    const b = (body ?? {}) as Record<string, unknown>
    // ---------- auth ----------
    if (p === '/auth/v1/otp' && method === 'POST') {
      if (this.rateLimitOtp) return json({ msg: 'email rate limit exceeded' }, 429)
      const email = String(b.email).toLowerCase()
      if (!this.users.has(email)) this.users.set(email, crypto.randomUUID())
      this.codes.set(email, String(100000 + Math.floor(Math.random() * 900000)))
      return json({})
    }
    if (p === '/auth/v1/verify' && method === 'POST') {
      const email = String(b.email).toLowerCase()
      if (b.type !== 'email' || this.codes.get(email) !== b.token)
        return json({ code: 403, msg: 'Token has expired or is invalid' }, 403)
      this.codes.delete(email)
      return json(this.sessionBody(this.issue(this.userId(email)), email))
    }
    if (p === '/auth/v1/token' && url.searchParams.get('grant_type') === 'refresh_token') {
      const s = this.sessions.find((x) => x.refresh === b.refresh_token && x.refreshValid)
      if (!s) return json({ error: 'invalid_grant', error_description: 'Invalid Refresh Token' }, 400)
      s.refreshValid = false // rotation
      s.accessValid = false
      return json(this.sessionBody(this.issue(s.userId), this.emailOf(s.userId)))
    }
    const uid = this.authUser(headers)
    if (p === '/auth/v1/logout') {
      if (uid)
        for (const s of this.sessions.filter((x) => x.userId === uid)) {
          s.refreshValid = false
          s.accessValid = false
        }
      return new Response(null, { status: 204 })
    }
    if (!uid) return json({ message: 'JWT expired', code: 'PGRST301' }, 401)

    // ---------- PostgREST ----------
    if (p === '/rest/v1/rpc/sync_push') return this.syncPush(uid, b)
    if (p === '/rest/v1/rpc/delete_my_data') {
      for (const [k, r] of this.rows) if (r.user_id === uid) this.rows.delete(k)
      for (const [k, d] of this.devices) if (d.user_id === uid) this.devices.delete(k)
      this.profiles.delete(uid)
      for (const k of [...this.objects.keys()]) if (k.startsWith(`backups/${uid}/`)) this.objects.delete(k)
      return json(null)
    }
    if (p === '/rest/v1/sync_rows' && method === 'GET') {
      const gt = Number((url.searchParams.get('seq') ?? 'gt.0').replace(/^gt\./, ''))
      const limit = Number(url.searchParams.get('limit') ?? 1000)
      return json(
        this.userRows(uid)
          .filter((r) => r.seq > gt)
          .slice(0, limit)
          .map((r) => ({ ...r, client_updated_at: pgTime(r.client_updated_at) })),
      )
    }
    if (p === '/rest/v1/devices' && method === 'POST') {
      const d = b as unknown as Device
      if (d.user_id !== uid) return json({ message: 'new row violates row-level security policy' }, 403)
      const prev = this.devices.get(d.id)
      if (prev && prev.user_id !== uid) return json({ message: 'duplicate key' }, 409)
      this.devices.set(d.id, { ...prev, ...d })
      return new Response(null, { status: 201 })
    }
    if (p === '/rest/v1/devices' && method === 'GET')
      return json([...this.devices.values()].filter((d) => d.user_id === uid))
    if (p === '/rest/v1/profiles' && method === 'POST') {
      const d = b as unknown as { user_id: string; display_name: string }
      if (d.user_id !== uid) return json({ message: 'new row violates row-level security policy' }, 403)
      this.profiles.set(uid, { user_id: uid, display_name: d.display_name })
      return new Response(null, { status: 201 })
    }
    if (p.startsWith('/functions/v1/')) return json({ ok: true, name: p.split('/').pop() })

    // ---------- Storage ----------
    const own = (objectPath: string) => objectPath.split('/')[0] === uid
    if (p.startsWith('/storage/v1/object/list/')) {
      const bucket = p.split('/')[5] as string
      const prefix = String(b.prefix ?? '').replace(/\/+$/, '')
      if (!own(prefix)) return json([])
      const base = `${bucket}/${prefix}/`
      const out = [...this.objects.entries()]
        .filter(([k]) => k.startsWith(base) && !k.slice(base.length).includes('/'))
        .map(([k, o]) => ({
          name: k.slice(base.length),
          id: k,
          created_at: o.created_at,
          updated_at: o.created_at,
          metadata: { size: o.bytes.byteLength },
        }))
        .sort((x, y) => y.created_at.localeCompare(x.created_at))
      return json(out.slice(0, Number(b.limit ?? 100)))
    }
    if (p.startsWith('/storage/v1/object/authenticated/') && method === 'GET') {
      const rest = decodeURIComponent(p.slice('/storage/v1/object/authenticated/'.length))
      const o = this.objects.get(rest)
      if (!own(rest.split('/').slice(1).join('/')) || !o) return json({ message: 'Object not found' }, 404)
      return new Response(Buffer.from(o.bytes), { status: 200 })
    }
    if (p.startsWith('/storage/v1/object/') && method === 'POST') {
      const rest = decodeURIComponent(p.slice('/storage/v1/object/'.length))
      if (!own(rest.split('/').slice(1).join('/')))
        return json({ message: 'new row violates row-level security policy' }, 403)
      if (this.objects.has(rest) && headers['x-upsert'] !== 'true') return json({ message: 'Duplicate' }, 409)
      this.objects.set(rest, { bytes: body as Uint8Array, created_at: this.nowIso() })
      return json({ Key: rest })
    }
    if (p.startsWith('/storage/v1/object/') && method === 'DELETE') {
      const bucket = p.slice('/storage/v1/object/'.length)
      const removed: string[] = []
      for (const name of (b.prefixes as string[]) ?? []) {
        if (own(name) && this.objects.delete(`${bucket}/${name}`)) removed.push(name)
      }
      return json(removed.map((name) => ({ name })))
    }
    return json({ message: `no route ${method} ${p}` }, 404)
  }

  private syncPush(uid: string, b: Record<string, unknown>): Response {
    const rows = b.rows as PushRow[]
    const device = (b.device as string | null) ?? null
    if (!Array.isArray(rows)) return json({ message: 'rows must be an array' }, 400)
    if (rows.length > 1000) return json({ message: 'too many rows in one push (max 1000)' }, 400)
    if (device && this.devices.get(device)?.user_id !== uid)
      return json({ code: '23503', message: 'sync_rows violates foreign key constraint on device_id' }, 409)
    this.pushes.push({ device, rows: rows.map((r) => ({ tbl: r.tbl, row_key: r.row_key, data: r.data })) })
    let applied = 0
    for (const r of rows) {
      const key = `${uid}\u0000${r.tbl}\u0000${r.row_key}`
      const prev = this.rows.get(key)
      // sync_push: "where s.client_updated_at <= excluded.client_updated_at"
      if (prev && Date.parse(prev.client_updated_at) > Date.parse(r.client_updated_at)) continue
      this.rows.set(key, {
        user_id: uid,
        tbl: r.tbl,
        row_key: r.row_key,
        data: r.data ?? {},
        deleted: !!r.deleted,
        device_id: device,
        client_updated_at: new Date(r.client_updated_at).toISOString(),
        server_updated_at: this.nowIso(),
        seq: ++this.seq,
      })
      applied++
    }
    return json(applied)
  }
}
