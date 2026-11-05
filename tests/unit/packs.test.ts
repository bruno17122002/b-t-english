import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, it, expect } from 'vitest'
import {
  ConversationScenariosSchema,
  PackMetaSchema,
  PhonemeCatalogSchema,
  PracticeTargetsSchema,
  PronunciationModulesSchema,
  PronunciationPackSchema,
  SyllabusPackSchema,
} from '@shared/packs'
import { CEFR_LEVELS } from '@shared/content'
import { tokenizeIpa } from '@core/phonemes'

const PACKS_DIR = resolve(__dirname, '../../src/content/packs')
const MAX_FILE_BYTES = 2 * 1024 * 1024

function readPackFile(pack: string, file: string): unknown {
  const raw = readFileSync(resolve(PACKS_DIR, pack, file), 'utf8')
  expect(Buffer.byteLength(raw, 'utf8')).toBeLessThan(MAX_FILE_BYTES)
  return JSON.parse(raw) as unknown
}

describe('sprigo-en-syllabus pack', () => {
  const meta = PackMetaSchema.parse(readPackFile('sprigo-en-syllabus', 'pack.json'))
  const syllabus = SyllabusPackSchema.parse(readPackFile('sprigo-en-syllabus', 'syllabus.json'))

  it('has MIT metadata with attribution', () => {
    expect(meta.id).toBe('sprigo-en-syllabus')
    expect(meta.license).toBe('MIT')
    expect(meta.source).toBe('https://github.com/ozerozdas/sprigo')
    expect(meta.copyright).toMatch(/^Copyright/)
    expect(meta.files).toContain('syllabus.json')
  })

  it('covers every CEFR level in order with non-empty units and lessons', () => {
    expect(syllabus.map((l) => l.cefr)).toEqual([...CEFR_LEVELS])
    for (const level of syllabus) {
      expect(level.units.length).toBeGreaterThan(0)
      for (const unit of level.units) {
        expect(unit.cefr).toBe(level.cefr)
        expect(unit.lessons.length).toBeGreaterThan(0)
        for (const lesson of unit.lessons) {
          expect(lesson.cefr).toBe(level.cefr)
          expect(lesson.unitId).toBe(unit.id)
        }
      }
    }
  })

  it('carries vocabulary and grammar content', () => {
    const lessons = syllabus.flatMap((l) => l.units.flatMap((u) => u.lessons))
    expect(lessons.length).toBeGreaterThan(200)
    expect(lessons.filter((s) => s.vocabulary.length > 0).length).toBeGreaterThan(200)
    expect(lessons.filter((s) => s.grammar.length > 0).length).toBeGreaterThan(100)
  })
})

describe('cadence-pronunciation pack', () => {
  const pack = 'cadence-pronunciation'
  const meta = PackMetaSchema.parse(readPackFile(pack, 'pack.json'))
  const phonemes = PhonemeCatalogSchema.parse(readPackFile(pack, 'phonemes.json'))
  const modules = PronunciationModulesSchema.parse(readPackFile(pack, 'modules.json'))
  const targets = PracticeTargetsSchema.parse(readPackFile(pack, 'targets.json'))
  const conversations = ConversationScenariosSchema.parse(readPackFile(pack, 'conversations.json'))

  it('has MIT metadata listing every data file', () => {
    expect(meta.id).toBe(pack)
    expect(meta.license).toBe('MIT')
    expect(meta.source).toBe('https://github.com/pstepanovum/Cadence')
    expect(meta.files).toEqual(['conversations.json', 'modules.json', 'phonemes.json', 'targets.json'])
  })

  it('validates as a whole pronunciation pack', () => {
    const whole = PronunciationPackSchema.parse({ meta, phonemes, modules, targets, conversations })
    expect(whole.phonemes.length).toBe(phonemes.length)
  })

  it('has a phoneme catalog with unique symbols and Vietnamese notes', () => {
    expect(phonemes.length).toBeGreaterThanOrEqual(30)
    expect(new Set(phonemes.map((p) => p.symbol)).size).toBe(phonemes.length)
    expect(phonemes.every((p) => p.viNote !== null)).toBe(true)
  })

  it('has 10 modules with theory, practice and exam lessons', () => {
    expect(modules).toHaveLength(10)
    for (const mod of modules) {
      const types = mod.lessons.map((l) => l.type)
      expect(types).toContain('theory')
      expect(types).toContain('practice')
      expect(types).toContain('exam')
      for (const lesson of mod.lessons) {
        if (lesson.type === 'theory') expect(lesson.theoryHtml).not.toBeNull()
        else expect(lesson.words.length).toBeGreaterThan(0)
      }
    }
  })

  it('has practice targets whose IPA tokenises to the stored phonemes', () => {
    expect(targets.words.length).toBeGreaterThan(100)
    for (const t of targets.words) {
      expect(tokenizeIpa(t.ipa)).toEqual(t.phonemes)
      for (const seg of t.segments) expect(seg.end).toBeLessThanOrEqual(t.phonemes.length)
    }
  })

  it('has scripted conversation scenarios', () => {
    expect(conversations).toHaveLength(10)
    expect(conversations.every((c) => c.turns.length > 0)).toBe(true)
  })
})
