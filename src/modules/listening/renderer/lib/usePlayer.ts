// Track player built on the shared TTS helpers: play one line (optionally looping), play the whole track
// with the current line highlighted, and a speed control. Every new action cancels the previous one.
import { useCallback, useEffect, useRef, useState } from 'react'
import type { ListeningTrack } from '@shared/content'
import { speak, speakSequence, stopSpeaking } from '@/lib/audio'

export const SPEED_MIN = 0.6
export const SPEED_MAX = 1.25

export interface TrackPlayer {
  speed: number
  setSpeed: (v: number) => void
  loop: boolean
  setLoop: (v: boolean) => void
  /** Line currently being spoken (or last spoken), null when idle at the start. */
  current: number | null
  playing: boolean
  playLine: (index: number) => Promise<void>
  playAll: (from?: number) => void
  stop: () => void
  /** Number of times any audio was started – used as a rough "listens" counter. */
  plays: number
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

export function useTrackPlayer(track: ListeningTrack | undefined): TrackPlayer {
  const [speed, setSpeedState] = useState(1)
  const [loop, setLoopState] = useState(false)
  const [current, setCurrent] = useState<number | null>(null)
  const [playing, setPlaying] = useState(false)
  const [plays, setPlays] = useState(0)
  const token = useRef(0)
  const cancelSeq = useRef<(() => void) | null>(null)
  const speedRef = useRef(speed)
  const loopRef = useRef(loop)
  speedRef.current = speed
  loopRef.current = loop

  const genderOf = useCallback((speakerId: string) => track?.speakers.find((s) => s.id === speakerId)?.gender, [track])

  const stop = useCallback(() => {
    token.current++
    cancelSeq.current?.()
    cancelSeq.current = null
    stopSpeaking()
    setPlaying(false)
  }, [])

  const playLine = useCallback(
    async (index: number) => {
      if (!track) return
      const line = track.lines[index]
      if (!line) return
      cancelSeq.current?.()
      cancelSeq.current = null
      const my = ++token.current
      setCurrent(index)
      setPlaying(true)
      setPlays((n) => n + 1)
      do {
        await speak(line.text, { accent: track.accent, rate: speedRef.current, gender: genderOf(line.speaker) })
        if (token.current !== my) return
        if (loopRef.current) await sleep(700)
      } while (loopRef.current && token.current === my)
      if (token.current === my) setPlaying(false)
    },
    [track, genderOf],
  )

  const playAll = useCallback(
    (from = 0) => {
      if (!track) return
      stop()
      const my = ++token.current
      const lines = track.lines.slice(from).map((l) => ({ text: l.text, gender: genderOf(l.speaker) }))
      setPlaying(true)
      setPlays((n) => n + 1)
      cancelSeq.current = speakSequence(lines, {
        accent: track.accent,
        rate: speedRef.current,
        onLine: (i) => token.current === my && setCurrent(from + i),
        onEnd: () => {
          if (token.current === my) {
            setPlaying(false)
            cancelSeq.current = null
          }
        },
      })
    },
    [track, genderOf, stop],
  )

  useEffect(() => stop, [stop])

  const setSpeed = useCallback(
    (v: number) => setSpeedState(Math.min(SPEED_MAX, Math.max(SPEED_MIN, Math.round(v * 100) / 100))),
    [],
  )
  const setLoop = useCallback((v: boolean) => setLoopState(v), [])

  return { speed, setSpeed, loop, setLoop, current, playing, playLine, playAll, stop, plays }
}

/** Stopwatch for a practice stage (seconds since mount or last reset). */
export function useStopwatch() {
  const started = useRef(Date.now())
  return {
    seconds: () => Math.round((Date.now() - started.current) / 1000),
    reset: () => {
      started.current = Date.now()
    },
  }
}
