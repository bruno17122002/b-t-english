// Types shared by the Telegram bot service (main) and the Telegram settings page (renderer).

export const IMAGE_PROVIDERS = ['pollinations', 'gemini', 'off'] as const
export type ImageProvider = (typeof IMAGE_PROVIDERS)[number]
export const DEFAULT_IMAGE_MODEL = 'gemini-2.5-flash-image'

export type TelegramPollingState = 'stopped' | 'idle' | 'running' | 'error' | 'conflict'

export interface TelegramStatus {
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
