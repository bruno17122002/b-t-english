// IPC contract primitives. Every channel declares a zod schema for its input and a phantom type for its
// output. Main validates input against the schema; preload only forwards channels that exist in the contract.
import { z } from 'zod'

export interface ChannelDef<I extends z.ZodType = z.ZodType, O = unknown> {
  input: I
  /** Phantom field carrying the output type – never set at runtime. */
  readonly _out?: { t: O }
}

/** Declares a channel: `channel<Output>()(inputSchema)`. Curried so the output type can be given explicitly. */
export const channel =
  <O>() =>
  <I extends z.ZodType>(input: I): ChannelDef<I, O> => ({ input })

/**
 * A measured amount (seconds, minutes, ms) clamped into [min, max] instead of rejected: a page left open for
 * hours or a clock jump must not lose the learner's result. NaN and ±Infinity are still rejected.
 */
export const clampedNumber = (min: number, max: number) => z.number().transform((v) => Math.min(max, Math.max(min, v)))

/** Free-text query that is cut to `max` characters instead of rejected (search boxes, bot commands). */
export const truncatedText = (max: number) =>
  z
    .string()
    .max(10_000)
    .transform((s) => Array.from(s).slice(0, max).join(''))

/** Input schema for channels that take nothing. */
export const NoInput = z.undefined().optional()

export type ContractShape = Record<string, ChannelDef>

export type ChannelInput<C extends ContractShape, K extends keyof C> = z.input<C[K]['input']>
export type ChannelOutput<C extends ContractShape, K extends keyof C> = NonNullable<C[K]['_out']>['t']

export interface IpcError {
  code: string
  message: string
  /** Extra hint for the UI (for example which settings page fixes the problem). */
  hint?: string
}

export type IpcResult<T> = { ok: true; data: T } | { ok: false; error: IpcError }

/** Events pushed from main to the renderer. */
export const PUSH_EVENTS = ['reward', 'navigate', 'toast', 'data-changed'] as const
export type PushEvent = (typeof PUSH_EVENTS)[number]

/** Bridge exposed on window.lq by the preload script. */
export interface LqBridge {
  invoke(channel: string, payload?: unknown): Promise<IpcResult<unknown>>
  on(event: PushEvent, listener: (payload: unknown) => void): () => void
  platform: string
}
