import { describe, expect, it } from 'vitest'
import type {
  DictationCheck,
  ListeningSubmitResult,
  TrackDetail,
  TrackSummary,
} from '../../../src/modules/listening/contract'
import type { GameState, Quest } from '../../../src/shared/types'
import { makeApp } from '../../helpers/kernel'

async function failure(p: Promise<unknown>): Promise<{ code: string; message: string }> {
  try {
    await p
  } catch (err) {
    return (err as { ipc: { code: string; message: string } }).ipc
  }
  throw new Error('expected the call to fail')
}

describe('listening module', () => {
  it('lists the built-in tracks with filters', async () => {
    const { call } = await makeApp()
    const all = await call<TrackSummary[]>('listening:list')
    expect(all.length).toBeGreaterThanOrEqual(12)
    expect(all.every((t) => t.source === 'builtin' && t.attempts === 0 && t.lineCount >= 4)).toBe(true)
    const a1 = await call<TrackSummary[]>('listening:list', { cefr: 'A1' })
    expect(a1.length).toBeGreaterThan(0)
    expect(a1.every((t) => t.cefr === 'A1')).toBe(true)
    const gb = await call<TrackSummary[]>('listening:list', { accent: 'en-GB' })
    expect(gb.every((t) => t.accent === 'en-GB')).toBe(true)
    const topic = all[0]?.topic as string
    const byTopic = await call<TrackSummary[]>('listening:list', { topic })
    expect(byTopic.every((t) => t.topic === topic)).toBe(true)
  })

  it('returns a track with lines, questions and vocabulary', async () => {
    const { call } = await makeApp()
    const detail = await call<TrackDetail>('listening:get', { id: 'ls-a1-coffee-order' })
    expect(detail.track.lines.length).toBeGreaterThanOrEqual(4)
    expect(detail.track.questions.length).toBeGreaterThanOrEqual(3)
    expect(detail.track.keyVocabulary.length).toBeGreaterThanOrEqual(3)
    expect(detail.history).toEqual([])
    const missing = await failure(call('listening:get', { id: 'no-such-track' }))
    expect(missing.code).toBe('not_found')
  })

  it('stores dictation results, awards XP and marks the track as done', async () => {
    const { call, kernel } = await makeApp()
    const before = kernel.learner.skillLevels().find((s) => s.skill === 'listening')?.score ?? 0
    const res = await call<ListeningSubmitResult>('listening:submit', {
      trackId: 'ls-a1-coffee-order',
      mode: 'dictation',
      correct: 8,
      total: 10,
      speed: 0.8,
      durationSec: 300,
      lines: [{ line: 0, accuracy: 1, attempts: 1 }],
    })
    expect(res.attempt.accuracy).toBeCloseTo(0.8)
    expect(res.reward.xpGained).toBeGreaterThan(0)
    expect(res.minutes).toBeGreaterThan(1)
    expect(res.minutes).toBeLessThan(30)
    expect(res.skill.score).toBeGreaterThan(before)

    const row = kernel.db.get<{ mode: string; correct: number; total: number; speed: number }>(
      'SELECT * FROM listening_history',
    )
    expect(row).toMatchObject({ mode: 'dictation', correct: 8, total: 10, speed: 0.8 })

    const game = await call<GameState>('progress:game')
    expect(game.totalXp).toBeGreaterThan(0)
    const quests = await call<{ daily: Quest[]; weekly: Quest[] }>('progress:quests')
    const listenQuest = [...quests.daily, ...quests.weekly].find((q) => q.metric === 'listening_done')
    if (listenQuest) expect(listenQuest.progress).toBeGreaterThanOrEqual(1)

    const done = await call<TrackSummary[]>('listening:list', { status: 'done' })
    expect(done.map((t) => t.id)).toEqual(['ls-a1-coffee-order'])
    expect(done[0]?.modesDone).toContain('dictation')
    expect(done[0]?.bestAccuracy).toBeCloseTo(0.8)
    const fresh = await call<TrackSummary[]>('listening:list', { status: 'new' })
    expect(fresh.find((t) => t.id === 'ls-a1-coffee-order')).toBeUndefined()

    const detail = await call<TrackDetail>('listening:get', { id: 'ls-a1-coffee-order' })
    expect(detail.history).toHaveLength(1)
    const hist = await call<unknown[]>('listening:history')
    expect(hist).toHaveLength(1)
  })

  it('checks dictation lines and gap fills leniently', async () => {
    const { call } = await makeApp()
    const detail = await call<TrackDetail>('listening:get', { id: 'ls-a1-coffee-order' })
    expect(detail.gaps).toHaveLength(detail.track.lines.length)
    const ok = await call<DictationCheck>('listening:checkLine', {
      trackId: 'ls-a1-coffee-order',
      line: 0,
      typed: 'hi there what can i get for you today',
    })
    expect(ok.accepted).toBe(true)
    const bad = await call<DictationCheck>('listening:checkLine', {
      trackId: 'ls-a1-coffee-order',
      line: 0,
      typed: 'hi what can I get you',
    })
    expect(bad.accepted).toBe(false)
    expect(bad.tokens.filter((t) => t.status === 'missing').map((t) => t.expected)).toEqual(['there', 'for', 'today'])
    const gap = detail.gaps[2]
    const answers = gap?.blanks.map((b) => b.answer) ?? []
    expect(answers.length).toBeGreaterThan(0)
    expect(await call<string[]>('listening:checkGaps', { trackId: 'ls-a1-coffee-order', line: 2, answers })).toEqual(
      answers.map(() => 'ok'),
    )
    expect(
      await call<string[]>('listening:checkGaps', { trackId: 'ls-a1-coffee-order', line: 2, answers: [] }),
    ).toEqual(answers.map(() => 'wrong'))
    const missing = await failure(call('listening:checkLine', { trackId: 'ls-a1-coffee-order', line: 99, typed: 'x' }))
    expect(missing.code).toBe('not_found')
  })

  it('rejects impossible results', async () => {
    const { router } = await makeApp()
    const bad = await router.dispatch('listening:submit', {
      trackId: 'ls-a1-coffee-order',
      mode: 'gist',
      correct: 5,
      total: 3,
    })
    expect(bad).toMatchObject({ ok: false, error: { code: 'invalid_input' } })
  })

  it('marks favourites', async () => {
    const { call } = await makeApp()
    await call('library:toggleFavorite', { kind: 'listening', ref: 'ls-a1-directions', title: 'Directions' })
    const favs = await call<TrackSummary[]>('listening:list', { status: 'favorite' })
    expect(favs.map((t) => t.id)).toEqual(['ls-a1-directions'])
  })

  it('generates an AI track (mock), persists it and lists it', async () => {
    const { call, kernel } = await makeApp()
    const created = await call<TrackSummary>('listening:generate', {
      cefr: 'B1',
      topic: 'Đi chợ Tết',
      accent: 'en-GB',
      kind: 'dialogue',
    })
    expect(created.source).toBe('ai')
    expect(created.id).toMatch(/^ai-di-cho-tet-/)
    expect(created.cefr).toBe('B1')
    expect(created.accent).toBe('en-GB')
    const stored = kernel.db.get<{ kind: string; cefr: string }>(
      'SELECT kind, cefr FROM generated_content WHERE id = ?',
      [created.id],
    )
    expect(stored).toEqual({ kind: 'listening', cefr: 'B1' })

    const aiOnly = await call<TrackSummary[]>('listening:list', { source: 'ai' })
    expect(aiOnly.map((t) => t.id)).toEqual([created.id])
    const detail = await call<TrackDetail>('listening:get', { id: created.id })
    expect(detail.track.questions.length).toBeGreaterThanOrEqual(3)
    const res = await call<ListeningSubmitResult>('listening:submit', {
      trackId: created.id,
      mode: 'gist',
      correct: 4,
      total: 4,
    })
    expect(res.attempt.accuracy).toBe(1)

    await call('listening:deleteGenerated', { id: created.id })
    expect(await call<TrackSummary[]>('listening:list', { source: 'ai' })).toEqual([])
    const builtin = await failure(call('listening:deleteGenerated', { id: 'ls-a1-coffee-order' }))
    expect(builtin.code).toBe('not_found')
  })

  it('works offline and reports ai_no_key for generation', async () => {
    const { call } = await makeApp({ mockAi: false })
    const all = await call<TrackSummary[]>('listening:list')
    expect(all.length).toBeGreaterThanOrEqual(12)
    const res = await call<ListeningSubmitResult>('listening:submit', {
      trackId: 'ls-a2-gate-change',
      mode: 'gap',
      correct: 3,
      total: 4,
    })
    expect(res.reward.xpGained).toBeGreaterThan(0)
    const err = await failure(call('listening:generate', { cefr: 'A2', topic: 'travel', accent: 'en-US' }))
    expect(err.code).toBe('ai_no_key')
  })
})
