import { describe, expect, it } from 'vitest'
import { clampedNumber, truncatedText } from '../../src/shared/ipc'

describe('lenient IPC schemas', () => {
  it('clamps measured amounts instead of rejecting them', () => {
    const s = clampedNumber(1, 600)
    expect(s.parse(0)).toBe(1)
    expect(s.parse(-5)).toBe(1)
    expect(s.parse(42.5)).toBe(42.5)
    expect(s.parse(18_000)).toBe(600)
    expect(s.safeParse(Number.NaN).success).toBe(false)
    expect(s.safeParse(Number.POSITIVE_INFINITY).success).toBe(false)
    expect(s.safeParse('10').success).toBe(false)
  })

  it('truncates long queries by code point and still bounds the payload', () => {
    const s = truncatedText(5)
    expect(s.parse('abc')).toBe('abc')
    expect(s.parse('abcdefgh')).toBe('abcde')
    // Emoji are not split into lone surrogates.
    expect(s.parse('😀😀😀😀😀😀')).toBe('😀😀😀😀😀')
    expect(s.safeParse('x'.repeat(10_001)).success).toBe(false)
  })
})
