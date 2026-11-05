import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { TtsCache } from '../../src/main/kernel/ai/ttsCache'
import { makeApp, tempDir } from '../helpers/kernel'

describe('AI text-to-speech disk cache', () => {
  it('synthesises a sentence once and serves repeats from disk', async () => {
    const { call, kernel } = await makeApp()
    const spy = vi.spyOn(kernel.ai, 'synthesize')
    const input = { text: 'Good morning, everyone.', engine: 'openai' as const, voice: 'nova', speed: 1 }
    const a = await call<{ data: Uint8Array; mimeType: string }>('audio:tts', input)
    const b = await call<{ data: Uint8Array; mimeType: string }>('audio:tts', input)
    expect(spy).toHaveBeenCalledTimes(1)
    expect(Buffer.from(b.data).equals(Buffer.from(a.data))).toBe(true)
    await call('audio:tts', { ...input, speed: 0.8 })
    expect(spy).toHaveBeenCalledTimes(2)
  })

  it('evicts least recently used files above the size limit', () => {
    const dir = tempDir()
    const cache = new TtsCache(dir, 2500)
    cache.set('a', new Uint8Array(1000), 'audio/mpeg')
    cache.set('b', new Uint8Array(1000), 'audio/wav')
    const old = new Date(Date.now() - 60_000)
    for (const f of fs.readdirSync(dir)) if (f.endsWith('.mp3')) fs.utimesSync(path.join(dir, f), old, old)
    cache.set('c', new Uint8Array(1000), 'audio/mpeg')
    expect(cache.get('a')).toBeNull()
    expect(cache.get('b')?.mimeType).toBe('audio/wav')
    expect(cache.get('c')?.data.length).toBe(1000)
  })
})
