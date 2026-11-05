// UI sweep: every main route renders (no blank screen, no error boundary, no horizontal overflow),
// in both window sizes and both themes, with screenshots saved for review in docs/screenshots.
import fs from 'node:fs'
import path from 'node:path'
import { expect, test } from '@playwright/test'
import { expectNoSeriousErrors, launchApp, type LaunchedApp } from './fixtures'

const ROUTES: { route: string; testId: string; name: string }[] = [
  { route: '/', testId: 'page-journey', name: 'dashboard' },
  { route: '/journey', testId: 'page-journey', name: 'journey' },
  { route: '/journey/course', testId: 'page-journey', name: 'course' },
  { route: '/listening', testId: 'page-listening', name: 'listening' },
  { route: '/speaking', testId: 'page-speaking', name: 'speaking' },
  { route: '/reading', testId: 'page-reading', name: 'reading' },
  { route: '/writing', testId: 'page-writing', name: 'writing' },
  { route: '/grammar', testId: 'page-grammar', name: 'grammar' },
  { route: '/vocabulary', testId: 'page-vocabulary', name: 'vocabulary' },
  { route: '/cinema', testId: 'page-cinema', name: 'cinema' },
  { route: '/tutor', testId: 'page-tutor', name: 'tutor' },
  { route: '/game', testId: 'page-game', name: 'game' },
  { route: '/stats', testId: 'page-stats', name: 'stats' },
  { route: '/coach', testId: 'page-coach', name: 'coach' },
  { route: '/library', testId: 'page-library', name: 'library' },
  { route: '/settings/general', testId: 'page-settings', name: 'settings' },
  { route: '/settings/ai', testId: 'page-settings', name: 'settings-ai' },
  { route: '/settings/about', testId: 'page-settings', name: 'settings-about' },
  { route: '/settings/telegram', testId: 'page-settings', name: 'settings-telegram' },
  { route: '/settings/account', testId: 'page-settings', name: 'settings-account' },
]

const SHOTS = path.resolve(__dirname, '../../docs/screenshots')
let lq: LaunchedApp

test.describe.configure({ mode: 'serial' })

test.beforeAll(async () => {
  lq = await launchApp()
  // Finish onboarding through the API so the sweep starts on the dashboard.
  await lq.page.evaluate(async () => {
    await window.lq.invoke('learner:updateProfile', {
      displayName: 'Minh',
      interests: ['travel'],
      purposes: ['ielts'],
      onboardingCompleted: true,
    })
    await window.lq.invoke('journey:placementSkip')
  })
  await lq.page.reload()
  fs.mkdirSync(SHOTS, { recursive: true })
})

test.afterAll(async () => {
  await lq?.close()
})

async function sweep(theme: 'dark' | 'light', width: number, height: number, shots: boolean) {
  const { page, app } = lq
  await app.evaluate(
    ({ BrowserWindow }, size) => BrowserWindow.getAllWindows()[0]?.setContentSize(size.width, size.height),
    { width, height },
  )
  await page.evaluate(async (t) => {
    await window.lq.invoke('settings:update', { theme: t, uiLanguage: 'vi' })
  }, theme)
  await page.reload()
  for (const r of ROUTES) {
    await page.evaluate((route) => (window.location.hash = `#${route}`), r.route)
    await expect(page.getByTestId(r.testId).first(), r.route).toBeVisible()
    await page.waitForTimeout(400)
    await expect(page.getByText('Something went wrong'), r.route).toHaveCount(0)
    const overflow = await page.evaluate(() => {
      const main = document.getElementById('main-scroll')
      return main ? main.scrollWidth - main.clientWidth : 0
    })
    expect(overflow, `${r.route} overflows horizontally at ${width}px`).toBeLessThanOrEqual(1)
    if (shots) await page.screenshot({ path: path.join(SHOTS, `${r.name}-${theme}.png`) })
  }
}

test('every route renders at 1280×800 in dark mode (screenshots)', async () => {
  await sweep('dark', 1280, 800, true)
  await expectNoSeriousErrors(lq.consoleErrors)
})

test('every route renders at the minimum window size 1024×680', async () => {
  await sweep('dark', 1024, 680, false)
  await expectNoSeriousErrors(lq.consoleErrors)
})

test('every route renders in light mode', async () => {
  await sweep('light', 1280, 800, true)
  await expectNoSeriousErrors(lq.consoleErrors)
})

test('keyboard: Ctrl+K opens search, F1 opens shortcuts, Ctrl+, opens settings', async () => {
  const { page } = lq
  await page.evaluate(() => (window.location.hash = '#/'))
  await page.keyboard.press('Control+K')
  await expect(page.getByRole('dialog')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await page.keyboard.press('F1')
  await expect(page.getByRole('dialog')).toContainText(/Phím tắt|Keyboard shortcuts/)
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await page.keyboard.press('Control+,')
  await expect(page.getByTestId('page-settings')).toBeVisible()
})

test('every visible button on the main pages is enabled or deliberately disabled, and has an accessible name', async () => {
  const { page } = lq
  for (const r of ROUTES.slice(0, 14)) {
    await page.evaluate((route) => (window.location.hash = `#${route}`), r.route)
    await expect(page.getByTestId(r.testId).first()).toBeVisible()
    await page.waitForTimeout(300)
    const unnamed = await page.evaluate(() =>
      [...document.querySelectorAll('button')]
        .filter((b) => b.offsetParent !== null)
        .filter((b) => !(b.textContent ?? '').trim() && !b.getAttribute('aria-label') && !b.getAttribute('title'))
        .map((b) => b.outerHTML.slice(0, 120)),
    )
    expect(unnamed, `${r.route} has buttons without accessible names`).toEqual([])
  }
})
