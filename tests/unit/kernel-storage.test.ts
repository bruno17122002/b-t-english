import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { AppDatabase, writeFileAtomic } from '../../src/main/db/database'
import {
  currentSchemaVersion,
  LATEST_SCHEMA_VERSION,
  MIGRATIONS,
  runMigrations,
  runModuleMigrations,
} from '../../src/main/db/migrations'
import { parseCsv } from '../../src/main/kernel/data/dataService'
import { Logger } from '../../src/main/kernel/logger'
import { KeyStore, normalizeKey, type Cipher } from '../../src/main/kernel/secure/keyStore'
import { fakeCipher, makeKernel, tempDir } from '../helpers/kernel'

describe('database layer', () => {
  it('migrates an old v2 database to the latest schema without losing data and keeps a pre-migration copy', async () => {
    const dir = tempDir()
    const file = path.join(dir, 'lq.sqlite')
    const old = await AppDatabase.open({ filePath: file, autosaveMs: 0 })
    runMigrations(old, MIGRATIONS.slice(0, 2))
    const ts = new Date().toISOString()
    old.run("INSERT INTO vocabulary(word, word_key, created_at, updated_at) VALUES ('harbor', 'harbor', ?, ?)", [
      ts,
      ts,
    ])
    old.run('INSERT INTO review_schedules(vocab_id, due_at) VALUES (1, ?)', [ts])
    old.close()

    const db = await AppDatabase.open({ filePath: file, autosaveMs: 0 })
    expect(currentSchemaVersion(db)).toBe(2)
    const res = runMigrations(db)
    expect(res).toEqual({ from: 2, to: LATEST_SCHEMA_VERSION })
    expect(db.value('SELECT word FROM vocabulary')).toBe('harbor')
    expect(db.value('SELECT learning_steps FROM review_schedules')).toBe(0)
    expect(fs.existsSync(`${file}.pre-migration-v2`)).toBe(true)
    expect(runMigrations(db)).toEqual({ from: LATEST_SCHEMA_VERSION, to: LATEST_SCHEMA_VERSION })
    db.close()
  })

  it('refuses databases from a newer app version', async () => {
    const db = await AppDatabase.open({ filePath: null })
    runMigrations(db)
    db.run("INSERT INTO schema_migrations(version, name, applied_at) VALUES (999, 'future', 'x')")
    expect(() => runMigrations(db)).toThrow(/newer/)
  })

  it('rolls back failed transactions and nested savepoints', async () => {
    const db = await AppDatabase.open({ filePath: null })
    runMigrations(db)
    const ts = new Date().toISOString()
    expect(() =>
      db.transaction(() => {
        db.run("INSERT INTO favorites(kind, ref, title, created_at) VALUES ('a', '1', 't', ?)", [ts])
        throw new Error('boom')
      }),
    ).toThrow('boom')
    expect(db.value('SELECT COUNT(*) FROM favorites')).toBe(0)
    db.transaction(() => {
      db.run("INSERT INTO favorites(kind, ref, title, created_at) VALUES ('a', '1', 't', ?)", [ts])
      try {
        db.transaction(() => {
          db.run("INSERT INTO favorites(kind, ref, title, created_at) VALUES ('a', '2', 't', ?)", [ts])
          throw new Error('inner')
        })
      } catch {
        /* inner rolled back */
      }
    })
    expect(db.value('SELECT COUNT(*) FROM favorites')).toBe(1)
  })

  it('enforces foreign keys even after saving (sql.js resets pragmas on export)', async () => {
    const dir = tempDir()
    const db = await AppDatabase.open({ filePath: path.join(dir, 'fk.sqlite'), autosaveMs: 0 })
    runMigrations(db)
    db.save()
    expect(() => db.run("INSERT INTO review_schedules(vocab_id, due_at) VALUES (12345, 'x')")).toThrow()
  })

  it('recovers from a corrupted file using the .bak copy', async () => {
    const dir = tempDir()
    const file = path.join(dir, 'lq.sqlite')
    const db = await AppDatabase.open({ filePath: file, autosaveMs: 0 })
    runMigrations(db)
    db.run("INSERT INTO app_settings(key, value) VALUES ('k', '\"v1\"')")
    db.run("UPDATE app_settings SET value = '\"v2\"' WHERE key = 'k'")
    db.close()
    fs.writeFileSync(file, Buffer.from('this is not a database'))
    const reopened = await AppDatabase.open({ filePath: file, autosaveMs: 0 })
    expect(reopened.value("SELECT value FROM app_settings WHERE key = 'k'")).toBeTruthy()
    expect(fs.readdirSync(dir).some((f) => f.includes('.corrupt-'))).toBe(true)
  })

  it('writes files atomically and keeps a backup of the previous version', () => {
    const dir = tempDir()
    const file = path.join(dir, 'a.bin')
    writeFileAtomic(file, new Uint8Array([1]))
    writeFileAtomic(file, new Uint8Array([2]))
    expect([...fs.readFileSync(file)]).toEqual([2])
    expect([...fs.readFileSync(`${file}.bak`)]).toEqual([1])
    expect(fs.existsSync(`${file}.tmp`)).toBe(false)
  })

  it('applies namespaced module migrations once', async () => {
    const db = await AppDatabase.open({ filePath: null })
    runMigrations(db)
    const m = [{ version: 1, name: 'demo', sql: 'CREATE TABLE demo_items (id INTEGER PRIMARY KEY)' }]
    expect(runModuleMigrations(db, 'demo', m)).toBe(1)
    expect(runModuleMigrations(db, 'demo', m)).toBe(0)
    expect(db.value("SELECT COUNT(*) FROM module_migrations WHERE module = 'demo'")).toBe(1)
  })
})

describe('key store', () => {
  it('encrypts keys at rest and exposes only a masked hint', () => {
    const dir = tempDir()
    const ks = new KeyStore(path.join(dir, 'keys.bin'), fakeCipher)
    const key = 'sk-proj-ABCDEFGHIJKLMNOPQRSTUVWX'
    expect(ks.set('openai', key)).toEqual({ persisted: true })
    expect(fs.readFileSync(path.join(dir, 'keys.bin'), 'utf8')).not.toContain('ABCDEFGH')
    expect(ks.get('openai')).toBe(key)
    expect(ks.hint('openai')).toBe('••••UVWX')
    ks.remove('openai')
    expect(ks.has('openai')).toBe(false)
  })

  it('keeps keys in memory only when OS encryption is unavailable', () => {
    const dir = tempDir()
    const noCrypto: Cipher = {
      isEncryptionAvailable: () => false,
      encryptString: () => Buffer.alloc(0),
      decryptString: () => '',
    }
    const ks = new KeyStore(path.join(dir, 'keys.bin'), noCrypto)
    expect(ks.set('gemini', 'AIzaSyMEMORYONLY_1234567890abcdefgh')).toEqual({ persisted: false })
    expect(ks.has('gemini')).toBe(true)
    expect(fs.existsSync(path.join(dir, 'keys.bin'))).toBe(false)
  })

  it('treats keys encrypted by another Windows account as missing', () => {
    const dir = tempDir()
    new KeyStore(path.join(dir, 'keys.bin'), fakeCipher).set('gemini', 'AIzaSyOTHERUSER_1234567890abcdefgh')
    const broken: Cipher = {
      ...fakeCipher,
      decryptString: () => {
        throw new Error('DPAPI failure')
      },
    }
    expect(new KeyStore(path.join(dir, 'keys.bin'), broken).get('gemini')).toBeNull()
  })

  it('validates key format', () => {
    expect(() => normalizeKey('short')).toThrow()
    expect(() => normalizeKey('has space inside the key value 123')).toThrow()
    expect(normalizeKey('  AIzaSyVALIDKEY_1234567890abcdefgh  ')).toBe('AIzaSyVALIDKEY_1234567890abcdefgh')
  })
})

describe('logger', () => {
  it('redacts secrets and rotates files', () => {
    const dir = tempDir()
    const log = new Logger(dir, 200, 2)
    log.info('using key AIzaSyLEAKLEAKLEAK_1234567890abcdef now')
    for (let i = 0; i < 10; i++) log.info(`line ${i} ${'x'.repeat(40)}`)
    const all = fs
      .readdirSync(dir)
      .map((f) => fs.readFileSync(path.join(dir, f), 'utf8'))
      .join('\n')
    expect(all).not.toContain('LEAKLEAK')
    expect(fs.existsSync(path.join(dir, 'lingua-quest.log.1'))).toBe(true)
    expect(fs.existsSync(path.join(dir, 'lingua-quest.log.4'))).toBe(false)
  })
})

describe('progress kernel', () => {
  it('caps tutor XP per day and completes quests with bonus XP', async () => {
    let now = new Date('2026-03-10T10:00:00')
    const { kernel } = await makeKernel({ now: () => now })
    for (let i = 0; i < 15; i++) kernel.progress.record({ type: 'tutor_message', module: 'tutor', skill: 'writing' })
    const tutorXp = kernel.db.value("SELECT SUM(amount) FROM xp_events WHERE source = 'tutor_message'")
    expect(tutorXp).toBe(20)
    now = new Date('2026-03-11T10:00:00')
    kernel.progress.record({ type: 'tutor_message', module: 'tutor', skill: 'writing' })
    expect(
      kernel.db.value("SELECT SUM(amount) FROM xp_events WHERE source = 'tutor_message' AND date = '2026-03-11'"),
    ).toBe(2)
  })

  it('records daily stats, streak and achievements from events', async () => {
    const now = new Date('2026-03-10T10:00:00')
    const { kernel } = await makeKernel({ now: () => now })
    const r = kernel.progress.record({ type: 'assessment_done', module: 'journey', minutes: 15 })
    expect(r.achievementsUnlocked.map((a) => a.key)).toContain('first-steps')
    expect(r.xpGained).toBeGreaterThanOrEqual(60)
    const stats = kernel.progress.stats()
    expect(stats.today.minutes).toBe(15)
    expect(kernel.progress.gameState().streak.current).toBe(1)
    const quests = kernel.progress.quests()
    expect(quests.daily).toHaveLength(3)
    expect(quests.weekly.find((q) => q.key === 'week-active')?.progress).toBe(1)
  })
})

describe('CSV parser', () => {
  it('handles quotes, commas, newlines and BOM', () => {
    expect(parseCsv('﻿word,meaning\r\n"a, b","say ""hi""\nthere"\r\nc,d\n')).toEqual([
      ['word', 'meaning'],
      ['a, b', 'say "hi"\nthere'],
      ['c', 'd'],
    ])
  })
})
