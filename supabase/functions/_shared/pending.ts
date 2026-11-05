// Short-lived values referenced by inline buttons (Telegram callback data is limited to 64 bytes and an Edge Function
// keeps no memory between requests). Stored in public.bot_pending (migration 0002), cleaned up by the scheduler.
import { eq, type SupabaseRest } from './rest.ts'

export type PendingKind = 'review' | 'word' | 'quiz' | 'report' | 'linkfail'

export interface PendingRow<T> {
  id: string
  user_id: string | null
  kind: PendingKind
  data: T
  created_at: string
}

export function shortId(len = 10): string {
  const bytes = new Uint8Array(len)
  crypto.getRandomValues(bytes)
  return [...bytes].map((b) => 'abcdefghijklmnopqrstuvwxyz0123456789'[b % 36]).join('')
}

export class PendingStore {
  constructor(
    private readonly rest: SupabaseRest,
    private readonly now: () => Date,
  ) {}

  async put<T>(userId: string, kind: PendingKind, data: T): Promise<string> {
    const id = shortId()
    await this.rest.forUser(userId).insert('bot_pending', [{ id, kind, data, created_at: this.now().toISOString() }])
    return id
  }

  async get<T>(userId: string, id: string, kind?: PendingKind): Promise<PendingRow<T> | null> {
    if (!/^[a-z0-9:-]{1,40}$/.test(id)) return null
    const rows = await this.rest.forUser(userId).select<PendingRow<T>>('bot_pending', [['id', eq(id)]], { limit: 1 })
    const row = rows[0]
    return row && (!kind || row.kind === kind) ? row : null
  }

  /** Deletes and returns the row (null when it was already used – double-tap protection). */
  async take<T>(userId: string, id: string, kind?: PendingKind): Promise<PendingRow<T> | null> {
    const row = await this.get<T>(userId, id, kind)
    if (!row) return null
    await this.rest.forUser(userId).remove('bot_pending', [['id', eq(id)]])
    return row
  }

  async recent<T>(userId: string, kind: PendingKind, limit: number): Promise<PendingRow<T>[]> {
    return this.rest
      .forUser(userId)
      .select<PendingRow<T>>('bot_pending', [['kind', eq(kind)]], { order: 'created_at.desc', limit })
  }

  // Rows without a user (failed link attempts of a chat).
  async getGlobal<T>(id: string): Promise<PendingRow<T> | null> {
    const rows = await this.rest.select<PendingRow<T>>(
      'bot_pending',
      [
        ['id', eq(id)],
        ['user_id', 'is.null'],
      ],
      { limit: 1 },
    )
    return rows[0] ?? null
  }

  async putGlobal<T>(id: string, kind: PendingKind, data: T): Promise<void> {
    await this.rest.insert('bot_pending', [{ id, user_id: null, kind, data, created_at: this.now().toISOString() }], {
      onConflict: 'id',
      resolution: 'merge',
    })
  }

  async removeGlobal(id: string): Promise<void> {
    await this.rest.remove('bot_pending', [
      ['id', eq(id)],
      ['user_id', 'is.null'],
    ])
  }

  /** Removes rows older than `days` (called by the scheduler). */
  async cleanup(days = 2): Promise<void> {
    await this.rest.remove('bot_pending', [
      ['created_at', `lt.${new Date(this.now().getTime() - days * 86_400_000).toISOString()}`],
    ])
  }
}
