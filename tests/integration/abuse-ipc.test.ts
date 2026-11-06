// IPC abuse fuzzer: every channel in CONTRACT gets a valid sample plus hundreds of hostile variants (wrong
// types, missing / extra / prototype-pollution keys, NaN / Infinity / huge numbers, 100k-char, emoji, RTL,
// zero-width, HTML, SQL and regex strings, ids that do not exist, empty and >25 MB binaries).
// Invariants: dispatch never throws or hangs, user-input problems never surface as 'internal', results are
// structured-cloneable (Electron IPC), no secret or stack trace leaks into an error, and the database stays
// consistent (PRAGMA integrity_check + foreign_key_check) after every channel.
import { afterAll, describe, expect, it } from 'vitest'
import { CONTRACT } from '../../src/modules/contract'
import type { KernelLog } from '../../src/main/kernel'
import { SECRET_GEMINI, SECRET_OPENAI, variants, withTimeout } from '../helpers/fuzz'
import { makeApp } from '../helpers/kernel'

/**
 * AI providers answer 401 with a body that echoes the key (some providers do): it must never reach the renderer.
 * Everything else (Supabase, Telegram) is unreachable. No retries/back-off, so the pass stays fast.
 */
const offlineFetch: typeof fetch = (input) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
  if (/googleapis|openai/.test(url))
    return Promise.resolve(
      new Response(JSON.stringify({ error: { message: `API key not valid: ${SECRET_GEMINI} ${SECRET_OPENAI}` } }), {
        status: 401,
        headers: { 'content-type': 'application/json' },
      }),
    )
  return Promise.reject(new TypeError('fetch failed: offline (test)'))
}

const groups = new Map<string, string[]>()
for (const ch of Object.keys(CONTRACT)) {
  const prefix = ch.split(':')[0] as string
  groups.set(prefix, [...(groups.get(prefix) ?? []), ch])
}

const totals = { dispatches: 0, ok: 0, invalid: 0, otherErrors: 0, channels: 0 }

async function fuzzGroup(channels: string[], mockAi: boolean) {
  const logged: string[] = []
  const log: KernelLog = { info: () => undefined, warn: () => undefined, error: (m) => logged.push(m) }
  const { router, kernel, call } = await makeApp({
    persistent: true,
    mockAi,
    telegram: 'real',
    fetchImpl: offlineFetch,
    log,
  })
  await call('ai:setKey', { provider: 'gemini', key: SECRET_GEMINI })
  await call('ai:setKey', { provider: 'openai', key: SECRET_OPENAI })
  // Some data so ids 1..n exist for update/delete/review style channels.
  await call('vocab:save', { word: 'lighthouse', meaningVi: 'ngọn hải đăng', sourceModule: 'manual' })
  await call('vocab:save', { word: 'resilient', meaningVi: 'kiên cường', sourceModule: 'reading' })

  const problems: string[] = []
  for (const channel of channels) {
    const schema = (CONTRACT as Record<string, { input: Parameters<typeof variants>[0] }>)[channel]!.input
    totals.channels++
    for (const v of variants(schema)) {
      totals.dispatches++
      const label = `${channel} [${v.desc}]`
      let res: Awaited<ReturnType<typeof router.dispatch>>
      try {
        res = await withTimeout(router.dispatch(channel, v.payload), 15_000, label)
      } catch (err) {
        problems.push(`${label} THREW ${String(err)}`)
        continue
      }
      try {
        structuredClone(res)
      } catch (err) {
        problems.push(`${label} result not cloneable: ${String(err)}`)
      }
      if (res.ok) {
        totals.ok++
        continue
      }
      if (res.error.code === 'invalid_input') totals.invalid++
      else totals.otherErrors++
      const msg = res.error.message
      if (res.error.code === 'internal') problems.push(`${label} → internal (${logged.at(-1) ?? 'no log'})`)
      if (typeof msg !== 'string' || !msg.trim()) problems.push(`${label} → empty error message`)
      if (msg.includes(SECRET_GEMINI) || msg.includes(SECRET_OPENAI)) problems.push(`${label} → secret in message`)
      if (/\n\s+at |node:internal|[A-Z]:\\.*\.ts/.test(msg)) problems.push(`${label} → stack/path in message`)
      if (msg.length > 600) problems.push(`${label} → message too long (${msg.length})`)
    }
    const integrity = kernel.db.value('PRAGMA integrity_check')
    if (integrity !== 'ok') problems.push(`${channel}: integrity_check = ${String(integrity)}`)
    const fk = kernel.db.all('PRAGMA foreign_key_check')
    if (fk.length) problems.push(`${channel}: foreign_key_check = ${JSON.stringify(fk.slice(0, 3))}`)
    if (({} as Record<string, unknown>).polluted !== undefined) problems.push(`${channel}: Object.prototype polluted`)
  }
  // Server-side length caps: nothing a learner typed may be stored unbounded (100k-char inputs above).
  const tables = kernel.db.all<{ name: string }>("SELECT name FROM sqlite_master WHERE type = 'table'")
  for (const { name } of tables) {
    for (const col of kernel.db.all<{ name: string; type: string }>(`PRAGMA table_info(${name})`)) {
      if (!/TEXT/i.test(col.type)) continue
      const max = Number(kernel.db.value(`SELECT MAX(LENGTH("${col.name}")) FROM ${name}`) ?? 0)
      if (max > 20_000) problems.push(`${name}.${col.name} stores ${max} chars`)
    }
  }
  for (const line of logged) {
    if (line.includes(SECRET_GEMINI) || line.includes(SECRET_OPENAI)) problems.push(`secret in log: ${line}`)
  }
  kernel.db.close()
  // Collapse repeats of the same failure so the report stays readable.
  const seen = new Map<string, number>()
  for (const p of problems) {
    const key = p.replace(/\[[^\]]*\]/, '[…]')
    seen.set(key, (seen.get(key) ?? 0) + 1)
  }
  return [...seen].map(([k, n]) => (n > 1 ? `${k} ×${n}` : k))
}

describe('IPC abuse fuzzer', () => {
  for (const [prefix, channels] of groups) {
    it(`survives hostile input on every ${prefix}:* channel (${channels.length})`, { timeout: 300_000 }, async () => {
      const problems = await fuzzGroup(channels, true)
      expect(problems).toEqual([])
    })
  }

  // Same abuse with real providers configured but the network down: every AI / cloud / Telegram path fails
  // and must still answer with a coded, Vietnamese error.
  for (const [prefix, channels] of groups) {
    it(`survives hostile input on ${prefix}:* with AI providers rejecting the key`, { timeout: 300_000 }, async () => {
      const problems = await fuzzGroup(channels, false)
      expect(problems).toEqual([])
    })
  }

  afterAll(() => {
    console.warn(`[abuse-ipc] ${JSON.stringify(totals)}`)
  })
})
