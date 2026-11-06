// Text abuse in learner-facing data: display names, words and notes with HTML, emoji, RTL overrides, zero-width
// characters, newlines and 10k characters; search with regex / LIKE metacharacters; CSV export → import
// round-trip with quotes, commas, newlines and spreadsheet formula injection; Telegram HTML escaping.
import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import type { LearningGoal, Profile, SearchResult, VocabItem } from '../../src/shared/types'
import type { TutorConversation } from '../../src/shared/types'
import { cleanInline } from '../../src/core/text'
import { csvCell, parseCsv } from '../../src/main/kernel/data/dataService'
import { CAPTION_LIMIT, escapeHtml, splitHtml, stripHtml, TELEGRAM_CHUNK } from '../../src/main/kernel/telegram/format'
import { NASTY_STRINGS } from '../helpers/fuzz'
import { makeApp, tempDir } from '../helpers/kernel'

describe('display name, titles and notes', () => {
  it('display names are one clean line: no newlines, bidi overrides or zero-width characters', async () => {
    const { call, router } = await makeApp()
    const cases: [string, string][] = [
      ['Lan\nAdmin\r\n\tX', 'Lan Admin X'],
      ['\u202eabc.exe\u202c', 'abc.exe'],
      ['Mi\u200bnh\ufeff', 'Minh'],
      ['<b>Lan</b> & "co"', '<b>Lan</b> & "co"'],
      ['👩\u200d👩\u200d👧 Gia đình', '👩\u200d👩\u200d👧 Gia đình'],
      ['   ', ''],
    ]
    for (const [input, expected] of cases) {
      const p = await call<Profile>('learner:updateProfile', { displayName: input })
      expect(p.displayName).toBe(expected)
    }
    // 60 emoji = 120 UTF-16 units: rejected by the schema, never cut inside a surrogate pair.
    const long = await router.dispatch('learner:updateProfile', { displayName: 'a'.repeat(10_000) })
    expect(long).toMatchObject({ ok: false, error: { code: 'invalid_input' } })
    const emoji = await call<Profile>('learner:updateProfile', { displayName: '😀'.repeat(30) })
    expect(Array.from(emoji.displayName)).toHaveLength(30)
    expect(emoji.displayName).not.toMatch(/[\ud800-\udbff](?![\udc00-\udfff])/)
  })

  it('goal titles and tutor titles are cleaned; a goal date must be a date', async () => {
    const { call, router } = await makeApp()
    const goals = await call<LearningGoal[]>('learner:saveGoal', {
      kind: 'custom',
      title: 'IELTS\n7.0\u202e!',
      metric: 'none',
      targetValue: 0,
      targetDate: '',
      status: 'active',
    })
    expect(goals[0]).toMatchObject({ title: 'IELTS 7.0!', targetDate: null })
    const bad = await router.dispatch('learner:saveGoal', {
      kind: 'custom',
      title: 'x',
      metric: 'none',
      targetValue: 0,
      targetDate: 'x'.repeat(100_000),
      status: 'active',
    })
    expect(bad).toMatchObject({ ok: false, error: { code: 'invalid_input' } })
    const c = await call<TutorConversation>('tutor:create', { mode: 'friendly', title: '\n\u200b' })
    expect(c.title.trim().length).toBeGreaterThan(0)
    const r = await call<TutorConversation>('tutor:rename', { id: c.id, title: 'Chat\nwith\ttutor' })
    expect(r.title).toBe('Chat with tutor')
  })

  it('vocabulary keeps HTML / emoji / multi-line notes verbatim but within the caps', async () => {
    const { call, router } = await makeApp()
    for (const [label, s] of NASTY_STRINGS) {
      const res = await router.dispatch('vocab:save', {
        word: `w ${label}`.slice(0, 80),
        notes: s,
        meaningVi: s,
        sourceModule: 'manual',
      })
      if (s.length > 300) expect(res, label).toMatchObject({ ok: false, error: { code: 'invalid_input' } })
      else expect(res.ok, label).toBe(true)
    }
    const html = await call<{ item: VocabItem }>('vocab:save', {
      word: '<img src=x onerror=alert(1)>',
      notes: 'line 1\nline 2\n<script>alert(1)</script>',
      sourceModule: 'manual',
    })
    expect(html.item.word).toBe('<img src=x onerror=alert(1)>')
    expect(html.item.notes).toContain('\n')
    const big = await router.dispatch('vocab:update', { id: html.item.id, patch: { notes: 'n'.repeat(1001) } })
    expect(big).toMatchObject({ ok: false, error: { code: 'invalid_input' } })
  })
})

describe('search with metacharacters', () => {
  it('LIKE wildcards in the vocabulary filter match literally', async () => {
    const { call } = await makeApp()
    for (const word of ['50% off', 'snake_case', 'back\\slash', 'plain'])
      await call('vocab:save', { word, sourceModule: 'manual' })
    const q = async (query: string) =>
      (await call<{ items: VocabItem[] }>('vocab:list', { query })).items.map((i) => i.word).sort()
    expect(await q('%')).toEqual(['50% off'])
    expect(await q('_')).toEqual(['snake_case'])
    expect(await q('\\')).toEqual(['back\\slash'])
    expect(await q('e_c')).toEqual(['snake_case'])
    expect(await q('pl%n')).toEqual([])
  })

  it('global search and dictionary handle regex metacharacters, emoji and huge input', async () => {
    const { call, router } = await makeApp()
    await call('vocab:save', { word: 'c++ (language)', meaningVi: 'ngôn ngữ [lập trình]', sourceModule: 'manual' })
    for (const q of [
      '(',
      '[',
      '*',
      '+',
      '?',
      '\\',
      '.*',
      '^$',
      '(?<x>',
      'c++',
      '[lập',
      '😀',
      '\u202e',
      "' OR 1=1 --",
    ]) {
      const res = await router.dispatch('search:query', { q })
      expect(res.ok, q).toBe(true)
      const d = await router.dispatch('vocab:dictionary', { query: q })
      expect(d.ok, q).toBe(true)
    }
    const hits = await call<SearchResult[]>('search:query', { q: 'c++' })
    expect(hits.some((h) => h.kind === 'vocab')).toBe(true)
  })
})

describe('CSV export / import round-trip', () => {
  const tricky = [
    { word: 'say "hi"', meaningVi: 'nói "xin chào", vui vẻ', notes: 'line 1\nline 2\r\nline 3' },
    { word: 'comma, word', meaningVi: 'a,b,,c', notes: '' },
    { word: 'formula', meaningVi: '=HYPERLINK("http://evil.example","click")', notes: '+1+2' },
    { word: 'minus', meaningVi: '-2+3', notes: '@SUM(A1:A2)' },
    { word: 'tab', meaningVi: '\tleading tab', notes: '' },
    { word: '=cmd|"/c calc"!A0', meaningVi: 'dde', notes: '' },
    { word: "'quoted", meaningVi: "'=already escaped?", notes: "''+two" },
    { word: 'emoji 😀', meaningVi: 'Tiếng Việt đầy đủ dấu', notes: '<b>bold</b>' },
  ]

  it('neutralises formula injection in the exported file and restores the exact values on import', async () => {
    const out = path.join(tempDir(), 'words.csv')
    const a = await makeApp({ host: { saveFile: async () => out } })
    for (const t of tricky) await a.call('vocab:save', { ...t, sourceModule: 'manual' })
    await a.call('data:exportVocabCsv')
    const text = fs.readFileSync(out, 'utf8')
    const rows = parseCsv(text)
    expect(rows).toHaveLength(tricky.length + 1)
    // No exported cell may start with a formula trigger.
    for (const cell of rows.flat()) expect(cell, cell).not.toMatch(/^[=+\-@\t\r]/)

    const b = await makeApp({ host: { openFile: async () => out } })
    const res = await b.call<{ added: number; skipped: number }>('data:importVocab')
    expect(res).toMatchObject({ added: tricky.length, skipped: 0 })
    for (const t of tricky) {
      const item = b.kernel.vocab.findByWord(t.word)
      expect(item, t.word).not.toBeNull()
      // Import trims cells; the stored values otherwise come back exactly.
      expect(item?.meaningVi).toBe(t.meaningVi.trim())
      expect(item?.notes).toBe(t.notes.trim())
    }
  })

  it('csvCell quotes and guards every dangerous start', () => {
    expect(csvCell('=1+1')).toBe("'=1+1")
    expect(csvCell('+1')).toBe("'+1")
    expect(csvCell('-1')).toBe("'-1")
    expect(csvCell('@x')).toBe("'@x")
    expect(csvCell('\tx')).toBe("'\tx")
    expect(csvCell('a,b')).toBe('"a,b"')
    expect(csvCell('say "x"')).toBe('"say ""x"""')
    expect(csvCell('=a,b')).toBe(`"'=a,b"`)
    expect(csvCell(null)).toBe('')
    expect(csvCell(42)).toBe('42')
  })
})

describe('Telegram / notification output', () => {
  it('escapes learner text for Telegram HTML and keeps entities whole when splitting', () => {
    for (const [, s] of NASTY_STRINGS) {
      const html = `<b>${escapeHtml(s)}</b>`
      expect(html.slice(3, -4)).not.toMatch(/<|>/)
      // 120 is below the 200-character reserve for re-opened tags: it used to cut pieces of length 0 forever.
      for (const limit of [CAPTION_LIMIT, TELEGRAM_CHUNK, 120]) {
        const parts = splitHtml(html, limit)
        for (const p of parts) {
          expect(p.length).toBeLessThanOrEqual(limit + 20)
          // No part ends inside an entity such as "&am".
          expect(p).not.toMatch(/&[a-z]{0,4}$/)
        }
        if (s.trim()) expect(stripHtml(parts.join('')).replace(/\s/g, '')).toBe(s.replace(/\s/g, ''))
      }
    }
    expect(escapeHtml('<script>&"')).toBe('&lt;script&gt;&amp;&quot;')
  })

  it('cleanInline never breaks surrogate pairs or keeps invisible spoofing characters', () => {
    expect(cleanInline('😀😀😀', 2)).toBe('😀😀')
    expect(cleanInline('a\u0000b\u0007c', 10)).toBe('a b c')
    expect(cleanInline('\u2066x\u2069\u200f', 10)).toBe('x')
    expect(cleanInline('👨\u200d💻 dev', 10)).toBe('👨\u200d💻 dev')
  })
})
