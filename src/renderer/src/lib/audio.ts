// Audio helpers: text-to-speech (Windows voices offline, or OpenAI/Gemini voices through main) and
// microphone recording converted to 16 kHz mono WAV, with simple pause/fluency analysis.
import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from './api'
import { useApp } from './store'

export type Accent = 'en-US' | 'en-GB' | 'en-AU'

export interface SpeakOptions {
  accent?: Accent
  rate?: number
  /** Voice gender hint for dialogues (system voices only, best effort). */
  gender?: 'female' | 'male'
  onEnd?: () => void
}

// ---------- playback controller ----------
// Exactly one thing speaks at a time. Every speak()/speakSequence() call takes a new "generation"; anything
// belonging to an older generation (a pending AI request, a queued sentence, a running dialogue) is dropped,
// and its promise resolves immediately so buttons never stay stuck in the "playing" state.

let generation = 0
let currentAudio: HTMLAudioElement | null = null
let settleCurrent: (() => void) | null = null
const listeners = new Set<(speaking: boolean) => void>()
/** Resolved whenever playback is stopped, so work waiting on a download can give up immediately. */
let supersededWaiters: (() => void)[] = []
const superseded = () => new Promise<'superseded'>((r) => supersededWaiters.push(() => r('superseded')))

function setSpeaking(v: boolean) {
  for (const l of listeners) l(v)
}

/** Subscribe to "something is speaking" changes (used by buttons and players). */
export function onSpeakingChange(listener: (speaking: boolean) => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function stopSpeaking() {
  generation++
  if (typeof speechSynthesis !== 'undefined' && (speechSynthesis.speaking || speechSynthesis.pending)) {
    speechSynthesis.cancel()
  }
  if (currentAudio) {
    currentAudio.pause()
    currentAudio.removeAttribute('src')
    currentAudio = null
  }
  settleCurrent?.()
  settleCurrent = null
  const waiters = supersededWaiters
  supersededWaiters = []
  for (const w of waiters) w()
  setSpeaking(false)
}

// ---------- system (Windows) voices ----------

let voiceCache: SpeechSynthesisVoice[] = []
function loadVoices() {
  if (typeof speechSynthesis === 'undefined') return
  const all = speechSynthesis.getVoices()
  if (all.length) voiceCache = all.filter((v) => v.lang.toLowerCase().startsWith('en'))
}
if (typeof speechSynthesis !== 'undefined') {
  // Voices load asynchronously; warm the list up at start so the first click is not slow.
  loadVoices()
  speechSynthesis.addEventListener('voiceschanged', loadVoices)
}

export function systemVoices(): SpeechSynthesisVoice[] {
  if (!voiceCache.length) loadVoices()
  return voiceCache
}

const FEMALE_HINT = /female|zira|aria|jenny|sonia|libby|hazel|susan|natasha|catherine|emma|ava|michelle/i
const MALE_HINT = /male|david|mark|guy|ryan|george|james|william|christopher|eric|brian|andrew/i

/**
 * Local (offline) voices start instantly; "Online (Natural)" voices need a network round-trip per sentence,
 * so they are only used when the learner picked one explicitly in Settings.
 */
export function pickVoice(
  voices: SpeechSynthesisVoice[],
  accent: Accent,
  gender?: 'female' | 'male',
  preferredUri?: string,
): SpeechSynthesisVoice | null {
  if (!voices.length) return null
  if (preferredUri && !gender) {
    const pref = voices.find((v) => v.voiceURI === preferredUri)
    if (pref) return pref
  }
  const local = voices.filter((v) => v.localService)
  const base = local.length ? local : voices
  const sameAccent = base.filter((v) => v.lang.replace('_', '-').toLowerCase() === accent.toLowerCase())
  const pool = sameAccent.length ? sameAccent : base
  if (gender) {
    const g = pool.find((v) => (gender === 'female' ? FEMALE_HINT : MALE_HINT).test(v.name))
    if (g) return g
  }
  return pool[0] ?? null
}

/** Chromium stops long utterances after ~15 s, so long text is spoken in sentence-sized chunks. */
export function splitForSpeech(text: string, max = 220): string[] {
  const clean = text.replace(/\s+/g, ' ').trim()
  if (!clean) return []
  const sentences = clean.match(/[^.!?…]+[.!?…]*["')\]]*\s*/g) ?? [clean]
  const out: string[] = []
  let buf = ''
  for (const s of sentences) {
    if (buf && (buf + s).length > max) {
      out.push(buf.trim())
      buf = ''
    }
    buf += s
  }
  if (buf.trim()) out.push(buf.trim())
  return out
}

function speakSystemChunk(text: string, opts: SpeakOptions, rate: number, voiceUri: string, my: number) {
  return new Promise<void>((resolve) => {
    if (typeof speechSynthesis === 'undefined' || my !== generation) return resolve()
    const u = new SpeechSynthesisUtterance(text)
    const voice = pickVoice(systemVoices(), opts.accent ?? 'en-US', opts.gender, voiceUri)
    if (voice) u.voice = voice
    u.lang = voice?.lang ?? opts.accent ?? 'en-US'
    u.rate = rate
    const done = () => {
      if (settleCurrent === done) settleCurrent = null
      resolve()
    }
    settleCurrent = done
    u.onend = done
    u.onerror = done
    speechSynthesis.speak(u)
    // Chromium sometimes leaves the queue paused after cancel(); resume() kicks it.
    if (speechSynthesis.paused) speechSynthesis.resume()
  })
}

async function speakSystem(text: string, opts: SpeakOptions, rate: number, voiceUri: string, my: number) {
  for (const chunk of splitForSpeech(text)) {
    if (my !== generation) return
    await speakSystemChunk(chunk, opts, rate, voiceUri, my)
  }
}

// ---------- AI voices (OpenAI / Gemini) ----------

const ttsCache = new Map<string, string>() // key → object URL (main also keeps a disk cache)
const inflight = new Map<string, Promise<string>>()
const MAX_CACHE = 120

function aiVoice(engine: 'openai' | 'gemini', gender?: 'female' | 'male') {
  return engine === 'openai' ? (gender === 'male' ? 'onyx' : 'nova') : gender === 'male' ? 'Charon' : 'Kore'
}

/** Fetches (or reuses) the audio for a sentence. Concurrent requests for the same text share one download. */
function loadAiAudio(engine: 'openai' | 'gemini', text: string, rate: number, gender?: 'female' | 'male') {
  const voice = aiVoice(engine, gender)
  // Gemini ignores the speed parameter (playbackRate is used instead), so its audio is cached at speed 1.
  const speed = engine === 'openai' ? Math.round(rate * 100) / 100 : 1
  const key = `${engine}|${voice}|${speed}|${text}`
  const cached = ttsCache.get(key)
  if (cached) return Promise.resolve(cached)
  const pending = inflight.get(key)
  if (pending) return pending
  const p = api('audio:tts', { text, engine, voice, speed })
    .then((res) => {
      const url = URL.createObjectURL(new Blob([res.data as BlobPart], { type: res.mimeType }))
      ttsCache.set(key, url)
      if (ttsCache.size > MAX_CACHE) {
        const first = ttsCache.keys().next().value as string
        URL.revokeObjectURL(ttsCache.get(first) as string)
        ttsCache.delete(first)
      }
      return url
    })
    .finally(() => inflight.delete(key))
  inflight.set(key, p)
  return p
}

/** Starts downloading upcoming sentences so a dialogue plays without gaps (AI voices only). */
export function prefetchSpeech(texts: { text: string; gender?: 'female' | 'male' }[], rate = 1) {
  const s = useApp.getState().settings
  const engine = s?.ttsEngine ?? 'system'
  if (engine === 'system') return
  const r = rate * (s?.speechRate ?? 1)
  for (const t of texts.slice(0, 2)) void loadAiAudio(engine, t.text, r, t.gender).catch(() => undefined)
}

async function speakAi(
  engine: 'openai' | 'gemini',
  text: string,
  rate: number,
  my: number,
  gender?: 'female' | 'male',
) {
  const url = await Promise.race([loadAiAudio(engine, text, rate, gender), superseded()])
  if (url === 'superseded' || my !== generation) return // superseded while downloading – never play late audio
  await new Promise<void>((resolve) => {
    const audio = new Audio(url)
    currentAudio = audio
    if (engine === 'gemini') audio.playbackRate = rate
    const done = () => {
      if (settleCurrent === done) settleCurrent = null
      if (currentAudio === audio) currentAudio = null
      resolve()
    }
    settleCurrent = done
    audio.onended = done
    audio.onerror = done
    void audio.play().catch(done)
  })
}

async function speakNow(text: string, opts: SpeakOptions, my: number) {
  const s = useApp.getState().settings
  const rate = (opts.rate ?? 1) * (s?.speechRate ?? 1)
  const engine = s?.ttsEngine ?? 'system'
  try {
    if (engine !== 'system') await speakAi(engine, text, rate, my, opts.gender)
    else await speakSystem(text, opts, rate, s?.systemVoiceUri ?? '', my)
  } catch {
    // AI voice unavailable (no key, offline, quota): fall back to Windows voices.
    if (my === generation) await speakSystem(text, opts, rate, s?.systemVoiceUri ?? '', my)
  }
}

/**
 * Speaks English text with the learner's chosen engine. Starting a new speak() stops whatever was playing
 * (including audio still downloading), so repeated clicks never stack up.
 */
export async function speak(text: string, opts: SpeakOptions = {}): Promise<void> {
  stopSpeaking()
  const my = generation
  setSpeaking(true)
  try {
    await speakNow(text, opts, my)
  } finally {
    if (my === generation) setSpeaking(false)
    opts.onEnd?.()
  }
}

/** Speaks lines one after another (dialogues). Returns a cancel function. Any other speak() cancels it. */
export function speakSequence(
  lines: { text: string; gender?: 'female' | 'male' }[],
  opts: SpeakOptions & { onLine?: (i: number) => void } = {},
) {
  stopSpeaking()
  const my = generation
  setSpeaking(true)
  void (async () => {
    for (let i = 0; i < lines.length && my === generation; i++) {
      opts.onLine?.(i)
      prefetchSpeech(lines.slice(i + 1), opts.rate ?? 1)
      const line = lines[i] as { text: string; gender?: 'female' | 'male' }
      await speakNow(line.text, { ...opts, gender: line.gender, onEnd: undefined }, my)
      if (my === generation && i < lines.length - 1) await new Promise((r) => setTimeout(r, 200))
    }
    if (my === generation) {
      setSpeaking(false)
      opts.onEnd?.()
    }
  })()
  return () => {
    if (my === generation) stopSpeaking()
  }
}

// ---------- recording ----------

export interface PauseAnalysis {
  durationSec: number
  speakingSec: number
  pauseCount: number
  longestPauseSec: number
}

/** Energy-based voice activity detection over 30 ms frames. Pauses are silences of 0.4 s or more inside speech. */
export function analysePauses(samples: Float32Array, sampleRate: number): PauseAnalysis {
  const frame = Math.max(1, Math.round(sampleRate * 0.03))
  const energies: number[] = []
  for (let i = 0; i < samples.length; i += frame) {
    let sum = 0
    const end = Math.min(samples.length, i + frame)
    for (let j = i; j < end; j++) sum += (samples[j] as number) ** 2
    energies.push(Math.sqrt(sum / Math.max(1, end - i)))
  }
  const sorted = [...energies].sort((a, b) => a - b)
  const noise = sorted[Math.floor(sorted.length * 0.1)] ?? 0
  const peak = sorted[Math.floor(sorted.length * 0.95)] ?? 0
  const threshold = Math.max(0.01, noise + (peak - noise) * 0.18)
  const voiced = energies.map((e) => e > threshold)
  const first = voiced.indexOf(true)
  const last = voiced.lastIndexOf(true)
  const frameSec = frame / sampleRate
  let speaking = 0
  let pauses = 0
  let longest = 0
  let run = 0
  if (first >= 0) {
    for (let i = first; i <= last; i++) {
      if (voiced[i]) {
        speaking++
        if (run * frameSec >= 0.4) {
          pauses++
          longest = Math.max(longest, run * frameSec)
        }
        run = 0
      } else run++
    }
  }
  return {
    durationSec: Math.round((samples.length / sampleRate) * 10) / 10,
    speakingSec: Math.round(speaking * frameSec * 10) / 10,
    pauseCount: pauses,
    longestPauseSec: Math.round(longest * 10) / 10,
  }
}

function encodeWav(samples: Float32Array, sampleRate: number): Uint8Array<ArrayBuffer> {
  const buffer = new ArrayBuffer(44 + samples.length * 2)
  const view = new DataView(buffer)
  const writeStr = (o: number, s: string) => [...s].forEach((c, i) => view.setUint8(o + i, c.charCodeAt(0)))
  writeStr(0, 'RIFF')
  view.setUint32(4, 36 + samples.length * 2, true)
  writeStr(8, 'WAVE')
  writeStr(12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, 1, true)
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * 2, true)
  view.setUint16(32, 2, true)
  view.setUint16(34, 16, true)
  writeStr(36, 'data')
  view.setUint32(40, samples.length * 2, true)
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i] as number))
    view.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true)
  }
  return new Uint8Array(buffer)
}

export interface Recording {
  wav: Uint8Array<ArrayBuffer>
  url: string
  analysis: PauseAnalysis
}

async function toWav16k(blob: Blob): Promise<{ wav: Uint8Array<ArrayBuffer>; analysis: PauseAnalysis }> {
  const ctx = new AudioContext()
  try {
    const decoded = await ctx.decodeAudioData(await blob.arrayBuffer())
    const rate = 16000
    const offline = new OfflineAudioContext(1, Math.max(1, Math.ceil(decoded.duration * rate)), rate)
    const src = offline.createBufferSource()
    src.buffer = decoded
    src.connect(offline.destination)
    src.start()
    const rendered = await offline.startRendering()
    const samples = rendered.getChannelData(0)
    return { wav: encodeWav(samples, rate), analysis: analysePauses(samples, rate) }
  } finally {
    void ctx.close()
  }
}

export type RecorderState = 'idle' | 'requesting' | 'recording' | 'processing' | 'error'

const MIC_TEXT = {
  denied: {
    en: 'B&T English may not use the microphone. Open Windows Settings → Privacy & security → Microphone and allow desktop apps.',
    vi: 'Ứng dụng chưa được phép dùng micro. Mở Windows Settings → Privacy & security → Microphone và bật quyền cho ứng dụng desktop.',
  },
  missing: {
    en: 'No microphone found. Plug in a microphone or headset and try again.',
    vi: 'Không tìm thấy micro. Hãy cắm micro/tai nghe rồi thử lại.',
  },
  process: {
    en: 'The recording could not be processed. Please try again.',
    vi: 'Không xử lý được bản ghi âm. Hãy thử lại.',
  },
}
const micText = (k: keyof typeof MIC_TEXT) => MIC_TEXT[k][useApp.getState().settings?.uiLanguage === 'en' ? 'en' : 'vi']

/**
 * Microphone recorder hook. `stop()` resolves with a 16 kHz WAV and pause analysis. When the time limit
 * stops the recording by itself, the result is delivered to `onAutoStop` so it is never lost.
 */
export function useRecorder(maxSeconds = 120, onAutoStop?: (rec: Recording | null) => void) {
  const [state, setState] = useState<RecorderState>('idle')
  const [error, setError] = useState<string | null>(null)
  const [elapsed, setElapsed] = useState(0)
  const [level, setLevel] = useState(0)
  const media = useRef<MediaRecorder | null>(null)
  const chunks = useRef<Blob[]>([])
  const stream = useRef<MediaStream | null>(null)
  const timer = useRef<number | null>(null)
  const raf = useRef<number | null>(null)
  const audioCtx = useRef<AudioContext | null>(null)
  const alive = useRef(true)
  const resolver = useRef<((r: Recording | null) => void) | null>(null)
  const startedAt = useRef(0)
  const autoStopRef = useRef(onAutoStop)
  autoStopRef.current = onAutoStop

  const cleanup = useCallback(() => {
    if (timer.current) window.clearInterval(timer.current)
    if (raf.current) cancelAnimationFrame(raf.current)
    stream.current?.getTracks().forEach((t) => t.stop())
    stream.current = null
    // Each recording opens an AudioContext for the level meter; close it or they pile up.
    void audioCtx.current?.close().catch(() => undefined)
    audioCtx.current = null
    setLevel(0)
  }, [])

  useEffect(() => {
    alive.current = true
    return () => {
      // Leaving the page mid-recording: stop the microphone and drop the result.
      alive.current = false
      resolver.current = null
      if (media.current && media.current.state !== 'inactive') media.current.stop()
      cleanup()
    }
  }, [cleanup])

  const stop = useCallback((): Promise<Recording | null> => {
    const rec = media.current
    if (!rec || rec.state === 'inactive') return Promise.resolve(null)
    return new Promise((resolve) => {
      resolver.current = resolve
      rec.stop()
    })
  }, [])

  const start = useCallback(async () => {
    setError(null)
    setState('requesting')
    try {
      stopSpeaking()
      const s = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } })
      stream.current = s
      chunks.current = []
      const rec = new MediaRecorder(s, { mimeType: 'audio/webm;codecs=opus' })
      media.current = rec
      rec.ondataavailable = (e) => e.data.size && chunks.current.push(e.data)
      // A manual stop() waits on `resolver`; an automatic stop (time limit) goes to onAutoStop.
      const deliver = (r: Recording | null) => {
        const resolve = resolver.current
        resolver.current = null
        if (resolve) resolve(r)
        else if (alive.current) autoStopRef.current?.(r)
      }
      rec.onstop = async () => {
        cleanup()
        setState('processing')
        try {
          const blob = new Blob(chunks.current, { type: 'audio/webm' })
          const { wav, analysis } = await toWav16k(blob)
          const url = URL.createObjectURL(new Blob([wav as BlobPart], { type: 'audio/wav' }))
          setState('idle')
          deliver({ wav, url, analysis })
        } catch {
          setError(micText('process'))
          setState('error')
          deliver(null)
        }
      }
      // Level meter for visual feedback.
      const actx = new AudioContext()
      audioCtx.current = actx
      const analyser = actx.createAnalyser()
      analyser.fftSize = 512
      actx.createMediaStreamSource(s).connect(analyser)
      const data = new Uint8Array(analyser.fftSize)
      const tick = () => {
        analyser.getByteTimeDomainData(data)
        let peak = 0
        for (const v of data) peak = Math.max(peak, Math.abs(v - 128))
        setLevel(peak / 128)
        raf.current = requestAnimationFrame(tick)
      }
      tick()
      startedAt.current = Date.now()
      setElapsed(0)
      timer.current = window.setInterval(() => {
        const sec = (Date.now() - startedAt.current) / 1000
        setElapsed(sec)
        if (sec >= maxSeconds) void stop()
      }, 200)
      rec.start(250)
      setState('recording')
    } catch (err) {
      cleanup()
      const denied = err instanceof DOMException && (err.name === 'NotAllowedError' || err.name === 'SecurityError')
      setError(micText(denied ? 'denied' : 'missing'))
      setState('error')
    }
  }, [cleanup, maxSeconds, stop])

  return { state, error, elapsed, level, start, stop }
}

/** Sends a recording to speech-to-text (OpenAI or Gemini). `hint` is the text the learner tried to say. */
export async function transcribe(rec: Recording, hint?: string) {
  return api('audio:stt', { audio: rec.wav, mimeType: 'audio/wav', hint })
}
