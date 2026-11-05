// IPC contract for the speaking module. Channel names must start with 'speaking:'.
import type { ChannelDef } from '@shared/ipc'

export const speakingContract = {} satisfies Record<`speaking:${string}`, ChannelDef>
