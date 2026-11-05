import { describe, expect, it } from 'vitest'
import { textMetrics } from '../../src/core/text'
import { averageScore, buildChecklist, checkFixes, markErrors } from '../../src/modules/writing/main/feedback'
import {
  checkFeedback,
  toWritingFeedback,
  writingFeedbackPrompt,
  writingRecheckPrompt,
} from '../../src/modules/writing/main/prompts'
import type { PromptContext } from '../../src/main/kernel/ai/prompt'

const ctx = {} as PromptContext

describe('writing feedback helpers', () => {
  it('marks the first non-overlapping occurrence of each error', () => {
    const segs = markErrors('He go home. He go out.', [
      { original: 'He go' },
      { original: 'he go' },
      { original: 'missing' },
    ])
    expect(segs).toEqual([
      { text: 'He go', errorIndex: 0 },
      { text: ' home. ', errorIndex: null },
      { text: 'He go', errorIndex: 1 },
      { text: ' out.', errorIndex: null },
    ])
    expect(markErrors('Nothing wrong.', [])).toEqual([{ text: 'Nothing wrong.', errorIndex: null }])
    expect(markErrors('I don’t like it', [{ original: "don't" }])[1]).toEqual({ text: 'don’t', errorIndex: 0 })
    // Whole words only: a one-letter error never matches inside another word.
    expect(markErrors('This is it, i think', [{ original: 'i' }])).toEqual([
      { text: 'This is it, ', errorIndex: null },
      { text: 'i', errorIndex: 0 },
      { text: ' think', errorIndex: null },
    ])
  })

  it('checks which errors a self-corrected text fixed', () => {
    const errors = [
      { original: 'He go', correction: 'He goes' },
      { original: 'informations', correction: 'information' },
      { original: 'a apple', correction: 'an apple' },
    ]
    expect(checkFixes(errors, 'He goes to buy an apple and some informations.')).toEqual({
      fixed: [0, 2],
      remaining: [1],
    })
    expect(checkFixes(errors, 'Completely rewritten text.')).toEqual({ fixed: [0, 1, 2], remaining: [] })
    // Capitalisation-only corrections are checked case-sensitively.
    const caps = [{ original: 'i', correction: 'I' }]
    expect(checkFixes(caps, 'Today i think I can.')).toEqual({ fixed: [], remaining: [0] })
    expect(checkFixes(caps, 'Today I think I can.')).toEqual({ fixed: [0], remaining: [] })
  })

  it('averages the eight scores', () => {
    expect(
      averageScore({
        grammar: 6,
        spelling: 7,
        vocabulary: 6,
        sentenceStructure: 6,
        clarity: 8,
        coherence: 7,
        naturalness: 6,
        toneRegister: 7,
      }),
    ).toBe(6.6)
  })

  it('builds an offline checklist from the text and prompt hints', () => {
    const text = 'hello Tom\n\ni am happy because i passed my exam. see you soon'
    const list = buildChecklist(
      text,
      { taskType: 'email', minWords: 30, maxWords: 80, hints: ['Invite your friend'] },
      textMetrics(text),
    )
    const status = Object.fromEntries(list.map((c) => [c.id, c.status]))
    expect(status).toMatchObject({
      length: 'fail',
      capitals: 'fail',
      'end-punctuation': 'fail',
      'pronoun-i': 'fail',
      greeting: 'pass',
      'sign-off': 'warn',
      'hint-0': 'manual',
    })
    const good =
      'Dear Tom,\n\nI am happy. I passed my exam, so I want to celebrate. However, I need your help.\n\nBest regards,\nLan'
    const ok = Object.fromEntries(
      buildChecklist(good, { taskType: 'email', minWords: 10, maxWords: 80, hints: [] }, textMetrics(good)).map((c) => [
        c.id,
        c.status,
      ]),
    )
    expect(ok).toMatchObject({
      length: 'pass',
      capitals: 'pass',
      'pronoun-i': 'pass',
      greeting: 'pass',
      'sign-off': 'pass',
    })
    expect(
      buildChecklist(
        'I.e. it works.',
        { taskType: 'free', minWords: 1, maxWords: 99, hints: [] },
        textMetrics('I.e. it works.'),
      ).find((c) => c.id === 'pronoun-i')?.status,
    ).toBe('pass')
  })
})

describe('writing prompts', () => {
  const input = {
    text: 'Today i go to school. She like music.',
    taskType: 'journal',
    promptTitle: 'My day',
    instructions: 'Write about your day.',
    promptCefr: 'A2' as const,
    minWords: 40,
    maxWords: 150,
  }

  it('produces a deterministic, schema-valid mock', () => {
    const a = writingFeedbackPrompt.mock(input, ctx)
    const b = writingFeedbackPrompt.mock(input, ctx)
    expect(a).toEqual(b)
    expect(writingFeedbackPrompt.schema.safeParse(a).success).toBe(true)
    expect(a.correctedText).toBe('Today I go to school. She likes music.')
    expect(checkFeedback(input, a)).toBeNull()
    const fb = toWritingFeedback(a)
    expect(fb.errors[0]).not.toHaveProperty('rule')
  })

  it('normalises categories and IELTS bands from AI output', () => {
    const parsed = writingFeedbackPrompt.schema.parse({
      ...writingFeedbackPrompt.mock(input, ctx),
      ieltsBandEstimate: 5.3,
      errors: [
        { original: 'i', correction: 'I', category: 'Punctuation mark', explanationVi: 'x' },
        { original: 'She like', correction: 'She likes', category: 'tense', explanationVi: 'y' },
      ],
    })
    expect(parsed.ieltsBandEstimate).toBe(5.5)
    expect(parsed.errors.map((e) => e.category)).toEqual(['punctuation', 'grammar'])
    expect(parsed.errors[0]?.rule).toBe('')
  })

  it('rejects feedback whose errors are not quoted from the text', () => {
    const out = writingFeedbackPrompt.mock(input, ctx)
    const bad = { ...out, errors: out.errors.map((e) => ({ ...e, original: 'something else entirely' })) }
    expect(checkFeedback(input, bad)).toMatch(/EXACTLY/)
  })

  it('recheck mock reflects fixed errors', () => {
    const errors = [{ original: 'i', correction: 'I', category: 'spelling' }]
    const fixedOut = writingRecheckPrompt.mock({ original: input.text, revised: 'Today I go.', errors }, ctx)
    expect(fixedOut.score).toBe(10)
    expect(writingRecheckPrompt.schema.safeParse(fixedOut).success).toBe(true)
  })
})
