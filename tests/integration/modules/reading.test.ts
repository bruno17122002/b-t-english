import { describe, expect, it } from 'vitest'
import type { Quest, StatsOverview } from '../../../src/shared/types'
import { SKILLS } from '../../../src/shared/types'
import type {
  PassageSummary,
  PassageView,
  ReadingHighlight,
  ReadingHistoryEntry,
  ReadingLibrary,
  ReadingResult,
  RetellFeedback,
  SentenceExplanation,
} from '../../../src/modules/reading/contract'
import { makeApp } from '../../helpers/kernel'

/** Makes reading the weakest skill so today's daily quests deterministically include the reading quest. */
async function readingApp(opts: { mockAi?: boolean } = {}) {
  const app = await makeApp(opts)
  for (const skill of SKILLS)
    app.kernel.learner.setSkillLevel({
      skill,
      cefr: skill === 'reading' ? 'A1' : 'A2',
      score: 10,
      source: 'self',
      estimated: true,
    })
  return app
}

const PASSAGE = 'rd-a1-new-neighbour'

describe('reading module', () => {
  it('lists the library with recommendations at the reading level', async () => {
    const { call } = await readingApp()
    const lib = await call<ReadingLibrary>('reading:library')
    expect(lib.passages.length).toBeGreaterThanOrEqual(18)
    expect(lib.readingLevel).toBe('A1')
    expect(lib.recommended.length).toBeGreaterThan(0)
    const recommended = lib.passages.filter((p) => lib.recommended.includes(p.id))
    expect(recommended.every((p) => p.cefr === 'A1' || p.cefr === 'A2')).toBe(true)
    expect(
      lib.passages.every((p) => p.words > 0 && p.minutes >= 1 && p.source === 'builtin' && p.readCount === 0),
    ).toBe(true)
    expect(lib.stats.completed).toBe(0)
  })

  it('gets a passage and rejects unknown ids', async () => {
    const { call } = await readingApp()
    const view = await call<PassageView>('reading:get', { id: PASSAGE })
    expect(view.passage.title).toBe('A New Neighbour')
    expect(view.words).toBeGreaterThan(100)
    expect(view.history).toEqual([])
    await expect(call('reading:get', { id: 'nope' })).rejects.toMatchObject({ ipc: { code: 'not_found' } })
  })

  it('completes a reading with a quiz → history, XP, quest progress and skill progress', async () => {
    const { call, kernel } = await readingApp()
    const view = await call<PassageView>('reading:get', { id: PASSAGE })
    const answers = view.passage.questions.map((q, i) =>
      i === 0 ? (q.answerIndex + 1) % q.options.length : q.answerIndex,
    )
    const before = kernel.learner.skillLevels().find((s) => s.skill === 'reading')?.score ?? 0
    const res = await call<ReadingResult>('reading:complete', { id: PASSAGE, seconds: 120, answers })
    const total = view.passage.questions.length
    expect(res.entry.quizTotal).toBe(total)
    expect(res.entry.quizCorrect).toBe(total - 1)
    expect(res.correct[0]).toBe(false)
    expect(res.accuracy).toBeCloseTo((total - 1) / total)
    expect(res.entry.wpm).toBe(Math.round((view.words / 120) * 60))
    expect(res.reward.xpGained).toBeGreaterThan(0)
    expect(res.skill.score).toBeGreaterThan(before)

    const history = await call<ReadingHistoryEntry[]>('reading:history')
    expect(history).toHaveLength(1)
    expect(history[0]).toMatchObject({ passageId: PASSAGE, title: 'A New Neighbour', seconds: 120 })

    const quests = await call<{ daily: Quest[]; weekly: Quest[] }>('progress:quests')
    const readQuest = quests.daily.find((q) => q.metric === 'reading_done')
    expect(readQuest?.progress).toBe(1)
    expect(readQuest?.completedAt).not.toBeNull()

    const stats = await call<StatsOverview>('progress:stats')
    expect(stats.totals.reading).toBe(1)
    expect(stats.readingWpm).toHaveLength(1)

    const lib = await call<ReadingLibrary>('reading:library')
    const item = lib.passages.find((p) => p.id === PASSAGE)
    expect(item?.readCount).toBe(1)
    expect(item?.bestScore).toBeCloseTo((total - 1) / total)
    expect(lib.stats.completed).toBe(1)
    // A read passage moves behind unread passages of the same level.
    expect(lib.recommended[0]).not.toBe(PASSAGE)
  })

  it('validates completion input', async () => {
    const { router } = await readingApp()
    const bad = await router.dispatch('reading:complete', { id: PASSAGE, seconds: 0, answers: [] })
    expect(bad).toMatchObject({ ok: false, error: { code: 'invalid_input' } })
  })

  it('creates, updates, lists and deletes highlights', async () => {
    const { call } = await readingApp()
    const h = await call<ReadingHighlight>('reading:addHighlight', { passageId: PASSAGE, text: 'Do you need help?' })
    expect(h).toMatchObject({ passageId: PASSAGE, text: 'Do you need help?', note: '', color: 'amber' })
    const updated = await call<ReadingHighlight>('reading:updateHighlight', {
      id: h.id,
      note: 'Câu hỏi lịch sự',
      color: 'green',
    })
    expect(updated).toMatchObject({ note: 'Câu hỏi lịch sự', color: 'green' })
    await call('reading:addHighlight', {
      passageId: PASSAGE,
      text: 'new neighbour',
      note: 'hàng xóm mới',
      color: 'blue',
    })
    const list = await call<ReadingHighlight[]>('reading:highlights', { passageId: PASSAGE })
    expect(list.map((x) => x.text)).toEqual(['Do you need help?', 'new neighbour'])
    expect((await call<PassageView>('reading:get', { id: PASSAGE })).highlights).toHaveLength(2)
    await call('reading:deleteHighlight', { id: h.id })
    expect(await call<ReadingHighlight[]>('reading:highlights', { passageId: PASSAGE })).toHaveLength(1)
    await expect(call('reading:addHighlight', { passageId: 'missing', text: 'x' })).rejects.toMatchObject({
      ipc: { code: 'not_found' },
    })
    await expect(call('reading:updateHighlight', { id: 9999, note: 'x' })).rejects.toMatchObject({
      ipc: { code: 'not_found' },
    })
  })

  it('generates an AI passage (mock), persists it and lists it', async () => {
    const { call } = await readingApp()
    const summary = await call<PassageSummary>('reading:generate', {
      cefr: 'A2',
      category: 'science',
      topic: 'a rooftop garden',
    })
    expect(summary.id).toMatch(/^ai-[a-z0-9-]+$/)
    expect(summary).toMatchObject({ source: 'ai', cefr: 'A2', category: 'science', readCount: 0 })
    const lib = await call<ReadingLibrary>('reading:library')
    expect(lib.passages.some((p) => p.id === summary.id && p.source === 'ai')).toBe(true)
    const view = await call<PassageView>('reading:get', { id: summary.id })
    expect(view.source).toBe('ai')
    expect(view.passage.questions.every((q, i) => q.id === `${summary.id}-q${i + 1}`)).toBe(true)
    const res = await call<ReadingResult>('reading:complete', {
      id: summary.id,
      seconds: 60,
      answers: view.passage.questions.map((q) => q.answerIndex),
    })
    expect(res.accuracy).toBe(1)
    await call('reading:deleteGenerated', { id: summary.id })
    await expect(call('reading:get', { id: summary.id })).rejects.toMatchObject({ ipc: { code: 'not_found' } })
    await expect(call('reading:deleteGenerated', { id: PASSAGE })).rejects.toMatchObject({ ipc: { code: 'not_found' } })
  })

  it('explains a sentence and gives retelling feedback (mock AI)', async () => {
    const { call } = await readingApp()
    const ex = await call<SentenceExplanation>('reading:explainSentence', {
      passageId: PASSAGE,
      sentence: 'She lives in a small flat in a big city.',
    })
    expect(ex.sentence).toBe('She lives in a small flat in a big city.')
    expect(ex.translationVi.length).toBeGreaterThan(0)
    expect(ex.grammarPoints.length).toBeGreaterThan(0)
    const fb = await call<RetellFeedback>('reading:retell', {
      id: PASSAGE,
      text: 'Lan helps her new neighbour Tom carry boxes. They eat together and become friends.',
    })
    expect(fb.score).toBeGreaterThanOrEqual(0)
    expect(fb.mainPoints.length).toBeGreaterThan(0)
    expect(fb.coverage).toBeGreaterThan(0)
    expect(fb.coverage).toBeLessThanOrEqual(1)
  })

  it('works offline: library and quiz without a key, AI channels fail with ai_no_key', async () => {
    const { call } = await readingApp({ mockAi: false })
    const lib = await call<ReadingLibrary>('reading:library')
    expect(lib.passages.length).toBeGreaterThan(0)
    const view = await call<PassageView>('reading:get', { id: PASSAGE })
    const res = await call<ReadingResult>('reading:complete', {
      id: PASSAGE,
      seconds: 90,
      answers: view.passage.questions.map((q) => q.answerIndex),
    })
    expect(res.accuracy).toBe(1)
    for (const [ch, payload] of [
      ['reading:generate', { cefr: 'B1', category: 'news', topic: 'trains' }],
      ['reading:explainSentence', { sentence: 'Lan is twenty-two years old.' }],
      ['reading:retell', { id: PASSAGE, text: 'Lan meets Tom and they become friends.' }],
    ] as const) {
      await expect(call(ch, payload)).rejects.toMatchObject({ ipc: { code: 'ai_no_key', hint: 'ai-settings' } })
    }
  })

  it('returns saved words from the shared word bank', async () => {
    const { call } = await readingApp()
    await call('vocab:save', { word: 'Neighbour', sourceModule: 'reading', sourceRef: PASSAGE })
    expect(await call<string[]>('reading:savedWords')).toContain('neighbour')
  })
})
