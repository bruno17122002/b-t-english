// Launches the built Electron app with an isolated data folder and simulated AI (LQ_E2E=1),
// and collects console errors so any test fails on unexpected renderer errors.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { _electron as electron, expect, type ElectronApplication, type Page } from '@playwright/test'

export interface LaunchedApp {
  app: ElectronApplication
  page: Page
  userData: string
  consoleErrors: string[]
  close(): Promise<void>
}

const ROOT = path.resolve(__dirname, '../..')

export async function launchApp(userData?: string): Promise<LaunchedApp> {
  const dir = userData ?? fs.mkdtempSync(path.join(os.tmpdir(), 'lq-e2e-'))
  const env: Record<string, string> = { ...(process.env as Record<string, string>), LQ_E2E: '1', LQ_USER_DATA: dir }
  delete env.ELECTRON_RENDERER_URL
  delete env.ELECTRON_RUN_AS_NODE
  const flags = ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream']
  // LQ_E2E_EXE=<path to Lingua Quest.exe> runs the same tests against the packaged application.
  const exe = process.env.LQ_E2E_EXE
  const app = await electron.launch(
    exe ? { executablePath: exe, args: flags, env } : { args: [ROOT, ...flags], cwd: ROOT, env },
  )
  const page = await app.firstWindow()
  const consoleErrors: string[] = []
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text())
  })
  page.on('pageerror', (err) => consoleErrors.push(`pageerror: ${err.message}`))
  await page.waitForLoadState('domcontentloaded')
  return {
    app,
    page,
    userData: dir,
    consoleErrors,
    async close() {
      await app.close()
    },
  }
}

/** Errors that are expected in tests (e.g. no speech voices in CI) are filtered here. */
export function seriousErrors(errors: string[]): string[] {
  return errors.filter((e) => !/Autofill|DevTools|speechSynthesis|net::ERR_FILE_NOT_FOUND.*favicon/i.test(e))
}

export async function expectNoSeriousErrors(errors: string[]) {
  expect(seriousErrors(errors), seriousErrors(errors).join('\n')).toEqual([])
}

/** Closes any reward celebration (level-up / achievement / quest) that may cover the page. */
export async function dismissRewards(page: Page) {
  for (let i = 0; i < 8; i++) {
    const btn = page.getByTestId('reward-continue')
    if (!(await btn.isVisible().catch(() => false))) return
    // A card that is already animating out is still "visible" but detaches mid-click: do not wait for it.
    await btn.click({ timeout: 2000 }).catch(() => undefined)
    // Each card ignores clicks during its first 400 ms (double-click protection).
    await page.waitForTimeout(450)
  }
}
