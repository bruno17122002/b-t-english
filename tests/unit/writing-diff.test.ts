import { describe, expect, it } from 'vitest'
import { applyDiff, diffStats, tokenize, wordDiff } from '../../src/modules/writing/main/diff'

const norm = (s: string) => s.replace(/[ \t]+/g, ' ').trim()

describe('writing word diff', () => {
  it('tokenizes words, punctuation and trailing spaces', () => {
    expect(tokenize("I don't know, really.")).toEqual([
      { text: 'I', ws: ' ' },
      { text: "don't", ws: ' ' },
      { text: 'know', ws: '' },
      { text: ',', ws: ' ' },
      { text: 'really', ws: '' },
      { text: '.', ws: '' },
    ])
    expect(tokenize('Mỹ Tho is well-known.').map((t) => t.text)).toEqual(['Mỹ', 'Tho', 'is', 'well-known', '.'])
  })

  it('returns a single equal op for identical texts', () => {
    expect(wordDiff('Hello world.', 'Hello world.')).toEqual([{ type: 'equal', text: 'Hello world.' }])
    expect(wordDiff('', '')).toEqual([])
  })

  it('marks a substitution as delete then insert', () => {
    const ops = wordDiff('He go to school.', 'He goes to school.')
    expect(ops).toEqual([
      { type: 'equal', text: 'He ' },
      { type: 'delete', text: 'go ' },
      { type: 'insert', text: 'goes ' },
      { type: 'equal', text: 'to school.' },
    ])
  })

  it('handles insertions, deletions and capitalisation', () => {
    const ins = wordDiff('I went school yesterday.', 'I went to school yesterday.')
    expect(ins.filter((o) => o.type !== 'equal')).toEqual([{ type: 'insert', text: 'to ' }])
    const del = wordDiff('She is very very happy.', 'She is very happy.')
    expect(del.filter((o) => o.type !== 'equal')).toEqual([{ type: 'delete', text: 'very ' }])
    const caps = wordDiff('today i go out.', 'Today I go out.')
    expect(caps.filter((o) => o.type === 'insert').map((o) => o.text.trim())).toEqual(['Today I'])
  })

  it('treats punctuation as separate tokens and keeps newlines', () => {
    const ops = wordDiff('Hi Tom\n\nHow are you', 'Hi Tom,\n\nHow are you?')
    expect(ops.filter((o) => o.type === 'insert').map((o) => o.text.trim())).toEqual([',', '?'])
    expect(applyDiff(ops, 'corrected')).toContain('\n\n')
  })

  it('rebuilds both sides from the ops', () => {
    const a = 'Yesterday I go to the market and buyed three apple.'
    const b = 'Yesterday I went to the market and bought three apples.'
    const ops = wordDiff(a, b)
    expect(norm(applyDiff(ops, 'original'))).toBe(a)
    expect(norm(applyDiff(ops, 'corrected'))).toBe(b)
    // Adjacent ops never share a type (they are merged).
    expect(ops.every((o, i) => i === 0 || !(o.type === ops[i - 1]?.type))).toBe(true)
  })

  it('treats curly and straight apostrophes as equal', () => {
    expect(wordDiff('I don’t know.', "I don't know.").every((o) => o.type === 'equal')).toBe(true)
  })

  it('computes change statistics', () => {
    const stats = diffStats(wordDiff('He go to school.', 'He goes to school.'))
    expect(stats).toMatchObject({ inserted: 1, deleted: 1, unchanged: 3 })
    expect(stats.changeRatio).toBe(0.25)
    expect(diffStats([])).toMatchObject({ changeRatio: 0 })
  })

  it('stays fast and correct on long texts', () => {
    const words = Array.from({ length: 1500 }, (_, i) => `word${i % 97}`)
    const a = words.join(' ')
    const b = words.map((w, i) => (i % 50 === 0 ? 'changed' : w)).join(' ')
    const started = Date.now()
    const ops = wordDiff(a, b)
    expect(Date.now() - started).toBeLessThan(3000)
    expect(norm(applyDiff(ops, 'corrected'))).toBe(b)
    expect(diffStats(ops).inserted).toBe(30)
  })
})
