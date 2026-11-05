// Schema v1. Timestamps are ISO-8601 strings, calendar days are local YYYY-MM-DD keys.
export const V1_INITIAL = `
CREATE TABLE user_profile (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  display_name TEXT NOT NULL DEFAULT '',
  self_reported_level TEXT NOT NULL DEFAULT 'beginner'
    CHECK (self_reported_level IN ('beginner','elementary','intermediate','upper','advanced')),
  overall_cefr TEXT CHECK (overall_cefr IN ('A1','A2','B1','B2','C1','C2')),
  target_cefr TEXT NOT NULL DEFAULT 'B2' CHECK (target_cefr IN ('A1','A2','B1','B2','C1','C2')),
  target_ielts REAL CHECK (target_ielts IS NULL OR (target_ielts >= 0 AND target_ielts <= 9)),
  daily_minutes INTEGER NOT NULL DEFAULT 20 CHECK (daily_minutes BETWEEN 5 AND 240),
  purposes TEXT NOT NULL DEFAULT '[]',
  interests TEXT NOT NULL DEFAULT '[]',
  learning_style TEXT NOT NULL DEFAULT 'mixed',
  onboarding_completed_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE learning_goals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL CHECK (kind IN ('short','long','custom')),
  title TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 200),
  metric TEXT NOT NULL DEFAULT 'none' CHECK (metric IN ('minutes','words','lessons','xp','none')),
  target_value REAL NOT NULL DEFAULT 0,
  current_value REAL NOT NULL DEFAULT 0,
  target_date TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','done','archived')),
  created_at TEXT NOT NULL
);

CREATE TABLE skill_levels (
  skill TEXT PRIMARY KEY CHECK (skill IN ('vocabulary','grammar','reading','listening','writing','speaking')),
  cefr TEXT NOT NULL CHECK (cefr IN ('A1','A2','B1','B2','C1','C2')),
  score REAL NOT NULL DEFAULT 0 CHECK (score BETWEEN 0 AND 100),
  source TEXT NOT NULL DEFAULT 'self',
  estimated INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL
);

CREATE TABLE assessments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  started_at TEXT NOT NULL,
  completed_at TEXT,
  start_level TEXT NOT NULL,
  overall_cefr TEXT,
  results TEXT
);

CREATE TABLE assessment_answers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  assessment_id INTEGER NOT NULL REFERENCES assessments(id) ON DELETE CASCADE,
  skill TEXT NOT NULL,
  item_id TEXT NOT NULL,
  cefr TEXT NOT NULL,
  correct INTEGER NOT NULL,
  response TEXT,
  created_at TEXT NOT NULL,
  UNIQUE (assessment_id, item_id)
);
CREATE INDEX idx_assessment_answers_assessment ON assessment_answers(assessment_id, skill);

CREATE TABLE roadmaps (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at TEXT NOT NULL,
  start_date TEXT NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('ai','offline')),
  provider TEXT,
  is_active INTEGER NOT NULL DEFAULT 1,
  summary TEXT NOT NULL,
  user_notes TEXT NOT NULL DEFAULT ''
);
CREATE INDEX idx_roadmaps_active ON roadmaps(is_active);

CREATE TABLE roadmap_weeks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  roadmap_id INTEGER NOT NULL REFERENCES roadmaps(id) ON DELETE CASCADE,
  week_index INTEGER NOT NULL,
  theme TEXT NOT NULL,
  focus_skills TEXT NOT NULL,
  objectives TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'upcoming' CHECK (status IN ('upcoming','current','done')),
  UNIQUE (roadmap_id, week_index)
);

CREATE TABLE lessons (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  roadmap_id INTEGER REFERENCES roadmaps(id) ON DELETE SET NULL,
  date TEXT NOT NULL,
  module TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  content_ref TEXT,
  estimated_minutes INTEGER NOT NULL DEFAULT 10,
  status TEXT NOT NULL DEFAULT 'todo' CHECK (status IN ('todo','done','skipped')),
  completed_at TEXT,
  position INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_lessons_date ON lessons(date);

CREATE TABLE lesson_attempts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  lesson_id INTEGER REFERENCES lessons(id) ON DELETE SET NULL,
  module TEXT NOT NULL,
  content_ref TEXT,
  title TEXT NOT NULL DEFAULT '',
  score REAL,
  duration_sec INTEGER NOT NULL DEFAULT 0,
  details TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_lesson_attempts_module ON lesson_attempts(module, created_at);
CREATE INDEX idx_lesson_attempts_ref ON lesson_attempts(content_ref);

CREATE TABLE vocabulary (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  word TEXT NOT NULL CHECK (length(word) BETWEEN 1 AND 80),
  word_key TEXT NOT NULL UNIQUE,
  ipa TEXT NOT NULL DEFAULT '',
  pos TEXT NOT NULL DEFAULT '',
  meaning_vi TEXT NOT NULL DEFAULT '',
  meaning_en TEXT NOT NULL DEFAULT '',
  examples TEXT NOT NULL DEFAULT '[]',
  context TEXT NOT NULL DEFAULT '',
  source_module TEXT NOT NULL DEFAULT 'manual',
  source_ref TEXT NOT NULL DEFAULT '',
  collocations TEXT NOT NULL DEFAULT '[]',
  idioms TEXT NOT NULL DEFAULT '[]',
  phrasal_verbs TEXT NOT NULL DEFAULT '[]',
  cefr TEXT CHECK (cefr IS NULL OR cefr IN ('A1','A2','B1','B2','C1','C2')),
  topic TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  is_favorite INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX idx_vocabulary_created ON vocabulary(created_at);

CREATE TABLE review_schedules (
  vocab_id INTEGER PRIMARY KEY REFERENCES vocabulary(id) ON DELETE CASCADE,
  state TEXT NOT NULL DEFAULT 'new' CHECK (state IN ('new','learning','review','relearning')),
  due_at TEXT NOT NULL,
  stability REAL NOT NULL DEFAULT 0,
  difficulty REAL NOT NULL DEFAULT 0,
  reps INTEGER NOT NULL DEFAULT 0,
  lapses INTEGER NOT NULL DEFAULT 0,
  scheduled_days INTEGER NOT NULL DEFAULT 0,
  last_review_at TEXT
);
CREATE INDEX idx_review_due ON review_schedules(due_at);

CREATE TABLE review_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  vocab_id INTEGER NOT NULL REFERENCES vocabulary(id) ON DELETE CASCADE,
  rating INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 4),
  state_before TEXT NOT NULL,
  elapsed_days REAL NOT NULL,
  scheduled_days INTEGER NOT NULL,
  duration_ms INTEGER NOT NULL DEFAULT 0,
  reviewed_at TEXT NOT NULL
);
CREATE INDEX idx_review_logs_date ON review_logs(reviewed_at);

CREATE TABLE writing_submissions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  prompt_id TEXT,
  task_type TEXT NOT NULL,
  prompt_text TEXT NOT NULL DEFAULT '',
  original_text TEXT NOT NULL,
  self_corrected_text TEXT,
  feedback TEXT,
  metrics TEXT NOT NULL,
  provider TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_writing_created ON writing_submissions(created_at);

CREATE TABLE speaking_sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  mode TEXT NOT NULL,
  prompt_id TEXT,
  prompt TEXT NOT NULL DEFAULT '',
  transcript TEXT NOT NULL DEFAULT '',
  measured TEXT NOT NULL,
  feedback TEXT,
  provider TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_speaking_created ON speaking_sessions(created_at);

CREATE TABLE listening_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  track_id TEXT NOT NULL,
  mode TEXT NOT NULL,
  correct INTEGER NOT NULL DEFAULT 0,
  total INTEGER NOT NULL DEFAULT 0,
  accuracy REAL,
  speed REAL NOT NULL DEFAULT 1,
  details TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_listening_created ON listening_history(created_at);

CREATE TABLE reading_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  passage_id TEXT NOT NULL,
  words INTEGER NOT NULL,
  seconds INTEGER NOT NULL,
  wpm INTEGER NOT NULL,
  quiz_correct INTEGER NOT NULL DEFAULT 0,
  quiz_total INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_reading_created ON reading_history(created_at);

CREATE TABLE reading_highlights (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  passage_id TEXT NOT NULL,
  text TEXT NOT NULL CHECK (length(text) BETWEEN 1 AND 2000),
  note TEXT NOT NULL DEFAULT '',
  color TEXT NOT NULL DEFAULT 'amber',
  created_at TEXT NOT NULL
);
CREATE INDEX idx_highlights_passage ON reading_highlights(passage_id);

CREATE TABLE stories (
  id TEXT PRIMARY KEY,
  source TEXT NOT NULL CHECK (source IN ('builtin','ai')),
  genre TEXT NOT NULL,
  title TEXT NOT NULL,
  cefr TEXT NOT NULL,
  data TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE story_progress (
  story_id TEXT PRIMARY KEY,
  current_scene_id TEXT NOT NULL,
  path TEXT NOT NULL DEFAULT '[]',
  choices TEXT NOT NULL DEFAULT '[]',
  quiz_correct INTEGER NOT NULL DEFAULT 0,
  quiz_total INTEGER NOT NULL DEFAULT 0,
  ending_type TEXT,
  started_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  completed_at TEXT
);

CREATE TABLE xp_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  amount INTEGER NOT NULL,
  source TEXT NOT NULL,
  skill TEXT,
  ref TEXT,
  date TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_xp_date ON xp_events(date);
CREATE INDEX idx_xp_skill ON xp_events(skill);

CREATE TABLE achievements (
  key TEXT PRIMARY KEY,
  unlocked_at TEXT NOT NULL
);

CREATE TABLE quests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  period TEXT NOT NULL CHECK (period IN ('daily','weekly')),
  period_key TEXT NOT NULL,
  quest_key TEXT NOT NULL,
  metric TEXT NOT NULL,
  title TEXT NOT NULL,
  title_vi TEXT NOT NULL,
  target INTEGER NOT NULL CHECK (target > 0),
  progress INTEGER NOT NULL DEFAULT 0,
  xp_reward INTEGER NOT NULL,
  route TEXT NOT NULL DEFAULT '/',
  completed_at TEXT,
  UNIQUE (period, period_key, quest_key)
);

CREATE TABLE daily_stats (
  date TEXT PRIMARY KEY,
  minutes REAL NOT NULL DEFAULT 0,
  xp INTEGER NOT NULL DEFAULT 0,
  words_saved INTEGER NOT NULL DEFAULT 0,
  reviews INTEGER NOT NULL DEFAULT 0,
  lessons INTEGER NOT NULL DEFAULT 0,
  skill_minutes TEXT NOT NULL DEFAULT '{}'
);

CREATE TABLE activity_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  module TEXT NOT NULL,
  action TEXT NOT NULL,
  title TEXT NOT NULL DEFAULT '',
  ref TEXT NOT NULL DEFAULT '',
  skill TEXT,
  minutes REAL NOT NULL DEFAULT 0,
  xp INTEGER NOT NULL DEFAULT 0,
  date TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_activity_date ON activity_log(date);

CREATE TABLE tutor_conversations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  mode TEXT NOT NULL,
  title TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE tutor_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  conversation_id INTEGER NOT NULL REFERENCES tutor_conversations(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('user','assistant')),
  content TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_tutor_messages_conv ON tutor_messages(conversation_id, id);

CREATE TABLE learner_mistakes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  category TEXT NOT NULL,
  pattern TEXT NOT NULL,
  pattern_key TEXT NOT NULL UNIQUE,
  example TEXT NOT NULL DEFAULT '',
  correction TEXT NOT NULL DEFAULT '',
  count INTEGER NOT NULL DEFAULT 1,
  last_seen_at TEXT NOT NULL
);

CREATE TABLE ai_settings (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  default_provider TEXT CHECK (default_provider IS NULL OR default_provider IN ('gemini','openai')),
  gemini_model TEXT NOT NULL,
  openai_model TEXT NOT NULL,
  response_language TEXT NOT NULL DEFAULT 'mixed' CHECK (response_language IN ('en','vi','mixed')),
  tutor_style TEXT NOT NULL DEFAULT 'friendly',
  stt_provider TEXT NOT NULL DEFAULT 'auto',
  updated_at TEXT NOT NULL
);

CREATE TABLE app_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE favorites (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL,
  ref TEXT NOT NULL,
  title TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE (kind, ref)
);

CREATE TABLE bookmarks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL,
  ref TEXT NOT NULL,
  title TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  position TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);

CREATE TABLE generated_content (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('reading','listening','lesson')),
  cefr TEXT NOT NULL,
  title TEXT NOT NULL,
  data TEXT NOT NULL,
  provider TEXT,
  created_at TEXT NOT NULL
);
`
