// Gemini generateContent client for the server (key from the GEMINI_API_KEY secret). JSON mode with validation and one
// repair round, inline images (vision) and inline audio (voice messages: transcription + feedback in one call).
import { toBase64 } from './format.ts'
import type { FetchLike } from './rest.ts'

const BASE = 'https://generativelanguage.googleapis.com/v1beta'
export const DEFAULT_GEMINI_MODEL = 'gemini-2.5-flash'

export type AiErrorCode =
  'no_key' | 'invalid_key' | 'quota' | 'rate_limited' | 'safety_blocked' | 'bad_response' | 'network' | 'server'

const MESSAGES_VI: Record<AiErrorCode, string> = {
  no_key: 'Máy chủ chưa được cấu hình AI (thiếu GEMINI_API_KEY).',
  invalid_key: 'Key Gemini của máy chủ không hợp lệ.',
  quota: 'AI của máy chủ đã hết hạn mức, bạn thử lại sau nhé.',
  rate_limited: 'AI đang quá tải, bạn thử lại sau ít phút nhé.',
  safety_blocked: 'AI từ chối trả lời nội dung này.',
  bad_response: 'AI trả lời không hợp lệ, bạn thử lại nhé.',
  network: 'Không kết nối được tới AI, bạn thử lại sau nhé.',
  server: 'Dịch vụ AI đang lỗi, bạn thử lại sau nhé.',
}

export class AiError extends Error {
  constructor(
    readonly code: AiErrorCode,
    detail = '',
  ) {
    super(`${code}${detail ? `: ${detail.slice(0, 200)}` : ''}`)
    this.name = 'AiError'
  }
  get userMessage(): string {
    return MESSAGES_VI[this.code]
  }
}

export interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
}

export interface Media {
  data: Uint8Array
  mimeType: string
}

export interface GenerateInput {
  system: string
  messages: ChatMessage[]
  /** Attached to the last user message. */
  image?: Media
  audio?: Media
  json?: boolean
  temperature?: number
  maxOutputTokens?: number
}

/** Something that can generate text – the real Gemini client or a test fake. */
export interface AiModel {
  generate(input: GenerateInput): Promise<string>
}

interface GeminiResponse {
  candidates?: { content?: { parts?: { text?: string }[] }; finishReason?: string }[]
  promptFeedback?: { blockReason?: string }
  error?: { message?: string; status?: string }
}

/**
 * Gemini 2.5 models "think" before answering and the thinking tokens count against maxOutputTokens, so a small
 * budget (a quiz, a nudge, a word card) could end with an empty or half-written JSON answer. Flash models get
 * thinking switched off; Pro, which cannot switch it off, gets its own thinking budget on top of the output.
 */
export function outputConfigFor(model: string, maxOutputTokens: number) {
  if (/gemini-2\.5-flash/.test(model)) return { maxOutputTokens, thinkingConfig: { thinkingBudget: 0 } }
  if (/gemini-2\.5-pro/.test(model))
    return { maxOutputTokens: maxOutputTokens + 1024, thinkingConfig: { thinkingBudget: 1024 } }
  return { maxOutputTokens }
}

export class Gemini implements AiModel {
  constructor(
    private readonly apiKey: string,
    readonly model: string = DEFAULT_GEMINI_MODEL,
    private readonly fetchImpl: FetchLike = (input, init) => fetch(input, init),
  ) {}

  async generate(input: GenerateInput): Promise<string> {
    if (!this.apiKey) throw new AiError('no_key')
    const contents = input.messages.map((m, i) => {
      const parts: Record<string, unknown>[] = [{ text: m.content }]
      const last = i === input.messages.length - 1
      if (last && input.image)
        parts.push({ inlineData: { mimeType: input.image.mimeType, data: toBase64(input.image.data) } })
      if (last && input.audio)
        parts.push({ inlineData: { mimeType: input.audio.mimeType, data: toBase64(input.audio.data) } })
      return { role: m.role === 'assistant' ? 'model' : 'user', parts }
    })
    let res: Response
    try {
      res = await this.fetchImpl(`${BASE}/models/${encodeURIComponent(this.model)}:generateContent`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-goog-api-key': this.apiKey },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: input.system }] },
          contents,
          generationConfig: {
            temperature: input.temperature ?? 0.7,
            ...outputConfigFor(this.model, input.maxOutputTokens ?? 4096),
            ...(input.json ? { responseMimeType: 'application/json' } : {}),
          },
        }),
      })
    } catch (err) {
      throw new AiError('network', err instanceof Error ? err.message : String(err))
    }
    const data = (await res.json().catch(() => ({}))) as GeminiResponse
    if (!res.ok) {
      const detail = data.error?.message ?? ''
      if (res.status === 400 && /api key/i.test(detail)) throw new AiError('invalid_key', detail)
      if (res.status === 401 || res.status === 403) throw new AiError('invalid_key', detail)
      if (res.status === 429) throw new AiError(/quota/i.test(detail) ? 'quota' : 'rate_limited', detail)
      if (res.status >= 500) throw new AiError('server', detail)
      throw new AiError('bad_response', detail)
    }
    if (data.promptFeedback?.blockReason) throw new AiError('safety_blocked')
    const cand = data.candidates?.[0]
    if (!cand) throw new AiError('bad_response', 'no candidates')
    if (cand.finishReason === 'SAFETY' || cand.finishReason === 'PROHIBITED_CONTENT')
      throw new AiError('safety_blocked')
    const text = (cand.content?.parts ?? []).map((p) => p.text ?? '').join('')
    if (!text.trim()) throw new AiError('bad_response', 'empty answer')
    if (input.json && cand.finishReason === 'MAX_TOKENS')
      throw new AiError('bad_response', 'answer cut off (MAX_TOKENS)')
    return text
  }
}

/** Thrown by output validators; the message is shown to the model in the repair round. */
export class InvalidOutput extends Error {}

export function parseJsonText(text: string): unknown {
  const clean = text
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '')
  try {
    return JSON.parse(clean)
  } catch {
    const start = clean.indexOf('{')
    const end = clean.lastIndexOf('}')
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(clean.slice(start, end + 1))
      } catch {
        /* fall through */
      }
    }
    throw new InvalidOutput('The answer was not valid JSON.')
  }
}

/** JSON generation with validation and one repair round. */
export async function generateJson<T>(
  ai: AiModel,
  input: Omit<GenerateInput, 'json'>,
  validate: (raw: unknown) => T,
): Promise<T> {
  const first = await ai.generate({ ...input, json: true })
  try {
    return validate(parseJsonText(first))
  } catch (err) {
    if (!(err instanceof InvalidOutput)) throw err
    const repair = await ai.generate({
      ...input,
      json: true,
      image: undefined,
      audio: undefined,
      messages: [
        ...input.messages,
        { role: 'assistant', content: first.slice(0, 4000) },
        {
          role: 'user',
          content: `Your answer was invalid: ${err.message} Reply again with one valid JSON object only.`,
        },
      ],
    })
    try {
      return validate(parseJsonText(repair))
    } catch (err2) {
      if (err2 instanceof InvalidOutput) throw new AiError('bad_response', err2.message)
      throw err2
    }
  }
}

// ---------- tiny validation helpers (no zod in the Edge bundle) ----------
export const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)

export function str(v: unknown, max: number, opts: { required?: string; fallback?: string } = {}): string {
  const s = typeof v === 'string' ? v.trim() : typeof v === 'number' ? String(v) : ''
  if (!s && opts.required) throw new InvalidOutput(`Field "${opts.required}" must be a non-empty string.`)
  return (s || opts.fallback || '').slice(0, max)
}

export function strList(v: unknown, maxItems: number, maxLen: number): string[] {
  return (
    (Array.isArray(v) ? v : [])
      // Models sometimes send { "time": …, "reason": … } instead of a string: flatten it rather than dropping it.
      .map((x) =>
        isObj(x)
          ? Object.values(x)
              .filter((y) => typeof y === 'string' || typeof y === 'number')
              .join(' – ')
          : x,
      )
      .map((x) => (typeof x === 'string' ? x.trim().slice(0, maxLen) : ''))
      .filter(Boolean)
      .slice(0, maxItems)
  )
}

export function objList(v: unknown, maxItems: number): Record<string, unknown>[] {
  return (Array.isArray(v) ? v : []).filter(isObj).slice(0, maxItems)
}
