// Minimal PostgREST client for the Edge Functions. It authenticates with the service role key (which bypasses
// Row Level Security), so every query on per-user data goes through `forUser(userId)`, which adds
// `user_id=eq.<id>` to each filter and stamps user_id on each inserted row. No SDK: plain fetch, easy to fake.

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>

export class RestError extends Error {
  constructor(
    readonly status: number,
    readonly body: string,
    readonly path: string,
  ) {
    super(`Supabase REST ${status} on ${path.split('?')[0]}: ${body.slice(0, 200)}`)
    this.name = 'RestError'
  }
}

/** Filters as [column, "op.value"] pairs, e.g. [['code', 'eq.123456'], ['data->>date', 'gte.2026-11-01']]. */
export type Filters = [string, string][]

export interface QueryOptions {
  select?: string
  order?: string
  limit?: number
  offset?: number
}

export interface InsertOptions {
  /** Comma-separated conflict columns for an upsert. */
  onConflict?: string
  /** 'merge' updates the existing row, 'ignore' keeps it (insert only when new). */
  resolution?: 'merge' | 'ignore'
  /** Return the written rows (needed to know whether an ignore-duplicates insert wrote anything). */
  returning?: boolean
}

export const eq = (v: string | number | boolean) => `eq.${String(v)}`
export const inList = (values: string[]) => `in.(${values.map((v) => `"${v.replace(/"/g, '\\"')}"`).join(',')})`

function buildQuery(filters: Filters, opts: QueryOptions = {}): string {
  const p = new URLSearchParams()
  p.set('select', opts.select ?? '*')
  for (const [k, v] of filters) p.append(k, v)
  if (opts.order) p.set('order', opts.order)
  if (opts.limit !== undefined) p.set('limit', String(opts.limit))
  if (opts.offset !== undefined) p.set('offset', String(opts.offset))
  return p.toString()
}

export class SupabaseRest {
  readonly url: string

  constructor(
    url: string,
    private readonly serviceKey: string,
    private readonly fetchImpl: FetchLike = (input, init) => fetch(input, init),
  ) {
    this.url = url.replace(/\/+$/, '')
  }

  private async request(path: string, init: RequestInit = {}): Promise<Response> {
    const headers = new Headers(init.headers)
    headers.set('apikey', this.serviceKey)
    headers.set('authorization', `Bearer ${this.serviceKey}`)
    if (init.body && !headers.has('content-type')) headers.set('content-type', 'application/json')
    const res = await this.fetchImpl(`${this.url}${path}`, { ...init, headers })
    if (!res.ok) throw new RestError(res.status, await res.text().catch(() => ''), path)
    return res
  }

  private static async rows<T>(res: Response): Promise<T[]> {
    const text = await res.text()
    if (!text) return []
    const data = JSON.parse(text) as unknown
    return (Array.isArray(data) ? data : [data]) as T[]
  }

  async select<T>(table: string, filters: Filters, opts: QueryOptions = {}): Promise<T[]> {
    return SupabaseRest.rows<T>(await this.request(`/rest/v1/${table}?${buildQuery(filters, opts)}`))
  }

  async insert<T = Record<string, unknown>>(
    table: string,
    rows: Record<string, unknown>[],
    opts: InsertOptions = {},
  ): Promise<T[]> {
    if (!rows.length) return []
    const prefer: string[] = [opts.returning ? 'return=representation' : 'return=minimal']
    if (opts.resolution) prefer.push(`resolution=${opts.resolution === 'merge' ? 'merge' : 'ignore'}-duplicates`)
    const q = opts.onConflict ? `?on_conflict=${encodeURIComponent(opts.onConflict)}` : ''
    const res = await this.request(`/rest/v1/${table}${q}`, {
      method: 'POST',
      headers: { prefer: prefer.join(',') },
      body: JSON.stringify(rows),
    })
    return opts.returning ? SupabaseRest.rows<T>(res) : []
  }

  async update(table: string, filters: Filters, patch: Record<string, unknown>): Promise<void> {
    if (!filters.length) throw new Error('update without filter')
    const p = new URLSearchParams(filters)
    await this.request(`/rest/v1/${table}?${p.toString()}`, {
      method: 'PATCH',
      headers: { prefer: 'return=minimal' },
      body: JSON.stringify(patch),
    })
  }

  async remove(table: string, filters: Filters): Promise<void> {
    if (!filters.length) throw new Error('delete without filter')
    const p = new URLSearchParams(filters)
    await this.request(`/rest/v1/${table}?${p.toString()}`, { method: 'DELETE', headers: { prefer: 'return=minimal' } })
  }

  /** Scoped access to one user's rows: user_id is always part of the filter / row. */
  forUser(userId: string): UserRest {
    if (!/^[0-9a-f-]{36}$/i.test(userId)) throw new Error('invalid user id')
    return new UserRest(this, userId)
  }

  /** Verifies a user's access token with GoTrue (GET /auth/v1/user). Returns null when invalid. */
  async authUser(jwt: string, anonKey: string): Promise<{ id: string; email: string | null } | null> {
    if (!jwt) return null
    let res: Response
    try {
      res = await this.fetchImpl(`${this.url}/auth/v1/user`, {
        headers: { apikey: anonKey || this.serviceKey, authorization: `Bearer ${jwt}` },
      })
    } catch {
      return null
    }
    if (!res.ok) return null
    const u = (await res.json().catch(() => null)) as { id?: string; email?: string } | null
    return u?.id ? { id: u.id, email: u.email ?? null } : null
  }
}

export class UserRest {
  constructor(
    private readonly rest: SupabaseRest,
    readonly userId: string,
  ) {}

  private scope(filters: Filters): Filters {
    return [['user_id', eq(this.userId)], ...filters.filter(([k]) => k !== 'user_id')]
  }

  select<T>(table: string, filters: Filters = [], opts: QueryOptions = {}): Promise<T[]> {
    return this.rest.select<T>(table, this.scope(filters), opts)
  }

  insert<T = Record<string, unknown>>(
    table: string,
    rows: Record<string, unknown>[],
    opts: InsertOptions = {},
  ): Promise<T[]> {
    return this.rest.insert<T>(
      table,
      rows.map((r) => ({ ...r, user_id: this.userId })),
      opts,
    )
  }

  update(table: string, filters: Filters, patch: Record<string, unknown>): Promise<void> {
    const { user_id: _ignored, ...rest } = patch
    return this.rest.update(table, this.scope(filters), rest)
  }

  remove(table: string, filters: Filters = []): Promise<void> {
    return this.rest.remove(table, this.scope(filters))
  }
}
