// IPC contract for the grammar module (channel names start with 'grammar:'), plus the plain types and the
// pure answer-checking helpers shared by main and renderer. They live in this file because the tsconfig
// projects only include `src/modules/*/contract.ts` from the module root.
import { z } from 'zod'
import type { Cefr, GrammarTopic } from '@shared/content'
import type { ProviderId, Reward, SkillLevel } from '@shared/types'
import { normalizeAnswer } from '@core/text'
import { channel, NoInput, type ChannelDef } from '@shared/ipc'

// ---------- types ----------
export type GrammarExercise = GrammarTopic['exercises'][number]

export type TopicStatus = 'new' | 'learning' | 'mastered'

export interface GrammarTopicCard {
  id: string
  title: string
  cefr: Cefr
  summaryEn: string
  exerciseCount: number
  /** Best drill score so far, 0..1. */
  mastery: number
  attempts: number
  lastScore: number | null
  lastAt: string | null
  /** How often the learner tripped over this topic (recurring-mistake memory). */
  mistakeCount: number
  status: TopicStatus
}

export interface GrammarCastle {
  cefr: Cefr
  name: { en: string; vi: string }
  topics: GrammarTopicCard[]
  mastered: number
  /** True when the castle is above the learner's current grammar level (a challenge, not locked). */
  aboveLevel: boolean
}

export interface GrammarRecommendation {
  topicId: string
  title: string
  cefr: Cefr
  reason: 'mistakes' | 'level' | 'next-level' | 'review'
  reasonEn: string
  reasonVi: string
}

export interface RecurringGrammarMistake {
  pattern: string
  example: string
  correction: string
  count: number
  topicId: string | null
}

export interface GrammarOverview {
  level: Cefr
  levelScore: number
  castles: GrammarCastle[]
  recommended: GrammarRecommendation | null
  totals: { topics: number; mastered: number; attempts: number; exercises: number }
  recurringMistakes: RecurringGrammarMistake[]
  aiAvailable: boolean
}

export interface GrammarAttemptView {
  score: number
  correct: number
  total: number
  createdAt: string
}

export interface GrammarTopicView {
  topic: GrammarTopic
  mastery: number
  status: TopicStatus
  attempts: GrammarAttemptView[]
  mistakeCount: number
  nextTopic: { id: string; title: string; cefr: Cefr } | null
  aiAvailable: boolean
  learnerLevel: Cefr
}

export interface GrammarAnswerResult {
  exerciseId: string
  given: string
  correct: boolean
  expected: string
}

export interface GrammarSubmitResult {
  topicId: string
  score: number
  correct: number
  total: number
  previousMastery: number
  mastery: number
  masteredNow: boolean
  results: GrammarAnswerResult[]
  mistakesRecorded: number
  reward: Reward
  skill: SkillLevel
}

export interface GeneratedExercises {
  topicId: string
  level: Cefr
  exercises: GrammarExercise[]
  provider: ProviderId
}

export interface MistakeExplanation {
  explanationVi: string
  explanationEn: string
  rule: string
  correctedSentence: string
  tip: string
  provider: ProviderId
}

// ---------- answer checking ----------
const CONTRACTIONS: [RegExp, string][] = [
  [/\bwon't\b/g, 'will not'],
  [/\bcan't\b/g, 'can not'],
  [/\bcannot\b/g, 'can not'],
  [/\bshan't\b/g, 'shall not'],
  [/\bain't\b/g, 'is not'],
  [/\b(\w+)n't\b/g, '$1 not'],
  [/\bi'm\b/g, 'i am'],
  [/\b(\w+)'re\b/g, '$1 are'],
  [/\b(\w+)'ve\b/g, '$1 have'],
  [/\b(\w+)'ll\b/g, '$1 will'],
  [/\b(he|she|it|that|there|what|who|where|here)'s\b/g, '$1 is'],
]

/** Normalises an answer and expands common contractions so "don't drink" equals "do not drink". */
export function canonicalAnswer(s: string): string {
  let out = normalizeAnswer(s)
  for (const [re, rep] of CONTRACTIONS) out = out.replace(re, rep)
  return out.replace(/\s+/g, ' ').trim()
}

/** All accepted answers: alternatives may be separated by '/' (e.g. "who/that"). */
export function acceptedAnswers(answer: string): string[] {
  const parts = answer.includes('/') ? answer.split('/') : [answer]
  return parts.map((p) => p.trim()).filter(Boolean)
}

/** Sentence with the gap filled in by the (first) expected answer. */
export function fillGap(prompt: string, answer: string): string {
  const first = acceptedAnswers(answer)[0] ?? answer
  return prompt.includes('___') ? prompt.replace(/\s*\([^)]*\)/, '').replace('___', first) : prompt
}

/** Lenient check: case/punctuation/contractions ignored, '/' alternatives accepted, full sentence accepted for gaps. */
export function checkAnswer(
  ex: Pick<GrammarExercise, 'type' | 'prompt' | 'answer' | 'options'>,
  given: string,
): boolean {
  const g = canonicalAnswer(given)
  if (!g) return false
  if (ex.type === 'mcq') {
    if (normalizeAnswer(given) === normalizeAnswer(ex.answer)) return true
    return acceptedAnswers(ex.answer).some((a) => canonicalAnswer(a) === g)
  }
  for (const a of acceptedAnswers(ex.answer)) {
    const ca = canonicalAnswer(a)
    if (ca === g) return true
    // The learner typed the whole sentence instead of just the missing words.
    if (ex.prompt.includes('___') && canonicalAnswer(fillGap(ex.prompt, a)) === g) return true
  }
  return false
}

// ---------- channels ----------
const TopicId = z
  .string()
  .regex(/^[a-z0-9-]+$/)
  .max(80)

/** An exercise sent back by the renderer (AI-generated extras are not stored, so they travel with the answer). */
export const ExerciseInputSchema = z.object({
  id: z.string().min(1).max(120),
  type: z.enum(['mcq', 'gap']),
  prompt: z.string().min(1).max(400),
  options: z.array(z.string().max(200)).max(6).default([]),
  answer: z.string().min(1).max(200),
  explanation: z.string().max(800).default(''),
})

export const grammarContract = {
  'grammar:overview': channel<GrammarOverview>()(NoInput),
  'grammar:topic': channel<GrammarTopicView>()(z.object({ id: TopicId })),
  'grammar:submit': channel<GrammarSubmitResult>()(
    z.object({
      topicId: TopicId,
      durationSec: z
        .number()
        .min(0)
        .max(4 * 3600)
        .default(0),
      answers: z
        .array(
          z.object({
            exerciseId: z.string().min(1).max(120),
            given: z.string().max(400),
            /** Required only for exercises that are not part of the bundled topic (AI extras). */
            exercise: ExerciseInputSchema.optional(),
          }),
        )
        .min(1)
        .max(60),
    }),
  ),
  'grammar:generate': channel<GeneratedExercises>()(z.object({ topicId: TopicId })),
  'grammar:explain': channel<MistakeExplanation>()(
    z.object({ topicId: TopicId, exercise: ExerciseInputSchema, given: z.string().max(400) }),
  ),
} satisfies Record<`grammar:${string}`, ChannelDef>
