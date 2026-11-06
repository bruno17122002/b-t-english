// Typed IPC router. Validates every payload against the contract schema, runs the handler and returns
// a serialisable IpcResult. Errors are normalised so the renderer never sees stack traces or secrets.
import { ZodError, type z } from 'zod'
import type { IpcError, IpcResult } from '@shared/ipc'
import { CONTRACT, type Channel, type Contract } from '@modules/contract'
import type { ChannelOutput } from '@shared/ipc'
import { AiError } from '../kernel/ai/types'
import { CloudError } from '../kernel/cloud/client'
import { redactSecrets } from '../kernel/ai/http'
import { InvalidKeyFormatError } from '../kernel/secure/keyStore'
import type { KernelLog } from '../kernel'
import { UserError } from '../kernel/errors'
import { DatabaseClosedError } from '../db/database'

export { UserError }

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

const clip = (s: string, max: number) => (s.length > max ? `${s.slice(0, max)}…` : s)

/** Drops `undefined` values from plain objects (structured clone keeps `{ field: undefined }` keys). */
function stripUndefined(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(stripUndefined)
  if (!v || typeof v !== 'object' || Object.getPrototypeOf(v) !== Object.prototype) return v
  const out: Record<string, unknown> = {}
  for (const [k, x] of Object.entries(v)) if (x !== undefined) out[k] = stripUndefined(x)
  return out
}

/** Stable key of a validated payload for de-duplicating double clicks (binary is summarised, not copied). */
function payloadKey(channel: string, input: unknown): string {
  return `${channel}\u0000${JSON.stringify(input ?? null, (_k, v: unknown) =>
    v instanceof Uint8Array ? `bin:${v.byteLength}:${v.subarray(0, 64).join('.')}` : v,
  )}`
}

/**
 * Mutations that must not run twice when the learner double-clicks: a repeat with an identical payload
 * within the repeat window gets the first call's result instead of awarding XP / creating rows again.
 */
export const REPEAT_GUARDED_CHANNELS = new Set<string>([
  'vocab:review',
  'grammar:submit',
  'grammar:generate',
  'reading:complete',
  'reading:addHighlight',
  'reading:generate',
  'reading:retell',
  'listening:submit',
  'listening:generate',
  'speaking:submit',
  'speaking:pronComplete',
  'speaking:roleplayTurn',
  'writing:submit',
  'writing:selfCorrect',
  'cinema:advance',
  'cinema:generate',
  'tutor:create',
  'tutor:send',
  'coach:generateReport',
  'coach:applyPlan',
  'coach:askHabits',
  'journey:assessmentAnswer',
  'journey:assessmentFinish',
  'journey:assessmentWriting',
  'journey:assessmentSpeaking',
  'journey:courseComplete',
  'journey:roadmapGenerate',
  'library:addBookmark',
  'data:createBackup',
  'cloud:createBackup',
])

export interface RouterOptions {
  /** How long (ms) a completed guarded mutation answers identical repeats (0 = only while in flight). */
  repeatWindowMs?: number
}

export function toIpcError(err: unknown, log?: KernelLog, channel?: string): IpcError {
  if (err instanceof AiError) {
    const hint = AI_HINTS[err.code]
    return { code: `ai_${err.code}`, message: err.userMessage, ...(hint ? { hint } : {}) }
  }
  if (err instanceof CloudError) {
    const hint = err.code === 'not_configured' || err.code === 'not_signed_in' ? { hint: 'account-settings' } : {}
    return { code: `cloud_${err.code}`, message: err.message, ...hint }
  }
  if (err instanceof UserError) return { code: err.code, message: err.message, ...(err.hint ? { hint: err.hint } : {}) }
  if (err instanceof InvalidKeyFormatError)
    return { code: 'invalid_key_format', message: 'API key không đúng định dạng.' }
  if (err instanceof DatabaseClosedError)
    return {
      code: 'db_closed',
      message: 'Ứng dụng đang khởi động lại để mở dữ liệu vừa khôi phục. Vui lòng đợi trong giây lát.',
    }
  if (err instanceof ZodError) {
    const first = err.issues[0]
    // Paths can contain learner-controlled record keys: keep the message short.
    const where = first ? clip(first.path.map(String).join('.') || 'input', 80) : ''
    return {
      code: 'invalid_input',
      message: `Dữ liệu không hợp lệ${first ? ` (${where}: ${clip(first.message, 160)})` : ''}.`,
    }
  }
  const msg = err instanceof Error ? err.message : String(err)
  log?.error(
    `ipc ${channel ?? '?'} failed: ${redactSecrets(msg)}${err instanceof Error && err.stack ? ` ${redactSecrets(err.stack.split('\n').slice(0, 4).join(' | '))}` : ''}`,
  )
  return {
    code: 'internal',
    message: 'Đã xảy ra lỗi không mong muốn. Chi tiết đã được ghi vào nhật ký (Cài đặt → Chẩn đoán).',
  }
}

export class IpcRouter {
  private readonly handlers = new Map<string, (input: unknown) => unknown>()

  /** Identical calls still running: a second identical call shares the first one's promise. */
  private readonly inflight = new Map<string, Promise<IpcResult<unknown>>>()
  /** Recently completed guarded mutations (payload key → time and result). */
  private readonly recent = new Map<string, { at: number; result: IpcResult<unknown> }>()
  private readonly repeatWindowMs: number

  constructor(
    private readonly log?: KernelLog,
    opts: RouterOptions = {},
  ) {
    this.repeatWindowMs = opts.repeatWindowMs ?? 0
  }

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
    if (!handler || !def)
      return {
        ok: false,
        error: { code: 'unknown_channel', message: `Unknown channel ${clip(String(channel), 60)}` },
      }
    let input: unknown
    let key: string
    try {
      input = stripUndefined(def.input.parse(payload))
      key = payloadKey(channel, input)
    } catch (err) {
      return { ok: false, error: toIpcError(err, this.log, channel) }
    }
    const running = this.inflight.get(key)
    if (running) return running
    const guarded = REPEAT_GUARDED_CHANNELS.has(channel) && this.repeatWindowMs > 0
    if (guarded) {
      const prev = this.recent.get(key)
      if (prev && Date.now() - prev.at < this.repeatWindowMs) return prev.result
    }
    const run = (async (): Promise<IpcResult<unknown>> => {
      try {
        const data = await handler(input)
        return { ok: true, data: data === undefined ? null : data }
      } catch (err) {
        return { ok: false, error: toIpcError(err, this.log, channel) }
      }
    })()
    this.inflight.set(key, run)
    const result = await run.finally(() => this.inflight.delete(key))
    if (guarded && result.ok) {
      const now = Date.now()
      for (const [k, v] of this.recent) if (now - v.at >= this.repeatWindowMs) this.recent.delete(k)
      this.recent.set(key, { at: now, result })
    }
    return result
  }
}
