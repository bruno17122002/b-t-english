// App settings (key/value) with typed defaults, favorites and bookmarks.
import type { AppSettings, Bookmark, Favorite } from '@shared/types'
import type { AppDatabase } from '../../db/database'

export const DEFAULT_SETTINGS: AppSettings = {
  uiLanguage: 'vi',
  theme: 'dark',
  accent: 'aurora',
  notificationsEnabled: true,
  reminderTime: '20:00',
  ttsEngine: 'system',
  systemVoiceUri: '',
  speechRate: 1,
  showVietnameseHints: true,
  reduceMotion: false,
  dailyGoalXp: 50,
}

export class SettingsService {
  constructor(
    private readonly db: AppDatabase,
    private readonly now: () => Date = () => new Date(),
  ) {}

  get(): AppSettings {
    const rows = this.db.all<{ key: string; value: string }>('SELECT key, value FROM app_settings')
    const out: AppSettings = { ...DEFAULT_SETTINGS }
    for (const r of rows) {
      if (!(r.key in DEFAULT_SETTINGS)) continue
      try {
        ;(out as unknown as Record<string, unknown>)[r.key] = JSON.parse(r.value)
      } catch {
        /* keep default */
      }
    }
    return out
  }

  update(patch: Partial<AppSettings>): AppSettings {
    this.db.transaction(() => {
      for (const [k, v] of Object.entries(patch)) {
        if (!(k in DEFAULT_SETTINGS) || v === undefined) continue
        this.db.run(
          'INSERT INTO app_settings(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
          [k, JSON.stringify(v)],
        )
      }
    })
    return this.get()
  }

  /** Internal flags not exposed as user settings (e.g. last reminder date). */
  getFlag(key: string): string | null {
    const v = this.db.value<string>('SELECT value FROM app_settings WHERE key = ?', [`flag:${key}`])
    return v ?? null
  }

  setFlag(key: string, value: string): void {
    this.db.run(
      'INSERT INTO app_settings(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
      [`flag:${key}`, value],
    )
  }

  // ---------- favorites ----------
  favorites(kind?: string): Favorite[] {
    return this.db
      .all<{ id: number; kind: string; ref: string; title: string; created_at: string }>(
        `SELECT * FROM favorites ${kind ? 'WHERE kind = ?' : ''} ORDER BY created_at DESC`,
        kind ? [kind] : [],
      )
      .map((r) => ({ id: r.id, kind: r.kind, ref: r.ref, title: r.title, createdAt: r.created_at }))
  }

  isFavorite(kind: string, ref: string): boolean {
    return Number(this.db.value('SELECT COUNT(*) FROM favorites WHERE kind = ? AND ref = ?', [kind, ref]) ?? 0) > 0
  }

  toggleFavorite(kind: string, ref: string, title: string): boolean {
    if (this.isFavorite(kind, ref)) {
      this.db.run('DELETE FROM favorites WHERE kind = ? AND ref = ?', [kind, ref])
      return false
    }
    this.db.run('INSERT INTO favorites(kind, ref, title, created_at) VALUES (?, ?, ?, ?)', [
      kind,
      ref,
      title.slice(0, 200),
      this.now().toISOString(),
    ])
    return true
  }

  // ---------- bookmarks ----------
  bookmarks(kind?: string, ref?: string): Bookmark[] {
    const where: string[] = []
    const params: string[] = []
    if (kind) {
      where.push('kind = ?')
      params.push(kind)
    }
    if (ref) {
      where.push('ref = ?')
      params.push(ref)
    }
    return this.db
      .all<{
        id: number
        kind: string
        ref: string
        title: string
        note: string
        position: string
        created_at: string
      }>(
        `SELECT * FROM bookmarks ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY created_at DESC`,
        params,
      )
      .map((r) => ({ ...r, createdAt: r.created_at }))
  }

  addBookmark(b: Omit<Bookmark, 'id' | 'createdAt'>): Bookmark[] {
    this.db.run('INSERT INTO bookmarks(kind, ref, title, note, position, created_at) VALUES (?, ?, ?, ?, ?, ?)', [
      b.kind,
      b.ref,
      b.title.slice(0, 200),
      b.note.slice(0, 1000),
      b.position.slice(0, 200),
      this.now().toISOString(),
    ])
    return this.bookmarks(b.kind, b.ref)
  }

  removeBookmark(id: number): void {
    this.db.run('DELETE FROM bookmarks WHERE id = ?', [id])
  }
}
