import { describe, expect, it } from 'vitest'
import { acceptedAnswers, canonicalAnswer, checkAnswer, fillGap } from '../../src/modules/grammar/contract'
import { GrammarTopicSchema } from '../../src/shared/content'
import grammarJson from '../../src/content/grammar.json'

const gap = (prompt: string, answer: string) => ({ type: 'gap' as const, prompt, answer, options: [] })

describe('grammar grading', () => {
  it('normalises case, punctuation and contractions', () => {
    expect(canonicalAnswer("  Don't   DRINK. ")).toBe('do not drink')
    expect(canonicalAnswer('can’t')).toBe('can not')
    expect(canonicalAnswer('cannot')).toBe('can not')
    expect(canonicalAnswer("she's")).toBe('she is')
  })

  it('accepts alternatives separated by "/"', () => {
    expect(acceptedAnswers('who/that')).toEqual(['who', 'that'])
    expect(checkAnswer(gap('The man ___ lives here.', 'who/that'), 'That')).toBe(true)
    expect(checkAnswer(gap('The man ___ lives here.', 'who/that'), 'which')).toBe(false)
  })

  it('is lenient for gaps but strict about the words', () => {
    const ex = gap('I ___ (not / drink) coffee at night.', "don't drink")
    expect(checkAnswer(ex, 'do not drink')).toBe(true)
    expect(checkAnswer(ex, "Don't drink!")).toBe(true)
    expect(checkAnswer(ex, 'not drink')).toBe(false)
    expect(checkAnswer(ex, '')).toBe(false)
    // Whole sentence typed instead of the missing words.
    expect(checkAnswer(ex, "I don't drink coffee at night.")).toBe(true)
    expect(fillGap('My father ___ (work) in an office.', 'works')).toBe('My father works in an office.')
  })

  it('checks mcq answers exactly against the option', () => {
    const ex = { type: 'mcq' as const, prompt: 'They ___ from Vietnam.', options: ['am', 'is', 'are'], answer: 'are' }
    expect(checkAnswer(ex, 'are')).toBe(true)
    expect(checkAnswer(ex, 'is')).toBe(false)
  })

  it('accepts the official answer of every bundled exercise', () => {
    const topics = (grammarJson as unknown[]).map((t) => GrammarTopicSchema.parse(t))
    for (const t of topics) for (const e of t.exercises) expect(checkAnswer(e, e.answer), `${e.id}`).toBe(true)
  })
})
