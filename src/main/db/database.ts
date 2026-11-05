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

export class AppDatabase {
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
    const SQL = await initSqlJs(opts.wasmDir ? { locateFile: (f: string) => path.join(opts.wasmDir as string, f) } : undefined)
    let db: SqlJsDatabase
    if (opts.filePath && fs.existsSync(opts.filePath)) {
      db = new SQL.Database(fs.readFileSync(opts.filePath))
      try {
        const res = db.exec('PRAGMA integrity_check')
        if (res[0]?.values[0]?.[0] !== 'ok') throw new Error('integrity_check failed')
      } catch (err) {
        db.close()
        const bak = opts.filePath + '.bak'
        if (!fs.existsSync(bak)) throw new Error(`Database file is corrupted and no backup exists: ${String(err)}`)
        // Keep the damaged file for diagnostics and fall back to the last good copy.
        fs.copyFileSync(opts.filePath, opts.filePath + `.corrupt-${Date.now()}`)
        db = new SQL.Database(fs.readFileSync(bak))
      }
    } else {
      if (opts.filePath) fs.mkdirSync(path.dirname(opts.filePath), { recursive: true })
      db = new SQL.Database()
    }
    return new AppDatabase(db, opts.filePath, opts.autosaveMs ?? 200, opts.onError ?? (() => undefined))
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

  private assertOpen() {
    if (this.closed) throw new Error('Database is closed')
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
