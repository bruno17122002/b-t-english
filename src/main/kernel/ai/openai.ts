// OpenAI adapter (REST): chat completions, audio transcriptions and speech.
import type { ModelInfo } from '@shared/types'
import { httpRequest } from './http'
import {
  AiError,
  type AiProvider,
  type GenerateRequest,
  type GenerateResult,
  type SynthesizeRequest,
  type SynthesizeResult,
  type TranscribeRequest,
} from './types'

const BASE = 'https://api.openai.com/v1'
export const OPENAI_DEFAULT_MODEL = 'gpt-4.1-mini'
export const OPENAI_STT_MODEL = 'gpt-4o-mini-transcribe'
export const OPENAI_TTS_MODEL = 'gpt-4o-mini-tts'
export const OPENAI_VOICES = ['alloy', 'nova', 'shimmer', 'echo', 'onyx', 'fable', 'coral', 'sage'] as const

/** Reasoning models only accept the default temperature. */
const fixedTemperature = (model: string) => /^(o\d|gpt-5)/.test(model)

export class OpenAIProvider implements AiProvider {
  readonly id = 'openai' as const
  readonly capabilities = { json: true, transcribe: true, synthesize: true, audioInput: false }

  constructor(
    private readonly apiKey: string,
    readonly model: string = OPENAI_DEFAULT_MODEL,
    private readonly fetchImpl?: typeof fetch,
  ) {}

  private auth() {
    return { authorization: `Bearer ${this.apiKey}` }
  }

  async generate(req: GenerateRequest): Promise<GenerateResult> {
    if (req.audio) throw new AiError('unsupported', 'Audio input is handled through transcription for OpenAI')
    const body: Record<string, unknown> = {
      model: this.model,
      messages: [{ role: 'system', content: req.system }, ...req.messages],
      max_completion_tokens: req.maxOutputTokens ?? 4096,
    }
    if (!fixedTemperature(this.model)) body.temperature = req.temperature ?? 0.7
    if (req.json) body.response_format = { type: 'json_object' }
    const res = await httpRequest(`${BASE}/chat/completions`, {
      headers: { ...this.auth(), 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: req.signal,
      fetchImpl: this.fetchImpl,
    })
    const data = (await res.json()) as {
      choices?: { message?: { content?: string | null; refusal?: string | null }; finish_reason?: string }[]
    }
    const choice = data.choices?.[0]
    if (choice?.finish_reason === 'content_filter' || choice?.message?.refusal) throw new AiError('safety_blocked')
    const text = choice?.message?.content ?? ''
    if (!text.trim()) throw new AiError('bad_response', 'OpenAI returned an empty answer')
    return { text, model: this.model, provider: 'openai' }
  }

  async transcribe(req: TranscribeRequest): Promise<string> {
    const form = new FormData()
    const ext = req.mimeType.includes('wav') ? 'wav' : req.mimeType.includes('mp3') ? 'mp3' : 'webm'
    form.append('file', new Blob([Buffer.from(req.audio)], { type: req.mimeType }), `speech.${ext}`)
    form.append('model', OPENAI_STT_MODEL)
    form.append('language', 'en')
    form.append('response_format', 'json')
    if (req.hint) form.append('prompt', req.hint.slice(0, 500))
    const res = await httpRequest(`${BASE}/audio/transcriptions`, {
      headers: this.auth(),
      body: form,
      signal: req.signal,
      timeoutMs: 90_000,
      fetchImpl: this.fetchImpl,
    })
    const data = (await res.json()) as { text?: string }
    return (data.text ?? '').trim()
  }

  async synthesize(req: SynthesizeRequest): Promise<SynthesizeResult> {
    const voice = req.voice && (OPENAI_VOICES as readonly string[]).includes(req.voice) ? req.voice : 'alloy'
    const res = await httpRequest(`${BASE}/audio/speech`, {
      headers: { ...this.auth(), 'content-type': 'application/json' },
      body: JSON.stringify({
        model: OPENAI_TTS_MODEL,
        voice,
        input: req.text.slice(0, 4000),
        response_format: 'mp3',
        speed: Math.min(1.5, Math.max(0.5, req.speed ?? 1)),
      }),
      signal: req.signal,
      timeoutMs: 90_000,
      fetchImpl: this.fetchImpl,
    })
    return { audio: new Uint8Array(await res.arrayBuffer()), mimeType: 'audio/mpeg' }
  }

  async listModels(signal?: AbortSignal): Promise<ModelInfo[]> {
    const res = await httpRequest(`${BASE}/models`, {
      method: 'GET',
      headers: this.auth(),
      signal,
      timeoutMs: 20_000,
      retries: 1,
      fetchImpl: this.fetchImpl,
    })
    const data = (await res.json()) as { data?: { id: string }[] }
    return (data.data ?? [])
      .map((m) => m.id)
      .filter((id) => /^(gpt-|o\d|chatgpt)/.test(id))
      .filter((id) => !/audio|realtime|transcribe|tts|image|search|instruct|embedding|codex/.test(id))
      .sort()
      .map((id) => ({ id, label: id }))
  }
}
