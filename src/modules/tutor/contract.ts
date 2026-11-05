// IPC contract for the tutor module. Channel names must start with 'tutor:'.
import { z } from 'zod'
import { channel, type ChannelDef } from '@shared/ipc'
import type { TutorConversation, TutorMessage } from '@shared/types'
import { TUTOR_STYLES } from '@shared/types'

// ---------- shared types (kept here: contract.ts is part of both tsconfig projects) ----------
export const CORRECTION_CATEGORIES = [
  'grammar',
  'vocabulary',
  'spelling',
  'word-choice',
  'punctuation',
  'pronunciation',
  'style',
] as const
export type CorrectionCategory = (typeof CORRECTION_CATEGORIES)[number]

export interface TutorCorrection {
  original: string
  correction: string
  explanationVi: string
  category: CorrectionCategory
}

export interface TutorNewWord {
  word: string
  meaningVi: string
  example: string
}

/** A message plus the structured feedback attached to it (corrections on learner turns, words on tutor turns). */
export interface TutorChatMessage extends TutorMessage {
  corrections: TutorCorrection[]
  newWords: TutorNewWord[]
  followUpQuestion: string
}

export interface TutorConversationView extends TutorConversation {
  lastMessage: string
  /** Snippet of a matching message when the list was searched. */
  match: string
}

export interface TutorThread {
  conversation: TutorConversation
  messages: TutorChatMessage[]
}

export interface TutorSendResult {
  conversation: TutorConversation
  userMessage: TutorChatMessage
  assistantMessage: TutorChatMessage
  xpGained: number
}

export const DEFAULT_TITLE = 'New conversation'

const Id = z.object({ id: z.number().int().positive() })
const Mode = z.enum(TUTOR_STYLES)

export const tutorContract = {
  'tutor:list': channel<TutorConversationView[]>()(z.object({ query: z.string().max(100).optional() }).optional()),
  'tutor:create': channel<TutorConversation>()(z.object({ mode: Mode, title: z.string().trim().max(80).optional() })),
  'tutor:get': channel<TutorThread | null>()(Id),
  'tutor:rename': channel<TutorConversation>()(z.object({ id: z.number().int().positive(), title: z.string().trim().min(1).max(80) })),
  'tutor:setMode': channel<TutorConversation>()(z.object({ id: z.number().int().positive(), mode: Mode })),
  'tutor:delete': channel<null>()(Id),
  'tutor:send': channel<TutorSendResult>()(
    z.object({
      conversationId: z.number().int().positive(),
      text: z.string().trim().min(1).max(2000),
      viaVoice: z.boolean().optional(),
    }),
  ),
} satisfies Record<`tutor:${string}`, ChannelDef>
