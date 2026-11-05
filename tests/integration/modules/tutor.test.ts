import { describe, expect, it } from 'vitest'
import type { LearnerMistake, TutorConversation, VocabItem } from '../../../src/shared/types'
import type { TutorConversationView, TutorSendResult, TutorThread } from '../../../src/modules/tutor/contract'
import { TutorService } from '../../../src/modules/tutor/main/service'
import { tutorReplyPrompt } from '../../../src/modules/tutor/main/prompts'
import { HISTORY_WINDOW } from '../../../src/modules/tutor/main/history'
import { makeApp } from '../../helpers/kernel'

describe('tutor module', () => {
  it('creates, lists, renames, searches and changes mode of conversations', async () => {
    const { call } = await makeApp()
    const a = await call<TutorConversation>('tutor:create', { mode: 'ielts' })
    expect(a.mode).toBe('ielts')
    expect(a.messageCount).toBe(0)
    await call<TutorConversation>('tutor:create', { mode: 'casual', title: 'Weekend chat' })
    const renamed = await call<TutorConversation>('tutor:rename', { id: a.id, title: 'Band 7 practice' })
    expect(renamed.title).toBe('Band 7 practice')
    const moded = await call<TutorConversation>('tutor:setMode', { id: a.id, mode: 'strict' })
    expect(moded.mode).toBe('strict')
    const list = await call<TutorConversationView[]>('tutor:list')
    expect(list).toHaveLength(2)
    const found = await call<TutorConversationView[]>('tutor:list', { query: 'weekend' })
    expect(found.map((c) => c.title)).toEqual(['Weekend chat'])
    await expect(call('tutor:create', { mode: 'pirate' })).rejects.toThrow(/invalid_input/)
  })

  it('sends a message: reply and corrections persisted, mistakes recorded, words saveable', async () => {
    const { call } = await makeApp()
    const conv = await call<TutorConversation>('tutor:create', { mode: 'friendly' })
    const res = await call<TutorSendResult>('tutor:send', { conversationId: conv.id, text: 'Yesterday i goed to the market' })
    expect(res.assistantMessage.content).toContain('Thanks for your message')
    expect(res.userMessage.corrections.map((c) => c.correction).sort()).toEqual(['I', 'went'])
    expect(res.assistantMessage.newWords[0]?.word).toBe('routine')
    expect(res.assistantMessage.followUpQuestion).toBeTruthy()
    expect(res.xpGained).toBeGreaterThan(0)
    // Untitled conversations take their title from the first learner message.
    expect(res.conversation.title).toBe('Yesterday i goed to the market')
    expect(res.conversation.messageCount).toBe(2)

    const thread = await call<TutorThread>('tutor:get', { id: conv.id })
    expect(thread.messages.map((m) => m.role)).toEqual(['user', 'assistant'])
    expect(thread.messages[0]?.corrections).toHaveLength(2)
    expect(thread.messages[0]?.corrections[0]?.explanationVi).toBeTruthy()

    const mistakes = await call<LearnerMistake[]>('learner:mistakes')
    expect(mistakes.map((m) => m.pattern)).toEqual(expect.arrayContaining(['past simple of irregular verbs', 'capital I']))
    // Same mistake again → counted, not duplicated.
    await call('tutor:send', { conversationId: conv.id, text: 'Then he goed home' })
    const again = await call<LearnerMistake[]>('learner:mistakes')
    expect(again.find((m) => m.pattern === 'past simple of irregular verbs')?.count).toBe(2)

    const word = res.assistantMessage.newWords[0]!
    const saved = await call<{ item: VocabItem; created: boolean }>('vocab:save', {
      word: word.word,
      meaningVi: word.meaningVi,
      examples: [word.example],
      sourceModule: 'tutor',
      sourceRef: `tutor:${conv.id}`,
    })
    expect(saved.created).toBe(true)
    expect(saved.item.sourceModule).toBe('tutor')

    const listed = await call<TutorConversationView[]>('tutor:list', { query: 'goed home' })
    expect(listed[0]?.match).toContain('goed home')
  })

  it('caps tutor XP per day', async () => {
    const { call, kernel } = await makeApp()
    const conv = await call<TutorConversation>('tutor:create', { mode: 'casual' })
    for (let i = 0; i < 30; i++) await call('tutor:send', { conversationId: conv.id, text: `Message number ${i} about my day` })
    const tutorXp = Number(kernel.db.value("SELECT COALESCE(SUM(amount), 0) FROM xp_events WHERE source = 'tutor_message'") ?? 0)
    expect(tutorXp).toBeGreaterThan(0)
    expect(tutorXp).toBeLessThanOrEqual(20)
    const thread = await call<TutorThread>('tutor:get', { id: conv.id })
    expect(thread.messages).toHaveLength(60)
  })

  it('keeps only a bounded window of history plus a rolling summary in the prompt', async () => {
    const { call, kernel } = await makeApp()
    const service = new TutorService(kernel)
    const conv = await call<TutorConversation>('tutor:create', { mode: 'friendly' })
    for (let i = 0; i < 20; i++) await call('tutor:send', { conversationId: conv.id, text: `Turn ${i}: I like football and music` })
    await service.summarizeIfNeeded(conv.id)
    const { input, window } = service.buildPromptInput(conv.id, 'And what about you?')
    expect(input.history.length).toBeLessThanOrEqual(HISTORY_WINDOW)
    expect(input.history[0]?.role).toBe('user')
    expect(window.droppedCount).toBe(40 - input.history.length)
    expect(input.summary.length).toBeGreaterThan(0)
    expect(input.summary.length).toBeLessThanOrEqual(900)
    // The stored summary exists, so only the most recent dropped turns are added as raw notes.
    const state = kernel.db.get<{ summary: string; summarized_upto: number }>(
      'SELECT summary, summarized_upto FROM tutor_conversation_state WHERE conversation_id = ?',
      [conv.id],
    )
    expect(state?.summary).toBeTruthy()
    expect(window.unsummarized.length).toBeLessThan(8)
    // The prompt really sent to the model contains the window plus the new message, and the summary.
    const built = tutorReplyPrompt.build(input, kernel.ai.context(undefined, 'writing'))
    expect(built.messages).toHaveLength(input.history.length + 1)
    expect(built.messages.at(-1)?.content).toBe('And what about you?')
    expect(built.system).toContain('Summary of the earlier part')
  })

  it('deleting a conversation cascades to its messages and feedback', async () => {
    const { call, kernel } = await makeApp()
    const keep = await call<TutorConversation>('tutor:create', { mode: 'friendly' })
    const conv = await call<TutorConversation>('tutor:create', { mode: 'grammar' })
    await call('tutor:send', { conversationId: keep.id, text: 'Hello there' })
    await call('tutor:send', { conversationId: conv.id, text: 'i goed home' })
    await call('tutor:delete', { id: conv.id })
    expect(await call('tutor:get', { id: conv.id })).toBeNull()
    const count = (sql: string) => Number(kernel.db.value(sql, [conv.id]) ?? 0)
    expect(count('SELECT COUNT(*) FROM tutor_messages WHERE conversation_id = ?')).toBe(0)
    expect(
      Number(kernel.db.value('SELECT COUNT(*) FROM tutor_message_meta WHERE message_id NOT IN (SELECT id FROM tutor_messages)') ?? 0),
    ).toBe(0)
    expect(count('SELECT COUNT(*) FROM tutor_conversation_state WHERE conversation_id = ?')).toBe(0)
    const other = await call<TutorThread>('tutor:get', { id: keep.id })
    expect(other.messages).toHaveLength(2)
    await expect(call('tutor:send', { conversationId: conv.id, text: 'hi' })).rejects.toThrow(/not_found/)
  })

  it('without an AI key: send fails with ai_no_key and nothing is half-saved; history still loads', async () => {
    const { call, router, kernel } = await makeApp({ mockAi: false })
    const conv = await call<TutorConversation>('tutor:create', { mode: 'friendly' })
    const res = await router.dispatch('tutor:send', { conversationId: conv.id, text: 'Hello, i goed to school' })
    expect(res.ok).toBe(false)
    if (!res.ok) {
      expect(res.error.code).toBe('ai_no_key')
      expect(res.error.hint).toBe('ai-settings')
    }
    const thread = await call<TutorThread>('tutor:get', { id: conv.id })
    expect(thread.messages).toHaveLength(0)
    expect(thread.conversation.title).toBe('New conversation')
    expect(Number(kernel.db.value('SELECT COUNT(*) FROM learner_mistakes') ?? 0)).toBe(0)
    expect(Number(kernel.db.value("SELECT COUNT(*) FROM xp_events WHERE source = 'tutor_message'") ?? 0)).toBe(0)
    expect(await call<TutorConversationView[]>('tutor:list')).toHaveLength(1)
  })
})
