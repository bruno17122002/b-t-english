// Electron entry: creates the kernel, registers module IPC, opens a hardened window and runs reminders.
import fs from 'node:fs'
import path from 'node:path'
import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  nativeImage,
  Notification,
  net,
  safeStorage,
  session,
  shell,
  Tray,
  type WebContents,
} from 'electron'
import { CHANNELS } from '@modules/contract'
import { MODULES_MAIN } from '@modules/registry.main'
import { localDateKey } from '@core/dates'
import { createKernel, type Kernel } from './kernel'
import { KeyStore } from './kernel/secure/keyStore'
import { Logger } from './kernel/logger'
import { IpcRouter } from './ipc/router'
import { registerKernelHandlers, type HostBridge } from './ipc/kernelHandlers'
import { importLegacyTelegramConfig } from './kernel/telegram/legacy'
import { startCloudServices } from './kernel/cloud/background'

const isDev = !app.isPackaged && !!process.env.ELECTRON_RENDERER_URL
const isE2E = process.env.LQ_E2E === '1'

if (process.env.LQ_USER_DATA) app.setPath('userData', process.env.LQ_USER_DATA)
app.setAppUserModelId('com.linguaquest.app')

if (!isE2E && !app.requestSingleInstanceLock()) {
  app.quit()
}

let mainWindow: BrowserWindow | null = null
let tray: Tray | null = null
let quitting = false
const stopBackground: (() => void)[] = []
/** Started by Windows at sign-in: stay in the tray until the learner opens the window. */
const startHidden = process.argv.includes('--hidden')
let kernel: Kernel | null = null
let logger: Logger | null = null
const allowedChannels = new Set<string>(CHANNELS)

function wasmDir(): string {
  if (app.isPackaged) return path.join(process.resourcesPath, 'sql-wasm')
  const fromAppPath = path.join(app.getAppPath(), 'node_modules', 'sql.js', 'dist')
  // Fall back to Node resolution when the app was started from another folder (e.g. `electron out/main`).
  return fs.existsSync(path.join(fromAppPath, 'sql-wasm.wasm')) ? fromAppPath : path.dirname(require.resolve('sql.js'))
}

function isAppUrl(url: string): boolean {
  if (url.startsWith('file://')) return true
  const dev = process.env.ELECTRON_RENDERER_URL
  return !!dev && url.startsWith(dev)
}

function push(contents: WebContents | undefined, event: string, payload: unknown) {
  if (contents && !contents.isDestroyed()) contents.send('lq:push', event, payload)
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1360,
    height: 860,
    minWidth: 1024,
    minHeight: 680,
    show: false,
    backgroundColor: '#202020',
    title: 'Lingua Quest',
    autoHideMenuBar: true,
    icon: path.join(app.getAppPath(), 'build', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webSecurity: true,
      spellcheck: true,
      devTools: !app.isPackaged || process.env.LQ_DEVTOOLS === '1',
    },
  })
  mainWindow.once('ready-to-show', () => {
    if (!startHidden || isE2E) mainWindow?.show()
  })
  // Closing the window keeps the app (Telegram bot, reminders, reports) running in the tray when enabled.
  mainWindow.on('close', (e) => {
    if (quitting || isE2E || !kernel?.settings.get().runInBackground) return
    e.preventDefault()
    mainWindow?.hide()
  })
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) void shell.openExternal(url)
    return { action: 'deny' }
  })
  mainWindow.webContents.on('will-navigate', (e, url) => {
    if (!isAppUrl(url)) e.preventDefault()
  })
  if (isDev && process.env.ELECTRON_RENDERER_URL) void mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  else void mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'))
}

function hardenSession() {
  const ses = session.defaultSession
  // Only the app itself may use the microphone (speaking practice); everything else is denied.
  ses.setPermissionRequestHandler((_wc, permission, cb, details) => {
    const mediaTypes = 'mediaTypes' in details ? (details.mediaTypes ?? []) : []
    cb(permission === 'media' && isAppUrl(details.requestingUrl) && mediaTypes.every((m) => m === 'audio'))
  })
  ses.setPermissionCheckHandler((_wc, permission, origin) => permission === 'media' && isAppUrl(origin))
  const csp = [
    "default-src 'self'",
    `script-src 'self'${isDev ? " 'unsafe-inline'" : ''}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "media-src 'self' blob: data:",
    "font-src 'self' data:",
    `connect-src 'self'${isDev ? ' ws: http://localhost:*' : ''}`,
    "object-src 'none'",
    "base-uri 'none'",
    "frame-src 'none'",
  ].join('; ')
  ses.webRequest.onHeadersReceived((details, cb) => {
    cb({ responseHeaders: { ...details.responseHeaders, 'Content-Security-Policy': [csp] } })
  })
}

function hostBridge(): HostBridge {
  return {
    version: app.getVersion(),
    versions: { electron: process.versions.electron, chrome: process.versions.chrome, node: process.versions.node },
    async saveFile(opts) {
      const res = await dialog.showSaveDialog(mainWindow as BrowserWindow, {
        title: opts.title,
        defaultPath: path.join(app.getPath('documents'), opts.defaultName),
        filters: opts.filters,
      })
      return res.canceled || !res.filePath ? null : res.filePath
    },
    async openFile(opts) {
      const res = await dialog.showOpenDialog(mainWindow as BrowserWindow, {
        title: opts.title,
        filters: opts.filters,
        properties: ['openFile'],
      })
      return res.canceled ? null : (res.filePaths[0] ?? null)
    },
    openExternal: (url) => shell.openExternal(url),
    async openPath(dir) {
      await shell.openPath(dir)
    },
    notify(title, body) {
      if (Notification.isSupported()) new Notification({ title, body, silent: false }).show()
    },
    relaunch() {
      kernel?.db.close()
      app.relaunch()
      app.exit(0)
    },
    applySystemSettings: (s) => applyLoginItem(s.launchAtLogin),
    online: () => net.isOnline(),
  }
}

function showWindow(route?: string) {
  if (!mainWindow) createWindow()
  mainWindow?.show()
  if (mainWindow?.isMinimized()) mainWindow.restore()
  mainWindow?.focus()
  if (route) push(mainWindow?.webContents, 'navigate', route)
}

function applyLoginItem(enabled: boolean) {
  if (isE2E || !app.isPackaged) return // never register a dev build with Windows
  app.setLoginItemSettings({ openAtLogin: enabled, args: ['--hidden'] })
}

function createTray() {
  const icon = nativeImage
    .createFromPath(path.join(app.getAppPath(), 'build', 'icon.png'))
    .resize({ width: 16, height: 16 })
  tray = new Tray(icon)
  tray.setToolTip('Lingua Quest')
  const vi = kernel?.settings.get().uiLanguage !== 'en'
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: vi ? 'Mở Lingua Quest' : 'Open Lingua Quest', click: () => showWindow() },
      { label: vi ? 'Ôn thẻ từ' : 'Review flashcards', click: () => showWindow('/vocabulary/review') },
      { label: vi ? 'Huấn luyện AI' : 'AI Coach', click: () => showWindow('/coach') },
      { type: 'separator' },
      {
        label: vi ? 'Thoát hẳn' : 'Quit',
        click: () => {
          quitting = true
          app.quit()
        },
      },
    ]),
  )
  tray.on('click', () => showWindow())
}

async function bootstrap() {
  const userData = app.getPath('userData')
  logger = new Logger(path.join(userData, 'logs'))
  logger.info(`starting Lingua Quest ${app.getVersion()} (electron ${process.versions.electron}, e2e=${isE2E})`)
  process.on('uncaughtException', (err) => logger?.error(`uncaught: ${err.stack ?? err.message}`))
  process.on('unhandledRejection', (err) => logger?.error(`unhandled rejection: ${String(err)}`))

  const moduleMigrations = Object.fromEntries(
    MODULES_MAIN.filter((m) => m.migrations?.length).map((m) => [m.id, m.migrations ?? []]),
  )
  kernel = await createKernel({
    paths: {
      userData,
      dbFile: path.join(userData, 'data', 'lingua-quest.sqlite'),
      backups: path.join(userData, 'backups'),
      keysFile: KeyStore.defaultPath(userData),
      logs: path.join(userData, 'logs'),
      wasmDir: wasmDir(),
    },
    cipher: safeStorage,
    mockAi: isE2E,
    log: logger,
    moduleMigrations,
    cloudDefaults: { url: process.env.LQ_CLOUD_URL, anonKey: process.env.LQ_CLOUD_ANON_KEY },
  })
  const k = kernel
  k.push = (event, payload) => push(mainWindow?.webContents, event, payload)
  k.notify = (title, body, route) => {
    if (!Notification.isSupported()) return
    const n = new Notification({ title, body })
    n.on('click', () => showWindow(route))
    n.show()
  }
  // Secrets of the old stand-alone Python bot are moved into the encrypted store once, then the file is deleted.
  const legacy = importLegacyTelegramConfig(k)
  if (legacy.length) logger.info(`imported from the old Telegram bot: ${legacy.join(', ')}`)
  k.progress.onReward((reward) => k.push('reward', reward))

  const router = new IpcRouter(logger)
  registerKernelHandlers(router, k, hostBridge())
  for (const m of MODULES_MAIN) m.register(router, k)
  const missing = router.missing()
  if (missing.length) logger.warn(`IPC channels without handler: ${missing.join(', ')}`)

  ipcMain.handle('lq:invoke', async (event, channel: unknown, payload: unknown) => {
    const url = event.senderFrame?.url ?? ''
    if (!isAppUrl(url)) return { ok: false, error: { code: 'forbidden', message: 'Untrusted sender' } }
    if (typeof channel !== 'string' || !allowedChannels.has(channel)) {
      return { ok: false, error: { code: 'unknown_channel', message: 'Unknown channel' } }
    }
    return router.dispatch(channel, payload)
  })

  // Daily automatic backup (keeps the last 10).
  try {
    const today = localDateKey()
    if (k.settings.getFlag('lastAutoBackup') !== today && k.vocab.stats().total + k.progress.totalXp() > 0) {
      k.data.createBackup('auto')
      k.settings.setFlag('lastAutoBackup', today)
    }
  } catch (err) {
    logger.warn(`auto backup failed: ${String(err)}`)
  }

  hardenSession()
  Menu.setApplicationMenu(null)
  createWindow()
  if (!isE2E) {
    createTray()
    applyLoginItem(k.settings.get().launchAtLogin)
    // Background services (Telegram polling, coach scheduler) run only in the real app, never in tests.
    const tg = k.telegram as { start?: () => () => void }
    if (tg.start) stopBackground.push(tg.start())
    for (const m of MODULES_MAIN) {
      const stop = m.start?.(k)
      if (stop) stopBackground.push(stop)
    }
    // Online account: sync on start, every 5 minutes and the daily cloud backup (no-op when signed out).
    stopBackground.push(startCloudServices(k))
  }
}

/** Uploads pending sync changes (bounded wait) before the database closes on quit. */
let syncFlushed = false
function flushSyncThen(done: () => void): boolean {
  if (syncFlushed || !kernel || isE2E) return false
  syncFlushed = true
  void kernel.sync.flushBeforeQuit(4000).finally(done)
  return true
}

app.on('second-instance', () => showWindow())

app.on('web-contents-created', (_e, contents) => {
  contents.on('will-attach-webview', (e) => e.preventDefault())
})

app
  .whenReady()
  .then(bootstrap)
  .catch((err: unknown) => {
    logger?.error(`fatal startup error: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}`)
    dialog.showErrorBox(
      'Lingua Quest',
      `Không thể khởi động ứng dụng.\n\n${err instanceof Error ? err.message : String(err)}\n\nNhật ký: ${app.getPath('userData')}\\logs`,
    )
    app.exit(1)
  })

app.on('window-all-closed', () => {
  // With "run in background" the window is only hidden, so this fires only on a real quit.
  const close = () => {
    kernel?.db.close()
    app.quit()
  }
  if (!flushSyncThen(close)) close()
})

app.on('before-quit', (event) => {
  if (flushSyncThen(() => app.quit())) {
    event.preventDefault()
    return
  }
  quitting = true
  for (const stop of stopBackground.splice(0)) {
    try {
      stop()
    } catch {
      /* shutting down */
    }
  }
  try {
    kernel?.db.flush()
  } catch (err) {
    logger?.error(`flush on quit failed: ${String(err)}`)
  }
})
