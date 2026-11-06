// Shared helpers for the abuse and monkey specs: a seeded PRNG, main-process stubs for actions that
// would leave the app (file dialogs, external links, folders, relaunch/quit) and a health check that
// every step must pass (no error boundary, no blank page, no horizontal overflow, IPC still answers).
import { expect, type ElectronApplication, type Page } from '@playwright/test'
import { seriousErrors, type LaunchedApp } from './fixtures'

/** mulberry32: tiny deterministic PRNG so a failing walk can be replayed from its seed. */
export function rng(seed: number) {
  let a = seed >>> 0
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  return {
    next,
    int: (n: number) => Math.floor(next() * n),
    pick: <T>(arr: readonly T[]): T => arr[Math.floor(next() * arr.length)] as T,
    chance: (p: number) => next() < p,
  }
}
export type Rng = ReturnType<typeof rng>

/**
 * Replaces Electron APIs that open native windows or leave the app, so random clicking cannot
 * block the test on a file dialog, open a browser, or restart/quit the process.
 */
export async function stubLeavingActions(app: ElectronApplication) {
  await app.evaluate(({ app: electronApp, dialog, shell }) => {
    const g = globalThis as unknown as { __lqStubbed?: { external: string[]; dialogs: number; relaunch: number } }
    g.__lqStubbed = { external: [], dialogs: 0, relaunch: 0 }
    const s = g.__lqStubbed
    const d = dialog as unknown as Record<string, unknown>
    d.showSaveDialog = async () => (s.dialogs++, { canceled: true, filePath: '' })
    d.showOpenDialog = async () => (s.dialogs++, { canceled: true, filePaths: [] })
    d.showMessageBox = async () => (s.dialogs++, { response: 0, checkboxChecked: false })
    const sh = shell as unknown as Record<string, unknown>
    sh.openExternal = async (url: string) => void s.external.push(url)
    sh.openPath = async () => ''
    sh.showItemInFolder = () => undefined
    // Only relaunch is stubbed: Playwright needs quit/exit to close the app at the end of a test.
    ;(electronApp as unknown as Record<string, unknown>).relaunch = () => void s.relaunch++
  })
}

/** Finishes onboarding through the API so tests start on the dashboard. */
export async function completeOnboarding(page: Page, name = 'Minh') {
  await page.evaluate(async (displayName) => {
    await window.lq.invoke('learner:updateProfile', {
      displayName,
      interests: ['travel'],
      purposes: ['ielts'],
      onboardingCompleted: true,
    })
    await window.lq.invoke('journey:placementSkip')
  }, name)
  await page.reload()
  await page.waitForSelector('#main-scroll')
}

export const goto = (page: Page, route: string) => page.evaluate((r) => (window.location.hash = `#${r}`), route)

/** Round-trips an IPC call; returns elapsed ms, or Infinity if the renderer or main did not answer in time. */
export async function ipcPing(page: Page, timeoutMs = 2000): Promise<number> {
  const started = Date.now()
  const ok = await Promise.race([
    page
      .evaluate(async () => (await window.lq.invoke('settings:get')).ok)
      .then((r) => r)
      .catch(() => false),
    new Promise<false>((r) => setTimeout(() => r(false), timeoutMs)),
  ])
  return ok ? Date.now() - started : Infinity
}

export interface Health {
  boundary: boolean
  blank: boolean
  overflow: number
  docOverflow: number
  route: string
}

export async function readHealth(page: Page): Promise<Health> {
  return page.evaluate(() => {
    const main = document.getElementById('main-scroll')
    const root = document.getElementById('root')
    const text = (main ?? root)?.innerText.trim() ?? ''
    return {
      boundary: /Something went wrong/.test(document.body.innerText),
      blank: !main || text.length === 0,
      overflow: main ? main.scrollWidth - main.clientWidth : 0,
      docOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      route: window.location.hash,
    }
  })
}

/** Throws a descriptive error when the app is in a broken state. `seen` is the console-error watermark. */
export async function assertHealthy(lq: LaunchedApp, seen: number, opts: { ping?: boolean } = {}) {
  const { page } = lq
  const errors = seriousErrors(lq.consoleErrors.slice(seen))
  if (errors.length) throw new Error(`console error: ${errors.join(' | ').slice(0, 600)}`)
  let h = await readHealth(page)
  // Page transitions and slide-in animations can overflow for a frame; only a lasting state counts.
  if (h.blank || h.overflow > 1 || h.docOverflow > 1) {
    await page.waitForTimeout(900)
    h = await readHealth(page)
  }
  if (h.boundary) throw new Error(`error boundary shown on ${h.route}`)
  if (h.blank) throw new Error(`blank page on ${h.route}`)
  if (h.overflow > 1 || h.docOverflow > 1)
    throw new Error(`horizontal overflow ${Math.max(h.overflow, h.docOverflow)}px on ${h.route}`)
  if (opts.ping !== false) {
    const ms = await ipcPing(page)
    if (!Number.isFinite(ms)) throw new Error(`IPC ping did not answer within 2 s on ${h.route}`)
  }
}

export async function expectHealthy(lq: LaunchedApp, seen = 0) {
  await expect(assertHealthy(lq, seen)).resolves.toBeUndefined()
}

export async function setWindowSize(app: ElectronApplication, width: number, height: number) {
  await app.evaluate(
    ({ BrowserWindow }, size) => BrowserWindow.getAllWindows()[0]?.setContentSize(size.width, size.height),
    { width, height },
  )
}

/** Strings a careless or mischievous learner might type. */
export const NASTY_TEXT = [
  'hello',
  'Xin chào, tôi tên là Nguyễn Văn Minh – học tiếng Anh!',
  'Tiếng Việt có dấu: ắ ằ ẳ ẵ ặ ề ể ễ ệ ố ồ ổ ỗ ộ ứ ừ ử ữ ự đ',
  '😀🎉🔥👨‍👩‍👧‍👦🇻🇳 emoji 🙃',
  '<script>alert(1)</script><img src=x onerror=alert(2)>',
  '"; DROP TABLE vocab; --',
  '12345678901234567890',
  '-1',
  '0',
  '1e309',
  'NaN',
  '   ',
  '​​​zero​width​',
  'مرحبا بالعالم שלום עולם',
  '‮RTL override text',
  'a'.repeat(5000),
  'word '.repeat(1200),
  'Supercalifragilisticexpialidocious'.repeat(20),
  '%s %d {{x}} ${x} \\n \\u0000',
  'null',
  'undefined',
] as const

/**
 * Wraps the main-process IPC entry point so tests can count calls per channel and inject latency or
 * failures (e.g. "offline") without touching application code. Uses Electron's internal handler map.
 */
export async function instrumentIpc(app: ElectronApplication) {
  await app.evaluate(({ ipcMain }) => {
    type Handler = (e: unknown, channel: string, payload: unknown) => Promise<unknown>
    const g = globalThis as unknown as {
      __lqIpc?: { calls: string[]; delay: Record<string, number>; fail: Record<string, unknown> }
    }
    if (g.__lqIpc) return
    const map = (ipcMain as unknown as { _invokeHandlers: Map<string, Handler> })._invokeHandlers
    const orig = map.get('lq:invoke')
    if (!orig) throw new Error('lq:invoke handler not found')
    const state = { calls: [] as string[], delay: {} as Record<string, number>, fail: {} as Record<string, unknown> }
    g.__lqIpc = state
    ipcMain.removeHandler('lq:invoke')
    ipcMain.handle('lq:invoke', async (e, channel: string, payload: unknown) => {
      state.calls.push(channel)
      const ms = state.delay[channel] ?? 0
      if (ms) await new Promise((r) => setTimeout(r, ms))
      const fail = state.fail[channel]
      if (fail) return { ok: false, error: fail }
      return orig(e, channel, payload)
    })
  })
}

export async function ipcCalls(app: ElectronApplication, channel: string): Promise<number> {
  return app.evaluate(
    (_e, ch) =>
      (globalThis as unknown as { __lqIpc: { calls: string[] } }).__lqIpc.calls.filter((c) => c === ch).length,
    channel,
  )
}

export async function setIpcDelay(app: ElectronApplication, channel: string, ms: number) {
  await app.evaluate(
    (_e, a) => {
      ;(globalThis as unknown as { __lqIpc: { delay: Record<string, number> } }).__lqIpc.delay[a.channel] = a.ms
    },
    { channel, ms },
  )
}

/** Makes a channel fail like the main process does when the network is down (null clears it). */
export async function setIpcFailure(
  app: ElectronApplication,
  channel: string,
  error: { code: string; message: string; hint?: string } | null,
) {
  await app.evaluate(
    (_e, a) => {
      const f = (globalThis as unknown as { __lqIpc: { fail: Record<string, unknown> } }).__lqIpc.fail
      if (a.error) f[a.channel] = a.error
      else delete f[a.channel]
    },
    { channel, error },
  )
}

export const OFFLINE_ERROR = {
  code: 'ai_network',
  message: 'Không kết nối được tới máy chủ AI. Kiểm tra Internet.',
}
