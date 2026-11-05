// IPC contract for the grammar module. Channel names must start with 'grammar:'.
import type { ChannelDef } from '@shared/ipc'

export const grammarContract = {} satisfies Record<`grammar:${string}`, ChannelDef>
