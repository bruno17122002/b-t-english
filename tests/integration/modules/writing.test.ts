import { describe, expect, it } from 'vitest'
import type { LearnerMistake, Quest, StatsOverview } from '../../../src/shared/types'
import { SKILLS } from '../../../src/shared/types'
import type {
  WritingCatalog,
  WritingHistoryItem,
  WritingSelfCorrectResult,
  WritingSubmissionView,
  WritingSubmitResult,
} from '../../../src/modules/writing/contract'
import { makeApp } from '../../helpers/kernel'

/** Makes writing the weakest skill so today's daily quests deterministically include the writing quest. */
async function writingApp(opts: { mockAi?: boolean } = {}) {
  const app = await makeApp(opts)
  for (const skill of SKILLS)
    app.kernel.learner.setSkillLevel({
      skill,
      cefr: skill === 'writing' ? 'A1' : 'A2',
      score: 10,
      source: 'self',
      estimated: true,
    })
  return app
}

const PROMPT = 'wp-journal-my-day'
const TEXT =
  'Today i go to the market with my sister. She like fresh fruit, so we buy mangoes and bananas. Then we cook dinner together.'

describe('writing module', () => {
  it('lists prompts with recommendations and AI availability', async () => {
    const { call } = await writingApp()
    const cat = await call<WritingCatalog>('writing:catalog')
    expect(cat.prompts.length).toBeGreaterThanOrEqual(18)
    expect(cat.aiAvailable).toBe(true)
    expect(cat.writingLevel).toBe('A1')
    expect(cat.recommended.length).toBeGreaterThan(0)
    expect(cat.prompts.every((p) => p.attempts === 0 && p.bestScore === null)).toBe(true)
  })

  it('submits writing → AI feedback (mock) persisted, diff, mistakes, XP and quest progress', async () => {
    const { call } = await writingApp()
    const res = await call<WritingSubmitResult>('writing:submit', { promptId: PROMPT, text: TEXT, minutes: 6 })
    expect(res.aiError).toBeNull()
    const { view } = res
    expect(view.submission.provider).toBe('mock')
    expect(view.submission.taskType).toBe('journal')
    expect(view.prompt?.id).toBe(PROMPT)
    expect(view.submission.metrics.words).toBeGreaterThan(15)
    const fb = view.submission.feedback
    expect(fb).not.toBeNull()
    expect(fb?.errors.map((e) => e.category).sort()).toEqual(['grammar', 'spelling'])
    expect(fb?.correctedText).toContain('Today I go')
    expect(fb?.correctedText).toContain('She likes')
    expect(view.score).toBeGreaterThan(0)
    expect(view.score).toBeLessThanOrEqual(10)
    // Word diff and clickable error marks
    expect(view.diff?.some((d) => d.type === 'delete' && d.text.trim() === 'i')).toBe(true)
    expect(view.diff?.some((d) => d.type === 'insert' && d.text.trim() === 'I')).toBe(true)
    expect(view.marked?.filter((m) => m.errorIndex !== null)).toHaveLength(2)
    expect(view.checklist.find((c) => c.id === 'pronoun-i')?.status).toBe('fail')
    // Rewards and progress
    expect(res.reward.xpGained).toBeGreaterThan(0)
    expect(res.skill.score).toBeGreaterThan(10)
    const quests = await call<{ daily: Quest[] }>('progress:quests')
    expect(quests.daily.find((q) => q.metric === 'writing_done')?.progress).toBe(1)
    const stats = await call<StatsOverview>('progress:stats')
    expect(stats.totals.writing).toBe(1)
    expect(stats.writingScores[0]?.score).toBeCloseTo(view.score as number)
    // Mistake memory
    const mistakes = await call<LearnerMistake[]>('learner:mistakes')
    expect(mistakes.map((m) => m.pattern)).toEqual(expect.arrayContaining(['subject-verb agreement', 'capital I']))
    // Persisted and listed
    const again = await call<WritingSubmissionView>('writing:get', { id: view.submission.id })
    expect(again.submission.feedback).toEqual(fb)
    const history = await call<WritingHistoryItem[]>('writing:history')
    expect(history).toHaveLength(1)
    expect(history[0]).toMatchObject({
      id: view.submission.id,
      promptId: PROMPT,
      title: 'Journal: How Was Your Day?',
      score: view.score,
    })
    const cat = await call<WritingCatalog>('writing:catalog')
    expect(cat.prompts.find((p) => p.id === PROMPT)).toMatchObject({ attempts: 1, bestScore: view.score })
  })

  it('records a recurring mistake count across submissions', async () => {
    const { call } = await writingApp()
    await call('writing:submit', { promptId: null, text: 'He go to school every day.' })
    await call('writing:submit', { promptId: null, text: 'My brother is tall. He go to work by bus.' })
    const mistakes = await call<LearnerMistake[]>('learner:mistakes')
    expect(mistakes.find((m) => m.pattern === 'subject-verb agreement')?.count).toBe(2)
  })

  it('accepts a self-corrected second draft and rechecks it', async () => {
    const { call } = await writingApp()
    const { view } = await call<WritingSubmitResult>('writing:submit', { promptId: PROMPT, text: TEXT })
    const partial = TEXT.replace('Today i go', 'Today I go')
    const r1 = await call<WritingSelfCorrectResult>('writing:selfCorrect', { id: view.submission.id, text: partial })
    expect(r1.view.submission.selfCorrectedText).toBe(partial)
    expect(r1.recheck.fixed).toHaveLength(1)
    expect(r1.recheck.remaining).toHaveLength(1)
    expect(r1.recheck.ai?.remainingIssues).toHaveLength(1)
    expect(r1.view.revisionDiff?.some((d) => d.type === 'insert')).toBe(true)
    const full = view.submission.feedback?.correctedText as string
    const r2 = await call<WritingSelfCorrectResult>('writing:selfCorrect', { id: view.submission.id, text: full })
    expect(r2.recheck.remaining).toEqual([])
    expect(r2.recheck.ai?.score).toBe(10)
    expect(r2.view.fixes?.remaining).toEqual([])
    const history = await call<WritingHistoryItem[]>('writing:history')
    expect(history[0]?.selfCorrected).toBe(true)
  })

  it('submits free writing without AI analysis, then analyzes on demand', async () => {
    const { call } = await writingApp()
    const res = await call<WritingSubmitResult>('writing:submit', {
      promptId: null,
      taskType: 'free',
      text: 'I like reading books. She play piano.',
      analyze: false,
    })
    expect(res.view.submission.feedback).toBeNull()
    expect(res.view.diff).toBeNull()
    expect(res.view.checklist.length).toBeGreaterThan(0)
    const analyzed = await call<WritingSubmissionView>('writing:analyze', { id: res.view.submission.id })
    expect(analyzed.submission.feedback?.errors).toHaveLength(1)
    expect(analyzed.submission.provider).toBe('mock')
  })

  it('works offline: metrics and checklist saved, AI channels fail with ai_no_key', async () => {
    const { call } = await writingApp({ mockAi: false })
    const cat = await call<WritingCatalog>('writing:catalog')
    expect(cat.aiAvailable).toBe(false)
    const res = await call<WritingSubmitResult>('writing:submit', { promptId: 'wp-email-invite-friend', text: TEXT })
    expect(res.aiError).toMatchObject({ code: 'ai_no_key', hint: 'ai-settings' })
    expect(res.view.submission.feedback).toBeNull()
    expect(res.view.submission.metrics.words).toBeGreaterThan(15)
    expect(res.view.score).toBeNull()
    expect(res.view.checklist.find((c) => c.id === 'greeting')?.status).toBe('fail')
    expect(res.view.checklist.some((c) => c.status === 'manual')).toBe(true)
    expect(res.reward.xpGained).toBeGreaterThan(0)
    await expect(call('writing:analyze', { id: res.view.submission.id })).rejects.toMatchObject({
      ipc: { code: 'ai_no_key', hint: 'ai-settings' },
    })
    const sc = await call<WritingSelfCorrectResult>('writing:selfCorrect', { id: res.view.submission.id, text: TEXT })
    expect(sc.recheck.ai).toBeNull()
    expect(sc.view.fixes).toBeNull()
    const history = await call<WritingHistoryItem[]>('writing:history')
    expect(history[0]).toMatchObject({ score: null, cefr: null })
  })

  it('rejects unknown prompts and missing submissions, deletes submissions', async () => {
    const { call, router } = await writingApp()
    await expect(call('writing:submit', { promptId: 'nope', text: 'Hello world.' })).rejects.toMatchObject({
      ipc: { code: 'not_found' },
    })
    expect(await router.dispatch('writing:submit', { text: '   ' })).toMatchObject({
      ok: false,
      error: { code: 'invalid_input' },
    })
    await expect(call('writing:submit', { text: '123 456' })).rejects.toMatchObject({ ipc: { code: 'too_short' } })
    await expect(call('writing:get', { id: 42 })).rejects.toMatchObject({ ipc: { code: 'not_found' } })
    const { view } = await call<WritingSubmitResult>('writing:submit', { text: 'Hello world.' })
    await call('writing:delete', { id: view.submission.id })
    expect(await call<WritingHistoryItem[]>('writing:history')).toHaveLength(0)
  })
})
