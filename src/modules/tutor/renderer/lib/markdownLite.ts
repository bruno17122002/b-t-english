// Tiny, safe "markdown-lite" parser for AI replies. Produces a plain data tree (never HTML strings), so
// rendering goes through React text nodes and nothing from the model can inject markup.
// Supported: paragraphs, line breaks, "- " / "* " / "• " bullet lists, "1." / "1)" numbered lists,
// **bold** / __bold__, *italic* / _italic_, `code`. Headings ("# x") become bold paragraphs.

export type Inline =
  | { type: 'text'; text: string }
  | { type: 'bold'; children: Inline[] }
  | { type: 'italic'; children: Inline[] }
  | { type: 'code'; text: string }
  | { type: 'br' }

export type Block = { type: 'paragraph'; children: Inline[] } | { type: 'list'; ordered: boolean; items: Inline[][] }

const BULLET = /^\s*(?:[-*•])\s+(.*)$/
const NUMBERED = /^\s*\d{1,3}[.)]\s+(.*)$/
const HEADING = /^\s*#{1,6}\s+(.*)$/
const WORD_CHAR = /[\p{L}\p{N}]/u
const MAX_INPUT = 20_000

function pushText(out: Inline[], text: string) {
  if (!text) return
  const last = out.at(-1)
  if (last?.type === 'text') last.text += text
  else out.push({ type: 'text', text })
}

/** Finds the closing delimiter for an emphasis run starting at `from`, or -1. */
function findClose(src: string, delim: string, from: number): number {
  let j = src.indexOf(delim, from)
  while (j !== -1) {
    const single = delim.length === 1
    // "***" closing a bold run: the inner '*' belongs to a nested italic, so close on the last two.
    if (!single) while (src[j + 2] === delim[0]) j++
    // A single '*' must not be half of '**'.
    const partOfDouble = single && delim === '*' && (src[j + 1] === '*' || src[j - 1] === '*')
    const content = src.slice(from, j)
    const okContent = content.length > 0 && !/^\s/.test(content) && !/\s$/.test(content)
    // '_' only closes at a word boundary (keeps snake_case intact).
    const okBoundary = delim[0] !== '_' || !WORD_CHAR.test(src[j + delim.length] ?? '')
    if (!partOfDouble && okContent && okBoundary) return j
    j = src.indexOf(delim, j + 1)
  }
  return -1
}

export function parseInline(src: string, depth = 0): Inline[] {
  const out: Inline[] = []
  let i = 0
  while (i < src.length) {
    const ch = src[i] as string
    if (ch === '`') {
      const end = src.indexOf('`', i + 1)
      if (end > i + 1) {
        out.push({ type: 'code', text: src.slice(i + 1, end) })
        i = end + 1
        continue
      }
    }
    if (depth < 4 && (ch === '*' || ch === '_')) {
      const double = src[i + 1] === ch
      const delim = double ? ch + ch : ch
      const prev = src[i - 1] ?? ''
      const openOk = ch === '*' || !WORD_CHAR.test(prev)
      if (openOk) {
        const end = findClose(src, delim, i + delim.length)
        if (end !== -1) {
          const children = parseInline(src.slice(i + delim.length, end), depth + 1)
          out.push(double ? { type: 'bold', children } : { type: 'italic', children })
          i = end + delim.length
          continue
        }
      }
      // Unmatched marker: keep it literally (both characters of a double marker).
      pushText(out, delim)
      i += delim.length
      continue
    }
    pushText(out, ch)
    i++
  }
  return out
}

export function parseMarkdownLite(input: string): Block[] {
  const src = input.slice(0, MAX_INPUT).replace(/\r\n?/g, '\n')
  const blocks: Block[] = []
  let para: string[] = []
  let list: { ordered: boolean; items: string[] } | null = null

  const flushPara = () => {
    if (!para.length) return
    const children: Inline[] = []
    para.forEach((line, idx) => {
      if (idx > 0) children.push({ type: 'br' })
      children.push(...parseInline(line))
    })
    blocks.push({ type: 'paragraph', children })
    para = []
  }
  const flushList = () => {
    if (!list) return
    blocks.push({ type: 'list', ordered: list.ordered, items: list.items.map((t) => parseInline(t)) })
    list = null
  }

  for (const raw of src.split('\n')) {
    const line = raw.trimEnd()
    if (!line.trim()) {
      flushPara()
      flushList()
      continue
    }
    const bullet = BULLET.exec(line)
    const numbered = bullet ? null : NUMBERED.exec(line)
    if (bullet || numbered) {
      const ordered = !!numbered
      flushPara()
      if (list && list.ordered !== ordered) flushList()
      if (!list) list = { ordered, items: [] }
      list.items.push(((bullet ?? numbered)?.[1] ?? '').trim())
      continue
    }
    const heading = HEADING.exec(line)
    if (heading) {
      flushPara()
      flushList()
      blocks.push({ type: 'paragraph', children: [{ type: 'bold', children: parseInline((heading[1] ?? '').trim()) }] })
      continue
    }
    // A plain line right after a list item continues that item ("lazy" continuation).
    if (list && /^\s{2,}/.test(raw)) {
      const items: string[] = list.items
      items[items.length - 1] = `${items.at(-1) ?? ''} ${line.trim()}`
      continue
    }
    flushList()
    para.push(line.trim())
  }
  flushPara()
  flushList()
  return blocks
}

/** Plain text of a parsed tree (used for TTS and copy). */
export function plainText(blocks: Block[]): string {
  const inl = (xs: Inline[]): string =>
    xs.map((x) => (x.type === 'text' || x.type === 'code' ? x.text : x.type === 'br' ? '\n' : inl(x.children))).join('')
  return blocks
    .map((b) => (b.type === 'paragraph' ? inl(b.children) : b.items.map((it) => inl(it)).join('\n')))
    .join('\n\n')
}
