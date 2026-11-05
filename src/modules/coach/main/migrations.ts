// Tables owned by the coach module (prefixed coach_). Append-only: never edit a released migration.
import type { Migration } from '../../../main/db/migrations'

const V1 = `
CREATE TABLE IF NOT EXISTS coach_sessions (
  id TEXT PRIMARY KEY,
  started_at TEXT NOT NULL,
  last_active_at TEXT NOT NULL,
  date TEXT NOT NULL,
  start_hour INTEGER NOT NULL,
  active_seconds INTEGER NOT NULL DEFAULT 0,
  idle_seconds INTEGER NOT NULL DEFAULT 0,
  ended INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_coach_sessions_date ON coach_sessions(date);

CREATE TABLE IF NOT EXISTS coach_views (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  route TEXT NOT NULL,
  module TEXT NOT NULL,
  started_at TEXT NOT NULL,
  ended_at TEXT NOT NULL,
  date TEXT NOT NULL,
  hour INTEGER NOT NULL,
  active_seconds INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_coach_views_date ON coach_views(date);

CREATE TABLE IF NOT EXISTS coach_reports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  period TEXT NOT NULL CHECK (period IN ('day','week','month')),
  period_key TEXT NOT NULL,
  label TEXT NOT NULL,
  stats TEXT NOT NULL,
  advice TEXT NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('ai','offline')),
  provider TEXT,
  fallback_reason TEXT,
  delivered TEXT NOT NULL DEFAULT '[]',
  applied_at TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_coach_reports_period ON coach_reports(period, period_key, id);

CREATE TABLE IF NOT EXISTS coach_notifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL,
  run_key TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  route TEXT,
  channels TEXT NOT NULL DEFAULT '[]',
  report_id INTEGER,
  sent_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_coach_notifications_sent ON coach_notifications(kind, sent_at);

CREATE TABLE IF NOT EXISTS coach_qa (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  question TEXT NOT NULL,
  answer TEXT NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('ai','offline')),
  provider TEXT,
  created_at TEXT NOT NULL
);
`

export const COACH_MIGRATIONS: Migration[] = [{ version: 1, name: 'coach habit tracking and reports', sql: V1 }]
