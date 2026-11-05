import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { cefrConstraintBlock, languageInstruction } from '../../src/main/kernel/ai/cefrConstraints'
import { GeminiProvider } from '../../src/main/kernel/ai/gemini'
import { classifyHttpError, extractJson, httpRequest, redactSecrets } from '../../src/main/kernel/ai/http'
import { OpenAIProvider } from '../../src/main/kernel/ai/openai'
import { jsonPrompt, leaksAnswer, textPrompt } from '../../src/main/kernel/ai/prompt'
import { AiError } from '../../src/main/kernel/ai/types'
import { pcmToWav } from '../../src/main/kernel/ai/wav'
import { makeKernel } from '../helpers/kernel'

type Call = { url: string; init: RequestInit }
function fakeFetch(responses: (Response | Error)[]) {
  const calls: Call[] = []
  const impl = (async (url: string, init: RequestInit) => {
    calls.push({ url, init })
    const next = responses.shift()
    if (!next) throw new Error('no more responses')
    if (next instanceof Error) throw next
    return next
  }) as unknown as typeof fetch
  return { impl, calls }
}
const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } })
const gemini = (text: string) => json({ candidates: [{ content: { parts: [{ text }] }, finishReason: 'STOP' }] })
const GEMINI_KEY = 'AIzaSyFAKEKEY_abcdefghijklmnopqrstuv'
const OPENAI_KEY = 'sk-proj-FAKEKEY1234567890abcdefgh'

describe('HTTP helpers', () => {
  it('classifies vendor errors', () => {
    expect(classifyHttpError(401, '')).toBe('invalid_key')
    expect(classifyHttpError(400, '{"error":{"message":"API key not valid. Please pass a valid API key."}}')).toBe(
      'invalid_key',
    )
    expect(classifyHttpError(429, '{"error":{"code":"insufficient_quota"}}')).toBe('quota')
    expect(classifyHttpError(429, 'slow down')).toBe('rate_limited')
    expect(classifyHttpError(404, '')).toBe('model_not_found')
    expect(classifyHttpError(503, '')).toBe('server_error')
  })

  it('redacts API keys and bearer tokens', () => {
    const s = redactSecrets(`key=${GEMINI_KEY} auth=Bearer ${OPENAI_KEY} other=${OPENAI_KEY}`)
    expect(s).not.toContain(GEMINI_KEY)
    expect(s).not.toContain(OPENAI_KEY)
    expect(s).toContain('[redacted]')
  })

  it('extracts JSON from fenced or chatty answers', () => {
    expect(extractJson('```json\n{"a":1}\n```')).toEqual({ a: 1 })
    expect(extractJson('Sure! Here it is: {"b":[1,2]} Hope it helps')).toEqual({ b: [1, 2] })
    expect(() => extractJson('no json here')).toThrow(AiError)
  })

  it('retries 429/5xx with back-off and honours Retry-After', async () => {
    const f = fakeFetch([json({}, 503), json({}, 429, { 'retry-after': '0' }), json({ ok: true })])
    const res = await httpRequest('https://x.test', { fetchImpl: f.impl, retries: 2 })
    expect(res.ok).toBe(true)
    expect(f.calls).toHaveLength(3)
  })

  it('maps network failures and does not retry invalid keys', async () => {
    const net = fakeFetch([new TypeError('fetch failed'), new TypeError('fetch failed')])
    await expect(httpRequest('https://x.test', { fetchImpl: net.impl, retries: 1 })).rejects.toMatchObject({
      code: 'network',
    })
    const bad = fakeFetch([json({ error: { message: 'bad key' } }, 401)])
    await expect(httpRequest('https://x.test', { fetchImpl: bad.impl })).rejects.toMatchObject({ code: 'invalid_key' })
    expect(bad.calls).toHaveLength(1)
  })
})

describe('providers', () => {
  it('Gemini sends the key only in a header and parses text', async () => {
    const f = fakeFetch([gemini('Hello!')])
    const p = new GeminiProvider(GEMINI_KEY, 'gemini-2.5-flash', f.impl)
    const res = await p.generate({ system: 'sys', messages: [{ role: 'user', content: 'hi' }], json: true })
    expect(res.text).toBe('Hello!')
    const call = f.calls[0] as Call
    expect(call.url).not.toContain(GEMINI_KEY)
    expect((call.init.headers as Record<string, string>)['x-goog-api-key']).toBe(GEMINI_KEY)
    const body = JSON.parse(String(call.init.body)) as {
      generationConfig: { responseMimeType?: string }
      systemInstruction: unknown
    }
    expect(body.generationConfig.responseMimeType).toBe('application/json')
    expect(body.systemInstruction).toEqual({ parts: [{ text: 'sys' }] })
  })

  it('Gemini reports safety blocks', async () => {
    const f = fakeFetch([json({ promptFeedback: { blockReason: 'SAFETY' } })])
    await expect(
      new GeminiProvider(GEMINI_KEY, 'm', f.impl).generate({ system: '', messages: [{ role: 'user', content: 'x' }] }),
    ).rejects.toMatchObject({ code: 'safety_blocked' })
  })

  it('Gemini TTS wraps PCM into a WAV file', async () => {
    const pcm = Buffer.alloc(480).toString('base64')
    const f = fakeFetch([
      json({
        candidates: [
          { content: { parts: [{ inlineData: { mimeType: 'audio/L16;codec=pcm;rate=24000', data: pcm } }] } },
        ],
      }),
    ])
    const res = await new GeminiProvider(GEMINI_KEY, 'm', f.impl).synthesize({ text: 'Hello' })
    expect(res.mimeType).toBe('audio/wav')
    expect(Buffer.from(res.audio).subarray(0, 4).toString()).toBe('RIFF')
    expect(res.audio.length).toBe(44 + 480)
  })

  it('OpenAI uses a bearer header, omits temperature for reasoning models and asks for JSON', async () => {
    const f = fakeFetch([json({ choices: [{ message: { content: '{"x":1}' }, finish_reason: 'stop' }] })])
    const p = new OpenAIProvider(OPENAI_KEY, 'gpt-5-mini', f.impl)
    await p.generate({ system: 's', messages: [{ role: 'user', content: 'u' }], json: true, temperature: 0.2 })
    const call = f.calls[0] as Call
    expect((call.init.headers as Record<string, string>).authorization).toBe(`Bearer ${OPENAI_KEY}`)
    const body = JSON.parse(String(call.init.body)) as Record<string, unknown>
    expect(body.temperature).toBeUndefined()
    expect(body.response_format).toEqual({ type: 'json_object' })
    expect(body.messages).toEqual([
      { role: 'system', content: 's' },
      { role: 'user', content: 'u' },
    ])
  })

  it('OpenAI lists only chat models', async () => {
    const f = fakeFetch([
      json({
        data: [
          { id: 'gpt-4.1-mini' },
          { id: 'whisper-1' },
          { id: 'gpt-4o-mini-tts' },
          { id: 'text-embedding-3-small' },
          { id: 'o4-mini' },
        ],
      }),
    ])
    const models = await new OpenAIProvider(OPENAI_KEY, 'gpt-4.1-mini', f.impl).listModels()
    expect(models.map((m) => m.id)).toEqual(['gpt-4.1-mini', 'o4-mini'])
  })
})

describe('AI gateway', () => {
  const Schema = z.object({ answer: z.string(), score: z.number().min(0).max(10) })
  const prompt = jsonPrompt<{ q: string }, z.infer<typeof Schema>>({
    id: 'test.prompt',
    version: 1,
    schema: Schema,
    build: (input, ctx) => ({
      system: `${ctx.constraints}\n${ctx.languageInstruction}`,
      messages: [{ role: 'user', content: input.q }],
    }),
    check: (_input, out) => (leaksAnswer(out.answer, 'secret') ? 'leaked' : null),
    mock: () => ({ answer: 'mock', score: 5 }),
  })

  it('returns no_key when no provider is configured', async () => {
    const { kernel } = await makeKernel({ mockAi: false })
    expect(kernel.ai.isAvailable()).toBe(false)
    await expect(kernel.ai.run(prompt, { q: 'x' })).rejects.toMatchObject({ code: 'no_key' })
  })

  it('uses deterministic mocks in E2E mode', async () => {
    const { kernel } = await makeKernel({ mockAi: true })
    const res = await kernel.ai.run(prompt, { q: 'x' })
    expect(res).toEqual({ data: { answer: 'mock', score: 5 }, provider: 'mock', model: 'mock-1' })
  })

  it('validates JSON, repairs once and injects CEFR constraints', async () => {
    const f = fakeFetch([gemini('{"answer":"ok","score":42}'), gemini('{"answer":"ok","score":7}')])
    const { kernel } = await makeKernel({ mockAi: false, fetchImpl: f.impl })
    kernel.ai.setKey('gemini', GEMINI_KEY)
    kernel.learner.updateProfile({ selfReportedLevel: 'elementary' })
    const res = await kernel.ai.run(prompt, { q: 'hello' })
    expect(res.data).toEqual({ answer: 'ok', score: 7 })
    expect(f.calls).toHaveLength(2)
    const firstBody = JSON.parse(String(f.calls[0]?.init.body)) as { systemInstruction: { parts: { text: string }[] } }
    expect(firstBody.systemInstruction.parts[0]?.text).toContain('CEFR A2')
    const repairBody = JSON.parse(String(f.calls[1]?.init.body)) as { contents: { parts: { text: string }[] }[] }
    expect(repairBody.contents.at(-1)?.parts[0]?.text).toContain('score')
  })

  it('rejects outputs that fail the prompt check twice', async () => {
    const f = fakeFetch([
      gemini('{"answer":"the secret is here","score":1}'),
      gemini('{"answer":"secret again","score":1}'),
    ])
    const { kernel } = await makeKernel({ mockAi: false, fetchImpl: f.impl })
    kernel.ai.setKey('gemini', GEMINI_KEY)
    await expect(kernel.ai.run(prompt, { q: 'x' })).rejects.toMatchObject({ code: 'bad_response' })
  })

  it('maps invalid keys during a connection test without leaking the key', async () => {
    const f = fakeFetch([json({ error: { message: `API key not valid: ${GEMINI_KEY}` } }, 400)])
    const { kernel } = await makeKernel({ mockAi: false, fetchImpl: f.impl })
    kernel.ai.setKey('gemini', GEMINI_KEY)
    const res = await kernel.ai.testConnection('gemini')
    expect(res.ok).toBe(false)
    expect(res.errorCode).toBe('invalid_key')
    expect(JSON.stringify(res)).not.toContain(GEMINI_KEY)
  })

  it('prefers the default provider and falls back to the other key', async () => {
    const { kernel } = await makeKernel({ mockAi: false })
    kernel.ai.setKey('openai', OPENAI_KEY)
    expect(kernel.ai.activeProviderId()).toBe('openai')
    kernel.ai.setKey('gemini', GEMINI_KEY)
    expect(kernel.ai.activeProviderId()).toBe('openai')
    kernel.ai.updateConfig({ defaultProvider: 'gemini' })
    expect(kernel.ai.activeProviderId()).toBe('gemini')
    kernel.ai.removeKey('gemini')
    expect(kernel.ai.getConfig().defaultProvider).toBe('openai')
    expect(kernel.ai.sttProviderId()).toBe('openai')
  })

  it('text prompts return trimmed text', async () => {
    const f = fakeFetch([gemini('  Nice job!  ')])
    const { kernel } = await makeKernel({ mockAi: false, fetchImpl: f.impl })
    kernel.ai.setKey('gemini', GEMINI_KEY)
    const tp = textPrompt<string>({
      id: 't',
      version: 1,
      build: (i) => ({ system: '', messages: [{ role: 'user', content: i }] }),
      mock: () => 'm',
    })
    expect((await kernel.ai.run(tp, 'hi')).data).toBe('Nice job!')
  })
})

describe('prompt helpers', () => {
  it('detects leaked answers on word boundaries', () => {
    expect(leaksAnswer('She went to the market', 'went')).toBe(true)
    expect(leaksAnswer('She wentworth', 'went')).toBe(false)
    expect(leaksAnswer('anything', 'a')).toBe(false)
  })

  it('builds level-aware constraints and language instructions', () => {
    expect(cefrConstraintBlock('A1')).toContain('5–8 words')
    expect(languageInstruction('mixed', 'A1')).toContain('Vietnamese')
    expect(languageInstruction('mixed', 'B2')).toContain('English')
    expect(languageInstruction('en', 'A1')).toBe('Write explanations in simple English.')
  })

  it('writes a valid WAV header', () => {
    const wav = pcmToWav(new Uint8Array(100), 16000, 1, 16)
    const b = Buffer.from(wav)
    expect(b.toString('ascii', 8, 12)).toBe('WAVE')
    expect(b.readUInt32LE(24)).toBe(16000)
    expect(b.readUInt32LE(40)).toBe(100)
  })
})
