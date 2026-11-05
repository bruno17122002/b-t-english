// Output types of the coach module shared by main and renderer (types only, no runtime code).
import type { ProviderId, Skill } from '@shared/types'

export type CoachPeriod = 'day' | 'week' | 'month'

export type ScheduleKind = 'morningBrief' | 'eveningReminder' | 'dailyReport' | 'weeklyReport' | 'monthlyReport'

export interface ScheduleChannels {
  app: boolean
  telegram: boolean
}

export interface ScheduleConfig {
  enabled: boolean
  /** Local time "HH:MM". */
  time: string
  channels: ScheduleChannels
  /** Weekly report only: 0 = Sunday … 6 = Saturday. */
  weekday?: number
  /** Monthly report only: day of month 1–28. */
  dayOfMonth?: number
}

export type ScheduleMap = Record<ScheduleKind, ScheduleConfig>

export interface Bilingual {
  en: string
  vi: string
}

export interface Delta {
  current: number
  previous: number
  change: number
  /** Relative change in percent, null when the previous value is 0. */
  pct: number | null
}

export type DeltaKey =
  | 'studyMinutes'
  | 'appMinutes'
  | 'activeDays'
  | 'studySessions'
  | 'avgScore'
  | 'consistency'
  | 'wordsSaved'
  | 'reviews'
  | 'planRate'

export type AnomalyCode =
  | 'long_gap'
  | 'cramming'
  | 'skipping_weak_skill'
  | 'late_night'
  | 'low_plan_completion'
  | 'review_backlog'
  | 'app_without_study'
  | 'no_activity'

export interface HabitAnomaly {
  code: AnomalyCode
  severity: 'info' | 'warning'
  en: string
  vi: string
}

export interface StudySession {
  start: string
  end: string
  minutes: number
  activities: number
}

export interface DailyHabit {
  date: string
  studyMinutes: number
  appMinutes: number
  activities: number
}

export interface HabitStats {
  period: CoachPeriod
  key: string
  label: Bilingual
  from: string
  to: string
  /** Days of the period that have already started (≥ 1). */
  elapsedDays: number
  activeDays: number
  studyMinutes: number
  appMinutes: number
  avgMinutesPerActiveDay: number
  dailyGoalMinutes: number
  /** Studied minutes / (goal × elapsed days), 0..1+. */
  goalRate: number
  appSessions: { count: number; medianMinutes: number; totalMinutes: number }
  studySessions: { count: number; medianMinutes: number; longestMinutes: number; list: StudySession[] }
  firstStudyAt: string | null
  lastStudyAt: string | null
  /** Studied minutes per local hour (0..23). */
  hourHistogram: number[]
  /** Minutes the app was actively used per local hour (0..23). */
  appHourHistogram: number[]
  /** Studied minutes per weekday, Monday first. */
  weekdayMinutes: number[]
  preferredHours: number[]
  /** Monday = 0 … Sunday = 6. */
  preferredWeekdays: number[]
  moduleMix: { module: string; studyMinutes: number; appMinutes: number; activities: number }[]
  skillMix: { skill: Skill; minutes: number; share: number }[]
  weakestSkills: Skill[]
  /** Share of studied minutes spent on the weakest skills (0..1). */
  weakSkillShare: number
  avgScore: number | null
  scoreTrend: { date: string; score: number }[]
  reviews: number
  reviewAccuracy: number | null
  wordsSaved: number
  reviewBacklog: number
  plan: { done: number; total: number; skipped: number; rate: number | null }
  quests: { completed: number; total: number }
  streak: { current: number; longest: number }
  /** 0..100 – active-day ratio plus regularity of start times. */
  consistency: number
  daily: DailyHabit[]
  reminders: { sent: number; followed: number; rate: number | null }
  anomalies: HabitAnomaly[]
  deltas: Record<DeltaKey, Delta> | null
}

export type PlanModule =
  'listening' | 'speaking' | 'reading' | 'writing' | 'grammar' | 'vocabulary' | 'cinema' | 'tutor'

export interface CoachRecommendation {
  title: string
  why: string
  action: string
  route: string
  minutes: number
}

export interface CoachPlanDay {
  /** YYYY-MM-DD */
  day: string
  focus: string
  modules: PlanModule[]
  activities: string[]
  minutes: number
}

export interface CoachAdvice {
  headline: string
  summary: string
  strengths: string[]
  concerns: string[]
  recommendations: CoachRecommendation[]
  bestStudyTimes: string[]
  nextPeriodPlan: CoachPlanDay[]
  motivation: string
  ieltsOutlook: string
}

export type DeliveryChannel = 'app' | 'telegram'

export interface CoachReportSummary {
  id: number
  period: CoachPeriod
  periodKey: string
  label: Bilingual
  headline: string
  source: 'ai' | 'offline'
  provider: ProviderId | null
  createdAt: string
  delivered: DeliveryChannel[]
  appliedAt: string | null
}

export interface CoachReport extends CoachReportSummary {
  stats: HabitStats
  advice: CoachAdvice
  /** Why the offline advice was used although AI was requested. */
  fallbackReason: string | null
}

export interface CoachOverview {
  stats: HabitStats
  latestReport: CoachReportSummary | null
  heatmap: { date: string; minutes: number; xp: number }[]
  aiAvailable: boolean
  today: string
}

export interface ScheduleState {
  schedules: ScheduleMap
  lastSent: Partial<Record<ScheduleKind, string>>
  nextRuns: { kind: ScheduleKind; at: string }[]
  telegramConnected: boolean
  notificationsEnabled: boolean
}

export interface AskResult {
  id: number
  question: string
  answer: string
  source: 'ai' | 'offline'
  provider: ProviderId | null
  createdAt: string
}

export interface ApplyPlanResult {
  created: number
  skipped: number
  dates: string[]
}

export interface SendTestResult {
  ok: boolean
  message: string
}

export interface TrackResult {
  sessions: number
  views: number
}
