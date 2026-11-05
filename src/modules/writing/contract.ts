// IPC contract for the writing module. Channel names must start with 'writing:'.
import type { ChannelDef } from '@shared/ipc'

export const writingContract = {} satisfies Record<`writing:${string}`, ChannelDef>
