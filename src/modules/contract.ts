// The complete IPC contract: kernel channels plus every feature module's channels.
// Preload derives its allowlist from these keys; main validates payloads with these schemas.
import { kernelContract } from '@shared/kernelContract'
import type { ChannelInput, ChannelOutput } from '@shared/ipc'
import { cinemaContract } from './cinema/contract'
import { grammarContract } from './grammar/contract'
import { journeyContract } from './journey/contract'
import { listeningContract } from './listening/contract'
import { readingContract } from './reading/contract'
import { speakingContract } from './speaking/contract'
import { tutorContract } from './tutor/contract'
import { writingContract } from './writing/contract'

export const CONTRACT = {
  ...kernelContract,
  ...journeyContract,
  ...listeningContract,
  ...speakingContract,
  ...readingContract,
  ...writingContract,
  ...grammarContract,
  ...cinemaContract,
  ...tutorContract,
}

export type Contract = typeof CONTRACT
export type Channel = keyof Contract
export type In<K extends Channel> = ChannelInput<Contract, K>
export type Out<K extends Channel> = ChannelOutput<Contract, K>
export const CHANNELS = Object.keys(CONTRACT) as Channel[]
