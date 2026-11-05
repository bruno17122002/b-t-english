// Splits paragraphs into plain and highlighted segments for the reader view.

export interface TextSegment {
  text: string
  /** Id of the highlight covering this segment, or null for plain text. */
  highlightId: number | null
}

/**
 * Splits a paragraph into plain and highlighted segments. Each highlight marks its first occurrence
 * in the paragraph; overlapping highlights are skipped (first one wins, by position).
 */
export function segmentByHighlights(text: string, highlights: { id: number; text: string }[]): TextSegment[] {
  const ranges: { start: number; end: number; id: number }[] = []
  const lower = text.toLowerCase()
  for (const h of highlights) {
    const needle = h.text.trim().toLowerCase()
    if (!needle) continue
    const start = lower.indexOf(needle)
    if (start < 0) continue
    ranges.push({ start, end: start + needle.length, id: h.id })
  }
  ranges.sort((a, b) => a.start - b.start || b.end - a.end)
  const out: TextSegment[] = []
  let pos = 0
  for (const r of ranges) {
    if (r.start < pos) continue
    if (r.start > pos) out.push({ text: text.slice(pos, r.start), highlightId: null })
    out.push({ text: text.slice(r.start, r.end), highlightId: r.id })
    pos = r.end
  }
  if (pos < text.length) out.push({ text: text.slice(pos), highlightId: null })
  return out.length ? out : [{ text, highlightId: null }]
}
