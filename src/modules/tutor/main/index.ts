// Main-process side of the tutor module: registers IPC handlers on the kernel router.
import type { ModuleMain } from '../../types.main'
import { TutorService } from './service'

export const tutorMain: ModuleMain = {
  id: 'tutor',
  migrations: [
    {
      version: 1,
      name: 'tutor message feedback and rolling summary',
      sql: `
CREATE TABLE IF NOT EXISTS tutor_message_meta (
  message_id INTEGER PRIMARY KEY REFERENCES tutor_messages(id) ON DELETE CASCADE,
  corrections TEXT NOT NULL DEFAULT '[]',
  new_words TEXT NOT NULL DEFAULT '[]',
  follow_up TEXT NOT NULL DEFAULT '',
  provider TEXT
);
CREATE TABLE IF NOT EXISTS tutor_conversation_state (
  conversation_id INTEGER PRIMARY KEY REFERENCES tutor_conversations(id) ON DELETE CASCADE,
  summary TEXT NOT NULL DEFAULT '',
  summarized_upto INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL
);`,
    },
  ],
  register(router, kernel) {
    const service = new TutorService(kernel)
    router.handle('tutor:list', (input) => service.list(input?.query))
    router.handle('tutor:create', (input) => service.create(input.mode, input.title))
    router.handle('tutor:get', (input) => service.get(input.id))
    router.handle('tutor:rename', (input) => service.rename(input.id, input.title))
    router.handle('tutor:setMode', (input) => service.setMode(input.id, input.mode))
    router.handle('tutor:delete', (input) => {
      service.delete(input.id)
      return null
    })
    router.handle('tutor:send', (input) => service.send(input.conversationId, input.text, input.viaVoice ?? false))
  },
}
