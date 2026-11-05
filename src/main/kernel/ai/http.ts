// Shared HTTP helper for AI vendors: timeout, retry with back-off on 429/5xx (honours Retry-After)
// and mapping of vendor errors to AiErrorCode. Never includes request headers in errors or logs.
import { AiError, type AiErrorCode } from './types'

export interface HttpOptions {
  method?: 'GET' | 'POST'
  headers?: Record<string, string>
  body?: string | FormData
  timeoutMs?: number
  retries?: number
  signal?: AbortSignal
  fetchImpl?: typeof fetch
}

const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const t = setTimeout(resolve, ms)
    signal?.addEventListener('abort', () => {
      clearTimeout(t)
      reject(new AiError('cancelled'))
    })
  })

export function classifyHttpError(status: number, bodyText: string): AiErrorCode {
  const body = bodyText.toLowerCase()
  if (status === 401 || status === 403) return 'invalid_key'
  if (body.includes('api_key_invalid') || body.includes('api key not valid') || body.includes('invalid api key'))
    return 'invalid_key'
  if (status === 429) {
    return body.includes('insufficient_quota') || body.includes('exceeded your current quota') || body.includes('billing')
      ? 'quota'
      : 'rate_limited'
  }
  if (status === 404) return 'model_not_found'
  if (status === 400 && (body.includes('model') && (body.includes('not found') || body.includes('does not exist'))))
    return 'model_not_found'
  if (status >= 500) return 'server_error'
  return 'bad_response'
}

function retryAfterMs(res: Response): number | undefined {
  const h = res.headers.get('retry-after')
  if (!h) return undefined
  const secs = Number(h)
  if (Number.isFinite(secs)) return secs * 1000
  const date = Date.parse(h)
  return Number.isFinite(date) ? Math.max(0, date - Date.now()) : undefined
}

/** Extracts a short, key-free message from a vendor error body. */
export function vendorMessage(bodyText: string): string {
  try {
    const parsed = JSON.parse(bodyText) as { error?: { message?: string } | string }
    const msg = typeof parsed.error === 'string' ? parsed.error : parsed.error?.message
    if (msg) return redactSecrets(msg).slice(0, 300)
  } catch {
    /* not JSON */
  }
  return redactSecrets(bodyText).slice(0, 200)
}

const SECRET_PATTERNS = [/AIza[0-9A-Za-z_-]{20,}/g, /sk-[A-Za-z0-9_-]{16,}/g, /Bearer\s+[A-Za-z0-9._-]{10,}/gi]

export function redactSecrets(text: string): string {
  return SECRET_PATTERNS.reduce((s, re) => s.replace(re, '[redacted]'), text)
}

export async function httpRequest(url: string, opts: HttpOptions = {}): Promise<Response> {
  const retries = opts.retries ?? 2
  const doFetch = opts.fetchImpl ?? fetch
  for (let attempt = 0; ; attempt++) {
    if (opts.signal?.aborted) throw new AiError('cancelled')
    const controller = new AbortController()
    const onAbort = () => controller.abort()
    opts.signal?.addEventListener('abort', onAbort)
    const timer = setTimeout(() => controller.abort(new Error('timeout')), opts.timeoutMs ?? 60_000)
    let res: Response
    try {
      res = await doFetch(url, {
        method: opts.method ?? 'POST',
        headers: opts.headers,
        body: opts.body,
        signal: controller.signal,
      })
    } catch (err) {
      if (opts.signal?.aborted) throw new AiError('cancelled')
      const timedOut = controller.signal.aborted
      if (attempt < retries && !timedOut) {
        await sleep(600 * 2 ** attempt, opts.signal)
        continue
      }
      throw new AiError(timedOut ? 'timeout' : 'network', undefined, undefined)
    } finally {
      clearTimeout(timer)
      opts.signal?.removeEventListener('abort', onAbort)
    }
    if (res.ok) return res
    const bodyText = await res.text().catch(() => '')
    const code = classifyHttpError(res.status, bodyText)
    const wait = retryAfterMs(res)
    if ((code === 'rate_limited' || code === 'server_error') && attempt < retries) {
      await sleep(Math.min(wait ?? 800 * 2 ** attempt, 8_000), opts.signal)
      continue
    }
    const err = new AiError(code, undefined, res.status, wait)
    ;(err as AiError & { detail?: string }).detail = vendorMessage(bodyText)
    throw err
  }
}

/** Removes ```json fences and leading prose so JSON.parse has a chance. */
export function extractJson(text: string): unknown {
  const trimmed = text.trim()
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(trimmed)
  const candidate = fenced?.[1]?.trim() ?? trimmed
  try {
    return JSON.parse(candidate)
  } catch {
    const start = candidate.search(/[[{]/)
    const end = Math.max(candidate.lastIndexOf('}'), candidate.lastIndexOf(']'))
    if (start >= 0 && end > start) return JSON.parse(candidate.slice(start, end + 1))
    throw new AiError('bad_response', 'AI response was not valid JSON')
  }
}
