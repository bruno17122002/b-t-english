// Cloud backups (B&T English Online, phase 1): the same SQLite file as a local backup, uploaded to the private
// Supabase Storage bucket `backups/<user id>/lingua-quest-<stamp>.sqlite`. API keys live in keys.bin, never in
// the database, so a cloud backup never contains them. The last 20 backups are kept.
import fs from 'node:fs'
import path from 'node:path'
import { localDateKey } from '@core/dates'
import type { AppDatabase } from '../../db/database'
import type { DataService } from '../data/dataService'
import { CloudError, cloudMessage, type CloudClient } from './client'
import type { SyncEngine } from './sync'

export const CLOUD_BACKUP_BUCKET = 'backups'
export const CLOUD_BACKUP_KEEP = 20
export const CLOUD_BACKUP_NAME = /^lingua-quest-[0-9A-Za-z_-]{1,80}\.sqlite$/

export interface CloudBackupInfo {
  name: string
  sizeBytes: number
  createdAt: string
}

export interface CloudBackupDeps {
  db: AppDatabase
  cloud: CloudClient
  data: DataService
  sync: SyncEngine
  /** Folder for downloaded backups waiting to be validated/restored. */
  tmpDir: string
  now: () => Date
}

const stamp = (d: Date) => d.toISOString().replace(/[:T]/g, '-').replace(/\..+$/, '')

export class CloudBackupService {
  constructor(private readonly deps: CloudBackupDeps) {}

  private uid(): string {
    const uid = this.deps.cloud.isSignedIn() ? this.deps.cloud.userId() : null
    if (!uid) throw new CloudError('not_signed_in', cloudMessage('not_signed_in'))
    return uid
  }

  private checkName(name: string) {
    if (!CLOUD_BACKUP_NAME.test(name)) throw new CloudError('bad_request', 'Tên bản sao lưu không hợp lệ.')
  }

  async create(): Promise<CloudBackupInfo> {
    const uid = this.uid()
    const now = this.deps.now()
    const name = `lingua-quest-${stamp(now)}.sqlite`
    const bytes = this.deps.db.exportBytes()
    await this.deps.cloud.upload(CLOUD_BACKUP_BUCKET, `${uid}/${name}`, bytes, 'application/vnd.sqlite3')
    this.deps.sync.setState('last_cloud_backup_at', now.toISOString())
    this.deps.sync.setState('last_cloud_backup_day', localDateKey(now))
    await this.prune().catch(() => undefined)
    return { name, sizeBytes: bytes.byteLength, createdAt: now.toISOString() }
  }

  async list(): Promise<CloudBackupInfo[]> {
    const uid = this.uid()
    const items = await this.deps.cloud.list(CLOUD_BACKUP_BUCKET, uid)
    return (items ?? [])
      .filter((i) => CLOUD_BACKUP_NAME.test(i.name))
      .map((i) => ({
        name: i.name,
        sizeBytes: Number(i.metadata?.size ?? 0),
        createdAt: i.created_at ?? i.updated_at ?? '',
      }))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.name.localeCompare(a.name))
  }

  /** Keeps the newest `keep` backups. */
  async prune(keep = CLOUD_BACKUP_KEEP): Promise<number> {
    const uid = this.uid()
    const extra = (await this.list()).slice(keep)
    if (extra.length)
      await this.deps.cloud.remove(
        CLOUD_BACKUP_BUCKET,
        extra.map((b) => `${uid}/${b.name}`),
      )
    return extra.length
  }

  async remove(name: string): Promise<CloudBackupInfo[]> {
    this.checkName(name)
    const uid = this.uid()
    await this.deps.cloud.remove(CLOUD_BACKUP_BUCKET, [`${uid}/${name}`])
    return this.list()
  }

  /**
   * Downloads a backup into the temp folder and validates it (SQLite header, integrity, schema version).
   * Returns the local file; the caller restores it with the same safety-copy + relaunch flow as a local backup.
   */
  async download(name: string): Promise<{ file: string; schemaVersion: number; words: number }> {
    this.checkName(name)
    const uid = this.uid()
    const bytes = await this.deps.cloud.download(CLOUD_BACKUP_BUCKET, `${uid}/${name}`)
    fs.mkdirSync(this.deps.tmpDir, { recursive: true })
    const file = path.join(this.deps.tmpDir, name)
    fs.writeFileSync(file, bytes)
    try {
      const info = await this.deps.data.validateBackup(file)
      return { file, ...info }
    } catch (err) {
      fs.rmSync(file, { force: true })
      throw err
    }
  }

  /** Once a day when enabled (called from the background timer). Skips an empty database. */
  async maybeDailyBackup(): Promise<CloudBackupInfo | null> {
    if (!this.deps.sync.settings().dailyCloudBackup || !this.deps.cloud.isSignedIn()) return null
    const today = localDateKey(this.deps.now())
    if (this.deps.sync.getState('last_cloud_backup_day') === today) return null
    const hasData =
      Number(this.deps.db.value('SELECT COUNT(*) FROM vocabulary') ?? 0) +
        Number(this.deps.db.value('SELECT COUNT(*) FROM activity_log') ?? 0) >
      0
    if (!hasData) return null
    return this.create()
  }
}
