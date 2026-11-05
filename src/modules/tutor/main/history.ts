// Token control for long tutor chats: only the last few turns go to the model verbatim; older turns are
// represented by a short rolling summary (AI-written when available) plus compressed one-line notes.
// Pure functions – unit tested in tests/unit/tutor-history.test.ts.

export interface HistoryMessage {
  id: number
  role: 'user' | 'assistant'
  content: string
}

export interface WindowOptions {
  /** Max number of messages sent verbatim. */
  window?: number
  /** Stored rolling summary covering messages with id <= summarizedUptoId. */
  summary?: string
  summarizedUptoId?: number
  maxSummaryChars?: number
  /** Long messages are clipped before they are sent. */
  maxMessageChars?: number
}

export interface HistoryWindow {
  recent: { role: 'user' | 'assistant'; content: string }[]
  /** Summary text to put in the system prompt ('' when the whole chat fits). */
  summary: string
  /** Messages left out of `recent`. */
  droppedCount: number
  /** Dropped messages not yet covered by the stored summary (candidates for the next summarisation). */
  unsummarized: HistoryMessage[]
  /** Id of the newest dropped message (0 when nothing was dropped). */
  lastDroppedId: number
}

export const HISTORY_WINDOW = 12
export const SUMMARY_MAX_CHARS = 900
/** Re-summarise once this many dropped messages are not covered by the stored summary. */
export const SUMMARY_REFRESH_AFTER = 8

export function clip(text: string, max: number): string {
  const t = text.replace(/\s+/g, ' ').trim()
  return t.length <= max ? t : `${t.slice(0, Math.max(0, max - 1)).trimEnd()}…`
}

export const compressLine = (m: HistoryMessage, max = 110) =>
  `${m.role === 'user' ? 'Learner' : 'Tutor'}: ${clip(m.content, max)}`

export function windowHistory(messages: HistoryMessage[], opts: WindowOptions = {}): HistoryWindow {
  const size = Math.max(2, opts.window ?? HISTORY_WINDOW)
  const maxSummary = opts.maxSummaryChars ?? SUMMARY_MAX_CHARS
  const maxMsg = opts.maxMessageChars ?? 1200
  const sorted = [...messages].sort((a, b) => a.id - b.id)
  let start = Math.max(0, sorted.length - size)
  // Chat APIs expect the history to open with a learner turn.
  while (start < sorted.length && sorted[start]?.role === 'assistant') start++
  const dropped = sorted.slice(0, start)
  const kept = sorted.slice(start)
  const upto = opts.summarizedUptoId ?? 0
  const stored = opts.summary?.trim() ?? ''
  const unsummarized = dropped.filter((m) => m.id > upto)

  let summary = ''
  if (dropped.length) {
    const lines = unsummarized.map((m) => compressLine(m))
    // Keep the newest notes when space runs out.
    const budget = maxSummary - (stored ? stored.length + 1 : 0)
    const picked: string[] = []
    let used = 0
    for (let i = lines.length - 1; i >= 0; i--) {
      const line = lines[i] as string
      if (used + line.length + 1 > budget) break
      picked.unshift(line)
      used += line.length + 1
    }
    const joined = [stored, ...picked].filter(Boolean).join('\n')
    // A stored summary longer than the budget is clipped (clip() flattens newlines, acceptable then).
    summary = joined.length <= maxSummary ? joined : clip(joined, maxSummary)
  }

  return {
    recent: kept.map((m) => ({ role: m.role, content: clip(m.content, maxMsg) })),
    summary,
    droppedCount: dropped.length,
    unsummarized,
    lastDroppedId: dropped.at(-1)?.id ?? 0,
  }
}
