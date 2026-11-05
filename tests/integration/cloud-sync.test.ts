// Multi-device sync and cloud backups: two kernels (two PCs) share one in-memory Supabase that implements
// sync_push (last-writer-wins on client_updated_at, seq cursor), RLS per user and the backups bucket.
import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import type { Kernel } from '../../src/main/kernel'
import { SYNC_TABLE_MAP, SYNC_TABLES, NEVER_SYNCED } from '../../src/main/kernel/cloud/syncTables'
import { PUSH_BATCH } from '../../src/main/kernel/cloud/sync'
import { V5_SYNC_TABLES_FROZEN } from '../../src/main/db/migrations/v5_sync_outbox'
import type { SyncStatusView } from '../../src/shared/kernelContract'
import { FAKE_ANON, FAKE_URL, FakeCloud } from '../helpers/fakeCloud'
import { makeApp, tempDir } from '../helpers/kernel'

const EMAIL = 'lan@example.com'
const GEMINI_KEY = 'AIzaSyFAKEKEY_abcdefghijklmnopqrstuv'
const BOT_TOKEN = '123456789:AAHfakeTokenForSync_abcdefghijk'

const tick = (ms = 5) => new Promise((r) => setTimeout(r, ms))

type App = Awaited<ReturnType<typeof makeApp>>

async function device(server: FakeCloud, opts: { persistent?: boolean; dir?: string; now?: () => Date } = {}) {
  const relaunched: number[] = []
  let app: App | null = null
  app = await makeApp({
    fetchImpl: server.fetch,
    persistent: opts.persistent,
    dir: opts.dir,
    now: opts.now,
    host: {
      relaunch: () => {
        relaunched.push(Date.now())
        app?.kernel.db.close()
      },
    },
  })
  if (!app.kernel.cloud.config()) app.kernel.cloud.configure(FAKE_URL, FAKE_ANON)
  if (!app.kernel.cloud.isSignedIn()) {
    await app.call('cloud:sendCode', { email: EMAIL })
    await app.call('cloud:verifyCode', { email: EMAIL, code: server.code(EMAIL) })
  }
  const a = app
  return {
    ...a,
    relaunched,
    k: a.kernel,
    sync: () => a.call<SyncStatusView>('sync:now'),
  }
}

const words = (k: Kernel) =>
  k.db.all<{ word_key: string; meaning_vi: string; notes: string }>(
    'SELECT word_key, meaning_vi, notes FROM vocabulary ORDER BY word_key',
  )
const save = (k: Kernel, word: string, meaningVi = '') => k.vocab.save({ word, meaningVi, sourceModule: 'manual' }).item
const idOf = (k: Kernel, wordKey: string) =>
  Number(k.db.value('SELECT id FROM vocabulary WHERE word_key = ?', [wordKey]))
const schedule = (k: Kernel, wordKey: string) =>
  k.db.get<Record<string, unknown>>(
    `SELECT s.state, s.due_at, s.stability, s.difficulty, s.reps, s.lapses, s.scheduled_days, s.last_review_at, s.learning_steps
     FROM review_schedules s JOIN vocabulary v ON v.id = s.vocab_id WHERE v.word_key = ?`,
    [wordKey],
  )
const activities = (k: Kernel) =>
  k.db
    .all<{ action: string; created_at: string; minutes: number }>(
      'SELECT action, created_at, minutes FROM activity_log ORDER BY created_at, action, minutes',
    )
    .map((r) => `${r.created_at}|${r.action}|${r.minutes}`)
const dailyStats = (k: Kernel) =>
  k.db
    .all<{ date: string; minutes: number; xp: number; words_saved: number; reviews: number; skill_minutes: string }>(
      'SELECT * FROM daily_stats ORDER BY date',
    )
    .map((r) => ({
      date: r.date,
      minutes: Math.round(r.minutes * 100) / 100,
      xp: r.xp,
      words: r.words_saved,
      reviews: r.reviews,
      skills: Object.fromEntries(
        Object.entries(JSON.parse(r.skill_minutes) as Record<string, number>)
          .map(([s, m]) => [s, Math.round(m * 100) / 100])
          .sort(),
      ),
    }))

describe('sync – contract', () => {
  it('the frozen v5 triggers match the table spec, and secrets/derived tables are never synced', () => {
    for (const [tbl, pk, key] of V5_SYNC_TABLES_FROZEN) {
      const spec = SYNC_TABLE_MAP.get(tbl)
      expect(spec, tbl).toBeDefined()
      expect(spec?.pk).toBe(pk)
      expect(spec?.key ?? null).toBe(key)
    }
    for (const t of NEVER_SYNCED) expect(SYNC_TABLE_MAP.has(t), t).toBe(false)
    // every reference points at an earlier table, so pulled rows can be applied in one ordered pass
    SYNC_TABLES.forEach((s, i) => {
      for (const ref of s.refs ?? []) expect(SYNC_TABLES.findIndex((x) => x.tbl === ref.table)).toBeLessThan(i)
    })
  })

  it('captures nothing until the first sync and has sensible default settings', async () => {
    const { kernel, call } = await makeApp()
    save(kernel, 'quiet')
    expect(kernel.sync.pendingCount()).toBe(0)
    expect(await call('sync:settings')).toEqual({ autoSync: true, dailyCloudBackup: false })
    expect(await call('sync:settings', { dailyCloudBackup: true })).toEqual({ autoSync: true, dailyCloudBackup: true })
    expect(await call<SyncStatusView>('sync:status')).toMatchObject({ signedIn: false, active: false, pending: 0 })
  })
})

describe('sync – two devices', () => {
  it('registers the device and profile on sign-in', async () => {
    const server = new FakeCloud()
    const A = await device(server)
    A.k.learner.updateProfile({ displayName: 'Lan' })
    await A.k.sync.upsertProfile()
    const dev = A.k.cloud.status().deviceId as string
    expect(server.devices.get(dev)).toMatchObject({
      user_id: server.userId(EMAIL),
      platform: 'windows',
      app_version: '1.0.0-test',
    })
    expect(server.devices.get(dev)?.name).toBe(A.k.sync.deviceName())
    expect(server.profiles.get(server.userId(EMAIL))?.display_name).toBe('Lan')
    const list = await A.call<{ id: string; current: boolean }[]>('cloud:devices')
    expect(list).toEqual([expect.objectContaining({ id: dev, current: true })])
  })

  it('words saved on A appear on B with their FSRS schedule; nothing is echoed back', async () => {
    const server = new FakeCloud()
    const A = await device(server)
    const B = await device(server)
    save(A.k, 'resilient', 'kiên cường')
    save(A.k, 'Thrive', 'phát triển mạnh')
    expect(A.k.sync.pendingCount()).toBe(0) // capture starts with the first sync (full upload)
    const st = await A.sync()
    expect(st).toMatchObject({ active: true, pending: 0, lastError: null })
    expect(st.lastPushed).toBeGreaterThan(4)

    const rows = server.userRows(server.userId(EMAIL))
    const vocab = rows.find((r) => r.tbl === 'vocabulary' && r.row_key === 'resilient')
    expect(vocab?.data).toMatchObject({ word: 'resilient', word_key: 'resilient', meaning_vi: 'kiên cường' })
    const sched = rows.find((r) => r.tbl === 'review_schedules' && r.row_key === 'resilient')
    expect(sched?.data).toMatchObject({ word_key: 'resilient', state: 'new' })
    const devA = A.k.cloud.status().deviceId as string
    expect(rows.find((r) => r.tbl === 'activity_log')?.row_key).toMatch(new RegExp(`^${devA}:\\d+$`))
    expect(rows.find((r) => r.tbl === 'user_profile')?.row_key).toBe('singleton')

    await B.sync()
    expect(words(B.k)).toEqual(words(A.k))
    expect(schedule(B.k, 'thrive')).toEqual(schedule(A.k, 'thrive'))
    expect(B.k.vocab.dueCount()).toBe(2)
    // pulled rows are applied with the triggers muted: no outbox entries, no re-push
    expect(B.k.sync.pendingCount()).toBe(0)
    const pushesBefore = server.pushes.length
    const seqBefore = server.seq
    await B.sync()
    await A.sync()
    expect(server.pushes.length).toBe(pushesBefore)
    expect(server.seq).toBe(seqBefore)
  })

  it("a review on B updates A's schedule and log (foreign keys resolved by word_key)", async () => {
    const server = new FakeCloud()
    const A = await device(server)
    const B = await device(server)
    save(A.k, 'resilient', 'kiên cường')
    await A.sync()
    await B.sync()
    B.k.vocab.review(idOf(B.k, 'resilient'), 3, 4000)
    expect(B.k.sync.pendingCount()).toBeGreaterThan(0)
    await B.sync()
    await A.sync()
    expect(schedule(A.k, 'resilient')).toEqual(schedule(B.k, 'resilient'))
    expect(schedule(A.k, 'resilient')?.reps).toBe(1)
    const logs = A.k.db.all<{ vocab_id: number; rating: number; duration_ms: number }>('SELECT * FROM review_logs')
    expect(logs).toEqual([expect.objectContaining({ vocab_id: idOf(A.k, 'resilient'), rating: 3, duration_ms: 4000 })])
    expect(A.k.vocab.dueCount()).toBe(B.k.vocab.dueCount())
  })

  it('append-only logs merge without duplicates and daily_stats are recomputed on both devices', async () => {
    const server = new FakeCloud()
    const A = await device(server)
    const B = await device(server)
    A.k.progress.record({ type: 'listening_done', module: 'listening', skill: 'listening', minutes: 10, score: 0.8 })
    save(A.k, 'curious')
    B.k.progress.record({ type: 'reading_done', module: 'reading', skill: 'reading', minutes: 7 })
    B.k.progress.record({ type: 'speaking_done', module: 'speaking', skill: 'speaking', minutes: 3 })
    const ownA = activities(A.k).length
    const ownB = activities(B.k).length
    await A.sync()
    await B.sync()
    await A.sync()
    await B.sync()
    await A.sync()
    expect(activities(A.k)).toHaveLength(ownA + ownB)
    expect(activities(A.k)).toEqual(activities(B.k))
    const xp = (k: Kernel) => Number(k.db.value('SELECT SUM(amount) FROM xp_events'))
    expect(xp(A.k)).toBe(xp(B.k))
    expect(A.k.progress.totalXp()).toBe(B.k.progress.totalXp())
    expect(dailyStats(A.k)).toEqual(dailyStats(B.k))
    const [day] = dailyStats(A.k)
    expect(day?.minutes).toBeCloseTo(10 + 7 + 3 + 0.3, 5)
    expect(day?.xp).toBe(xp(A.k))
    expect(day?.skills).toMatchObject({ listening: 10, reading: 7, speaking: 3 })
    expect(A.k.progress.gameState().streak).toEqual(B.k.progress.gameState().streak)
    // a third device starting from scratch gets the same totals
    const C = await device(server)
    await C.sync()
    expect(activities(C.k)).toEqual(activities(A.k))
    expect(dailyStats(C.k)).toEqual(dailyStats(A.k))
  })

  it('deletions propagate (word with its schedule and logs, bookmarks, favorites)', async () => {
    const server = new FakeCloud()
    const A = await device(server)
    const B = await device(server)
    save(A.k, 'ephemeral')
    save(A.k, 'stay')
    A.k.settings.addBookmark({ kind: 'reading', ref: 'p1', title: 'Passage', note: '', position: '' })
    A.k.settings.toggleFavorite('story', 's1', 'Story')
    await A.sync()
    await B.sync()
    B.k.vocab.review(idOf(B.k, 'ephemeral'), 4)
    await B.sync()
    await A.sync()
    expect(B.k.db.value('SELECT COUNT(*) FROM bookmarks')).toBe(1)
    expect(B.k.settings.isFavorite('story', 's1')).toBe(true)

    A.k.vocab.remove(idOf(A.k, 'ephemeral'))
    B.k.settings.removeBookmark(Number(B.k.db.value('SELECT id FROM bookmarks')))
    A.k.settings.toggleFavorite('story', 's1', 'Story') // un-favourite
    await A.sync()
    await B.sync()
    await A.sync()
    for (const k of [A.k, B.k]) {
      expect(words(k).map((w) => w.word_key)).toEqual(['stay'])
      expect(k.db.value('SELECT COUNT(*) FROM review_schedules')).toBe(1)
      expect(k.db.value('SELECT COUNT(*) FROM review_logs')).toBe(0)
      expect(k.db.value('SELECT COUNT(*) FROM bookmarks')).toBe(0)
      expect(k.settings.isFavorite('story', 's1')).toBe(false)
    }
    const rows = server.userRows(server.userId(EMAIL))
    expect(rows.find((r) => r.tbl === 'vocabulary' && r.row_key === 'ephemeral')?.deleted).toBe(true)
    expect(rows.find((r) => r.tbl === 'review_schedules' && r.row_key === 'ephemeral')?.deleted).toBe(true)
    expect(rows.filter((r) => r.tbl === 'review_logs').every((r) => r.deleted)).toBe(true)
  })

  it('conflicting edits: the newest edit wins whichever device pushes first', async () => {
    const server = new FakeCloud()
    const A = await device(server)
    const B = await device(server)
    save(A.k, 'resilient', 'kiên cường')
    await A.sync()
    await B.sync()

    A.k.vocab.update(idOf(A.k, 'resilient'), { notes: 'older edit on A' })
    await tick()
    B.k.vocab.update(idOf(B.k, 'resilient'), { notes: 'newer edit on B' })
    await B.sync() // newer first
    await A.sync() // older push is rejected by the server, B's version is pulled
    await B.sync()
    expect(words(A.k)[0]?.notes).toBe('newer edit on B')
    expect(words(B.k)[0]?.notes).toBe('newer edit on B')

    B.k.vocab.update(idOf(B.k, 'resilient'), { notes: 'older edit on B' })
    await tick()
    A.k.vocab.update(idOf(A.k, 'resilient'), { notes: 'newest edit on A' })
    await B.sync() // older first
    await A.sync() // newer wins on the server
    await B.sync()
    expect(words(A.k)[0]?.notes).toBe('newest edit on A')
    expect(words(B.k)[0]?.notes).toBe('newest edit on A')

    // a local edit made after the remote one survives a pull that happens before its push
    B.k.vocab.update(idOf(B.k, 'resilient'), { notes: 'B remote' })
    await B.sync()
    await tick()
    A.k.vocab.update(idOf(A.k, 'resilient'), { notes: 'A local, newest' })
    await A.k.sync.pull()
    expect(words(A.k)[0]?.notes).toBe('A local, newest')
    await A.sync()
    await B.sync()
    expect(words(B.k)[0]?.notes).toBe('A local, newest')
  })

  it('profile, skills, goals, tutor chats and coach data follow the learner', async () => {
    const server = new FakeCloud()
    const A = await device(server)
    A.k.learner.updateProfile({ displayName: 'Lan', dailyMinutes: 45, onboardingCompleted: true })
    A.k.learner.setSkillLevel({ skill: 'reading', cefr: 'B1', score: 62, source: 'self', estimated: true })
    A.k.learner.saveGoal({
      kind: 'short',
      title: 'IELTS 6.5',
      metric: 'none',
      targetValue: 0,
      targetDate: null,
      status: 'active',
    })
    const conv = A.k.db.run(
      "INSERT INTO tutor_conversations(mode, title, created_at, updated_at) VALUES ('free', 'Chat', 'x', 'x')",
    ).lastInsertRowid
    A.k.db.run("INSERT INTO tutor_messages(conversation_id, role, content, created_at) VALUES (?, 'user', 'Hi', 'x')", [
      conv,
    ])
    A.k.db.run(
      `INSERT INTO coach_sessions(id, started_at, last_active_at, date, start_hour, active_seconds) VALUES ('sess-1', 'a', 'b', '2026-11-05', 8, 600)`,
    )
    await A.sync()
    // B is a fresh install: its default profile must not overwrite A's real one
    const B = await device(server)
    await B.sync()
    expect(B.k.learner.profile()).toMatchObject({ displayName: 'Lan', dailyMinutes: 45 })
    expect(B.k.learner.skillLevels().find((s) => s.skill === 'reading')).toMatchObject({ cefr: 'B1', score: 62 })
    expect(B.k.learner.goals().map((g) => g.title)).toEqual(['IELTS 6.5'])
    const msgs = B.k.db.all<{ content: string; conversation_id: number }>('SELECT * FROM tutor_messages')
    expect(msgs).toEqual([
      expect.objectContaining({
        content: 'Hi',
        conversation_id: Number(B.k.db.value('SELECT id FROM tutor_conversations')),
      }),
    ])
    expect(B.k.db.value("SELECT active_seconds FROM coach_sessions WHERE id = 'sess-1'")).toBe(600)
    // an update to a row that came from A keeps A's key on the server
    A.k.db.run("UPDATE coach_sessions SET active_seconds = 900 WHERE id = 'sess-1'")
    await A.sync()
    B.k.db.run("UPDATE coach_sessions SET active_seconds = 1200 WHERE id = 'sess-1'")
    await B.sync()
    await A.sync()
    expect(A.k.db.value("SELECT active_seconds FROM coach_sessions WHERE id = 'sess-1'")).toBe(1200)
    expect(server.userRows(server.userId(EMAIL)).filter((r) => r.tbl === 'coach_sessions')).toHaveLength(1)
  })

  it('applies rows written by the server bot / PWA (device_id null, own key prefix)', async () => {
    const server = new FakeCloud()
    const A = await device(server)
    save(A.k, 'resilient')
    await A.sync()
    const uid = server.userId(EMAIL)
    const at = new Date(Date.now() + 1000).toISOString()
    server.serverWrite(uid, {
      tbl: 'review_logs',
      row_key: 'tg:4d1c',
      data: {
        word_key: 'resilient',
        rating: 3,
        state_before: 'new',
        elapsed_days: 0,
        scheduled_days: 2,
        duration_ms: 0,
        reviewed_at: at,
      },
      client_updated_at: at,
    })
    server.serverWrite(uid, {
      tbl: 'review_schedules',
      row_key: 'resilient',
      data: { word_key: 'resilient', state: 'review', due_at: '2026-12-01T00:00:00.000Z', reps: 1, scheduled_days: 2 },
      client_updated_at: at,
    })
    server.serverWrite(uid, { tbl: 'unknown_future_table', row_key: 'x', data: { a: 1 } })
    server.serverWrite(uid, { tbl: 'review_logs', row_key: 'web:orphan', data: { word_key: 'missing', rating: 1 } })
    await A.sync()
    expect(schedule(A.k, 'resilient')).toMatchObject({ state: 'review', due_at: '2026-12-01T00:00:00.000Z', reps: 1 })
    expect(A.k.db.all('SELECT rating, vocab_id FROM review_logs')).toEqual([
      { rating: 3, vocab_id: idOf(A.k, 'resilient') },
    ])
    expect(A.k.sync.pendingCount()).toBe(0)
  })

  it('never uploads secrets, settings, AI config or the Telegram chat memory', async () => {
    const server = new FakeCloud()
    const A = await device(server)
    await A.call('ai:setKey', { provider: 'gemini', key: GEMINI_KEY })
    await A.call('ai:updateConfig', { tutorStyle: 'strict' })
    A.k.keys.set('telegram', BOT_TOKEN)
    await A.call('settings:update', { theme: 'light' })
    A.k.db.run(
      "INSERT INTO telegram_messages(chat_id, role, content, created_at) VALUES ('1', 'user', 'secret chat', 'x')",
    )
    save(A.k, 'resilient')
    await A.sync()
    A.k.settings.setFlag('somethingNew', 'x')
    await A.call('ai:updateConfig', { tutorStyle: 'friendly' })
    await A.sync()
    const dump = JSON.stringify([...server.rows.values()]) + JSON.stringify(server.pushes)
    expect(dump).not.toContain(GEMINI_KEY)
    expect(dump).not.toContain(BOT_TOKEN)
    expect(dump).not.toContain('secret chat')
    for (const s of server.sessions) expect(dump).not.toContain(s.refresh)
    const tables = new Set([...server.rows.values()].map((r) => r.tbl))
    for (const t of tables) expect(SYNC_TABLE_MAP.has(t), t).toBe(true)
    for (const t of NEVER_SYNCED) expect(tables.has(t), t).toBe(false)
  })

  it('pushes in batches of at most 500 rows and pulls in pages', async () => {
    const server = new FakeCloud()
    const A = await device(server)
    const csv = Array.from({ length: 300 }, (_, i) => `word${i},nghĩa ${i}`).join('\n')
    A.k.data.importVocabulary(csv, 'csv')
    await A.sync()
    const fromA = server.pushes.filter((p) => p.device === A.k.cloud.status().deviceId)
    expect(fromA.length).toBeGreaterThan(1)
    for (const p of fromA) expect(p.rows.length).toBeLessThanOrEqual(PUSH_BATCH)
    const total = server.userRows(server.userId(EMAIL)).length
    expect(total).toBeGreaterThan(1000)
    const B = await device(server)
    server.requests.length = 0
    await B.sync()
    expect(server.requests.filter((r) => r.path === '/rest/v1/sync_rows').length).toBeGreaterThanOrEqual(2)
    expect(server.requests.find((r) => r.path === '/rest/v1/sync_rows')?.url).toBe(
      '/rest/v1/sync_rows?select=*&seq=gt.0&order=seq&limit=1000',
    )
    expect(words(B.k)).toHaveLength(300)
    expect(B.k.vocab.dueCount()).toBe(A.k.vocab.dueCount())
    // achievements are derived: unlocked on B from the merged history, never synced themselves
    expect(B.k.db.value("SELECT COUNT(*) FROM achievements WHERE key = 'word-collector'")).toBe(1)
    expect(server.userRows(server.userId(EMAIL)).some((r) => r.tbl === 'achievements')).toBe(false)
  }, 60_000)

  it('is offline-safe: keeps changes, reports the error, catches up later', async () => {
    const server = new FakeCloud()
    const A = await device(server)
    await A.sync()
    save(A.k, 'offline')
    server.down = true
    await expect(A.sync()).rejects.toMatchObject({ ipc: { code: 'cloud_network' } })
    const st = await A.call<SyncStatusView>('sync:status')
    expect(st.lastError).toMatch(/Internet/)
    expect(st.pending).toBeGreaterThan(0)
    expect(st.running).toBe(false)
    server.down = false
    const ok = await A.sync()
    expect(ok).toMatchObject({ lastError: null, pending: 0 })
    expect(server.userRows(server.userId(EMAIL)).some((r) => r.row_key === 'offline')).toBe(true)
  })

  it('"delete all cloud data" wipes the account on the server, signs out and stops capture', async () => {
    const server = new FakeCloud()
    const A = await device(server)
    save(A.k, 'resilient')
    await A.sync()
    await A.call('cloud:createBackup')
    const uid = server.userId(EMAIL)
    const st = await A.call<{ signedIn: boolean }>('cloud:deleteMyData')
    expect(st.signedIn).toBe(false)
    expect(server.userRows(uid)).toHaveLength(0)
    expect([...server.devices.values()].filter((d) => d.user_id === uid)).toHaveLength(0)
    expect([...server.objects.keys()].filter((k) => k.includes(uid))).toHaveLength(0)
    expect(A.k.sync.status()).toMatchObject({ active: false, pending: 0, signedIn: false })
    save(A.k, 'after')
    expect(A.k.sync.pendingCount()).toBe(0)
    expect(words(A.k)).toHaveLength(2) // local data stays
  })
})

describe('cloud backups', () => {
  it('creates, lists (newest first), keeps the last 20 and deletes', async () => {
    const server = new FakeCloud()
    let t = Date.parse('2026-11-05T08:00:00.000Z')
    const A = await device(server, { now: () => new Date(t) })
    save(A.k, 'resilient')
    const uid = server.userId(EMAIL)
    const first = await A.call<{ name: string; sizeBytes: number }>('cloud:createBackup')
    expect(first.name).toBe('lingua-quest-2026-11-05-08-00-00.sqlite')
    expect(server.objects.has(`backups/${uid}/${first.name}`)).toBe(true)
    for (let i = 0; i < 21; i++) {
      t += 60_000
      await A.call('cloud:createBackup')
    }
    const list = await A.call<{ name: string; sizeBytes: number }[]>('cloud:backups')
    expect(list).toHaveLength(20)
    expect(list[0]?.name).toBe('lingua-quest-2026-11-05-08-21-00.sqlite')
    expect(list.some((b) => b.name === first.name)).toBe(false)
    expect(list[0]?.sizeBytes).toBeGreaterThan(1000)
    const after = await A.call<{ name: string }[]>('cloud:deleteBackup', { name: list[0]!.name })
    expect(after).toHaveLength(19)
    await expect(A.call('cloud:deleteBackup', { name: '../other/x.sqlite' })).rejects.toMatchObject({
      ipc: { code: 'invalid_input' },
    })
    expect(A.k.sync.status().lastCloudBackupAt).toBe(new Date(t).toISOString())
  })

  it('daily automatic cloud backup runs once a day when enabled', async () => {
    const server = new FakeCloud()
    let t = Date.parse('2026-11-05T08:00:00.000Z')
    const A = await device(server, { now: () => new Date(t) })
    save(A.k, 'resilient')
    expect(await A.k.cloudBackups.maybeDailyBackup()).toBeNull() // disabled by default
    await A.call('sync:settings', { dailyCloudBackup: true })
    expect(await A.k.cloudBackups.maybeDailyBackup()).not.toBeNull()
    t += 3600_000
    expect(await A.k.cloudBackups.maybeDailyBackup()).toBeNull()
    t += 24 * 3600_000
    expect(await A.k.cloudBackups.maybeDailyBackup()).not.toBeNull()
    expect(await A.call<unknown[]>('cloud:backups')).toHaveLength(2)
  })

  it('restores a validated cloud backup with a safety copy and relaunch; the restored copy re-syncs cleanly', async () => {
    const server = new FakeCloud()
    const dir = tempDir()
    const A = await device(server, { persistent: true, dir })
    save(A.k, 'before')
    A.k.progress.record({ type: 'reading_done', module: 'reading', skill: 'reading', minutes: 5 })
    await A.sync()
    const backup = await A.call<{ name: string }>('cloud:createBackup')
    save(A.k, 'after-backup')
    A.k.progress.record({ type: 'listening_done', module: 'listening', skill: 'listening', minutes: 4 })
    await A.sync()
    const oldDevice = A.k.cloud.status().deviceId
    const serverActivity = server
      .userRows(server.userId(EMAIL))
      .filter((r) => r.tbl === 'activity_log' && !r.deleted).length

    await A.call('cloud:restoreBackup', { name: backup.name })
    await tick(400)
    expect(A.relaunched).toHaveLength(1)
    expect(A.k.data.listBackups().some((b) => b.name.includes('-pre-restore-'))).toBe(true)
    expect(fs.existsSync(path.join(dir, 'sync-rekey.flag'))).toBe(true)
    expect(fs.readdirSync(path.join(dir, 'cache', 'cloud-restore'))).toHaveLength(0)

    // "relaunch": the restored database gets a new sync identity and catches up from the cloud
    const A2 = await device(server, { persistent: true, dir })
    expect(fs.existsSync(path.join(dir, 'sync-rekey.flag'))).toBe(false)
    expect(words(A2.k).map((w) => w.word_key)).toEqual(['before'])
    expect(A2.k.cloud.status().deviceId).not.toBe(oldDevice)
    await A2.sync()
    expect(words(A2.k).map((w) => w.word_key)).toEqual(['after-backup', 'before'])
    expect(activities(A2.k)).toHaveLength(serverActivity)
    expect(new Set(activities(A2.k)).size).toBe(serverActivity)
    // no duplicate rows were created on the server for rows that existed before the restore
    expect(server.userRows(server.userId(EMAIL)).filter((r) => r.tbl === 'activity_log' && !r.deleted)).toHaveLength(
      serverActivity,
    )
  })

  it('rejects a corrupt cloud backup without touching the database', async () => {
    const server = new FakeCloud()
    const dir = tempDir()
    const A = await device(server, { persistent: true, dir })
    save(A.k, 'keep')
    const uid = server.userId(EMAIL)
    server.objects.set(`backups/${uid}/lingua-quest-broken.sqlite`, {
      bytes: new TextEncoder().encode('definitely not sqlite'),
      created_at: new Date().toISOString(),
    })
    await expect(A.call('cloud:restoreBackup', { name: 'lingua-quest-broken.sqlite' })).rejects.toMatchObject({
      ipc: { code: 'invalid_backup' },
    })
    await tick(400)
    expect(A.relaunched).toHaveLength(0)
    expect(words(A.k).map((w) => w.word_key)).toEqual(['keep'])
    expect(fs.existsSync(path.join(dir, 'sync-rekey.flag'))).toBe(false)
  })
})
