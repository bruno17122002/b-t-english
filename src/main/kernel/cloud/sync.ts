// Multi-device sync (Lingua Quest Online, phase 3). Local SQLite stays the source of truth; Supabase keeps a
// copy of every synced row in `sync_rows` (one jsonb row per local row, last-writer-wins on client_updated_at).
//
// push: SQLite triggers record changed rows in sync_outbox → the current row (or a deletion) is sent in
//       batches of ≤ 500 through rpc('sync_push').
// pull: GET sync_rows with seq > cursor → applied inside one transaction with the triggers muted (so pulled
//       rows are never echoed back), remote ids mapped to local ids (sync_map), foreign keys resolved through
//       sync keys (word_key, conversation_key, …), then daily_stats / achievements are recomputed.
// The row format is a contract with the server bot and the PWA – see syncTables.ts and docs/ONLINE_PLAN.md.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { AppDatabase, Param } from '../../db/database'
import type { LearnerService } from '../learner/learner'
import type { ProgressService } from '../progress/progress'
import { CLOUD_FLAGS, CloudError, cloudMessage, type CloudClient } from './client'
import type { SettingsService } from '../settings/settings'
import { SYNC_TABLE_MAP, SYNC_TABLES, keySql, syncTriggerSql, type SyncTableSpec } from './syncTables'

export const PUSH_BATCH = 500
export const PULL_PAGE = 1000
export const SYNC_INTERVAL_MS = 5 * 60_000
const EPOCH = '1970-01-01T00:00:00.000Z'
const REKEY_MARKER = 'sync-rekey.flag'
/** Tables whose rows feed daily_stats (recomputed for every touched day after a pull). */
const DATED_TABLES = new Set(['activity_log', 'xp_events'])

export interface SyncRowOut {
  tbl: string
  row_key: string
  data: Record<string, unknown>
  deleted: boolean
  client_updated_at: string
}

export interface SyncRowIn extends SyncRowOut {
  seq: number
  device_id: string | null
  user_id?: string
  server_updated_at?: string
}

export interface SyncSettings {
  autoSync: boolean
  dailyCloudBackup: boolean
}

export interface SyncStatus extends SyncSettings {
  signedIn: boolean
  /** Change capture is on (this database has been synced with an account at least once). */
  active: boolean
  running: boolean
  lastSyncAt: string | null
  lastError: string | null
  /** Distinct local rows waiting to be pushed. */
  pending: number
  lastPushed: number
  lastPulled: number
  lastCloudBackupAt: string | null
  deviceId: string | null
  deviceName: string
}

export interface SyncResult {
  pushed: number
  pulled: number
  applied: number
}

export interface SyncEngineDeps {
  db: AppDatabase
  cloud: CloudClient
  settings: SettingsService
  learner: LearnerService
  progress: ProgressService
  userData: string
  now: () => Date
  log: { info(m: string): void; warn(m: string): void }
  /** Called after pulled rows changed local data (the kernel pushes 'data-changed' to the renderer). */
  onPulled?: () => void
}

type Row = Record<string, unknown>

const toParam = (v: unknown): Param => {
  if (v === undefined || v === null) return null
  if (typeof v === 'boolean') return v ? 1 : 0
  if (typeof v === 'number' || typeof v === 'string') return v
  return JSON.stringify(v)
}

const time = (iso: string | null | undefined) => {
  const t = iso ? Date.parse(iso) : NaN
  return Number.isFinite(t) ? t : 0
}

export class SyncEngine {
  /** Version reported to the devices table (set by the IPC layer from the host). */
  appVersion = ''
  private running: Promise<SyncResult> | null = null
  private registeredThisRun = false
  private readonly columns = new Map<string, Set<string>>()

  constructor(private readonly deps: SyncEngineDeps) {
    this.ensureTriggers()
    this.applyRestoreMarker()
  }

  private get db() {
    return this.deps.db
  }
  private get cloud() {
    return this.deps.cloud
  }

  // ---------- state ----------
  getState(key: string): string | null {
    return this.db.value<string>('SELECT value FROM sync_state WHERE key = ?', [key]) ?? null
  }
  setState(key: string, value: string | number): void {
    this.db.run(
      'INSERT INTO sync_state(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
      [key, String(value)],
    )
  }
  private delState(...keys: string[]) {
    for (const k of keys) this.db.run('DELETE FROM sync_state WHERE key = ?', [k])
  }

  settings(): SyncSettings {
    return { autoSync: this.getState('auto_sync') !== '0', dailyCloudBackup: this.getState('daily_backup') === '1' }
  }

  updateSettings(patch: Partial<SyncSettings>): SyncSettings {
    if (patch.autoSync !== undefined) this.setState('auto_sync', patch.autoSync ? '1' : '0')
    if (patch.dailyCloudBackup !== undefined) this.setState('daily_backup', patch.dailyCloudBackup ? '1' : '0')
    return this.settings()
  }

  deviceName(): string {
    try {
      return os.hostname().slice(0, 80) || 'Windows PC'
    } catch {
      return 'Windows PC'
    }
  }

  pendingCount(): number {
    return Number(
      this.db.value(
        `SELECT COUNT(*) FROM (SELECT 1 FROM sync_outbox
         GROUP BY tbl, CASE WHEN nat_key IS NULL THEN '#' || local_id ELSE nat_key END)`,
      ) ?? 0,
    )
  }

  status(): SyncStatus {
    return {
      ...this.settings(),
      signedIn: this.cloud.isSignedIn(),
      active: this.getState('active') === '1',
      running: this.running !== null,
      lastSyncAt: this.getState('last_sync_at'),
      lastError: this.getState('last_error'),
      pending: this.pendingCount(),
      lastPushed: Number(this.getState('last_pushed') ?? 0),
      lastPulled: Number(this.getState('last_pulled') ?? 0),
      lastCloudBackupAt: this.getState('last_cloud_backup_at'),
      deviceId: this.deps.settings.getFlag(CLOUD_FLAGS.deviceId),
      deviceName: this.deviceName(),
    }
  }

  // ---------- schema helpers ----------
  private tableExists(tbl: string): boolean {
    return !!this.db.value("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?", [tbl])
  }

  private cols(tbl: string): Set<string> {
    let c = this.columns.get(tbl)
    if (!c) {
      c = new Set(this.db.all<{ name: string }>(`PRAGMA table_info(${tbl})`).map((r) => r.name))
      this.columns.set(tbl, c)
    }
    return c
  }

  private specs(): SyncTableSpec[] {
    return SYNC_TABLES.filter((s) => this.tableExists(s.tbl))
  }

  /** Installs the outbox triggers for synced tables created outside the kernel migration (module tables). */
  private ensureTriggers() {
    for (const s of this.specs()) this.db.exec(syncTriggerSql(s.tbl, s.pk, s.key ?? null))
  }

  private snapshotTs(spec: SyncTableSpec): string {
    if (spec.ts) return spec.ts.replace(/\$\./g, 'r.')
    const cols = this.cols(spec.tbl)
    const c = [
      'updated_at',
      'last_active_at',
      'last_seen_at',
      'last_review_at',
      'reviewed_at',
      'ended_at',
      'completed_at',
      'created_at',
      'started_at',
    ].filter((x) => cols.has(x))
    return c.length ? `COALESCE(${c.map((x) => `r.${x}`).join(', ')}, '${EPOCH}')` : `'${EPOCH}'`
  }

  // ---------- identity ----------
  private deviceId(): string {
    return this.cloud.deviceId()
  }

  /** Writes a marker so the next start gives this database a fresh device identity (after a restore). */
  static markRestored(userData: string): void {
    try {
      fs.mkdirSync(userData, { recursive: true })
      fs.writeFileSync(path.join(userData, REKEY_MARKER), new Date().toISOString(), 'utf8')
    } catch {
      /* best effort */
    }
  }

  private applyRestoreMarker() {
    const marker = path.join(this.deps.userData, REKEY_MARKER)
    if (!fs.existsSync(marker)) return
    try {
      this.rekey()
      this.deps.log.info('sync: restored database got a new device identity')
    } finally {
      fs.rmSync(marker, { force: true })
    }
  }

  /**
   * A restored database (from a backup) may reuse local ids that this device already pushed. It gets a new
   * device id; rows that existed under the old id keep their old sync keys through sync_map, and the next pull
   * starts from the beginning so newer cloud rows come back.
   */
  rekey(): void {
    const oldDev = this.deps.settings.getFlag(CLOUD_FLAGS.deviceId)
    if (!oldDev) return
    this.db.transaction(() => {
      for (const s of this.specs().filter((x) => x.kind === 'device')) {
        this.db.run(
          `INSERT OR IGNORE INTO sync_map(tbl, row_key, local_id)
           SELECT ?, ? || ':' || r.${s.pk}, CAST(r.${s.pk} AS TEXT) FROM ${s.tbl} r
           WHERE NOT EXISTS (SELECT 1 FROM sync_map m WHERE m.tbl = ? AND m.local_id = CAST(r.${s.pk} AS TEXT))`,
          [s.tbl, oldDev, s.tbl],
        )
      }
      this.deps.settings.setFlag(CLOUD_FLAGS.deviceId, crypto.randomUUID())
      this.setState('cursor', 0)
      this.delState('device_registered')
    })
  }

  /** First sync for an account (or a different account): queue every local row for upload. */
  private prepareForUser(uid: string) {
    if (this.getState('user_id') === uid && this.getState('active') === '1') return
    this.db.transaction(() => {
      this.db.run('DELETE FROM sync_outbox')
      for (const s of this.specs()) {
        this.db.run(
          `INSERT INTO sync_outbox(tbl, local_id, nat_key, changed_at)
           SELECT ?, r.${s.pk}, ${keySql(s, 'r') ?? 'NULL'}, ${this.snapshotTs(s)} FROM ${s.tbl} r`,
          [s.tbl],
        )
      }
      this.setState('user_id', uid)
      this.setState('cursor', 0)
      this.setState('active', '1')
      this.delState('device_registered')
    })
  }

  /** After the cloud data was deleted: stop capturing changes until the next sign-in. */
  resetAfterCloudDelete(): void {
    this.db.transaction(() => {
      this.db.run('DELETE FROM sync_outbox')
      this.delState('active', 'user_id', 'cursor', 'device_registered', 'last_sync_at', 'last_error')
    })
    this.registeredThisRun = false
  }

  // ---------- server registration ----------
  async registerDevice(): Promise<void> {
    const uid = this.cloud.userId()
    if (!uid) throw new CloudError('not_signed_in', cloudMessage('not_signed_in'))
    const dev = this.deviceId()
    await this.cloud.json('/rest/v1/devices?on_conflict=id', {
      method: 'POST',
      headers: { prefer: 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify({
        id: dev,
        user_id: uid,
        name: this.deviceName(),
        platform: 'windows',
        app_version: this.appVersion,
        last_seen_at: this.deps.now().toISOString(),
      }),
    })
    this.setState('device_registered', dev)
    this.registeredThisRun = true
  }

  async upsertProfile(): Promise<void> {
    const uid = this.cloud.userId()
    if (!uid) throw new CloudError('not_signed_in', cloudMessage('not_signed_in'))
    await this.cloud.json('/rest/v1/profiles?on_conflict=user_id', {
      method: 'POST',
      headers: { prefer: 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify({
        user_id: uid,
        display_name: this.deps.learner.profile().displayName.slice(0, 60),
        updated_at: this.deps.now().toISOString(),
      }),
    })
  }

  /** Right after verifyCode: register this PC and the display name. */
  async onSignedIn(): Promise<void> {
    await this.registerDevice()
    await this.upsertProfile()
  }

  // ---------- keys ----------
  private mapGet(tbl: string, rowKey: string): string | null {
    return this.db.value<string>('SELECT local_id FROM sync_map WHERE tbl = ? AND row_key = ?', [tbl, rowKey]) ?? null
  }
  private mapKeyOf(tbl: string, localId: string): string | null {
    return (
      this.db.value<string>('SELECT row_key FROM sync_map WHERE tbl = ? AND local_id = ? LIMIT 1', [tbl, localId]) ??
      null
    )
  }

  private findPks(spec: SyncTableSpec, key: string): unknown[] {
    const sql =
      spec.findSql ??
      `SELECT r.${spec.pk} AS pk FROM ${spec.tbl} r WHERE ${keySql(spec, 'r')} = ? ORDER BY r.${spec.pk} DESC`
    return this.db.all<{ pk: unknown }>(sql, [key]).map((r) => r.pk)
  }

  private rowExists(spec: SyncTableSpec, pk: unknown): boolean {
    return !!this.db.value(`SELECT 1 FROM ${spec.tbl} WHERE ${spec.pk} = ?`, [toParam(pk)])
  }

  /** Sync key of a local row (used for references and for device-keyed rows). */
  private keyOfLocal(spec: SyncTableSpec, localId: unknown): string | null {
    if (localId === null || localId === undefined) return null
    if (spec.kind === 'device') return this.mapKeyOf(spec.tbl, String(localId)) ?? `${this.deviceId()}:${localId}`
    return (
      this.db.value<string>(`SELECT ${keySql(spec, 'r')} AS k FROM ${spec.tbl} r WHERE r.${spec.pk} = ?`, [
        toParam(localId),
      ]) ?? null
    )
  }

  /** Local primary key for a sync key, or null when the row is not here. */
  private localIdOf(spec: SyncTableSpec, key: unknown): unknown {
    if (typeof key !== 'string' || !key) return null
    if (spec.kind !== 'device') return this.findPks(spec, key)[0] ?? null
    const own = `${this.deviceId()}:`
    const local = key.startsWith(own) ? key.slice(own.length) : this.mapGet(spec.tbl, key)
    if (local === null) return null
    const pk = spec.autoId ? Number(local) : local
    return this.rowExists(spec, pk) ? pk : null
  }

  private enrich(spec: SyncTableSpec, row: Row): Record<string, unknown> {
    const data: Record<string, unknown> = { ...row }
    for (const ref of spec.refs ?? []) {
      const parent = SYNC_TABLE_MAP.get(ref.table)
      data[ref.field] = parent ? this.keyOfLocal(parent, row[ref.col]) : null
    }
    return data
  }

  // ---------- push ----------
  /** Builds the rows to upload from the outbox (current row state, or a deletion). */
  buildPushRows(): { rows: SyncRowOut[]; maxId: number } {
    const maxId = Number(this.db.value('SELECT COALESCE(MAX(id), 0) FROM sync_outbox') ?? 0)
    if (!maxId) return { rows: [], maxId }
    const groups = this.db.all<{ tbl: string; local_id: string; nat_key: string | null; ts: string }>(
      `SELECT tbl, MAX(local_id) AS local_id, nat_key, MAX(changed_at) AS ts FROM sync_outbox WHERE id <= ?
       GROUP BY tbl, CASE WHEN nat_key IS NULL THEN '#' || local_id ELSE nat_key END ORDER BY MIN(id)`,
      [maxId],
    )
    const out = new Map<string, SyncRowOut>()
    const add = (r: SyncRowOut) => {
      out.delete(`${r.tbl}\u0000${r.row_key}`)
      out.set(`${r.tbl}\u0000${r.row_key}`, r)
    }
    for (const g of groups) {
      const spec = SYNC_TABLE_MAP.get(g.tbl)
      if (!spec || !this.tableExists(spec.tbl)) continue
      // Postgres rejects the whole batch on one bad timestamp, so anything unparsable counts as "very old".
      const ts = time(g.ts) ? new Date(time(g.ts)).toISOString() : EPOCH
      if (spec.kind === 'device') {
        const pk = spec.autoId ? Number(g.local_id) : g.local_id
        const row = this.db.get<Row>(`SELECT * FROM ${spec.tbl} WHERE ${spec.pk} = ?`, [pk])
        const rowKey = this.mapKeyOf(spec.tbl, g.local_id) ?? `${this.deviceId()}:${g.local_id}`
        add({
          tbl: spec.tbl,
          row_key: rowKey,
          data: row ? this.enrich(spec, row) : {},
          deleted: !row,
          client_updated_at: ts,
        })
        continue
      }
      if (!g.nat_key) continue // e.g. a schedule removed together with its word – covered by the word below
      const pk = this.findPks(spec, g.nat_key)[0]
      const row =
        pk === undefined ? undefined : this.db.get<Row>(`SELECT * FROM ${spec.tbl} WHERE ${spec.pk} = ?`, [toParam(pk)])
      const wordKeyed = spec.tbl === 'vocabulary' || spec.tbl === 'review_schedules'
      add({
        tbl: spec.tbl,
        row_key: g.nat_key,
        data: row ? this.enrich(spec, row) : wordKeyed ? { word_key: g.nat_key } : {},
        deleted: !row,
        client_updated_at: ts,
      })
      if (!row && spec.tbl === 'vocabulary')
        add({
          tbl: 'review_schedules',
          row_key: g.nat_key,
          data: { word_key: g.nat_key },
          deleted: true,
          client_updated_at: ts,
        })
    }
    return { rows: [...out.values()], maxId }
  }

  async push(): Promise<number> {
    const { rows, maxId } = this.buildPushRows()
    if (!rows.length) {
      if (maxId) this.db.run('DELETE FROM sync_outbox WHERE id <= ?', [maxId])
      return 0
    }
    const device = this.deviceId()
    for (let i = 0; i < rows.length; i += PUSH_BATCH) {
      await this.cloud.rpc<number>('sync_push', { rows: rows.slice(i, i + PUSH_BATCH), device })
    }
    this.db.run('DELETE FROM sync_outbox WHERE id <= ?', [maxId])
    return rows.length
  }

  // ---------- pull ----------
  async pull(): Promise<{ pulled: number; applied: number }> {
    let cursor = Number(this.getState('cursor') ?? 0)
    const rows: SyncRowIn[] = []
    for (;;) {
      const page = await this.cloud.json<SyncRowIn[]>(
        `/rest/v1/sync_rows?select=*&seq=gt.${cursor}&order=seq&limit=${PULL_PAGE}`,
      )
      if (!Array.isArray(page) || !page.length) break
      rows.push(...page)
      cursor = Math.max(cursor, ...page.map((r) => Number(r.seq) || 0))
      if (page.length < PULL_PAGE) break
    }
    if (!rows.length) return { pulled: 0, applied: 0 }
    const applied = this.apply(rows, cursor)
    return { pulled: rows.length, applied }
  }

  /** Applies pulled rows (triggers muted) and advances the cursor. Returns how many rows changed locally. */
  apply(rows: SyncRowIn[], cursor: number): number {
    const dev = this.deviceId()
    const latest = new Map<string, SyncRowIn>()
    for (const r of rows) {
      if (!r || typeof r.tbl !== 'string' || typeof r.row_key !== 'string') continue
      if (r.device_id && r.device_id === dev) continue // our own push coming back
      const k = `${r.tbl}\u0000${r.row_key}`
      const prev = latest.get(k)
      if (!prev || Number(prev.seq) < Number(r.seq)) latest.set(k, r)
    }
    const byTable = new Map<string, SyncRowIn[]>()
    for (const r of latest.values()) {
      const list = byTable.get(r.tbl) ?? []
      list.push(r)
      byTable.set(r.tbl, list)
    }
    const dates = new Set<string>()
    let applied = 0
    this.db.transaction(() => {
      this.setState('suppress', '1')
      try {
        for (const spec of this.specs()) {
          const list = (byTable.get(spec.tbl) ?? []).sort((a, b) => Number(a.seq) - Number(b.seq))
          for (const r of list) {
            try {
              if (this.db.transaction(() => this.applyOne(spec, r, dates))) applied++
            } catch (err) {
              this.deps.log.warn(`sync: skipped ${spec.tbl}/${r.row_key}: ${err instanceof Error ? err.message : err}`)
            }
          }
        }
      } finally {
        this.delState('suppress')
      }
      this.setState('cursor', cursor)
    })
    if (applied) {
      this.deps.progress.recomputeDerived(dates)
      this.deps.onPulled?.()
    }
    return applied
  }

  /** A local change newer than the remote row wins (it is pushed next); an older one is dropped. */
  private localWins(spec: SyncTableSpec, natKey: string | null, localId: unknown, remoteTs: string): boolean {
    const where =
      natKey !== null ? 'tbl = ? AND nat_key = ?' : 'tbl = ? AND nat_key IS NULL AND local_id = CAST(? AS TEXT)'
    const params = [spec.tbl, natKey ?? toParam(localId)]
    const pending = this.db.value<string>(`SELECT MAX(changed_at) FROM sync_outbox WHERE ${where}`, params)
    if (!pending) return false
    if (time(pending) > time(remoteTs)) return true
    this.db.run(`DELETE FROM sync_outbox WHERE ${where}`, params)
    return false
  }

  private values(spec: SyncTableSpec, data: Record<string, unknown>): Record<string, Param> | null {
    const cols = this.cols(spec.tbl)
    const v: Record<string, Param> = {}
    for (const [k, val] of Object.entries(data)) {
      if (!cols.has(k) || (k === spec.pk && spec.autoId)) continue
      v[k] = toParam(val)
    }
    for (const ref of spec.refs ?? []) {
      const parent = SYNC_TABLE_MAP.get(ref.table)
      const id = parent ? this.localIdOf(parent, data[ref.field]) : null
      if (id === null && ref.required) return null
      v[ref.col] = toParam(id)
    }
    if (spec.kind === 'singleton') v[spec.pk] = 1
    return v
  }

  private write(spec: SyncTableSpec, v: Record<string, Param>, existing: unknown): unknown {
    const keys = Object.keys(v)
    if (existing !== null && existing !== undefined) {
      const set = keys.filter((k) => k !== spec.pk || !spec.autoId)
      if (set.length)
        this.db.run(`UPDATE ${spec.tbl} SET ${set.map((k) => `${k} = ?`).join(', ')} WHERE ${spec.pk} = ?`, [
          ...set.map((k) => v[k]),
          toParam(existing),
        ])
      return existing
    }
    const res = this.db.run(
      `INSERT INTO ${spec.tbl} (${keys.join(', ')}) VALUES (${keys.map(() => '?').join(', ')})`,
      keys.map((k) => v[k]),
    )
    return spec.autoId ? res.lastInsertRowid : v[spec.pk]
  }

  private dateOf(spec: SyncTableSpec, pk: unknown, dates: Set<string>) {
    if (!DATED_TABLES.has(spec.tbl)) return
    const d = this.db.value<string>(`SELECT date FROM ${spec.tbl} WHERE ${spec.pk} = ?`, [toParam(pk)])
    if (d) dates.add(d)
  }

  private applyOne(spec: SyncTableSpec, r: SyncRowIn, dates: Set<string>): boolean {
    const data = r.data && typeof r.data === 'object' ? r.data : {}
    if (spec.kind !== 'device') {
      const key = spec.kind === 'singleton' ? 'singleton' : r.row_key
      if (this.localWins(spec, key, null, r.client_updated_at)) return false
      const pks = this.findPks(spec, key)
      if (r.deleted) {
        for (const pk of pks) this.db.run(`DELETE FROM ${spec.tbl} WHERE ${spec.pk} = ?`, [toParam(pk)])
        return pks.length > 0
      }
      const v = this.values(spec, data)
      if (!v) return false
      this.write(spec, v, pks[0] ?? null)
      return true
    }

    // device-keyed rows
    const own = `${this.deviceId()}:`
    let local: unknown = r.row_key.startsWith(own) ? r.row_key.slice(own.length) : this.mapGet(spec.tbl, r.row_key)
    if (local !== null && spec.autoId) local = Number(local)
    if (local === null && !spec.autoId && typeof data[spec.pk] === 'string') local = data[spec.pk]
    const exists = local !== null && this.rowExists(spec, local)
    if (exists && this.localWins(spec, null, local, r.client_updated_at)) return false
    if (r.deleted) {
      if (!exists) return false
      this.dateOf(spec, local, dates)
      this.db.run(`DELETE FROM ${spec.tbl} WHERE ${spec.pk} = ?`, [toParam(local)])
      return true
    }
    const v = this.values(spec, data)
    if (!v) return false
    if (exists) this.dateOf(spec, local, dates)
    const id = this.write(spec, v, exists ? local : null)
    this.db.run('INSERT OR REPLACE INTO sync_map(tbl, row_key, local_id) VALUES (?, ?, ?)', [
      spec.tbl,
      r.row_key,
      String(id),
    ])
    if (DATED_TABLES.has(spec.tbl) && typeof v.date === 'string') dates.add(v.date)
    return true
  }

  // ---------- orchestration ----------
  /** Push local changes, then pull remote ones. Concurrent calls share one run. */
  syncNow(): Promise<SyncResult> {
    if (this.running) return this.running
    this.running = this.run().finally(() => {
      this.running = null
    })
    return this.running
  }

  private async run(): Promise<SyncResult> {
    try {
      const uid = this.cloud.isSignedIn() ? this.cloud.userId() : null
      if (!uid) throw new CloudError('not_signed_in', cloudMessage('not_signed_in'))
      this.prepareForUser(uid)
      if (!this.registeredThisRun || this.getState('device_registered') !== this.deviceId()) await this.registerDevice()
      const pushed = await this.push()
      const { pulled, applied } = await this.pull()
      this.setState('last_sync_at', this.deps.now().toISOString())
      this.setState('last_pushed', pushed)
      this.setState('last_pulled', pulled)
      this.delState('last_error')
      if (pushed || applied) this.deps.log.info(`sync: pushed ${pushed}, pulled ${pulled}, applied ${applied}`)
      return { pushed, pulled, applied }
    } catch (err) {
      try {
        this.setState('last_error', err instanceof Error ? err.message : String(err))
      } catch {
        /* database closed */
      }
      throw err
    }
  }

  /** Best-effort upload of pending changes before the app quits (bounded by timeoutMs). */
  async flushBeforeQuit(timeoutMs = 4000): Promise<void> {
    try {
      if (!this.cloud.isSignedIn() || !this.settings().autoSync || !this.pendingCount()) return
    } catch {
      return
    }
    await Promise.race([
      (this.running ?? this.push()).then(
        () => undefined,
        () => undefined,
      ),
      new Promise<void>((resolve) => setTimeout(resolve, timeoutMs)),
    ])
  }
}
