import { describe, expect, it } from 'vitest'
import { CloudError, memoryKV } from '../../web/src/lib/supabase'
import {
  applyRows,
  CoachReportSchema,
  deviceKey,
  emptyCache,
  enqueue,
  ensureDevice,
  flushQueue,
  loadQueue,
  parseSyncRows,
  pullChanges,
  pullPath,
  rawRow,
  ReviewScheduleSchema,
  saveQueue,
  tableRows,
  VocabSchema,
  type PushRow,
  type RestClient,
  type SyncRow,
} from '../../web/src/lib/sync'

const row = (
  tbl: string,
  row_key: string,
  data: Record<string, unknown>,
  seq: number,
  at = '2026-11-01T10:00:00.000Z',
  deleted = false,
): SyncRow => ({
  tbl,
  row_key,
  data,
  deleted,
  client_updated_at: at,
  seq,
})

const push = (tbl: string, row_key: string, at: string, data: Record<string, unknown> = {}): PushRow => ({
  tbl,
  row_key,
  data,
  deleted: false,
  client_updated_at: at,
})

describe('web sync – row parsing', () => {
  it('validates PostgREST rows, coerces seq and parses data sent as text', () => {
    const rows = parseSyncRows([
      {
        tbl: 'vocabulary',
        row_key: 'apple',
        data: { word: 'apple' },
        deleted: false,
        client_updated_at: '2026-11-01T00:00:00Z',
        seq: '42',
      },
      {
        tbl: 'lessons',
        row_key: 'dev:1',
        data: '{"title":"x"}',
        deleted: null,
        client_updated_at: '2026-11-01T00:00:00Z',
        seq: 43,
      },
      { tbl: '', row_key: 'bad', data: {}, client_updated_at: 'x', seq: 1 },
      'garbage',
    ])
    expect(rows).toHaveLength(2)
    expect(rows[0]?.seq).toBe(42)
    expect(rows[1]?.data).toEqual({ title: 'x' })
    expect(rows[1]?.deleted).toBe(false)
    expect(parseSyncRows({ not: 'an array' })).toEqual([])
  })

  it('parses desktop vocabulary rows (JSON text columns) and skips invalid ones', () => {
    let cache = emptyCache('u')
    cache = applyRows(
      cache,
      [
        row(
          'vocabulary',
          'resilient',
          {
            id: 7,
            word: 'resilient',
            word_key: 'resilient',
            examples: '["She is resilient."]',
            cefr: 'B2',
            is_favorite: 0,
          },
          1,
        ),
        row('vocabulary', 'broken', { word_key: 'broken' }, 2), // no word
        row('vocabulary', 'arr', { word: 'arr', word_key: 'arr', examples: ['a', 'b'], cefr: '' }, 3),
      ],
      { pulled: true },
    )
    const vocab = tableRows(cache, 'vocabulary', VocabSchema)
    expect(vocab.map((v) => v.key).sort()).toEqual(['arr', 'resilient'])
    const r = vocab.find((v) => v.key === 'resilient')?.row
    expect(r?.examples).toEqual(['She is resilient.'])
    expect(r?.meaning_vi).toBe('')
    expect(vocab.find((v) => v.key === 'arr')?.row.cefr).toBeNull()
  })

  it('fills word_key of review_schedules from the row key when data lacks it', () => {
    const cache = applyRows(emptyCache('u'), [
      row(
        'review_schedules',
        'apple',
        { vocab_id: 3, state: 'review', due_at: '2026-11-02T00:00:00.000Z', stability: '4.5', reps: 2 },
        1,
      ),
      row('review_schedules', 'weird', { state: 'unknown-state', due_at: '2026-11-02T00:00:00.000Z' }, 2),
    ])
    const rows = tableRows(cache, 'review_schedules', ReviewScheduleSchema)
    const apple = rows.find((r) => r.key === 'apple')?.row
    expect(apple).toMatchObject({
      word_key: 'apple',
      state: 'review',
      stability: 4.5,
      reps: 2,
      lapses: 0,
      last_review_at: null,
      learning_steps: 0,
    })
    expect(rows.find((r) => r.key === 'weird')?.row.state).toBe('new')
  })

  it('parses coach reports whose advice and label are JSON text', () => {
    const advice = {
      headline: 'Steady week',
      summary: 'Good',
      strengths: ['regular'],
      concerns: [],
      recommendations: [
        { title: 'Listen more', why: 'weakest skill', action: '15 min podcast', route: '/listening', minutes: 15 },
      ],
      bestStudyTimes: ['20:00'],
      nextPeriodPlan: [
        { day: '2026-11-06', focus: 'Listening', modules: ['listening'], activities: ['Dictation'], minutes: 20 },
      ],
      motivation: 'Keep going',
      ieltsOutlook: 'On track',
    }
    const p = CoachReportSchema.parse({
      id: 3,
      period: 'week',
      period_key: '2026-W45',
      label: JSON.stringify({ en: 'Week 45', vi: 'Tuần 45' }),
      stats: '{}',
      advice: JSON.stringify(advice),
      source: 'ai',
      created_at: '2026-11-05T08:00:00.000Z',
    })
    expect(p.label.vi).toBe('Tuần 45')
    expect(p.advice.recommendations[0]?.minutes).toBe(15)
    expect(p.advice.nextPeriodPlan[0]?.activities).toEqual(['Dictation'])
    // Partial advice still renders.
    const partial = CoachReportSchema.parse({
      period: 'day',
      period_key: '2026-11-05',
      label: 'not json',
      advice: { headline: 'Hi' },
    })
    expect(partial.advice.recommendations).toEqual([])
    expect(partial.label).toEqual({ en: '', vi: '' })
  })
})

describe('web sync – cache', () => {
  it('applies last-writer-wins, deletions, and advances the cursor only for pulled rows', () => {
    let cache = emptyCache('u')
    cache = applyRows(cache, [row('vocabulary', 'a', { v: 1 }, 5, '2026-11-01T10:00:00Z')], { pulled: true })
    expect(cache.cursor).toBe(5)
    // An older version (e.g. a slow desktop push) does not overwrite the newer one.
    cache = applyRows(cache, [row('vocabulary', 'a', { v: 0 }, 9, '2026-11-01T09:00:00Z')], { pulled: true })
    expect(rawRow(cache, 'vocabulary', 'a')).toEqual({ v: 1 })
    expect(cache.cursor).toBe(9)
    // Local optimistic row: applied, cursor unchanged.
    const before = cache
    cache = applyRows(cache, [push('vocabulary', 'a', '2026-11-01T11:00:00Z', { v: 2 })])
    expect(rawRow(cache, 'vocabulary', 'a')).toEqual({ v: 2 })
    expect(cache.cursor).toBe(9)
    expect(rawRow(before, 'vocabulary', 'a')).toEqual({ v: 1 }) // immutable update
    cache = applyRows(cache, [row('vocabulary', 'a', {}, 12, '2026-11-01T12:00:00Z', true)], { pulled: true })
    expect(rawRow(cache, 'vocabulary', 'a')).toBeNull()
  })

  it('pulls pages after the cursor until a short page', async () => {
    const pages: SyncRow[][] = [
      [
        row('vocabulary', 'a', { word: 'a', word_key: 'a' }, 11),
        row('vocabulary', 'b', { word: 'b', word_key: 'b' }, 12),
      ],
      [row('lessons', 'd:1', { title: 'L' }, 15)],
    ]
    const paths: string[] = []
    const client: RestClient = {
      json: async <T>(path: string) => {
        paths.push(path)
        return (pages.shift() ?? []) as T
      },
      rpc: async () => {
        throw new Error('unused')
      },
    }
    const start = { ...emptyCache('u'), cursor: 10 }
    const { cache, pulled } = await pullChanges(client, start, {
      pageSize: 2,
      now: () => new Date('2026-11-05T00:00:00Z'),
    })
    expect(pulled).toBe(3)
    expect(cache.cursor).toBe(15)
    expect(cache.lastPullAt).toBe('2026-11-05T00:00:00.000Z')
    expect(paths).toHaveLength(2)
    expect(paths[0]).toContain('seq=gt.10')
    expect(paths[1]).toContain('seq=gt.12')
    expect(paths[0]).toContain('order=seq.asc')
    expect(paths[0]).toContain(
      'tbl=in.(vocabulary,review_schedules,review_logs,activity_log,xp_events,lessons,coach_reports,user_profile)',
    )
  })

  it('builds the pull path with a sane cursor', () => {
    expect(pullPath(-3.5, ['a', 'b'], 50)).toBe(
      '/rest/v1/sync_rows?select=tbl,row_key,data,deleted,client_updated_at,seq&seq=gt.0&tbl=in.(a,b)&order=seq.asc&limit=50',
    )
  })
})

describe('web sync – offline queue', () => {
  it('keeps only the latest version of a mutable row and every append-only row', () => {
    let q: PushRow[] = []
    q = enqueue(q, [
      push('review_schedules', 'apple', '2026-11-05T10:00:00Z', { reps: 1 }),
      push('review_logs', 'web:1', '2026-11-05T10:00:00Z'),
    ])
    q = enqueue(q, [
      push('review_schedules', 'apple', '2026-11-05T10:05:00Z', { reps: 2 }),
      push('review_logs', 'web:2', '2026-11-05T10:05:00Z'),
    ])
    q = enqueue(q, [push('review_schedules', 'apple', '2026-11-05T09:00:00Z', { reps: 0 })]) // stale: ignored
    expect(q.map((r) => r.row_key)).toEqual(['web:1', 'apple', 'web:2'])
    expect(q.find((r) => r.row_key === 'apple')?.data).toEqual({ reps: 2 })
  })

  it('persists the queue per user and survives corrupt storage', () => {
    const kv = memoryKV()
    saveQueue(kv, 'u1', [push('review_logs', 'web:1', '2026-11-05T10:00:00Z')])
    expect(loadQueue(kv, 'u1')).toHaveLength(1)
    expect(loadQueue(kv, 'u2')).toEqual([])
    saveQueue(kv, 'u1', [])
    expect(kv.get('lq.queue.u1')).toBeNull()
    kv.set('lq.queue.u3', '{not json')
    expect(loadQueue(kv, 'u3')).toEqual([])
  })

  it('flushes in batches and keeps unsent rows when the network drops', async () => {
    const sent: unknown[][] = []
    let fail = false
    const client: RestClient = {
      json: async () => null as never,
      rpc: async <T>(fn: string, args?: Record<string, unknown>) => {
        expect(fn).toBe('sync_push')
        if (fail) throw new CloudError('network', 'offline')
        sent.push(args?.rows as unknown[])
        fail = sent.length === 2
        return 2 as T
      },
    }
    const queue = Array.from({ length: 5 }, (_, i) => push('review_logs', `web:${i}`, '2026-11-05T10:00:00Z'))
    const res = await flushQueue(client, queue, 'dev-1', 2)
    expect(sent.map((b) => b.length)).toEqual([2, 2])
    expect(res.sent).toBe(4)
    expect(res.remaining.map((r) => r.row_key)).toEqual(['web:4'])
    expect(res.error?.code).toBe('network')
  })

  it('retries without the device id when the devices foreign key rejects it', async () => {
    const devices: unknown[] = []
    const client: RestClient = {
      json: async () => null as never,
      rpc: async <T>(_fn: string, args?: Record<string, unknown>) => {
        devices.push(args?.device)
        if (args?.device)
          throw new CloudError('bad_request', 'insert or update on table "sync_rows" violates foreign key constraint')
        return 1 as T
      },
    }
    const res = await flushQueue(client, [push('review_logs', 'web:1', '2026-11-05T10:00:00Z')], 'gone')
    expect(devices).toEqual(['gone', null])
    expect(res).toMatchObject({ sent: 1, remaining: [], error: null, deviceRejected: true })
  })

  it('registers the browser as a device once', async () => {
    const kv = memoryKV()
    const calls: { path: string; body: unknown }[] = []
    const client: RestClient = {
      json: async <T>(path: string, init?: RequestInit) => {
        calls.push({ path, body: JSON.parse(String(init?.body)) })
        return [{ id: 'dev-123' }] as T
      },
      rpc: async () => null as never,
    }
    expect(await ensureDevice(client, kv, 'u1', { name: 'Web – điện thoại', appVersion: '1.0.0' })).toBe('dev-123')
    expect(await ensureDevice(client, kv, 'u1', { name: 'x', appVersion: '1' })).toBe('dev-123')
    expect(calls).toHaveLength(1)
    expect(calls[0]?.path).toBe('/rest/v1/devices?select=id')
    expect(calls[0]?.body).toMatchObject({ user_id: 'u1', platform: 'web' })
    expect(kv.get(deviceKey('u1'))).toBe('dev-123')

    const failing: RestClient = {
      json: async () => {
        throw new CloudError('forbidden', 'RLS')
      },
      rpc: async () => null as never,
    }
    expect(await ensureDevice(failing, memoryKV(), 'u2', { name: 'x', appVersion: '1' })).toBeNull()
  })
})
