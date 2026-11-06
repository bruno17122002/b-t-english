// Backups, restore, and import/export of learning data. API keys are never part of the database,
// so no backup or export can contain them.
import fs from 'node:fs'
import path from 'node:path'
import initSqlJs from 'sql.js'
import type { BackupInfo } from '@shared/types'
import { writeFileAtomic, type AppDatabase } from '../../db/database'
import { LATEST_SCHEMA_VERSION } from '../../db/migrations'
import { UserError } from '../errors'
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
  'telegram_messages',
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

/** Max rows read from one import file; the rest is reported as skipped. */
export const IMPORT_MAX_ROWS = 20_000

/**
 * CSV cell for spreadsheets: quotes when needed and neutralises formula injection (OWASP): a cell starting
 * with = + - @ TAB or CR is prefixed with ' so Excel / Sheets show it as text instead of evaluating it.
 */
export function csvCell(v: unknown): string {
  let s = v === null || v === undefined ? '' : String(v)
  // Also for a value that already starts with ' + trigger, so the import (which strips one ') restores it.
  if (/^'*[=+\-@\t\r]/.test(s)) s = `'${s}`
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

/** Reverses the formula-injection guard of csvCell on import. */
function uncsvCell(s: string): string {
  return /^'+[=+\-@\t\r]/.test(s) ? s.slice(1) : s
}

/** NUL bytes or many U+FFFD replacement characters mean the file is not text (image, zip, exe…). */
function looksBinary(text: string): boolean {
  const head = text.slice(0, 8192)
  if (head.includes('\u0000')) return true
  const bad = head.split('\ufffd').length - 1
  return head.length > 0 && bad / head.length > 0.02
}

const cap = (v: unknown, max: number): string =>
  (typeof v === 'string' ? v : v === null || v === undefined ? '' : String(v)).trim().slice(0, max)

const importError = (message: string) => new UserError('invalid_import', message)

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
    // Two backups in the same second (double click, or a pre-restore right after a manual one) get distinct names.
    const base = `lingua-quest-${label}-${stamp(this.now())}`
    let file = path.join(this.backupDir, `${base}.sqlite`)
    for (let n = 2; fs.existsSync(file); n++) file = path.join(this.backupDir, `${base}-${n}.sqlite`)
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
    if (path.dirname(resolved) !== path.resolve(this.backupDir) || !resolved.endsWith('.sqlite'))
      throw new UserError('invalid_backup', 'Chỉ có thể xoá bản sao lưu nằm trong thư mục sao lưu của Lingua Quest.')
    fs.rmSync(resolved, { force: true })
  }

  /** Checks that a file is a readable Lingua Quest database this version can open. */
  async validateBackup(file: string): Promise<{ schemaVersion: number; words: number }> {
    const SQL = await initSqlJs(
      this.wasmDir ? { locateFile: (f: string) => path.join(this.wasmDir as string, f) } : undefined,
    )
    let bytes: Buffer
    try {
      if (!fs.statSync(file).isFile()) throw new Error('not a file')
      bytes = fs.readFileSync(file)
    } catch {
      throw new UserError('invalid_backup', 'Không tìm thấy hoặc không đọc được file sao lưu.')
    }
    if (bytes.subarray(0, 15).toString('latin1') !== 'SQLite format 3')
      throw new UserError('invalid_backup', 'File này không phải bản sao lưu Lingua Quest (không phải SQLite).')
    const db = new SQL.Database(bytes)
    try {
      let ok: unknown = null
      let v = 0
      let words = 0
      try {
        ok = db.exec('PRAGMA integrity_check')[0]?.values[0]?.[0]
        if (ok === 'ok') {
          v = Number(db.exec('SELECT MAX(version) FROM schema_migrations')[0]?.values[0]?.[0] ?? 0)
          words = Number(db.exec('SELECT COUNT(*) FROM vocabulary')[0]?.values[0]?.[0] ?? 0)
        }
      } catch {
        // malformed pages, or a SQLite file without the Lingua Quest tables
        if (ok === 'ok') throw new UserError('invalid_backup', 'File này không phải bản sao lưu Lingua Quest.')
      }
      if (ok !== 'ok') throw new UserError('invalid_backup', 'File sao lưu bị hỏng (kiểm tra toàn vẹn thất bại).')
      if (!v) throw new UserError('invalid_backup', 'File này không phải bản sao lưu Lingua Quest.')
      if (v > LATEST_SCHEMA_VERSION)
        throw new UserError(
          'backup_too_new',
          'Bản sao lưu được tạo bởi phiên bản Lingua Quest mới hơn. Hãy cập nhật ứng dụng rồi thử lại.',
        )
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
      return [r.word, r.ipa, r.pos, r.meaning_vi, r.meaning_en, example, r.topic, r.cefr, r.notes]
        .map(csvCell)
        .join(',')
    })
    return BOM + [header.join(','), ...lines].join('\r\n')
  }

  /**
   * Imports words from a Lingua Quest JSON export or a CSV (first column = word). Existing words are merged.
   * Hostile files are rejected with a Vietnamese message (binary, wrong JSON shape); fields are capped like
   * the IPC schema; at most IMPORT_MAX_ROWS rows; imported words award no XP; everything runs in one
   * transaction (VocabHub.importMany), so a failure leaves the word bank unchanged.
   */
  importVocabulary(text: string, kind: 'json' | 'csv'): { added: number; merged: number; skipped: number } {
    if (looksBinary(text))
      throw importError('File không phải văn bản (có thể là ảnh, file nén hoặc file chương trình).')
    const items: Record<'word' | 'ipa' | 'pos' | 'meaningVi' | 'meaningEn' | 'example' | 'topic' | 'notes', string>[] =
      []
    let skipped = 0
    if (kind === 'json') {
      let parsed: unknown
      try {
        parsed = JSON.parse(text.startsWith(BOM) ? text.slice(1) : text)
      } catch {
        throw importError('File JSON bị lỗi cú pháp.')
      }
      const file = parsed as Partial<ExportFile> | null
      const vocab =
        file && typeof file === 'object' ? (file.tables as Record<string, unknown> | undefined)?.vocabulary : null
      if (!file || file.format !== 'lingua-quest-export' || !Array.isArray(vocab))
        throw importError('Đây không phải file xuất dữ liệu của Lingua Quest.')
      // A newer export may carry extra columns: only the known ones are read, unknown ones are ignored.
      for (const raw of vocab as unknown[]) {
        if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
          skipped++
          continue
        }
        const r = raw as Record<string, unknown>
        let example = ''
        try {
          const ex = JSON.parse(String(r.examples ?? '[]')) as unknown
          example = Array.isArray(ex) && typeof ex[0] === 'string' ? ex[0] : ''
        } catch {
          /* ignore */
        }
        items.push({
          word: typeof r.word === 'string' ? r.word : '',
          ipa: cap(r.ipa, 80),
          pos: cap(r.pos, 40),
          meaningVi: cap(r.meaning_vi, 300),
          meaningEn: cap(r.meaning_en, 300),
          example: cap(example, 400),
          topic: cap(r.topic, 60),
          notes: cap(r.notes, 1000),
        })
      }
    } else {
      const rows = parseCsv(text)
      const header = rows[0]?.map((h) => h.trim().toLowerCase()) ?? []
      const hasHeader = header.includes('word')
      const col = (name: string, fallback: number) => (hasHeader ? header.indexOf(name) : fallback)
      for (const r of hasHeader ? rows.slice(1) : rows) {
        const get = (i: number, max: number) => (i >= 0 ? cap(uncsvCell((r[i] ?? '').trim()), max) : '')
        items.push({
          word: i0(r, col('word', 0)),
          ipa: get(col('ipa', -1), 80),
          pos: get(col('pos', -1), 40),
          meaningVi: get(col('meaning_vi', 1), 300),
          meaningEn: get(col('meaning_en', 2), 300),
          example: get(col('example', 3), 400),
          topic: get(col('topic', -1), 60),
          notes: get(col('notes', -1), 1000),
        })
      }
    }
    if (items.length > IMPORT_MAX_ROWS) skipped += items.length - IMPORT_MAX_ROWS
    const valid: Parameters<VocabHub['importMany']>[0] = []
    for (const it of items.slice(0, IMPORT_MAX_ROWS)) {
      const word = it.word.trim()
      if (!word || word.length > 80) {
        skipped++
        continue
      }
      valid.push({
        word,
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
    }
    const { added, merged } = this.vocab.importMany(valid)
    return { added, merged, skipped }
  }
}

/** Raw word cell of a CSV row (formula guard removed, not truncated: over-long words are skipped). */
function i0(r: string[], i: number): string {
  return i >= 0 ? uncsvCell((r[i] ?? '').trim()) : ''
}
