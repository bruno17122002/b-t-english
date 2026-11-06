// IPC contract for the writing module. Channel names must start with 'writing:'.
import { z } from 'zod'
import { WritingTaskTypeSchema, type Cefr, type WritingPrompt } from '@shared/content'
import { channel, clampedNumber, NoInput, type ChannelDef } from '@shared/ipc'
import type { Reward, SkillLevel, WritingSubmission } from '@shared/types'

// ---------- output types (shared by main and renderer) ----------
export interface WritingPromptInfo extends WritingPrompt {
  attempts: number
  /** Best AI score 0..10 or null. */
  bestScore: number | null
}

export interface WritingCatalog {
  prompts: WritingPromptInfo[]
  writingLevel: Cefr
  recommended: string[]
  aiAvailable: boolean
}

export interface WritingHistoryItem {
  id: number
  promptId: string | null
  title: string
  taskType: string
  words: number
  /** Average AI score 0..10, null when there is no AI feedback. */
  score: number | null
  cefr: Cefr | null
  heuristicCefr: Cefr
  ieltsBand: number | null
  selfCorrected: boolean
  createdAt: string
}

export interface AiFailure {
  code: string
  message: string
  hint?: string
}

export type DiffType = 'equal' | 'insert' | 'delete'

export interface DiffOp {
  type: DiffType
  /** Segment text including the whitespace that followed it. */
  text: string
}

export interface MarkedSegment {
  text: string
  /** Index into feedback.errors, or null for unmarked text. */
  errorIndex: number | null
}

export type CheckStatus = 'pass' | 'warn' | 'fail' | 'manual'

export interface CheckItem {
  id: string
  en: string
  vi: string
  status: CheckStatus
}

/** A submission plus everything the result page renders (computed in main so it is tested once). */
export interface WritingSubmissionView {
  submission: WritingSubmission
  prompt: WritingPrompt | null
  /** Average AI score 0..10 when feedback is available. */
  score: number | null
  /** Word diff original → AI corrected text. */
  diff: DiffOp[] | null
  /** Original text with AI errors marked (clickable in the UI). */
  marked: MarkedSegment[] | null
  /** Word diff original → learner's self-corrected text. */
  revisionDiff: DiffOp[] | null
  /** Offline check of which AI errors the self-corrected text fixed. */
  fixes: { fixed: number[]; remaining: number[] } | null
  /** Offline checklist (always available, rough estimate). */
  checklist: CheckItem[]
}

export interface WritingSubmitResult {
  view: WritingSubmissionView
  reward: Reward
  skill: SkillLevel
  /** Set when AI feedback was requested but could not be produced (submission is still saved). */
  aiError: AiFailure | null
}

export interface WritingRecheck {
  /** Errors from the first feedback that are now fixed / still present (heuristic, offline). */
  fixed: number[]
  remaining: number[]
  /** AI second-round check when available. */
  ai: {
    comment: string
    score: number
    remainingIssues: { original: string; correction: string; explanationVi: string }[]
  } | null
  aiError: AiFailure | null
}

export interface WritingSelfCorrectResult {
  view: WritingSubmissionView
  recheck: WritingRecheck
}
// ---------- channels ----------

const Id = z.object({ id: z.number().int().positive() })
const Text = z.string().trim().min(1).max(12000)

export const writingContract = {
  'writing:catalog': channel<WritingCatalog>()(NoInput),
  /**
   * Saves the text with offline metrics, then (when `analyze` is true and AI is configured) attaches AI
   * feedback. AI problems never lose the text: they come back in `aiError`.
   */
  'writing:submit': channel<WritingSubmitResult>()(
    z.object({
      promptId: z.string().max(120).nullable().default(null),
      taskType: WritingTaskTypeSchema.default('free'),
      promptText: z.string().max(2000).default(''),
      text: Text,
      minutes: clampedNumber(0, 600).optional(),
      analyze: z.boolean().default(true),
    }),
  ),
  /** Runs (or re-runs) AI feedback for a saved submission. Fails with ai_* errors when AI is unavailable. */
  'writing:analyze': channel<WritingSubmissionView>()(Id),
  'writing:selfCorrect': channel<WritingSelfCorrectResult>()(
    z.object({ id: z.number().int().positive(), text: Text, useAi: z.boolean().default(true) }),
  ),
  'writing:get': channel<WritingSubmissionView>()(Id),
  'writing:history': channel<WritingHistoryItem[]>()(
    z
      .object({ limit: z.number().int().min(1).max(200).optional(), promptId: z.string().max(120).optional() })
      .optional(),
  ),
  'writing:delete': channel<null>()(Id),
} satisfies Record<`writing:${string}`, ChannelDef>
