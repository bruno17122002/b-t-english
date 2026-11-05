// One-time import of the old stand-alone Python bot's config.json (bot token, chat id, Gemini key/models).
// The file is staged at <userData>/legacy/telegram-config.json; secrets go into the encrypted key store and the
// plain-text file is overwritten and deleted, so the token never stays on disk unencrypted.
import fs from 'node:fs'
import path from 'node:path'
import type { Kernel } from '..'

/** Settings flags shared by the Telegram service, the coach module and this importer. */
export const TELEGRAM_FLAGS = {
  chatId: 'telegram.chatId',
  imageProvider: 'telegram.imageProvider', // 'pollinations' | 'gemini' | 'off'
  imageModel: 'telegram.imageModel',
  offset: 'telegram.offset',
  /** Cached @username of the bot (not secret), refreshed by getMe. */
  botUsername: 'telegram.botUsername',
  /** 'local' (default, this app polls the learner's own bot) or 'server' (central bot on Supabase). */
  mode: 'telegram.mode',
  /** @username of the central server bot, shown in the server-mode instructions. */
  serverBot: 'telegram.serverBot',
  /** JSON {hash, userId, at} of the last coach-schedule push to notification_schedules. */
  schedulesPushed: 'telegram.schedulesPushed',
} as const

interface LegacyConfig {
  bot_token?: string
  chat_id?: string | number
  gemini_api_key?: string
  gemini_model?: string
  gemini_image_model?: string
  image_provider?: string
}

export function legacyConfigPath(userData: string): string {
  return path.join(userData, 'legacy', 'telegram-config.json')
}

function shred(file: string) {
  try {
    const size = fs.statSync(file).size
    fs.writeFileSync(file, Buffer.alloc(size, 0))
  } catch {
    /* best effort */
  }
  fs.rmSync(file, { force: true })
}

/** Returns what was imported (never the secret values). */
export function importLegacyTelegramConfig(k: Kernel): string[] {
  const file = legacyConfigPath(k.paths.userData)
  if (!fs.existsSync(file)) return []
  const imported: string[] = []
  try {
    const cfg = JSON.parse(fs.readFileSync(file, 'utf8')) as LegacyConfig
    if (cfg.bot_token && /^\d+:[\w-]{20,}$/.test(cfg.bot_token.trim())) {
      k.keys.set('telegram', cfg.bot_token.trim())
      imported.push('bot token')
    }
    const chatId = String(cfg.chat_id ?? '').trim()
    if (/^-?\d+$/.test(chatId)) {
      k.settings.setFlag(TELEGRAM_FLAGS.chatId, chatId)
      imported.push('chat id')
    }
    if (cfg.gemini_api_key && !k.keys.has('gemini')) {
      k.ai.setKey('gemini', cfg.gemini_api_key.trim())
      imported.push('Gemini key')
    }
    if (cfg.gemini_model) k.ai.updateConfig({ geminiModel: cfg.gemini_model })
    if (cfg.image_provider && ['pollinations', 'gemini', 'off'].includes(cfg.image_provider))
      k.settings.setFlag(TELEGRAM_FLAGS.imageProvider, cfg.image_provider)
    if (cfg.gemini_image_model) k.settings.setFlag(TELEGRAM_FLAGS.imageModel, cfg.gemini_image_model)
    k.log.info(`legacy Telegram config imported: ${imported.join(', ') || 'nothing usable'}`)
  } catch (err) {
    k.log.warn(`legacy Telegram config could not be imported: ${err instanceof Error ? err.message : String(err)}`)
    return imported
  }
  shred(file)
  try {
    fs.rmdirSync(path.dirname(file))
  } catch {
    /* folder not empty */
  }
  return imported
}
