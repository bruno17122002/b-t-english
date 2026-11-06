// SQLite (sql.js / WASM) wrapper with transactions and crash-safe atomic persistence.
// Kept free of Electron imports so it runs unchanged under Vitest.
import fs from 'node:fs'
import path from 'node:path'
import initSqlJs, { type Database as SqlJsDatabase, type SqlValue } from 'sql.js'

export type Param = string | number | bigint | boolean | null | undefined | Uint8Array
export type Row = Record<string, SqlValue>

export interface OpenOptions {
  /** Absolute path of the database file; null keeps the database in memory only (tests). */
  filePath: string | null
  /** Directory containing sql-wasm.wasm (defaults to sql.js resolution). */
  wasmDir?: string
  /** Debounce for automatic saves after writes. 0 = save synchronously after every write. */
  autosaveMs?: number
  onError?: (err: unknown) => void
}

const toSql = (p: Param): SqlValue => {
  if (p === undefined) return null
  if (typeof p === 'boolean') return p ? 1 : 0
  if (typeof p === 'bigint') return Number(p)
  return p
}

/** Raised when a call reaches the database after it was closed (e.g. while the app relaunches after a restore). */
export class DatabaseClosedError extends Error {
  constructor() {
    super('Database is closed')
    this.name = 'DatabaseClosedError'
  }
}

/** How open() recovered from a damaged database file (null when the file was fine). */
export interface DbRecovery {
  /** 'backup' = the last good .bak copy was used; 'fresh' = no usable copy, started empty. */
  kind: 'backup' | 'fresh'
  corruptFile: string
  reason: string
}

const SQLITE_MAGIC = 'SQLite format 3\u0000'

export function isSqliteFile(bytes: Uint8Array): boolean {
  return bytes.byteLength >= 512 && Buffer.from(bytes.subarray(0, 16)).toString('latin1') === SQLITE_MAGIC
}

export class AppDatabase {
  /** Set by open() when the file on disk was damaged and had to be replaced. */
  recovery: DbRecovery | null = null
  private saveTimer: NodeJS.Timeout | null = null
  private depth = 0
  private dirty = false
  private closed = false

  private constructor(
    private db: SqlJsDatabase,
    readonly filePath: string | null,
    private readonly autosaveMs: number,
    private readonly onError: (err: unknown) => void,
  ) {
    this.applyPragmas()
  }

  static async open(opts: OpenOptions): Promise<AppDatabase> {
    const SQL = await initSqlJs(
      opts.wasmDir ? { locateFile: (f: string) => path.join(opts.wasmDir as string, f) } : undefined,
    )
    /** Opens a database file only when it is a SQLite file that passes integrity_check. */
    const openChecked = (file: string): SqlJsDatabase => {
      const bytes = fs.readFileSync(file)
      // An empty or truncated file would otherwise open as a brand-new empty database and hide the data loss.
      if (!isSqliteFile(bytes)) throw new Error('not a SQLite database file')
      const candidate = new SQL.Database(bytes)
      try {
        const res = candidate.exec('PRAGMA integrity_check')
        if (res[0]?.values[0]?.[0] !== 'ok') throw new Error('integrity_check failed')
      } catch (err) {
        candidate.close()
        throw err
      }
      return candidate
    }
    let db: SqlJsDatabase
    let recovery: DbRecovery | null = null
    if (opts.filePath && fs.existsSync(opts.filePath)) {
      try {
        db = openChecked(opts.filePath)
      } catch (err) {
        // Move the damaged file aside (kept for diagnostics, never copied over the .bak by the next save).
        const corruptFile = `${opts.filePath}.corrupt-${Date.now()}`
        fs.renameSync(opts.filePath, corruptFile)
        const bak = opts.filePath + '.bak'
        try {
          db = openChecked(bak)
          fs.copyFileSync(bak, opts.filePath)
          recovery = { kind: 'backup', corruptFile, reason: String(err) }
        } catch (bakErr) {
          // No usable copy: start with an empty database instead of failing on every launch. The learner can
          // restore one of the daily backups from Settings → Data; the damaged file stays next to the database.
          db = new SQL.Database()
          recovery = { kind: 'fresh', corruptFile, reason: `${String(err)}; .bak: ${String(bakErr)}` }
        }
      }
    } else {
      if (opts.filePath) fs.mkdirSync(path.dirname(opts.filePath), { recursive: true })
      db = new SQL.Database()
    }
    const app = new AppDatabase(db, opts.filePath, opts.autosaveMs ?? 200, opts.onError ?? (() => undefined))
    app.recovery = recovery
    return app
  }

  private applyPragmas() {
    // sql.js resets pragmas whenever export() re-opens the database, so this runs after every save.
    this.db.exec('PRAGMA foreign_keys = ON;')
  }

  exec(sql: string): void {
    this.assertOpen()
    this.db.exec(sql)
    this.markDirty()
  }

  run(sql: string, params: Param[] = []): { changes: number; lastInsertRowid: number } {
    this.assertOpen()
    this.db.run(sql, params.map(toSql))
    const changes = this.db.getRowsModified()
    const idRow = this.db.exec('SELECT last_insert_rowid()')
    const lastInsertRowid = Number(idRow[0]?.values[0]?.[0] ?? 0)
    this.markDirty()
    return { changes, lastInsertRowid }
  }

  /** Runs one statement for many parameter rows with a single prepared statement (bulk import). */
  runBatch(sql: string, rows: Param[][]): number {
    this.assertOpen()
    if (!rows.length) return 0
    const stmt = this.db.prepare(sql)
    let changes = 0
    try {
      for (const params of rows) {
        stmt.run(params.map(toSql))
        changes += this.db.getRowsModified()
      }
    } finally {
      stmt.free()
    }
    this.markDirty()
    return changes
  }

  all<T = Row>(sql: string, params: Param[] = []): T[] {
    this.assertOpen()
    const stmt = this.db.prepare(sql)
    try {
      stmt.bind(params.map(toSql))
      const rows: T[] = []
      while (stmt.step()) rows.push(stmt.getAsObject() as T)
      return rows
    } finally {
      stmt.free()
    }
  }

  get<T = Row>(sql: string, params: Param[] = []): T | undefined {
    return this.all<T>(sql, params)[0]
  }

  value<T extends SqlValue = SqlValue>(sql: string, params: Param[] = []): T | undefined {
    const row = this.get<Row>(sql, params)
    return row ? (Object.values(row)[0] as T) : undefined
  }

  /**
   * `base`, or `base-2`, `base-3`… – the first value not yet used as `id` in `table` (a trusted constant).
   * Generated content ids contain a millisecond stamp, which repeats on double clicks or when the clock moves back.
   */
  uniqueId(table: string, base: string): string {
    let id = base
    for (let n = 2; this.value(`SELECT 1 FROM ${table} WHERE id = ?`, [id]) !== undefined; n++) id = `${base}-${n}`
    return id
  }

  /** Runs fn atomically. Nested calls use savepoints, so inner failures roll back only their part. */
  transaction<T>(fn: () => T): T {
    this.assertOpen()
    const sp = `sp_${this.depth}`
    this.db.exec(this.depth === 0 ? 'BEGIN' : `SAVEPOINT ${sp}`)
    this.depth++
    try {
      const result = fn()
      if (result instanceof Promise) throw new Error('transaction callbacks must be synchronous')
      this.depth--
      this.db.exec(this.depth === 0 ? 'COMMIT' : `RELEASE ${sp}`)
      this.markDirty()
      return result
    } catch (err) {
      this.depth--
      this.db.exec(this.depth === 0 ? 'ROLLBACK' : `ROLLBACK TO ${sp}; RELEASE ${sp}`)
      throw err
    }
  }

  get inTransaction(): boolean {
    return this.depth > 0
  }

  private markDirty() {
    this.dirty = true
    if (!this.filePath || this.depth > 0) return
    if (this.autosaveMs === 0) {
      this.save()
      return
    }
    if (this.saveTimer) return
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null
      try {
        this.save()
      } catch (err) {
        this.onError(err)
      }
    }, this.autosaveMs)
  }

  /** Serialises the database and replaces the file atomically (tmp → fsync → rename), keeping one .bak. */
  save(): void {
    if (!this.filePath || !this.dirty || this.depth > 0 || this.closed) return
    const data = this.db.export()
    this.applyPragmas()
    writeFileAtomic(this.filePath, data)
    this.dirty = false
  }

  /** Raw bytes of the current database (used for backups). */
  exportBytes(): Uint8Array {
    const data = this.db.export()
    this.applyPragmas()
    return data
  }

  flush(): void {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer)
      this.saveTimer = null
    }
    this.save()
  }

  close(): void {
    if (this.closed) return
    this.flush()
    this.db.close()
    this.closed = true
  }

  /**
   * Closes without saving. Used after the database file was replaced (restore): any later write must not
   * overwrite the restored file with the old in-memory data before the app relaunches.
   */
  discard(): void {
    if (this.closed) return
    if (this.saveTimer) clearTimeout(this.saveTimer)
    this.saveTimer = null
    this.dirty = false
    this.db.close()
    this.closed = true
  }

  get isClosed(): boolean {
    return this.closed
  }

  private assertOpen() {
    if (this.closed) throw new DatabaseClosedError()
  }
}

export function writeFileAtomic(file: string, data: Uint8Array): void {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const tmp = `${file}.tmp`
  const fd = fs.openSync(tmp, 'w')
  try {
    fs.writeSync(fd, data)
    fs.fsyncSync(fd)
  } finally {
    fs.closeSync(fd)
  }
  if (fs.existsSync(file)) {
    try {
      fs.copyFileSync(file, `${file}.bak`)
    } catch {
      /* a missing .bak is not fatal */
    }
  }
  // Windows can briefly lock the target (antivirus, indexer); retry the rename a few times.
  for (let attempt = 0; ; attempt++) {
    try {
      fs.renameSync(tmp, file)
      return
    } catch (err) {
      if (attempt >= 5) throw err
      const until = Date.now() + 50 * (attempt + 1)
      while (Date.now() < until) {
        /* short synchronous back-off */
      }
    }
  }
}
