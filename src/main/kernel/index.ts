// Platform Kernel: shared services every feature module builds on. Free of Electron imports so the
// whole kernel (and every module service) runs under Vitest with an in-memory database.
import type { PushEvent } from '@shared/ipc'
import { AppDatabase } from '../db/database'
import { runMigrations, runModuleMigrations, type Migration } from '../db/migrations'
import { AiGateway } from './ai/gateway'
import { ContentRegistry } from './content/registry'
import { DataService } from './data/dataService'
import { LearnerService } from './learner/learner'
import { ProgressService } from './progress/progress'
import { SearchService } from './search/search'
import { KeyStore, type Cipher } from './secure/keyStore'
import type { TelegramPort } from './telegram/port'
import { TelegramService } from './telegram/service'
import { SettingsService } from './settings/settings'
import { VocabHub } from './vocab/vocabHub'

export interface KernelPaths {
  userData: string
  dbFile: string | null
  backups: string
  keysFile: string
  logs: string
  wasmDir?: string
}

export interface KernelLog {
  info(msg: string): void
  warn(msg: string): void
  error(msg: string): void
}

export interface Kernel {
  db: AppDatabase
  content: ContentRegistry
  learner: LearnerService
  progress: ProgressService
  vocab: VocabHub
  ai: AiGateway
  settings: SettingsService
  search: SearchService
  data: DataService
  keys: KeyStore
  log: KernelLog
  paths: KernelPaths
  now: () => Date
  /** Pushes an event to the renderer (no-op in tests unless replaced). */
  push: (event: PushEvent, payload: unknown) => void
  /** Shows a Windows notification; clicking it opens `route` (no-op in tests unless replaced). */
  notify: (title: string, body: string, route?: string) => void
  /** Telegram bot port: send messages, register commands and button callbacks (TelegramService). */
  telegram: TelegramPort
}

export interface CreateKernelOptions {
  paths: KernelPaths
  cipher: Cipher
  mockAi?: boolean
  log?: KernelLog
  now?: () => Date
  fetchImpl?: typeof fetch
  content?: ContentRegistry
  /** Feature-module migrations, keyed by module id. */
  moduleMigrations?: Record<string, Migration[]>
}

const silentLog: KernelLog = { info: () => undefined, warn: () => undefined, error: () => undefined }

export async function createKernel(opts: CreateKernelOptions): Promise<Kernel> {
  const log = opts.log ?? silentLog
  const now = opts.now ?? (() => new Date())
  const db = await AppDatabase.open({
    filePath: opts.paths.dbFile,
    wasmDir: opts.paths.wasmDir,
    onError: (err) => log.error(`database save failed: ${String(err)}`),
  })
  const mig = runMigrations(db)
  if (mig.from !== mig.to) log.info(`database migrated v${mig.from} → v${mig.to}`)
  for (const [moduleId, migrations] of Object.entries(opts.moduleMigrations ?? {})) {
    const n = runModuleMigrations(db, moduleId, migrations)
    if (n) log.info(`module ${moduleId}: applied ${n} migration(s)`)
  }

  const content = opts.content ?? new ContentRegistry()
  const learner = new LearnerService(db, now)
  const keys = new KeyStore(opts.paths.keysFile, opts.cipher)
  const ai = new AiGateway({
    db,
    keys,
    mock: opts.mockAi ?? false,
    learner: () => learner.summary(),
    log: (level, msg) => log[level](msg),
    fetchImpl: opts.fetchImpl,
  })
  // VocabHub and ProgressService reference each other (saving a word records progress; daily quests
  // look at due cards), so they are wired through lazy getters.
  let progress: ProgressService | null = null
  const vocab = new VocabHub(db, content, () => progress as ProgressService, learner, ai, now)
  progress = new ProgressService(db, learner, () => vocab.dueCount(), now)
  const settings = new SettingsService(db, now)
  const search = new SearchService(db, content)
  const data = new DataService(db, opts.paths.backups, vocab, opts.paths.wasmDir, now)
  if (content.issues.length) log.warn(`content issues: ${JSON.stringify(content.issues.slice(0, 5))}`)

  const kernel: Kernel = {
    db,
    content,
    learner,
    progress,
    vocab,
    ai,
    settings,
    search,
    data,
    keys,
    log,
    paths: opts.paths,
    now,
    push: () => undefined,
    notify: () => undefined,
    telegram: null as unknown as TelegramPort,
  }
  // The bot needs the finished kernel; it makes no network request until start() or a settings action.
  kernel.telegram = new TelegramService(kernel, { fetchImpl: opts.fetchImpl })
  return kernel
}
