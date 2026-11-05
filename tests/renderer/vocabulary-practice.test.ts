import { describe, expect, it } from 'vitest'
import {
  buildCloze,
  buildListeningMcq,
  buildMeaningMcq,
  forecastBars,
  gradeSpelling,
  letterHint,
  levenshtein,
  mulberry32,
  pickCloze,
  pickPracticeSet,
  shuffle,
  splitList,
  strengthOf,
} from '../../src/modules/vocabulary/renderer/lib/practice'

const pool = [
  { word: 'resilient', meaningVi: 'kiên cường' },
  { word: 'reliable', meaningVi: 'đáng tin cậy' },
  { word: 'resident', meaningVi: 'cư dân' },
  { word: 'apple', meaningVi: 'quả táo' },
  { word: 'Apple', meaningVi: 'quả táo' },
  { word: 'river', meaningVi: 'Kiên cường!' },
  { word: 'empty', meaningVi: '' },
]

describe('vocabulary practice helpers', () => {
  it('shuffle is a permutation and deterministic with a seed', () => {
    const xs = [1, 2, 3, 4, 5, 6, 7, 8]
    const a = shuffle(xs, mulberry32(42))
    expect([...a].sort()).toEqual(xs)
    expect(shuffle(xs, mulberry32(42))).toEqual(a)
    expect(xs).toEqual([1, 2, 3, 4, 5, 6, 7, 8])
  })

  it('meaning MCQ: right answer once, distinct distractors, never the same meaning', () => {
    for (let seed = 1; seed < 30; seed++) {
      const q = buildMeaningMcq(pool[0]!, pool, mulberry32(seed))
      expect(q).not.toBeNull()
      expect(q!.options).toHaveLength(4)
      expect(q!.options[q!.answerIndex]).toBe('kiên cường')
      expect(new Set(q!.options.map((o) => o.toLowerCase())).size).toBe(4)
      // "Kiên cường!" normalises to the right answer, so it must never be a distractor.
      expect(q!.options).not.toContain('Kiên cường!')
      expect(q!.options).not.toContain('')
    }
  })

  it('meaning MCQ returns null without distractors and shrinks with a tiny pool', () => {
    expect(buildMeaningMcq(pool[0]!, [pool[0]!], mulberry32(1))).toBeNull()
    expect(buildMeaningMcq({ word: 'x', meaningVi: '' }, pool, mulberry32(1))).toBeNull()
    const q = buildMeaningMcq(pool[0]!, [pool[0]!, pool[3]!], mulberry32(1))
    expect(q?.options).toHaveLength(2)
  })

  it('listening MCQ prefers look-alike words and dedupes case variants', () => {
    const q = buildListeningMcq(pool[0]!, pool, mulberry32(3))
    expect(q).not.toBeNull()
    expect(q!.options[q!.answerIndex]).toBe('resilient')
    expect(q!.options).toEqual(expect.arrayContaining(['reliable', 'resident']))
    expect(q!.options.filter((o) => o.toLowerCase() === 'apple').length).toBeLessThanOrEqual(1)
  })

  it('cloze finds the word, inflections and phrases', () => {
    expect(buildCloze('resilient', 'She is very resilient.')).toEqual({
      before: 'She is very ',
      after: '.',
      answer: 'resilient',
    })
    expect(buildCloze('book', 'I booked a table.')?.answer).toBe('booked')
    expect(buildCloze('make', 'She is making tea.')?.answer).toBe('making')
    expect(buildCloze('study', 'He studies hard.')?.answer).toBe('studies')
    expect(buildCloze('stop', 'They stopped the car.')?.answer).toBe('stopped')
    expect(buildCloze('look forward to', 'I look forward to it.')?.answer).toBe('look forward to')
    expect(buildCloze('Run', 'run, run fast')?.before).toBe('')
    // Not inside other words.
    expect(buildCloze('cat', 'The category is wide.')).toBeNull()
    expect(buildCloze('art', 'A smart start.')).toBeNull()
    expect(buildCloze('x', '')).toBeNull()
  })

  it('pickCloze uses examples first, then the context sentence', () => {
    expect(pickCloze({ word: 'tide', examples: ['No match here.'], context: 'The tide is high.' })?.sentence).toBe(
      'The tide is high.',
    )
    expect(pickCloze({ word: 'tide', examples: [], context: '' })).toBeNull()
  })

  it('grades spelling with a typo allowance', () => {
    expect(levenshtein('kitten', 'sitting')).toBe(3)
    expect(gradeSpelling('Resilient', ' resilient ')).toBe('correct')
    expect(gradeSpelling('resilient', 'resiliant')).toBe('close')
    expect(gradeSpelling('cat', 'cap')).toBe('wrong')
    expect(gradeSpelling('accommodation', 'acomodation')).toBe('close')
    expect(gradeSpelling('word', '')).toBe('wrong')
    expect(gradeSpelling("don't", 'don’t')).toBe('correct')
  })

  it('letter hint keeps first/last letters and separators', () => {
    expect(letterHint('cat')).toBe('c _ t')
    expect(letterHint('ice-cream')).toBe('i _ _ - _ _ _ _ m')
  })

  it('memory strength buckets', () => {
    expect(strengthOf({ state: 'new', retrievability: 0, reps: 0 })).toBe('new')
    expect(strengthOf({ state: 'review', retrievability: 0.95, reps: 3 })).toBe('strong')
    expect(strengthOf({ state: 'review', retrievability: 0.8, reps: 3 })).toBe('fair')
    expect(strengthOf({ state: 'relearning', retrievability: 0.4, reps: 3 })).toBe('weak')
  })

  it('forecast bars scale to the tallest day', () => {
    const bars = forecastBars(
      [
        { date: '2026-11-05', count: 10 },
        { date: '2026-11-06', count: 5 },
        { date: '2026-11-07', count: 0 },
      ],
      50,
    )
    expect(bars.map((b) => b.h)).toEqual([50, 25, 1])
  })

  it('practice set prefers weaker words', () => {
    const items = Array.from({ length: 40 }, (_, i) => ({
      id: i,
      review: { retrievability: i / 40, state: 'review', reps: 2 },
    }))
    const set = pickPracticeSet(items, 5, mulberry32(7))
    expect(set).toHaveLength(5)
    expect(set.every((x) => x.review.retrievability < 0.5)).toBe(true)
  })

  it('splits list input', () => {
    expect(splitList('a\n b \n\na')).toEqual(['a', 'b'])
    expect(splitList('make a decision, take a break; do homework', true)).toEqual([
      'make a decision',
      'take a break',
      'do homework',
    ])
  })
})
