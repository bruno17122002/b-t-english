// Data integrity abuse: database file deleted / truncated / replaced with garbage between runs, the .bak copy
// damaged as well, keys.bin damaged or written on another machine, hand-edited settings rows, an invalid
// content item, a 20 000-word database (timed), hostile import files and restore while writes are pending.
import fs from 'node:fs'
import path from 'node:path'
import { performance } from 'node:perf_hooks'
import { describe, expect, it } from 'vitest'
import type { BootstrapData } from '../../src/shared/kernelContract'
import type { AppSettings, VocabItem } from '../../src/shared/types'
import { ContentRegistry } from '../../src/main/kernel/content/registry'
import { KeyStore } from '../../src/main/kernel/secure/keyStore'
import { IMPORT_MAX_ROWS } from '../../src/main/kernel/data/dataService'
import grammarJson from '../../src/content/grammar.json'
import { FAKE_ANON, FAKE_URL, FakeCloud } from '../helpers/fakeCloud'
import { makeApp, makeKernel, tempDir } from '../helpers/kernel'

type App = Awaited<ReturnType<typeof makeApp>>

/** A persistent app with three words, saved twice so that both the file and its .bak exist. */
async function persistentApp(dir = tempDir()) {
  const app = await makeApp({ persistent: true, dir })
  for (const word of ['anchor', 'harbour', 'lighthouse']) await app.call('vocab:save', { word, sourceModule: 'manual' })
  app.kernel.db.flush()
  await app.call('vocab:save', { word: 'compass', sourceModule: 'manual' })
  app.kernel.db.flush()
  app.kernel.db.close()
  return { dir, dbFile: path.join(dir, 'data', 'lq.sqlite') }
}

const words = (app: App) => Number(app.kernel.db.value('SELECT COUNT(*) FROM vocabulary') ?? 0)

describe('damaged database file between runs', () => {
  it('a deleted database starts fresh', async () => {
    const { dir, dbFile } = await persistentApp()
    fs.rmSync(dbFile)
    fs.rmSync(`${dbFile}.bak`)
    const app = await makeApp({ persistent: true, dir })
    expect(words(app)).toBe(0)
    expect((await app.call<BootstrapData>('app:bootstrap')).dataRecovery).toBeNull()
  })

  it.each([
    ['truncated to 0 bytes', () => Buffer.alloc(0)],
    ['cut in half', (b: Buffer) => b.subarray(0, Math.floor(b.length / 2))],
    ['replaced with random bytes', (b: Buffer) => Buffer.from(b.map((_, i) => (i * 7919) % 251))],
    ['header kept, pages zeroed', (b: Buffer) => Buffer.concat([b.subarray(0, 100), Buffer.alloc(b.length - 100)])],
    ['a text file', () => Buffer.from('hello, I am not a database\n'.repeat(100))],
  ])('a database file %s is recovered from the .bak copy', async (_label, damage) => {
    const { dir, dbFile } = await persistentApp()
    fs.writeFileSync(dbFile, damage(fs.readFileSync(dbFile)))
    const app = await makeApp({ persistent: true, dir })
    expect(words(app)).toBeGreaterThanOrEqual(3) // the .bak is one save behind
    const boot = await app.call<BootstrapData>('app:bootstrap')
    expect(boot.dataRecovery?.kind).toBe('backup')
    expect(fs.existsSync(boot.dataRecovery?.corruptFile ?? '')).toBe(true)
    // The recovered copy is written back as the main file right away: a second start is clean.
    app.kernel.db.close()
    const again = await makeApp({ persistent: true, dir })
    expect(again.kernel.db.recovery).toBeNull()
    expect(words(again)).toBeGreaterThanOrEqual(3)
  })

  it('database and .bak both damaged: starts empty with a clear flag instead of failing on every launch', async () => {
    const { dir, dbFile } = await persistentApp()
    fs.writeFileSync(dbFile, Buffer.alloc(4096, 0xab))
    fs.writeFileSync(`${dbFile}.bak`, Buffer.alloc(0))
    const app = await makeApp({ persistent: true, dir })
    const boot = await app.call<BootstrapData>('app:bootstrap')
    expect(boot.dataRecovery?.kind).toBe('fresh')
    expect(words(app)).toBe(0)
    // Usable: saving works and the next launch is normal (no crash loop).
    await app.call('vocab:save', { word: 'new start', sourceModule: 'manual' })
    app.kernel.db.close()
    const next = await makeApp({ persistent: true, dir })
    expect(next.kernel.db.recovery).toBeNull()
    expect(words(next)).toBe(1)
    // The damaged file is kept for support.
    expect(fs.readdirSync(path.dirname(dbFile)).some((f) => f.includes('.corrupt-'))).toBe(true)
  })

  it('a database from a newer app version fails with a Vietnamese message (no silent downgrade)', async () => {
    const { dir } = await persistentApp()
    const app = await makeApp({ persistent: true, dir })
    app.kernel.db.run("INSERT INTO schema_migrations(version, name, applied_at) VALUES (999, 'future', '2030-01-01')")
    app.kernel.db.close()
    await expect(makeApp({ persistent: true, dir })).rejects.toThrow(/phiên bản Lingua Quest mới hơn/)
  })
})

describe('damaged secrets and settings', () => {
  it.each([
    ['garbage bytes', Buffer.from([0xff, 0x00, 0x13, 0x37])],
    ['JSON null', Buffer.from('null')],
    ['JSON array', Buffer.from('["x"]')],
    ['wrong value types', Buffer.from('{"gemini": 123, "openai": {"a": 1}}')],
  ])('keys.bin with %s reads as "no key" and can be overwritten', async (_label, content) => {
    const dir = tempDir()
    const app = await makeApp({ dir })
    fs.mkdirSync(path.join(dir, 'secure'), { recursive: true })
    fs.writeFileSync(app.kernel.paths.keysFile, content)
    const boot = await app.router.dispatch('app:bootstrap', undefined)
    expect(boot.ok).toBe(true)
    const cfg = await app.call<{ providers: { gemini: { hasKey: boolean } } }>('ai:config')
    expect(cfg.providers.gemini.hasKey).toBe(false)
    await app.call('ai:setKey', { provider: 'gemini', key: 'AIzaSyFAKE-0123456789abcdefghijklmnop' })
    const after = await app.call<{ providers: { gemini: { hasKey: boolean } } }>('ai:config')
    expect(after.providers.gemini.hasKey).toBe(true)
  })

  it('a key encrypted on another machine / Windows user (DPAPI throws) reads as "no key"', () => {
    const file = path.join(tempDir(), 'keys.bin')
    fs.writeFileSync(file, '{"gemini": "bm90LW91ci1jaXBoZXJ0ZXh0"}')
    const store = new KeyStore(file, {
      isEncryptionAvailable: () => true,
      encryptString: (s) => Buffer.from(s),
      decryptString: () => {
        throw new Error('The data is invalid (DPAPI)')
      },
    })
    expect(store.get('gemini')).toBeNull()
    expect(store.hint('gemini')).toBeNull()
    expect(store.has('gemini')).toBe(false)
  })

  it('settings rows with invalid JSON or wrong types fall back to the defaults', async () => {
    const app = await makeApp()
    const rows: [string, string][] = [
      ['theme', '{not json'],
      ['dailyGoalXp', '"lots"'],
      ['reminderTime', '25:99'],
      ['speechRate', '1e308'],
      ['notificationsEnabled', '"yes"'],
      ['uiLanguage', 'null'],
      ['accent', '"x"'],
    ]
    for (const [k, v] of rows)
      app.kernel.db.run('INSERT OR REPLACE INTO app_settings(key, value) VALUES (?, ?)', [k, v])
    const s = await app.call<AppSettings>('settings:get')
    expect(s).toMatchObject({
      theme: 'dark',
      dailyGoalXp: 50,
      reminderTime: '20:00',
      speechRate: 1,
      notificationsEnabled: true,
      uiLanguage: 'vi',
      accent: 'x',
    })
  })

  it('an invalid content item is skipped and reported, the rest still loads', () => {
    const grammar = structuredClone(grammarJson) as unknown[]
    grammar.splice(1, 0, { id: 'BROKEN ID', title: 42 }, null, 'text')
    const reg = new ContentRegistry({
      reading: [],
      listening: 'not an array',
      grammar,
      writing: [],
      speaking: [],
      cinema: [],
      assessment: [],
      dictionary: [],
    })
    expect(reg.grammar()).toHaveLength((grammarJson as unknown[]).length)
    expect(reg.listening()).toEqual([])
    expect(reg.issues.filter((i) => i.collection === 'grammar')).toHaveLength(3)
    expect(reg.issues.some((i) => i.collection === 'listening')).toBe(true)
  })
})

describe('restore and backups under abuse', () => {
  it('restoring while writes are pending: later writes never overwrite the restored file', async () => {
    const dir = tempDir()
    const relaunched: number[] = []
    const app = await makeApp({ persistent: true, dir, host: { relaunch: () => relaunched.push(1) } })
    await app.call('vocab:save', { word: 'kept', sourceModule: 'manual' })
    const backup = await app.call<{ file: string }>('data:createBackup')
    // Pending (debounced) writes after the backup …
    await app.call('vocab:save', { word: 'lost-after-restore', sourceModule: 'manual' })
    await app.call('data:restoreBackup', { file: backup.file })
    // … and a click that arrives before the relaunch.
    const late = await app.router.dispatch('vocab:save', { word: 'too-late', sourceModule: 'manual' })
    expect(late).toMatchObject({ ok: false, error: { code: 'db_closed' } })
    await new Promise((r) => setTimeout(r, 400))
    expect(relaunched).toHaveLength(1)
    const reopened = await makeKernel({ persistent: true, dir })
    const list = reopened.kernel.db.all<{ word: string }>('SELECT word FROM vocabulary').map((r) => r.word)
    expect(list).toEqual(['kept'])
    // The pre-restore safety copy holds the newer word.
    const safety = fs.readdirSync(path.join(dir, 'backups')).find((f) => f.includes('pre-restore'))
    expect(safety).toBeDefined()
  })

  it('restoring a missing, non-SQLite, foreign or newer backup fails with invalid_backup in Vietnamese', async () => {
    const dir = tempDir()
    const app = await makeApp({ persistent: true, dir })
    const bad = (name: string, data: Buffer | string) => {
      const f = path.join(dir, name)
      fs.writeFileSync(f, data)
      return f
    }
    const other = await makeKernel({ persistent: true, dir: tempDir() })
    other.kernel.db.run("INSERT INTO schema_migrations(version, name, applied_at) VALUES (999, 'future', 'x')")
    other.kernel.db.flush()
    const foreign = path.join(tempDir(), 'foreign.sqlite')
    fs.writeFileSync(foreign, fs.readFileSync(other.kernel.paths.dbFile as string).subarray(0, 0))
    const cases: [string, string][] = [
      [path.join(dir, 'does-not-exist.sqlite'), 'invalid_backup'],
      [dir, 'invalid_backup'],
      [bad('x.sqlite', 'not sqlite at all'), 'invalid_backup'],
      [bad('empty.sqlite', ''), 'invalid_backup'],
      [other.kernel.paths.dbFile as string, 'backup_too_new'],
    ]
    for (const [file, code] of cases) {
      const res = await app.router.dispatch('data:restoreBackup', { file })
      expect(res, file).toMatchObject({ ok: false, error: { code } })
      if (!res.ok) expect(res.error.message.length).toBeLessThan(200)
    }
    // The live database is untouched.
    await app.call('vocab:save', { word: 'still-works', sourceModule: 'manual' })
  })

  it('two backups in the same second get distinct names', async () => {
    const app = await makeApp({ persistent: true, now: () => new Date(2026, 10, 5, 8, 0, 0) })
    const a = await app.call<{ name: string }>('data:createBackup')
    await app.call('vocab:save', { word: 'x', sourceModule: 'manual' })
    const b = await app.call<{ name: string }>('data:createBackup')
    expect(a.name).not.toBe(b.name)
    expect(await app.call<unknown[]>('data:backups')).toHaveLength(2)
  })

  it('deleting a backup outside the backup folder or a non-backup file is a coded error', async () => {
    const app = await makeApp({ persistent: true })
    const res = await app.router.dispatch('data:deleteBackup', { file: app.kernel.paths.dbFile })
    expect(res).toMatchObject({ ok: false, error: { code: 'invalid_backup' } })
    const txt = path.join(app.kernel.paths.backups, 'notes.txt')
    fs.mkdirSync(app.kernel.paths.backups, { recursive: true })
    fs.writeFileSync(txt, 'keep me')
    expect((await app.router.dispatch('data:deleteBackup', { file: txt })).ok).toBe(false)
    expect(fs.existsSync(txt)).toBe(true)
  })
})

describe('hostile import files', () => {
  async function importFile(name: string, data: string | Buffer) {
    const file = path.join(tempDir(), name)
    fs.writeFileSync(file, data)
    const app = await makeApp({ host: { openFile: async () => file } })
    return { app, res: await app.router.dispatch('data:importVocab', undefined) }
  }

  it('a 50 000-row CSV imports the first 20 000 rows, reports the rest as skipped and awards no XP', async () => {
    const rows = ['word,meaning_vi']
    for (let i = 0; i < 50_000; i++) rows.push(`word${i},nghĩa ${i}`)
    const t0 = performance.now()
    const { app, res } = await importFile('big.csv', rows.join('\n'))
    const ms = performance.now() - t0
    expect(res).toMatchObject({ ok: true, data: { added: IMPORT_MAX_ROWS, merged: 0, skipped: 30_000 } })
    expect(words(app)).toBe(IMPORT_MAX_ROWS)
    expect(app.kernel.progress.totalXp()).toBe(0)
    console.warn(`[abuse-data] import 50k-row CSV: ${Math.round(ms)} ms`)
  })

  it.each([
    ['empty.csv', ''],
    ['header-only.csv', 'word,meaning_vi\n'],
    ['blank-lines.csv', '\n\n\r\n,,,\n'],
  ])('%s imports nothing without error', async (name, data) => {
    const { res } = await importFile(name, data)
    expect(res).toMatchObject({ ok: true, data: { added: 0, merged: 0 } })
  })

  it.each([
    ['photo.csv', Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52])],
    ['photo.json', Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46, 0, 1])],
    ['archive.csv', Buffer.concat([Buffer.from('PK\u0003\u0004'), Buffer.alloc(2000, 0)])],
    ['not-json.json', 'this is { not json'],
    ['wrong-shape.json', '{"format":"lingua-quest-export","tables":{"vocabulary":{"0":{"word":"x"}}}}'],
    ['other-app.json', '{"words":["a","b"]}'],
    ['null.json', 'null'],
  ])('%s is rejected with invalid_import and a Vietnamese message', async (name, data) => {
    const { app, res } = await importFile(name, data)
    expect(res).toMatchObject({ ok: false, error: { code: 'invalid_import' } })
    if (!res.ok) expect(res.error.message).toMatch(/[ạ-ỹđ]/)
    expect(words(app)).toBe(0)
  })

  it('a JSON export from a newer version imports the words it understands and caps every field', async () => {
    const data = {
      format: 'lingua-quest-export',
      version: 7,
      schemaVersion: 99,
      exportedAt: '2030-01-01T00:00:00.000Z',
      tables: {
        vocabulary: [
          { word: 'future', meaning_vi: 'tương lai', examples: '["The future is now."]', new_column: { nested: true } },
          { word: 'x'.repeat(200), meaning_vi: 'too long word → skipped' },
          { word: 'long-notes', notes: 'n'.repeat(50_000), meaning_vi: 'm'.repeat(5000), examples: 'not json' },
          null,
          ['array row'],
          { word: 12345 },
        ],
        brand_new_table: [{ a: 1 }],
      },
    }
    const { app, res } = await importFile('newer.json', JSON.stringify(data))
    expect(res).toMatchObject({ ok: true, data: { added: 2, merged: 0, skipped: 4 } })
    const long = await app.call<{ items: VocabItem[] }>('vocab:list', { query: 'long-notes' })
    expect(long.items[0]?.notes.length).toBe(1000)
    expect(long.items[0]?.meaningVi.length).toBe(300)
  })
})

describe('20 000-word database performance', () => {
  it('list / search / stats stay under ~300 ms', { timeout: 120_000 }, async () => {
    const app = await makeApp()
    const lines = ['word,meaning_vi,meaning_en,topic']
    const topics = ['travel', 'work', 'food', 'nature', 'tech']
    for (let i = 0; i < 20_000; i++) lines.push(`term${i},nghĩa thứ ${i},meaning ${i},${topics[i % 5]}`)
    const t0 = performance.now()
    app.kernel.data.importVocabulary(lines.join('\n'), 'csv')
    const importMs = performance.now() - t0
    // Make most cards "reviewed" so retention / due / forecast queries have real work.
    app.kernel.db.run(
      `UPDATE review_schedules SET state = CASE WHEN vocab_id % 4 = 0 THEN 'new' ELSE 'review' END,
       stability = (vocab_id % 50) + 1, difficulty = (vocab_id % 10), reps = 3, lapses = vocab_id % 3,
       last_review_at = '2026-10-20T08:00:00.000Z',
       due_at = strftime('%Y-%m-%dT%H:%M:%fZ', '2026-10-25', '+' || (vocab_id % 40) || ' days')`,
    )
    const timings: Record<string, number> = { 'import 20k (ms)': Math.round(importMs) }
    const probe: [string, string, unknown?][] = [
      ['vocab:list default', 'vocab:list'],
      ['vocab:list query', 'vocab:list', { query: 'term1999' }],
      ['vocab:list query (no hit)', 'vocab:list', { query: 'zzzz%_' }],
      ['vocab:list sort due', 'vocab:list', { sort: 'due', limit: 500 }],
      ['vocab:list difficult', 'vocab:list', { state: 'difficult' }],
      ['vocab:list due', 'vocab:list', { state: 'due' }],
      ['vocab:list alpha offset 19000', 'vocab:list', { sort: 'alpha', offset: 19_000 }],
      ['vocab:due 200', 'vocab:due', { limit: 200 }],
      ['vocab:stats', 'vocab:stats'],
      ['vocab:topics', 'vocab:topics'],
      ['search:query', 'search:query', { q: 'nghia thu 1234' }],
      ['search:query regex meta', 'search:query', { q: '.*(+[\\' }],
      ['progress:stats', 'progress:stats'],
      ['app:bootstrap', 'app:bootstrap'],
      ['journey:dashboard', 'journey:dashboard'],
      ['coach:overview week', 'coach:overview', { period: 'week' }],
    ]
    for (const [label, ch, payload] of probe) {
      let best = Infinity
      for (let i = 0; i < 3; i++) {
        const s = performance.now()
        const res = await app.router.dispatch(ch, payload)
        best = Math.min(best, performance.now() - s)
        expect(res.ok, `${label}: ${JSON.stringify(res).slice(0, 200)}`).toBe(true)
      }
      timings[label] = Math.round(best)
    }
    const t1 = performance.now()
    const csv = app.kernel.data.vocabularyCsv()
    timings['export CSV 20k'] = Math.round(performance.now() - t1)
    expect(csv.split('\r\n')).toHaveLength(20_001)
    console.warn(`[abuse-data] timings ${JSON.stringify(timings)}`)
    const slow = Object.entries(timings).filter(
      ([k, v]) => !k.startsWith('import') && !k.startsWith('export') && v > 300,
    )
    expect(slow).toEqual([])
  })
})

describe('damaged rows and unexpected server answers', () => {
  it('a coach report whose JSON was damaged answers report_damaged instead of internal', async () => {
    const app = await makeApp()
    const r = await app.call<{ id: number }>('coach:generateReport', { period: 'day', useAi: false })
    app.kernel.db.run("UPDATE coach_reports SET stats = '{broken' WHERE id = ?", [r.id])
    const res = await app.router.dispatch('coach:report', { id: r.id })
    expect(res).toMatchObject({ ok: false, error: { code: 'report_damaged' } })
    expect((await app.router.dispatch('coach:reports', undefined)).ok).toBe(true)
  })

  it('a captive portal answering HTML with status 200 is a cloud error, not internal', async () => {
    const server = new FakeCloud()
    const portal = { on: false }
    const fetchImpl: typeof fetch = (input, init) =>
      portal.on
        ? Promise.resolve(new Response('<html><body>Wi-Fi login</body></html>', { status: 200 }))
        : server.fetch(input, init)
    const app = await makeApp({ fetchImpl })
    app.kernel.cloud.configure(FAKE_URL, FAKE_ANON)
    await app.call('cloud:sendCode', { email: 'lan@example.com' })
    await app.call('cloud:verifyCode', { email: 'lan@example.com', code: server.code('lan@example.com') })
    portal.on = true
    const res = await app.router.dispatch('cloud:devices', undefined)
    expect(res).toMatchObject({ ok: false, error: { code: 'cloud_server' } })
  })
})
