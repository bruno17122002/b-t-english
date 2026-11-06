// IPC contract for the journey module (channels 'journey:*') and the output types shared by main and renderer.
import { z } from 'zod'
import { channel, clampedNumber, NoInput, type ChannelDef } from '@shared/ipc'
import type { Cefr } from '@shared/content'
import type {
  AssessmentResult,
  AssessmentItemView,
  PlanLesson,
  ProviderId,
  Reward,
  Roadmap,
  Skill,
  SkillLevel,
} from '@shared/types'

export type ObjectiveSkill = 'vocabulary' | 'grammar' | 'reading' | 'listening'

// ---------- Assessment ----------
export interface ProductiveEstimate {
  skill: 'writing' | 'speaking'
  cefr: Cefr
  score: number
  method: 'ai' | 'heuristic'
  note: string
  strengths: string[]
  improvements: string[]
  provider: ProviderId | null
}

export interface AssessmentSession {
  id: number
  startedAt: string
  startLevel: Cefr
  completedAt: string | null
  /** Next objective item, or null once the four objective skills are done. */
  current: AssessmentItemView | null
  progress: { skill: ObjectiveSkill; answered: number; total: number; done: boolean }[]
  answeredTotal: number
  objectiveTotal: number
  writing: ProductiveEstimate | null
  speaking: ProductiveEstimate | null
  aiAvailable: boolean
  tasks: {
    writing: { en: string; vi: string }
    speaking: { en: string; vi: string }
  }
}

export interface AssessmentSummary {
  id: number
  completedAt: string
  overall: Cefr
}

// ---------- Roadmap ----------
export interface RoadmapView extends Roadmap {
  /** 1-based index of the week that contains today (may exceed the number of weeks). */
  currentWeek: number
  /** Set when an AI roadmap was requested but the offline builder had to be used. */
  fallbackReason?: string
}

// ---------- Daily plan ----------
export interface PlanLessonView extends PlanLesson {
  route: string
  skill: Skill | null
  /** True when the plan item was marked done automatically because the activity was done in its module. */
  autoDone: boolean
}

export interface TodayPlan {
  date: string
  lessons: PlanLessonView[]
  doneCount: number
  totalMinutes: number
  doneMinutes: number
}

export interface PlanStatusResult {
  plan: TodayPlan
  reward: Reward | null
}

export interface ContinueItem {
  module: string
  title: string
  route: string
  at: string
}

export interface DashboardData {
  plan: TodayPlan
  roadmap: {
    id: number
    headline: string
    currentWeek: number
    totalWeeks: number
    weekTheme: string | null
    weekObjectives: string[]
    weekFocus: Skill[]
  } | null
  lastAssessment: AssessmentSummary | null
  continue: ContinueItem | null
  tip: { en: string; vi: string }
  dueCards: number
}

// ---------- Course (Sprigo syllabus) ----------
export interface CourseLessonSummary {
  id: string
  order: number
  title: string
  description: string | null
  completed: boolean
}

export interface CourseUnitView {
  id: string
  order: number
  cefr: Cefr
  title: string
  description: string | null
  icon: string | null
  lessons: CourseLessonSummary[]
  completed: number
  total: number
}

export interface CourseLevelView {
  cefr: Cefr
  title: string
  canDo: string | null
  checkpoint: string | null
  units: CourseUnitView[]
  completed: number
  total: number
}

export interface CourseOverview {
  attribution: string
  sourceUrl: string
  license: string
  recommendedLevel: Cefr
  levels: CourseLevelView[]
  completed: number
  total: number
}

export interface CourseWord {
  word: string
  ipa: string | null
  meaningVi: string | null
  saved: boolean
}

export interface CourseLessonDetail {
  id: string
  cefr: Cefr
  title: string
  description: string | null
  order: number
  unit: { id: string; title: string; icon: string | null; lessonCount: number }
  levelTitle: string
  canDo: string | null
  grammar: string[]
  vocabulary: CourseWord[]
  activities: { type: string; count: number; scenario?: string; goal?: string }[]
  completed: boolean
  completedAt: string | null
  prevId: string | null
  nextId: string | null
  relatedGrammar: { id: string; title: string; cefr: Cefr }[]
}

export interface LessonCompleteResult {
  lesson: CourseLessonDetail
  reward: Reward | null
}

export interface SaveWordsResult {
  saved: number
  existing: number
  lesson: CourseLessonDetail
}

// ---------- channels ----------
const AssessmentId = z.number().int().positive()
const LessonId = z
  .string()
  .regex(/^[a-z0-9][a-z0-9-]*$/)
  .max(120)

export const journeyContract = {
  // ---------- dashboard & daily plan ----------
  'journey:dashboard': channel<DashboardData>()(NoInput),
  'journey:today': channel<TodayPlan>()(NoInput),
  'journey:planStatus': channel<PlanStatusResult>()(
    z.object({ id: z.number().int().positive(), status: z.enum(['todo', 'done', 'skipped']) }),
  ),

  // ---------- placement assessment ----------
  'journey:assessmentStart': channel<AssessmentSession>()(z.object({ resume: z.boolean().optional() }).optional()),
  'journey:assessmentState': channel<AssessmentSession>()(z.object({ id: AssessmentId })),
  'journey:assessmentAnswer': channel<AssessmentSession>()(
    z.object({ id: AssessmentId, itemId: z.string().min(1).max(80), choice: z.number().int().min(0).max(5) }),
  ),
  'journey:assessmentWriting': channel<ProductiveEstimate>()(
    z.object({ id: AssessmentId, text: z.string().trim().min(20).max(3000) }),
  ),
  'journey:assessmentSpeaking': channel<ProductiveEstimate>()(
    z.object({
      id: AssessmentId,
      transcript: z.string().trim().min(1).max(3000),
      durationSec: clampedNumber(1, 600),
    }),
  ),
  'journey:assessmentFinish': channel<AssessmentResult>()(z.object({ id: AssessmentId })),
  'journey:assessmentLatest': channel<AssessmentResult | null>()(NoInput),
  'journey:assessmentHistory': channel<AssessmentSummary[]>()(NoInput),
  /** Skips the placement test: skill levels come from the self-reported level. */
  'journey:placementSkip': channel<SkillLevel[]>()(NoInput),

  // ---------- roadmap ----------
  'journey:roadmap': channel<RoadmapView | null>()(NoInput),
  'journey:roadmapGenerate': channel<RoadmapView>()(z.object({ useAi: z.boolean().optional() }).optional()),
  'journey:roadmapWeek': channel<RoadmapView>()(
    z.object({ weekId: z.number().int().positive(), status: z.enum(['upcoming', 'done']) }),
  ),
  'journey:roadmapNotes': channel<RoadmapView>()(z.object({ notes: z.string().max(5000) })),

  // ---------- course (Sprigo syllabus) ----------
  'journey:course': channel<CourseOverview>()(NoInput),
  'journey:courseLesson': channel<CourseLessonDetail>()(z.object({ id: LessonId })),
  'journey:courseComplete': channel<LessonCompleteResult>()(z.object({ id: LessonId, completed: z.boolean() })),
  'journey:courseSaveWords': channel<SaveWordsResult>()(z.object({ id: LessonId })),
} satisfies Record<`journey:${string}`, ChannelDef>
