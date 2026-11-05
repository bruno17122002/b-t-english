// Pure helpers for vocabulary practice modes and the word bank UI (no React, no DOM) – unit tested in
// tests/unit/vocabulary-practice.test.ts.

export type Rng = () => number

/** Small seeded PRNG so practice rounds are reproducible in tests. */
export function mulberry32(seed: number): Rng {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export function shuffle<T>(xs: readonly T[], rng: Rng = Math.random): T[] {
  const a = [...xs]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    const tmp = a[i] as T
    a[i] = a[j] as T
    a[j] = tmp
  }
  return a
}

const normMeaning = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFC')
    .replace(/[()[\].,;:!?"'“”‘’]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
export const normWord = (s: string) => s.toLowerCase().replace(/[’‘`]/g, "'").replace(/\s+/g, ' ').trim()

export interface WordLike {
  word: string
  meaningVi: string
}

export interface Mcq {
  /** The thing being asked about (a word, or a meaning for reverse questions). */
  prompt: string
  options: string[]
  answerIndex: number
}

/**
 * Meaning quiz: "what does <word> mean?" with Vietnamese options. Distractors come from other words
 * (word bank first, then dictionary extras) and never repeat the right meaning or each other.
 * Returns null when no distractor is available.
 */
export function buildMeaningMcq(target: WordLike, pool: readonly WordLike[], rng: Rng = Math.random, size = 4): Mcq | null {
  const right = target.meaningVi.trim()
  if (!right) return null
  const seen = new Set([normMeaning(right)])
  const distractors: string[] = []
  for (const w of shuffle(pool, rng)) {
    if (distractors.length >= size - 1) break
    if (normWord(w.word) === normWord(target.word)) continue
    const m = w.meaningVi.trim()
    const key = normMeaning(m)
    if (!m || seen.has(key)) continue
    seen.add(key)
    distractors.push(m)
  }
  if (!distractors.length) return null
  const options = shuffle([right, ...distractors], rng)
  return { prompt: target.word, options, answerIndex: options.indexOf(right) }
}

/** Similarity used to pick tricky distractors for listening (same start, similar length). */
function closeness(a: string, b: string): number {
  let prefix = 0
  while (prefix < a.length && a[prefix] === b[prefix]) prefix++
  return prefix * 2 - Math.abs(a.length - b.length)
}

/**
 * Listening match: the learner hears `target.word` and picks the written word. Distractors are
 * preferably words that look/sound similar (shared beginning, similar length).
 */
export function buildListeningMcq(target: WordLike, pool: readonly WordLike[], rng: Rng = Math.random, size = 4): Mcq | null {
  const t = normWord(target.word)
  const candidates = [...new Map(pool.map((w) => [normWord(w.word), w.word.trim()])).entries()]
    .filter(([k]) => k && k !== t)
    .map(([k, word]) => ({ word, score: closeness(t, k) + rng() * 2 }))
    .sort((a, b) => b.score - a.score)
  const distractors = candidates.slice(0, size - 1).map((c) => c.word)
  if (!distractors.length) return null
  const options = shuffle([target.word.trim(), ...distractors], rng)
  return { prompt: target.word.trim(), options, answerIndex: options.indexOf(target.word.trim()) }
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

export interface Cloze {
  before: string
  after: string
  /** The form of the word exactly as it appears in the sentence. */
  answer: string
}

/**
 * Blanks `word` in `sentence`. Handles common inflections (plural, -ed, -ing, -ies, dropped "e") and
 * multi-word phrases. Returns null when the word cannot be found.
 */
export function buildCloze(word: string, sentence: string): Cloze | null {
  const w = word.trim()
  if (!w || !sentence.trim()) return null
  const forms = [`${escapeRe(w)}(?:s|es|ed|d|ing|er|est|ly|'s|’s)?`]
  if (/e$/i.test(w)) forms.push(`${escapeRe(w.slice(0, -1))}(?:ing|ed)`)
  if (/y$/i.test(w)) forms.push(`${escapeRe(w.slice(0, -1))}(?:ies|ied)`)
  if (/[^aeiou][aeiou][bdgmnprt]$/i.test(w)) forms.push(`${escapeRe(w)}${escapeRe(w.slice(-1))}(?:ed|ing|er)`)
  const re = new RegExp(`(^|[^\\p{L}\\p{N}])(${forms.join('|')})(?![\\p{L}\\p{N}])`, 'iu')
  const m = re.exec(sentence)
  if (!m || m[2] === undefined) return null
  const start = m.index + (m[1]?.length ?? 0)
  return { before: sentence.slice(0, start), after: sentence.slice(start + m[2].length), answer: m[2] }
}

/** First example (or context sentence) of an item that can be turned into a cloze. */
export function pickCloze(item: { word: string; examples: readonly string[]; context?: string }): (Cloze & { sentence: string }) | null {
  for (const s of [...item.examples, item.context ?? '']) {
    const c = buildCloze(item.word, s)
    if (c) return { ...c, sentence: s }
  }
  return null
}

export function levenshtein(a: string, b: string): number {
  if (a === b) return 0
  if (!a.length) return b.length
  if (!b.length) return a.length
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i)
  for (let i = 1; i <= a.length; i++) {
    const cur = [i]
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      cur[j] = Math.min((prev[j] ?? 0) + 1, (cur[j - 1] ?? 0) + 1, (prev[j - 1] ?? 0) + cost)
    }
    prev = cur
  }
  return prev[b.length] ?? 0
}

export type SpellingGrade = 'correct' | 'close' | 'wrong'

/** Typed-answer grading: exact (case/space-insensitive) or one typo away for words of 4+ letters. */
export function gradeSpelling(expected: string, input: string): SpellingGrade {
  const e = normWord(expected)
  const i = normWord(input)
  if (!i) return 'wrong'
  if (e === i) return 'correct'
  const limit = e.length >= 8 ? 2 : e.length >= 4 ? 1 : 0
  return levenshtein(e, i) <= limit ? 'close' : 'wrong'
}

/** "resilient" → "r _ _ _ _ _ _ _ t" (keeps spaces and hyphens of phrases). */
export function letterHint(word: string): string {
  const w = word.trim()
  return [...w]
    .map((ch, i) => (i === 0 || i === w.length - 1 || !/[\p{L}]/u.test(ch) ? ch : '_'))
    .join(' ')
}

export type Strength = 'new' | 'weak' | 'fair' | 'strong'

/** Memory strength bucket from FSRS retrievability (0..1) and review state. */
export function strengthOf(review: { state: string; retrievability: number; reps: number }): Strength {
  if (review.state === 'new' || review.reps === 0) return 'new'
  if (review.retrievability >= 0.9) return 'strong'
  if (review.retrievability >= 0.7) return 'fair'
  return 'weak'
}

/** Bars for the review forecast mini chart: heights scaled to `height`, with a minimum visible stub. */
export function forecastBars(forecast: readonly { date: string; count: number }[], height: number): { date: string; count: number; h: number }[] {
  const max = Math.max(1, ...forecast.map((f) => f.count))
  return forecast.map((f) => ({ ...f, h: f.count ? Math.max(3, Math.round((f.count / max) * height)) : 1 }))
}

/** Picks practice words, weakest first with some variety: shuffles the weaker half of the bank. */
export function pickPracticeSet<T extends { review: { retrievability: number; state: string; reps: number } }>(
  items: readonly T[],
  count: number,
  rng: Rng = Math.random,
): T[] {
  const sorted = [...items].sort((a, b) => {
    const ra = a.review.reps === 0 ? 0.5 : a.review.retrievability
    const rb = b.review.reps === 0 ? 0.5 : b.review.retrievability
    return ra - rb
  })
  const head = sorted.slice(0, Math.max(count * 2, Math.ceil(sorted.length / 2)))
  return shuffle(head, rng).slice(0, count)
}

/** Splits user-entered lists (one per line, or comma separated for short items). */
export function splitList(text: string, allowCommas = false): string[] {
  const parts = text.split(allowCommas ? /[\n,;]/ : /\n/)
  return [...new Set(parts.map((p) => p.trim()).filter(Boolean))]
}
