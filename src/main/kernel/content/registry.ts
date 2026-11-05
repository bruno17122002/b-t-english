// Content registry: bundled original content (and later third-party packs) validated with zod on first
// access. An invalid item is skipped and reported instead of crashing the app.
import type { z } from 'zod'
import {
  AssessmentItemSchema,
  CinemaStorySchema,
  DictionaryEntrySchema,
  GrammarTopicSchema,
  ListeningTrackSchema,
  ReadingPassageSchema,
  SpeakingPromptSchema,
  WritingPromptSchema,
  type AssessmentItem,
  type CinemaStory,
  type DictionaryEntry,
  type GrammarTopic,
  type ListeningTrack,
  type ReadingPassage,
  type SpeakingPrompt,
  type WritingPrompt,
} from '@shared/content'
import assessmentJson from '@content/assessment.json'
import cinemaJson from '@content/cinema.json'
import dictionaryJson from '@content/dictionary.json'
import grammarJson from '@content/grammar.json'
import listeningJson from '@content/listening.json'
import readingJson from '@content/reading.json'
import speakingJson from '@content/speaking-prompts.json'
import writingJson from '@content/writing-prompts.json'

export interface ContentIssue {
  collection: string
  index: number
  message: string
}

function parseList<T>(collection: string, raw: unknown, schema: z.ZodType<T>, issues: ContentIssue[]): T[] {
  if (!Array.isArray(raw)) {
    issues.push({ collection, index: -1, message: 'not an array' })
    return []
  }
  const out: T[] = []
  raw.forEach((item, index) => {
    const r = schema.safeParse(item)
    if (r.success) out.push(r.data)
    else issues.push({ collection, index, message: r.error.issues[0]?.message ?? 'invalid' })
  })
  return out
}

export interface ContentSources {
  reading: unknown
  listening: unknown
  grammar: unknown
  writing: unknown
  speaking: unknown
  cinema: unknown
  assessment: unknown
  dictionary: unknown
}

const BUNDLED: ContentSources = {
  reading: readingJson,
  listening: listeningJson,
  grammar: grammarJson,
  writing: writingJson,
  speaking: speakingJson,
  cinema: cinemaJson,
  assessment: assessmentJson,
  dictionary: dictionaryJson,
}

export class ContentRegistry {
  readonly issues: ContentIssue[] = []
  private cache = new Map<string, unknown>()

  constructor(private readonly sources: ContentSources = BUNDLED) {}

  private load<T>(key: keyof ContentSources, schema: z.ZodType<T>): T[] {
    if (!this.cache.has(key)) this.cache.set(key, parseList(key, this.sources[key], schema, this.issues))
    return this.cache.get(key) as T[]
  }

  reading(): ReadingPassage[] {
    return this.load('reading', ReadingPassageSchema)
  }
  listening(): ListeningTrack[] {
    return this.load('listening', ListeningTrackSchema)
  }
  grammar(): GrammarTopic[] {
    return this.load('grammar', GrammarTopicSchema)
  }
  writingPrompts(): WritingPrompt[] {
    return this.load('writing', WritingPromptSchema)
  }
  speakingPrompts(): SpeakingPrompt[] {
    return this.load('speaking', SpeakingPromptSchema)
  }
  stories(): CinemaStory[] {
    return this.load('cinema', CinemaStorySchema)
  }
  assessment(): AssessmentItem[] {
    return this.load('assessment', AssessmentItemSchema)
  }
  dictionary(): DictionaryEntry[] {
    return this.load('dictionary', DictionaryEntrySchema)
  }

  /** Looks a word up in the offline dictionary, then in glossaries of bundled content. */
  lookup(word: string): { entry: DictionaryEntry | (ReadingPassage['glossary'][number] & { topic?: string }); source: 'offline' | 'content' } | null {
    const key = word.trim().toLowerCase()
    if (!key) return null
    const dict = this.dictionary().find((e) => e.word.toLowerCase() === key)
    if (dict) return { entry: dict, source: 'offline' }
    for (const p of this.reading()) {
      const g = p.glossary.find((e) => e.word.toLowerCase() === key)
      if (g) return { entry: { ...g, topic: p.topicTags[0] }, source: 'content' }
    }
    for (const t of this.listening()) {
      const g = t.keyVocabulary.find((e) => e.word.toLowerCase() === key)
      if (g) return { entry: { ...g, topic: t.topic }, source: 'content' }
    }
    return null
  }
}
