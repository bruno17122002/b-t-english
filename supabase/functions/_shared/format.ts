// Pure Telegram text helpers for the server bot, ported from src/main/kernel/telegram/format.ts (the in-app bot):
// HTML escaping, tag-balanced message splitting and command parsing. Standard JS only (runs in Deno and Node).

/** Telegram rejects messages longer than 4096 characters; keep a safety margin. */
export const TELEGRAM_CHUNK = 4000

export function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

export const esc = escapeHtml

/** Removes tags and decodes the few entities Telegram HTML uses (plain-text fallbacks). */
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
  tag?: { name: string; closing: boolean }
}

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
    const index = m.index ?? 0
    if (index > last) pushText(html.slice(last, index))
    tokens.push({ text: m[0], tag: { name: (m[1] ?? '').toLowerCase(), closing: m[0].startsWith('</') } })
    last = index + m[0].length
  }
  if (last < html.length) pushText(html.slice(last))
  return tokens
}

/** Splits Telegram HTML into chunks ≤ limit, closing and re-opening tags across the break. */
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
      } else open.push({ name: tok.tag.name, raw: tok.text })
    }
  }
  const body = current.trim()
  if (body && stripHtml(body).trim()) chunks.push(`${body}${closing()}`)
  return chunks
}

export interface ParsedCommand {
  name: string
  args: string
}

/** Parses "/cmd", "/cmd args" and "/cmd@BotName args" (null for normal text or another bot's command). */
export function parseCommand(text: string, botUsername?: string | null): ParsedCommand | null {
  const m = /^\/([A-Za-z0-9_]{1,32})(?:@([A-Za-z0-9_]{3,64}))?(?:\s+([\s\S]*))?$/.exec(text.trim())
  if (!m) return null
  if (m[2] && botUsername && m[2].toLowerCase() !== botUsername.toLowerCase()) return null
  return { name: (m[1] ?? '').toLowerCase(), args: (m[3] ?? '').trim() }
}

/** Telegram limits callback data to 64 bytes. */
export function callbackDataOk(data: string): boolean {
  return new TextEncoder().encode(data).byteLength <= 64
}

/** Removes bot tokens from any text (URLs contain "/bot<token>/"). */
export function redactToken(text: string): string {
  return text
    .replace(/bot\d{5,15}:[A-Za-z0-9_-]{20,}/g, 'bot<redacted>')
    .replace(/\d{5,15}:[A-Za-z0-9_-]{30,}/g, '<redacted>')
}

/** Base64 of bytes without Node's Buffer (Deno + Node both have btoa). */
export function toBase64(bytes: Uint8Array): string {
  let binary = ''
  const step = 0x8000
  for (let i = 0; i < bytes.length; i += step) binary += String.fromCharCode(...bytes.subarray(i, i + step))
  return btoa(binary)
}

/** Strips accents (Vietnamese diacritics) and lowercases – for argument matching. */
export function foldVi(text: string): string {
  return text.trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd')
}

/** Constant-time-ish string comparison for shared secrets. */
export function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length || !a) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}
