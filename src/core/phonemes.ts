// Derived from pstepanovum/Cadence@9d94329 (MIT, © 2026 Pavel Stepanov) – phoneme alignment rewritten in TypeScript.
// Pure module: IPA tokenisation plus Levenshtein alignment of expected vs recognised phonemes.
// Unlike the upstream version, insertions are reported as ops instead of being dropped.

export type PhonemeOpKind = 'match' | 'substitute' | 'delete' | 'insert'

export interface PhonemeOp {
  op: PhonemeOpKind
  // Expected phoneme (null for an insertion).
  expected: string | null
  // Recognised phoneme (null for a deletion).
  actual: string | null
  expectedIndex: number | null
  actualIndex: number | null
}

export interface PhonemeAlignment {
  ops: PhonemeOp[]
  // Levenshtein distance (each substitution, deletion or insertion costs 1).
  distance: number
  // 1 - distance / max(expected, actual, 1), clamped to 0..1. Two empty inputs score 1.
  accuracy: number
  matches: number
  substitutions: number
  deletions: number
  insertions: number
}

export interface AlignOptions {
  // Custom equality, e.g. to accept 'r' for 'ɹ'. Defaults to strict string equality.
  isSame?: (expected: string, actual: string) => boolean
}

// Multi-character phonemes, longest first so greedy matching picks e.g. 'tʃ' over 't'.
const MULTI_CHAR_PHONEMES = ['tʃ', 'dʒ', 'eɪ', 'aɪ', 'ɔɪ', 'aʊ', 'oʊ', 'əʊ', 'ɪə', 'eə', 'ɛə', 'ʊə'] as const

// Marks that are dropped entirely: stress, syllable breaks, IPA slashes/brackets, aspiration, tie bars.
const IGNORED = new Set(['ˈ', 'ˌ', "'", '.', '/', '[', ']', '(', ')', 'ʰ', '͡', '͜', '‿', '|'])
const LENGTH_MARKS = new Set(['ː', 'ˑ'])

// Single-codepoint or ASCII spellings mapped to the canonical form used by the content packs.
const CANONICAL: Readonly<Record<string, string>> = {
  ':': 'ː',
  g: 'ɡ',
  ʧ: 'tʃ',
  ʤ: 'dʒ',
}

/** Normalise a raw IPA string: NFC, ASCII colon to length mark, ligatures to digraphs, drop stress marks. */
export function normalizeIpa(ipa: string): string {
  let out = ''
  for (const ch of ipa.normalize('NFC')) {
    if (IGNORED.has(ch)) continue
    out += CANONICAL[ch] ?? ch
  }
  return out
}

/** True for combining diacritics (e.g. syllabic or nasal marks) that belong to the previous phoneme. */
function isCombining(ch: string): boolean {
  return /\p{M}/u.test(ch)
}

function tokenizeChunk(chunk: string): string[] {
  const chars = Array.from(chunk)
  const tokens: string[] = []
  let i = 0
  while (i < chars.length) {
    const ch = chars[i] as string
    if (LENGTH_MARKS.has(ch) || isCombining(ch)) {
      // Attach to the previous phoneme (iː, uː, ɑː ...); a stray leading mark is dropped.
      if (tokens.length > 0) {
        if (LENGTH_MARKS.has(ch)) tokens[tokens.length - 1] += 'ː'
        else tokens[tokens.length - 1] += ch
      }
      i += 1
      continue
    }
    const pair = ch + (chars[i + 1] ?? '')
    if ((MULTI_CHAR_PHONEMES as readonly string[]).includes(pair)) {
      tokens.push(pair)
      i += 2
    } else {
      tokens.push(ch)
      i += 1
    }
  }
  return tokens
}

/**
 * Split an IPA string into phonemes. Whitespace-separated input ('k æ t') is honoured as given;
 * unspaced input ('/ˈtʃeɪndʒ/') is split greedily, keeping affricates, diphthongs and length marks together.
 */
export function tokenizeIpa(ipa: string): string[] {
  const normalized = normalizeIpa(ipa)
  return normalized
    .split(/\s+/)
    .filter((chunk) => chunk.length > 0)
    .flatMap(tokenizeChunk)
}

/** Align expected vs recognised phonemes (Levenshtein with backtrace) and score the attempt. */
export function alignPhonemes(
  expected: readonly string[],
  actual: readonly string[],
  options: AlignOptions = {},
): PhonemeAlignment {
  const same = options.isSame ?? ((a: string, b: string) => a === b)
  const rows = expected.length
  const cols = actual.length
  const dp: number[][] = Array.from({ length: rows + 1 }, () => new Array<number>(cols + 1).fill(0))
  const at = (i: number, j: number): number => (dp[i] as number[])[j] as number
  for (let i = 0; i <= rows; i++) (dp[i] as number[])[0] = i
  for (let j = 0; j <= cols; j++) (dp[0] as number[])[j] = j

  for (let i = 1; i <= rows; i++) {
    const row = dp[i] as number[]
    for (let j = 1; j <= cols; j++) {
      const cost = same(expected[i - 1] as string, actual[j - 1] as string) ? 0 : 1
      row[j] = Math.min(at(i - 1, j) + 1, at(i, j - 1) + 1, at(i - 1, j - 1) + cost)
    }
  }

  // Backtrace from the bottom-right corner; prefer diagonal, then deletion, then insertion (as upstream).
  const ops: PhonemeOp[] = []
  let i = rows
  let j = cols
  while (i > 0 || j > 0) {
    const exp = expected[i - 1]
    const act = actual[j - 1]
    if (i > 0 && j > 0 && exp !== undefined && act !== undefined) {
      const isMatch = same(exp, act)
      if (at(i, j) === at(i - 1, j - 1) + (isMatch ? 0 : 1)) {
        ops.push({
          op: isMatch ? 'match' : 'substitute',
          expected: exp,
          actual: act,
          expectedIndex: i - 1,
          actualIndex: j - 1,
        })
        i -= 1
        j -= 1
        continue
      }
    }
    if (i > 0 && exp !== undefined && at(i, j) === at(i - 1, j) + 1) {
      ops.push({ op: 'delete', expected: exp, actual: null, expectedIndex: i - 1, actualIndex: null })
      i -= 1
      continue
    }
    ops.push({ op: 'insert', expected: null, actual: act ?? null, expectedIndex: null, actualIndex: j - 1 })
    j -= 1
  }
  ops.reverse()

  const distance = at(rows, cols)
  const baseline = Math.max(rows, cols, 1)
  const accuracy = Math.min(1, Math.max(0, 1 - distance / baseline))
  const count = (kind: PhonemeOpKind): number => ops.filter((o) => o.op === kind).length
  return {
    ops,
    distance,
    accuracy,
    matches: count('match'),
    substitutions: count('substitute'),
    deletions: count('delete'),
    insertions: count('insert'),
  }
}

/** Convenience: tokenise two IPA strings and align them. */
export function alignIpa(expectedIpa: string, actualIpa: string, options: AlignOptions = {}): PhonemeAlignment {
  return alignPhonemes(tokenizeIpa(expectedIpa), tokenizeIpa(actualIpa), options)
}
