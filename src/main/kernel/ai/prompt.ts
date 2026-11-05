// Prompt Library primitives. Each prompt is versioned, has a zod schema for its output, an optional
// check (e.g. answer-leak detection) and a deterministic mock used for offline E2E tests.
import type { z } from 'zod'
import type { Cefr } from '@shared/content'
import type { ResponseLanguage, Skill, SkillLevel, TutorStyle } from '@shared/types'
import type { ChatMessage } from './types'

export interface LearnerSummary {
  displayName: string
  overallCefr: Cefr
  targetCefr: Cefr
  skills: Pick<SkillLevel, 'skill' | 'cefr'>[]
  interests: string[]
  purposes: string[]
  /** Most frequent recurring mistakes, newest first. */
  mistakes: { category: string; pattern: string; correction: string; count: number }[]
}

export interface PromptContext {
  learner: LearnerSummary
  level: Cefr
  responseLanguage: ResponseLanguage
  tutorStyle: TutorStyle
  /** Pre-rendered CEFR constraint block for `level`. */
  constraints: string
  /** Pre-rendered instruction about which language to explain in. */
  languageInstruction: string
  /** Compact learner profile line for personalisation. */
  learnerLine: string
}

export interface BuiltPrompt {
  system: string
  messages: ChatMessage[]
  audio?: { data: Uint8Array; mimeType: string }
  /** Optional image for vision-capable models (attached to the last user message). */
  image?: { data: Uint8Array; mimeType: string }
}

interface PromptSpecBase<I> {
  id: string
  version: number
  /** Skill whose CEFR level drives the constraints; defaults to the overall level. */
  skill?: Skill
  temperature?: number
  maxOutputTokens?: number
  build(input: I, ctx: PromptContext): BuiltPrompt
}

export interface JsonPromptSpec<I, O> extends PromptSpecBase<I> {
  kind: 'json'
  schema: z.ZodType<O>
  /** Returns a description of a problem (for example a leaked answer) or null when the output is acceptable. */
  check?(input: I, output: O): string | null
  mock(input: I, ctx: PromptContext): O
}

export interface TextPromptSpec<I> extends PromptSpecBase<I> {
  kind: 'text'
  mock(input: I, ctx: PromptContext): string
}

export type PromptSpec<I, O> = JsonPromptSpec<I, O> | TextPromptSpec<I>

export const jsonPrompt = <I, O>(spec: Omit<JsonPromptSpec<I, O>, 'kind'>): JsonPromptSpec<I, O> => ({
  kind: 'json',
  ...spec,
})
export const textPrompt = <I>(spec: Omit<TextPromptSpec<I>, 'kind'>): TextPromptSpec<I> => ({ kind: 'text', ...spec })

/** Standard JSON-only instruction appended to JSON prompts. */
export const JSON_ONLY =
  'Respond with a single valid JSON object only – no markdown fences, no commentary. Use exactly the fields described.'

/** True when `answer` appears verbatim (case-insensitive, word-bounded) inside `text`. */
export function leaksAnswer(text: string, answer: string): boolean {
  const a = answer.trim().toLowerCase()
  if (a.length < 2) return false
  const escaped = a.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`(^|[^a-z])${escaped}([^a-z]|$)`, 'i').test(text)
}
