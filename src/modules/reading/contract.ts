// IPC contract for the reading module. Channel names must start with 'reading:'.
import type { ChannelDef } from '@shared/ipc'

export const readingContract = {} satisfies Record<`reading:${string}`, ChannelDef>
