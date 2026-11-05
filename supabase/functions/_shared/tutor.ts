// Tutor endpoint for the PWA: POST {message, history?} with the user's JWT → {reply, corrections[], newWords[]}.
// Same prompt and learner context as the Telegram tutor, same per-user daily quota.
import { dateKeyIn } from './dates.ts'
import { AiError, type AiModel, type ChatMessage } from './gemini.ts'
import { learnerContext, learnerLine, loadLearner } from './learner.ts'
import { runTutor, type Correction, type NewWord } from './prompts.ts'
import { DailyLimitError, type AiQuota } from './quota.ts'
import type { SupabaseRest } from './rest.ts'

export interface TutorRequest {
  message: string
  history: ChatMessage[]
}

export interface TutorResponse {
  reply: string
  corrections: Correction[]
  newWords: NewWord[]
  usage: { used: number; limit: number }
}

export class TutorHttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message)
    this.name = 'TutorHttpError'
  }
}

export function parseTutorRequest(body: unknown): TutorRequest {
  const b = (body && typeof body === 'object' ? body : {}) as { message?: unknown; history?: unknown }
  const message = typeof b.message === 'string' ? b.message.trim() : ''
  if (!message) throw new TutorHttpError(400, 'bad_request', 'Thiếu nội dung tin nhắn.')
  if (message.length > 3000) throw new TutorHttpError(400, 'bad_request', 'Tin nhắn quá dài (tối đa 3000 ký tự).')
  const history = (Array.isArray(b.history) ? b.history : [])
    .filter(
      (m): m is ChatMessage =>
        !!m &&
        typeof m === 'object' &&
        ((m as ChatMessage).role === 'user' || (m as ChatMessage).role === 'assistant') &&
        typeof (m as ChatMessage).content === 'string',
    )
    .slice(-20)
    .map((m) => ({ role: m.role, content: m.content.slice(0, 4000) }))
  while (history.length && history[0]?.role !== 'user') history.shift()
  return { message, history }
}

export async function tutorReply(
  deps: { rest: SupabaseRest; ai: AiModel | null; quota: AiQuota; now?: () => Date },
  userId: string,
  req: TutorRequest,
): Promise<TutorResponse> {
  if (!deps.ai) throw new TutorHttpError(503, 'no_ai', 'Máy chủ chưa bật AI (thiếu GEMINI_API_KEY).')
  const now = (deps.now ?? (() => new Date()))()
  const user = deps.rest.forUser(userId)
  const data = await loadLearner(user, now, { skipVocab: true, sinceDays: 14 })
  const day = dateKeyIn(now, data.timezone)
  let used: number
  try {
    used = await deps.quota.consume(userId, day)
  } catch (err) {
    if (err instanceof DailyLimitError) throw new TutorHttpError(429, 'daily_limit', err.userMessage)
    throw err
  }
  try {
    const out = await runTutor(deps.ai, {
      message: req.message,
      history: req.history,
      context: learnerContext(data, now),
      learnerLine: learnerLine(data),
      mode: 'text',
      surface: 'app',
    })
    return {
      reply: out.reply,
      corrections: out.corrections,
      newWords: out.newWords,
      usage: { used, limit: deps.quota.limit },
    }
  } catch (err) {
    if (err instanceof AiError) throw new TutorHttpError(502, `ai_${err.code}`, err.userMessage)
    throw err
  }
}
