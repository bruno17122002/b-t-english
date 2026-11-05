// IPC contract for the tutor module. Channel names must start with 'tutor:'.
import type { ChannelDef } from '@shared/ipc'

export const tutorContract = {} satisfies Record<`tutor:${string}`, ChannelDef>
