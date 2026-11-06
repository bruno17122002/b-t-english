// Double-click / race abuse: the same mutating channel fired 2–10 times concurrently (Promise.all, as an
// impatient learner or a stuck button would) and sequential repeats within the router's repeat window
// (separate IPC messages). No duplicates, no double XP, no double quests, no constraint error as 'internal'.
import fs from 'node:fs'
import { describe, expect, it } from 'vitest'
import type { CinemaStory } from '../../src/shared/content'
import type { StoryProgress, VocabItem } from '../../src/shared/types'
import type { AssessmentSession } from '../../src/modules/journey/contract'
import type { CoachReport } from '../../src/modules/coach/types'
import type { TutorConversation } from '../../src/shared/types'
import { sceneById } from '../../src/modules/cinema/contract'
import { FAKE_ANON, FAKE_URL, FakeCloud } from '../helpers/fakeCloud'
import { makeApp } from '../helpers/kernel'

type App = Awaited<ReturnType<typeof makeApp>>

const n = (app: App, sql: string, p: (string | number)[] = []) => Number(app.kernel.db.value(sql, p) ?? 0)

async function burst(app: App, times: number, channel: string, payload: unknown) {
  const results = await Promise.all(Array.from({ length: times }, () => app.router.dispatch(channel, payload)))
  for (const r of results) {
    if (!r.ok) expect(r.error.code, `${channel}: ${r.error.message}`).not.toBe('internal')
  }
  return results
}

function healthy(app: App) {
  expect(app.kernel.db.value('PRAGMA integrity_check')).toBe('ok')
  expect(app.kernel.db.all('PRAGMA foreign_key_check')).toEqual([])
  // Every completed quest paid out exactly once.
  const dup = app.kernel.db.all(
    "SELECT ref, COUNT(*) c FROM xp_events WHERE source = 'quest' GROUP BY ref HAVING c > 1",
  )
  expect(dup).toEqual([])
}

describe('concurrent double clicks (Promise.all)', () => {
  it('vocab:save ×10 of the same word creates one word and awards XP once', async () => {
    const app = await makeApp()
    const res = await burst(app, 10, 'vocab:save', { word: 'harbour', meaningVi: 'bến cảng', sourceModule: 'manual' })
    expect(res.every((r) => r.ok)).toBe(true)
    expect(n(app, 'SELECT COUNT(*) FROM vocabulary')).toBe(1)
    expect(n(app, "SELECT COUNT(*) FROM xp_events WHERE source = 'word_saved'")).toBe(1)
    healthy(app)
  })

  it('vocab:review ×10 of the same card logs one review and awards XP once', async () => {
    const app = await makeApp()
    const { item } = await app.call<{ item: VocabItem }>('vocab:save', { word: 'tide', sourceModule: 'manual' })
    await burst(app, 10, 'vocab:review', { id: item.id, rating: 3 })
    expect(n(app, 'SELECT COUNT(*) FROM review_logs')).toBe(1)
    expect(n(app, "SELECT COUNT(*) FROM xp_events WHERE source = 'review_done'")).toBe(1)
    healthy(app)
  })

  it('writing:submit ×5 stores one submission', async () => {
    const app = await makeApp()
    const text = 'Yesterday I went to the market with my mother and we bought many fresh vegetables.'
    await burst(app, 5, 'writing:submit', { text, taskType: 'free', analyze: true })
    expect(n(app, 'SELECT COUNT(*) FROM writing_submissions')).toBe(1)
    expect(n(app, "SELECT COUNT(*) FROM activity_log WHERE module = 'writing'")).toBe(1)
    healthy(app)
  })

  it('journey:assessmentAnswer ×5 records the answer once and moves one item forward', async () => {
    const app = await makeApp()
    const s = await app.call<AssessmentSession>('journey:assessmentStart')
    const itemId = s.current?.id as string
    const res = await burst(app, 5, 'journey:assessmentAnswer', { id: s.id, itemId, choice: 0 })
    expect(res.every((r) => r.ok)).toBe(true)
    expect(n(app, 'SELECT COUNT(*) FROM assessment_answers WHERE assessment_id = ?', [s.id])).toBe(1)
    healthy(app)
  })

  it('grammar:submit ×5 stores one attempt and one reward', async () => {
    const app = await makeApp()
    const topic = app.kernel.content.grammar()[0]!
    const answers = topic.exercises.map((e) => ({ exerciseId: e.id, given: e.answer }))
    await burst(app, 5, 'grammar:submit', { topicId: topic.id, answers, durationSec: 60 })
    expect(n(app, "SELECT COUNT(*) FROM lesson_attempts WHERE module = 'grammar'")).toBe(1)
    expect(n(app, "SELECT COUNT(*) FROM activity_log WHERE module = 'grammar'")).toBe(1)
    healthy(app)
  })

  it('cinema:advance ×5 on the same scene advances once', async () => {
    const app = await makeApp()
    const story = app.kernel.content.stories()[0] as CinemaStory
    const p = await app.call<StoryProgress>('cinema:start', { id: story.id })
    const scene = sceneById(story, p.currentSceneId)!
    const payload = {
      id: story.id,
      sceneId: scene.id,
      optionIndex: scene.choice ? 0 : null,
      quizAnswers: (scene.quiz ?? []).map((q) => q.answerIndex),
    }
    const res = await burst(app, 5, 'cinema:advance', payload)
    expect(res.filter((r) => r.ok)).toHaveLength(5) // all callers see the one result
    expect(n(app, "SELECT COUNT(*) FROM activity_log WHERE action = 'cinema_scene'")).toBe(1)
    healthy(app)
  })

  it('tutor:send ×3 of the same text stores one learner message and one reply', async () => {
    const app = await makeApp()
    const c = await app.call<TutorConversation>('tutor:create', { mode: 'friendly' })
    await burst(app, 3, 'tutor:send', { conversationId: c.id, text: 'How are you today?' })
    expect(n(app, "SELECT COUNT(*) FROM tutor_messages WHERE role = 'user'")).toBe(1)
    expect(n(app, "SELECT COUNT(*) FROM tutor_messages WHERE role = 'assistant'")).toBe(1)
    healthy(app)
  })

  it('tutor:create ×4 creates one conversation', async () => {
    const app = await makeApp()
    await burst(app, 4, 'tutor:create', { mode: 'friendly', title: 'Chat' })
    expect(n(app, 'SELECT COUNT(*) FROM tutor_conversations')).toBe(1)
  })

  it('coach:generateReport ×3 creates one report; coach:applyPlan ×3 applies once', async () => {
    const app = await makeApp()
    const res = await burst(app, 3, 'coach:generateReport', { period: 'week', useAi: true })
    expect(n(app, 'SELECT COUNT(*) FROM coach_reports')).toBe(1)
    const report = (res[0] as { ok: true; data: CoachReport }).data
    const before = n(app, 'SELECT COUNT(*) FROM lessons')
    const applied = await burst(app, 3, 'coach:applyPlan', { reportId: report.id })
    const after = n(app, 'SELECT COUNT(*) FROM lessons')
    const created = applied.map((r) => (r.ok ? (r.data as { created: number }).created : 0))
    expect(after - before).toBe(created[0])
    healthy(app)
  })

  it('journey:assessmentFinish ×4 finishes once', async () => {
    const app = await makeApp()
    let s = await app.call<AssessmentSession>('journey:assessmentStart')
    const bank = app.kernel.content.assessment()
    for (let guard = 0; s.current && guard < 60; guard++) {
      const item = bank.find((i) => i.id === s.current?.id)!
      s = await app.call<AssessmentSession>('journey:assessmentAnswer', { id: s.id, itemId: item.id, choice: 0 })
    }
    const res = await burst(app, 4, 'journey:assessmentFinish', { id: s.id })
    expect(res.every((r) => r.ok)).toBe(true)
    expect(n(app, "SELECT COUNT(*) FROM activity_log WHERE module = 'journey' AND action = 'assessment_done'")).toBe(1)
    healthy(app)
  })

  it('data:createBackup ×5 writes one backup file', async () => {
    const app = await makeApp({ persistent: true })
    await app.call('vocab:save', { word: 'anchor', sourceModule: 'manual' })
    await burst(app, 5, 'data:createBackup', undefined)
    expect(fs.readdirSync(app.kernel.paths.backups).filter((f) => f.endsWith('.sqlite'))).toHaveLength(1)
  })

  it('sync:now ×5 and cloud:createBackup ×3 run once each', async () => {
    const server = new FakeCloud()
    const app = await makeApp({ fetchImpl: server.fetch })
    app.kernel.cloud.configure(FAKE_URL, FAKE_ANON)
    await app.call('cloud:sendCode', { email: 'lan@example.com' })
    await app.call('cloud:verifyCode', { email: 'lan@example.com', code: server.code('lan@example.com') })
    await app.call('vocab:save', { word: 'compass', sourceModule: 'manual' })
    const pushesBefore = server.pushes.length
    const res = await burst(app, 5, 'sync:now', undefined)
    expect(res.every((r) => r.ok)).toBe(true)
    expect(server.pushes.length - pushesBefore).toBe(1)
    await burst(app, 3, 'cloud:createBackup', undefined)
    expect([...server.objects.keys()].filter((k) => k.startsWith('backups/'))).toHaveLength(1)
  })

  it('different payloads still run (four ratings of one card are four reviews)', async () => {
    const app = await makeApp()
    const { item } = await app.call<{ item: VocabItem }>('vocab:save', { word: 'reef', sourceModule: 'manual' })
    const res = await Promise.all(
      [1, 2, 3, 4].map((rating) => app.router.dispatch('vocab:review', { id: item.id, rating })),
    )
    expect(res.every((r) => r.ok)).toBe(true)
    expect(n(app, 'SELECT COUNT(*) FROM review_logs')).toBe(4)
    healthy(app)
  })
})

describe('sequential double clicks (separate IPC messages inside the repeat window)', () => {
  it('a second identical vocab:review / grammar:submit within 1.5 s is answered from the first call', async () => {
    const app = await makeApp({ repeatWindowMs: 1500 })
    const { item } = await app.call<{ item: VocabItem }>('vocab:save', { word: 'lagoon', sourceModule: 'manual' })
    const first = await app.call<VocabItem>('vocab:review', { id: item.id, rating: 3 })
    const second = await app.call<VocabItem>('vocab:review', { id: item.id, rating: 3 })
    expect(second).toEqual(first)
    expect(n(app, 'SELECT COUNT(*) FROM review_logs')).toBe(1)

    const topic = app.kernel.content.grammar()[1]!
    const answers = topic.exercises.map((e) => ({ exerciseId: e.id, given: e.answer }))
    await app.call('grammar:submit', { topicId: topic.id, answers })
    await app.call('grammar:submit', { topicId: topic.id, answers })
    expect(n(app, "SELECT COUNT(*) FROM lesson_attempts WHERE module = 'grammar'")).toBe(1)
    healthy(app)
  })

  it('failed calls are not cached: a retry after an error runs again', async () => {
    const app = await makeApp({ repeatWindowMs: 1500 })
    const r1 = await app.router.dispatch('vocab:review', { id: 999, rating: 3 })
    expect(r1).toMatchObject({ ok: false, error: { code: 'not_found' } })
    await app.call('vocab:save', { word: 'first', sourceModule: 'manual' })
    // id 1 now exists; the earlier failure for id 999 is unrelated, and a failing key is never cached.
    const r2 = await app.router.dispatch('vocab:review', { id: 999, rating: 3 })
    expect(r2.ok).toBe(false)
    expect(n(app, 'SELECT COUNT(*) FROM review_logs')).toBe(0)
  })
})
