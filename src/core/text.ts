// Text utilities and objective (measured) metrics for writing and speaking.
import type { Cefr } from '@shared/content'
import type { SpeakingMeasured, TextMetrics } from '@shared/types'

export function tokenizeWords(text: string): string[] {
  return (text.toLowerCase().match(/[a-z]+(?:['’][a-z]+)*/g) ?? []).map((w) => w.replace('’', "'"))
}

export function splitSentences(text: string): string[] {
  return text
    .replace(/\s+/g, ' ')
    .split(/(?<=[.!?])\s+(?=[A-Z0-9"“'])/)
    .map((s) => s.trim())
    .filter(Boolean)
}

export function countWords(text: string): number {
  return tokenizeWords(text).length
}

const LINKING_WORDS = [
  'however',
  'therefore',
  'moreover',
  'furthermore',
  'although',
  'because',
  'while',
  'whereas',
  'consequently',
  'in addition',
  'on the other hand',
  'for example',
  'for instance',
  'as a result',
  'nevertheless',
  'firstly',
  'secondly',
  'finally',
  'in conclusion',
  'despite',
  'unless',
  'since',
]

export function textMetrics(text: string): TextMetrics {
  const words = tokenizeWords(text)
  const sentences = splitSentences(text)
  const unique = new Set(words)
  const lower = ` ${text.toLowerCase().replace(/\s+/g, ' ')} `
  const linkingWords = LINKING_WORDS.reduce((n, w) => n + (lower.split(` ${w}`).length - 1), 0)
  const avgSentenceLength = sentences.length ? words.length / sentences.length : 0
  // Type-token ratio is length-sensitive; use a 100-word window average (MSTTR-like) for longer texts.
  const lexicalDiversity = movingTtr(words)
  const longWordRatio = words.length ? words.filter((w) => w.length >= 7).length / words.length : 0
  const metrics: Omit<TextMetrics, 'heuristicCefr'> = {
    words: words.length,
    sentences: sentences.length,
    avgSentenceLength: round(avgSentenceLength, 1),
    lexicalDiversity: round(lexicalDiversity, 2),
    longWordRatio: round(longWordRatio, 2),
    linkingWords,
  }
  return { ...metrics, heuristicCefr: heuristicCefr(metrics, unique.size) }
}

function movingTtr(words: string[]): number {
  if (words.length === 0) return 0
  const win = 50
  if (words.length <= win) return new Set(words).size / words.length
  let sum = 0
  let n = 0
  for (let i = 0; i + win <= words.length; i += 10) {
    sum += new Set(words.slice(i, i + win)).size / win
    n++
  }
  return sum / n
}

/** Rough level guess from measurable features only – always labelled as a heuristic in the UI. */
export function heuristicCefr(m: Omit<TextMetrics, 'heuristicCefr'>, uniqueWords: number): Cefr {
  if (m.words < 8) return 'A1'
  let points = 0
  if (m.avgSentenceLength >= 8) points++
  if (m.avgSentenceLength >= 13) points++
  if (m.avgSentenceLength >= 18) points++
  if (m.longWordRatio >= 0.12) points++
  if (m.longWordRatio >= 0.2) points++
  if (m.linkingWords >= 2) points++
  if (m.lexicalDiversity >= 0.6 && uniqueWords >= 40) points++
  if (uniqueWords >= 120) points++
  const levels: Cefr[] = ['A1', 'A2', 'A2', 'B1', 'B1', 'B2', 'B2', 'C1', 'C1']
  return levels[Math.min(points, levels.length - 1)] as Cefr
}

const round = (v: number, d: number) => Math.round(v * 10 ** d) / 10 ** d

/** Word-level alignment (Levenshtein on tokens) between a target sentence and what was recognised. */
export function compareWords(
  target: string,
  spoken: string,
): { accuracy: number; matched: number; missing: string[]; extra: string[] } {
  const a = tokenizeWords(target)
  const b = tokenizeWords(spoken)
  const dp: number[][] = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0))
  for (let i = 0; i <= a.length; i++) (dp[i] as number[])[0] = i
  for (let j = 0; j <= b.length; j++) (dp[0] as number[])[j] = j
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      const row = dp[i] as number[]
      const prev = dp[i - 1] as number[]
      row[j] = Math.min((prev[j] as number) + 1, (row[j - 1] as number) + 1, (prev[j - 1] as number) + cost)
    }
  // Backtrack to collect matches / misses.
  let i = a.length
  let j = b.length
  let matched = 0
  const missing: string[] = []
  const extra: string[] = []
  while (i > 0 || j > 0) {
    const cur = (dp[i] as number[])[j] as number
    if (i > 0 && j > 0 && a[i - 1] === b[j - 1] && cur === ((dp[i - 1] as number[])[j - 1] as number)) {
      matched++
      i--
      j--
    } else if (i > 0 && j > 0 && cur === ((dp[i - 1] as number[])[j - 1] as number) + 1) {
      missing.unshift(a[i - 1] as string)
      extra.unshift(b[j - 1] as string)
      i--
      j--
    } else if (i > 0 && cur === ((dp[i - 1] as number[])[j] as number) + 1) {
      missing.unshift(a[i - 1] as string)
      i--
    } else {
      extra.unshift(b[j - 1] as string)
      j--
    }
  }
  return { accuracy: a.length ? matched / a.length : 0, matched, missing, extra }
}

/**
 * Objective speaking metrics. `segments` are voiced intervals (seconds) detected from the
 * microphone signal in the renderer; everything here is measured, not AI-estimated.
 */
export function speakingMetrics(input: {
  durationSec: number
  segments: { start: number; end: number }[]
  transcript: string | null
  target?: string | null
}): SpeakingMeasured {
  const segs = [...input.segments].sort((x, y) => x.start - y.start)
  const speakingSec = segs.reduce((s, x) => s + Math.max(0, x.end - x.start), 0)
  let pauseCount = 0
  let longestPause = 0
  for (let k = 1; k < segs.length; k++) {
    const gap = (segs[k] as { start: number }).start - (segs[k - 1] as { end: number }).end
    if (gap >= 0.5) {
      pauseCount++
      longestPause = Math.max(longestPause, gap)
    }
  }
  const words = input.transcript ? countWords(input.transcript) : 0
  const cmp = input.target && input.transcript !== null ? compareWords(input.target, input.transcript ?? '') : null
  return {
    durationSec: round(input.durationSec, 1),
    speakingSec: round(speakingSec, 1),
    wordsPerMinute: input.transcript && speakingSec > 1 ? Math.round((words / speakingSec) * 60) : null,
    pauseCount,
    longestPauseSec: round(longestPause, 1),
    wordAccuracy: cmp ? round(cmp.accuracy, 2) : null,
    matchedWords: cmp ? cmp.matched : null,
    missingWords: cmp ? cmp.missing : [],
    extraWords: cmp ? cmp.extra : [],
  }
}

/** Normalise free-text answers for dictation / gap checks (case, punctuation, curly quotes, spacing). */
export function normalizeAnswer(s: string): string {
  return s
    .toLowerCase()
    .replace(/[’‘]/g, "'")
    .replace(/[^a-z0-9' ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Pick blanks for a fill-in-the-gaps exercise: content words of 4+ letters, deterministic per seed. */
export function pickBlanks(sentence: string, count: number, seed: number): number[] {
  const tokens = sentence.split(/\s+/)
  const STOP = new Set([
    'this',
    'that',
    'with',
    'have',
    'from',
    'they',
    'them',
    'there',
    'their',
    'what',
    'when',
    'your',
    'would',
    'could',
    'were',
    'been',
  ])
  const candidates = tokens
    .map((t, idx) => ({ idx, w: t.replace(/[^A-Za-z']/g, '') }))
    .filter((x) => x.w.length >= 4 && !STOP.has(x.w.toLowerCase()))
  const out: number[] = []
  let s = seed
  while (out.length < count && candidates.length) {
    s = (s * 9301 + 49297) % 233280
    const pick = candidates.splice(s % candidates.length, 1)[0]
    if (pick) out.push(pick.idx)
  }
  return out.sort((x, y) => x - y)
}

export function readingWpm(words: number, seconds: number): number {
  if (seconds <= 0) return 0
  return Math.round((words / seconds) * 60)
}
