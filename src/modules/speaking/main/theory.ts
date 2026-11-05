// Tiny allowlisted converter for pronunciation theory markup (from the Cadence pack). The markup is never
// injected as HTML: it is parsed into plain blocks (heading / paragraph / list) with bold/italic runs that
// React renders as text. Every other tag is dropped; script/style/iframe content is discarded entirely.

import type { InlineRun, TheoryBlock } from '../contract'

const DROP_WITH_CONTENT = new Set([
  'script',
  'style',
  'iframe',
  'object',
  'embed',
  'template',
  'svg',
  'math',
  'noscript',
  'textarea',
  'select',
])
const HEADINGS = new Set(['h1', 'h2', 'h3', 'h4', 'h5', 'h6'])
const STRONG = new Set(['strong', 'b'])
const EM = new Set(['em', 'i'])

const NAMED_ENTITIES: Readonly<Record<string, string>> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  mdash: '—',
  ndash: '–',
  hellip: '…',
  rsquo: '’',
  lsquo: '‘',
  rdquo: '”',
  ldquo: '“',
}

export function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, body: string) => {
    if (body[0] === '#') {
      const code = body[1] === 'x' || body[1] === 'X' ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10)
      // Drop control characters and invalid code points.
      if (!Number.isFinite(code) || code < 32 || code > 0x10ffff) return ''
      return String.fromCodePoint(code)
    }
    return NAMED_ENTITIES[body.toLowerCase()] ?? whole
  })
}

const TOKEN_RE = /<!--[\s\S]*?-->|<(\/?)([a-zA-Z][a-zA-Z0-9]*)\b[^>]*>|<|[^<]+/g

/** Parses theory markup into safe blocks. */
export function theoryHtmlToBlocks(html: string): TheoryBlock[] {
  const blocks: TheoryBlock[] = []
  let block: { type: 'heading' | 'paragraph'; runs: InlineRun[] } | null = null
  let list: { type: 'list'; items: InlineRun[][] } | null = null
  let item: InlineRun[] | null = null
  let strong = 0
  let em = 0
  let dropping: string | null = null

  const finishRuns = (runs: InlineRun[]): InlineRun[] => {
    const out = runs.filter((r) => r.text.length > 0)
    if (out[0]) out[0] = { ...out[0], text: out[0].text.replace(/^\s+/, '') }
    const last = out[out.length - 1]
    if (last) out[out.length - 1] = { ...last, text: last.text.replace(/\s+$/, '') }
    return out.filter((r) => r.text.length > 0)
  }
  const closeBlock = () => {
    if (block) {
      const runs = finishRuns(block.runs)
      if (runs.length) blocks.push({ type: block.type, runs })
    }
    block = null
  }
  const closeItem = () => {
    if (item && list) {
      const runs = finishRuns(item)
      if (runs.length) list.items.push(runs)
    }
    item = null
  }
  const closeList = () => {
    closeItem()
    if (list?.items.length) blocks.push(list)
    list = null
  }
  const addText = (raw: string) => {
    const text = decodeEntities(raw).replace(/\s+/g, ' ')
    if (!text.trim() && !(item ?? block)) return
    let target: InlineRun[]
    if (list) {
      item ??= []
      target = item
    } else {
      block ??= { type: 'paragraph', runs: [] }
      target = block.runs
    }
    const run: InlineRun = { text, ...(strong > 0 ? { strong: true } : {}), ...(em > 0 ? { em: true } : {}) }
    const prev = target[target.length - 1]
    if (prev && !!prev.strong === !!run.strong && !!prev.em === !!run.em) prev.text += text
    else target.push(run)
  }

  for (const m of html.matchAll(TOKEN_RE)) {
    const token = m[0]
    const closing = m[1] === '/'
    const tag = m[2]?.toLowerCase()
    if (dropping) {
      if (tag === dropping && closing) dropping = null
      continue
    }
    if (token.startsWith('<!--')) continue
    if (!tag) {
      addText(token)
      continue
    }
    if (DROP_WITH_CONTENT.has(tag)) {
      if (!closing && !/\/>$/.test(token)) dropping = tag
      continue
    }
    if (HEADINGS.has(tag) || tag === 'p' || tag === 'div' || tag === 'blockquote') {
      if (list && !closing) closeList()
      closeBlock()
      if (!closing && !list) block = { type: HEADINGS.has(tag) ? 'heading' : 'paragraph', runs: [] }
      continue
    }
    if (tag === 'ul' || tag === 'ol') {
      closeBlock()
      if (closing) closeList()
      else if (!list) list = { type: 'list', items: [] }
      continue
    }
    if (tag === 'li') {
      closeItem()
      if (!closing) {
        closeBlock()
        if (!list) list = { type: 'list', items: [] }
        item = []
      }
      continue
    }
    if (tag === 'br') {
      addText(' ')
      continue
    }
    if (STRONG.has(tag)) strong = Math.max(0, strong + (closing ? -1 : 1))
    else if (EM.has(tag)) em = Math.max(0, em + (closing ? -1 : 1))
    // Any other tag (a, span, img, …) is ignored; its text content is kept as plain text.
  }
  closeList()
  closeBlock()
  return blocks
}

/** Plain-text version (used for search, TTS and tests). */
export function theoryHtmlToText(html: string): string {
  return theoryHtmlToBlocks(html)
    .map((b) =>
      b.type === 'list'
        ? b.items.map((it) => `• ${it.map((r) => r.text).join('')}`).join('\n')
        : b.runs.map((r) => r.text).join(''),
    )
    .join('\n\n')
}
