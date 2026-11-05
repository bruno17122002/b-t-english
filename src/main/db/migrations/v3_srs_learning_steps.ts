// Schema v3: ts-fsrs tracks the position inside short (re)learning steps.
// Also stores activity scores (perfect-quiz achievements) and adds per-module migration bookkeeping so feature modules can own their tables.
export const V3_SRS_LEARNING_STEPS = `
ALTER TABLE review_schedules ADD COLUMN learning_steps INTEGER NOT NULL DEFAULT 0;
ALTER TABLE activity_log ADD COLUMN score REAL;
CREATE INDEX IF NOT EXISTS idx_activity_action ON activity_log(action);
CREATE TABLE IF NOT EXISTS module_migrations (
  module TEXT NOT NULL,
  version INTEGER NOT NULL,
  name TEXT NOT NULL,
  applied_at TEXT NOT NULL,
  PRIMARY KEY (module, version)
);
`
