import { describe, expect, it } from 'vitest'
import {
  estimateMinutes,
  recommendPassages,
  scoreQuiz,
  slugify,
  splitParagraphs,
  targetWpm,
} from '../../src/modules/reading/main/lib'
import {
  checkGeneratedPassage,
  generatePassagePrompt,
  type GenerateInput,
} from '../../src/modules/reading/main/prompts'
import { ReadingPassageSchema } from '../../src/shared/content'
import type { PromptContext } from '../../src/main/kernel/ai/prompt'

const ctx = {} as PromptContext

describe('reading helpers', () => {
  it('estimates reading minutes by level', () => {
    expect(estimateMinutes(140, 'A1')).toBe(2)
    expect(estimateMinutes(10, 'B2')).toBe(1)
    expect(targetWpm('B2')).toBeGreaterThan(targetWpm('A1'))
  })

  it('splits paragraphs on blank lines', () => {
    expect(splitParagraphs('One.\n\nTwo.\n  \nThree.')).toEqual(['One.', 'Two.', 'Three.'])
  })

  it('recommends unread passages at the level, then i+1, then one below', () => {
    const ps = [
      { id: 'b2', cefr: 'B2' as const, readCount: 0 },
      { id: 'a2-read', cefr: 'A2' as const, readCount: 2 },
      { id: 'b1', cefr: 'B1' as const, readCount: 0 },
      { id: 'a2', cefr: 'A2' as const, readCount: 0 },
      { id: 'a1', cefr: 'A1' as const, readCount: 0 },
      { id: 'c1', cefr: 'C1' as const, readCount: 0 },
    ]
    expect(recommendPassages(ps, 'A2', 4)).toEqual(['a2', 'b1', 'a1', 'b2'])
    expect(recommendPassages(ps, 'A2', 10)).toEqual(['a2', 'b1', 'a1', 'b2', 'c1', 'a2-read'])
  })

  it('scores quiz answers', () => {
    const qs = [{ answerIndex: 1 }, { answerIndex: 0 }, { answerIndex: 2 }]
    expect(scoreQuiz(qs, [1, 0, -1])).toEqual({ correct: [true, true, false], count: 2 })
    expect(scoreQuiz(qs, [])).toEqual({ correct: [false, false, false], count: 0 })
  })

  it('slugifies titles into safe ids', () => {
    expect(slugify('Phở & Coffee: A Day in Đà Lạt!')).toBe('pho-coffee-a-day-in-da-lat')
    expect(slugify('!!!')).toBe('passage')
  })
})

describe('reading passage generation checks', () => {
  const input: GenerateInput = { cefr: 'A2', category: 'science', topic: 'a rooftop garden', avoidTitles: [] }

  it('mock output is deterministic, schema-valid and passes the checks', () => {
    const out = generatePassagePrompt.mock(input, ctx)
    expect(generatePassagePrompt.mock(input, ctx)).toEqual(out)
    expect(generatePassagePrompt.schema.safeParse(out).success).toBe(true)
    expect(ReadingPassageSchema.safeParse({ ...out, id: 'ai-test' }).success).toBe(true)
    expect(checkGeneratedPassage(input, out)).toBeNull()
  })

  it('rejects a question that leaks its answer', () => {
    const out = generatePassagePrompt.mock(input, ctx)
    const q = out.questions[0]
    if (!q) throw new Error('mock has no questions')
    const leaked = {
      ...out,
      questions: [
        { ...q, prompt: 'Mr Binh teaches Mai. Who teaches Mai how to plant trees?' },
        ...out.questions.slice(1),
      ],
    }
    expect(checkGeneratedPassage(input, leaked)).toMatch(/reveals the correct option/)
  })

  it('rejects broken True/False/Not Given options, wrong level and bad length', () => {
    const out = generatePassagePrompt.mock(input, ctx)
    const tf = out.questions.findIndex((q) => q.type === 'true-false-ng')
    const broken = out.questions.map((q, i) => (i === tf ? { ...q, options: ['Yes', 'No', 'Maybe'] } : q))
    expect(checkGeneratedPassage(input, { ...out, questions: broken })).toMatch(/Not Given/)
    expect(checkGeneratedPassage(input, { ...out, cefr: 'B2' })).toMatch(/cefr/)
    expect(checkGeneratedPassage({ ...input, cefr: 'C1' }, { ...out, cefr: 'C1' })).toMatch(/words/)
  })
})
