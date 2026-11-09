// Google Gemini adapter (Generative Language REST API v1beta). The key travels only in the
// x-goog-api-key header, never in the URL, so it cannot leak through logged URLs.
import type { ModelInfo } from '@shared/types'
import { httpRequest } from './http'
import {
  AiError,
  type AiProvider,
  type GenerateRequest,
  type GenerateResult,
  type ImageRequest,
  type ImageResult,
  type SynthesizeRequest,
  type SynthesizeResult,
  type TranscribeRequest,
} from './types'
import { pcmToWav } from './wav'

const BASE = 'https://generativelanguage.googleapis.com/v1beta'
export const GEMINI_DEFAULT_MODEL = 'gemini-2.5-flash'
export const GEMINI_TTS_MODEL = 'gemini-2.5-flash-preview-tts'

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
export const GEMINI_VOICES = ['Kore', 'Puck', 'Charon', 'Aoede', 'Fenrir', 'Leda'] as const

interface GeminiPart {
  text?: string
  inlineData?: { mimeType: string; data: string }
  thought?: boolean
}
interface GeminiResponse {
  candidates?: { content?: { parts?: GeminiPart[] }; finishReason?: string }[]
  promptFeedback?: { blockReason?: string }
}

const toBase64 = (bytes: Uint8Array) => Buffer.from(bytes).toString('base64')

export class GeminiProvider implements AiProvider {
  readonly id = 'gemini' as const
  readonly capabilities = { json: true, transcribe: true, synthesize: true, audioInput: true }

  constructor(
    private readonly apiKey: string,
    readonly model: string = GEMINI_DEFAULT_MODEL,
    private readonly fetchImpl?: typeof fetch,
  ) {}

  private headers() {
    return { 'content-type': 'application/json', 'x-goog-api-key': this.apiKey }
  }

  private async call(model: string, body: unknown, signal?: AbortSignal, timeoutMs = 60_000): Promise<GeminiResponse> {
    const res = await httpRequest(`${BASE}/models/${encodeURIComponent(model)}:generateContent`, {
      headers: this.headers(),
      body: JSON.stringify(body),
      signal,
      timeoutMs,
      fetchImpl: this.fetchImpl,
    })
    const data = (await res.json()) as GeminiResponse
    if (data.promptFeedback?.blockReason) throw new AiError('safety_blocked')
    const cand = data.candidates?.[0]
    if (!cand) throw new AiError('bad_response', 'Gemini returned no candidates')
    if (cand.finishReason === 'SAFETY' || cand.finishReason === 'PROHIBITED_CONTENT')
      throw new AiError('safety_blocked')
    return data
  }

  async generate(req: GenerateRequest): Promise<GenerateResult> {
    const contents = req.messages.map((m, i) => {
      const parts: GeminiPart[] = [{ text: m.content }]
      if (req.audio && i === req.messages.length - 1) {
        parts.push({ inlineData: { mimeType: req.audio.mimeType, data: toBase64(req.audio.data) } })
      }
      if (req.image && i === req.messages.length - 1) {
        parts.push({ inlineData: { mimeType: req.image.mimeType, data: toBase64(req.image.data) } })
      }
      return { role: m.role === 'assistant' ? 'model' : 'user', parts }
    })
    const data = await this.call(
      this.model,
      {
        systemInstruction: { parts: [{ text: req.system }] },
        contents,
        generationConfig: {
          temperature: req.temperature ?? 0.7,
          ...outputConfigFor(this.model, req.maxOutputTokens ?? 4096),
          ...(req.json ? { responseMimeType: 'application/json' } : {}),
        },
      },
      req.signal,
    )
    const text = (data.candidates?.[0]?.content?.parts ?? []).map((p) => p.text ?? '').join('')
    if (!text.trim()) throw new AiError('bad_response', 'Gemini returned an empty answer')
    if (req.json && data.candidates?.[0]?.finishReason === 'MAX_TOKENS')
      throw new AiError('bad_response', 'Gemini stopped at the output limit before the JSON was complete')
    return { text, model: this.model, provider: 'gemini' }
  }

  /** Image generation with a Gemini image model (e.g. gemini-2.5-flash-image). */
  async generateImage(req: ImageRequest): Promise<ImageResult> {
    const parts: GeminiPart[] = [{ text: req.prompt.slice(0, 4000) }]
    if (req.image) parts.unshift({ inlineData: { mimeType: req.image.mimeType, data: toBase64(req.image.data) } })
    const data = await this.call(
      req.model,
      { contents: [{ role: 'user', parts }], generationConfig: { responseModalities: ['TEXT', 'IMAGE'] } },
      req.signal,
      120_000,
    )
    const out = (data.candidates?.[0]?.content?.parts ?? []).filter((p) => !p.thought)
    const img = out.find((p) => p.inlineData?.data && p.inlineData.mimeType.startsWith('image/'))
    if (!img?.inlineData) throw new AiError('bad_response', 'Gemini returned no image')
    return {
      image: new Uint8Array(Buffer.from(img.inlineData.data, 'base64')),
      mimeType: img.inlineData.mimeType,
      text: out
        .map((p) => p.text ?? '')
        .join('')
        .trim(),
    }
  }

  async transcribe(req: TranscribeRequest): Promise<string> {
    const instruction =
      'Transcribe this English speech by a Vietnamese learner exactly as spoken (keep their mistakes, do not correct grammar). ' +
      'Return only the transcript text, no quotes or commentary.' +
      (req.hint
        ? ` The learner was trying to say: "${req.hint.slice(0, 500)}". Use it only to resolve unclear sounds.`
        : '')
    const data = await this.call(
      this.model,
      {
        contents: [
          {
            role: 'user',
            parts: [{ text: instruction }, { inlineData: { mimeType: req.mimeType, data: toBase64(req.audio) } }],
          },
        ],
        generationConfig: { temperature: 0 },
      },
      req.signal,
    )
    return (data.candidates?.[0]?.content?.parts ?? [])
      .map((p) => p.text ?? '')
      .join('')
      .trim()
  }

  async synthesize(req: SynthesizeRequest): Promise<SynthesizeResult> {
    const voice = req.voice && (GEMINI_VOICES as readonly string[]).includes(req.voice) ? req.voice : 'Kore'
    const pace = req.speed && req.speed < 0.9 ? 'Say slowly and clearly: ' : 'Say clearly: '
    const data = await this.call(
      GEMINI_TTS_MODEL,
      {
        contents: [{ role: 'user', parts: [{ text: pace + req.text.slice(0, 4000) }] }],
        generationConfig: {
          responseModalities: ['AUDIO'],
          speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } } },
        },
      },
      req.signal,
      90_000,
    )
    const part = data.candidates?.[0]?.content?.parts?.find((p) => p.inlineData?.data)
    if (!part?.inlineData) throw new AiError('bad_response', 'Gemini TTS returned no audio')
    const pcm = Buffer.from(part.inlineData.data, 'base64')
    const rate = Number(/rate=(\d+)/.exec(part.inlineData.mimeType)?.[1] ?? 24000)
    return { audio: pcmToWav(pcm, rate, 1, 16), mimeType: 'audio/wav' }
  }

  async listModels(signal?: AbortSignal): Promise<ModelInfo[]> {
    const res = await httpRequest(`${BASE}/models?pageSize=200`, {
      method: 'GET',
      headers: this.headers(),
      signal,
      timeoutMs: 20_000,
      retries: 1,
      fetchImpl: this.fetchImpl,
    })
    const data = (await res.json()) as {
      models?: { name: string; displayName?: string; supportedGenerationMethods?: string[] }[]
    }
    return (data.models ?? [])
      .filter((m) => m.supportedGenerationMethods?.includes('generateContent') && m.name.includes('gemini'))
      .filter((m) => !/tts|embedding|image|live|native-audio/i.test(m.name))
      .map((m) => ({ id: m.name.replace(/^models\//, ''), label: m.displayName ?? m.name, supportsAudio: true }))
      .sort((a, b) => a.id.localeCompare(b.id))
  }
}
