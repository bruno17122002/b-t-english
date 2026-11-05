import { describe, expect, it } from 'vitest'
import type {
  PronCompleteResult,
  PronEstimateResult,
  PronLessonView,
  PronOverview,
  RoleplayReply,
  SpeakingPromptView,
  SpeakingSubmitResult,
} from '../../../src/modules/speaking/contract'
import type { LearnerMistake, Quest, SpeakingSession } from '../../../src/shared/types'
import { makeApp } from '../../helpers/kernel'

async function failure(p: Promise<unknown>): Promise<{ code: string; message: string; hint?: string }> {
  try {
    await p
  } catch (err) {
    return (err as { ipc: { code: string; message: string; hint?: string } }).ipc
  }
  throw new Error('expected the call to fail')
}

const analysis = { durationSec: 12, speakingSec: 9.5, pauseCount: 2, longestPauseSec: 0.8 }

describe('speaking module', () => {
  it('lists built-in prompts of every kind plus Cadence scenarios', async () => {
    const { call } = await makeApp()
    const all = await call<SpeakingPromptView[]>('speaking:prompts')
    const kinds = new Set(all.filter((p) => p.source === 'builtin').map((p) => p.kind))
    expect([...kinds].sort()).toEqual(['challenge', 'ielts', 'real-world', 'repeat', 'roleplay', 'shadowing'])
    const cadence = await call<SpeakingPromptView[]>('speaking:prompts', { source: 'cadence' })
    expect(cadence).toHaveLength(10)
    expect(cadence.every((p) => p.id.startsWith('cadence-') && p.scenario && p.scenario.turns.length > 0)).toBe(true)
    const shadowing = await call<SpeakingPromptView[]>('speaking:prompts', { kind: 'shadowing' })
    expect(shadowing.every((p) => p.kind === 'shadowing' && p.sentences.length > 0)).toBe(true)
    const one = await call<SpeakingPromptView>('speaking:prompt', { id: shadowing[0]?.id })
    expect(one.title).toBe(shadowing[0]?.title)
    expect((await failure(call('speaking:prompt', { id: 'nope' }))).code).toBe('not_found')
  })

  it('submits a shadowing session, measures it and counts speaking seconds in quests', async () => {
    const { call, kernel } = await makeApp()
    const [prompt] = await call<SpeakingPromptView[]>('speaking:prompts', { kind: 'shadowing' })
    const target = prompt?.sentences[0] as string
    const words = target.split(' ')
    const spoken = words.slice(0, -1).join(' ') // drop the last word
    const res = await call<SpeakingSubmitResult>('speaking:submit', {
      mode: 'shadowing',
      promptId: prompt?.id,
      prompt: target,
      target,
      transcript: spoken,
      analysis,
    })
    expect(res.session.id).toBeGreaterThan(0)
    expect(res.session.measured.durationSec).toBe(12)
    expect(res.session.measured.speakingSec).toBe(9.5)
    expect(res.session.measured.pauseCount).toBe(2)
    expect(res.session.measured.wordAccuracy).toBeGreaterThan(0.5)
    expect(res.session.measured.wordAccuracy).toBeLessThan(1)
    expect(res.session.measured.missingWords).toHaveLength(1)
    expect(res.session.measured.wordsPerMinute).toBeGreaterThan(0)
    expect(res.speakingSeconds).toBe(10)
    expect(res.reward.xpGained).toBeGreaterThan(0)

    const quests = await call<{ daily: Quest[]; weekly: Quest[] }>('progress:quests')
    const speakQuests = [...quests.daily, ...quests.weekly].filter((q) => q.metric === 'speaking_seconds')
    expect(speakQuests.length).toBeGreaterThan(0)
    expect(speakQuests.every((q) => q.progress === 10)).toBe(true)

    const listed = await call<SpeakingPromptView[]>('speaking:prompts', { kind: 'shadowing' })
    const updated = listed.find((p) => p.id === prompt?.id)
    expect(updated?.attempts).toBe(1)
    expect(updated?.bestScore).toBeCloseTo(res.session.measured.wordAccuracy as number)
    expect(kernel.db.value('SELECT COUNT(*) FROM speaking_sessions')).toBe(1)
  })

  it('returns AI feedback (mock), stores it and records recurring mistakes', async () => {
    const { call } = await makeApp()
    const res = await call<SpeakingSubmitResult>('speaking:submit', {
      mode: 'ielts',
      promptId: 'sp-ielts-helpful-person',
      prompt: 'Describe a person who helped you',
      transcript: 'My teacher help me a lot. She go to school early every day and she explain grammar clearly.',
      analysis: { durationSec: 60, speakingSec: 45, pauseCount: 6, longestPauseSec: 2.1 },
    })
    expect(res.session.feedback).toBeNull()
    const withFeedback = await call<SpeakingSession>('speaking:feedback', { sessionId: res.session.id })
    expect(withFeedback.feedback?.grammar.corrections[0]).toMatchObject({ original: 'She go', better: 'She goes' })
    expect(withFeedback.feedback?.cefrEstimate).toBe('B1')
    expect(withFeedback.provider).toBe('mock')
    const mistakes = await call<LearnerMistake[]>('learner:mistakes')
    expect(mistakes.find((m) => m.pattern === 'missing third-person -s')).toBeTruthy()
    // A second session with the same mistake increments the counter.
    const again = await call<SpeakingSubmitResult>('speaking:submit', {
      mode: 'free',
      prompt: 'Talk about your family',
      transcript: 'He like football.',
      analysis,
    })
    await call('speaking:feedback', { sessionId: again.session.id })
    const after = await call<LearnerMistake[]>('learner:mistakes')
    expect(after.find((m) => m.pattern === 'missing third-person -s')?.count).toBe(2)
    const history = await call<SpeakingSession[]>('speaking:history')
    expect(history).toHaveLength(2)
    expect(history[1]?.feedback).not.toBeNull()
  })

  it('refuses feedback without a transcript', async () => {
    const { call } = await makeApp()
    const res = await call<SpeakingSubmitResult>('speaking:submit', {
      mode: 'challenge',
      prompt: 'x',
      transcript: null,
      analysis,
    })
    expect(res.session.transcript).toBe('')
    expect(res.speakingSeconds).toBe(10)
    expect((await failure(call('speaking:feedback', { sessionId: res.session.id }))).code).toBe('no_transcript')
  })

  it('plays an AI role-play turn (mock)', async () => {
    const { call } = await makeApp()
    const reply = await call<RoleplayReply>('speaking:roleplayTurn', {
      promptId: 'sp-roleplay-cafe-order',
      history: [],
      userText: 'Hello, I would like a flat white please.',
    })
    expect(reply.reply.length).toBeGreaterThan(0)
    expect(reply.done).toBe(false)
    expect(reply.correction).toBeNull()
    const bad = await failure(
      call('speaking:roleplayTurn', { promptId: 'sp-shadow-greetings', history: [], userText: 'hi' }),
    )
    expect(bad.code).toBe('invalid_input')
  })

  it('serves the Cadence pronunciation pack with attribution', async () => {
    const { call } = await makeApp()
    const overview = await call<PronOverview>('speaking:pronOverview')
    expect(overview.modules).toHaveLength(10)
    expect(overview.phonemes.length).toBeGreaterThan(20)
    expect(overview.attribution.license).toBe('MIT')
    expect(overview.attribution.source).toContain('Cadence')
    expect(overview.nextLessonId).toBe('m1-theory')
    const theory = await call<PronLessonView>('speaking:pronLesson', { id: 'm1-theory' })
    expect(theory.theory.length).toBeGreaterThan(1)
    expect(JSON.stringify(theory.theory)).not.toMatch(/<\/?[a-z]/)
    expect(theory.nextLessonId).toBe('m1-practice-a')
    const practice = await call<PronLessonView>('speaking:pronLesson', { id: 'm1-practice-a' })
    expect(practice.words.length).toBeGreaterThan(0)
    expect(practice.words[0]?.phonemes.length).toBeGreaterThan(0)
    expect(practice.focusPhonemes.length).toBeGreaterThan(0)
    expect((await failure(call('speaking:pronLesson', { id: 'm99-nope' }))).code).toBe('not_found')
  })

  it('estimates phonemes (mock) and aligns them with the target', async () => {
    const { call } = await makeApp()
    const good = await call<PronEstimateResult>('speaking:pronEstimate', {
      word: 'cat',
      ipa: 'k æ t',
      transcript: 'Cat.',
    })
    expect(good.score).toBe(1)
    expect(good.alignment.ops.every((o) => o.op === 'match')).toBe(true)
    const off = await call<PronEstimateResult>('speaking:pronEstimate', {
      word: 'cat',
      ipa: 'k æ t',
      transcript: 'cut',
    })
    expect(off.score).toBeLessThan(1)
    expect(off.alignment.ops.find((o) => o.op === 'substitute')).toMatchObject({ expected: 'æ', actual: 'ə' })
  })

  it('tracks pronunciation lesson completion in lesson_attempts', async () => {
    const { call, kernel } = await makeApp()
    const theory = await call<PronCompleteResult>('speaking:pronComplete', { lessonId: 'm1-theory', score: 0 })
    expect(theory.passed).toBe(true)
    const examFail = await call<PronCompleteResult>('speaking:pronComplete', {
      lessonId: 'm1-exam',
      score: 0.5,
      durationSec: 90,
      speakingSec: 20,
    })
    expect(examFail.passed).toBe(false)
    let overview = await call<PronOverview>('speaking:pronOverview')
    let m1 = overview.modules[0]
    expect(m1?.lessons.find((l) => l.id === 'm1-theory')?.completed).toBe(true)
    expect(m1?.lessons.find((l) => l.id === 'm1-exam')?.completed).toBe(false)
    expect(overview.nextLessonId).toBe('m1-practice-a')
    const examPass = await call<PronCompleteResult>('speaking:pronComplete', {
      lessonId: 'm1-exam',
      score: 0.9,
      durationSec: 120,
      speakingSec: 30,
      words: [{ word: 'cat', score: 1, method: 'ai' }],
    })
    expect(examPass.passed).toBe(true)
    expect(examPass.bestScore).toBeCloseTo(0.9)
    expect(examPass.reward.xpGained).toBeGreaterThan(0)
    overview = await call<PronOverview>('speaking:pronOverview')
    m1 = overview.modules[0]
    expect(m1?.lessons.find((l) => l.id === 'm1-exam')).toMatchObject({ completed: true, attempts: 2 })
    expect(m1?.completedLessons).toBe(2)
    const rows = kernel.db.all<{ module: string; content_ref: string }>(
      'SELECT module, content_ref FROM lesson_attempts',
    )
    expect(rows.every((r) => r.module === 'speaking')).toBe(true)
    expect(rows.map((r) => r.content_ref)).toEqual(['m1-theory', 'm1-exam', 'm1-exam'])
  })

  it('works offline: sessions are stored, AI channels report ai_no_key', async () => {
    const { call } = await makeApp({ mockAi: false })
    const res = await call<SpeakingSubmitResult>('speaking:submit', {
      mode: 'challenge',
      promptId: 'sp-challenge-favourite-food',
      prompt: 'Favourite food',
      transcript: null,
      analysis: { durationSec: 55, speakingSec: 40, pauseCount: 5, longestPauseSec: 1.5 },
    })
    expect(res.speakingSeconds).toBe(40)
    expect(res.session.measured.wordsPerMinute).toBeNull()
    const typed = await call<SpeakingSubmitResult>('speaking:submit', {
      mode: 'free',
      prompt: 'x',
      transcript: 'I am fine thanks',
      analysis,
    })
    for (const [channel, payload] of [
      ['speaking:feedback', { sessionId: typed.session.id }],
      ['speaking:roleplayTurn', { promptId: 'sp-roleplay-cafe-order', history: [], userText: 'Hi' }],
      ['speaking:pronEstimate', { word: 'cat', ipa: 'k æ t', transcript: 'cat' }],
    ] as const) {
      const err = await failure(call(channel, payload))
      expect(err.code).toBe('ai_no_key')
      expect(err.hint).toBe('ai-settings')
    }
    // Pack and lesson tracking stay available offline.
    expect((await call<PronOverview>('speaking:pronOverview')).modules).toHaveLength(10)
    expect(
      (
        await call<PronCompleteResult>('speaking:pronComplete', {
          lessonId: 'm2-practice-a',
          score: 0.8,
          durationSec: 60,
        })
      ).passed,
    ).toBe(true)
  })
})
