// AI prompts of the journey module: personalised roadmap and placement estimates for writing/speaking.
// Every prompt has a deterministic mock (used in E2E runs) that is valid against its schema.
import { z } from 'zod'
import { CefrSchema, type Cefr } from '@shared/content'
import { SKILLS } from '@shared/types'
import { buildOfflineRoadmap, type RoadmapInput } from '@core/roadmap'
import { textMetrics } from '@core/text'
import { JSON_ONLY, jsonPrompt } from '../../../main/kernel/ai/prompt'
import { heuristicSpeakingCefr } from './logic'

const SkillSchema = z.enum(SKILLS)
const shortList = (max: number) => z.array(z.string().min(1).max(300)).min(1).max(max)

// ---------- roadmap ----------
export const RoadmapAiSchema = z.object({
  summary: z.object({
    headline: z.string().min(1).max(200),
    shortTermGoals: shortList(5),
    longTermGoals: shortList(5),
    prioritySkills: z.array(SkillSchema).min(1).max(3),
    milestones: z
      .array(
        z.object({
          title: z.string().min(1).max(160),
          week: z.number().int().min(1).max(520),
          cefr: CefrSchema.optional(),
        }),
      )
      .max(8),
    projection: z.object({
      currentCefr: CefrSchema,
      targetCefr: CefrSchema,
      hoursNeeded: z.number().min(0).max(5000),
      estimatedWeeks: z.number().min(0).max(1000),
      note: z.string().max(400),
    }),
    dailyRoutine: z
      .array(
        z.object({
          skill: z.enum([...SKILLS, 'cinema', 'review']),
          minutes: z.number().int().min(1).max(120),
          activity: z.string().min(1).max(160),
        }),
      )
      .min(2)
      .max(6),
    interestThemes: z.array(z.string().min(1).max(60)).min(1).max(8),
  }),
  weeks: z
    .array(
      z.object({
        weekIndex: z.number().int().min(1).max(12),
        theme: z.string().min(1).max(120),
        focusSkills: z.array(SkillSchema).min(1).max(3),
        objectives: z.array(z.string().min(1).max(200)).min(3).max(7),
      }),
    )
    .length(12),
})
export type RoadmapAiOutput = z.infer<typeof RoadmapAiSchema>

export interface RoadmapPromptInput extends RoadmapInput {
  targetIelts: number | null
  learningStyle: string
  /** Deterministic projection (guided learning hours) the AI must respect. */
  projection: {
    currentCefr: Cefr
    hoursNeeded: number
    estimatedWeeks: number
    milestones: { cefr: Cefr; week: number }[]
  }
}

export const roadmapPrompt = jsonPrompt<RoadmapPromptInput, RoadmapAiOutput>({
  id: 'journey.roadmap',
  version: 1,
  temperature: 0.5,
  maxOutputTokens: 4000,
  schema: RoadmapAiSchema,
  build: (input, ctx) => ({
    system: [
      'You are an expert English learning coach who designs study plans for Vietnamese adults going from zero English to IELTS 6.5 (CEFR B2).',
      ctx.learnerLine,
      ctx.languageInstruction,
      'Design a realistic, motivating 12-week roadmap personalised to the learner profile below.',
      'Rules:',
      '- Keep the projection numbers exactly as given (they come from guided-learning-hour estimates); you may rephrase the note.',
      '- prioritySkills: the 2–3 weakest or most important skills for the learner goals.',
      '- Each week: a theme drawn from the learner interests, 1–3 focusSkills, 4–6 concrete, measurable objectives that use the app features',
      '  (Vocabulary bank & flashcards, Grammar Kingdom, Listening Lab dictation, Speaking shadowing/role-play, Reading Adventure, Writing Workshop, Cinema Mode stories, AI Tutor).',
      '- Progress gradually: weeks 1–4 build habits and foundations, 5–8 widen range, 9–12 consolidate and test (mini mock tasks).',
      '- dailyRoutine minutes must add up to the learner daily minutes.',
      '- Milestones: one per CEFR level step using the given weeks, plus optional habit milestones.',
      'Output fields: { summary: { headline, shortTermGoals[], longTermGoals[], prioritySkills[], milestones[{title, week, cefr?}],',
      '  projection{currentCefr, targetCefr, hoursNeeded, estimatedWeeks, note}, dailyRoutine[{skill (one of vocabulary|grammar|reading|listening|writing|speaking|cinema|review), minutes, activity}], interestThemes[] },',
      '  weeks: [12 × { weekIndex (1..12), theme, focusSkills[], objectives[] }] }',
      JSON_ONLY,
    ].join('\n'),
    messages: [
      {
        role: 'user',
        content: JSON.stringify({
          name: input.displayName || 'Learner',
          dailyMinutes: input.dailyMinutes,
          learningStyle: input.learningStyle,
          targetCefr: input.targetCefr,
          targetIelts: input.targetIelts,
          purposes: input.purposes,
          interests: input.interests,
          skills: input.skills,
          projection: input.projection,
          grammarTopicsInOrder: input.grammarTopics.slice(0, 24).map((g) => `${g.cefr} ${g.title}`),
        }),
      },
    ],
  }),
  mock: (input) => {
    const offline = buildOfflineRoadmap(input)
    return {
      summary: { ...offline.summary, headline: `${offline.summary.headline} (personalised)` },
      weeks: offline.weeks.map((w) => ({
        weekIndex: w.weekIndex,
        theme: w.theme,
        focusSkills: w.focusSkills,
        objectives: w.objectives,
      })),
    }
  },
})

// ---------- placement: writing ----------
export const PlacementEstimateSchema = z.object({
  cefr: CefrSchema,
  score: z.number().min(0).max(100),
  strengths: z.array(z.string().min(1).max(240)).max(4),
  improvements: z.array(z.string().min(1).max(240)).max(4),
  comment: z.string().min(1).max(600),
})
export type PlacementEstimate = z.infer<typeof PlacementEstimateSchema>

export const writingPlacementPrompt = jsonPrompt<{ task: string; text: string }, PlacementEstimate>({
  id: 'journey.placement.writing',
  version: 1,
  skill: 'writing',
  temperature: 0.2,
  schema: PlacementEstimateSchema,
  build: (input, ctx) => ({
    system: [
      'You are a certified CEFR writing examiner. Estimate the CEFR level (A1–C2) of a short placement text written by a Vietnamese learner.',
      'Judge range, accuracy, cohesion and task completion. A short text cannot show C1/C2 unless it is clearly sophisticated and accurate.',
      'score (0–100) = how secure the learner is inside that level.',
      'strengths and improvements: up to 3 short items each. comment: 1–2 encouraging sentences.',
      ctx.languageInstruction,
      'Fields: cefr, score, strengths[], improvements[], comment.',
      JSON_ONLY,
    ].join('\n'),
    messages: [{ role: 'user', content: `Task: ${input.task}\n\nLearner text:\n"""${input.text.slice(0, 3000)}"""` }],
  }),
  mock: (input) => {
    const m = textMetrics(input.text)
    return {
      cefr: m.heuristicCefr,
      score: 55,
      strengths: ['Clear ideas'],
      improvements: ['Use more linking words'],
      comment: 'Good start – keep writing a little every day.',
    }
  },
})

// ---------- placement: speaking ----------
export const speakingPlacementPrompt = jsonPrompt<
  { task: string; transcript: string; durationSec: number; wordsPerMinute: number | null },
  PlacementEstimate
>({
  id: 'journey.placement.speaking',
  version: 1,
  skill: 'speaking',
  temperature: 0.2,
  schema: PlacementEstimateSchema,
  build: (input, ctx) => ({
    system: [
      'You are a CEFR speaking examiner. You receive an automatic transcript of a short spoken answer by a Vietnamese learner,',
      'plus its duration and speaking rate. Estimate the CEFR speaking level (A1–C2) from range, accuracy, fluency and coherence.',
      'Transcripts lose pronunciation detail, so be cautious and never go above what the transcript clearly shows.',
      'score (0–100) = security inside the level. strengths/improvements: up to 3 short items. comment: 1–2 encouraging sentences.',
      ctx.languageInstruction,
      'Fields: cefr, score, strengths[], improvements[], comment.',
      JSON_ONLY,
    ].join('\n'),
    messages: [
      {
        role: 'user',
        content: `Task: ${input.task}\nDuration: ${Math.round(input.durationSec)} s, rate: ${input.wordsPerMinute ?? 'unknown'} wpm\nTranscript:\n"""${input.transcript.slice(0, 3000)}"""`,
      },
    ],
  }),
  mock: (input) => {
    const m = textMetrics(input.transcript)
    return {
      cefr: heuristicSpeakingCefr(m.heuristicCefr, input.wordsPerMinute, m.words),
      score: 50,
      strengths: ['You kept talking'],
      improvements: ['Add examples to your answer'],
      comment: 'Nice effort – speaking every day will make you more fluent.',
    }
  },
})
