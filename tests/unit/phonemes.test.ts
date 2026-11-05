import { describe, it, expect } from 'vitest'
import { alignIpa, alignPhonemes, normalizeIpa, tokenizeIpa } from '@core/phonemes'

describe('tokenizeIpa', () => {
  it('honours space-separated phonemes as given', () => {
    expect(tokenizeIpa('k æ t')).toEqual(['k', 'æ', 't'])
    expect(tokenizeIpa('s ə dʒ ɛ s t')).toEqual(['s', 'ə', 'dʒ', 'ɛ', 's', 't'])
  })

  it('keeps affricates and diphthongs together in unspaced IPA', () => {
    expect(tokenizeIpa('tʃeɪndʒ')).toEqual(['tʃ', 'eɪ', 'n', 'dʒ'])
    expect(tokenizeIpa('bɔɪ')).toEqual(['b', 'ɔɪ'])
    expect(tokenizeIpa('naʊ')).toEqual(['n', 'aʊ'])
    expect(tokenizeIpa('ɡoʊ')).toEqual(['ɡ', 'oʊ'])
    expect(tokenizeIpa('ɡəʊ')).toEqual(['ɡ', 'əʊ'])
    expect(tokenizeIpa('taɪm')).toEqual(['t', 'aɪ', 'm'])
    expect(tokenizeIpa('hɪə')).toEqual(['h', 'ɪə'])
    expect(tokenizeIpa('keə')).toEqual(['k', 'eə'])
    expect(tokenizeIpa('tʊə')).toEqual(['t', 'ʊə'])
  })

  it('attaches length marks and ignores stress marks and slashes', () => {
    expect(tokenizeIpa('/ˈʃiːp/')).toEqual(['ʃ', 'iː', 'p'])
    expect(tokenizeIpa('əˌbaʊt')).toEqual(['ə', 'b', 'aʊ', 't'])
    expect(tokenizeIpa('fu:d')).toEqual(['f', 'uː', 'd'])
    expect(tokenizeIpa('wɔːɾər')).toEqual(['w', 'ɔː', 'ɾ', 'ə', 'r'])
  })

  it('normalises ASCII g and affricate ligatures', () => {
    expect(normalizeIpa('ˈgʧ')).toBe('ɡtʃ')
    expect(tokenizeIpa('ʤɒb')).toEqual(['dʒ', 'ɒ', 'b'])
  })

  it('returns an empty list for empty or mark-only input', () => {
    expect(tokenizeIpa('')).toEqual([])
    expect(tokenizeIpa('  ˈ  ')).toEqual([])
  })
})

describe('alignPhonemes', () => {
  it('scores identical sequences as all matches', () => {
    const result = alignPhonemes(['k', 'æ', 't'], ['k', 'æ', 't'])
    expect(result.ops.map((o) => o.op)).toEqual(['match', 'match', 'match'])
    expect(result.distance).toBe(0)
    expect(result.accuracy).toBe(1)
    expect(result.matches).toBe(3)
  })

  it('reports a substitution', () => {
    const result = alignPhonemes(['θ', 'ɪ', 'ŋ', 'k'], ['s', 'ɪ', 'ŋ', 'k'])
    expect(result.ops[0]).toEqual({ op: 'substitute', expected: 'θ', actual: 's', expectedIndex: 0, actualIndex: 0 })
    expect(result.substitutions).toBe(1)
    expect(result.distance).toBe(1)
    expect(result.accuracy).toBeCloseTo(0.75)
  })

  it('reports a deletion (final consonant dropped)', () => {
    const result = alignPhonemes(['f', 'iː', 'l'], ['f', 'iː'])
    expect(result.ops.map((o) => o.op)).toEqual(['match', 'match', 'delete'])
    expect(result.ops[2]).toEqual({ op: 'delete', expected: 'l', actual: null, expectedIndex: 2, actualIndex: null })
    expect(result.deletions).toBe(1)
    expect(result.accuracy).toBeCloseTo(2 / 3)
  })

  it('reports an insertion (epenthetic vowel in a cluster)', () => {
    const result = alignPhonemes(['s', 't', 'ɹ', 'iː', 't'], ['ɪ', 's', 't', 'ɹ', 'iː', 't'])
    expect(result.ops.map((o) => o.op)).toEqual(['insert', 'match', 'match', 'match', 'match', 'match'])
    expect(result.ops[0]).toEqual({ op: 'insert', expected: null, actual: 'ɪ', expectedIndex: null, actualIndex: 0 })
    expect(result.insertions).toBe(1)
    expect(result.accuracy).toBeCloseTo(5 / 6)
  })

  it('handles empty inputs', () => {
    const both = alignPhonemes([], [])
    expect(both.ops).toEqual([])
    expect(both.accuracy).toBe(1)

    const nothingHeard = alignPhonemes(['k', 'æ', 't'], [])
    expect(nothingHeard.ops.map((o) => o.op)).toEqual(['delete', 'delete', 'delete'])
    expect(nothingHeard.accuracy).toBe(0)

    const nothingExpected = alignPhonemes([], ['ə'])
    expect(nothingExpected.ops.map((o) => o.op)).toEqual(['insert'])
    expect(nothingExpected.accuracy).toBe(0)
  })

  it('keeps accuracy within 0..1 and op counts consistent', () => {
    const result = alignPhonemes(['a', 'b'], ['x', 'y', 'z', 'w'])
    expect(result.accuracy).toBeGreaterThanOrEqual(0)
    expect(result.accuracy).toBeLessThanOrEqual(1)
    expect(result.substitutions + result.deletions + result.insertions).toBe(result.distance)
    expect(result.matches + result.substitutions + result.deletions).toBe(2)
    expect(result.matches + result.substitutions + result.insertions).toBe(4)
  })

  it('supports custom equivalence', () => {
    const result = alignPhonemes(['ɹ', 'ɛ', 'd'], ['r', 'ɛ', 'd'], {
      isSame: (a, b) => a === b || (a === 'ɹ' && b === 'r'),
    })
    expect(result.accuracy).toBe(1)
  })

  it('aligns diphthongs as single units via alignIpa', () => {
    // Vietnamese learners often flatten /eɪ/ to /e/: one substitution, not a deletion of /ɪ/.
    const result = alignIpa('/deɪ/', 'de')
    expect(result.ops.map((o) => o.op)).toEqual(['match', 'substitute'])
    expect(result.ops[1]?.expected).toBe('eɪ')
    expect(result.ops[1]?.actual).toBe('e')
    expect(result.accuracy).toBeCloseTo(0.5)
  })
})
