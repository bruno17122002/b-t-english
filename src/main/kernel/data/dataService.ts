// Backups, restore, and import/export of learning data. API keys are never part of the database,
// so no backup or export can contain them.
import fs from 'node:fs'
import path from 'node:path'
import initSqlJs from 'sql.js'
import type { BackupInfo } from '@shared/types'
import { writeFileAtomic, type AppDatabase } from '../../db/database'
import { LATEST_SCHEMA_VERSION } from '../../db/migrations'
import type { VocabHub } from '../vocab/vocabHub'

const EXPORT_TABLES = [
  'user_profile',
  'learning_goals',
  'skill_levels',
  'assessments',
  'roadmaps',
  'roadmap_weeks',
  'lessons',
  'vocabulary',
  'review_schedules',
  'review_logs',
  'writing_submissions',
  'speaking_sessions',
  'listening_history',
  'reading_history',
  'reading_highlights',
  'story_progress',
  'xp_events',
  'achievements',
  'quests',
  'daily_stats',
  'activity_log',
  'tutor_conversations',
  'tutor_messages',
  'learner_mistakes',
  'favorites',
  'bookmarks',
]

export interface ExportFile {
  format: 'lingua-quest-export'
  version: 1
  schemaVersion: number
  exportedAt: string
  tables: Record<string, Record<string, unknown>[]>
}

const BOM = String.fromCharCode(0xfeff)
const stamp = (d: Date) => d.toISOString().replace(/[:T]/g, '-').replace(/\..+$/, '')

function csvCell(v: unknown): string {
  const s = v === null || v === undefined ? '' : String(v)
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

/** RFC 4180 CSV parser (quoted fields, escaped quotes, CRLF). */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let quoted = false
  const src = text.startsWith(BOM) ? text.slice(1) : text
  for (let i = 0; i < src.length; i++) {
    const c = src[i]
    if (quoted) {
      if (c === '"' && src[i + 1] === '"') {
        cell += '"'
        i++
      } else if (c === '"') quoted = false
      else cell += c
    } else if (c === '"') quoted = true
    else if (c === ',') {
      row.push(cell)
      cell = ''
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && src[i + 1] === '\n') i++
      row.push(cell)
      rows.push(row)
      row = []
      cell = ''
    } else cell += c
  }
  if (cell || row.length) {
    row.push(cell)
    rows.push(row)
  }
  return rows.filter((r) => r.some((x) => x.trim()))
}

export class DataService {
  constructor(
    private readonly db: AppDatabase,
    private readonly backupDir: string,
    private readonly vocab: VocabHub,
    private readonly wasmDir?: string,
    private readonly now: () => Date = () => new Date(),
  ) {}

  createBackup(label: 'manual' | 'auto' | 'pre-restore' = 'manual'): BackupInfo {
    fs.mkdirSync(this.backupDir, { recursive: true })
    const name = `lingua-quest-${label}-${stamp(this.now())}.sqlite`
    const file = path.join(this.backupDir, name)
    writeFileAtomic(file, this.db.exportBytes())
    try {
      fs.unlinkSync(`${file}.bak`)
    } catch {
      /* no previous copy */
    }
    if (label === 'auto') this.prune('auto', 10)
    return this.info(file)
  }

  private prune(label: string, keep: number) {
    const files = this.listBackups().filter((b) => b.name.includes(`-${label}-`))
    for (const b of files.slice(keep)) fs.rmSync(b.file, { force: true })
  }

  private info(file: string): BackupInfo {
    const st = fs.statSync(file)
    return { file, name: path.basename(file), sizeBytes: st.size, createdAt: st.mtime.toISOString() }
  }

  listBackups(): BackupInfo[] {
    if (!fs.existsSync(this.backupDir)) return []
    return fs
      .readdirSync(this.backupDir)
      .filter((f) => f.endsWith('.sqlite'))
      .map((f) => this.info(path.join(this.backupDir, f)))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  }

  deleteBackup(file: string): void {
    const resolved = path.resolve(file)
    if (path.dirname(resolved) !== path.resolve(this.backupDir)) throw new Error('Not a Lingua Quest backup')
    fs.rmSync(resolved, { force: true })
  }

  /** Checks that a file is a readable Lingua Quest database this version can open. */
  async validateBackup(file: string): Promise<{ schemaVersion: number; words: number }> {
    const SQL = await initSqlJs(
      this.wasmDir ? { locateFile: (f: string) => path.join(this.wasmDir as string, f) } : undefined,
    )
    const bytes = fs.readFileSync(file)
    if (bytes.subarray(0, 15).toString('latin1') !== 'SQLite format 3') throw new Error('Not a SQLite database file')
    const db = new SQL.Database(bytes)
    try {
      const ok = db.exec('PRAGMA integrity_check')[0]?.values[0]?.[0]
      if (ok !== 'ok') throw new Error('Database integrity check failed')
      const v = Number(db.exec('SELECT MAX(version) FROM schema_migrations')[0]?.values[0]?.[0] ?? 0)
      if (!v) throw new Error('Not a Lingua Quest database')
      if (v > LATEST_SCHEMA_VERSION) throw new Error('Backup was made by a newer version of Lingua Quest')
      const words = Number(db.exec('SELECT COUNT(*) FROM vocabulary')[0]?.values[0]?.[0] ?? 0)
      return { schemaVersion: v, words }
    } finally {
      db.close()
    }
  }

  /**
   * Replaces the live database file with a backup. A pre-restore backup is written first.
   * The caller must close the database before and relaunch the app after.
   */
  async restoreBackup(file: string, dbPath: string): Promise<BackupInfo> {
    await this.validateBackup(file)
    const safety = this.createBackup('pre-restore')
    writeFileAtomic(dbPath, new Uint8Array(fs.readFileSync(file)))
    return safety
  }

  exportJson(): ExportFile {
    const tables: ExportFile['tables'] = {}
    for (const t of EXPORT_TABLES) tables[t] = this.db.all(`SELECT * FROM ${t}`)
    return {
      format: 'lingua-quest-export',
      version: 1,
      schemaVersion: LATEST_SCHEMA_VERSION,
      exportedAt: this.now().toISOString(),
      tables,
    }
  }

  vocabularyCsv(): string {
    const header = ['word', 'ipa', 'pos', 'meaning_vi', 'meaning_en', 'example', 'topic', 'cefr', 'notes']
    const rows = this.db.all<Record<string, unknown>>(
      'SELECT word, ipa, pos, meaning_vi, meaning_en, examples, topic, cefr, notes FROM vocabulary ORDER BY word_key',
    )
    const lines = rows.map((r) => {
      let example = ''
      try {
        example = (JSON.parse(String(r.examples)) as string[])[0] ?? ''
      } catch {
        /* ignore */
      }
      return [r.word, r.ipa, r.pos, r.meaning_vi, r.meaning_en, example, r.topic, r.cefr, r.notes].map(csvCell).join(',')
    })
    return BOM + [header.join(','), ...lines].join('\r\n')
  }

  /** Imports words from a Lingua Quest JSON export or a CSV (first column = word). Existing words are merged. */
  importVocabulary(text: string, kind: 'json' | 'csv'): { added: number; merged: number; skipped: number } {
    const items: { word: string; ipa?: string; pos?: string; meaningVi?: string; meaningEn?: string; example?: string; topic?: string; notes?: string }[] = []
    if (kind === 'json') {
      const parsed = JSON.parse(text) as Partial<ExportFile>
      if (parsed.format !== 'lingua-quest-export' || !parsed.tables?.vocabulary) throw new Error('Not a Lingua Quest export file')
      for (const r of parsed.tables.vocabulary) {
        let example = ''
        try {
          example = (JSON.parse(String(r.examples ?? '[]')) as string[])[0] ?? ''
        } catch {
          /* ignore */
        }
        items.push({
          word: String(r.word ?? ''),
          ipa: String(r.ipa ?? ''),
          pos: String(r.pos ?? ''),
          meaningVi: String(r.meaning_vi ?? ''),
          meaningEn: String(r.meaning_en ?? ''),
          example,
          topic: String(r.topic ?? ''),
          notes: String(r.notes ?? ''),
        })
      }
    } else {
      const rows = parseCsv(text)
      const header = rows[0]?.map((h) => h.trim().toLowerCase()) ?? []
      const hasHeader = header.includes('word')
      const col = (name: string, fallback: number) => (hasHeader ? header.indexOf(name) : fallback)
      for (const r of hasHeader ? rows.slice(1) : rows) {
        const get = (i: number) => (i >= 0 ? (r[i] ?? '').trim() : '')
        items.push({
          word: get(col('word', 0)),
          ipa: get(col('ipa', -1)),
          pos: get(col('pos', -1)),
          meaningVi: get(col('meaning_vi', 1)),
          meaningEn: get(col('meaning_en', 2)),
          example: get(col('example', 3)),
          topic: get(col('topic', -1)),
          notes: get(col('notes', -1)),
        })
      }
    }
    let added = 0
    let merged = 0
    let skipped = 0
    for (const it of items.slice(0, 20_000)) {
      if (!it.word.trim() || it.word.length > 80) {
        skipped++
        continue
      }
      const res = this.vocab.save({
        word: it.word,
        ipa: it.ipa,
        pos: it.pos,
        meaningVi: it.meaningVi,
        meaningEn: it.meaningEn,
        examples: it.example ? [it.example] : [],
        topic: it.topic,
        notes: it.notes,
        sourceModule: 'manual',
        sourceRef: 'import',
      })
      if (res.created) added++
      else merged++
    }
    return { added, merged, skipped }
  }
}
