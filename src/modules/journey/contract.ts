// IPC contract for the journey module. Channel names must start with 'journey:'.
import type { ChannelDef } from '@shared/ipc'

export const journeyContract = {} satisfies Record<`journey:${string}`, ChannelDef>
