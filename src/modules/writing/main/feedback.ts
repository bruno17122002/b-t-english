// Pure helpers around writing feedback: error marking, self-correction check, offline checklist, scores.
import type { WritingFeedback, TextMetrics } from '@shared/types'
import { splitSentences, tokenizeWords } from '@core/text'
import type { CheckItem, MarkedSegment } from '../contract'

const isWordChar = (c: string | undefined) => !!c && /[\p{L}\p{N}'’]/u.test(c)

/** Finds `needle` in `hay` from `from`, requiring word boundaries where the needle starts/ends with a letter. */
function findPhrase(hay: string, needle: string, from: number, caseSensitive: boolean): number {
  const h = caseSensitive ? hay : hay.toLowerCase()
  const n = caseSensitive ? needle : needle.toLowerCase()
  let pos = h.indexOf(n, from)
  while (pos >= 0) {
    const okStart = !isWordChar(n[0]) || !isWordChar(h[pos - 1])
    const okEnd = !isWordChar(n[n.length - 1]) || !isWordChar(h[pos + n.length])
    if (okStart && okEnd) return pos
    pos = h.indexOf(n, pos + 1)
  }
  return -1
}

const unquote = (s: string) => s.replace(/[’‘]/g, "'")

/**
 * Marks the first non-overlapping occurrence of each error's `original` phrase in `text`: exact case
 * and whole words first, then case-insensitive. Errors whose phrase cannot be found are not marked.
 */
export function markErrors(text: string, errors: { original: string }[]): MarkedSegment[] {
  const hay = unquote(text)
  const ranges: { start: number; end: number; idx: number }[] = []
  errors.forEach((e, idx) => {
    const needle = unquote(e.original.trim())
    if (!needle) return
    for (const caseSensitive of [true, false]) {
      let from = 0
      for (;;) {
        const start = findPhrase(hay, needle, from, caseSensitive)
        if (start < 0) break
        const end = start + needle.length
        if (!ranges.some((r) => start < r.end && end > r.start)) {
          ranges.push({ start, end, idx })
          return
        }
        from = start + 1
      }
    }
  })
  ranges.sort((x, y) => x.start - y.start)
  const out: MarkedSegment[] = []
  let pos = 0
  for (const r of ranges) {
    if (r.start > pos) out.push({ text: text.slice(pos, r.start), errorIndex: null })
    out.push({ text: text.slice(r.start, r.end), errorIndex: r.idx })
    pos = r.end
  }
  if (pos < text.length || !out.length) out.push({ text: text.slice(pos), errorIndex: null })
  return out
}

/**
 * Offline check of a self-corrected text: an error counts as fixed when the suggested correction now
 * appears, or the original wrong phrase is gone. Capitalisation-only errors are checked case-sensitively.
 */
export function checkFixes(
  errors: { original: string; correction: string }[],
  revised: string,
): { fixed: number[]; remaining: number[] } {
  const hay = unquote(revised).replace(/\s+/g, ' ')
  const has = (phrase: string, caseSensitive: boolean) => {
    const p = unquote(phrase).replace(/\s+/g, ' ').trim()
    return p.length > 0 && findPhrase(hay, p, 0, caseSensitive) >= 0
  }
  const fixed: number[] = []
  const remaining: number[] = []
  errors.forEach((e, i) => {
    const caseOnly =
      e.original.trim() !== e.correction.trim() && e.original.trim().toLowerCase() === e.correction.trim().toLowerCase()
    const ok = caseOnly ? !has(e.original, true) : has(e.correction, false) || !has(e.original, false)
    ;(ok ? fixed : remaining).push(i)
  })
  return { fixed, remaining }
}

export function averageScore(scores: WritingFeedback['scores']): number {
  const vals = Object.values(scores)
  return vals.length ? Math.round((vals.reduce((a, b) => a + b, 0) / vals.length) * 10) / 10 : 0
}

// ---------- offline checklist ----------
const CONNECTED_TASKS = new Set(['paragraph', 'journal', 'email', 'business', 'essay', 'creative', 'free'])
const GREETING = /^(dear|hi|hello|good (morning|afternoon|evening)|to whom)/i
const SIGN_OFF = /(regards|best|sincerely|thanks|thank you|cheers|yours|love)[,!.]?\s*\n?.{0,60}$/i

export function buildChecklist(
  text: string,
  task: { taskType: string; minWords: number; maxWords: number; hints: string[] },
  metrics: TextMetrics,
): CheckItem[] {
  const items: CheckItem[] = []
  const words = metrics.words
  items.push({
    id: 'length',
    en: `Length: ${words} words (target ${task.minWords}–${task.maxWords})`,
    vi: `Độ dài: ${words} từ (mục tiêu ${task.minWords}–${task.maxWords})`,
    status: words < task.minWords ? 'fail' : words > task.maxWords ? 'warn' : 'pass',
  })
  const sentences = splitSentences(text)
  const badStart = sentences.filter((s) => /^[a-z]/.test(s)).length
  items.push({
    id: 'capitals',
    en: 'Every sentence starts with a capital letter',
    vi: 'Mỗi câu bắt đầu bằng chữ in hoa',
    status: badStart === 0 ? 'pass' : 'fail',
  })
  items.push({
    id: 'end-punctuation',
    en: 'The text ends with . ! or ?',
    vi: 'Kết thúc bằng dấu . ! hoặc ?',
    status: /[.!?)"”']\s*$/.test(text.trim()) ? 'pass' : 'fail',
  })
  items.push({
    id: 'pronoun-i',
    en: 'The pronoun “I” is always a capital letter',
    vi: 'Đại từ “I” luôn viết hoa',
    status: /(^|[^A-Za-z'’.])i(?![A-Za-z]|\.e)/.test(text) ? 'fail' : 'pass',
  })
  if (sentences.length >= 2) {
    const avg = metrics.avgSentenceLength
    items.push({
      id: 'sentence-length',
      en: `Sentence length looks natural (average ${avg} words)`,
      vi: `Độ dài câu hợp lý (trung bình ${avg} từ)`,
      status: avg > 30 ? 'warn' : avg < 4 ? 'warn' : 'pass',
    })
  }
  if (CONNECTED_TASKS.has(task.taskType) && words >= 40) {
    items.push({
      id: 'linking',
      en: `Uses linking words (found ${metrics.linkingWords})`,
      vi: `Có dùng từ nối (tìm thấy ${metrics.linkingWords})`,
      status: metrics.linkingWords >= 2 ? 'pass' : metrics.linkingWords === 1 ? 'warn' : 'fail',
    })
  }
  if (task.taskType === 'essay') {
    const paragraphs = text.split(/\n\s*\n/).filter((p) => p.trim()).length
    items.push({
      id: 'paragraphs',
      en: `Organised in paragraphs (found ${paragraphs}; aim for 3–5)`,
      vi: `Chia đoạn rõ ràng (có ${paragraphs} đoạn; nên có 3–5)`,
      status: paragraphs >= 3 ? 'pass' : paragraphs === 2 ? 'warn' : 'fail',
    })
  }
  if (task.taskType === 'email' || task.taskType === 'business') {
    items.push({
      id: 'greeting',
      en: 'Starts with a greeting (Dear… / Hi…)',
      vi: 'Có lời chào mở đầu (Dear… / Hi…)',
      status: GREETING.test(text.trim()) ? 'pass' : 'fail',
    })
    items.push({
      id: 'sign-off',
      en: 'Ends with a sign-off (Best regards, …)',
      vi: 'Có lời kết thư (Best regards, …)',
      status: SIGN_OFF.test(text.trim()) ? 'pass' : 'warn',
    })
  }
  const tokens = tokenizeWords(text)
  const repeats = new Map<string, number>()
  for (const t of tokens) if (t.length >= 5) repeats.set(t, (repeats.get(t) ?? 0) + 1)
  const overused = [...repeats.entries()]
    .filter(([, n]) => n >= 4 && n / Math.max(1, tokens.length) > 0.03)
    .map(([w]) => w)
  if (tokens.length >= 40)
    items.push({
      id: 'variety',
      en: overused.length ? `Try synonyms for: ${overused.slice(0, 3).join(', ')}` : 'Good word variety',
      vi: overused.length ? `Thử dùng từ đồng nghĩa cho: ${overused.slice(0, 3).join(', ')}` : 'Từ vựng đa dạng',
      status: overused.length ? 'warn' : 'pass',
    })
  task.hints.forEach((h, i) => items.push({ id: `hint-${i}`, en: h, vi: h, status: 'manual' }))
  return items
}
