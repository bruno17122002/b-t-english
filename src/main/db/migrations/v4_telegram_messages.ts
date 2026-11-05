// Schema v4: short-term memory of the in-app Telegram bot (the last ~20 turns of the linked chat).
export const V4_TELEGRAM_MESSAGES = `
CREATE TABLE IF NOT EXISTS telegram_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  chat_id TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('user','assistant')),
  content TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'text',
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_telegram_messages_chat ON telegram_messages(chat_id, id);
`
