// IPC contract for the cinema module. Channel names must start with 'cinema:'.
import type { ChannelDef } from '@shared/ipc'

export const cinemaContract = {} satisfies Record<`cinema:${string}`, ChannelDef>
