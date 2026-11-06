// IPC contract for the reading module. Channel names must start with 'reading:'.
import { z } from 'zod'
import { CefrSchema, ReadingCategorySchema, type Cefr, type ReadingPassage } from '@shared/content'
import { channel, clampedNumber, NoInput, type ChannelDef } from '@shared/ipc'
import type { Reward, SkillLevel } from '@shared/types'

// ---------- output types (shared by main and renderer) ----------
export type PassageSource = 'builtin' | 'ai'

export interface PassageSummary {
  id: string
  title: string
  category: ReadingPassage['category']
  cefr: Cefr
  topicTags: string[]
  summaryVi: string
  words: number
  /** Estimated reading minutes at a comfortable learner speed. */
  minutes: number
  source: PassageSource
  readCount: number
  /** Best quiz accuracy 0..1 or null when never completed. */
  bestScore: number | null
  bestWpm: number | null
  lastReadAt: string | null
  createdAt: string | null
}

export interface ReadingLibrary {
  passages: PassageSummary[]
  readingLevel: Cefr
  /** Ids of passages recommended for the learner's reading level (unread first). */
  recommended: string[]
  stats: { completed: number; averageWpm: number | null; averageScore: number | null }
}

export interface ReadingHistoryEntry {
  id: number
  passageId: string
  title: string
  words: number
  seconds: number
  wpm: number
  quizCorrect: number
  quizTotal: number
  createdAt: string
}

export interface ReadingHighlight {
  id: number
  passageId: string
  text: string
  note: string
  color: HighlightColor
  createdAt: string
}

export const HIGHLIGHT_COLORS = ['amber', 'green', 'blue', 'pink'] as const
export type HighlightColor = (typeof HIGHLIGHT_COLORS)[number]

export interface PassageView {
  passage: ReadingPassage
  source: PassageSource
  words: number
  history: ReadingHistoryEntry[]
  highlights: ReadingHighlight[]
}

export interface ReadingResult {
  entry: ReadingHistoryEntry
  accuracy: number
  correct: boolean[]
  reward: Reward
  skill: SkillLevel
}

export interface SentenceExplanation {
  sentence: string
  translationVi: string
  simplified: string
  grammarPoints: { point: string; explanationVi: string }[]
  keyPhrases: { phrase: string; meaningVi: string }[]
}

export interface RetellFeedback {
  score: number // 0..10
  coverage: number // 0..1 share of main points mentioned
  mainPoints: { point: string; covered: boolean }[]
  strengths: string[]
  inaccuracies: string[]
  languageCorrections: { original: string; better: string; explanationVi: string }[]
  improvedVersion: string
  encouragementVi: string
}

// ---------- channels ----------

const PassageId = z.string().trim().min(1).max(120)
const HighlightColorSchema = z.enum(HIGHLIGHT_COLORS)

export const readingContract = {
  'reading:library': channel<ReadingLibrary>()(NoInput),
  'reading:get': channel<PassageView>()(z.object({ id: PassageId })),
  'reading:complete': channel<ReadingResult>()(
    z.object({
      id: PassageId,
      seconds: clampedNumber(1, 4 * 3600),
      /** Chosen option index per question (same order as passage.questions); -1 = skipped. */
      answers: z.array(z.number().int().min(-1).max(10)).max(30),
    }),
  ),
  'reading:history': channel<ReadingHistoryEntry[]>()(
    z.object({ limit: z.number().int().min(1).max(200).optional(), passageId: PassageId.optional() }).optional(),
  ),
  'reading:savedWords': channel<string[]>()(NoInput),

  'reading:highlights': channel<ReadingHighlight[]>()(z.object({ passageId: PassageId })),
  'reading:addHighlight': channel<ReadingHighlight>()(
    z.object({
      passageId: PassageId,
      text: z.string().trim().min(1).max(2000),
      note: z.string().max(2000).default(''),
      color: HighlightColorSchema.default('amber'),
    }),
  ),
  'reading:updateHighlight': channel<ReadingHighlight>()(
    z.object({
      id: z.number().int().positive(),
      note: z.string().max(2000).optional(),
      color: HighlightColorSchema.optional(),
    }),
  ),
  'reading:deleteHighlight': channel<null>()(z.object({ id: z.number().int().positive() })),

  'reading:generate': channel<PassageSummary>()(
    z.object({
      cefr: CefrSchema,
      category: ReadingCategorySchema,
      topic: z.string().trim().max(120).default(''),
    }),
  ),
  'reading:deleteGenerated': channel<null>()(z.object({ id: PassageId })),
  'reading:explainSentence': channel<SentenceExplanation>()(
    z.object({
      passageId: PassageId.optional(),
      sentence: z.string().trim().min(2).max(1200),
      context: z.string().max(3000).optional(),
    }),
  ),
  'reading:retell': channel<RetellFeedback>()(z.object({ id: PassageId, text: z.string().trim().min(10).max(4000) })),
} satisfies Record<`reading:${string}`, ChannelDef>
