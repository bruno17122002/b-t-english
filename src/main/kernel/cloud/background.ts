// Background cloud work in the real app (never in tests): sync shortly after start and every 5 minutes,
// then the daily cloud backup when enabled. Failures (offline, server down) are logged and shown as the
// sync status' last error; the next tick simply tries again.
import type { Kernel } from '..'
import { SYNC_INTERVAL_MS } from './sync'

export function startCloudServices(k: Kernel, opts: { firstDelayMs?: number } = {}): () => void {
  let stopped = false
  const tick = async () => {
    if (stopped || !k.cloud.isSignedIn()) return
    if (k.sync.settings().autoSync) {
      try {
        await k.sync.syncNow()
      } catch (err) {
        k.log.warn(`sync failed: ${err instanceof Error ? err.message : String(err)}`)
      }
    }
    try {
      await k.cloudBackups.maybeDailyBackup()
    } catch (err) {
      k.log.warn(`cloud backup failed: ${err instanceof Error ? err.message : String(err)}`)
    }
  }
  const first = setTimeout(() => void tick(), opts.firstDelayMs ?? 5000)
  const every = setInterval(() => void tick(), SYNC_INTERVAL_MS)
  return () => {
    stopped = true
    clearTimeout(first)
    clearInterval(every)
  }
}
