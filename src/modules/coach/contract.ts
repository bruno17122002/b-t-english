// IPC contract of the coach module (channels 'coach:*'): habit tracking, analytics, AI advice reports,
// notification schedules and habit Q&A.
import { z } from 'zod'
import { channel, NoInput } from '@shared/ipc'
import type {
  ApplyPlanResult,
  AskResult,
  CoachOverview,
  CoachReport,
  CoachReportSummary,
  ScheduleState,
  SendTestResult,
  TrackResult,
} from './types'

export const PeriodSchema = z.enum(['day', 'week', 'month'])
export const ScheduleKindSchema = z.enum([
  'morningBrief',
  'eveningReminder',
  'dailyReport',
  'weeklyReport',
  'monthlyReport',
])

const TimeSchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/)
const IsoSchema = z.iso.datetime({ offset: true })
const IdSchema = z.string().regex(/^[a-z0-9-]{4,48}$/)

export const ScheduleConfigSchema = z.object({
  enabled: z.boolean(),
  time: TimeSchema,
  channels: z.object({ app: z.boolean(), telegram: z.boolean() }),
  weekday: z.number().int().min(0).max(6).optional(),
  dayOfMonth: z.number().int().min(1).max(28).optional(),
})

export const TrackInputSchema = z.object({
  sessions: z
    .array(
      z.object({
        id: IdSchema,
        startedAt: IsoSchema,
        lastActiveAt: IsoSchema,
        activeSeconds: z.number().min(0).max(86_400),
        idleSeconds: z.number().min(0).max(86_400),
        ended: z.boolean(),
      }),
    )
    .max(20),
  views: z
    .array(
      z.object({
        id: IdSchema,
        sessionId: IdSchema,
        route: z.string().min(1).max(200),
        startedAt: IsoSchema,
        endedAt: IsoSchema,
        activeSeconds: z.number().min(0).max(86_400),
      }),
    )
    .max(300),
})

export const coachContract = {
  'coach:track': channel<TrackResult>()(TrackInputSchema),
  'coach:overview': channel<CoachOverview>()(
    z.object({ period: PeriodSchema, offset: z.number().int().min(-120).max(0).default(0) }),
  ),
  'coach:reports': channel<CoachReportSummary[]>()(
    z.object({ period: PeriodSchema.optional(), limit: z.number().int().min(1).max(200).optional() }).optional(),
  ),
  'coach:report': channel<CoachReport>()(z.object({ id: z.number().int().positive() })),
  'coach:generateReport': channel<CoachReport>()(
    z.object({
      period: PeriodSchema,
      offset: z.number().int().min(-120).max(0).default(0),
      useAi: z.boolean().default(true),
    }),
  ),
  'coach:askHabits': channel<AskResult>()(
    z.object({ question: z.string().trim().min(2).max(500), period: PeriodSchema.default('week') }),
  ),
  'coach:qaHistory': channel<AskResult[]>()(NoInput),
  'coach:schedules': channel<ScheduleState>()(NoInput),
  'coach:updateSchedules': channel<ScheduleState>()(
    z.partialRecord(ScheduleKindSchema, ScheduleConfigSchema.partial()),
  ),
  'coach:sendTest': channel<SendTestResult>()(z.object({ channel: z.enum(['app', 'telegram']) })),
  'coach:applyPlan': channel<ApplyPlanResult>()(z.object({ reportId: z.number().int().positive() })),
}
