// CloudClient against a fake Supabase: server config, email OTP sign-in, encrypted session storage,
// token refresh (before expiry, on 401, revoked), request paths/headers for REST, RPC, Storage, Functions.
import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { CloudError } from '../../src/main/kernel/cloud/client'
import { FAKE_ANON, FAKE_URL, FakeCloud } from '../helpers/fakeCloud'
import { makeApp } from '../helpers/kernel'

const EMAIL = 'Lan.Nguyen@example.com'

async function setup(opts: { configure?: boolean } = {}) {
  const server = new FakeCloud()
  let t = Date.parse('2026-11-05T08:00:00.000Z')
  const clock = {
    advance: (ms: number) => {
      t += ms
    },
  }
  const app = await makeApp({ fetchImpl: server.fetch, now: () => new Date(t) })
  if (opts.configure !== false) app.kernel.cloud.configure(FAKE_URL, FAKE_ANON)
  const signIn = async () => {
    await app.kernel.cloud.sendCode(EMAIL)
    return app.kernel.cloud.verifyCode(EMAIL, server.code(EMAIL))
  }
  return { server, clock, ...app, cloud: app.kernel.cloud, signIn }
}

const errCode = async (p: Promise<unknown>) => {
  try {
    await p
  } catch (err) {
    return err instanceof CloudError ? err.code : `other:${String(err)}`
  }
  return 'no error'
}

describe('cloud client – configuration', () => {
  it('reports not_configured until a server is set, and the IPC error points to account settings', async () => {
    const { cloud, call, server } = await setup({ configure: false })
    expect(cloud.status()).toMatchObject({ configured: false, signedIn: false, url: null })
    expect(await errCode(cloud.sendCode(EMAIL))).toBe('not_configured')
    expect(await errCode(cloud.rpc('sync_push', { rows: [] }))).toBe('not_configured')
    expect(await errCode(cloud.download('backups', 'x/y.sqlite'))).toBe('not_configured')
    await expect(call('cloud:sendCode', { email: EMAIL })).rejects.toMatchObject({
      ipc: { code: 'cloud_not_configured', hint: 'account-settings' },
    })
    await expect(call('sync:now')).rejects.toMatchObject({ ipc: { code: 'cloud_not_signed_in' } })
    expect(server.requests).toHaveLength(0)
  })

  it('validates URL and anon key, normalises to the origin and keeps the config in settings', async () => {
    const { cloud, call } = await setup({ configure: false })
    expect(() => cloud.configure('http://lqtest.supabase.co', FAKE_ANON)).toThrow(/https/)
    expect(() => cloud.configure('not a url', FAKE_ANON)).toThrow(CloudError)
    expect(() => cloud.configure(FAKE_URL, 'short')).toThrow(/Anon key/)
    expect(() => cloud.configure(FAKE_URL, 'has spaces in the key 1234567890')).toThrow(CloudError)
    const st = await call<{ configured: boolean; url: string }>('cloud:configure', {
      url: `${FAKE_URL}/rest/v1/`,
      anonKey: FAKE_ANON,
    })
    expect(st).toMatchObject({ configured: true, url: FAKE_URL })
    expect(cloud.config()).toEqual({ url: FAKE_URL, anonKey: FAKE_ANON })
    // localhost over http is allowed for a local Supabase (supabase start)
    expect(() => cloud.configure('http://localhost:54321', FAKE_ANON)).not.toThrow()
  })

  it('uses build-time defaults when nothing is configured', async () => {
    const server = new FakeCloud()
    const { CloudClient } = await import('../../src/main/kernel/cloud/client')
    const { kernel } = await makeApp({ fetchImpl: server.fetch })
    const c = new CloudClient({
      keys: kernel.keys,
      settings: kernel.settings,
      fetchImpl: server.fetch,
      defaults: { url: `${FAKE_URL}/`, anonKey: FAKE_ANON },
    })
    expect(c.config()).toEqual({ url: FAKE_URL, anonKey: FAKE_ANON })
  })
})

describe('cloud client – email OTP sign-in', () => {
  it('sends the code with the anon key, verifies it and stores the session', async () => {
    const { cloud, server, signIn } = await setup()
    const st = await signIn()
    const otp = server.requests.find((r) => r.path === '/auth/v1/otp')
    expect(otp?.method).toBe('POST')
    expect(otp?.headers.apikey).toBe(FAKE_ANON)
    expect(otp?.headers.authorization).toBe(`Bearer ${FAKE_ANON}`)
    expect(otp?.body).toEqual({ email: EMAIL.toLowerCase(), create_user: true })
    const verify = server.requests.find((r) => r.path === '/auth/v1/verify')
    expect(verify?.body).toMatchObject({ type: 'email', email: EMAIL.toLowerCase() })
    expect(st).toMatchObject({ signedIn: true, email: EMAIL.toLowerCase(), userId: server.userId(EMAIL) })
    expect(cloud.isSignedIn()).toBe(true)
  })

  it('rejects a wrong code, invalid e-mails and maps rate limits', async () => {
    const { cloud, server, call } = await setup()
    expect(await errCode(cloud.sendCode('not-an-email'))).toBe('bad_request')
    await cloud.sendCode(EMAIL)
    const wrong = server.code(EMAIL) === '000000' ? '111111' : '000000'
    expect(await errCode(cloud.verifyCode(EMAIL, wrong))).toBe('invalid_code')
    expect(cloud.isSignedIn()).toBe(false)
    server.rateLimitOtp = true
    await expect(call('cloud:sendCode', { email: EMAIL })).rejects.toMatchObject({
      ipc: { code: 'cloud_rate_limited' },
    })
    await expect(call('cloud:verifyCode', { email: EMAIL, code: 'abc' })).rejects.toMatchObject({
      ipc: { code: 'invalid_input' },
    })
  })

  it('keeps the session encrypted in keys.bin – never in plain text, never in the database', async () => {
    const { cloud, server, signIn, kernel, dir } = await setup()
    await signIn()
    const s = server.sessions[0]!
    const file = fs.readFileSync(path.join(dir, 'secure', 'keys.bin'), 'utf8')
    expect(file).toContain('"cloud"')
    expect(file).not.toContain(s.access)
    expect(file).not.toContain(s.refresh)
    const encoded = kernel.keys.get('cloud') as string
    expect(file).not.toContain(encoded)
    expect(file).not.toContain(EMAIL.toLowerCase())
    const dump = JSON.stringify(kernel.db.all('SELECT * FROM app_settings'))
    expect(dump).not.toContain(s.access)
    expect(dump).not.toContain(s.refresh)
    expect(cloud.session()?.accessToken).toBe(s.access)
  })

  it('signs out on the server and locally, even when offline', async () => {
    const { cloud, server, signIn, call } = await setup()
    await signIn()
    const st = await call<{ signedIn: boolean }>('cloud:signOut')
    expect(st.signedIn).toBe(false)
    expect(server.requests.some((r) => r.path === '/auth/v1/logout' && r.url.includes('scope=global'))).toBe(true)
    expect(server.sessions[0]!.refreshValid).toBe(false)
    await signIn()
    server.down = true
    await cloud.signOut()
    expect(cloud.isSignedIn()).toBe(false)
  })

  it('changing the server URL drops the session', async () => {
    const { cloud, signIn } = await setup()
    await signIn()
    cloud.configure(FAKE_URL, `${FAKE_ANON}-rotated`) // same server, new key: stay signed in
    expect(cloud.session()).not.toBeNull()
    cloud.configure('https://other.supabase.co', FAKE_ANON)
    expect(cloud.session()).toBeNull()
  })
})

describe('cloud client – tokens', () => {
  it('refreshes the access token shortly before it expires (once for concurrent requests)', async () => {
    const { cloud, server, signIn, clock } = await setup()
    await signIn()
    const first = server.sessions[0]!.access
    await cloud.json('/rest/v1/devices?select=*')
    expect(server.requests.filter((r) => r.url.includes('grant_type=refresh_token'))).toHaveLength(0)
    clock.advance((3600 - 30) * 1000) // 30 s left → refresh first
    await Promise.all([cloud.json('/rest/v1/devices?select=*'), cloud.json('/rest/v1/devices?select=*')])
    expect(server.requests.filter((r) => r.url.includes('grant_type=refresh_token'))).toHaveLength(1)
    const latest = server.sessions[server.sessions.length - 1]!.access
    expect(latest).not.toBe(first)
    expect(server.requests[server.requests.length - 1]!.headers.authorization).toBe(`Bearer ${latest}`)
    expect(cloud.session()?.accessToken).toBe(latest)
  })

  it('refreshes once and retries when the server answers 401', async () => {
    const { cloud, server, signIn } = await setup()
    await signIn()
    server.expireAccessTokens()
    const n = await cloud.rpc<number>('sync_push', { rows: [], device: null })
    expect(n).toBe(0)
    const paths = server.requests.slice(-3).map((r) => `${r.path}:${r.method}`)
    expect(paths).toEqual(['/rest/v1/rpc/sync_push:POST', '/auth/v1/token:POST', '/rest/v1/rpc/sync_push:POST'])
  })

  it('a revoked refresh token signs the user out', async () => {
    const { cloud, server, signIn, call } = await setup()
    await signIn()
    server.expireAccessTokens()
    server.revokeRefreshTokens()
    expect(await errCode(cloud.json('/rest/v1/devices?select=*'))).toBe('not_signed_in')
    expect(cloud.isSignedIn()).toBe(false)
    expect(cloud.session()).toBeNull()
    await expect(call('cloud:backups')).rejects.toMatchObject({
      ipc: { code: 'cloud_not_signed_in', hint: 'account-settings' },
    })
  })

  it('keeps the session when the network is down', async () => {
    const { cloud, server, signIn, clock } = await setup()
    await signIn()
    server.down = true
    clock.advance(3600 * 1000)
    expect(await errCode(cloud.json('/rest/v1/devices?select=*'))).toBe('network')
    expect(cloud.session()).not.toBeNull()
  })
})

describe('cloud client – request paths and headers', () => {
  it('sends apikey + Bearer user token to PostgREST, RPC, Storage and Functions', async () => {
    const { cloud, server, signIn } = await setup()
    await signIn()
    const uid = server.userId(EMAIL)
    const token = server.sessions[0]!.access
    server.requests.length = 0

    await cloud.rpc('sync_push', { rows: [], device: null })
    await cloud.upload('backups', `${uid}/lingua quest.sqlite`, new Uint8Array([1, 2, 3]))
    const listed = await cloud.list('backups', uid)
    const bytes = await cloud.download('backups', `${uid}/lingua quest.sqlite`)
    await cloud.remove('backups', [`${uid}/lingua quest.sqlite`])
    const fn = await cloud.invoke<{ name: string }>('tutor', { text: 'hi' })

    expect(listed.map((o) => o.name)).toEqual(['lingua quest.sqlite'])
    expect([...bytes]).toEqual([1, 2, 3])
    expect(fn.name).toBe('tutor')
    expect(server.requests.map((r) => `${r.method} ${r.url}`)).toEqual([
      'POST /rest/v1/rpc/sync_push',
      `POST /storage/v1/object/backups/${uid}/lingua%20quest.sqlite`,
      'POST /storage/v1/object/list/backups',
      `GET /storage/v1/object/authenticated/backups/${uid}/lingua%20quest.sqlite`,
      'DELETE /storage/v1/object/backups',
      'POST /functions/v1/tutor',
    ])
    for (const r of server.requests) {
      expect(r.headers.apikey).toBe(FAKE_ANON)
      expect(r.headers.authorization).toBe(`Bearer ${token}`)
    }
    expect(server.requests[0]!.headers['content-type']).toBe('application/json')
    expect(server.requests[1]!.headers['x-upsert']).toBe('true')
    expect(server.requests[2]!.body).toMatchObject({ prefix: uid })
    expect(server.requests[4]!.body).toEqual({ prefixes: [`${uid}/lingua quest.sqlite`] })
    expect(server.objects.size).toBe(0)
  })

  it('maps HTTP errors to CloudError codes', async () => {
    const { cloud, signIn } = await setup()
    await signIn()
    expect(await errCode(cloud.download('backups', 'someone-else/x.sqlite'))).toBe('bad_request') // 404
    expect(await errCode(cloud.upload('backups', 'someone-else/x.sqlite', new Uint8Array([1])))).toBe('forbidden')
    expect(await errCode(cloud.json('/rest/v1/nope'))).toBe('bad_request')
  })
})
