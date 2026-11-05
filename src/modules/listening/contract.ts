// IPC contract for the listening module. Channel names must start with 'listening:'.
import type { ChannelDef } from '@shared/ipc'

export const listeningContract = {} satisfies Record<`listening:${string}`, ChannelDef>
