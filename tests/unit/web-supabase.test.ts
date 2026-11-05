import { describe, expect, it } from 'vitest'
import {
  CloudError,
  memoryKV,
  normalizeConfig,
  parseSession,
  STORAGE_KEYS,
  SupabaseClient,
  type KV,
} from '../../web/src/lib/supabase'

const URL_ = 'https://demo.supabase.co'
const KEY = 'anon-key-0123456789abcdefghij'

interface Call {
  url: string
  method: string
  headers: Headers
  body: unknown
}

function fakeFetch(handler: (c: Call) => Response | Promise<Response>) {
  const calls: Call[] = []
  const impl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const call: Call = {
      url: String(input),
      method: init?.method ?? 'GET',
      headers: new Headers(init?.headers),
      body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined,
    }
    calls.push(call)
    return handler(call)
  }) as typeof fetch
  return { impl, calls }
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

const tokenBody = (access: string, expiresIn = 3600) => ({
  access_token: access,
  refresh_token: `refresh-${access}`,
  expires_in: expiresIn,
  user: { id: 'user-1', email: 'learner@example.com' },
})

function signedInStorage(expiresAt: number): KV {
  return memoryKV({
    [STORAGE_KEYS.config]: JSON.stringify({ url: URL_, anonKey: KEY }),
    [STORAGE_KEYS.session]: JSON.stringify({
      accessToken: 'old',
      refreshToken: 'refresh-old',
      expiresAt,
      user: { id: 'user-1', email: 'learner@example.com' },
    }),
  })
}

describe('web supabase config', () => {
  it('normalises the URL to its origin and validates the anon key', () => {
    expect(normalizeConfig(' https://demo.supabase.co/rest/v1/ ', ` ${KEY} `)).toEqual({ url: URL_, anonKey: KEY })
    expect(normalizeConfig('http://localhost:54321', KEY).url).toBe('http://localhost:54321')
    expect(() => normalizeConfig('http://demo.supabase.co', KEY)).toThrow(CloudError)
    expect(() => normalizeConfig('not a url', KEY)).toThrow(/URL/)
    expect(() => normalizeConfig(URL_, 'short')).toThrow(/Anon key/)
  })

  it('prefers the stored config over build defaults and clears the session when the server changes', () => {
    const storage = signedInStorage(Date.now() + 3_600_000)
    const client = new SupabaseClient({ storage, defaults: { url: 'https://built-in.supabase.co', anonKey: KEY } })
    expect(client.config()?.url).toBe(URL_)
    expect(client.hasBuiltInConfig()).toBe(true)
    client.configure(URL_, KEY) // same server: session kept
    expect(client.session()).not.toBeNull()
    client.configure('https://other.supabase.co', KEY)
    expect(client.session()).toBeNull()
    client.clearConfig()
    expect(client.config()?.url).toBe('https://built-in.supabase.co')
  })

  it('has no config without defaults or setup', () => {
    const client = new SupabaseClient({ storage: memoryKV() })
    expect(client.config()).toBeNull()
    expect(client.hasBuiltInConfig()).toBe(false)
  })

  it('parses token responses with expires_at or expires_in', () => {
    expect(parseSession({ ...tokenBody('a'), expires_at: 2_000 }, 0).expiresAt).toBe(2_000_000)
    expect(parseSession(tokenBody('a', 60), 1_000).expiresAt).toBe(61_000)
    expect(() => parseSession({ access_token: 'x' }, 0)).toThrow(CloudError)
  })
})

describe('web supabase auth', () => {
  it('sends the one-time code with the anon key', async () => {
    const { impl, calls } = fakeFetch(() => json({}))
    const client = new SupabaseClient({ storage: memoryKV(), fetchImpl: impl, defaults: { url: URL_, anonKey: KEY } })
    await client.sendCode('  Learner@Example.com ')
    expect(calls).toHaveLength(1)
    expect(calls[0]?.url).toBe(`${URL_}/auth/v1/otp`)
    expect(calls[0]?.headers.get('apikey')).toBe(KEY)
    expect(calls[0]?.headers.get('authorization')).toBe(`Bearer ${KEY}`)
    expect(calls[0]?.body).toEqual({ email: 'learner@example.com', create_user: true })
    await expect(client.sendCode('nope')).rejects.toMatchObject({ code: 'invalid_email' })
    expect(calls).toHaveLength(1)
  })

  it('verifies the 6-digit code (type email) and stores the session', async () => {
    const { impl, calls } = fakeFetch(() => json(tokenBody('fresh')))
    const storage = memoryKV()
    let changes = 0
    const client = new SupabaseClient({
      storage,
      fetchImpl: impl,
      now: () => 1_000,
      defaults: { url: URL_, anonKey: KEY },
    })
    client.onChange(() => changes++)
    const s = await client.verifyCode('learner@example.com', '123 456')
    expect(calls[0]?.url).toBe(`${URL_}/auth/v1/verify`)
    expect(calls[0]?.body).toEqual({ type: 'email', email: 'learner@example.com', token: '123456' })
    expect(s.accessToken).toBe('fresh')
    expect(client.session()?.user.id).toBe('user-1')
    expect(JSON.parse(storage.get(STORAGE_KEYS.session) ?? '{}').refreshToken).toBe('refresh-fresh')
    expect(changes).toBe(1)
  })

  it('maps a rejected code to invalid_code and checks the format locally', async () => {
    const { impl, calls } = fakeFetch(() => json({ msg: 'Token has expired or is invalid' }, 403))
    const client = new SupabaseClient({ storage: memoryKV(), fetchImpl: impl, defaults: { url: URL_, anonKey: KEY } })
    await expect(client.verifyCode('a@b.co', '000000')).rejects.toMatchObject({ code: 'invalid_code' })
    await expect(client.verifyCode('a@b.co', '12ab')).rejects.toMatchObject({ code: 'invalid_code' })
    expect(calls).toHaveLength(1)
  })

  it('refreshes an expiring token once, even for concurrent callers', async () => {
    const { impl, calls } = fakeFetch(async (c) => {
      if (c.url.includes('grant_type=refresh_token')) {
        await new Promise((r) => setTimeout(r, 5))
        return json(tokenBody('renewed'))
      }
      return json([])
    })
    const now = 1_000_000
    const client = new SupabaseClient({ storage: signedInStorage(now + 30_000), fetchImpl: impl, now: () => now })
    const [a, b] = await Promise.all([client.accessToken(), client.accessToken()])
    expect(a).toBe('renewed')
    expect(b).toBe('renewed')
    const refreshes = calls.filter((c) => c.url.includes('refresh_token'))
    expect(refreshes).toHaveLength(1)
    expect(refreshes[0]?.body).toEqual({ refresh_token: 'refresh-old' })
    expect(await client.accessToken()).toBe('renewed') // now valid: no further call
    expect(calls).toHaveLength(1)
  })

  it('signs out locally when the refresh token is rejected', async () => {
    const { impl } = fakeFetch(() => json({ error: 'invalid_grant' }, 400))
    const client = new SupabaseClient({ storage: signedInStorage(0), fetchImpl: impl, now: () => 10_000 })
    await expect(client.accessToken()).rejects.toMatchObject({ code: 'not_signed_in' })
    expect(client.session()).toBeNull()
  })

  it('retries a request once after a 401 with a refreshed token', async () => {
    let restCalls = 0
    const { impl, calls } = fakeFetch((c) => {
      if (c.url.includes('refresh_token')) return json(tokenBody('second'))
      restCalls++
      return restCalls === 1 ? json({ message: 'JWT expired' }, 401) : json([{ ok: true }])
    })
    const client = new SupabaseClient({ storage: signedInStorage(Date.now() + 3_600_000), fetchImpl: impl })
    const rows = await client.json<{ ok: boolean }[]>('/rest/v1/sync_rows?select=tbl')
    expect(rows).toEqual([{ ok: true }])
    const rest = calls.filter((c) => c.url.includes('/rest/v1/'))
    expect(rest.map((c) => c.headers.get('authorization'))).toEqual(['Bearer old', 'Bearer second'])
  })

  it('maps HTTP errors and network failures to CloudError codes', async () => {
    const storage = signedInStorage(Date.now() + 3_600_000)
    const notFound = new SupabaseClient({ storage, fetchImpl: fakeFetch(() => json({ message: 'nope' }, 404)).impl })
    await expect(notFound.invoke('tutor', {})).rejects.toMatchObject({ code: 'not_found', status: 404 })
    const limited = new SupabaseClient({ storage, fetchImpl: fakeFetch(() => json({}, 429)).impl })
    await expect(limited.rpc('sync_push', {})).rejects.toMatchObject({ code: 'rate_limited' })
    const offline = new SupabaseClient({
      storage,
      fetchImpl: (async () => {
        throw new TypeError('Failed to fetch')
      }) as typeof fetch,
    })
    await expect(offline.json('/rest/v1/x')).rejects.toMatchObject({ code: 'network' })
  })

  it('signs out with scope=local (the desktop stays signed in) and forgets the session', async () => {
    const { impl, calls } = fakeFetch(() => new Response(null, { status: 204 }))
    const client = new SupabaseClient({ storage: signedInStorage(Date.now() + 3_600_000), fetchImpl: impl })
    await client.signOut()
    expect(calls[0]?.url).toBe(`${URL_}/auth/v1/logout?scope=local`)
    expect(calls[0]?.headers.get('authorization')).toBe('Bearer old')
    expect(client.session()).toBeNull()
  })
})
