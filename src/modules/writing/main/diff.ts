// Word-level diff (LCS) between the learner's text and the corrected text. Pure and unit-tested.

import type { DiffOp, DiffType } from '../contract'

export type { DiffOp }

export interface Token {
  text: string
  /** Whitespace that followed the token in the source. */
  ws: string
}

const TOKEN_RE = /([\p{L}\p{N}]+(?:['’-][\p{L}\p{N}]+)*|[^\s\p{L}\p{N}])(\s*)/gu

/** Splits text into words and single punctuation marks, remembering the whitespace after each. */
export function tokenize(text: string): Token[] {
  const out: Token[] = []
  for (const m of text.matchAll(TOKEN_RE)) out.push({ text: m[1] ?? '', ws: m[2] ?? '' })
  return out
}

const key = (t: Token) => t.text.replace(/[’‘]/g, "'").replace(/[“”]/g, '"')

/** Above this many cells the middle part is treated as one replacement instead of running LCS. */
const MAX_CELLS = 4_000_000

/**
 * Computes a word-level diff from `original` to `corrected`. Equal and inserted segments keep the
 * corrected text's spacing, deleted segments keep the original spacing. Adjacent ops of the same type
 * are merged; within a changed block deletions come before insertions.
 */
export function wordDiff(original: string, corrected: string): DiffOp[] {
  const a = tokenize(original)
  const b = tokenize(corrected)
  const ops: { type: DiffType; tok: Token }[] = []

  // Common prefix / suffix shortcut keeps the LCS table small for mostly-correct texts.
  let start = 0
  while (start < a.length && start < b.length && key(a[start] as Token) === key(b[start] as Token)) start++
  let endA = a.length
  let endB = b.length
  while (endA > start && endB > start && key(a[endA - 1] as Token) === key(b[endB - 1] as Token)) {
    endA--
    endB--
  }
  for (let i = 0; i < start; i++) ops.push({ type: 'equal', tok: b[i] as Token })

  const midA = a.slice(start, endA)
  const midB = b.slice(start, endB)
  const n = midA.length
  const m = midB.length
  if (n * m > MAX_CELLS) {
    for (const t of midA) ops.push({ type: 'delete', tok: t })
    for (const t of midB) ops.push({ type: 'insert', tok: t })
  } else if (n || m) {
    // dp[i][j] = LCS length of midA[i:] and midB[j:]
    const w = m + 1
    const dp = new Int32Array((n + 1) * w)
    for (let i = n - 1; i >= 0; i--)
      for (let j = m - 1; j >= 0; j--)
        dp[i * w + j] =
          key(midA[i] as Token) === key(midB[j] as Token)
            ? (dp[(i + 1) * w + j + 1] as number) + 1
            : Math.max(dp[(i + 1) * w + j] as number, dp[i * w + j + 1] as number)
    let i = 0
    let j = 0
    while (i < n || j < m) {
      if (i < n && j < m && key(midA[i] as Token) === key(midB[j] as Token)) {
        ops.push({ type: 'equal', tok: midB[j] as Token })
        i++
        j++
      } else if (j >= m || (i < n && (dp[(i + 1) * w + j] as number) >= (dp[i * w + j + 1] as number))) {
        ops.push({ type: 'delete', tok: midA[i] as Token })
        i++
      } else {
        ops.push({ type: 'insert', tok: midB[j] as Token })
        j++
      }
    }
  }
  for (let k = endB; k < b.length; k++) ops.push({ type: 'equal', tok: b[k] as Token })

  // Reorder inserts/deletes inside each changed block (deletes first), then merge neighbours.
  const ordered: { type: DiffType; tok: Token }[] = []
  let block: { type: DiffType; tok: Token }[] = []
  const flush = () => {
    ordered.push(...block.filter((o) => o.type === 'delete'), ...block.filter((o) => o.type === 'insert'))
    block = []
  }
  for (const op of ops) {
    if (op.type === 'equal') {
      flush()
      ordered.push(op)
    } else block.push(op)
  }
  flush()

  const merged: DiffOp[] = []
  for (const op of ordered) {
    const text = op.tok.text + (op.tok.ws ? (op.tok.ws.includes('\n') ? op.tok.ws : ' ') : '')
    const last = merged[merged.length - 1]
    if (last && last.type === op.type) last.text += text
    else merged.push({ type: op.type, text })
  }
  return merged
}

export interface DiffStats {
  inserted: number
  deleted: number
  unchanged: number
  /** Share of corrected words that differ from the original (0..1). */
  changeRatio: number
}

const countTokens = (s: string) => tokenize(s).filter((t) => /[\p{L}\p{N}]/u.test(t.text)).length

export function diffStats(ops: DiffOp[]): DiffStats {
  let inserted = 0
  let deleted = 0
  let unchanged = 0
  for (const op of ops) {
    const n = countTokens(op.text)
    if (op.type === 'insert') inserted += n
    else if (op.type === 'delete') deleted += n
    else unchanged += n
  }
  const total = unchanged + Math.max(inserted, deleted)
  return {
    inserted,
    deleted,
    unchanged,
    changeRatio: total ? Math.round((Math.max(inserted, deleted) / total) * 100) / 100 : 0,
  }
}

/** Rebuilds either side of the diff (useful for tests and for "show original / corrected" toggles). */
export function applyDiff(ops: DiffOp[], side: 'original' | 'corrected'): string {
  return ops
    .filter((o) => o.type === 'equal' || o.type === (side === 'original' ? 'delete' : 'insert'))
    .map((o) => o.text)
    .join('')
}
