// IPC handlers for the optional online account: server config, email-code sign-in, multi-device sync,
// cloud backups (Supabase Storage), registered devices and "delete all my cloud data".
import fs from 'node:fs'
import type { CloudDeviceView } from '@shared/kernelContract'
import type { Kernel } from '../kernel'
import { SyncEngine } from '../kernel/cloud/sync'
import type { HostBridge } from './kernelHandlers'
import { UserError, type IpcRouter } from './router'

/**
 * Validated restore with the same safety net as a local restore: a pre-restore backup of the current data,
 * atomic replacement, a new sync identity for the restored database, then a relaunch.
 */
export async function restoreDatabaseFrom(k: Kernel, host: HostBridge, file: string): Promise<void> {
  if (!k.paths.dbFile) throw new UserError('no_db_file', 'Database đang chạy trong bộ nhớ, không thể khôi phục.')
  try {
    await k.data.validateBackup(file)
  } catch (err) {
    throw new UserError(
      'invalid_backup',
      `File sao lưu không hợp lệ: ${err instanceof Error ? err.message : String(err)}`,
    )
  }
  k.db.flush()
  await k.data.restoreBackup(file, k.paths.dbFile)
  SyncEngine.markRestored(k.paths.userData)
  k.log.info(`database restored from ${file.split(/[\\/]/).pop() ?? 'backup'}; relaunching`)
  setTimeout(() => host.relaunch(), 300)
}

export function registerCloudHandlers(r: IpcRouter, k: Kernel, host: HostBridge): void {
  k.sync.appVersion = host.version

  r.handle('cloud:status', () => k.cloud.status())
  r.handle('cloud:configure', ({ url, anonKey }) => {
    k.cloud.configure(url, anonKey)
    return k.cloud.status()
  })
  r.handle('cloud:sendCode', async ({ email }) => {
    await k.cloud.sendCode(email)
    return null
  })
  r.handle('cloud:verifyCode', async ({ email, code }) => {
    const status = await k.cloud.verifyCode(email, code)
    // Registering the PC and the display name must not fail the sign-in itself (it is retried on sync).
    await k.sync.onSignedIn().catch((err: unknown) => k.log.warn(`device registration failed: ${String(err)}`))
    return status
  })
  r.handle('cloud:signOut', async () => {
    await k.cloud.signOut()
    return k.cloud.status()
  })
  r.handle('cloud:deleteMyData', async () => {
    await k.cloud.rpc('delete_my_data')
    k.sync.resetAfterCloudDelete()
    await k.cloud.signOut()
    return k.cloud.status()
  })
  r.handle('cloud:devices', async () => {
    const rows = await k.cloud.json<
      { id: string; name: string; platform: string; app_version: string; last_seen_at: string }[]
    >('/rest/v1/devices?select=id,name,platform,app_version,last_seen_at&order=last_seen_at.desc')
    const current = k.cloud.status().deviceId
    return (rows ?? []).map((d): CloudDeviceView => ({
      id: d.id,
      name: d.name,
      platform: d.platform,
      appVersion: d.app_version,
      lastSeenAt: d.last_seen_at,
      current: d.id === current,
    }))
  })

  // ---------- cloud backups ----------
  r.handle('cloud:backups', () => k.cloudBackups.list())
  r.handle('cloud:createBackup', () => k.cloudBackups.create())
  r.handle('cloud:deleteBackup', ({ name }) => k.cloudBackups.remove(name))
  r.handle('cloud:restoreBackup', async ({ name }) => {
    let file: string
    try {
      file = (await k.cloudBackups.download(name)).file
    } catch (err) {
      if (err instanceof Error && err.name === 'CloudError') throw err
      throw new UserError(
        'invalid_backup',
        `File sao lưu không hợp lệ: ${err instanceof Error ? err.message : String(err)}`,
      )
    }
    try {
      await restoreDatabaseFrom(k, host, file)
    } finally {
      fs.rmSync(file, { force: true })
    }
    return null
  })

  // ---------- sync ----------
  r.handle('sync:status', () => k.sync.status())
  r.handle('sync:now', async () => {
    await k.sync.syncNow()
    return k.sync.status()
  })
  r.handle('sync:settings', (patch) => (patch ? k.sync.updateSettings(patch) : k.sync.settings()))
}
