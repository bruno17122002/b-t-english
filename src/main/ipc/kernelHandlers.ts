// IPC handlers for kernel services. Electron-specific actions (dialogs, shell, notifications, relaunch)
// come in through the HostBridge so these handlers stay testable without Electron.
import fs from 'node:fs'
import path from 'node:path'
import type { AppSettings, DiagnosticsInfo } from '@shared/types'
import { USER_PROVIDERS } from '@shared/types'
import { currentSchemaVersion } from '../db/migrations'
import type { Kernel } from '../kernel'
import { TtsCache } from '../kernel/ai/ttsCache'
import { norm } from '../kernel/search/search'
import { UserError, type IpcRouter } from './router'
import { registerTelegramHandlers } from './telegramHandlers'

export interface HostBridge {
  version: string
  versions: { electron: string; chrome: string; node: string }
  saveFile(opts: {
    title: string
    defaultName: string
    filters: { name: string; extensions: string[] }[]
  }): Promise<string | null>
  openFile(opts: { title: string; filters: { name: string; extensions: string[] }[] }): Promise<string | null>
  openExternal(url: string): Promise<void>
  openPath(dir: string): Promise<void>
  notify(title: string, body: string): void
  /** Closes the database and restarts the app (used after restore). */
  relaunch(): void
  /** Applies OS-level settings (start with Windows) after the user changes them. */
  applySystemSettings?(settings: AppSettings): void
  online(): boolean | null
}

const ALLOWED_HOSTS = [
  'aistudio.google.com',
  'ai.google.dev',
  'platform.openai.com',
  'github.com',
  'dictionary.cambridge.org',
  'www.oxfordlearnersdictionaries.com',
  'youglish.com',
  't.me',
  'core.telegram.org',
]

export function registerKernelHandlers(r: IpcRouter, k: Kernel, host: HostBridge): void {
  // ---------- app ----------
  r.handle('app:bootstrap', () => {
    const profile = k.learner.profile()
    return {
      version: host.version,
      profile,
      settings: k.settings.get(),
      ai: k.ai.getConfig(),
      game: k.progress.gameState(),
      dueCards: k.vocab.dueCount(),
      contentIssues: k.content.issues.length,
      isFirstRun: !profile.onboardingCompletedAt,
    }
  })

  r.handle('app:diagnostics', () => {
    const tables = [
      'vocabulary',
      'review_logs',
      'activity_log',
      'xp_events',
      'writing_submissions',
      'speaking_sessions',
      'tutor_messages',
      'story_progress',
    ]
    const tableCounts: Record<string, number> = {}
    for (const t of tables) tableCounts[t] = Number(k.db.value(`SELECT COUNT(*) FROM ${t}`) ?? 0)
    const cfg = k.ai.getConfig()
    const info: DiagnosticsInfo = {
      appVersion: host.version,
      electron: host.versions.electron,
      chrome: host.versions.chrome,
      node: host.versions.node,
      platform: `${process.platform} ${process.arch}`,
      userDataPath: k.paths.userData,
      dbPath: k.paths.dbFile ?? '(memory)',
      dbSizeBytes: k.paths.dbFile && fs.existsSync(k.paths.dbFile) ? fs.statSync(k.paths.dbFile).size : 0,
      schemaVersion: currentSchemaVersion(k.db),
      tableCounts,
      encryptionAvailable: cfg.encryptionAvailable,
      aiProviders: Object.fromEntries(
        USER_PROVIDERS.map((p) => [p, { hasKey: cfg.providers[p].hasKey, model: cfg.providers[p].model }]),
      ) as DiagnosticsInfo['aiProviders'],
      logPath: path.join(k.paths.logs, 'lingua-quest.log'),
      online: host.online(),
    }
    return info
  })

  r.handle('app:logs', () => {
    try {
      return fs.readFileSync(path.join(k.paths.logs, 'lingua-quest.log'), 'utf8').split('\n').slice(-300).join('\n')
    } catch {
      return ''
    }
  })

  r.handle('app:openExternal', async ({ url }) => {
    const u = new URL(url)
    if (u.protocol !== 'https:' || !ALLOWED_HOSTS.includes(u.hostname)) {
      throw new UserError('blocked_url', 'Liên kết này không nằm trong danh sách cho phép.')
    }
    await host.openExternal(u.toString())
    return null
  })

  r.handle('app:openFolder', async ({ which }) => {
    const dir =
      which === 'backups'
        ? k.paths.backups
        : which === 'logs'
          ? k.paths.logs
          : path.dirname(k.paths.dbFile ?? k.paths.userData)
    fs.mkdirSync(dir, { recursive: true })
    await host.openPath(dir)
    return null
  })

  r.handle('app:testNotification', () => {
    host.notify('Lingua Quest', 'Thông báo đang hoạt động. Hẹn gặp bạn ở buổi học tiếp theo!')
    return null
  })

  // ---------- learner ----------
  r.handle('learner:profile', () => k.learner.profile())
  r.handle('learner:updateProfile', (patch) => k.learner.updateProfile(patch))
  r.handle('learner:skills', () => k.learner.skillLevels())
  r.handle('learner:setSkill', (s) => {
    k.learner.setSkillLevel({ ...s, source: 'self', estimated: true })
    return k.learner.skillLevels()
  })
  r.handle('learner:goals', () => k.learner.goals())
  r.handle('learner:saveGoal', (g) => k.learner.saveGoal(g))
  r.handle('learner:deleteGoal', ({ id }) => k.learner.deleteGoal(id))
  r.handle('learner:mistakes', (input) => k.learner.mistakes(input?.limit ?? 30))
  r.handle('learner:deleteMistake', ({ id }) => {
    k.learner.deleteMistake(id)
    return null
  })

  // ---------- settings ----------
  r.handle('settings:get', () => k.settings.get())
  r.handle('settings:update', (patch) => {
    const next = k.settings.update(patch)
    if (patch.launchAtLogin !== undefined || patch.runInBackground !== undefined) host.applySystemSettings?.(next)
    return next
  })

  // ---------- AI ----------
  r.handle('ai:config', () => k.ai.getConfig())
  r.handle('ai:updateConfig', (patch) => k.ai.updateConfig(patch))
  r.handle('ai:setKey', ({ provider, key }) => {
    const res = k.ai.setKey(provider, key)
    return { persisted: res.persisted, config: k.ai.getConfig() }
  })
  r.handle('ai:removeKey', ({ provider }) => {
    k.ai.removeKey(provider)
    return k.ai.getConfig()
  })
  r.handle('ai:test', ({ provider }) => k.ai.testConnection(provider))
  r.handle('ai:models', ({ provider }) => k.ai.listModels(provider))

  // ---------- audio ----------
  const ttsCache = new TtsCache(path.join(k.paths.userData, 'cache', 'tts'))
  r.handle('audio:tts', async ({ text, engine, voice, speed }) => {
    const key = `${engine}|${k.ai.getConfig().providers[engine].model}|${voice ?? ''}|${speed ?? 1}|${text}`
    const hit = ttsCache.get(key)
    if (hit) return hit
    const res = await k.ai.synthesize(engine, text, voice, speed)
    ttsCache.set(key, res.audio, res.mimeType)
    return { data: res.audio, mimeType: res.mimeType }
  })
  r.handle('audio:stt', ({ audio, mimeType, hint }) => k.ai.transcribe(audio, mimeType, hint))

  // ---------- vocabulary ----------
  r.handle('vocab:save', (input) => k.vocab.save(input))
  r.handle('vocab:list', (filter) => k.vocab.list(filter ?? {}))
  r.handle('vocab:get', ({ id }) => k.vocab.get(id))
  r.handle('vocab:update', ({ id, patch }) => k.vocab.update(id, patch))
  r.handle('vocab:delete', ({ id }) => {
    k.vocab.remove(id)
    return null
  })
  r.handle('vocab:due', (input) => k.vocab.due(input?.limit ?? 30))
  r.handle('vocab:review', ({ id, rating, durationMs }) => k.vocab.review(id, rating, durationMs))
  r.handle('vocab:stats', () => k.vocab.stats())
  r.handle('vocab:topics', () => k.vocab.topics())
  r.handle('vocab:dictionary', (input) => {
    const q = norm(input?.query?.trim() ?? '')
    const all = k.content
      .dictionary()
      .filter(
        (e) =>
          (!input?.cefr || e.cefr === input.cefr) && (!q || norm(e.word).includes(q) || norm(e.meaningVi).includes(q)),
      )
      .sort((a, b) => {
        // Words starting with the query first, then alphabetical.
        const pa = q && norm(a.word).startsWith(q) ? 0 : 1
        const pb = q && norm(b.word).startsWith(q) ? 0 : 1
        return pa - pb || a.word.localeCompare(b.word)
      })
    const offset = input?.offset ?? 0
    return { items: all.slice(offset, offset + (input?.limit ?? 50)), total: all.length }
  })
  r.handle('vocab:lookup', ({ word, context, useAi }) => k.vocab.lookup(word, { context, useAi }))

  // ---------- progress ----------
  r.handle('progress:game', () => k.progress.gameState())
  r.handle('progress:quests', () => k.progress.quests())
  r.handle('progress:achievements', () => k.progress.achievements())
  r.handle('progress:stats', () => k.progress.stats())
  r.handle('progress:activity', (input) => k.progress.activity(input?.limit ?? 50, input?.beforeId))
  r.handle('progress:calendar', ({ from, to }) => k.progress.calendar(from, to))

  // ---------- library ----------
  r.handle('library:favorites', (input) => k.settings.favorites(input?.kind))
  r.handle('library:toggleFavorite', ({ kind, ref, title }) => k.settings.toggleFavorite(kind, ref, title))
  r.handle('library:isFavorite', ({ kind, ref }) => k.settings.isFavorite(kind, ref))
  r.handle('library:bookmarks', (input) => k.settings.bookmarks(input?.kind, input?.ref))
  r.handle('library:addBookmark', (b) => k.settings.addBookmark(b))
  r.handle('library:removeBookmark', ({ id }) => {
    k.settings.removeBookmark(id)
    return null
  })

  // ---------- search ----------
  r.handle('search:query', ({ q }) => k.search.search(q))

  // ---------- Telegram ----------
  registerTelegramHandlers(r, k)

  // ---------- online account ----------
  r.handle('cloud:status', () => k.cloud.status())
  r.handle('cloud:configure', ({ url, anonKey }) => {
    k.cloud.configure(url, anonKey)
    return k.cloud.status()
  })
  r.handle('cloud:sendCode', async ({ email }) => {
    await k.cloud.sendCode(email)
    return null
  })
  r.handle('cloud:verifyCode', ({ email, code }) => k.cloud.verifyCode(email, code))
  r.handle('cloud:signOut', async () => {
    await k.cloud.signOut()
    return k.cloud.status()
  })

  // ---------- data ----------
  r.handle('data:backups', () => k.data.listBackups())
  r.handle('data:createBackup', () => k.data.createBackup('manual'))
  r.handle('data:deleteBackup', ({ file }) => {
    k.data.deleteBackup(file)
    return k.data.listBackups()
  })
  r.handle('data:restoreBackup', async ({ file }) => {
    const chosen =
      file ??
      (await host.openFile({
        title: 'Chọn bản sao lưu Lingua Quest',
        filters: [{ name: 'Lingua Quest backup', extensions: ['sqlite'] }],
      }))
    if (!chosen) return null
    if (!k.paths.dbFile) throw new UserError('no_db_file', 'Database đang chạy trong bộ nhớ, không thể khôi phục.')
    try {
      await k.data.validateBackup(chosen)
    } catch (err) {
      throw new UserError(
        'invalid_backup',
        `File sao lưu không hợp lệ: ${err instanceof Error ? err.message : String(err)}`,
      )
    }
    k.db.flush()
    await k.data.restoreBackup(chosen, k.paths.dbFile)
    k.log.info(`database restored from ${path.basename(chosen)}; relaunching`)
    setTimeout(() => host.relaunch(), 300)
    return null
  })
  r.handle('data:exportJson', async () => {
    const file = await host.saveFile({
      title: 'Xuất dữ liệu học tập',
      defaultName: `lingua-quest-export-${new Date().toISOString().slice(0, 10)}.json`,
      filters: [{ name: 'JSON', extensions: ['json'] }],
    })
    if (!file) return null
    fs.writeFileSync(file, JSON.stringify(k.data.exportJson(), null, 1), 'utf8')
    return { file }
  })
  r.handle('data:exportVocabCsv', async () => {
    const file = await host.saveFile({
      title: 'Xuất từ vựng (CSV)',
      defaultName: `lingua-quest-vocabulary-${new Date().toISOString().slice(0, 10)}.csv`,
      filters: [{ name: 'CSV', extensions: ['csv'] }],
    })
    if (!file) return null
    fs.writeFileSync(file, k.data.vocabularyCsv(), 'utf8')
    return { file }
  })
  r.handle('data:importVocab', async () => {
    const file = await host.openFile({
      title: 'Nhập từ vựng',
      filters: [{ name: 'Lingua Quest export / CSV', extensions: ['json', 'csv'] }],
    })
    if (!file) return null
    if (fs.statSync(file).size > 20 * 1024 * 1024) throw new UserError('file_too_large', 'File lớn hơn 20 MB.')
    const text = fs.readFileSync(file, 'utf8')
    try {
      return k.data.importVocabulary(text, file.toLowerCase().endsWith('.json') ? 'json' : 'csv')
    } catch (err) {
      throw new UserError('invalid_import', `Không đọc được file: ${err instanceof Error ? err.message : String(err)}`)
    }
  })
}
