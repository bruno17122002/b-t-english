// Browser storage adapters: localStorage for small values (config, session, queue, settings) and IndexedDB for
// the synced-row cache (can be several MB). Both fall back to memory when the browser blocks storage.
import { memoryKV, type KV } from './supabase'
import type { SyncCache } from './sync'

export function browserKV(): KV {
  try {
    const ls = globalThis.localStorage
    const probe = '__lq_probe__'
    ls.setItem(probe, '1')
    ls.removeItem(probe)
    return {
      get: (k) => ls.getItem(k),
      set: (k, v) => {
        try {
          ls.setItem(k, v)
        } catch {
          /* quota exceeded – value stays in memory for this session only */
        }
      },
      remove: (k) => ls.removeItem(k),
    }
  } catch {
    return memoryKV()
  }
}

const DB_NAME = 'lingua-quest'
const STORE = 'cache'

function openDb(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    try {
      const req = indexedDB.open(DB_NAME, 1)
      req.onupgradeneeded = () => req.result.createObjectStore(STORE)
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => resolve(null)
      req.onblocked = () => resolve(null)
    } catch {
      resolve(null)
    }
  })
}

let dbPromise: Promise<IDBDatabase | null> | null = null
const memory = new Map<string, SyncCache>()
const db = () => (dbPromise ??= openDb())

export async function loadCache(userId: string): Promise<SyncCache | null> {
  const d = await db()
  if (!d) return memory.get(userId) ?? null
  return new Promise((resolve) => {
    try {
      const req = d.transaction(STORE, 'readonly').objectStore(STORE).get(userId)
      req.onsuccess = () => {
        const v = req.result as SyncCache | undefined
        resolve(v && v.userId === userId && v.rows ? v : null)
      }
      req.onerror = () => resolve(null)
    } catch {
      resolve(null)
    }
  })
}

export async function saveCache(cache: SyncCache): Promise<void> {
  memory.set(cache.userId, cache)
  const d = await db()
  if (!d) return
  await new Promise<void>((resolve) => {
    try {
      const tx = d.transaction(STORE, 'readwrite')
      tx.objectStore(STORE).put(cache, cache.userId)
      tx.oncomplete = () => resolve()
      tx.onerror = () => resolve()
      tx.onabort = () => resolve()
    } catch {
      resolve()
    }
  })
}

/** Removes every cached copy of synced data on this device (sign-out). */
export async function clearAllCaches(): Promise<void> {
  memory.clear()
  const d = await db()
  if (d) {
    await new Promise<void>((resolve) => {
      try {
        const tx = d.transaction(STORE, 'readwrite')
        tx.objectStore(STORE).clear()
        tx.oncomplete = () => resolve()
        tx.onerror = () => resolve()
      } catch {
        resolve()
      }
    })
  }
  try {
    await globalThis.caches?.delete('lq-api')
  } catch {
    /* Cache Storage unavailable */
  }
  navigator.serviceWorker?.controller?.postMessage('clear-api')
}
