// Playback controller: rapid clicks must never stack audio, late AI downloads must not play, and identical
// requests share one download. Browser speech/audio APIs are replaced with small fakes.
import { beforeEach, describe, expect, it, vi } from 'vitest'

const apiMock = vi.fn()
vi.mock('../../src/renderer/src/lib/api', () => ({ api: (...args: unknown[]) => apiMock(...args) }))
const settings = { ttsEngine: 'system' as 'system' | 'openai' | 'gemini', speechRate: 1, systemVoiceUri: '' }
vi.mock('../../src/renderer/src/lib/store', () => ({ useApp: { getState: () => ({ settings }) } }))

interface FakeUtterance {
  text: string
  voice: unknown
  lang: string
  rate: number
  onend: (() => void) | null
  onerror: (() => void) | null
}
const spoken: string[] = []
let active: FakeUtterance[] = []
const fakeSpeech = {
  speaking: false,
  pending: false,
  paused: false,
  getVoices: () => [
    { name: 'Microsoft Aria Online (Natural)', lang: 'en-US', localService: false, voiceURI: 'aria-online' },
    { name: 'Microsoft Zira', lang: 'en-US', localService: true, voiceURI: 'zira' },
    { name: 'Microsoft David', lang: 'en-US', localService: true, voiceURI: 'david' },
  ],
  addEventListener: () => undefined,
  speak(u: FakeUtterance) {
    spoken.push(u.text)
    active.push(u)
    this.speaking = true
  },
  cancel() {
    const was = active
    active = []
    this.speaking = false
    for (const u of was) u.onerror?.()
  },
  resume: () => undefined,
}
const audios: { src: string; paused: boolean; ended: () => void }[] = []
class FakeAudio {
  onended: (() => void) | null = null
  onerror: (() => void) | null = null
  playbackRate = 1
  paused = false
  constructor(public src: string) {
    audios.push({ src, paused: false, ended: () => this.onended?.() })
  }
  play() {
    return Promise.resolve()
  }
  pause() {
    this.paused = true
    const a = audios.find((x) => x.src === this.src && !x.paused)
    if (a) a.paused = true
  }
  removeAttribute() {}
}
Object.assign(globalThis, {
  speechSynthesis: fakeSpeech,
  SpeechSynthesisUtterance: class {
    voice: unknown = null
    lang = ''
    rate = 1
    onend: (() => void) | null = null
    onerror: (() => void) | null = null
    constructor(public text: string) {}
  },
  Audio: FakeAudio,
  URL: Object.assign(URL, {
    createObjectURL: (b: { size: number }) => `blob:${b.size}:${Math.random()}`,
    revokeObjectURL: () => undefined,
  }),
})

const audio = await import('../../src/renderer/src/lib/audio')
const finishCurrent = () => {
  const u = active.shift()
  fakeSpeech.speaking = active.length > 0
  u?.onend?.()
}
const tick = () => new Promise((r) => setTimeout(r, 0))

beforeEach(() => {
  audio.stopSpeaking()
  spoken.length = 0
  active = []
  audios.length = 0
  apiMock.mockReset()
  settings.ttsEngine = 'system'
})

describe('playback controller', () => {
  it('rapid speak() calls leave exactly one utterance playing and settle the older promises', async () => {
    const done: number[] = []
    for (let i = 0; i < 5; i++) void audio.speak(`line ${i}`).then(() => done.push(i))
    await tick()
    expect(active.map((u) => u.text)).toEqual(['line 4'])
    expect(done.sort()).toEqual([0, 1, 2, 3])
    finishCurrent()
    await tick()
    expect(done).toContain(4)
  })

  it('prefers instant local voices over online voices unless one is chosen', () => {
    const voices = fakeSpeech.getVoices() as unknown as SpeechSynthesisVoice[]
    expect(audio.pickVoice(voices, 'en-US')?.name).toBe('Microsoft Zira')
    expect(audio.pickVoice(voices, 'en-US', 'male')?.name).toBe('Microsoft David')
    expect(audio.pickVoice(voices, 'en-US', undefined, 'aria-online')?.name).toContain('Online')
  })

  it('splits long text into sentence-sized chunks', () => {
    const long = Array.from({ length: 12 }, (_, i) => `This is sentence number ${i} of a long paragraph.`).join(' ')
    const parts = audio.splitForSpeech(long, 120)
    expect(parts.length).toBeGreaterThan(3)
    expect(parts.every((p) => p.length <= 120)).toBe(true)
    expect(parts.join(' ')).toBe(long)
    expect(audio.splitForSpeech('   ')).toEqual([])
  })

  it('drops AI audio that arrives after a newer request and never plays both', async () => {
    settings.ttsEngine = 'openai'
    const resolvers: ((v: unknown) => void)[] = []
    apiMock.mockImplementation(() => new Promise((r) => resolvers.push(r)))
    const first = audio.speak('first')
    const second = audio.speak('second')
    await first // superseded → settles at once
    resolvers[0]?.({ data: new Uint8Array(10), mimeType: 'audio/mpeg' })
    resolvers[1]?.({ data: new Uint8Array(20), mimeType: 'audio/mpeg' })
    await tick()
    await tick()
    expect(audios).toHaveLength(1)
    expect(audios[0]?.src).toContain('blob:20')
    audios[0]?.ended()
    await second
  })

  it('shares one download for identical concurrent requests and reuses the cache', async () => {
    settings.ttsEngine = 'openai'
    apiMock.mockResolvedValue({ data: new Uint8Array(5), mimeType: 'audio/mpeg' })
    audio.prefetchSpeech([{ text: 'Hello there.' }])
    const p = audio.speak('Hello there.')
    await tick()
    await tick()
    expect(apiMock).toHaveBeenCalledTimes(1)
    audios[0]?.ended()
    await p
    const q = audio.speak('Hello there.')
    await tick()
    audios[1]?.ended()
    await q
    expect(apiMock).toHaveBeenCalledTimes(1)
  })

  it('a new speak() cancels a running dialogue sequence', async () => {
    const seen: number[] = []
    audio.speakSequence([{ text: 'A1' }, { text: 'A2' }, { text: 'A3' }], { onLine: (i) => seen.push(i) })
    await tick()
    expect(active.map((u) => u.text)).toEqual(['A1'])
    void audio.speak('interrupt')
    await tick()
    finishCurrent()
    await new Promise((r) => setTimeout(r, 300))
    expect(spoken).toEqual(['A1', 'interrupt'])
    expect(seen).toEqual([0])
  })

  it('reports speaking state changes to subscribers', async () => {
    const states: boolean[] = []
    const off = audio.onSpeakingChange((v) => states.push(v))
    const p = audio.speak('hi')
    await tick()
    finishCurrent()
    await p
    off()
    expect(states[0]).toBe(false) // stop of the previous generation
    expect(states).toContain(true)
    expect(states[states.length - 1]).toBe(false)
  })
})
