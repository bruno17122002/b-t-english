// App state (zustand): auth phase, synced-row cache, offline queue and UI preferences.
import { create } from 'zustand'
import type { Rating } from '@core/srs'
import type { Lang } from './i18n'
import { reviewFromCache, type StudyCard } from './lib/review'
import { browserKV, clearAllCaches, loadCache, saveCache } from './lib/storage'
import { CloudError, SupabaseClient } from './lib/supabase'
import {
  applyRows,
  deviceKey,
  emptyCache,
  enqueue,
  ensureDevice,
  flushQueue,
  loadQueue,
  pullChanges,
  saveQueue,
  type PushRow,
  type SyncCache,
} from './lib/sync'

export type Theme = 'dark' | 'light' | 'system'
export type Phase = 'boot' | 'setup' | 'signedOut' | 'ready'

export const APP_VERSION = '1.0.0'

export const kv = browserKV()
export const client = new SupabaseClient({
  storage: kv,
  defaults: { url: import.meta.env.VITE_CLOUD_URL, anonKey: import.meta.env.VITE_CLOUD_ANON_KEY },
})

const PREFS_KEY = 'lq.prefs'

function loadPrefs(): { lang: Lang; theme: Theme } {
  try {
    const p = JSON.parse(kv.get(PREFS_KEY) ?? '{}') as { lang?: string; theme?: string }
    return {
      lang: p.lang === 'en' ? 'en' : 'vi',
      theme: p.theme === 'light' || p.theme === 'system' ? p.theme : 'dark',
    }
  } catch {
    return { lang: 'vi', theme: 'dark' }
  }
}

interface AppState {
  phase: Phase
  lang: Lang
  theme: Theme
  userId: string | null
  email: string | null
  cache: SyncCache | null
  queue: PushRow[]
  online: boolean
  syncing: boolean
  error: string | null
  setLang(lang: Lang): void
  setTheme(theme: Theme): void
  boot(): Promise<void>
  /** Re-evaluates the phase after configuring the server or signing in. */
  afterAuth(): Promise<void>
  sync(): Promise<void>
  push(): Promise<void>
  review(card: StudyCard, rating: Rating, durationMs: number): void
  signOut(): Promise<void>
  setOnline(online: boolean): void
}

let syncRunning: Promise<void> | null = null

const uuid = () => crypto.randomUUID()

export const useApp = create<AppState>((set, get) => ({
  phase: 'boot',
  ...loadPrefs(),
  userId: null,
  email: null,
  cache: null,
  queue: [],
  online: typeof navigator === 'undefined' ? true : navigator.onLine,
  syncing: false,
  error: null,

  setLang(lang) {
    set({ lang })
    kv.set(PREFS_KEY, JSON.stringify({ lang, theme: get().theme }))
  },
  setTheme(theme) {
    set({ theme })
    kv.set(PREFS_KEY, JSON.stringify({ lang: get().lang, theme }))
  },

  async boot() {
    await get().afterAuth()
  },

  async afterAuth() {
    if (!client.config()) return set({ phase: 'setup', userId: null, email: null, cache: null })
    const s = client.session()
    if (!s) return set({ phase: 'signedOut', userId: null, email: null, cache: null })
    const cache = (await loadCache(s.user.id)) ?? emptyCache(s.user.id)
    const queue = loadQueue(kv, s.user.id)
    // Re-apply queued rows so the UI shows reviews made offline even before they reach the server.
    set({ phase: 'ready', userId: s.user.id, email: s.user.email, cache: applyRows(cache, queue), queue, error: null })
    void get().sync()
  },

  async sync() {
    if (syncRunning) return syncRunning
    syncRunning = (async () => {
      const { userId } = get()
      if (!userId || !get().online) return
      set({ syncing: true, error: null })
      try {
        await get().push()
        const base = get().cache ?? emptyCache(userId)
        const { cache } = await pullChanges(client, base)
        // Rows still waiting in the queue win over older server copies (same LWW rule as the server).
        const merged = applyRows(cache, get().queue)
        set({ cache: merged })
        await saveCache(merged)
      } catch (e) {
        handleError(e, set)
      } finally {
        set({ syncing: false })
      }
    })()
    try {
      await syncRunning
    } finally {
      syncRunning = null
    }
  },

  async push() {
    const { userId, queue } = get()
    if (!userId || !queue.length || !get().online) return
    const device = await ensureDevice(client, kv, userId, {
      name: `Web – ${navigator.userAgent.includes('Mobile') ? 'điện thoại' : 'trình duyệt'}`,
      appVersion: APP_VERSION,
    })
    const res = await flushQueue(client, queue, device)
    if (res.deviceRejected) kv.remove(deviceKey(userId))
    // Rows added while the push was running stay queued.
    const sentIds = new Set(
      queue.slice(0, res.sent).map((r) => `${r.tbl}\u0000${r.row_key}\u0000${r.client_updated_at}`),
    )
    const rest = get().queue.filter((r) => !sentIds.has(`${r.tbl}\u0000${r.row_key}\u0000${r.client_updated_at}`))
    set({ queue: rest })
    saveQueue(kv, userId, rest)
    if (res.error) throw res.error
  },

  review(card, rating, durationMs) {
    const { cache, userId } = get()
    if (!cache || !userId) return
    const { rows } = reviewFromCache(cache, card, rating, new Date(), durationMs, uuid)
    const nextCache = applyRows(cache, rows)
    const queue = enqueue(get().queue, rows)
    set({ cache: nextCache, queue })
    saveQueue(kv, userId, queue)
    void saveCache(nextCache)
    if (get().online)
      void get()
        .push()
        .catch((e: unknown) => handleError(e, set))
  },

  async signOut() {
    const { userId } = get()
    await client.signOut()
    await clearAllCaches()
    if (userId) {
      // Unsent reviews are kept on purpose: signing in again with the same account uploads them.
      kv.remove(deviceKey(userId))
      kv.remove(`lq.tutor.${userId}`)
    }
    set({ phase: client.config() ? 'signedOut' : 'setup', userId: null, email: null, cache: null, queue: [] })
  },

  setOnline(online) {
    set({ online })
    if (online) void get().sync()
  },
}))

function handleError(e: unknown, set: (p: Partial<AppState>) => void) {
  const code = e instanceof CloudError ? e.code : 'network'
  if (code === 'not_signed_in' && !client.session())
    set({ phase: 'signedOut', userId: null, email: null, cache: null, queue: [], error: code })
  else set({ error: code })
}
