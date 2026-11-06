// Global app state: bootstrap data, settings, game summary, toasts and reward celebrations.
import { create } from 'zustand'
import type { BootstrapData } from '@shared/kernelContract'
import type { AppSettings, GameState, Profile, Reward } from '@shared/types'
import { api } from './api'

export interface Toast {
  id: number
  kind: 'success' | 'error' | 'info' | 'xp'
  title: string
  body?: string
  action?: { label: string; route: string }
}

interface AppState {
  boot: BootstrapData | null
  profile: Profile | null
  settings: AppSettings | null
  game: GameState | null
  dueCards: number
  toasts: Toast[]
  rewards: Reward[]
  setBoot(b: BootstrapData): void
  setProfile(p: Profile): void
  setSettings(s: AppSettings): void
  updateSettings(patch: Partial<AppSettings>): Promise<void>
  refreshGame(): Promise<void>
  toast(t: Omit<Toast, 'id'>): void
  dismissToast(id: number): void
  pushReward(r: Reward): void
  shiftReward(): void
  /** Drops every queued celebration; their XP is summed into one toast so nothing goes unacknowledged. */
  clearRewards(): void
}

let toastId = 0

export const useApp = create<AppState>((set, get) => ({
  boot: null,
  profile: null,
  settings: null,
  game: null,
  dueCards: 0,
  toasts: [],
  rewards: [],
  setBoot: (b) => set({ boot: b, profile: b.profile, settings: b.settings, game: b.game, dueCards: b.dueCards }),
  setProfile: (p) => set({ profile: p }),
  setSettings: (s) => set({ settings: s }),
  async updateSettings(patch) {
    const prev = get().settings
    if (prev) set({ settings: { ...prev, ...patch } })
    try {
      set({ settings: await api('settings:update', patch) })
    } catch (err) {
      if (prev) set({ settings: prev })
      get().toast({ kind: 'error', title: err instanceof Error ? err.message : String(err) })
    }
  },
  async refreshGame() {
    try {
      const [game, stats] = await Promise.all([api('progress:game'), api('vocab:stats')])
      set({ game, dueCards: stats.dueNow })
    } catch {
      /* non-critical */
    }
  },
  toast(t) {
    const id = ++toastId
    set({ toasts: [...get().toasts, { ...t, id }].slice(-4) })
    setTimeout(() => get().dismissToast(id), t.kind === 'error' ? 7000 : 4000)
  },
  dismissToast: (id) => set({ toasts: get().toasts.filter((t) => t.id !== id) }),
  pushReward: (r) => set({ rewards: [...get().rewards, r] }),
  shiftReward: () => set({ rewards: get().rewards.slice(1) }),
  clearRewards() {
    const xp = get()
      .rewards.slice(1)
      .reduce((sum, r) => sum + r.xpGained, 0)
    set({ rewards: [] })
    if (xp > 0) get().toast({ kind: 'xp', title: `+${xp} XP` })
  },
}))

export const useSettings = () => useApp((s) => s.settings)
export const useLang = () => useApp((s) => s.settings?.uiLanguage ?? 'vi')
