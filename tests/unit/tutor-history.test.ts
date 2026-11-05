import { describe, expect, it } from 'vitest'
import { clip, windowHistory, type HistoryMessage } from '../../src/modules/tutor/main/history'
import { cleanCorrections, cleanNewWords } from '../../src/modules/tutor/main/service'
import { mockCorrections } from '../../src/modules/tutor/main/prompts'

const chat = (n: number): HistoryMessage[] =>
  Array.from({ length: n }, (_, i) => ({
    id: i + 1,
    role: i % 2 === 0 ? 'user' : 'assistant',
    content: `message ${i + 1}`,
  }))

describe('tutor history window', () => {
  it('sends short chats verbatim without a summary', () => {
    const w = windowHistory(chat(6))
    expect(w.recent).toHaveLength(6)
    expect(w.summary).toBe('')
    expect(w.droppedCount).toBe(0)
    expect(w.lastDroppedId).toBe(0)
  })

  it('keeps only the last N messages and starts with a learner turn', () => {
    const w = windowHistory(chat(31), { window: 12 })
    expect(w.recent.length).toBeLessThanOrEqual(12)
    expect(w.recent[0]?.content).toBe('message 21')
    expect(w.droppedCount).toBe(20)
    expect(w.lastDroppedId).toBe(20)
    expect(w.unsummarized).toHaveLength(20)
    expect(w.summary).toContain('Learner: message 1')
  })

  it('drops a leading assistant turn when the window starts on one', () => {
    // chat(30): the last 12 start on message 19 (a learner turn) → kept whole.
    const even = windowHistory(chat(30), { window: 12 })
    expect(even.recent).toHaveLength(12)
    expect(even.recent[0]?.content).toBe('message 19')
    // chat(31): the last 12 start on message 20 (a tutor turn) → that one moves to the summary.
    const odd = windowHistory(chat(31), { window: 12 })
    expect(odd.recent).toHaveLength(11)
    expect(odd.summary).toContain('Tutor: message 20')
  })

  it('uses the stored summary and only adds notes for newer dropped turns', () => {
    const w = windowHistory(chat(40), { window: 12, summary: 'They talked about football.', summarizedUptoId: 24 })
    expect(w.unsummarized.map((m) => m.id)).toEqual([25, 26, 27, 28])
    expect(w.summary.startsWith('They talked about football.')).toBe(true)
    expect(w.summary).toContain('Tutor: message 28')
    expect(w.summary).not.toContain('message 24')
  })

  it('bounds the summary size, keeping the newest notes', () => {
    const long = Array.from({ length: 200 }, (_, i): HistoryMessage => ({
      id: i + 1,
      role: 'user',
      content: `note ${i + 1} `.repeat(30),
    }))
    const w = windowHistory(long, { window: 12, maxSummaryChars: 500 })
    expect(w.summary.length).toBeLessThanOrEqual(500)
    expect(w.summary).toContain('note 188')
    expect(w.summary).not.toContain('note 1 ')
  })

  it('clips very long messages', () => {
    const w = windowHistory([{ id: 1, role: 'user', content: 'x'.repeat(5000) }], { maxMessageChars: 100 })
    expect(w.recent[0]?.content.length).toBe(100)
    expect(clip('a   b\n c', 10)).toBe('a b c')
  })
})

describe('tutor output cleaning', () => {
  it('drops unchanged and duplicate corrections and fills the pattern', () => {
    const out = cleanCorrections([
      { original: 'goed', correction: 'went', explanationVi: 'x', category: 'grammar' },
      { original: 'Goed', correction: 'went', explanationVi: 'dup', category: 'grammar' },
      { original: 'same', correction: 'same', explanationVi: '', category: 'style' },
      { original: 'i', correction: 'I', explanationVi: '', category: 'spelling', pattern: 'capital I' },
    ])
    expect(out.map((c) => c.correction)).toEqual(['went', 'I'])
    expect(out[0]?.pattern).toBe('goed → went')
    expect(out[1]?.pattern).toBe('capital I')
  })

  it('dedupes new words', () => {
    expect(
      cleanNewWords([
        { word: 'Routine', meaningVi: 'a', example: '' },
        { word: 'routine', meaningVi: 'b', example: '' },
        { word: '  daily  life ', meaningVi: 'c', example: 'x' },
      ]).map((w) => w.word),
    ).toEqual(['Routine', 'daily life'])
  })

  it('mock corrections are deterministic', () => {
    expect(mockCorrections('Yesterday i goed home').map((c) => c.correction)).toEqual(['went', 'I'])
    expect(mockCorrections('All good here.')).toEqual([])
  })
})
