// Which local tables are synchronised through Supabase `sync_rows`, and how each row gets a stable key.
// This is a CONTRACT shared with the server bot (supabase/functions) and the PWA (web/): see
// docs/ONLINE_PLAN.md → "Hợp đồng dữ liệu đồng bộ". Change it only together with those readers.
//
// - tbl      = the local SQLite table name
// - data     = the full local row (local column names) + the extra reference fields listed in `refs`
// - row_key  = 'device' tables: `<deviceId>:<local id>` (rows from the bot/PWA use their own prefix, e.g. `web:<uuid>`)
//              'natural' tables: the natural key below; 'singleton' tables: the literal 'singleton'
//
// Never listed (never leave the machine): app_settings, ai_settings, telegram_messages, keys (keys.bin),
// generated_content (cache), coach_notifications (per-device delivery log), tutor_message_meta and
// tutor_conversation_state (per-device AI memory). daily_stats, achievements and quests are derived and
// recomputed locally after every pull.

export type SyncKind = 'device' | 'natural' | 'singleton'

export interface SyncRef {
  /** Local foreign-key column, e.g. review_logs.vocab_id. */
  col: string
  /** Referenced table (must be synced and come earlier in SYNC_TABLES). */
  table: string
  /** Extra field added to `data` carrying the referenced row's sync key, e.g. `word_key`. */
  field: string
  /** Rows whose reference cannot be resolved are skipped when the column is NOT NULL. */
  required: boolean
}

export interface SyncTableSpec {
  tbl: string
  kind: SyncKind
  /** Local primary-key column. */
  pk: string
  /** INTEGER PRIMARY KEY AUTOINCREMENT: the local id is never copied to another device. */
  autoId: boolean
  /** Natural key as an SQL expression over the row alias `$` (natural/singleton tables). */
  key?: string
  /** Optional faster lookup returning `pk` for a key (one `?` parameter). */
  findSql?: string
  refs?: SyncRef[]
  /** Timestamp (SQL over `$`) used as client_updated_at for the first full upload. */
  ts?: string
}

const EPOCH = "'1970-01-01T00:00:00.000Z'"

/** Ordered so that referenced tables are applied before the tables that point at them. */
export const SYNC_TABLES: SyncTableSpec[] = [
  {
    tbl: 'user_profile',
    kind: 'singleton',
    pk: 'id',
    autoId: false,
    key: "'singleton'",
    // A fresh install (onboarding not done) must never overwrite the real profile from another device.
    ts: `CASE WHEN $.onboarding_completed_at IS NULL THEN ${EPOCH} ELSE $.updated_at END`,
  },
  { tbl: 'skill_levels', kind: 'natural', pk: 'skill', autoId: false, key: '$.skill' },
  { tbl: 'learning_goals', kind: 'device', pk: 'id', autoId: true },
  { tbl: 'vocabulary', kind: 'natural', pk: 'id', autoId: true, key: '$.word_key' },
  {
    tbl: 'review_schedules',
    kind: 'natural',
    pk: 'vocab_id',
    autoId: false,
    key: '(SELECT word_key FROM vocabulary WHERE id = $.vocab_id)',
    findSql:
      'SELECT r.vocab_id AS pk FROM review_schedules r JOIN vocabulary v ON v.id = r.vocab_id WHERE v.word_key = ?',
    refs: [{ col: 'vocab_id', table: 'vocabulary', field: 'word_key', required: true }],
    ts: `COALESCE($.last_review_at, ${EPOCH})`,
  },
  {
    tbl: 'review_logs',
    kind: 'device',
    pk: 'id',
    autoId: true,
    refs: [{ col: 'vocab_id', table: 'vocabulary', field: 'word_key', required: true }],
  },
  { tbl: 'assessments', kind: 'device', pk: 'id', autoId: true },
  {
    tbl: 'assessment_answers',
    kind: 'device',
    pk: 'id',
    autoId: true,
    refs: [{ col: 'assessment_id', table: 'assessments', field: 'assessment_key', required: true }],
  },
  { tbl: 'roadmaps', kind: 'device', pk: 'id', autoId: true },
  {
    tbl: 'roadmap_weeks',
    kind: 'device',
    pk: 'id',
    autoId: true,
    refs: [{ col: 'roadmap_id', table: 'roadmaps', field: 'roadmap_key', required: true }],
  },
  {
    tbl: 'lessons',
    kind: 'natural',
    pk: 'id',
    autoId: true,
    key: "$.date || ':' || $.module || ':' || COALESCE($.content_ref, $.title)",
    refs: [{ col: 'roadmap_id', table: 'roadmaps', field: 'roadmap_key', required: false }],
  },
  {
    tbl: 'lesson_attempts',
    kind: 'device',
    pk: 'id',
    autoId: true,
    refs: [{ col: 'lesson_id', table: 'lessons', field: 'lesson_key', required: false }],
  },
  { tbl: 'writing_submissions', kind: 'device', pk: 'id', autoId: true },
  { tbl: 'speaking_sessions', kind: 'device', pk: 'id', autoId: true },
  { tbl: 'listening_history', kind: 'device', pk: 'id', autoId: true },
  { tbl: 'reading_history', kind: 'device', pk: 'id', autoId: true },
  { tbl: 'reading_highlights', kind: 'device', pk: 'id', autoId: true },
  { tbl: 'stories', kind: 'natural', pk: 'id', autoId: false, key: '$.id' },
  { tbl: 'story_progress', kind: 'natural', pk: 'story_id', autoId: false, key: '$.story_id' },
  { tbl: 'xp_events', kind: 'device', pk: 'id', autoId: true },
  { tbl: 'activity_log', kind: 'device', pk: 'id', autoId: true },
  { tbl: 'tutor_conversations', kind: 'device', pk: 'id', autoId: true },
  {
    tbl: 'tutor_messages',
    kind: 'device',
    pk: 'id',
    autoId: true,
    refs: [{ col: 'conversation_id', table: 'tutor_conversations', field: 'conversation_key', required: true }],
  },
  { tbl: 'learner_mistakes', kind: 'natural', pk: 'id', autoId: true, key: '$.pattern_key' },
  { tbl: 'favorites', kind: 'natural', pk: 'id', autoId: true, key: "$.kind || ':' || $.ref" },
  { tbl: 'bookmarks', kind: 'device', pk: 'id', autoId: true },
  // Coach module tables (created by the module migration, so their triggers are installed at runtime).
  { tbl: 'coach_sessions', kind: 'device', pk: 'id', autoId: false },
  { tbl: 'coach_views', kind: 'device', pk: 'id', autoId: false },
  {
    tbl: 'coach_reports',
    kind: 'natural',
    pk: 'id',
    autoId: true,
    key: "$.period || ':' || $.period_key",
    ts: '$.created_at',
  },
  { tbl: 'coach_qa', kind: 'device', pk: 'id', autoId: true },
]

export const SYNC_TABLE_MAP = new Map(SYNC_TABLES.map((s) => [s.tbl, s]))

/** Tables that are never synchronised – asserted by tests. */
export const NEVER_SYNCED = [
  'app_settings',
  'ai_settings',
  'telegram_messages',
  'generated_content',
  'coach_notifications',
  'tutor_message_meta',
  'tutor_conversation_state',
  'daily_stats',
  'achievements',
  'quests',
  'sync_outbox',
  'sync_map',
  'sync_state',
]

export const keySql = (spec: SyncTableSpec, alias: string): string | null =>
  spec.key ? spec.key.replace(/\$\./g, `${alias}.`) : null

/**
 * AFTER INSERT/UPDATE/DELETE triggers that record changed rows in sync_outbox. They only fire while
 * sync is active (signed in once) and not while pulled rows are being applied ('suppress').
 * Frozen: the v5 migration uses this for the kernel tables – change it only with a new migration.
 */
export function syncTriggerSql(tbl: string, pk: string, key: string | null): string {
  const k = (alias: string) => (key ? key.replace(/\$\./g, `${alias}.`) : 'NULL')
  const when =
    "WHEN EXISTS (SELECT 1 FROM sync_state WHERE key = 'active') AND NOT EXISTS (SELECT 1 FROM sync_state WHERE key = 'suppress')"
  const now = "strftime('%Y-%m-%dT%H:%M:%fZ', 'now')"
  const ins = (alias: string) =>
    `INSERT INTO sync_outbox(tbl, local_id, nat_key, changed_at) VALUES ('${tbl}', ${alias}.${pk}, ${k(alias)}, ${now});`
  return `
CREATE TRIGGER IF NOT EXISTS sync_${tbl}_ai AFTER INSERT ON ${tbl} ${when}
BEGIN ${ins('NEW')} END;
CREATE TRIGGER IF NOT EXISTS sync_${tbl}_au AFTER UPDATE ON ${tbl} ${when}
BEGIN
  INSERT INTO sync_outbox(tbl, local_id, nat_key, changed_at)
    SELECT '${tbl}', OLD.${pk}, ${k('OLD')}, ${now} WHERE ${k('OLD')} IS NOT ${k('NEW')};
  ${ins('NEW')}
END;
CREATE TRIGGER IF NOT EXISTS sync_${tbl}_ad AFTER DELETE ON ${tbl} ${when}
BEGIN ${ins('OLD')} END;
`
}
