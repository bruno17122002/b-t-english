// App root: bootstraps state, applies theme, gates onboarding and renders the shell with module routes.
import { Suspense, useEffect, useState } from 'react'
import { Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom'
import { MODULES_RENDERER } from '@modules/registry.renderer'
import type { Reward } from '@shared/types'
import { ErrorBoundary } from './components/shell/ErrorBoundary'
import { Shell } from './components/shell/Shell'
import { Button, Modal, Spinner } from './components/ui'
import { useL } from './i18n'
import { api, toApiError } from './lib/api'
import { useApp } from './lib/store'
import { LibraryPage } from './pages/LibraryPage'
import { NotFoundPage } from './pages/NotFoundPage'
import { SettingsPage } from './pages/settings/SettingsPage'

function useThemeSync() {
  const settings = useApp((s) => s.settings)
  const game = useApp((s) => s.game)
  useEffect(() => {
    if (!settings) return
    const root = document.documentElement
    const apply = () => {
      const dark =
        settings.theme === 'dark' ||
        (settings.theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches)
      root.dataset.theme = dark ? 'dark' : 'light'
    }
    apply()
    const accent = game && !game.unlockedAccents.includes(settings.accent) ? 'aurora' : settings.accent
    root.dataset.accent = accent
    root.dataset.reduceMotion = String(settings.reduceMotion)
    root.lang = settings.uiLanguage
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    mq.addEventListener('change', apply)
    return () => mq.removeEventListener('change', apply)
  }, [settings, game])
}

function usePushEvents() {
  const navigate = useNavigate()
  const pushReward = useApp((s) => s.pushReward)
  const refreshGame = useApp((s) => s.refreshGame)
  useEffect(() => {
    if (!window.lq) return
    const offReward = window.lq.on('reward', (r) => {
      pushReward(r as Reward)
      void refreshGame()
    })
    const offNav = window.lq.on('navigate', (route) => typeof route === 'string' && navigate(route))
    return () => {
      offReward()
      offNav()
    }
  }, [navigate, pushReward, refreshGame])
}

/** Shown once after start-up when the data file was damaged and the app had to recover (see B26). */
function DataRecoveryNotice() {
  const L = useL()
  const navigate = useNavigate()
  const recovery = useApp((s) => s.boot?.dataRecovery ?? null)
  const [open, setOpen] = useState(true)
  if (!recovery) return null
  const close = () => setOpen(false)
  return (
    <Modal
      open={open}
      onClose={close}
      title={L('Your data was repaired', 'Dữ liệu đã được khôi phục')}
      footer={
        <>
          <Button variant="ghost" onClick={close}>
            {L('OK', 'Đã hiểu')}
          </Button>
          <Button
            variant="primary"
            onClick={() => {
              close()
              navigate('/settings/data')
            }}
          >
            {L('Open backups', 'Mở sao lưu')}
          </Button>
        </>
      }
    >
      <p className="text-sm text-muted" data-testid="data-recovery">
        {recovery.kind === 'backup'
          ? L(
              'The data file was damaged, so Lingua Quest opened the latest saved copy. The last few changes may be missing.',
              'Dữ liệu bị hỏng nên Lingua Quest đã mở bản lưu gần nhất; vài thay đổi cuối có thể bị mất.',
            )
          : L(
              'The data file was damaged and no usable copy was found. Go to Settings → Data to restore a backup.',
              'Dữ liệu bị hỏng và không có bản lưu dùng được. Vào Cài đặt → Dữ liệu để khôi phục bản sao lưu.',
            )}
      </p>
    </Modal>
  )
}

const moduleRoutes = MODULES_RENDERER.flatMap((m) => m.routes.map((r) => ({ ...r, moduleId: m.id })))
const moduleBackgrounds = MODULES_RENDERER.flatMap((m) =>
  m.Background ? [{ id: m.id, Background: m.Background }] : [],
)

export function App() {
  const boot = useApp((s) => s.boot)
  const setBoot = useApp((s) => s.setBoot)
  const profile = useApp((s) => s.profile)
  const [error, setError] = useState<string | null>(null)
  const location = useLocation()
  useThemeSync()
  usePushEvents()

  const load = () => {
    setError(null)
    api('app:bootstrap')
      .then(setBoot)
      .catch((err) => setError(toApiError(err).message))
  }
  useEffect(load, [setBoot])

  if (error)
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4 p-8 text-center">
        <h1 className="font-display text-2xl">Lingua Quest</h1>
        <p className="max-w-md text-muted">{error}</p>
        <Button variant="primary" onClick={load}>
          Thử lại / Retry
        </Button>
      </div>
    )
  if (!boot || !profile)
    return (
      <div className="flex h-full items-center justify-center" aria-busy="true">
        <Spinner className="size-8" />
      </div>
    )

  const needsOnboarding = !profile.onboardingCompletedAt
  if (needsOnboarding && !location.pathname.startsWith('/onboarding') && !location.pathname.startsWith('/settings')) {
    return <Navigate to="/onboarding" replace />
  }

  return (
    <ErrorBoundary>
      <Shell bare={location.pathname.startsWith('/onboarding')}>
        <DataRecoveryNotice />
        {moduleBackgrounds.map(({ id, Background }) => (
          <Background key={id} />
        ))}
        <Suspense
          fallback={
            <div className="flex h-64 items-center justify-center">
              <Spinner className="size-7" />
            </div>
          }
        >
          <Routes>
            {moduleRoutes.map(({ path, Component, moduleId }) => (
              <Route
                key={`${moduleId}:${path}`}
                path={path}
                element={
                  <ErrorBoundary key={path}>
                    <Component />
                  </ErrorBoundary>
                }
              />
            ))}
            <Route path="/settings/*" element={<SettingsPage />} />
            <Route path="/library" element={<LibraryPage />} />
            <Route path="*" element={<NotFoundPage />} />
          </Routes>
        </Suspense>
      </Shell>
    </ErrorBoundary>
  )
}
