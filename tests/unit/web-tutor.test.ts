import { describe, expect, it } from 'vitest'
import { CloudError, memoryKV, SupabaseClient, STORAGE_KEYS } from '../../web/src/lib/supabase'
import {
  askTutor,
  historyForRequest,
  loadChat,
  parseTutorResponse,
  saveChat,
  tutorErrorKind,
  type ChatMessage,
} from '../../web/src/lib/tutor'

const msg = (role: 'user' | 'assistant', content: string): ChatMessage => ({
  role,
  content,
  at: '2026-11-05T00:00:00Z',
})

describe('web tutor', () => {
  it('normalises corrections and new words in several shapes', () => {
    const res = parseTutorResponse({
      reply: 'Nice try!',
      corrections: [
        { original: 'I go yesterday', corrected: 'I went yesterday', explanation: 'past simple' },
        { wrong: 'informations', fix: 'information' },
        'Use "an" before vowels.',
        { explanation: 'no corrected text → dropped' },
        42,
      ],
      newWords: [{ word: 'commute', meaning_vi: 'đi lại hằng ngày' }, 'resilient', { word: '' }],
    })
    expect(res.reply).toBe('Nice try!')
    expect(res.corrections).toEqual([
      { original: 'I go yesterday', corrected: 'I went yesterday', explanation: 'past simple' },
      { original: 'informations', corrected: 'information', explanation: '' },
      { original: '', corrected: 'Use "an" before vowels.', explanation: '' },
    ])
    expect(res.newWords).toEqual([
      { word: 'commute', meaning: 'đi lại hằng ngày', ipa: '', example: '' },
      { word: 'resilient', meaning: '', ipa: '', example: '' },
    ])
  })

  it('reads the server contract (correction / explanationVi, meaningVi / ipa / example)', () => {
    const res = parseTutorResponse({
      reply: 'Good!',
      corrections: [
        {
          original: 'He go',
          correction: 'He goes',
          explanationVi: 'Ngôi thứ ba số ít thêm -s',
          category: 'grammar',
          pattern: null,
        },
      ],
      newWords: [{ word: 'thrive', ipa: 'θraɪv', meaningVi: 'phát triển mạnh', example: 'Plants thrive here.' }],
      usage: { used: 3, limit: 50 },
    })
    expect(res.corrections).toEqual([
      { original: 'He go', corrected: 'He goes', explanation: 'Ngôi thứ ba số ít thêm -s' },
    ])
    expect(res.newWords).toEqual([
      { word: 'thrive', ipa: 'θraɪv', meaning: 'phát triển mạnh', example: 'Plants thrive here.' },
    ])
  })

  it('accepts a reply without extras and rejects a missing reply', () => {
    expect(parseTutorResponse({ reply: 'Hi' })).toEqual({ reply: 'Hi', corrections: [], newWords: [] })
    expect(() => parseTutorResponse({ corrections: [] })).toThrow(CloudError)
  })

  it('sends the message with a trimmed history', async () => {
    const calls: { name: string; body: unknown }[] = []
    const history = Array.from({ length: 20 }, (_, i) => msg(i % 2 ? 'assistant' : 'user', `m${i}`))
    const res = await askTutor(
      {
        invoke: async <T>(name: string, body: unknown) => {
          calls.push({ name, body })
          return { reply: 'ok' } as T
        },
      },
      'How are you?',
      history,
    )
    expect(res.reply).toBe('ok')
    expect(calls[0]?.name).toBe('tutor')
    const body = calls[0]?.body as { message: string; history: { role: string; content: string }[] }
    expect(body.message).toBe('How are you?')
    expect(body.history).toHaveLength(12)
    expect(body.history[0]).toEqual({ role: 'user', content: 'm8' })
    expect(historyForRequest([msg('user', 'x'.repeat(5000))])[0]?.content).toHaveLength(2000)
  })

  it('reports a missing function (404) as not deployed', async () => {
    const storage = memoryKV({
      [STORAGE_KEYS.config]: JSON.stringify({
        url: 'https://demo.supabase.co',
        anonKey: 'anon-key-0123456789abcdefghij',
      }),
      [STORAGE_KEYS.session]: JSON.stringify({
        accessToken: 'a',
        refreshToken: 'r',
        expiresAt: Date.now() + 3_600_000,
        user: { id: 'u', email: '' },
      }),
    })
    const urls: string[] = []
    const client = new SupabaseClient({
      storage,
      fetchImpl: (async (input: RequestInfo | URL) => {
        urls.push(String(input))
        return new Response('{"message":"Function not found"}', { status: 404 })
      }) as typeof fetch,
    })
    const err = await askTutor(client, 'hi', []).catch((e: unknown) => e)
    expect(urls).toEqual(['https://demo.supabase.co/functions/v1/tutor'])
    expect(tutorErrorKind(err)).toBe('not_deployed')
    expect(tutorErrorKind(new CloudError('rate_limited', ''))).toBe('quota')
    expect(tutorErrorKind(new CloudError('server', 'no AI', 503))).toBe('no_ai')
    expect(tutorErrorKind(new CloudError('network', ''))).toBe('offline')
    expect(tutorErrorKind(new Error('x'))).toBe('other')
  })

  it('keeps the chat per user, capped', () => {
    const kv = memoryKV()
    saveChat(
      kv,
      'u1',
      Array.from({ length: 80 }, (_, i) => msg('user', `m${i}`)),
    )
    const loaded = loadChat(kv, 'u1')
    expect(loaded).toHaveLength(60)
    expect(loaded[0]?.content).toBe('m20')
    expect(loadChat(kv, 'u2')).toEqual([])
    kv.set('lq.tutor.u3', 'nope')
    expect(loadChat(kv, 'u3')).toEqual([])
  })
})
