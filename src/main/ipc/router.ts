// Typed IPC router. Validates every payload against the contract schema, runs the handler and returns
// a serialisable IpcResult. Errors are normalised so the renderer never sees stack traces or secrets.
import { ZodError, type z } from 'zod'
import type { IpcError, IpcResult } from '@shared/ipc'
import { CONTRACT, type Channel, type Contract } from '@modules/contract'
import type { ChannelOutput } from '@shared/ipc'
import { AiError } from '../kernel/ai/types'
import { redactSecrets } from '../kernel/ai/http'
import { InvalidKeyFormatError } from '../kernel/secure/keyStore'
import type { KernelLog } from '../kernel'

/** Error with a user-facing message (Vietnamese-first) and a stable code. */
export class UserError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly hint?: string,
  ) {
    super(message)
    this.name = 'UserError'
  }
}

export type HandlerInput<K extends Channel> = z.output<Contract[K]['input']>
export type Handler<K extends Channel> = (
  input: HandlerInput<K>,
) => ChannelOutput<Contract, K> | Promise<ChannelOutput<Contract, K>>

const AI_HINTS: Partial<Record<string, string>> = {
  no_key: 'ai-settings',
  invalid_key: 'ai-settings',
  quota: 'ai-settings',
  model_not_found: 'ai-settings',
}

export function toIpcError(err: unknown, log?: KernelLog, channel?: string): IpcError {
  if (err instanceof AiError) {
    const hint = AI_HINTS[err.code]
    return { code: `ai_${err.code}`, message: err.userMessage, ...(hint ? { hint } : {}) }
  }
  if (err instanceof UserError) return { code: err.code, message: err.message, ...(err.hint ? { hint: err.hint } : {}) }
  if (err instanceof InvalidKeyFormatError) return { code: 'invalid_key_format', message: 'API key không đúng định dạng.' }
  if (err instanceof ZodError) {
    const first = err.issues[0]
    return {
      code: 'invalid_input',
      message: `Dữ liệu không hợp lệ${first ? ` (${first.path.join('.') || 'input'}: ${first.message})` : ''}.`,
    }
  }
  const msg = err instanceof Error ? err.message : String(err)
  log?.error(`ipc ${channel ?? '?'} failed: ${redactSecrets(msg)}${err instanceof Error && err.stack ? ` ${redactSecrets(err.stack.split('\n').slice(0, 4).join(' | '))}` : ''}`)
  return { code: 'internal', message: 'Đã xảy ra lỗi không mong muốn. Chi tiết đã được ghi vào nhật ký (Cài đặt → Chẩn đoán).' }
}

export class IpcRouter {
  private readonly handlers = new Map<string, (input: unknown) => unknown>()

  constructor(private readonly log?: KernelLog) {}

  handle<K extends Channel>(channel: K, handler: Handler<K>): void {
    if (!(channel in CONTRACT)) throw new Error(`Channel ${channel} is not in the IPC contract`)
    if (this.handlers.has(channel)) throw new Error(`Channel ${channel} registered twice`)
    this.handlers.set(channel, handler as (input: unknown) => unknown)
  }

  has(channel: string): boolean {
    return this.handlers.has(channel)
  }

  /** Channels declared in the contract that have no handler – checked by a test. */
  missing(): string[] {
    return Object.keys(CONTRACT).filter((c) => !this.handlers.has(c))
  }

  async dispatch(channel: string, payload: unknown): Promise<IpcResult<unknown>> {
    const handler = this.handlers.get(channel)
    const def = (CONTRACT as Record<string, { input: z.ZodType } | undefined>)[channel]
    if (!handler || !def) return { ok: false, error: { code: 'unknown_channel', message: `Unknown channel ${channel}` } }
    try {
      const input = def.input.parse(payload)
      const data = await handler(input)
      return { ok: true, data: data === undefined ? null : data }
    } catch (err) {
      return { ok: false, error: toIpcError(err, this.log, channel) }
    }
  }
}
