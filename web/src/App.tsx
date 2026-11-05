import {
  AlertTriangle,
  BarChart3,
  Bot,
  CloudOff,
  Home,
  Layers,
  Loader2,
  RefreshCw,
  Settings as SettingsIcon,
  Sparkles,
} from 'lucide-react'
import { useEffect, type ReactNode } from 'react'
import { HashRouter, Navigate, NavLink, Route, Routes, useLocation, useNavigate } from 'react-router-dom'
import { cx } from './components/ui'
import { useT, type MsgKey } from './i18n'
import { Login } from './screens/Login'
import { Reports } from './screens/Reports'
import { Review } from './screens/Review'
import { Settings } from './screens/Settings'
import { Setup } from './screens/Setup'
import { Stats } from './screens/Stats'
import { Today } from './screens/Today'
import { Tutor } from './screens/Tutor'
import { client, useApp } from './store'

const TABS: { to: string; key: MsgKey; icon: ReactNode }[] = [
  { to: '/', key: 'tab.today', icon: <Home className="size-5" /> },
  { to: '/review', key: 'tab.review', icon: <Layers className="size-5" /> },
  { to: '/stats', key: 'tab.stats', icon: <BarChart3 className="size-5" /> },
  { to: '/reports', key: 'tab.reports', icon: <Sparkles className="size-5" /> },
  { to: '/tutor', key: 'tab.tutor', icon: <Bot className="size-5" /> },
]

function useThemeAndLang() {
  const theme = useApp((s) => s.theme)
  const lang = useApp((s) => s.lang)
  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: light)')
    const apply = () => {
      const resolved = theme === 'system' ? (media.matches ? 'light' : 'dark') : theme
      document.documentElement.dataset.theme = resolved
      document
        .querySelector('meta[name="theme-color"]')
        ?.setAttribute('content', resolved === 'light' ? '#f3f3f3' : '#202020')
    }
    apply()
    media.addEventListener('change', apply)
    return () => media.removeEventListener('change', apply)
  }, [theme])
  useEffect(() => {
    document.documentElement.lang = lang
  }, [lang])
}

/** Online/offline events, periodic sync (5 min, like the desktop) and token refresh while the app is open. */
function useBackgroundSync() {
  const phase = useApp((s) => s.phase)
  useEffect(() => {
    const on = () => useApp.getState().setOnline(true)
    const off = () => useApp.getState().setOnline(false)
    window.addEventListener('online', on)
    window.addEventListener('offline', off)
    return () => {
      window.removeEventListener('online', on)
      window.removeEventListener('offline', off)
    }
  }, [])
  useEffect(() => {
    if (phase !== 'ready') return
    const tick = () => {
      if (document.visibilityState !== 'visible' || !useApp.getState().online) return
      client.accessToken().catch(() => undefined) // keeps the session fresh (refresh_token grant)
      void useApp.getState().sync()
    }
    const timer = window.setInterval(tick, 5 * 60_000)
    const onVisible = () => document.visibilityState === 'visible' && tick()
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [phase])
}

function SyncBadge() {
  const t = useT()
  const syncing = useApp((s) => s.syncing)
  const online = useApp((s) => s.online)
  // Count reviews rather than rows (one rating = 4 rows).
  const pending = useApp((s) => s.queue.filter((r) => r.tbl === 'review_logs').length || s.queue.length)
  const error = useApp((s) => s.error)
  const sync = useApp((s) => s.sync)
  if (!online)
    return (
      <span className="inline-flex items-center gap-1 rounded-md bg-warning/15 px-2 py-1 text-xs text-warning">
        <CloudOff className="size-3.5" /> {t('sync.offline')}
        {pending > 0 && ` · ${t('sync.pending', { n: pending })}`}
      </span>
    )
  return (
    <button
      onClick={() => void sync()}
      aria-label={t('settings.syncNow')}
      className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-muted active:bg-surface-2"
    >
      {syncing ? (
        <Loader2 className="size-3.5 animate-spin" />
      ) : error ? (
        <AlertTriangle className="size-3.5 text-warning" />
      ) : (
        <RefreshCw className="size-3.5" />
      )}
      {syncing
        ? t('sync.syncing')
        : pending > 0
          ? t('sync.pending', { n: pending })
          : error
            ? t('sync.error')
            : t('sync.ok')}
    </button>
  )
}

function Shell({ children }: { children: ReactNode }) {
  const t = useT()
  const navigate = useNavigate()
  const location = useLocation()
  const title =
    TABS.find((x) => x.to === location.pathname)?.key ??
    (location.pathname === '/settings' ? 'tab.settings' : 'appName')
  return (
    <div className="mx-auto flex h-full max-w-xl flex-col bg-bg">
      <header className="pt-safe sticky top-0 z-10 border-b border-line bg-layer">
        <div className="flex h-12 items-center gap-2 px-4">
          <h1 className="flex-1 truncate text-base font-semibold">{t(title)}</h1>
          <SyncBadge />
          <button
            onClick={() => navigate('/settings')}
            aria-label={t('tab.settings')}
            className={cx(
              'inline-flex size-9 items-center justify-center rounded-md active:bg-surface-2',
              location.pathname === '/settings' ? 'text-accent' : 'text-muted',
            )}
          >
            <SettingsIcon className="size-5" />
          </button>
        </div>
      </header>
      <main className="flex-1 overflow-y-auto px-4 pb-6 pt-3">{children}</main>
      <nav className="pb-safe border-t border-line bg-layer" aria-label="Main">
        <div className="grid grid-cols-5">
          {TABS.map((tab) => (
            <NavLink
              key={tab.to}
              to={tab.to}
              end
              className={({ isActive }) =>
                cx(
                  'flex h-14 flex-col items-center justify-center gap-0.5 text-[11px]',
                  isActive ? 'font-semibold text-accent' : 'text-muted',
                )
              }
            >
              {tab.icon}
              <span className="max-w-full truncate px-1">{t(tab.key)}</span>
            </NavLink>
          ))}
        </div>
      </nav>
    </div>
  )
}

function Gate() {
  const phase = useApp((s) => s.phase)
  if (phase === 'boot')
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="size-6 animate-spin text-muted" />
      </div>
    )
  if (phase === 'setup') return <Setup />
  if (phase === 'signedOut') return <Login />
  return (
    <Shell>
      <Routes>
        <Route path="/" element={<Today />} />
        <Route path="/review" element={<Review />} />
        <Route path="/stats" element={<Stats />} />
        <Route path="/reports" element={<Reports />} />
        <Route path="/tutor" element={<Tutor />} />
        <Route path="/settings" element={<Settings />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Shell>
  )
}

export function App() {
  useThemeAndLang()
  useBackgroundSync()
  useEffect(() => {
    void useApp.getState().boot()
  }, [])
  return (
    <HashRouter>
      <Gate />
    </HashRouter>
  )
}
