// Test helpers: an in-memory kernel with a fake cipher and a fake host bridge.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createKernel, type Kernel } from '../../src/main/kernel'
import type { Cipher } from '../../src/main/kernel/secure/keyStore'
import { NullTelegram } from '../../src/main/kernel/telegram/port'
import { IpcRouter } from '../../src/main/ipc/router'
import { registerKernelHandlers, type HostBridge } from '../../src/main/ipc/kernelHandlers'
import { MODULES_MAIN } from '../../src/modules/registry.main'

/** Reversible stand-in for DPAPI so tests can assert that keys are never stored in plain text. */
export const fakeCipher: Cipher = {
  isEncryptionAvailable: () => true,
  encryptString: (s) => Buffer.from(s.split('').reverse().join(''), 'utf8').map((b) => b ^ 0x5a) as Buffer,
  decryptString: (b) =>
    Buffer.from(b.map((x) => x ^ 0x5a))
      .toString('utf8')
      .split('')
      .reverse()
      .join(''),
}

export function tempDir(prefix = 'lq-test-'): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix))
}

export interface TestKernelOptions {
  mockAi?: boolean
  now?: () => Date
  fetchImpl?: typeof fetch
  persistent?: boolean
  dir?: string
  /**
   * 'null' (default): module tests get a NullTelegram that records what they send and register.
   * 'real': keep the TelegramService built by createKernel (Telegram bot tests with a fake Bot API).
   */
  telegram?: 'null' | 'real'
}

export async function makeKernel(opts: TestKernelOptions = {}): Promise<{ kernel: Kernel; dir: string }> {
  const dir = opts.dir ?? tempDir()
  const moduleMigrations = Object.fromEntries(
    MODULES_MAIN.filter((m) => m.migrations?.length).map((m) => [m.id, m.migrations ?? []]),
  )
  const kernel = await createKernel({
    paths: {
      userData: dir,
      dbFile: opts.persistent ? path.join(dir, 'data', 'lq.sqlite') : null,
      backups: path.join(dir, 'backups'),
      keysFile: path.join(dir, 'secure', 'keys.bin'),
      logs: path.join(dir, 'logs'),
    },
    cipher: fakeCipher,
    mockAi: opts.mockAi ?? true,
    now: opts.now,
    fetchImpl: opts.fetchImpl,
    moduleMigrations,
  })
  if ((opts.telegram ?? 'null') === 'null') kernel.telegram = new NullTelegram()
  return { kernel, dir }
}

export function fakeHost(
  overrides: Partial<HostBridge> = {},
): HostBridge & { notifications: string[]; opened: string[] } {
  const notifications: string[] = []
  const opened: string[] = []
  return {
    version: '1.0.0-test',
    versions: { electron: 'test', chrome: 'test', node: process.versions.node },
    saveFile: async () => null,
    openFile: async () => null,
    openExternal: async (url) => {
      opened.push(url)
    },
    openPath: async (p) => {
      opened.push(p)
    },
    notify: (title, body) => notifications.push(`${title}: ${body}`),
    relaunch: () => undefined,
    online: () => true,
    notifications,
    opened,
    ...overrides,
  }
}

/** Full router with kernel + all module handlers, as wired in production. */
export async function makeApp(opts: TestKernelOptions & { host?: Partial<HostBridge> } = {}) {
  const { kernel, dir } = await makeKernel(opts)
  const host = fakeHost(opts.host)
  const router = new IpcRouter()
  registerKernelHandlers(router, kernel, host)
  for (const m of MODULES_MAIN) m.register(router, kernel)
  const call = async <T = unknown>(channel: string, payload?: unknown): Promise<T> => {
    const res = await router.dispatch(channel, payload)
    if (!res.ok)
      throw Object.assign(new Error(`${channel}: ${res.error.code} ${res.error.message}`), { ipc: res.error })
    return res.data as T
  }
  return { kernel, dir, host, router, call }
}
