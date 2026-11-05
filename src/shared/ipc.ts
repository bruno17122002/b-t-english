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
