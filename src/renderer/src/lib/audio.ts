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

let currentAudio: HTMLAudioElement | null = null
const ttsCache = new Map<string, string>() // key → object URL
const MAX_CACHE = 80

export function stopSpeaking() {
  if (typeof speechSynthesis !== 'undefined') speechSynthesis.cancel()
  if (currentAudio) {
    currentAudio.pause()
    currentAudio = null
  }
}

export function systemVoices(): SpeechSynthesisVoice[] {
  if (typeof speechSynthesis === 'undefined') return []
  return speechSynthesis.getVoices().filter((v) => v.lang.toLowerCase().startsWith('en'))
}

const FEMALE_HINT = /female|zira|aria|jenny|sonia|libby|hazel|susan|natasha|catherine|emma|ava|michelle/i
const MALE_HINT = /male|david|mark|guy|ryan|george|james|william|christopher|eric|brian|andrew/i

function pickVoice(accent: Accent, gender?: 'female' | 'male', preferredUri?: string): SpeechSynthesisVoice | null {
  const voices = systemVoices()
  if (!voices.length) return null
  const sameAccent = voices.filter((v) => v.lang.replace('_', '-').toLowerCase() === accent.toLowerCase())
  const pool = sameAccent.length ? sameAccent : voices
  if (preferredUri && !gender) {
    const pref = pool.find((v) => v.voiceURI === preferredUri) ?? voices.find((v) => v.voiceURI === preferredUri)
    if (pref && (!sameAccent.length || sameAccent.includes(pref))) return pref
  }
  if (gender) {
    const g = pool.find((v) => (gender === 'female' ? FEMALE_HINT : MALE_HINT).test(v.name))
    if (g) return g
  }
  return pool.find((v) => /natural|online/i.test(v.name)) ?? pool[0] ?? null
}

function speakSystem(text: string, opts: SpeakOptions, rate: number, voiceUri: string): Promise<void> {
  return new Promise((resolve) => {
    if (typeof speechSynthesis === 'undefined') return resolve()
    const u = new SpeechSynthesisUtterance(text)
    const voice = pickVoice(opts.accent ?? 'en-US', opts.gender, voiceUri)
    if (voice) u.voice = voice
    u.lang = voice?.lang ?? opts.accent ?? 'en-US'
    u.rate = rate
    u.onend = () => resolve()
    u.onerror = () => resolve()
    speechSynthesis.speak(u)
  })
}

async function speakAi(engine: 'openai' | 'gemini', text: string, rate: number, gender?: 'female' | 'male'): Promise<void> {
  const voice = engine === 'openai' ? (gender === 'male' ? 'onyx' : 'nova') : gender === 'male' ? 'Charon' : 'Kore'
  const key = `${engine}|${voice}|${rate}|${text}`
  let url = ttsCache.get(key)
  if (!url) {
    const res = await api('audio:tts', { text, engine, voice, speed: rate })
    url = URL.createObjectURL(new Blob([res.data as BlobPart], { type: res.mimeType }))
    ttsCache.set(key, url)
    if (ttsCache.size > MAX_CACHE) {
      const first = ttsCache.keys().next().value as string
      URL.revokeObjectURL(ttsCache.get(first) as string)
      ttsCache.delete(first)
    }
  }
  await new Promise<void>((resolve) => {
    const audio = new Audio(url)
    currentAudio = audio
    if (engine === 'gemini') audio.playbackRate = rate
    audio.onended = () => resolve()
    audio.onerror = () => resolve()
    void audio.play().catch(() => resolve())
  })
}

/**
 * Speaks English text with the learner's chosen engine. AI voices fall back to Windows voices
 * when the key is missing or the request fails, so audio always works offline.
 */
export async function speak(text: string, opts: SpeakOptions = {}): Promise<void> {
  stopSpeaking()
  const s = useApp.getState().settings
  const rate = (opts.rate ?? 1) * (s?.speechRate ?? 1)
  const engine = s?.ttsEngine ?? 'system'
  try {
    if (engine !== 'system') await speakAi(engine, text, rate, opts.gender)
    else await speakSystem(text, opts, rate, s?.systemVoiceUri ?? '')
  } catch {
    await speakSystem(text, opts, rate, s?.systemVoiceUri ?? '')
  } finally {
    opts.onEnd?.()
  }
}

/** Speaks lines one after another (dialogues). Returns a cancel function. */
export function speakSequence(lines: { text: string; gender?: 'female' | 'male' }[], opts: SpeakOptions & { onLine?: (i: number) => void } = {}) {
  let cancelled = false
  void (async () => {
    for (let i = 0; i < lines.length && !cancelled; i++) {
      opts.onLine?.(i)
      const line = lines[i] as { text: string; gender?: 'female' | 'male' }
      await speak(line.text, { ...opts, gender: line.gender, onEnd: undefined })
      if (!cancelled) await new Promise((r) => setTimeout(r, 250))
    }
    if (!cancelled) opts.onEnd?.()
  })()
  return () => {
    cancelled = true
    stopSpeaking()
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
  const resolver = useRef<((r: Recording | null) => void) | null>(null)
  const startedAt = useRef(0)
  const autoStopRef = useRef(onAutoStop)
  autoStopRef.current = onAutoStop

  const cleanup = useCallback(() => {
    if (timer.current) window.clearInterval(timer.current)
    if (raf.current) cancelAnimationFrame(raf.current)
    stream.current?.getTracks().forEach((t) => t.stop())
    stream.current = null
    setLevel(0)
  }, [])

  useEffect(() => cleanup, [cleanup])

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
        else autoStopRef.current?.(r)
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
          setError('Không xử lý được bản ghi âm. Hãy thử lại.')
          setState('error')
          deliver(null)
        }
      }
      // Level meter for visual feedback.
      const actx = new AudioContext()
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
      setError(
        denied
          ? 'Ứng dụng chưa được phép dùng micro. Mở Windows Settings → Privacy & security → Microphone và bật quyền cho ứng dụng desktop.'
          : 'Không tìm thấy micro. Hãy cắm micro/tai nghe rồi thử lại.',
      )
      setState('error')
    }
  }, [cleanup, maxSeconds, stop])

  return { state, error, elapsed, level, start, stop }
}

/** Sends a recording to speech-to-text (OpenAI or Gemini). `hint` is the text the learner tried to say. */
export async function transcribe(rec: Recording, hint?: string) {
  return api('audio:stt', { audio: rec.wav, mimeType: 'audio/wav', hint })
}
