import fs from 'node:fs'
import type { AppDatabase } from '../database'
import { writeFileAtomic } from '../database'
import { V1_INITIAL } from './v1_initial'
import { V2_GENERATED_CONTENT_INDEX } from './v2_indexes'
import { V3_SRS_LEARNING_STEPS } from './v3_srs_learning_steps'
import { V4_TELEGRAM_MESSAGES } from './v4_telegram_messages'
import { V5_SYNC_OUTBOX } from './v5_sync_outbox'

export interface Migration {
  version: number
  name: string
  sql: string
}

/** Append-only. Never edit a released migration – add a new one instead. */
export const MIGRATIONS: Migration[] = [
  { version: 1, name: 'initial schema', sql: V1_INITIAL },
  { version: 2, name: 'search and history indexes', sql: V2_GENERATED_CONTENT_INDEX },
  { version: 3, name: 'srs learning steps and module migrations', sql: V3_SRS_LEARNING_STEPS },
  { version: 4, name: 'telegram bot chat memory', sql: V4_TELEGRAM_MESSAGES },
  { version: 5, name: 'multi-device sync outbox and triggers', sql: V5_SYNC_OUTBOX },
]

export const LATEST_SCHEMA_VERSION = MIGRATIONS[MIGRATIONS.length - 1]?.version ?? 0

export function currentSchemaVersion(db: AppDatabase): number {
  db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    version INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    applied_at TEXT NOT NULL
  )`)
  return Number(db.value('SELECT COALESCE(MAX(version), 0) FROM schema_migrations') ?? 0)
}

/**
 * Applies pending migrations, each in its own transaction. Before upgrading an existing
 * database a byte-for-byte copy is written next to it, so an upgrade can never lose data.
 */
export function runMigrations(db: AppDatabase, migrations: Migration[] = MIGRATIONS): { from: number; to: number } {
  const from = currentSchemaVersion(db)
  if (from > (migrations[migrations.length - 1]?.version ?? 0)) {
    throw new Error(`Database schema v${from} is newer than this app supports. Please update Lingua Quest.`)
  }
  const pending = migrations.filter((m) => m.version > from).sort((a, b) => a.version - b.version)
  if (pending.length && from > 0 && db.filePath && fs.existsSync(db.filePath)) {
    writeFileAtomic(`${db.filePath}.pre-migration-v${from}`, db.exportBytes())
  }
  for (const m of pending) {
    db.transaction(() => {
      db.exec(m.sql)
      db.run('INSERT INTO schema_migrations(version, name, applied_at) VALUES (?, ?, ?)', [
        m.version,
        m.name,
        new Date().toISOString(),
      ])
    })
  }
  db.flush()
  return { from, to: pending.length ? (pending[pending.length - 1] as Migration).version : from }
}

/**
 * Applies a feature module's own migrations (namespaced by module id). Must run after the kernel
 * migrations, which create the bookkeeping table.
 */
export function runModuleMigrations(db: AppDatabase, moduleId: string, migrations: Migration[]): number {
  const applied = new Set(
    db
      .all<{ version: number }>('SELECT version FROM module_migrations WHERE module = ?', [moduleId])
      .map((r) => r.version),
  )
  let count = 0
  for (const m of [...migrations].sort((a, b) => a.version - b.version)) {
    if (applied.has(m.version)) continue
    db.transaction(() => {
      db.exec(m.sql)
      db.run('INSERT INTO module_migrations(module, version, name, applied_at) VALUES (?, ?, ?, ?)', [
        moduleId,
        m.version,
        m.name,
        new Date().toISOString(),
      ])
    })
    count++
  }
  if (count) db.flush()
  return count
}
