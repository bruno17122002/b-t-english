import { describe, expect, it } from 'vitest'
import {
  buildGaps,
  checkDictation,
  checkGap,
  dictationTokens,
  editDistance,
  estimateSeconds,
  lineSeed,
} from '../../src/modules/listening/main/dictation'
import { checkGeneratedTrack, mockTrack } from '../../src/modules/listening/main/prompts'
import { slugify } from '../../src/modules/listening/main/service'
import { ListeningTrackSchema } from '../../src/shared/content'

describe('lenient dictation checker', () => {
  it('ignores case, punctuation and spacing', () => {
    const r = checkDictation('Hi there! What can I get for you today?', 'hi there what can i get for you today')
    expect(r.accepted).toBe(true)
    expect(r.perfect).toBe(true)
    expect(r.accuracy).toBe(1)
  })

  it('accepts contractions, digits and common variants', () => {
    expect(checkDictation("That's six dollars and fifty cents.", 'that is 6 dollars and 50 cents').accepted).toBe(true)
    expect(checkDictation("I don't know, okay?", 'I do not know ok').accepted).toBe(true)
    expect(dictationTokens("We're sure it's fine")).toEqual(['we', 'are', 'sure', 'it', 'is', 'fine'])
  })

  it('accepts small typos in longer words but marks them', () => {
    const r = checkDictation('Your coffee will be ready in two minutes.', 'your cofee will be ready in two minuts')
    expect(r.accepted).toBe(true)
    expect(r.perfect).toBe(false)
    expect(r.tokens.filter((t) => t.status === 'typo').map((t) => t.expected)).toEqual(['coffee', 'minutes'])
    expect(r.strictAccuracy).toBeLessThan(1)
  })

  it('does not accept typos in short words', () => {
    const r = checkDictation('Is that for here or to go?', 'is that for her or to go')
    expect(r.accepted).toBe(false)
    expect(r.tokens.find((t) => t.status === 'wrong')).toMatchObject({ expected: 'here', typed: 'her' })
  })

  it('reports missing and extra words in order', () => {
    const r = checkDictation('Can I pay by card?', 'can I pay with by credit card')
    expect(r.accepted).toBe(false)
    expect(r.tokens.map((t) => t.status)).toEqual(['ok', 'ok', 'ok', 'extra', 'ok', 'extra', 'ok'])
    const m = checkDictation('Can I pay by card?', 'can pay card')
    expect(m.tokens.filter((t) => t.status === 'missing').map((t) => t.expected)).toEqual(['i', 'by'])
    expect(m.accuracy).toBeCloseTo(0.6)
  })

  it('handles empty answers', () => {
    const r = checkDictation('Great, thank you!', '')
    expect(r.accepted).toBe(false)
    expect(r.accuracy).toBe(0)
    expect(r.tokens.every((t) => t.status === 'missing')).toBe(true)
  })

  it('computes edit distance', () => {
    expect(editDistance('kitten', 'sitting')).toBe(3)
    expect(editDistance('', 'abc')).toBe(3)
    expect(editDistance('same', 'same')).toBe(0)
  })
})

describe('gap fill', () => {
  it('builds deterministic blanks that keep punctuation outside', () => {
    const text = 'Sure. What size would you like? Small, medium or large?'
    const a = buildGaps(text, lineSeed('ls-a1-coffee-order', 2))
    const b = buildGaps(text, lineSeed('ls-a1-coffee-order', 2))
    expect(a).toEqual(b)
    expect(a.blanks.length).toBeGreaterThan(0)
    for (const blank of a.blanks) {
      expect(blank.answer).toMatch(/^[A-Za-z']+$/)
      expect(`${blank.before}${blank.answer}${blank.after}`).toBe(a.tokens[blank.index])
    }
  })

  it('checks a gap leniently', () => {
    expect(checkGap('medium', 'Medium')).toBe('ok')
    expect(checkGap('medium', 'meduim')).toBe('wrong') // transposition = 2 edits on a 6-letter word
    expect(checkGap('medium', 'mediun')).toBe('typo')
    expect(checkGap('large', '')).toBe('wrong')
  })

  it('estimates audio length', () => {
    expect(estimateSeconds(150, 0)).toBe(60)
    expect(estimateSeconds(150, 4, 0.5)).toBe(121)
  })
})

describe('generated track checks', () => {
  it('mock track is valid and passes quality checks', () => {
    const t = mockTrack({ id: 'ai-test-1', cefr: 'B1', topic: 'cooking', accent: 'en-US', kind: 'dialogue' })
    expect(ListeningTrackSchema.safeParse(t).success).toBe(true)
    expect(checkGeneratedTrack(t)).toBeNull()
  })

  it('detects leaked answers and unknown speakers', () => {
    const t = mockTrack({ id: 'ai-test-2', cefr: 'A2', topic: 'music', accent: 'en-GB', kind: 'dialogue' })
    const leaked = structuredClone(t)
    ;(leaked.questions[0] as { prompt: string }).prompt = 'Did a relative get Linh interested?'
    expect(checkGeneratedTrack(leaked)).toMatch(/reveals its answer/)
    const badSpeaker = structuredClone(t)
    ;(badSpeaker.lines[0] as { speaker: string }).speaker = 'ghost'
    expect(checkGeneratedTrack(badSpeaker)).toMatch(/not listed/)
    const sameIndex = structuredClone(t)
    for (const q of sameIndex.questions) q.answerIndex = 0
    expect(checkGeneratedTrack(sameIndex)).toMatch(/same option position/)
  })

  it('slugifies Vietnamese topics', () => {
    expect(slugify('Đi chợ Tết!')).toBe('di-cho-tet')
    expect(slugify('???')).toBe('track')
  })
})
