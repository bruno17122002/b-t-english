import { describe, expect, it } from 'vitest'
import { nextAssessmentItem } from '../../src/core/assessment'
import { keepsOptionOrder, optionOrder, permutation, pickOne, rngFor, shuffled } from '../../src/core/shuffle'
import type { AssessmentItem } from '../../src/shared/content'

describe('shuffle helpers', () => {
  it('shuffles without losing or duplicating elements and is reproducible with a seed', () => {
    const xs = Array.from({ length: 20 }, (_, i) => i)
    const a = shuffled(xs, rngFor('k'))
    expect([...a].sort((x, y) => x - y)).toEqual(xs)
    expect(shuffled(xs, rngFor('k'))).toEqual(a)
    expect(shuffled(xs, rngFor('other'))).not.toEqual(a)
    expect(xs[0]).toBe(0) // input untouched
  })

  it('spreads the first position evenly', () => {
    const counts = [0, 0, 0, 0]
    for (let i = 0; i < 4000; i++) {
      const first = permutation(4, rngFor(`p${i}`))[0] ?? 0
      counts[first] = (counts[first] ?? 0) + 1
    }
    for (const c of counts) expect(c).toBeGreaterThan(850)
  })

  it('keeps order-sensitive option sets in place', () => {
    expect(keepsOptionOrder(['True', 'False', 'Not Given'])).toBe(true)
    expect(keepsOptionOrder(['Yes', 'No', 'Not given'])).toBe(true)
    expect(keepsOptionOrder(['red', 'blue', 'All of the above'])).toBe(true)
    expect(keepsOptionOrder(['cold', 'wet', 'warm', 'big'])).toBe(false)
    expect(optionOrder(['True', 'False', 'Not Given'], rngFor('x'))).toEqual([0, 1, 2])
    expect([...optionOrder(['a', 'b', 'c', 'd'], rngFor('x'))].sort()).toEqual([0, 1, 2, 3])
  })

  it('picks one element or undefined', () => {
    expect(pickOne([], rngFor('x'))).toBeUndefined()
    expect(['a', 'b']).toContain(pickOne(['a', 'b'], rngFor('x')))
  })

  it('assessment staircase picks a random unused item at the target level when given an rng', () => {
    const bank: AssessmentItem[] = ['1', '2', '3', '4'].map((n) => ({
      id: `voc-a2-${n}`,
      skill: 'vocabulary',
      cefr: 'A2',
      prompt: 'p',
      options: ['a', 'b', 'c'],
      answerIndex: 0,
    }))
    expect(nextAssessmentItem(bank, [], 'A2')?.id).toBe('voc-a2-1')
    const picked = new Set(
      Array.from({ length: 30 }, (_, i) => nextAssessmentItem(bank, [], 'A2', undefined, rngFor(`s${i}`))?.id),
    )
    expect(picked.size).toBeGreaterThan(2)
    const used = [{ itemId: 'voc-a2-1', cefr: 'A2' as const, correct: false }]
    for (let i = 0; i < 20; i++)
      expect(nextAssessmentItem(bank, used, 'A2', undefined, rngFor(`u${i}`))?.id).not.toBe('voc-a2-1')
  })
})
