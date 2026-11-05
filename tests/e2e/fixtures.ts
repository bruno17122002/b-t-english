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
  const app = await electron.launch({
    args: [path.join(ROOT, 'out/main/index.js'), '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'],
    cwd: ROOT,
    env,
  })
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
