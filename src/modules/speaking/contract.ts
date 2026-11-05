// IPC contract for the speaking module. Channel names must start with 'speaking:'.
import { z } from 'zod'
import { SPEAKING_KINDS, type SpeakingPrompt } from '@shared/content'
import { channel, NoInput, type ChannelDef } from '@shared/ipc'
import type { ConversationTurn, PhonemeEntry, PronunciationWord } from '@shared/packs'
import type { Reward, SkillLevel, SpeakingSession } from '@shared/types'
import type { PhonemeAlignment } from '@core/phonemes'

// ---------- output types (shared by main and renderer) ----------
export const SPEAKING_MODES = [
  'shadowing',
  'repeat',
  'roleplay',
  'real-world',
  'challenge',
  'ielts',
  'scenario',
  'pronunciation',
  'free',
] as const
export type SpeakingMode = (typeof SPEAKING_MODES)[number]

export type SpeakingSource = 'builtin' | 'cadence'

/** Cadence conversation scenario attached to a prompt converted from the pronunciation pack. */
export interface ScenarioInfo {
  level: string
  topic: string
  summary: string
  scenario: string
  focus: string[]
  passScore: number
  estimatedMinutes: number
  turns: ConversationTurn[]
}

export interface SpeakingPromptView extends SpeakingPrompt {
  source: SpeakingSource
  scenario: ScenarioInfo | null
  attempts: number
  /** Best session score 0..1 (word accuracy or AI feedback average), null when never scored. */
  bestScore: number | null
  lastAt: string | null
}

/** Measured pause analysis from the renderer recorder (all values in seconds). */
export interface RecordingAnalysis {
  durationSec: number
  speakingSec: number
  pauseCount: number
  longestPauseSec: number
}

export interface SpeakingSubmitResult {
  session: SpeakingSession
  reward: Reward
  skill: SkillLevel
  /** Seconds credited to speaking quests. */
  speakingSeconds: number
  score: number | null
}

export interface RoleplayReply {
  reply: string
  correction: { original: string; better: string; explanationVi: string } | null
  /** Vietnamese hint about what the learner could say next. */
  hintVi: string
  done: boolean
  provider: string
}

// ---------- pronunciation path ----------

export interface PronLessonSummary {
  id: string
  title: string
  type: 'theory' | 'practice' | 'exam'
  order: number
  wordCount: number
  attempts: number
  bestScore: number | null
  completed: boolean
}

export interface PronModuleView {
  id: string
  order: number
  title: string
  description: string
  phonemeFocus: string[]
  focusSymbols: string[]
  lessons: PronLessonSummary[]
  completedLessons: number
}

export interface PackAttribution {
  name: string
  license: 'MIT'
  source: string
  copyright: string
  attribution: string
}

export interface PronOverview {
  attribution: PackAttribution
  modules: PronModuleView[]
  phonemes: PhonemeEntry[]
  categories: Record<string, string>
  /** First lesson that is not completed yet (recommended next step). */
  nextLessonId: string | null
}

export interface PronWordView extends PronunciationWord {
  focusPhoneme: string | null
  cue: string | null
}

export interface PronLessonView {
  module: { id: string; title: string; order: number; focusSymbols: string[]; phonemeFocus: string[] }
  lesson: PronLessonSummary
  theory: TheoryBlock[]
  words: PronWordView[]
  focusPhonemes: PhonemeEntry[]
  prevLessonId: string | null
  nextLessonId: string | null
  /** Score needed to pass an exam lesson (0..1). */
  passScore: number
  attribution: PackAttribution
}

export interface PronEstimateResult {
  word: string
  targetIpa: string
  heardIpa: string
  transcript: string
  alignment: PhonemeAlignment
  /** Phoneme accuracy 0..1 (AI estimate). */
  score: number
  confidence: 'low' | 'medium' | 'high'
  tipVi: string
  provider: string
}

export interface PronCompleteResult {
  passed: boolean
  bestScore: number
  reward: Reward
  skill: SkillLevel
}

// ---------- pronunciation theory (sanitised Cadence markup) ----------

export interface InlineRun {
  text: string
  strong?: boolean
  em?: boolean
}

export type TheoryBlock =
  | { type: 'heading'; runs: InlineRun[] }
  | { type: 'paragraph'; runs: InlineRun[] }
  | { type: 'list'; items: InlineRun[][] }

// ---------- channels ----------

const Slug = z
  .string()
  .regex(/^[a-z0-9][a-z0-9-]*$/)
  .max(120)

export const RecordingAnalysisSchema = z.object({
  durationSec: z.number().min(0).max(3600),
  speakingSec: z.number().min(0).max(3600),
  pauseCount: z.number().int().min(0).max(5000),
  longestPauseSec: z.number().min(0).max(3600),
})

export const SpeakingSubmitSchema = z.object({
  mode: z.enum(SPEAKING_MODES),
  promptId: Slug.nullable().optional(),
  /** What the learner was asked to do (instruction, cue card or target sentence). */
  prompt: z.string().max(4000).default(''),
  /** Exact text the learner tried to say (shadowing/repeat/scenario), used for word accuracy. */
  target: z.string().max(4000).nullable().optional(),
  /** Speech-to-text result or typed answer; null when no transcription was possible (no AI key). */
  transcript: z.string().max(8000).nullable(),
  analysis: RecordingAnalysisSchema,
})

const ChatTurn = z.object({ role: z.enum(['user', 'assistant']), content: z.string().max(1000) })

export const speakingContract = {
  'speaking:prompts': channel<SpeakingPromptView[]>()(
    z.object({ kind: z.enum(SPEAKING_KINDS).optional(), source: z.enum(['builtin', 'cadence']).optional() }).optional(),
  ),
  'speaking:prompt': channel<SpeakingPromptView>()(z.object({ id: Slug })),
  'speaking:submit': channel<SpeakingSubmitResult>()(SpeakingSubmitSchema),
  /** AI feedback for a stored session (needs an AI key). */
  'speaking:feedback': channel<SpeakingSession>()(z.object({ sessionId: z.number().int().positive() })),
  'speaking:history': channel<SpeakingSession[]>()(
    z.object({ promptId: Slug.optional(), limit: z.number().int().min(1).max(200).optional() }).optional(),
  ),
  /** One AI turn of a role-play / real-world conversation. */
  'speaking:roleplayTurn': channel<RoleplayReply>()(
    z.object({
      promptId: Slug,
      history: z.array(ChatTurn).max(40),
      userText: z.string().trim().min(1).max(1000),
    }),
  ),

  // ---------- pronunciation path (Cadence pack) ----------
  'speaking:pronOverview': channel<PronOverview>()(NoInput),
  'speaking:pronLesson': channel<PronLessonView>()(z.object({ id: Slug })),
  /** AI estimate of the phonemes the learner produced, aligned with the target IPA. */
  'speaking:pronEstimate': channel<PronEstimateResult>()(
    z.object({
      word: z.string().trim().min(1).max(80),
      ipa: z.string().trim().min(1).max(120),
      transcript: z.string().max(400),
    }),
  ),
  'speaking:pronComplete': channel<PronCompleteResult>()(
    z.object({
      lessonId: Slug,
      score: z.number().min(0).max(1),
      durationSec: z.number().min(0).max(7200).default(0),
      speakingSec: z.number().min(0).max(7200).default(0),
      words: z
        .array(z.object({ word: z.string().max(80), score: z.number().min(0).max(1), method: z.enum(['ai', 'self']) }))
        .max(100)
        .optional(),
    }),
  ),
} satisfies Record<`speaking:${string}`, ChannelDef>
