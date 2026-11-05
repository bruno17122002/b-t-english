// Server notification scheduler, called by pg_cron every 5 minutes. For every user with notification_schedules and a
// linked Telegram chat it computes the due occurrences in the learner's time zone (same rules and catch-up windows
// as the desktop coach scheduler), claims each one in notification_log (so overlapping runs never double-send) and
// sends the morning brief, the evening reminder (skipped when the learner already studied today) or a report.
import { buildReport } from './bot.ts'
import {
  aiEveningNudge,
  aiMorningBrief,
  offlineEveningNudge,
  offlineMorningBrief,
  reportHtml,
  type BriefInput,
  type NudgeInput,
} from './coach.ts'
import { addDays, computeStreak, dateKeyIn } from './dates.ts'
import { esc } from './format.ts'
import { AiError, type AiModel } from './gemini.ts'
import { profile28 } from './habits.ts'
import {
  activeDays,
  dueCount,
  learnerLine,
  loadLearner,
  loadTimezone,
  minutesOn,
  studiedOn,
  todayLessons,
  type LearnerData,
} from './learner.ts'
import { PendingStore } from './pending.ts'
import { DailyLimitError, type AiQuota } from './quota.ts'
import { inList, type SupabaseRest, type UserRest } from './rest.ts'
import { dueSchedules, parsePushedSchedules, reportTarget, type DueSchedule, type ScheduleKind } from './schedule.ts'
import type { TelegramBot, TelegramButton } from './telegram.ts'

export interface SchedulerDeps {
  rest: SupabaseRest
  tg: TelegramBot
  ai: AiModel | null
  quota: AiQuota
  now?: () => Date
  log?: (msg: string) => void
}

export interface SchedulerResult {
  users: number
  runs: {
    userId: string
    kind: ScheduleKind
    key: string
    catchUp: boolean
    result: 'sent' | 'skipped' | 'error' | 'claimed'
  }[]
}

interface Message {
  html: string
  buttons?: TelegramButton[][]
}

export function briefInput(d: LearnerData, now: Date): BriefInput {
  const today = dateKeyIn(now, d.timezone)
  const habit = profile28(d, now)
  return {
    name: d.profile.displayName,
    todayPlan: todayLessons(d, today)
      .filter((l) => l.status === 'todo')
      .map((l) => ({ title: l.title, module: l.module, minutes: l.estimated_minutes })),
    dueCards: dueCount(d, now),
    streak: computeStreak(activeDays(d), today).current,
    preferredHour: habit.preferredHours[0] ?? null,
    yesterdayMinutes: Math.round(minutesOn(d, addDays(today, -1))),
    weakestSkill: habit.weakestSkills[0] ?? null,
    dailyGoalMinutes: d.profile.dailyMinutes,
  }
}

export function nudgeInput(d: LearnerData, now: Date): NudgeInput {
  const today = dateKeyIn(now, d.timezone)
  const habit = profile28(d, now)
  const weak = habit.weakestSkills[0] ?? null
  return {
    minutesToday: Math.round(minutesOn(d, today)),
    preferredHour: habit.preferredHours[0] ?? null,
    streak: computeStreak(activeDays(d), today).current,
    weakestSkill: weak,
    dueCards: dueCount(d, now),
    suggestion: {
      skill: weak ?? 'listening',
      minutes: Math.max(10, Math.min(20, Math.round(d.profile.dailyMinutes * 0.75))),
    },
  }
}

async function aiText(fn: () => Promise<string>, fallback: string, log: (m: string) => void): Promise<string> {
  try {
    return (await fn()) || fallback
  } catch (err) {
    if (!(err instanceof AiError) && !(err instanceof DailyLimitError)) throw err
    log(`scheduler AI text failed: ${err instanceof AiError ? err.code : 'quota'}`)
    return fallback
  }
}

/** Builds the message of one due schedule, or null when it should be skipped. */
export async function buildMessage(
  due: DueSchedule,
  d: LearnerData,
  now: Date,
  ai: AiModel | null,
  pending: PendingStore,
  userId: string,
  log: (m: string) => void = () => undefined,
): Promise<Message | null> {
  const reviewButton = (): TelegramButton[] => {
    const n = dueCount(d, now)
    return n ? [{ text: `🃏 Ôn ${n} thẻ`, data: 'review:start' }] : []
  }
  if (due.kind === 'morningBrief') {
    const input = briefInput(d, now)
    const fallback = offlineMorningBrief(input)
    const text = ai ? await aiText(() => aiMorningBrief(ai, input, learnerLine(d)), fallback, log) : fallback
    return {
      html: `<b>☀️ Chào buổi sáng!</b>\n${esc(text)}`,
      buttons: [[{ text: 'Kế hoạch ngày mai / hôm nay', data: 'coach:plan' }], reviewButton()],
    }
  }
  if (due.kind === 'eveningReminder') {
    if (studiedOn(d, dateKeyIn(now, d.timezone))) return null
    const input = nudgeInput(d, now)
    const fallback = offlineEveningNudge(input)
    const text = ai ? await aiText(() => aiEveningNudge(ai, input, learnerLine(d)), fallback, log) : fallback
    return {
      html: `<b>⏰ Nhắc học</b>\n${esc(text)}`,
      buttons: [[{ text: 'Thói quen của tôi', data: 'coach:habits' }], reviewButton()],
    }
  }
  const target = reportTarget(due.kind, due.day)
  if (!target) return null
  const report = await buildReport(d, target.period, now, ai, target.ref, log)
  const pid = await pending.put(userId, 'report', report)
  return { html: reportHtml(report), buttons: [[{ text: 'Xem lời khuyên chi tiết', data: `coach:advice:${pid}` }]] }
}

export async function runScheduler(deps: SchedulerDeps): Promise<SchedulerResult> {
  const now = (deps.now ?? (() => new Date()))()
  const log = deps.log ?? (() => undefined)
  const pending = new PendingStore(deps.rest, () => now)
  const result: SchedulerResult = { users: 0, runs: [] }
  const schedules = await deps.rest.select<{ user_id: string; data: unknown }>('notification_schedules', [], {
    select: 'user_id,data',
    limit: 5000,
  })
  if (!schedules.length) return result
  const links = await deps.rest.select<{ user_id: string; chat_id: number }>(
    'telegram_links',
    [['user_id', inList(schedules.map((s) => s.user_id))]],
    { select: 'user_id,chat_id', limit: 5000 },
  )
  const chatOf = new Map(links.map((l) => [l.user_id, l.chat_id]))
  for (const row of schedules) {
    const chatId = chatOf.get(row.user_id)
    if (chatId === undefined) continue
    result.users++
    try {
      await runForUser(deps, row.user_id, chatId, row.data, now, pending, result, log)
    } catch (err) {
      log(`scheduler user failed: ${err instanceof Error ? err.message : String(err)}`.slice(0, 300))
    }
  }
  await pending.cleanup().catch(() => undefined)
  return result
}

async function runForUser(
  deps: SchedulerDeps,
  userId: string,
  chatId: number,
  data: unknown,
  now: Date,
  pending: PendingStore,
  result: SchedulerResult,
  log: (m: string) => void,
): Promise<void> {
  const user: UserRest = deps.rest.forUser(userId)
  const parsed = parsePushedSchedules(data)
  const tz = await loadTimezone(user, parsed.timezone)
  const logRows = await user.select<{ kind: string; period_key: string }>(
    'notification_log',
    [['sent_at', `gte.${new Date(now.getTime() - 40 * 86_400_000).toISOString()}`]],
    { select: 'kind,period_key', limit: 1000 },
  )
  const sent = new Set(logRows.map((r) => `${r.kind}:${r.period_key}`))
  const due = dueSchedules(now, parsed.schedules, sent, tz)
  if (!due.length) return
  let learner: LearnerData | null = null
  for (const occ of due) {
    // Claim first: a concurrent or later run sees the row and never sends twice.
    const claimed = await user.insert(
      'notification_log',
      [{ kind: occ.kind, period_key: occ.key, sent_at: now.toISOString() }],
      {
        onConflict: 'user_id,kind,period_key',
        resolution: 'ignore',
        returning: true,
      },
    )
    if (!claimed.length) {
      result.runs.push({ userId, kind: occ.kind, key: occ.key, catchUp: occ.catchUp, result: 'claimed' })
      continue
    }
    try {
      learner ??= await loadLearner(user, now, { timezone: tz, skipVocab: true, sinceDays: 100 })
      const ai = deps.ai ? deps.quota.metered(deps.ai, userId, dateKeyIn(now, tz)) : null
      const msg = await buildMessage(occ, learner, now, ai, pending, userId, log)
      if (!msg) {
        result.runs.push({ userId, kind: occ.kind, key: occ.key, catchUp: occ.catchUp, result: 'skipped' })
        continue
      }
      await deps.tg.sendMessage(
        chatId,
        msg.html,
        msg.buttons?.filter((r) => r.length),
      )
      result.runs.push({ userId, kind: occ.kind, key: occ.key, catchUp: occ.catchUp, result: 'sent' })
      log(`schedule ${occ.kind} ${occ.key}${occ.catchUp ? ' (catch-up)' : ''}: sent`)
    } catch (err) {
      result.runs.push({ userId, kind: occ.kind, key: occ.key, catchUp: occ.catchUp, result: 'error' })
      log(`schedule ${occ.kind} failed: ${err instanceof Error ? err.message : String(err)}`.slice(0, 300))
    }
  }
}
