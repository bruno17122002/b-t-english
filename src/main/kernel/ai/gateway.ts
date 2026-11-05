// AI Gateway: the only way modules reach an AI vendor. Chooses the provider, injects learner context
// and CEFR constraints, validates JSON output with zod (one repair round), and maps errors.
import type { Cefr } from '@shared/content'
import type {
  AiConfigView,
  ConnectionTestResult,
  ModelInfo,
  ProviderId,
  ResponseLanguage,
  TutorStyle,
  UserProviderId,
} from '@shared/types'
import { USER_PROVIDERS } from '@shared/types'
import type { AppDatabase } from '../../db/database'
import type { KeyStore } from '../secure/keyStore'
import { cefrConstraintBlock, languageInstruction } from './cefrConstraints'
import { GEMINI_DEFAULT_MODEL, GeminiProvider } from './gemini'
import { extractJson } from './http'
import { MockProvider } from './mock'
import { OPENAI_DEFAULT_MODEL, OpenAIProvider } from './openai'
import type { LearnerSummary, PromptContext, PromptSpec } from './prompt'
import { AiError, type AiProvider, type ImageResult, type SynthesizeResult } from './types'

interface AiSettingsRow {
  default_provider: UserProviderId | null
  gemini_model: string
  openai_model: string
  response_language: ResponseLanguage
  tutor_style: TutorStyle
  stt_provider: UserProviderId | 'auto'
}

export interface AiGatewayDeps {
  db: AppDatabase
  keys: KeyStore
  /** True only for E2E runs (LQ_E2E=1): all calls are answered by deterministic mocks. */
  mock: boolean
  learner: () => LearnerSummary
  log?: (level: 'info' | 'warn' | 'error', msg: string) => void
  fetchImpl?: typeof fetch
}

export interface RunOptions {
  provider?: UserProviderId
  signal?: AbortSignal
  /** Overrides the CEFR level used for constraints (e.g. content generated for a chosen level). */
  level?: Cefr
}

export interface RunResult<O> {
  data: O
  provider: ProviderId
  model: string
}

export class AiGateway {
  constructor(private readonly deps: AiGatewayDeps) {}

  // ---------- configuration ----------
  private settings(): AiSettingsRow {
    const row = this.deps.db.get<AiSettingsRow>('SELECT * FROM ai_settings WHERE id = 1')
    if (row) return row
    this.deps.db.run(
      `INSERT INTO ai_settings(id, default_provider, gemini_model, openai_model, response_language, tutor_style, stt_provider, updated_at)
       VALUES (1, NULL, ?, ?, 'mixed', 'friendly', 'auto', ?)`,
      [GEMINI_DEFAULT_MODEL, OPENAI_DEFAULT_MODEL, new Date().toISOString()],
    )
    return this.settings()
  }

  getConfig(): AiConfigView {
    const s = this.settings()
    const providers = {} as AiConfigView['providers']
    for (const p of USER_PROVIDERS) {
      providers[p] = {
        hasKey: this.deps.keys.has(p),
        keyHint: this.deps.keys.hint(p),
        model: p === 'gemini' ? s.gemini_model : s.openai_model,
      }
    }
    return {
      defaultProvider: s.default_provider,
      activeProvider: this.activeProviderId(),
      providers,
      responseLanguage: s.response_language,
      tutorStyle: s.tutor_style,
      sttProvider: s.stt_provider,
      encryptionAvailable: this.deps.keys.encryptionAvailable,
      mockMode: this.deps.mock,
    }
  }

  updateConfig(patch: {
    defaultProvider?: UserProviderId | null
    geminiModel?: string
    openaiModel?: string
    responseLanguage?: ResponseLanguage
    tutorStyle?: TutorStyle
    sttProvider?: UserProviderId | 'auto'
  }): AiConfigView {
    const s = this.settings()
    const next = {
      default_provider: patch.defaultProvider !== undefined ? patch.defaultProvider : s.default_provider,
      gemini_model: patch.geminiModel?.trim() || s.gemini_model,
      openai_model: patch.openaiModel?.trim() || s.openai_model,
      response_language: patch.responseLanguage ?? s.response_language,
      tutor_style: patch.tutorStyle ?? s.tutor_style,
      stt_provider: patch.sttProvider ?? s.stt_provider,
    }
    this.deps.db.run(
      `UPDATE ai_settings SET default_provider = ?, gemini_model = ?, openai_model = ?, response_language = ?,
       tutor_style = ?, stt_provider = ?, updated_at = ? WHERE id = 1`,
      [
        next.default_provider,
        next.gemini_model,
        next.openai_model,
        next.response_language,
        next.tutor_style,
        next.stt_provider,
        new Date().toISOString(),
      ],
    )
    return this.getConfig()
  }

  setKey(provider: UserProviderId, key: string): { persisted: boolean } {
    const res = this.deps.keys.set(provider, key)
    const s = this.settings()
    if (!s.default_provider) this.updateConfig({ defaultProvider: provider })
    this.deps.log?.('info', `API key saved for ${provider} (persisted=${res.persisted})`)
    return res
  }

  removeKey(provider: UserProviderId): void {
    this.deps.keys.remove(provider)
    const s = this.settings()
    if (s.default_provider === provider) {
      const other = USER_PROVIDERS.find((p) => p !== provider && this.deps.keys.has(p)) ?? null
      this.updateConfig({ defaultProvider: other })
    }
    this.deps.log?.('info', `API key removed for ${provider}`)
  }

  /** Provider that will answer requests right now, or null when no key is configured. */
  activeProviderId(): ProviderId | null {
    if (this.deps.mock) return 'mock'
    const s = this.settings()
    if (s.default_provider && this.deps.keys.has(s.default_provider)) return s.default_provider
    return USER_PROVIDERS.find((p) => this.deps.keys.has(p)) ?? null
  }

  isAvailable(): boolean {
    return this.activeProviderId() !== null
  }

  provider(id?: UserProviderId): AiProvider {
    if (this.deps.mock) return new MockProvider()
    const chosen = id ?? this.activeProviderId()
    if (!chosen || chosen === 'mock') throw new AiError('no_key')
    const key = this.deps.keys.get(chosen)
    if (!key) throw new AiError('no_key')
    const s = this.settings()
    return chosen === 'gemini'
      ? new GeminiProvider(key, s.gemini_model, this.deps.fetchImpl)
      : new OpenAIProvider(key, s.openai_model, this.deps.fetchImpl)
  }

  async testConnection(provider: UserProviderId): Promise<ConnectionTestResult> {
    const started = Date.now()
    let model = ''
    try {
      const p = this.provider(provider)
      model = p.model
      const res = await p.generate({
        system: 'You are a connectivity check.',
        messages: [{ role: 'user', content: 'Reply with the single word: OK' }],
        maxOutputTokens: 64,
        temperature: 0,
      })
      return { ok: true, latencyMs: Date.now() - started, model, message: res.text.trim().slice(0, 60) }
    } catch (err) {
      const e = toAiError(err)
      return { ok: false, latencyMs: Date.now() - started, model, message: e.userMessage, errorCode: e.code }
    }
  }

  async listModels(provider: UserProviderId): Promise<ModelInfo[]> {
    return this.provider(provider).listModels()
  }

  // ---------- prompts ----------
  context(level?: Cefr, skill?: string): PromptContext {
    const learner = this.deps.learner()
    const s = this.settings()
    const skillLevel = skill ? learner.skills.find((k) => k.skill === skill)?.cefr : undefined
    const eff = level ?? skillLevel ?? learner.overallCefr
    const interests = learner.interests.length ? ` Interests: ${learner.interests.slice(0, 6).join(', ')}.` : ''
    const purposes = learner.purposes.length ? ` Goals: ${learner.purposes.slice(0, 4).join(', ')}.` : ''
    return {
      learner,
      level: eff,
      responseLanguage: s.response_language,
      tutorStyle: s.tutor_style,
      constraints: cefrConstraintBlock(eff),
      languageInstruction: languageInstruction(s.response_language, eff),
      learnerLine: `The learner is Vietnamese, overall CEFR ${learner.overallCefr}, aiming for ${learner.targetCefr} (≈ IELTS 6.5).${interests}${purposes}`,
    }
  }

  async run<I, O>(spec: PromptSpec<I, O>, input: I, opts: RunOptions = {}): Promise<RunResult<O>> {
    const ctx = this.context(opts.level, spec.skill)
    if (this.deps.mock) {
      return { data: spec.mock(input, ctx) as O, provider: 'mock', model: 'mock-1' }
    }
    const provider = this.provider(opts.provider)
    const built = spec.build(input, ctx)
    const started = Date.now()
    try {
      if (spec.kind === 'text') {
        const res = await provider.generate({
          ...built,
          temperature: spec.temperature,
          maxOutputTokens: spec.maxOutputTokens,
          signal: opts.signal,
        })
        return { data: res.text.trim() as O, provider: provider.id, model: provider.model }
      }
      let messages = built.messages
      for (let attempt = 0; attempt < 2; attempt++) {
        const res = await provider.generate({
          system: built.system,
          messages,
          audio: built.audio,
          image: built.image,
          json: true,
          temperature: spec.temperature ?? 0.4,
          maxOutputTokens: spec.maxOutputTokens,
          signal: opts.signal,
        })
        let problem: string
        try {
          const parsed = spec.schema.safeParse(extractJson(res.text))
          if (parsed.success) {
            const issue = spec.check?.(input, parsed.data) ?? null
            if (!issue) {
              this.deps.log?.(
                'info',
                `ai ${spec.id}@v${spec.version} ok via ${provider.id} in ${Date.now() - started}ms`,
              )
              return { data: parsed.data, provider: provider.id, model: provider.model }
            }
            problem = issue
          } else {
            problem = parsed.error.issues
              .slice(0, 6)
              .map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`)
              .join('; ')
          }
        } catch {
          problem = 'The answer was not valid JSON.'
        }
        this.deps.log?.(
          'warn',
          `ai ${spec.id}@v${spec.version} attempt ${attempt + 1} rejected: ${problem.slice(0, 200)}`,
        )
        messages = [
          ...built.messages,
          { role: 'assistant', content: res.text.slice(0, 6000) },
          {
            role: 'user',
            content: `Your previous answer had problems: ${problem}\nReturn the corrected JSON object only.`,
          },
        ]
      }
      throw new AiError('bad_response')
    } catch (err) {
      const e = toAiError(err)
      this.deps.log?.('warn', `ai ${spec.id} failed via ${provider.id}: ${e.code}`)
      throw e
    }
  }

  // ---------- audio ----------
  sttProviderId(): UserProviderId | 'mock' | null {
    if (this.deps.mock) return 'mock'
    const s = this.settings()
    if (s.stt_provider !== 'auto') return this.deps.keys.has(s.stt_provider) ? s.stt_provider : null
    if (this.deps.keys.has('openai')) return 'openai'
    if (this.deps.keys.has('gemini')) return 'gemini'
    return null
  }

  async transcribe(
    audio: Uint8Array,
    mimeType: string,
    hint?: string,
  ): Promise<{ text: string; provider: ProviderId }> {
    const id = this.sttProviderId()
    if (!id) throw new AiError('no_key')
    const p = id === 'mock' ? new MockProvider() : this.provider(id)
    try {
      return { text: await p.transcribe({ audio, mimeType, hint }), provider: p.id }
    } catch (err) {
      throw toAiError(err)
    }
  }

  // ---------- images ----------
  /** Image generation (Gemini image models only). Mock mode returns a 1×1 PNG. */
  async generateImage(
    prompt: string,
    model: string,
    image?: { data: Uint8Array; mimeType: string },
    signal?: AbortSignal,
  ): Promise<ImageResult> {
    if (this.deps.mock) return { image: MOCK_PNG, mimeType: 'image/png', text: '' }
    const key = this.deps.keys.get('gemini')
    if (!key) throw new AiError('no_key')
    const p = new GeminiProvider(key, this.settings().gemini_model, this.deps.fetchImpl)
    try {
      const res = await p.generateImage({ prompt, model, image, signal })
      this.deps.log?.('info', `ai image ok via gemini (${model}, ${Math.round(res.image.byteLength / 1024)} KB)`)
      return res
    } catch (err) {
      const e = toAiError(err)
      this.deps.log?.('warn', `ai image failed via gemini (${model}): ${e.code}`)
      throw e
    }
  }

  async synthesize(engine: UserProviderId, text: string, voice?: string, speed?: number): Promise<SynthesizeResult> {
    const p = this.deps.mock ? new MockProvider() : this.provider(engine)
    try {
      return await p.synthesize({ text, voice, speed })
    } catch (err) {
      throw toAiError(err)
    }
  }
}

/** 1×1 transparent PNG used by mock image generation. */
const MOCK_PNG = new Uint8Array(
  Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
    'base64',
  ),
)

export function toAiError(err: unknown): AiError {
  if (err instanceof AiError) return err
  return new AiError('bad_response', err instanceof Error ? err.message : String(err))
}
