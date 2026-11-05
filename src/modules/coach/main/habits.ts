// Habit data of the coach module: stores renderer heartbeats (app sessions and page views) and loads every
// signal for a period (activity_log, review_logs, lessons, quests, reminders) into the pure analytics.
import { addDays, localDateKey, parseDateKey } from '@core/dates'
import type { Skill } from '@shared/types'
import type { Kernel } from '../../../main/kernel'
import { moduleForRoute, type TrackPayload } from '../shared/tracker'
import type { CoachPeriod, HabitStats, TrackResult } from '../types'
import {
  computeHabitStats,
  periodRange,
  withDeltas,
  type HabitInput,
  type PeriodRange,
  type RawActivity,
} from './analytics'

/** Clock skew tolerated between renderer timestamps and the main clock. */
const SKEW_MS = 5 * 60_000

function safe<T>(fn: () => T[]): T[] {
  try {
    return fn()
  } catch {
    return []
  }
}

export class HabitService {
  constructor(private readonly k: Kernel) {}

  today(): string {
    return localDateKey(this.k.now())
  }

  // ---------- tracking ----------
  /**
   * Upserts cumulative snapshots (idempotent: values only grow). Active time is clamped to the wall-clock span
   * so a stuck renderer timer can never inflate it, and timestamps from the future are rejected.
   */
  track(payload: TrackPayload): TrackResult {
    const nowMs = this.k.now().getTime()
    let sessions = 0
    let views = 0
    this.k.db.transaction(() => {
      for (const s of payload.sessions) {
        const start = new Date(s.startedAt).getTime()
        const last = new Date(s.lastActiveAt).getTime()
        if (!(start <= last) || last > nowMs + SKEW_MS) continue
        const span = Math.ceil((last - start) / 1000) + 60
        const active = Math.min(Math.round(s.activeSeconds), span)
        const idle = Math.min(Math.round(s.idleSeconds), Math.ceil((nowMs - start) / 1000) + 60)
        const startDate = new Date(start)
        this.k.db.run(
          `INSERT INTO coach_sessions(id, started_at, last_active_at, date, start_hour, active_seconds, idle_seconds, ended)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET
             last_active_at = MAX(last_active_at, excluded.last_active_at),
             active_seconds = MAX(active_seconds, excluded.active_seconds),
             idle_seconds = MAX(idle_seconds, excluded.idle_seconds),
             ended = MAX(ended, excluded.ended)`,
          [
            s.id,
            startDate.toISOString(),
            new Date(last).toISOString(),
            localDateKey(startDate),
            startDate.getHours(),
            Math.max(0, active),
            Math.max(0, idle),
            s.ended ? 1 : 0,
          ],
        )
        sessions++
      }
      for (const v of payload.views) {
        const start = new Date(v.startedAt).getTime()
        const end = new Date(v.endedAt).getTime()
        if (!(start <= end) || end > nowMs + SKEW_MS) continue
        const active = Math.max(0, Math.min(Math.round(v.activeSeconds), Math.ceil((end - start) / 1000) + 60))
        const startDate = new Date(start)
        this.k.db.run(
          `INSERT INTO coach_views(id, session_id, route, module, started_at, ended_at, date, hour, active_seconds)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET
             ended_at = MAX(ended_at, excluded.ended_at),
             active_seconds = MAX(active_seconds, excluded.active_seconds)`,
          [
            v.id,
            v.sessionId,
            v.route.split('?')[0] ?? '/',
            moduleForRoute(v.route),
            startDate.toISOString(),
            new Date(end).toISOString(),
            localDateKey(startDate),
            startDate.getHours(),
            active,
          ],
        )
        views++
      }
    })
    return { sessions, views }
  }

  // ---------- loading ----------
  private isoBounds(from: string, to: string): [string, string] {
    return [parseDateKey(from).toISOString(), parseDateKey(addDays(to, 1)).toISOString()]
  }

  input(range: PeriodRange): HabitInput {
    const db = this.k.db
    const today = this.today()
    const [isoFrom, isoTo] = this.isoBounds(range.from, range.to)
    const activities = db
      .all<{
        created_at: string
        date: string
        module: string
        action: string
        skill: Skill | null
        minutes: number
        score: number | null
      }>(
        'SELECT created_at, date, module, action, skill, minutes, score FROM activity_log WHERE date >= ? AND date <= ? ORDER BY id',
        [range.from, range.to],
      )
      .map<RawActivity>((r) => ({
        createdAt: r.created_at,
        date: r.date,
        module: r.module,
        action: r.action,
        skill: r.skill,
        minutes: Number(r.minutes) || 0,
        score: r.score === null || r.score === undefined ? null : Number(r.score),
      }))
    const sessions = db
      .all<{ id: string; started_at: string; last_active_at: string; date: string; active_seconds: number }>(
        'SELECT id, started_at, last_active_at, date, active_seconds FROM coach_sessions WHERE date >= ? AND date <= ?',
        [range.from, range.to],
      )
      .map((r) => ({
        id: r.id,
        startedAt: r.started_at,
        lastActiveAt: r.last_active_at,
        date: r.date,
        activeSeconds: Number(r.active_seconds),
      }))
    const views = db
      .all<{ module: string; date: string; hour: number; active_seconds: number }>(
        'SELECT module, date, hour, active_seconds FROM coach_views WHERE date >= ? AND date <= ?',
        [range.from, range.to],
      )
      .map((r) => ({ module: r.module, date: r.date, hour: Number(r.hour), activeSeconds: Number(r.active_seconds) }))
    const reviews = safe(() =>
      db.all<{ reviewed_at: string; rating: number }>(
        'SELECT reviewed_at, rating FROM review_logs WHERE reviewed_at >= ? AND reviewed_at < ?',
        [isoFrom, isoTo],
      ),
    ).map((r) => ({ reviewedAt: r.reviewed_at, rating: Number(r.rating) }))
    const plan = safe(() =>
      db.all<{ date: string; status: 'todo' | 'done' | 'skipped' }>(
        'SELECT date, status FROM lessons WHERE date >= ? AND date <= ?',
        [range.from, range.to],
      ),
    )
    const quests = safe(() =>
      db.all<{ completed_at: string | null }>(
        "SELECT completed_at FROM quests WHERE period = 'daily' AND period_key >= ? AND period_key <= ? AND period_key <= ?",
        [range.from, range.to, today],
      ),
    ).map((q) => ({ completed: !!q.completed_at }))
    const reminders = db
      .all<{ sent_at: string }>(
        "SELECT sent_at FROM coach_notifications WHERE kind IN ('eveningReminder', 'morningBrief') AND channels != '[]' AND sent_at >= ? AND sent_at < ?",
        [isoFrom, isoTo],
      )
      .map((r) => ({ sentAt: r.sent_at }))
    // Activities shortly after the period end still count as following a late reminder.
    const after = db
      .all<{ created_at: string }>('SELECT created_at FROM activity_log WHERE created_at >= ? AND created_at < ?', [
        isoTo,
        new Date(new Date(isoTo).getTime() + 2 * 3_600_000).toISOString(),
      ])
      .map<RawActivity>((r) => ({
        createdAt: r.created_at,
        date: '9999-12-31',
        module: '',
        action: '',
        skill: null,
        minutes: 0,
        score: null,
      }))
    return {
      range,
      today,
      activities: [...activities, ...after],
      sessions,
      views,
      reviews,
      plan,
      quests,
      reminders,
      allActiveDays: db
        .all<{ date: string }>('SELECT DISTINCT date FROM activity_log WHERE date <= ? ORDER BY date', [range.to])
        .map((r) => r.date),
      reviewBacklog: this.k.vocab.dueCount(),
      skillLevels: this.k.learner.skillLevels().map((s) => ({ skill: s.skill, cefr: s.cefr, score: s.score })),
      dailyGoalMinutes: this.k.learner.profile().dailyMinutes,
    }
  }

  /** Statistics of a period with deltas against the previous period of the same kind. */
  stats(period: CoachPeriod, offset = 0, ref?: string): HabitStats {
    const base = ref ?? this.today()
    const cur = computeHabitStats(this.input(periodRange(period, base, offset)))
    const prev = computeHabitStats(this.input(periodRange(period, base, offset - 1)))
    return withDeltas(cur, prev)
  }

  /** Habit profile over the last 28 days – used for briefs, nudges and Q&A context. */
  profile(): HabitStats {
    const today = this.today()
    const from = addDays(today, -27)
    return computeHabitStats(
      this.input({
        period: 'month',
        key: `last28:${today}`,
        from,
        to: today,
        label: { en: 'Last 28 days', vi: '28 ngày qua' },
      }),
    )
  }

  minutesToday(): number {
    return Number(
      this.k.db.value('SELECT COALESCE(SUM(minutes), 0) FROM activity_log WHERE date = ?', [this.today()]) ?? 0,
    )
  }

  studiedToday(): boolean {
    return Number(this.k.db.value('SELECT COUNT(*) FROM activity_log WHERE date = ?', [this.today()]) ?? 0) > 0
  }
}
