// Schema v5: change capture for multi-device sync (Lingua Quest Online, phase 3).
// sync_outbox  – rows changed locally since the last push (filled by triggers, emptied after a push)
// sync_map     – rows pulled from other devices: remote row_key → local id (append-only tables)
// sync_state   – cursor, flags ('active' enables the triggers, 'suppress' mutes them while applying a pull)
// Triggers for module-owned tables (coach_*) are installed at runtime by the sync engine because module
// tables are created after the kernel migrations.
import { syncTriggerSql } from '../../kernel/cloud/syncTables'

/** Frozen copy of the kernel tables captured by v5: [table, primary key, natural key over `$` or null]. */
const V5_TABLES: [string, string, string | null][] = [
  ['user_profile', 'id', "'singleton'"],
  ['skill_levels', 'skill', '$.skill'],
  ['learning_goals', 'id', null],
  ['vocabulary', 'id', '$.word_key'],
  ['review_schedules', 'vocab_id', '(SELECT word_key FROM vocabulary WHERE id = $.vocab_id)'],
  ['review_logs', 'id', null],
  ['assessments', 'id', null],
  ['assessment_answers', 'id', null],
  ['roadmaps', 'id', null],
  ['roadmap_weeks', 'id', null],
  ['lessons', 'id', "$.date || ':' || $.module || ':' || COALESCE($.content_ref, $.title)"],
  ['lesson_attempts', 'id', null],
  ['writing_submissions', 'id', null],
  ['speaking_sessions', 'id', null],
  ['listening_history', 'id', null],
  ['reading_history', 'id', null],
  ['reading_highlights', 'id', null],
  ['stories', 'id', '$.id'],
  ['story_progress', 'story_id', '$.story_id'],
  ['xp_events', 'id', null],
  ['activity_log', 'id', null],
  ['tutor_conversations', 'id', null],
  ['tutor_messages', 'id', null],
  ['learner_mistakes', 'id', '$.pattern_key'],
  ['favorites', 'id', "$.kind || ':' || $.ref"],
  ['bookmarks', 'id', null],
]

export const V5_SYNC_TABLES_FROZEN = V5_TABLES

export const V5_SYNC_OUTBOX = `
CREATE TABLE IF NOT EXISTS sync_state (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS sync_outbox (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tbl TEXT NOT NULL,
  local_id TEXT NOT NULL,
  nat_key TEXT,
  changed_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sync_outbox_key ON sync_outbox(tbl, nat_key);
CREATE INDEX IF NOT EXISTS idx_sync_outbox_local ON sync_outbox(tbl, local_id);
CREATE TABLE IF NOT EXISTS sync_map (
  tbl TEXT NOT NULL,
  row_key TEXT NOT NULL,
  local_id TEXT NOT NULL,
  PRIMARY KEY (tbl, row_key)
);
CREATE INDEX IF NOT EXISTS idx_sync_map_local ON sync_map(tbl, local_id);
${V5_TABLES.map(([t, pk, key]) => syncTriggerSql(t, pk, key)).join('\n')}
`
