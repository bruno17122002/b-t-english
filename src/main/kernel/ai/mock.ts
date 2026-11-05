// Deterministic offline provider. Enabled only when LQ_E2E=1 so end-to-end tests never need a key
// or the network. Prompt outputs come from each PromptSpec.mock; this class covers raw calls.
import type { ModelInfo } from '@shared/types'
import type { AiProvider, GenerateRequest, GenerateResult, SynthesizeResult, TranscribeRequest } from './types'
import { pcmToWav } from './wav'

export class MockProvider implements AiProvider {
  readonly id = 'mock' as const
  readonly model = 'mock-1'
  readonly capabilities = { json: true, transcribe: true, synthesize: true, audioInput: true }

  async generate(req: GenerateRequest): Promise<GenerateResult> {
    const last = req.messages[req.messages.length - 1]?.content ?? ''
    return { text: req.json ? '{"ok":true}' : `OK: ${last.slice(0, 80)}`, model: this.model, provider: 'mock' }
  }

  async transcribe(req: TranscribeRequest): Promise<string> {
    return req.hint?.trim() || 'I like learning English every day.'
  }

  async synthesize(): Promise<SynthesizeResult> {
    // 0.3 s of silence at 24 kHz.
    return { audio: pcmToWav(new Uint8Array(24000 * 0.3 * 2), 24000, 1, 16), mimeType: 'audio/wav' }
  }

  async listModels(): Promise<ModelInfo[]> {
    return [{ id: this.model, label: 'Mock model' }]
  }
}
