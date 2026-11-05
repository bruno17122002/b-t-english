// AI tutor chat through the server's `tutor` Edge Function (server-side Gemini key, daily quota).
// Request: POST /functions/v1/tutor { message, history } → { reply, corrections, newWords, usage }
// (contract: supabase/functions/_shared/tutor.ts; corrections {original, correction, explanationVi},
// newWords {word, ipa, meaningVi, example}; other shapes are tolerated).
import { z } from 'zod'
import { CloudError, type KV } from './supabase'

export interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
  corrections?: Correction[]
  newWords?: NewWord[]
  at: string
}

export interface Correction {
  original: string
  corrected: string
  explanation: string
}

export interface NewWord {
  word: string
  meaning: string
  ipa: string
  example: string
}

const s = z.preprocess((v) => (v == null ? '' : String(v)), z.string())

const CorrectionSchema = z.union([
  z.string().transform((t): Correction => ({ original: '', corrected: t, explanation: '' })),
  z
    .object({
      original: s.optional(),
      wrong: s.optional(),
      corrected: s.optional(),
      fix: s.optional(),
      correction: s.optional(),
      explanation: s.optional(),
      explanationVi: s.optional(),
      note: s.optional(),
    })
    .transform((o): Correction => ({
      original: o.original || o.wrong || '',
      corrected: o.corrected || o.correction || o.fix || '',
      explanation: o.explanationVi || o.explanation || o.note || '',
    })),
])

const NewWordSchema = z.union([
  z.string().transform((w): NewWord => ({ word: w, meaning: '', ipa: '', example: '' })),
  z
    .object({
      word: s,
      meaning: s.optional(),
      meaning_vi: s.optional(),
      meaningVi: s.optional(),
      definition: s.optional(),
      ipa: s.optional(),
      example: s.optional(),
    })
    .transform((o): NewWord => ({
      word: o.word,
      meaning: o.meaningVi || o.meaning_vi || o.meaning || o.definition || '',
      ipa: o.ipa ?? '',
      example: o.example ?? '',
    })),
])

const listOf = <T>(item: z.ZodType<T>) =>
  z.preprocess(
    (v) => (Array.isArray(v) ? v : []),
    z.array(z.unknown()).transform((arr) =>
      arr.flatMap((x) => {
        const p = item.safeParse(x)
        return p.success ? [p.data] : []
      }),
    ),
  )

export const TutorResponseSchema = z.object({
  reply: z.string().min(1),
  corrections: listOf(CorrectionSchema).optional().default([]),
  newWords: listOf(NewWordSchema).optional().default([]),
})
export type TutorResponse = z.output<typeof TutorResponseSchema>

/** The last turns sent as context (the function keeps its own limits too). */
export function historyForRequest(
  messages: ChatMessage[],
  max = 12,
): { role: 'user' | 'assistant'; content: string }[] {
  return messages.slice(-max).map((m) => ({ role: m.role, content: m.content.slice(0, 2000) }))
}

export function parseTutorResponse(raw: unknown): TutorResponse {
  const p = TutorResponseSchema.safeParse(raw)
  if (!p.success) throw new CloudError('server', 'Phản hồi của gia sư không hợp lệ.')
  return {
    ...p.data,
    corrections: p.data.corrections.filter((c) => c.corrected),
    newWords: p.data.newWords.filter((w) => w.word),
  }
}

export type TutorErrorKind = 'not_deployed' | 'no_ai' | 'quota' | 'offline' | 'signed_out' | 'other'

/** Maps a failed call to a user-facing category (404 = function not deployed, 503 = no GEMINI_API_KEY). */
export function tutorErrorKind(e: unknown): TutorErrorKind {
  if (!(e instanceof CloudError)) return 'other'
  if (e.code === 'not_found') return 'not_deployed'
  if (e.status === 503) return 'no_ai'
  if (e.code === 'rate_limited') return 'quota'
  if (e.code === 'network') return 'offline'
  if (e.code === 'not_signed_in') return 'signed_out'
  return 'other'
}

export interface Invoker {
  invoke<T>(name: string, body: unknown): Promise<T>
}

export async function askTutor(client: Invoker, message: string, history: ChatMessage[]): Promise<TutorResponse> {
  const raw = await client.invoke<unknown>('tutor', {
    message: message.slice(0, 2000),
    history: historyForRequest(history),
  })
  return parseTutorResponse(raw)
}

// ---------- local chat history ----------
export const chatKey = (userId: string) => `lq.tutor.${userId}`

export function loadChat(kv: KV, userId: string): ChatMessage[] {
  try {
    const v = JSON.parse(kv.get(chatKey(userId)) ?? '[]') as unknown
    return Array.isArray(v) ? (v as ChatMessage[]).filter((m) => m && typeof m.content === 'string') : []
  } catch {
    return []
  }
}

export function saveChat(kv: KV, userId: string, messages: ChatMessage[], keep = 60): void {
  kv.set(chatKey(userId), JSON.stringify(messages.slice(-keep)))
}
