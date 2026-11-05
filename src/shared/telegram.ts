// Types shared by the Telegram bot service (main) and the Telegram settings page (renderer).

export const IMAGE_PROVIDERS = ['pollinations', 'gemini', 'off'] as const
export type ImageProvider = (typeof IMAGE_PROVIDERS)[number]
export const DEFAULT_IMAGE_MODEL = 'gemini-2.5-flash-image'

export type TelegramPollingState = 'stopped' | 'idle' | 'running' | 'error' | 'conflict'

export interface TelegramStatus {
  /** 'server': the local bot does not poll; the central server bot is used instead. */
  mode: 'local' | 'server'
  /** Token saved and a chat linked: the bot can message the learner. */
  connected: boolean
  hasToken: boolean
  /** Masked token such as "••••a1B2" – the token itself never leaves the main process. */
  tokenHint: string | null
  botUsername: string | null
  chatLinked: boolean
  /** 6-digit code to send to the bot while a token is set but no chat is linked yet. */
  pairingCode: string | null
  polling: TelegramPollingState
  lastError: string | null
  lastErrorCode: string | null
  imageProvider: ImageProvider
  imageModel: string
  encryptionAvailable: boolean
  /** Every registered bot command (built-in and module commands). */
  commands: { name: string; description: { en: string; vi: string } }[]
}

/** Where the bot runs: the learner's own bot polled by this app, or the central bot on the Supabase server. */
export const TELEGRAM_MODES = ['local', 'server'] as const
export type TelegramMode = (typeof TELEGRAM_MODES)[number]

/** Settings → Telegram in "server" mode (online account required). */
export interface TelegramServerStatus {
  mode: TelegramMode
  cloud: { configured: boolean; signedIn: boolean; email: string | null }
  /** A Telegram chat is linked to the online account (telegram_links). */
  linked: boolean
  link: { username: string | null; linkedAt: string } | null
  /** @username of the central server bot (configurable, flag telegram.serverBot). */
  serverBot: string | null
  /** Last time the coach schedules were pushed to notification_schedules. */
  schedulesPushedAt: string | null
  /** Why the link status could not be read (offline, server error…), Vietnamese. */
  error: string | null
}

export interface TelegramLinkCode {
  code: string
  expiresAt: string
  /** Text to send to the server bot. */
  startCommand: string
  /** t.me deep link that sends /start <code> automatically (null until the bot username is set). */
  deepLink: string | null
  serverBot: string | null
}
