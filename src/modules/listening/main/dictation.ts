// Pure helpers for dictation and gap-fill checking (served to the renderer through listening:check*).
// Checking is deliberately lenient: case, punctuation, contractions, digits vs number words and small
// spelling slips are accepted, while missing or wrong words are shown in a word-level diff.
import { compareWords, normalizeAnswer, pickBlanks } from '@core/text'
import type { DictationCheck, DiffToken, GapLine, GapResult } from '../contract'

const NUMBER_WORDS: Readonly<Record<string, string>> = {
  '0': 'zero',
  '1': 'one',
  '2': 'two',
  '3': 'three',
  '4': 'four',
  '5': 'five',
  '6': 'six',
  '7': 'seven',
  '8': 'eight',
  '9': 'nine',
  '10': 'ten',
  '11': 'eleven',
  '12': 'twelve',
  '13': 'thirteen',
  '14': 'fourteen',
  '15': 'fifteen',
  '16': 'sixteen',
  '17': 'seventeen',
  '18': 'eighteen',
  '19': 'nineteen',
  '20': 'twenty',
  '30': 'thirty',
  '40': 'forty',
  '50': 'fifty',
  '60': 'sixty',
  '70': 'seventy',
  '80': 'eighty',
  '90': 'ninety',
  '100': 'hundred',
  '1st': 'first',
  '2nd': 'second',
  '3rd': 'third',
  '4th': 'fourth',
  '5th': 'fifth',
}

/** Equivalent spellings that should never count as mistakes. */
const VARIANTS: Readonly<Record<string, string>> = {
  ok: 'okay',
  alright: 'all right',
  cannot: 'can not',
  gonna: 'going to',
  wanna: 'want to',
}

const CONTRACTIONS: [RegExp, string][] = [
  [/\blet's\b/g, 'let us'],
  [/\bcan't\b/g, 'can not'],
  [/\bwon't\b/g, 'will not'],
  [/\bshan't\b/g, 'shall not'],
  [/n't\b/g, ' not'],
  [/'m\b/g, ' am'],
  [/'re\b/g, ' are'],
  [/'ll\b/g, ' will'],
  [/'ve\b/g, ' have'],
  [/'d\b/g, ' would'],
  [/\b(it|that|what|there|here|he|she|who|where|how|when|everything|nothing|something)'s\b/g, '$1 is'],
]

/** Tokenises a sentence for dictation comparison (lower case, no punctuation, contractions expanded). */
export function dictationTokens(text: string): string[] {
  let t = ` ${normalizeAnswer(text)} `
  for (const [re, rep] of CONTRACTIONS) t = t.replace(re, rep)
  return t
    .split(' ')
    .map((w) => w.replace(/^'+|'+$/g, ''))
    .filter(Boolean)
    .flatMap((w) => (VARIANTS[w] ?? NUMBER_WORDS[w] ?? w).split(' '))
}

/** Plain Levenshtein distance between two short strings. */
export function editDistance(a: string, b: string): number {
  if (a === b) return 0
  if (!a.length) return b.length
  if (!b.length) return a.length
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j)
  for (let i = 1; i <= a.length; i++) {
    const cur = [i]
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      cur[j] = Math.min((prev[j] as number) + 1, (cur[j - 1] as number) + 1, (prev[j - 1] as number) + cost)
    }
    prev = cur
  }
  return prev[b.length] as number
}

/** Number of letter slips tolerated for a word of this length (none for short words like "a", "the"). */
export function allowedTypos(word: string): number {
  if (word.length >= 8) return 2
  if (word.length >= 5) return 1
  return 0
}

export function wordMatch(expected: string, typed: string): 'ok' | 'typo' | 'wrong' {
  if (expected === typed) return 'ok'
  const limit = allowedTypos(expected)
  if (limit > 0 && editDistance(expected, typed) <= limit) return 'typo'
  return 'wrong'
}

/** Compares a dictation answer with the expected line and returns a word-level diff. */
export function checkDictation(expected: string, typed: string): DictationCheck {
  const a = dictationTokens(expected)
  const b = dictationTokens(typed)
  // Weighted alignment: exact match 0, typo 0.4, substitution 1, insertion/deletion 1.
  const cost = (i: number, j: number) => {
    const m = wordMatch(a[i] as string, b[j] as string)
    return m === 'ok' ? 0 : m === 'typo' ? 0.4 : 1
  }
  const dp: number[][] = Array.from({ length: a.length + 1 }, (_, i) =>
    Array.from({ length: b.length + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)),
  )
  const at = (i: number, j: number) => (dp[i] as number[])[j] as number
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++)
      (dp[i] as number[])[j] = Math.min(at(i - 1, j) + 1, at(i, j - 1) + 1, at(i - 1, j - 1) + cost(i - 1, j - 1))

  const tokens: DiffToken[] = []
  let i = a.length
  let j = b.length
  const eq = (x: number, y: number) => Math.abs(x - y) < 1e-9
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && eq(at(i, j), at(i - 1, j - 1) + cost(i - 1, j - 1))) {
      const m = wordMatch(a[i - 1] as string, b[j - 1] as string)
      tokens.push({ status: m, expected: a[i - 1] as string, typed: b[j - 1] as string })
      i--
      j--
    } else if (i > 0 && eq(at(i, j), at(i - 1, j) + 1)) {
      tokens.push({ status: 'missing', expected: a[i - 1] as string, typed: null })
      i--
    } else {
      tokens.push({ status: 'extra', expected: null, typed: b[j - 1] as string })
      j--
    }
  }
  tokens.reverse()
  const good = tokens.filter((t) => t.status === 'ok' || t.status === 'typo').length
  const hasExtra = tokens.some((t) => t.status === 'extra')
  const accuracy = a.length ? good / a.length : b.length ? 0 : 1
  return {
    accepted: a.length > 0 && good === a.length && !hasExtra,
    perfect: a.length > 0 && tokens.every((t) => t.status === 'ok'),
    accuracy: Math.round(accuracy * 100) / 100,
    strictAccuracy: Math.round(compareWords(expected, typed).accuracy * 100) / 100,
    tokens,
  }
}

// ---------- gap fill ----------

/** Builds a deterministic gap-fill version of a line using pickBlanks from @core/text. */
export function buildGaps(text: string, seed: number, count?: number): GapLine {
  const tokens = text.split(/\s+/).filter(Boolean)
  const wanted = count ?? Math.max(1, Math.min(3, Math.round(tokens.length / 5)))
  const idx = pickBlanks(tokens.join(' '), wanted, seed)
  const blanks = idx.map((index) => {
    const tok = tokens[index] as string
    const m = /^([^A-Za-z']*)(.*?)([^A-Za-z']*)$/.exec(tok)
    return { index, before: m?.[1] ?? '', answer: m?.[2] ?? tok, after: m?.[3] ?? '' }
  })
  return { tokens, blanks }
}

export function checkGap(answer: string, typed: string): GapResult {
  const a = dictationTokens(answer).join(' ')
  const b = dictationTokens(typed).join(' ')
  if (!b) return 'wrong'
  return wordMatch(a, b)
}

/** Stable small hash used as the blank seed for a track line. */
export function lineSeed(trackId: string, line: number): number {
  let h = 7
  for (const ch of `${trackId}#${line}`) h = (h * 31 + ch.charCodeAt(0)) % 233280
  return h
}

/** Rough spoken length of a track at the given speed (≈150 wpm + 0.25 s gap per line). */
export function estimateSeconds(words: number, lines: number, speed = 1): number {
  return Math.round(((words / 150) * 60) / Math.max(0.5, speed) + lines * 0.25)
}
