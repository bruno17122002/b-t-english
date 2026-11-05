// Data layer over the shared `sync_rows` table (see docs/ONLINE_PLAN.md, phase 3/4).
// - Row parsing: every synced row's `data` is the desktop's SQLite row (local column names), validated with zod.
//   JSON text columns (examples, advice, label…) may arrive as strings or as already-parsed JSON – both work.
// - Pull: incremental by `seq` cursor into a local cache (IndexedDB in the browser, memory in tests).
// - Push: rows go through RPC sync_push (last-writer-wins on client_updated_at); while offline they wait in a
//   small queue (localStorage) that is replayed when the connection comes back.
import { z } from 'zod'
import { CloudError, type KV } from './supabase'

/** Desktop tables the PWA reads. daily_stats / achievements / quests are recomputed, never synced. */
export const PULL_TABLES = [
  'vocabulary',
  'review_schedules',
  'review_logs',
  'activity_log',
  'xp_events',
  'lessons',
  'coach_reports',
  'user_profile',
] as const
export type PullTable = (typeof PULL_TABLES)[number]

export interface SyncRow {
  tbl: string
  row_key: string
  data: Record<string, unknown>
  deleted: boolean
  client_updated_at: string
  seq: number
}

/** One element of the `rows` argument of sync_push. */
export interface PushRow {
  tbl: string
  row_key: string
  data: Record<string, unknown>
  deleted: boolean
  client_updated_at: string
}

// ---------- zod helpers ----------
const parseJson = (v: unknown): unknown => {
  if (typeof v !== 'string') return v
  try {
    return JSON.parse(v)
  } catch {
    return undefined
  }
}
const str = (fallback = '') => z.preprocess((v) => (v == null ? fallback : String(v)), z.string())
const nstr = z.preprocess((v) => (v == null || v === '' ? null : String(v)), z.string().nullable())
const num = (fallback = 0) =>
  z.preprocess((v) => {
    if (v == null || v === '') return fallback
    const n = Number(v)
    return Number.isFinite(n) ? n : fallback
  }, z.number())
function json<T>(schema: z.ZodType<T>, fallback: T): z.ZodType<T> {
  return z.preprocess(parseJson, schema).catch(fallback) as unknown as z.ZodType<T>
}
const strList = json(z.array(z.string()), [])

export const SyncRowSchema = z.object({
  tbl: z.string().min(1),
  row_key: z.string().min(1),
  data: z.preprocess(parseJson, z.record(z.string(), z.unknown())),
  deleted: z.preprocess((v) => v === true || v === 'true' || v === 1, z.boolean()),
  client_updated_at: z.string().min(1),
  seq: num(0),
})

const CARD_STATES = ['new', 'learning', 'review', 'relearning'] as const

export const VocabSchema = z.object({
  id: num(0),
  word_key: z.string().min(1),
  word: z.string().min(1),
  ipa: str(),
  pos: str(),
  meaning_vi: str(),
  meaning_en: str(),
  examples: strList,
  context: str(),
  cefr: nstr,
  topic: str(),
  is_favorite: num(0),
  created_at: str(),
})
export type Vocab = z.output<typeof VocabSchema>

export const ReviewScheduleSchema = z.object({
  word_key: z.string().min(1),
  vocab_id: num(0),
  state: z.enum(CARD_STATES).catch('new'),
  due_at: z.string().min(1),
  stability: num(0),
  difficulty: num(0),
  reps: num(0),
  lapses: num(0),
  scheduled_days: num(0),
  last_review_at: nstr,
  learning_steps: num(0),
})
export type ReviewSchedule = z.output<typeof ReviewScheduleSchema>

export const ReviewLogSchema = z.object({
  word_key: str(),
  vocab_id: num(0),
  rating: num(3),
  state_before: str('new'),
  elapsed_days: num(0),
  scheduled_days: num(0),
  duration_ms: num(0),
  reviewed_at: z.string().min(1),
})
export type ReviewLog = z.output<typeof ReviewLogSchema>

export const ActivitySchema = z.object({
  module: str(),
  action: str(),
  title: str(),
  ref: str(),
  skill: nstr,
  minutes: num(0),
  xp: num(0),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  created_at: str(),
})
export type Activity = z.output<typeof ActivitySchema>

export const XpEventSchema = z.object({
  amount: num(0),
  source: str(),
  skill: nstr,
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  created_at: str(),
})
export type XpEvent = z.output<typeof XpEventSchema>

export const LessonSchema = z.object({
  id: num(0),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  module: str(),
  title: z.string().min(1),
  description: str(),
  estimated_minutes: num(10),
  status: z.enum(['todo', 'done', 'skipped']).catch('todo'),
  completed_at: nstr,
  position: num(0),
})
export type Lesson = z.output<typeof LessonSchema>

const Bilingual = z.object({ en: str(), vi: str() })
const AdviceSchema = z.object({
  headline: str(),
  summary: str(),
  strengths: z.array(z.string()).catch([]).default([]),
  concerns: z.array(z.string()).catch([]).default([]),
  recommendations: z
    .array(
      z.object({
        title: str(),
        why: str(),
        action: str(),
        route: str(),
        minutes: num(0),
      }),
    )
    .catch([])
    .default([]),
  bestStudyTimes: z.array(z.string()).catch([]).default([]),
  nextPeriodPlan: z
    .array(
      z.object({
        day: str(),
        focus: str(),
        modules: z.array(z.string()).catch([]).default([]),
        activities: z.array(z.string()).catch([]).default([]),
        minutes: num(0),
      }),
    )
    .catch([])
    .default([]),
  motivation: str(),
  ieltsOutlook: str(),
})
export type CoachAdvice = z.output<typeof AdviceSchema>

export const CoachReportSchema = z.object({
  id: num(0),
  period: z.enum(['day', 'week', 'month']).catch('day'),
  period_key: str(),
  label: json(Bilingual, { en: '', vi: '' }),
  advice: z.preprocess(parseJson, AdviceSchema),
  source: str('offline'),
  provider: nstr,
  created_at: str(),
})
export type CoachReport = z.output<typeof CoachReportSchema>

export const UserProfileSchema = z.object({
  display_name: str(),
  daily_minutes: num(20),
  target_ielts: z.preprocess((v) => (v == null || v === '' ? null : Number(v)), z.number().nullable()).catch(null),
  target_cefr: str('B2'),
})
export type UserProfile = z.output<typeof UserProfileSchema>

/** Validates raw PostgREST rows; malformed rows are dropped (never crash the app on one bad row). */
export function parseSyncRows(raw: unknown): SyncRow[] {
  if (!Array.isArray(raw)) return []
  const out: SyncRow[] = []
  for (const r of raw) {
    const p = SyncRowSchema.safeParse(r)
    if (p.success) out.push(p.data)
  }
  return out
}

// ---------- local cache ----------
export interface SyncCache {
  userId: string
  /** Highest server seq seen; the next pull asks for rows after it. */
  cursor: number
  lastPullAt: string | null
  rows: Record<string, Record<string, SyncRow>>
}

export function emptyCache(userId: string): SyncCache {
  return { userId, cursor: 0, lastPullAt: null, rows: {} }
}

/**
 * Applies rows to the cache with the same last-writer-wins rule as the server (newer or equal
 * client_updated_at wins). Deleted rows are removed. Pulled rows advance the cursor; local
 * (optimistic) rows do not. Returns a new cache object; untouched tables are shared.
 */
export function applyRows(cache: SyncCache, rows: (SyncRow | PushRow)[], opts: { pulled?: boolean } = {}): SyncCache {
  const next: SyncCache = { ...cache, rows: { ...cache.rows } }
  const copied = new Set<string>()
  for (const r of rows) {
    if (!copied.has(r.tbl)) {
      next.rows[r.tbl] = { ...(cache.rows[r.tbl] ?? {}) }
      copied.add(r.tbl)
    }
    const table = next.rows[r.tbl] as Record<string, SyncRow>
    const seq = 'seq' in r ? r.seq : 0
    if (opts.pulled && seq > next.cursor) next.cursor = seq
    const existing = table[r.row_key]
    if (existing && Date.parse(existing.client_updated_at) > Date.parse(r.client_updated_at)) continue
    if (r.deleted) delete table[r.row_key]
    else table[r.row_key] = { ...r, seq }
  }
  return next
}

/** Valid, non-deleted rows of one table as `{ key, row }` pairs. */
export function tableRows<T>(cache: SyncCache, tbl: string, schema: z.ZodType<T>): { key: string; row: T }[] {
  const out: { key: string; row: T }[] = []
  for (const [key, r] of Object.entries(cache.rows[tbl] ?? {})) {
    if (r.deleted) continue
    const data = tbl === 'review_schedules' && !r.data.word_key ? { ...r.data, word_key: key } : r.data
    const p = schema.safeParse(data)
    if (p.success) out.push({ key, row: p.data })
  }
  return out
}

/** Raw data of one cached row (used to keep unknown columns when the PWA updates a row). */
export function rawRow(cache: SyncCache, tbl: string, key: string): Record<string, unknown> | null {
  const r = cache.rows[tbl]?.[key]
  return r && !r.deleted ? r.data : null
}

// ---------- REST ----------
/** The part of SupabaseClient the sync layer needs (lets tests pass a fake). */
export interface RestClient {
  json<T>(path: string, init?: RequestInit): Promise<T>
  rpc<T>(fn: string, args?: Record<string, unknown>): Promise<T>
}

export function pullPath(cursor: number, tables: readonly string[], limit: number): string {
  return (
    `/rest/v1/sync_rows?select=tbl,row_key,data,deleted,client_updated_at,seq` +
    `&seq=gt.${Math.max(0, Math.floor(cursor))}&tbl=in.(${tables.join(',')})&order=seq.asc&limit=${limit}`
  )
}

/** Pulls every row changed after the cache cursor (paged). */
export async function pullChanges(
  client: RestClient,
  cache: SyncCache,
  opts: { tables?: readonly string[]; pageSize?: number; now?: () => Date; maxPages?: number } = {},
): Promise<{ cache: SyncCache; pulled: number }> {
  const tables = opts.tables ?? PULL_TABLES
  const pageSize = opts.pageSize ?? 1000
  let current = cache
  let pulled = 0
  for (let page = 0; page < (opts.maxPages ?? 200); page++) {
    const rows = parseSyncRows(await client.json<unknown>(pullPath(current.cursor, tables, pageSize)))
    const before = current.cursor
    current = applyRows(current, rows, { pulled: true })
    pulled += rows.length
    if (rows.length < pageSize || current.cursor === before) break
  }
  return { cache: { ...current, lastPullAt: (opts.now?.() ?? new Date()).toISOString() }, pulled }
}

// ---------- offline queue ----------
const rowId = (r: PushRow) => `${r.tbl}\u0000${r.row_key}`

/** Adds rows to the queue; a later version of the same row replaces the queued one. */
export function enqueue(queue: PushRow[], rows: PushRow[]): PushRow[] {
  const map = new Map(queue.map((r) => [rowId(r), r]))
  for (const r of rows) {
    const old = map.get(rowId(r))
    if (old && Date.parse(old.client_updated_at) > Date.parse(r.client_updated_at)) continue
    map.delete(rowId(r)) // keep insertion order = order of last change
    map.set(rowId(r), r)
  }
  return [...map.values()]
}

export const queueKey = (userId: string) => `lq.queue.${userId}`

export function loadQueue(kv: KV, userId: string): PushRow[] {
  try {
    const v = JSON.parse(kv.get(queueKey(userId)) ?? '[]') as unknown
    return Array.isArray(v)
      ? (v as PushRow[]).filter((r) => r && typeof r.tbl === 'string' && typeof r.row_key === 'string')
      : []
  } catch {
    return []
  }
}

export function saveQueue(kv: KV, userId: string, queue: PushRow[]): void {
  if (queue.length) kv.set(queueKey(userId), JSON.stringify(queue))
  else kv.remove(queueKey(userId))
}

export interface FlushResult {
  sent: number
  remaining: PushRow[]
  error: CloudError | null
  /** True when the server rejected the device id (row deleted) – the caller should forget it. */
  deviceRejected: boolean
}

/** Sends the queue in batches via sync_push. Stops at the first failure and keeps the unsent rows. */
export async function flushQueue(
  client: RestClient,
  queue: PushRow[],
  device: string | null,
  batchSize = 500,
): Promise<FlushResult> {
  let remaining = [...queue]
  let sent = 0
  let dev = device
  let deviceRejected = false
  while (remaining.length) {
    const batch = remaining.slice(0, Math.min(1000, batchSize))
    try {
      await client.rpc<number>('sync_push', { rows: batch, device: dev })
    } catch (e) {
      const err = e instanceof CloudError ? e : new CloudError('network', String(e))
      // devices.id is a foreign key: a deleted device row must not block the queue forever.
      if (dev && err.code === 'bad_request' && /foreign key|devices/i.test(err.message)) {
        dev = null
        deviceRejected = true
        continue
      }
      return { sent, remaining, error: err, deviceRejected }
    }
    sent += batch.length
    remaining = remaining.slice(batch.length)
  }
  return { sent, remaining, error: null, deviceRejected }
}

// ---------- device ----------
export const deviceKey = (userId: string) => `lq.device.${userId}`

/** Registers this browser in `devices` once (id is needed by sync_push); null when it cannot. */
export async function ensureDevice(
  client: RestClient,
  kv: KV,
  userId: string,
  info: { name: string; appVersion: string },
): Promise<string | null> {
  const known = kv.get(deviceKey(userId))
  if (known) return known
  try {
    const rows = await client.json<{ id?: string }[]>('/rest/v1/devices?select=id', {
      method: 'POST',
      headers: { prefer: 'return=representation' },
      body: JSON.stringify({
        user_id: userId,
        name: info.name.slice(0, 80),
        platform: 'web',
        app_version: info.appVersion,
      }),
    })
    const id = rows?.[0]?.id
    if (id) {
      kv.set(deviceKey(userId), id)
      return id
    }
  } catch {
    /* offline or not allowed – push with device = null */
  }
  return null
}
