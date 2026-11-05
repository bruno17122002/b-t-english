// In-memory stand-ins for the services used by the Edge Functions: a small PostgREST emulator (the subset of
// filters, ordering, upserts and deletes the server code uses), GoTrue's /auth/v1/user, the Telegram Bot API and a
// scripted AI model. Used by tests/unit/server-*.test.ts.
import type { AiModel, GenerateInput } from '../../supabase/functions/_shared/gemini'

export type Row = Record<string, unknown>

export const SERVICE_KEY = 'service-role-key-for-tests-0123456789'
export const SUPABASE_URL = 'https://proj.supabase.co'

export interface RestCall {
  method: string
  table: string
  params: URLSearchParams
  body: unknown
  prefer: string
  auth: string
}

const PK: Record<string, string[]> = {
  sync_rows: ['user_id', 'tbl', 'row_key'],
  telegram_links: ['user_id'],
  link_codes: ['code'],
  notification_log: ['user_id', 'kind', 'period_key'],
  notification_schedules: ['user_id'],
  ai_usage: ['user_id', 'day'],
  bot_pending: ['id'],
  profiles: ['user_id'],
}
const UNIQUE: Record<string, string[][]> = { telegram_links: [['chat_id']] }

function field(row: Row, col: string): unknown {
  const m = /^(\w+)->>(\w+)$/.exec(col)
  if (m) {
    const obj = row[m[1] as string] as Row | undefined
    const v = obj?.[m[2] as string]
    return v === null || v === undefined ? null : typeof v === 'object' ? JSON.stringify(v) : String(v)
  }
  return row[col]
}

function cmp(a: unknown, b: string): number {
  if (typeof a === 'number') return a - Number(b)
  const s = String(a)
  return s < b ? -1 : s > b ? 1 : 0
}

function matches(row: Row, col: string, expr: string): boolean {
  const dot = expr.indexOf('.')
  const op = expr.slice(0, dot)
  const val = expr.slice(dot + 1)
  const v = field(row, col)
  switch (op) {
    case 'eq':
      return v !== null && v !== undefined && (typeof v === 'boolean' ? String(v) === val : cmp(v, val) === 0)
    case 'neq':
      return !(v !== null && v !== undefined && cmp(v, val) === 0)
    case 'gt':
      return v !== null && v !== undefined && cmp(v, val) > 0
    case 'gte':
      return v !== null && v !== undefined && cmp(v, val) >= 0
    case 'lt':
      return v !== null && v !== undefined && cmp(v, val) < 0
    case 'lte':
      return v !== null && v !== undefined && cmp(v, val) <= 0
    case 'is':
      return val === 'null' ? v === null || v === undefined : String(v) === val
    case 'in': {
      const list = val
        .replace(/^\(|\)$/g, '')
        .split(',')
        .map((x) => x.replace(/^"|"$/g, ''))
      return v !== null && v !== undefined && list.includes(String(v))
    }
    default:
      throw new Error(`fake postgrest: unsupported operator ${op}`)
  }
}

const RESERVED = new Set(['select', 'order', 'limit', 'offset', 'on_conflict'])

export class FakePostgrest {
  readonly tables = new Map<string, Row[]>()
  readonly calls: RestCall[] = []
  /** access token → user */
  readonly users = new Map<string, { id: string; email: string }>()
  private seq = 0
  private identity = 0
  failNext: { table: string; status: number } | null = null

  rows(table: string): Row[] {
    let t = this.tables.get(table)
    if (!t) this.tables.set(table, (t = []))
    return t
  }

  seed(table: string, rows: Row[]): void {
    for (const r of rows) this.insertRow(table, { ...r })
  }

  private insertRow(table: string, row: Row): Row {
    if (table === 'sync_rows') {
      row.seq = ++this.seq
      row.deleted ??= false
    }
    if (table === 'bot_messages' && row.id === undefined) row.id = ++this.identity
    if ((table === 'bot_messages' || table === 'bot_pending') && row.created_at === undefined)
      row.created_at = new Date().toISOString()
    this.rows(table).push(row)
    return row
  }

  private filtered(table: string, params: URLSearchParams): Row[] {
    const filters = [...params.entries()].filter(([k]) => !RESERVED.has(k))
    return this.rows(table).filter((r) => filters.every(([k, v]) => matches(r, k, v)))
  }

  private respond(status: number, body?: unknown): Response {
    return new Response(body === undefined || status === 204 ? null : JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    })
  }

  readonly fetch = async (input: string | URL | Request, init: RequestInit = {}): Promise<Response> => {
    const url = new URL(String(input))
    const headers = new Headers(init.headers)
    if (url.pathname === '/auth/v1/user') {
      const token = (headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '')
      const user = this.users.get(token)
      return user ? this.respond(200, user) : this.respond(401, { msg: 'invalid JWT' })
    }
    const m = /^\/rest\/v1\/(\w+)$/.exec(url.pathname)
    if (!m) throw new Error(`fake supabase: unexpected path ${url.pathname}`)
    const table = m[1] as string
    const method = (init.method ?? 'GET').toUpperCase()
    const body = typeof init.body === 'string' ? (JSON.parse(init.body) as unknown) : undefined
    const prefer = headers.get('prefer') ?? ''
    this.calls.push({ method, table, params: url.searchParams, body, prefer, auth: headers.get('authorization') ?? '' })
    if (headers.get('apikey') !== SERVICE_KEY) return this.respond(401, { message: 'bad apikey' })
    if (this.failNext && this.failNext.table === table) {
      const status = this.failNext.status
      this.failNext = null
      return this.respond(status, { message: 'injected failure' })
    }
    const params = url.searchParams
    if (method === 'GET') {
      let rows = this.filtered(table, params)
      const order = params.get('order')
      if (order) {
        const keys = order.split(',').map((o) => {
          const [col, dir] = o.split('.')
          return { col: col as string, desc: dir === 'desc' }
        })
        rows = [...rows].sort((a, b) => {
          for (const k of keys) {
            const av = field(a, k.col)
            const bv = field(b, k.col)
            if (av === bv) continue
            const c = typeof av === 'number' && typeof bv === 'number' ? av - bv : String(av) < String(bv) ? -1 : 1
            return k.desc ? -c : c
          }
          return 0
        })
      }
      const offset = Number(params.get('offset') ?? 0)
      const limit = params.get('limit') ? Number(params.get('limit')) : undefined
      rows = rows.slice(offset, limit !== undefined ? offset + limit : undefined)
      const select = params.get('select') ?? '*'
      const out =
        select === '*'
          ? rows.map((r) => structuredClone(r))
          : rows.map((r) => Object.fromEntries(select.split(',').map((c) => [c, structuredClone(field(r, c))])))
      return this.respond(200, out)
    }
    if (method === 'POST') {
      const list = (Array.isArray(body) ? body : [body]) as Row[]
      const conflict = params.get('on_conflict')?.split(',') ?? PK[table] ?? []
      const merge = /resolution=merge-duplicates/.test(prefer)
      const ignore = /resolution=ignore-duplicates/.test(prefer)
      const written: Row[] = []
      for (const incoming of list) {
        const existing = conflict.length
          ? this.rows(table).find((r) => conflict.every((c) => r[c] === incoming[c]))
          : undefined
        if (existing) {
          if (ignore) continue
          if (!merge) return this.respond(409, { code: '23505', message: 'duplicate key' })
          Object.assign(existing, structuredClone(incoming))
          if (table === 'sync_rows') existing.seq = ++this.seq
          written.push(existing)
          continue
        }
        for (const cols of UNIQUE[table] ?? [])
          if (this.rows(table).some((r) => cols.every((c) => r[c] === incoming[c])))
            return this.respond(409, { code: '23505', message: 'duplicate key (unique)' })
        written.push(this.insertRow(table, structuredClone(incoming)))
      }
      return /return=representation/.test(prefer) ? this.respond(201, written) : this.respond(201)
    }
    if (method === 'PATCH') {
      for (const r of this.filtered(table, params)) Object.assign(r, body as Row)
      return this.respond(204)
    }
    if (method === 'DELETE') {
      const victims = new Set(this.filtered(table, params))
      this.tables.set(
        table,
        this.rows(table).filter((r) => !victims.has(r)),
      )
      return this.respond(204)
    }
    throw new Error(`fake supabase: unsupported method ${method}`)
  }
}

// ---------- Telegram ----------
export interface TgCall {
  method: string
  body: Record<string, unknown>
}

export class FakeTelegramApi {
  readonly calls: TgCall[] = []
  readonly files = new Map<string, Uint8Array>()
  private nextId = 100

  sent(method = 'sendMessage'): TgCall[] {
    return this.calls.filter((c) => c.method === method)
  }
  texts(): string[] {
    return this.calls
      .filter((c) => c.method === 'sendMessage' || c.method === 'editMessageText')
      .map((c) => String(c.body.text))
  }
  clear(): void {
    this.calls.length = 0
  }

  readonly fetch = async (input: string | URL | Request, init: RequestInit = {}): Promise<Response> => {
    const url = String(input)
    const file = /^https:\/\/api\.telegram\.org\/file\/bot[^/]+\/(.+)$/.exec(url)
    if (file) {
      const data = this.files.get(file[1] as string)
      return data ? new Response(data, { status: 200 }) : new Response('missing', { status: 404 })
    }
    const m = /^https:\/\/api\.telegram\.org\/bot[^/]+\/(\w+)$/.exec(url)
    if (!m) throw new Error(`fake telegram: unexpected url ${url}`)
    const method = m[1] as string
    const body = JSON.parse(String(init.body ?? '{}')) as Record<string, unknown>
    this.calls.push({ method, body })
    const ok = (result: unknown) => new Response(JSON.stringify({ ok: true, result }), { status: 200 })
    if (method === 'getFile')
      return ok({ file_id: body.file_id, file_path: `files/${String(body.file_id)}`, file_size: 10 })
    if (method === 'sendMessage') return ok({ message_id: this.nextId++, chat: { id: body.chat_id }, date: 0 })
    return ok(true)
  }
}

// ---------- AI ----------
/** Scripted model: each call pops the next answer (string or function of the input); records every input. */
export class FakeAi implements AiModel {
  readonly inputs: GenerateInput[] = []
  readonly answers: (string | ((input: GenerateInput) => string))[] = []
  fallback: string | ((input: GenerateInput) => string) = '{}'

  push(...answers: (string | object | ((input: GenerateInput) => string))[]): this {
    for (const a of answers) this.answers.push(typeof a === 'object' ? JSON.stringify(a) : a)
    return this
  }

  async generate(input: GenerateInput): Promise<string> {
    this.inputs.push(input)
    const next = this.answers.shift() ?? this.fallback
    return typeof next === 'function' ? next(input) : next
  }
}

/** One fetch that routes Supabase and Telegram URLs to the fakes. */
export function combinedFetch(sb: FakePostgrest, tg: FakeTelegramApi) {
  return async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = String(input)
    if (url.startsWith(SUPABASE_URL)) return sb.fetch(url, init)
    if (url.startsWith('https://api.telegram.org')) return tg.fetch(url, init)
    throw new Error(`unexpected host: ${url}`)
  }
}

export function syncRow(
  user: string,
  tbl: string,
  rowKey: string,
  data: Row,
  updatedAt = '2026-11-01T00:00:00.000Z',
): Row {
  return { user_id: user, tbl, row_key: rowKey, data, deleted: false, device_id: null, client_updated_at: updatedAt }
}

// ---------- learner fixture (synced rows as the desktop pushes them) ----------
export const USER = '11111111-1111-4111-8111-111111111111'
export const OTHER = '22222222-2222-4222-8222-222222222222'
export const CHAT = 777
export const TZ = 'Asia/Ho_Chi_Minh'

/** Activity row in the desktop's activity_log shape; `at` is UTC ISO, `date` the learner's local day. */
export function activity(
  at: string,
  date: string,
  module: string,
  action: string,
  minutes: number,
  extra: Row = {},
): Row {
  return {
    id: Math.floor(Math.random() * 1e6),
    module,
    action,
    title: `${module} ${action}`,
    ref: '',
    skill: null,
    minutes,
    xp: 10,
    date,
    created_at: at,
    score: null,
    ...extra,
  }
}

export function learnerFixture(user = USER): Row[] {
  const rows: Row[] = [
    syncRow(user, 'user_profile', 'singleton', {
      id: 1,
      display_name: 'Lan',
      self_reported_level: 'intermediate',
      overall_cefr: 'B1',
      target_cefr: 'B2',
      target_ielts: 6.5,
      daily_minutes: 30,
      purposes: '[]',
      interests: '["travel","music"]',
    }),
    ...(
      [
        ['vocabulary', 'B1', 40],
        ['grammar', 'A2', 30],
        ['reading', 'B1', 50],
        ['listening', 'A2', 20],
        ['writing', 'A2', 25],
        ['speaking', 'A2', 35],
      ] as const
    ).map(([skill, cefr, score]) => syncRow(user, 'skill_levels', skill, { skill, cefr, score, source: 'assessment' })),
    syncRow(user, 'vocabulary', 'resilient', {
      id: 5,
      word: 'resilient',
      word_key: 'resilient',
      ipa: '/rɪˈzɪliənt/',
      pos: 'adjective',
      meaning_vi: 'kiên cường',
      meaning_en: 'able to recover quickly',
      examples: '["She is resilient."]',
    }),
    syncRow(user, 'vocabulary', 'commute', {
      id: 6,
      word: 'commute',
      word_key: 'commute',
      meaning_vi: 'đi lại',
      examples: '[]',
    }),
    syncRow(
      user,
      'review_schedules',
      'resilient',
      {
        vocab_id: 5,
        word_key: 'resilient',
        state: 'review',
        due_at: '2026-11-04T00:00:00.000Z',
        stability: 3,
        difficulty: 5,
        reps: 2,
        lapses: 0,
        scheduled_days: 3,
        last_review_at: '2026-11-01T00:00:00.000Z',
        learning_steps: 0,
      },
      // A device clock running ahead: the server must still produce a newer client_updated_at.
      '2026-11-06T00:00:00.000Z',
    ),
    syncRow(user, 'review_schedules', 'commute', {
      vocab_id: 6,
      word_key: 'commute',
      state: 'review',
      due_at: '2026-11-20T00:00:00.000Z',
      stability: 20,
      difficulty: 4,
      reps: 4,
      lapses: 0,
      scheduled_days: 20,
      last_review_at: '2026-10-31T00:00:00.000Z',
      learning_steps: 0,
    }),
    syncRow(user, 'learner_mistakes', 'past simple', {
      category: 'grammar',
      pattern: 'past simple with past time markers',
      pattern_key: 'past simple',
      correction: 'went',
      count: 4,
      last_seen_at: '2026-11-03T00:00:00.000Z',
    }),
    syncRow(user, 'lessons', '2026-11-05:listening:l1', {
      date: '2026-11-05',
      module: 'listening',
      title: 'Airport announcements',
      status: 'todo',
      estimated_minutes: 15,
      position: 0,
    }),
    syncRow(user, 'lessons', '2026-11-05:grammar:g1', {
      date: '2026-11-05',
      module: 'grammar',
      title: 'Past simple',
      status: 'done',
      estimated_minutes: 10,
      position: 1,
    }),
    syncRow(user, 'coach_reports', 'week:2026-W44', {
      period: 'week',
      period_key: '2026-W44',
      advice: JSON.stringify({ headline: 'Khá ổn – cần học đều đặn hơn', summary: '...' }),
      created_at: '2026-11-01T13:00:00.000Z',
    }),
  ]
  // Study on 3 days of the previous week and 3 days of this week (local evening ≈ 20:00 = 13:00Z).
  const acts: [string, string, string, string, number][] = [
    ['2026-10-27T13:00:00.000Z', '2026-10-27', 'listening', 'listening_done', 20],
    ['2026-10-29T13:00:00.000Z', '2026-10-29', 'reading', 'reading_done', 15],
    ['2026-10-31T13:00:00.000Z', '2026-10-31', 'vocabulary', 'review_done', 5],
    ['2026-11-02T13:00:00.000Z', '2026-11-02', 'listening', 'listening_done', 25],
    ['2026-11-03T13:00:00.000Z', '2026-11-03', 'grammar', 'grammar_done', 10],
    ['2026-11-04T13:00:00.000Z', '2026-11-04', 'speaking', 'speaking_done', 12],
  ]
  acts.forEach(([at, date, module, action, minutes], i) =>
    rows.push(
      syncRow(
        user,
        'activity_log',
        `dev-1:${i + 1}`,
        activity(at, date, module, action, minutes, { skill: module === 'vocabulary' ? 'vocabulary' : module }),
      ),
    ),
  )
  return rows
}
