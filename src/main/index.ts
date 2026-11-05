// Electron entry: creates the kernel, registers module IPC, opens a hardened window and runs reminders.
import path from 'node:path'
import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  Notification,
  net,
  safeStorage,
  session,
  shell,
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

const isDev = !app.isPackaged && !!process.env.ELECTRON_RENDERER_URL
const isE2E = process.env.LQ_E2E === '1'

if (process.env.LQ_USER_DATA) app.setPath('userData', process.env.LQ_USER_DATA)
app.setAppUserModelId('com.linguaquest.app')

if (!isE2E && !app.requestSingleInstanceLock()) {
  app.quit()
}

let mainWindow: BrowserWindow | null = null
let kernel: Kernel | null = null
let logger: Logger | null = null
const allowedChannels = new Set<string>(CHANNELS)

function wasmDir(): string {
  return app.isPackaged
    ? path.join(process.resourcesPath, 'sql-wasm')
    : path.join(app.getAppPath(), 'node_modules', 'sql.js', 'dist')
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
    backgroundColor: '#0b0d14',
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
  mainWindow.once('ready-to-show', () => mainWindow?.show())
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
    online: () => net.isOnline(),
  }
}

function startReminders(k: Kernel) {
  const check = () => {
    try {
      const s = k.settings.get()
      if (!s.notificationsEnabled) return
      const now = new Date()
      const hhmm = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`
      const today = localDateKey(now)
      if (hhmm < s.reminderTime || k.settings.getFlag('lastReminder') === today) return
      k.settings.setFlag('lastReminder', today)
      if (k.progress.minutesToday() >= 1) return
      const due = k.vocab.dueCount()
      const streak = k.progress.gameState().streak.current
      const vi = s.uiLanguage === 'vi'
      const body = due
        ? vi
          ? `Có ${due} thẻ từ đang chờ ôn. Chỉ 5 phút để giữ chuỗi ${streak} ngày!`
          : `${due} flashcards are waiting. Five minutes keeps your ${streak}-day streak alive!`
        : vi
          ? 'Hôm nay bạn chưa học. Một bài nghe ngắn nhé?'
          : 'You have not studied today yet. How about a short listening session?'
      if (Notification.isSupported()) {
        const n = new Notification({ title: 'Lingua Quest', body })
        n.on('click', () => {
          mainWindow?.show()
          push(mainWindow?.webContents, 'navigate', due ? '/vocabulary/review' : '/')
        })
        n.show()
      }
    } catch (err) {
      logger?.error(`reminder failed: ${String(err)}`)
    }
  }
  setInterval(check, 60_000)
  setTimeout(check, 15_000)
}

async function bootstrap() {
  const userData = app.getPath('userData')
  logger = new Logger(path.join(userData, 'logs'))
  logger.info(`starting Lingua Quest ${app.getVersion()} (electron ${process.versions.electron}, e2e=${isE2E})`)
  process.on('uncaughtException', (err) => logger?.error(`uncaught: ${err.stack ?? err.message}`))
  process.on('unhandledRejection', (err) => logger?.error(`unhandled rejection: ${String(err)}`))

  const moduleMigrations = Object.fromEntries(MODULES_MAIN.filter((m) => m.migrations?.length).map((m) => [m.id, m.migrations ?? []]))
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
  })
  const k = kernel
  k.push = (event, payload) => push(mainWindow?.webContents, event, payload)
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
  if (!isE2E) startReminders(k)
}

app.on('second-instance', () => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.focus()
  }
})

app.on('web-contents-created', (_e, contents) => {
  contents.on('will-attach-webview', (e) => e.preventDefault())
})

app.whenReady().then(bootstrap).catch((err: unknown) => {
  logger?.error(`fatal startup error: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}`)
  dialog.showErrorBox(
    'Lingua Quest',
    `Không thể khởi động ứng dụng.\n\n${err instanceof Error ? err.message : String(err)}\n\nNhật ký: ${app.getPath('userData')}\\logs`,
  )
  app.exit(1)
})

app.on('window-all-closed', () => {
  kernel?.db.close()
  app.quit()
})

app.on('before-quit', () => {
  try {
    kernel?.db.flush()
  } catch (err) {
    logger?.error(`flush on quit failed: ${String(err)}`)
  }
})
