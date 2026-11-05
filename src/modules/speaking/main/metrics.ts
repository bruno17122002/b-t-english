// Pure helpers for speaking: measured metrics from recorder analysis, session scores and phoneme matching.
import type { SpeakingFeedback, SpeakingMeasured } from '@shared/types'
import { countWords, speakingMetrics } from '@core/text'
import type { RecordingAnalysis } from '../contract'

const round1 = (v: number) => Math.round(v * 10) / 10

/** Sums the analyses of several recordings (e.g. all turns of a role-play). */
export function combineAnalyses(list: RecordingAnalysis[]): RecordingAnalysis {
  return {
    durationSec: round1(list.reduce((s, a) => s + a.durationSec, 0)),
    speakingSec: round1(list.reduce((s, a) => s + a.speakingSec, 0)),
    pauseCount: list.reduce((s, a) => s + a.pauseCount, 0),
    longestPauseSec: round1(list.reduce((m, a) => Math.max(m, a.longestPauseSec), 0)),
  }
}

/**
 * Objective metrics for one session. Pause figures come from the recorder's voice-activity analysis;
 * WPM and word accuracy come from @core/text speakingMetrics/compareWords.
 */
export function measureSpeaking(
  a: RecordingAnalysis,
  transcript: string | null,
  target?: string | null,
): SpeakingMeasured {
  const speakingSec = Math.min(a.speakingSec, a.durationSec || a.speakingSec)
  const base = speakingMetrics({
    durationSec: a.durationSec,
    segments: speakingSec > 0 ? [{ start: 0, end: speakingSec }] : [],
    transcript,
    target: target ?? null,
  })
  return { ...base, pauseCount: a.pauseCount, longestPauseSec: round1(a.longestPauseSec) }
}

/** Seconds credited to speaking quests: measured voiced time, or a cautious estimate from the transcript. */
export function creditedSpeakingSeconds(measured: SpeakingMeasured, transcript: string | null): number {
  if (measured.speakingSec > 0) return Math.round(measured.speakingSec)
  const words = transcript ? countWords(transcript) : 0
  return Math.round(Math.min(measured.durationSec, words / 2.5))
}

/** 0..1 score for a session: word accuracy when there was a target, otherwise the AI feedback average. */
export function sessionScore(measured: SpeakingMeasured, feedback: SpeakingFeedback | null): number | null {
  if (measured.wordAccuracy !== null) return measured.wordAccuracy
  if (!feedback) return null
  const parts = [
    feedback.pronunciation.score,
    feedback.fluency.score,
    feedback.grammar.score,
    feedback.vocabulary.score,
  ]
  return Math.round((parts.reduce((s, v) => s + v, 0) / parts.length / 10) * 100) / 100
}

// Accent variants and transcription conventions that should not count as mistakes.
const EQUIVALENT: string[][] = [
  ['ɹ', 'r', 'ɻ'],
  ['e', 'ɛ'],
  ['oʊ', 'əʊ'],
  ['ɒ', 'ɑ', 'ɑː'],
  ['ɜː', 'ɝ', 'ɜ', 'ɚː'],
  ['ə', 'ɚ'],
  ['iː', 'i'],
  ['uː', 'u'],
  ['ɔː', 'ɔ'],
  ['eə', 'ɛə', 'ɛɹ'],
  ['ɪə', 'ɪɹ'],
]

/** Phoneme equality used for pronunciation alignment (lenient about accent-level differences). */
export function samePhoneme(expected: string, actual: string): boolean {
  if (expected === actual) return true
  return EQUIVALENT.some((group) => group.includes(expected) && group.includes(actual))
}
