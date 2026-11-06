// IPC contract for the listening module. Channel names must start with 'listening:'.
import { z } from 'zod'
import { AccentSchema, CefrSchema, type Cefr, type ListeningTrack } from '@shared/content'
import { channel, clampedNumber, type ChannelDef } from '@shared/ipc'
import type { Reward, SkillLevel } from '@shared/types'

// ---------- output types (shared by main and renderer) ----------
export const LISTENING_MODES = ['gist', 'dictation', 'gap', 'shadow'] as const
export type ListeningMode = (typeof LISTENING_MODES)[number]

export type TrackSource = 'builtin' | 'ai'

export interface TrackSummary {
  id: string
  title: string
  cefr: Cefr
  topic: string
  accent: ListeningTrack['accent']
  kind: ListeningTrack['kind']
  lineCount: number
  wordCount: number
  /** Rough audio length at normal speed (TTS ≈ 150 wpm plus line gaps). */
  estSeconds: number
  source: TrackSource
  provider: string | null
  favorite: boolean
  attempts: number
  bestAccuracy: number | null
  modesDone: ListeningMode[]
  lastAt: string | null
  createdAt: string | null
}

export interface ListeningAttempt {
  id: number
  trackId: string
  mode: ListeningMode
  correct: number
  total: number
  accuracy: number | null
  speed: number
  createdAt: string
}

export interface TrackDetail {
  track: ListeningTrack
  summary: TrackSummary
  history: ListeningAttempt[]
  /** Deterministic gap-fill version of every line (same order as track.lines). */
  gaps: GapLine[]
}

export interface ListeningSubmitResult {
  attempt: ListeningAttempt
  reward: Reward
  skill: SkillLevel
  /** Minutes credited to the activity log. */
  minutes: number
}

// ---------- dictation / gap-fill checking ----------

export type DiffStatus = 'ok' | 'typo' | 'missing' | 'wrong' | 'extra'

export interface DiffToken {
  status: DiffStatus
  /** Expected word (normalised); null for an extra typed word. */
  expected: string | null
  /** What the learner typed for this slot; null for a missing word. */
  typed: string | null
}

export interface DictationCheck {
  /** True when every expected word is present (typos allowed) and nothing extra was typed. */
  accepted: boolean
  /** True when the answer matches exactly after normalisation. */
  perfect: boolean
  /** Share of expected words typed correctly (typos count as correct), 0..1. */
  accuracy: number
  /** Strict word accuracy from @core/text compareWords (no typo tolerance), 0..1. */
  strictAccuracy: number
  tokens: DiffToken[]
}

export interface GapBlank {
  /** Token index in `tokens`. */
  index: number
  /** Word to type (letters and apostrophes only). */
  answer: string
  /** Punctuation that stays visible around the blank. */
  before: string
  after: string
}

export interface GapLine {
  tokens: string[]
  blanks: GapBlank[]
}

export type GapResult = 'ok' | 'typo' | 'wrong'

// ---------- channels ----------

const TrackId = z
  .string()
  .regex(/^[a-z0-9-]+$/)
  .max(120)

const LineResultSchema = z.object({
  line: z.number().int().min(0).max(500),
  accuracy: z.number().min(0).max(1),
  attempts: z.number().int().min(0).max(100),
  revealed: z.boolean().optional(),
})

export const ListeningSubmitSchema = z
  .object({
    trackId: TrackId,
    mode: z.enum(LISTENING_MODES),
    correct: z.number().int().min(0).max(1000),
    total: z.number().int().min(1).max(1000),
    speed: z.number().min(0.5).max(1.5).default(1),
    /** Time actually spent on the stage (renderer stopwatch). */
    durationSec: clampedNumber(0, 7200).optional(),
    lines: z.array(LineResultSchema).max(200).optional(),
  })
  .refine((v) => v.correct <= v.total, { message: 'correct must not exceed total' })

export const listeningContract = {
  'listening:list': channel<TrackSummary[]>()(
    z
      .object({
        cefr: CefrSchema.optional(),
        topic: z.string().max(60).optional(),
        accent: AccentSchema.optional(),
        source: z.enum(['builtin', 'ai']).optional(),
        status: z.enum(['new', 'done', 'favorite']).optional(),
      })
      .optional(),
  ),
  'listening:get': channel<TrackDetail>()(z.object({ id: TrackId })),
  'listening:submit': channel<ListeningSubmitResult>()(ListeningSubmitSchema),
  'listening:history': channel<ListeningAttempt[]>()(
    z.object({ trackId: TrackId.optional(), limit: z.number().int().min(1).max(200).optional() }).optional(),
  ),
  'listening:generate': channel<TrackSummary>()(
    z.object({
      cefr: CefrSchema,
      topic: z.string().trim().min(2).max(60),
      accent: AccentSchema,
      kind: z.enum(['dialogue', 'monologue', 'announcement']).default('dialogue'),
    }),
  ),
  'listening:deleteGenerated': channel<null>()(z.object({ id: TrackId })),
  /** Lenient dictation check of one line (word-level diff). */
  'listening:checkLine': channel<DictationCheck>()(
    z.object({ trackId: TrackId, line: z.number().int().min(0).max(500), typed: z.string().max(1000) }),
  ),
  /** Checks the blanks of one gap-fill line, in blank order. */
  'listening:checkGaps': channel<GapResult[]>()(
    z.object({
      trackId: TrackId,
      line: z.number().int().min(0).max(500),
      answers: z.array(z.string().max(80)).max(20),
    }),
  ),
} satisfies Record<`listening:${string}`, ChannelDef>
