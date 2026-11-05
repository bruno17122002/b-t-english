// Contract between the Telegram bot service and the rest of the app. Modules never talk to the Telegram API
// directly: they send messages and register commands / button callbacks through this port.

export interface TelegramButton {
  text: string
  /** Callback data, at most 64 bytes, e.g. "review:42:3". */
  data: string
}

export interface TelegramReply {
  /** Plain text (escaped automatically). */
  text?: string
  /** Telegram HTML subset: <b>, <i>, <u>, <s>, <code>, <pre>, <a href>, <blockquote>. Caller must escape user text. */
  html?: string
  /** Inline keyboard, rows of buttons. */
  buttons?: TelegramButton[][]
  photo?: { data: Uint8Array; filename: string; caption?: string }
  /** Optional voice/audio answer (e.g. TTS of an English sentence). */
  audio?: { data: Uint8Array; filename: string; mimeType: string; caption?: string }
  /** Button callbacks only: replace the message holding the pressed button instead of sending a new one. */
  edit?: boolean
  /** Button callbacks only: short pop-up text shown by Telegram (answerCallbackQuery). */
  toast?: string
}

export interface TelegramContext {
  chatId: string
  /** Text after the command name, trimmed. */
  args: string
  /** Telegram user's first name, when known. */
  firstName?: string
}

export interface TelegramCommand {
  /** Command without slash, lowercase a–z0–9_. */
  name: string
  description: { en: string; vi: string }
  run(ctx: TelegramContext): Promise<TelegramReply | TelegramReply[] | void>
}

export interface TelegramPort {
  /** True when a bot token and a linked chat are configured. */
  isConnected(): boolean
  /** Sends to the linked chat. Resolves false (never throws) when not connected or sending failed. */
  send(reply: TelegramReply | TelegramReply[]): Promise<boolean>
  registerCommand(cmd: TelegramCommand): void
  /** Handles inline-button callbacks whose data starts with `${prefix}:`. */
  registerCallback(prefix: string, handler: (data: string, ctx: TelegramContext) => Promise<TelegramReply | void>): void
}

/** Used until the real service is wired (tests, or when Telegram is not configured). */
export class NullTelegram implements TelegramPort {
  readonly commands: TelegramCommand[] = []
  readonly callbacks = new Map<string, (data: string, ctx: TelegramContext) => Promise<TelegramReply | void>>()
  readonly sent: (TelegramReply | TelegramReply[])[] = []
  isConnected() {
    return false
  }
  async send(reply: TelegramReply | TelegramReply[]) {
    this.sent.push(reply)
    return false
  }
  registerCommand(cmd: TelegramCommand) {
    this.commands.push(cmd)
  }
  registerCallback(prefix: string, handler: (data: string, ctx: TelegramContext) => Promise<TelegramReply | void>) {
    this.callbacks.set(prefix, handler)
  }
}
