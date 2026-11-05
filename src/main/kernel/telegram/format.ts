// Pure helpers for the Telegram bot: HTML escaping, message splitting that keeps tags balanced, command
// parsing and the natural-language "draw me…" detector. No I/O, so everything here is unit-tested directly.

/** Telegram rejects messages longer than 4096 characters; keep a safety margin. */
export const TELEGRAM_CHUNK = 4000
/** Photo / audio captions are limited to 1024 characters. */
export const CAPTION_LIMIT = 1000

export function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

/** Removes tags and decodes the few entities Telegram HTML uses (for plain-text fallbacks and logs). */
export function stripHtml(html: string): string {
  return html
    .replace(/<[^>]+>/g, '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
}

export function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, Math.max(0, max - 1)).trimEnd()}…`
}

const TAG_RE = /<\/?([a-zA-Z-]+)(?:\s[^<>]*)?>/g

interface Token {
  text: string
  /** Set for tags: lower-case tag name and whether it closes. */
  tag?: { name: string; closing: boolean }
}

/** Splits HTML into tags and text pieces; text is cut at line breaks, long lines further at spaces. */
function tokenize(html: string, limit: number): Token[] {
  const tokens: Token[] = []
  const pushText = (text: string) => {
    for (const line of text.split(/(?<=\n)/)) {
      if (line.length <= limit / 2) {
        if (line) tokens.push({ text: line })
        continue
      }
      for (const word of line.split(/(?<=\s)/)) {
        if (word.length <= limit / 2) {
          if (word) tokens.push({ text: word })
          continue
        }
        // A single huge "word": hard-cut, never inside an HTML entity.
        let rest = word
        while (rest.length > limit / 2) {
          let cut = Math.floor(limit / 2)
          const amp = rest.lastIndexOf('&', cut - 1)
          if (amp > 0 && amp > cut - 10 && rest.indexOf(';', amp) >= cut) cut = amp
          tokens.push({ text: rest.slice(0, cut) })
          rest = rest.slice(cut)
        }
        if (rest) tokens.push({ text: rest })
      }
    }
  }
  let last = 0
  for (const m of html.matchAll(TAG_RE)) {
    if (m.index > last) pushText(html.slice(last, m.index))
    tokens.push({ text: m[0], tag: { name: (m[1] ?? '').toLowerCase(), closing: m[0].startsWith('</') } })
    last = m.index + m[0].length
  }
  if (last < html.length) pushText(html.slice(last))
  return tokens
}

/**
 * Splits Telegram HTML into chunks of at most `limit` characters. Breaks prefer line ends; tags left open
 * at a break are closed at the end of the chunk and re-opened at the start of the next one.
 */
export function splitHtml(html: string, limit = TELEGRAM_CHUNK): string[] {
  const text = html.trim()
  if (!text) return []
  if (text.length <= limit) return [text]
  const chunks: string[] = []
  const open: { name: string; raw: string }[] = []
  const closing = () =>
    open
      .slice()
      .reverse()
      .map((t) => `</${t.name}>`)
      .join('')
  let current = ''
  const flush = () => {
    const body = current.trim()
    // A chunk made only of re-opened tags carries no content.
    if (body && stripHtml(body).trim()) chunks.push(`${body}${closing()}`)
    current = open.map((t) => t.raw).join('')
  }
  for (const tok of tokenize(text, limit - 200)) {
    if (current.length + tok.text.length + closing().length > limit) flush()
    current += tok.text
    if (tok.tag) {
      if (tok.tag.closing) {
        const idx = open.map((t) => t.name).lastIndexOf(tok.tag.name)
        if (idx >= 0) open.splice(idx, 1)
      } else {
        open.push({ name: tok.tag.name, raw: tok.text })
      }
    }
  }
  const body = current.trim()
  if (body && stripHtml(body).trim()) chunks.push(`${body}${closing()}`)
  return chunks
}

export interface ParsedCommand {
  /** Lower-case command name without slash. */
  name: string
  args: string
}

/**
 * Parses "/cmd", "/cmd args" and "/cmd@BotName args". Returns null for normal text and for commands
 * addressed to a different bot (group chats).
 */
export function parseCommand(text: string, botUsername?: string | null): ParsedCommand | null {
  const m = /^\/([A-Za-z0-9_]{1,32})(?:@([A-Za-z0-9_]{3,64}))?(?:\s+([\s\S]*))?$/.exec(text.trim())
  if (!m) return null
  if (m[2] && botUsername && m[2].toLowerCase() !== botUsername.toLowerCase()) return null
  return { name: (m[1] ?? '').toLowerCase(), args: (m[3] ?? '').trim() }
}

/** Natural requests for a picture ("vẽ…", "tạo ảnh…", "cho mình xem hình…", "draw…"), ported from the old bot. */
const IMAGE_INTENT = new RegExp(
  '(^|\\s)(' +
    'vẽ|tạo\\s+(1\\s+|một\\s+)?(cái\\s+)?(ảnh(?!\\s+hưởng)|hình(?!\\s+(thức|thành|như))|tranh)|' +
    '(ảnh|hình)\\s+minh\\s+họa|minh\\s+họa\\s+bằng\\s+(ảnh|hình)|' +
    '(gửi|cho)\\s+(mình|tôi|em|tớ)\\s+(xem\\s+)?(1\\s+|một\\s+)?(cái\\s+)?(ảnh(?!\\s+hưởng)|hình(?!\\s+(thức|thành|như))|tranh)|' +
    '(sửa|chỉnh)\\s+(lại\\s+)?(ảnh|hình)|' +
    'draw\\b|generate\\s+an?\\s+(image|picture)|make\\s+an?\\s+(image|picture)' +
    ')',
  'iu',
)

export function isImageRequest(text: string): boolean {
  return IMAGE_INTENT.test(text.normalize('NFC'))
}

/** Telegram limits callback data to 64 bytes. */
export function callbackDataOk(data: string): boolean {
  return new TextEncoder().encode(data).byteLength <= 64
}

/** Bot tokens look like "123456789:AA…" (digits, colon, 30+ url-safe characters). */
export const BOT_TOKEN_RE = /^\d{5,15}:[A-Za-z0-9_-]{30,64}$/

/** Removes bot tokens from any text (URLs contain "/bot<token>/"). */
export function redactToken(text: string): string {
  return text
    .replace(/bot\d{5,15}:[A-Za-z0-9_-]{20,}/g, 'bot<redacted>')
    .replace(/\d{5,15}:[A-Za-z0-9_-]{30,}/g, '<redacted>')
}
