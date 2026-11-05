// AI provider abstraction. Providers only know how to talk to one vendor; prompts, validation and
// learner context live in the gateway so switching vendor never changes module code.
import type { ModelInfo, ProviderId } from '@shared/types'

export const AI_ERROR_CODES = [
  'no_key',
  'invalid_key',
  'rate_limited',
  'quota',
  'timeout',
  'network',
  'model_not_found',
  'safety_blocked',
  'bad_response',
  'server_error',
  'unsupported',
  'cancelled',
] as const
export type AiErrorCode = (typeof AI_ERROR_CODES)[number]

const MESSAGES_VI: Record<AiErrorCode, string> = {
  no_key: 'Chưa có API key. Vào Cài đặt AI để thêm key Gemini hoặc OpenAI.',
  invalid_key: 'API key không hợp lệ hoặc đã bị thu hồi. Kiểm tra lại key trong Cài đặt AI.',
  rate_limited: 'Nhà cung cấp AI đang giới hạn tốc độ. Thử lại sau ít giây.',
  quota: 'Tài khoản AI đã hết hạn mức (quota). Kiểm tra gói/thanh toán hoặc chuyển nhà cung cấp.',
  timeout: 'AI phản hồi quá lâu. Thử lại hoặc chọn model nhanh hơn.',
  network: 'Không kết nối được tới máy chủ AI. Kiểm tra Internet.',
  model_not_found: 'Model đã chọn không tồn tại hoặc không được phép dùng. Chọn model khác trong Cài đặt AI.',
  safety_blocked: 'Nội dung bị bộ lọc an toàn của nhà cung cấp chặn. Thử diễn đạt khác.',
  bad_response: 'AI trả về dữ liệu không đúng định dạng. Thử lại.',
  server_error: 'Máy chủ AI đang gặp lỗi. Thử lại sau.',
  unsupported: 'Nhà cung cấp hiện tại không hỗ trợ tính năng này.',
  cancelled: 'Đã hủy yêu cầu.',
}

export class AiError extends Error {
  constructor(
    readonly code: AiErrorCode,
    message?: string,
    readonly status?: number,
    readonly retryAfterMs?: number,
  ) {
    super(message ?? MESSAGES_VI[code])
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

export interface GenerateRequest {
  system: string
  messages: ChatMessage[]
  json?: boolean
  temperature?: number
  maxOutputTokens?: number
  /** Optional inline audio for multimodal models (WAV/MP3 bytes). */
  audio?: { data: Uint8Array; mimeType: string }
  signal?: AbortSignal
}

export interface GenerateResult {
  text: string
  model: string
  provider: ProviderId
}

export interface TranscribeRequest {
  audio: Uint8Array
  mimeType: string
  /** Text the learner was expected to say – improves recognition of learner speech. */
  hint?: string
  signal?: AbortSignal
}

export interface SynthesizeRequest {
  text: string
  voice?: string
  speed?: number
  signal?: AbortSignal
}

export interface SynthesizeResult {
  audio: Uint8Array
  mimeType: string
}

export interface ProviderCapabilities {
  json: boolean
  transcribe: boolean
  synthesize: boolean
  audioInput: boolean
}

export interface AiProvider {
  readonly id: ProviderId
  readonly model: string
  readonly capabilities: ProviderCapabilities
  generate(req: GenerateRequest): Promise<GenerateResult>
  transcribe(req: TranscribeRequest): Promise<string>
  synthesize(req: SynthesizeRequest): Promise<SynthesizeResult>
  listModels(signal?: AbortSignal): Promise<ModelInfo[]>
}
