// AI prompts of the coach module: habit advice reports, morning brief, evening nudge and habit Q&A.
// Mocks reuse the rule-based texts, so they are deterministic and always valid.
import { z } from 'zod'
import { JSON_ONLY, jsonPrompt, textPrompt } from '../../../main/kernel/ai/prompt'
import type { CoachAdvice, HabitStats } from '../types'
import { hourLabel } from './analytics'
import { type BriefInput, type NudgeInput } from './advice'

const PLAN_MODULES = [
  'listening',
  'speaking',
  'reading',
  'writing',
  'grammar',
  'vocabulary',
  'cinema',
  'tutor',
] as const
/**
 * Lenient text field: models sometimes answer `{ "time": …, "reason": … }` instead of a string, or run a little
 * long. Flatten and cut instead of rejecting the whole report.
 */
const text = (max: number) =>
  z
    .preprocess(
      (v) =>
        v && typeof v === 'object' && !Array.isArray(v)
          ? Object.values(v)
              .filter((x) => typeof x === 'string' || typeof x === 'number')
              .join(' – ')
          : v,
      z.string().trim().min(1),
    )
    .transform((s) => s.slice(0, max))

export const AdviceSchema = z.object({
  headline: text(200),
  summary: text(1200),
  strengths: z.array(text(300)).max(6),
  concerns: z.array(text(300)).max(6),
  recommendations: z
    .array(
      z.object({
        title: text(120),
        why: text(400),
        action: text(400),
        route: text(80),
        minutes: z.number().int().min(1).max(180),
      }),
    )
    .min(1)
    .max(6),
  bestStudyTimes: z.array(text(120)).max(4),
  nextPeriodPlan: z
    .array(
      z.object({
        day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        focus: text(160),
        modules: z.array(z.enum(PLAN_MODULES)).min(1).max(3),
        activities: z.array(text(200)).min(1).max(4),
        minutes: z.number().int().min(5).max(180),
      }),
    )
    .min(1)
    .max(7),
  motivation: text(400),
  ieltsOutlook: text(600),
}) satisfies z.ZodType<CoachAdvice>

/** Compact, token-friendly view of the statistics for prompts. */
export function compactStats(s: HabitStats) {
  return {
    period: s.period,
    label: s.label.en,
    from: s.from,
    to: s.to,
    elapsedDays: s.elapsedDays,
    activeDays: s.activeDays,
    studyMinutes: s.studyMinutes,
    appMinutes: s.appMinutes,
    dailyGoalMinutes: s.dailyGoalMinutes,
    goalRate: s.goalRate,
    studySessions: { count: s.studySessions.count, medianMinutes: s.studySessions.medianMinutes },
    appSessions: { count: s.appSessions.count, medianMinutes: s.appSessions.medianMinutes },
    preferredHours: s.preferredHours.map(hourLabel),
    preferredWeekdays: s.preferredWeekdays.map((d) => ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'][d]),
    skillMix: Object.fromEntries(s.skillMix.map((m) => [m.skill, m.minutes])),
    moduleMix: s.moduleMix
      .slice(0, 8)
      .map((m) => `${m.module}: ${m.studyMinutes} min studied, ${m.appMinutes} min open`),
    weakestSkills: s.weakestSkills,
    weakSkillShare: s.weakSkillShare,
    avgScore: s.avgScore,
    reviews: s.reviews,
    reviewAccuracy: s.reviewAccuracy,
    wordsSaved: s.wordsSaved,
    reviewBacklog: s.reviewBacklog,
    plan: s.plan,
    quests: s.quests,
    streak: s.streak,
    consistency: s.consistency,
    reminders: s.reminders,
    anomalies: s.anomalies.map((a) => a.en),
    deltas: s.deltas
      ? Object.fromEntries(Object.entries(s.deltas).map(([k, d]) => [k, `${d.previous} → ${d.current}`]))
      : null,
  }
}

export interface AdvicePromptInput {
  stats: HabitStats
  planDates: string[]
  targetIelts: number | null
  skills: { skill: string; cefr: string }[]
  /** Rule-based advice: the mock answer and a reference the AI may improve on. */
  offline: CoachAdvice
}

const COACH_ROLE =
  'You are an expert, warm English-learning coach for a Vietnamese adult preparing for IELTS (goal band 6.5). ' +
  'You analyse the learner’s real study-habit data and give concrete, actionable advice. Never invent numbers that are not in the data.'
const VI_FIRST =
  'Write every text field primarily in Vietnamese (tiếng Việt có dấu), addressing the learner as "bạn"; keep English terms like IELTS Band in English.'

export const advicePrompt = jsonPrompt<AdvicePromptInput, CoachAdvice>({
  id: 'coach.advice',
  version: 1,
  temperature: 0.5,
  maxOutputTokens: 3000,
  schema: AdviceSchema,
  build: (input, ctx) => ({
    system: [
      COACH_ROLE,
      ctx.learnerLine,
      VI_FIRST,
      ctx.languageInstruction,
      'Output fields: headline (≤ 15 words), summary (3–4 sentences interpreting the numbers and the changes vs the previous period), ' +
        'strengths[] and concerns[] (habit-based, 1–5 items each), recommendations[] (2–5 items: title, why (cite the data), action (specific, doable today), ' +
        'route (one of /listening /speaking /reading /writing /grammar /vocabulary /vocabulary/review /cinema /tutor /journey /coach/schedule), minutes), ' +
        'bestStudyTimes[] (plain strings such as "19:00–21:00 – lý do", based on preferredHours), ' +
        `nextPeriodPlan[] (exactly one entry for each of these dates: ${input.planDates.join(', ')}; ` +
        'fields day, focus, modules (1–3 of listening, speaking, reading, writing, grammar, vocabulary, cinema, tutor; prioritise the weakest skills), ' +
        'activities (1–4 short items), minutes (close to the daily goal)), motivation (1–2 sentences), ieltsOutlook (realistic, 1–3 sentences).',
      JSON_ONLY,
    ].join('\n'),
    messages: [
      {
        role: 'user',
        content: JSON.stringify({
          habitStats: compactStats(input.stats),
          skillLevels: input.skills,
          targetIelts: input.targetIelts ?? 6.5,
          ruleBasedDraft: { headline: input.offline.headline, concerns: input.offline.concerns },
        }),
      },
    ],
  }),
  check: (input, out) => {
    const bad = out.nextPeriodPlan.find((d) => !input.planDates.includes(d.day))
    if (bad) return `nextPeriodPlan.day must be one of ${input.planDates.join(', ')} (got ${bad.day})`
    return null
  },
  mock: (input) => input.offline,
})

export const morningBriefPrompt = textPrompt<BriefInput & { fallback: string }>({
  id: 'coach.morningBrief',
  version: 1,
  temperature: 0.7,
  maxOutputTokens: 400,
  build: (input, ctx) => ({
    system: [
      COACH_ROLE,
      ctx.learnerLine,
      VI_FIRST,
      'Write a short, energising morning brief (2–4 sentences, ≤ 60 words, plain text, no markdown): greet, mention yesterday, ' +
        'what to do today (use the plan), the best time to study based on the habit data, and one tiny motivating fact.',
    ].join('\n'),
    messages: [{ role: 'user', content: JSON.stringify({ ...input, fallback: undefined }) }],
  }),
  mock: (input) => input.fallback,
})

export const eveningNudgePrompt = textPrompt<NudgeInput & { fallback: string }>({
  id: 'coach.eveningNudge',
  version: 1,
  temperature: 0.7,
  maxOutputTokens: 200,
  build: (input, ctx) => ({
    system: [
      COACH_ROLE,
      ctx.learnerLine,
      VI_FIRST,
      'The learner has not studied today. Write ONE friendly reminder (≤ 30 words, plain text) tailored to the habit data, e.g. ' +
        '"Bạn thường học lúc 21:00 – 15 phút luyện nghe tối nay nhé?". Mention the suggested activity and minutes.',
    ].join('\n'),
    messages: [{ role: 'user', content: JSON.stringify({ ...input, fallback: undefined }) }],
  }),
  mock: (input) => input.fallback,
})

export interface AskPromptInput {
  question: string
  stats: HabitStats
  profile: HabitStats
  fallback: string
}

export const askHabitsPrompt = textPrompt<AskPromptInput>({
  id: 'coach.askHabits',
  version: 1,
  temperature: 0.5,
  maxOutputTokens: 900,
  build: (input, ctx) => ({
    system: [
      COACH_ROLE,
      ctx.learnerLine,
      VI_FIRST,
      ctx.languageInstruction,
      'Answer the learner’s question about their study habits using ONLY the data provided (the selected period and the last 28 days). ' +
        'Be specific (cite numbers), then give 1–3 concrete next steps. Plain text, short paragraphs or "- " bullets, ≤ 180 words.',
    ].join('\n'),
    messages: [
      {
        role: 'user',
        content: `Data: ${JSON.stringify({ period: compactStats(input.stats), last28Days: compactStats(input.profile) })}\n\nQuestion: ${input.question}`,
      },
    ],
  }),
  mock: (input) => input.fallback,
})
