// Coach service: AI / offline advice reports, habit Q&A, morning briefs and evening nudges, schedule storage,
// delivery to Windows notifications + Telegram, and applying AI plans to the `lessons` table.
import type { Cefr } from '@shared/content'
import type { ProviderId, Skill } from '@shared/types'
import { addDays, hashString, localDateKey } from '@core/dates'
import { cefrIndex } from '@core/cefr'
import type { Kernel } from '../../../main/kernel'
import { toAiError } from '../../../main/kernel/ai/gateway'
import type { TelegramButton } from '../../../main/kernel/telegram/port'
import { UserError } from '../../../main/ipc/router'
import type {
  ApplyPlanResult,
  AskResult,
  CoachAdvice,
  CoachOverview,
  CoachPeriod,
  CoachReport,
  CoachReportSummary,
  DeliveryChannel,
  PlanModule,
  ScheduleChannels,
  ScheduleConfig,
  ScheduleKind,
  ScheduleMap,
  ScheduleState,
  SendTestResult,
} from '../types'
import { planDates, skillForModule } from './analytics'
import {
  offlineAdvice,
  offlineEveningNudge,
  offlineHabitAnswer,
  offlineMorningBrief,
  sanitizeRoute,
  SKILL_ROUTE,
  type AdviceContext,
  type BriefInput,
  type NudgeInput,
} from './advice'
import { HabitService } from './habits'
import { advicePrompt, askHabitsPrompt, eveningNudgePrompt, morningBriefPrompt } from './prompts'
import {
  defaultSchedules,
  dueSchedules,
  mergeSchedule,
  nextRuns,
  parseSchedules,
  reportTarget,
  SCHEDULE_KINDS,
  type DueSchedule,
} from './scheduler'
import { adviceHtml, esc, reportHtml } from './telegram'

const SCHEDULES_FLAG = 'coach.schedules'
const LAST_SENT_FLAG = 'coach.lastSent'

interface ReportRow {
  id: number
  period: CoachPeriod
  period_key: string
  label: string
  stats: string
  advice: string
  source: 'ai' | 'offline'
  provider: ProviderId | null
  fallback_reason: string | null
  delivered: string
  applied_at: string | null
  created_at: string
}

const parse = <T>(json: string, fallback: T): T => {
  try {
    return JSON.parse(json) as T
  } catch {
    return fallback
  }
}

export interface OutgoingMessage {
  kind: ScheduleKind | 'test'
  key: string
  title: string
  body: string
  route: string
  html: string
  buttons?: TelegramButton[][]
  reportId?: number
}

export class CoachService {
  readonly habits: HabitService
  private running = false

  constructor(private readonly k: Kernel) {
    this.habits = new HabitService(k)
  }

  private today(): string {
    return localDateKey(this.k.now())
  }

  // ---------- overview ----------
  overview(period: CoachPeriod, offset: number): CoachOverview {
    const stats = this.habits.stats(period, offset)
    const today = this.today()
    const end = stats.to < today ? stats.to : today
    const latest = this.k.db.get<ReportRow>(
      'SELECT * FROM coach_reports WHERE period = ? AND period_key = ? ORDER BY id DESC LIMIT 1',
      [period, stats.key],
    )
    return {
      stats,
      latestReport: latest ? this.toSummary(latest) : null,
      heatmap: this.k.progress.calendar(addDays(end, -7 * 16), end),
      aiAvailable: this.k.ai.isAvailable(),
      today,
    }
  }

  // ---------- reports ----------
  private adviceContext(period: CoachPeriod): AdviceContext {
    const profile = this.k.learner.profile()
    return {
      planDates: planDates(period, this.today()),
      overallCefr: this.k.learner.overallCefr(),
      targetIelts: profile.targetIelts,
      dailyGoalMinutes: profile.dailyMinutes,
      dueCards: this.k.vocab.dueCount(),
    }
  }

  /** Normalises AI output: allowed routes only, plan days restricted to the requested dates. */
  private sanitize(advice: CoachAdvice, ctx: AdviceContext, offline: CoachAdvice): CoachAdvice {
    const seen = new Set<string>()
    const plan = advice.nextPeriodPlan
      .filter((d) => ctx.planDates.includes(d.day) && !seen.has(d.day) && seen.add(d.day))
      .map((d) => ({ ...d, modules: [...new Set(d.modules)] }))
      .sort((a, b) => (a.day < b.day ? -1 : 1))
    return {
      ...advice,
      recommendations: advice.recommendations.map((r) => ({ ...r, route: sanitizeRoute(r.route) })),
      nextPeriodPlan: plan.length ? plan : offline.nextPeriodPlan,
    }
  }

  async generateReport(period: CoachPeriod, offset = 0, useAi = true, ref?: string): Promise<CoachReport> {
    const stats = this.habits.stats(period, offset, ref)
    const ctx = this.adviceContext(period)
    const offline = offlineAdvice(stats, ctx)
    let advice = offline
    let source: 'ai' | 'offline' = 'offline'
    let provider: ProviderId | null = null
    let fallbackReason: string | null = null
    if (useAi && this.k.ai.isAvailable()) {
      try {
        const res = await this.k.ai.run(advicePrompt, {
          stats,
          planDates: ctx.planDates,
          targetIelts: ctx.targetIelts,
          skills: this.k.learner.skillLevels().map((s) => ({ skill: s.skill, cefr: s.cefr })),
          offline,
        })
        advice = this.sanitize(res.data, ctx, offline)
        source = 'ai'
        provider = res.provider
      } catch (err) {
        const e = toAiError(err)
        fallbackReason = e.userMessage
        this.k.log.warn(`coach report AI failed: ${e.code}`)
      }
    } else if (useAi) {
      fallbackReason = 'Chưa cấu hình AI – đang dùng lời khuyên theo quy tắc (offline).'
    }
    const nowIso = this.k.now().toISOString()
    this.k.db.run(
      `INSERT INTO coach_reports(period, period_key, label, stats, advice, source, provider, fallback_reason, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        period,
        stats.key,
        JSON.stringify(stats.label),
        JSON.stringify(stats),
        JSON.stringify(advice),
        source,
        provider,
        fallbackReason,
        nowIso,
      ],
    )
    const id = Number(this.k.db.value('SELECT MAX(id) FROM coach_reports') ?? 0)
    return this.report(id)
  }

  private toSummary(r: ReportRow): CoachReportSummary {
    const advice = parse<Partial<CoachAdvice>>(r.advice, {})
    return {
      id: r.id,
      period: r.period,
      periodKey: r.period_key,
      label: parse(r.label, { en: r.period_key, vi: r.period_key }),
      headline: advice.headline ?? '',
      source: r.source,
      provider: r.provider,
      createdAt: r.created_at,
      delivered: parse<DeliveryChannel[]>(r.delivered, []),
      appliedAt: r.applied_at,
    }
  }

  reports(period?: CoachPeriod, limit = 50): CoachReportSummary[] {
    return this.k.db
      .all<ReportRow>(
        `SELECT * FROM coach_reports ${period ? 'WHERE period = ?' : ''} ORDER BY id DESC LIMIT ?`,
        period ? [period, limit] : [limit],
      )
      .map((r) => this.toSummary(r))
  }

  report(id: number): CoachReport {
    const r = this.k.db.get<ReportRow>('SELECT * FROM coach_reports WHERE id = ?', [id])
    if (!r) throw new UserError('not_found', 'Không tìm thấy báo cáo.')
    const stats = parse<CoachReport['stats'] | null>(r.stats, null)
    const advice = parse<CoachAdvice | null>(r.advice, null)
    // A damaged row (e.g. synced from another device) must not break the reports page.
    if (!stats || !advice) throw new UserError('report_damaged', 'Báo cáo này bị hỏng dữ liệu. Hãy tạo báo cáo mới.')
    return { ...this.toSummary(r), stats, advice, fallbackReason: r.fallback_reason }
  }

  /** Latest report of the period created in the last `maxAgeMin` minutes, or a fresh one. */
  async recentOrGenerate(period: CoachPeriod, maxAgeMin = 180): Promise<CoachReport> {
    const key = this.habits.stats(period, 0).key
    const row = this.k.db.get<{ id: number; created_at: string }>(
      'SELECT id, created_at FROM coach_reports WHERE period = ? AND period_key = ? ORDER BY id DESC LIMIT 1',
      [period, key],
    )
    if (row && this.k.now().getTime() - new Date(row.created_at).getTime() <= maxAgeMin * 60_000)
      return this.report(row.id)
    return this.generateReport(period, 0, true)
  }

  // ---------- apply plan ----------
  private completedRefs(): Set<string> {
    const q = (sql: string) => {
      try {
        return this.k.db.all<{ r: string | null }>(sql).map((x) => x.r ?? '')
      } catch {
        return []
      }
    }
    return new Set(
      [
        ...q('SELECT DISTINCT passage_id AS r FROM reading_history'),
        ...q('SELECT DISTINCT track_id AS r FROM listening_history'),
        ...q('SELECT DISTINCT prompt_id AS r FROM writing_submissions'),
        ...q('SELECT DISTINCT prompt_id AS r FROM speaking_sessions'),
        ...q('SELECT story_id AS r FROM story_progress WHERE completed_at IS NOT NULL'),
        ...q("SELECT DISTINCT content_ref AS r FROM lesson_attempts WHERE module = 'grammar'"),
        ...q("SELECT DISTINCT content_ref AS r FROM lessons WHERE status != 'skipped'"),
      ].filter(Boolean),
    )
  }

  private candidates(module: PlanModule): { id: string; title: string; cefr: Cefr }[] {
    const c = this.k.content
    switch (module) {
      case 'reading':
        return c.reading()
      case 'listening':
        return c.listening()
      case 'grammar':
        return c.grammar()
      case 'cinema':
        return c.stories()
      case 'writing':
        return c.writingPrompts()
      case 'speaking':
        return c.speakingPrompts()
      default:
        return []
    }
  }

  /** Picks unused bundled content closest to the learner's level for that skill (deterministic per date). */
  private pick(module: PlanModule, date: string, used: Set<string>): { ref: string | null; title: string } {
    if (module === 'vocabulary') return { ref: null, title: 'Review due flashcards' }
    if (module === 'tutor') return { ref: null, title: 'Conversation practice with the AI tutor' }
    const skill: Skill = skillForModule(module) ?? 'listening'
    const level = this.k.learner.skillLevels().find((s) => s.skill === skill)?.cefr ?? this.k.learner.overallCefr()
    const items = this.candidates(module)
    const fresh = items.filter((i) => !used.has(i.id))
    const pool = fresh.length ? fresh : items
    const best = [...pool].sort(
      (a, b) =>
        Math.abs(cefrIndex(a.cefr) - cefrIndex(level)) - Math.abs(cefrIndex(b.cefr) - cefrIndex(level)) ||
        hashString(`${date}:${a.id}`) - hashString(`${date}:${b.id}`),
    )[0]
    return best ? { ref: best.id, title: best.title } : { ref: null, title: module }
  }

  applyPlan(reportId: number): ApplyPlanResult {
    const report = this.report(reportId)
    const today = this.today()
    const days = report.advice.nextPeriodPlan.filter((d) => d.day >= today)
    if (!days.length) throw new UserError('plan_expired', 'Kế hoạch này đã qua ngày – hãy tạo báo cáo mới.')
    const used = this.completedRefs()
    const nowIso = this.k.now().toISOString()
    let created = 0
    let skipped = 0
    const dates: string[] = []
    this.k.db.transaction(() => {
      for (const day of days) {
        const existing = this.k.db.all<{ module: string; content_ref: string | null; position: number }>(
          'SELECT module, content_ref, position FROM lessons WHERE date = ?',
          [day.day],
        )
        let position = existing.reduce((n, r) => Math.max(n, r.position + 1), 0)
        const modules = [...new Set(day.modules)].slice(0, 3)
        const minutes = Math.max(5, Math.round(day.minutes / Math.max(1, modules.length)))
        for (const m of modules) {
          // One item per module and day: never duplicates the journey plan or an earlier "apply".
          if (existing.some((r) => r.module === m)) {
            skipped++
            continue
          }
          const { ref, title } = this.pick(m, day.day, used)
          if (ref) used.add(ref)
          this.k.db.run(
            `INSERT INTO lessons(roadmap_id, date, module, title, description, content_ref, estimated_minutes, status, position)
             VALUES (NULL, ?, ?, ?, ?, ?, ?, 'todo', ?)`,
            [
              day.day,
              m,
              title.slice(0, 200),
              `AI Coach · ${day.focus} · ${day.activities.join(' · ')}`.slice(0, 500),
              ref,
              minutes,
              position++,
            ],
          )
          existing.push({ module: m, content_ref: ref, position })
          created++
        }
        dates.push(day.day)
      }
      this.k.db.run('UPDATE coach_reports SET applied_at = ? WHERE id = ?', [nowIso, reportId])
    })
    this.k.push('data-changed', { module: 'journey', what: 'plan' })
    return { created, skipped, dates }
  }

  // ---------- Q&A ----------
  async ask(question: string, period: CoachPeriod): Promise<AskResult> {
    const stats = this.habits.stats(period, 0)
    const fallback = offlineHabitAnswer(question, stats)
    let answer = fallback
    let source: 'ai' | 'offline' = 'offline'
    let provider: ProviderId | null = null
    if (this.k.ai.isAvailable()) {
      try {
        const res = await this.k.ai.run(askHabitsPrompt, { question, stats, profile: this.habits.profile(), fallback })
        answer = res.data.slice(0, 4000)
        source = 'ai'
        provider = res.provider
      } catch (err) {
        this.k.log.warn(`coach ask AI failed: ${toAiError(err).code}`)
      }
    }
    const createdAt = this.k.now().toISOString()
    this.k.db.run('INSERT INTO coach_qa(question, answer, source, provider, created_at) VALUES (?, ?, ?, ?, ?)', [
      question,
      answer,
      source,
      provider,
      createdAt,
    ])
    const id = Number(this.k.db.value('SELECT MAX(id) FROM coach_qa') ?? 0)
    return { id, question, answer, source, provider, createdAt }
  }

  qaHistory(limit = 30): AskResult[] {
    return this.k.db
      .all<{
        id: number
        question: string
        answer: string
        source: 'ai' | 'offline'
        provider: ProviderId | null
        created_at: string
      }>('SELECT * FROM coach_qa ORDER BY id DESC LIMIT ?', [limit])
      .map((r) => ({ ...r, createdAt: r.created_at }))
  }

  // ---------- briefs & nudges ----------
  briefInput(): BriefInput {
    const profile = this.k.learner.profile()
    const habit = this.habits.profile()
    const today = this.today()
    const plan = this.k.db.all<{ title: string; module: string; estimated_minutes: number }>(
      "SELECT title, module, estimated_minutes FROM lessons WHERE date = ? AND status = 'todo' ORDER BY position, id",
      [today],
    )
    return {
      name: profile.displayName,
      todayPlan: plan.map((p) => ({ title: p.title, module: p.module, minutes: p.estimated_minutes })),
      dueCards: this.k.vocab.dueCount(),
      streak: this.k.progress.gameState().streak.current,
      preferredHour: habit.preferredHours[0] ?? null,
      yesterdayMinutes: Math.round(
        Number(
          this.k.db.value('SELECT COALESCE(SUM(minutes), 0) FROM activity_log WHERE date = ?', [addDays(today, -1)]) ??
            0,
        ),
      ),
      weakestSkill: habit.weakestSkills[0] ?? null,
      dailyGoalMinutes: profile.dailyMinutes,
    }
  }

  async morningBrief(): Promise<{ text: string; source: 'ai' | 'offline' }> {
    const input = this.briefInput()
    const fallback = offlineMorningBrief(input)
    if (!this.k.ai.isAvailable()) return { text: fallback, source: 'offline' }
    try {
      const res = await this.k.ai.run(morningBriefPrompt, { ...input, fallback })
      return { text: res.data.slice(0, 700) || fallback, source: 'ai' }
    } catch (err) {
      this.k.log.warn(`coach brief AI failed: ${toAiError(err).code}`)
      return { text: fallback, source: 'offline' }
    }
  }

  nudgeInput(): NudgeInput {
    const habit = this.habits.profile()
    const weak = habit.weakestSkills[0] ?? null
    const goal = this.k.learner.profile().dailyMinutes
    return {
      minutesToday: Math.round(this.habits.minutesToday()),
      preferredHour: habit.preferredHours[0] ?? null,
      streak: this.k.progress.gameState().streak.current,
      weakestSkill: weak,
      dueCards: this.k.vocab.dueCount(),
      suggestion: { skill: weak ?? 'listening', minutes: Math.max(10, Math.min(20, Math.round(goal * 0.75))) },
    }
  }

  async eveningNudge(): Promise<{ text: string; route: string; source: 'ai' | 'offline' }> {
    const input = this.nudgeInput()
    const route = SKILL_ROUTE[input.suggestion.skill]
    const fallback = offlineEveningNudge(input)
    if (!this.k.ai.isAvailable()) return { text: fallback, route, source: 'offline' }
    try {
      const res = await this.k.ai.run(eveningNudgePrompt, { ...input, fallback })
      return { text: res.data.slice(0, 300) || fallback, route, source: 'ai' }
    } catch (err) {
      this.k.log.warn(`coach nudge AI failed: ${toAiError(err).code}`)
      return { text: fallback, route, source: 'offline' }
    }
  }

  // ---------- schedules ----------
  schedules(): ScheduleMap {
    return parseSchedules(this.k.settings.getFlag(SCHEDULES_FLAG), defaultSchedules(this.k.settings.get().reminderTime))
  }

  lastSent(): Partial<Record<ScheduleKind, string>> {
    return parse(this.k.settings.getFlag(LAST_SENT_FLAG) ?? '{}', {})
  }

  scheduleState(): ScheduleState {
    const schedules = this.schedules()
    return {
      schedules,
      lastSent: this.lastSent(),
      nextRuns: nextRuns(this.k.now(), schedules),
      telegramConnected: this.k.telegram.isConnected(),
      notificationsEnabled: this.k.settings.get().notificationsEnabled,
    }
  }

  updateSchedules(patch: Partial<Record<ScheduleKind, Partial<ScheduleConfig>>>): ScheduleState {
    const current = this.schedules()
    for (const kind of SCHEDULE_KINDS) {
      const p = patch[kind]
      if (!p) continue
      current[kind] = mergeSchedule(current[kind], {
        ...p,
        channels: { ...current[kind].channels, ...(p.channels ?? {}) } as ScheduleChannels,
      })
    }
    this.k.settings.setFlag(SCHEDULES_FLAG, JSON.stringify(current))
    // Keep the general "reminder time" setting in sync with the evening reminder.
    if (patch.eveningReminder?.time) this.k.settings.update({ reminderTime: current.eveningReminder.time })
    return this.scheduleState()
  }

  // ---------- delivery ----------
  async deliver(msg: OutgoingMessage, channels: ScheduleChannels): Promise<DeliveryChannel[]> {
    const delivered: DeliveryChannel[] = []
    if (channels.app && this.k.settings.get().notificationsEnabled) {
      try {
        this.k.notify(msg.title, msg.body.slice(0, 250), msg.route)
        delivered.push('app')
      } catch (err) {
        this.k.log.warn(`coach notify failed: ${String(err)}`)
      }
    }
    if (channels.telegram) {
      const ok = await this.k.telegram.send({ html: msg.html, buttons: msg.buttons })
      if (ok) delivered.push('telegram')
    }
    this.k.db.run(
      `INSERT INTO coach_notifications(kind, run_key, title, body, route, channels, report_id, sent_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        msg.kind,
        msg.key,
        msg.title,
        msg.body.slice(0, 1000),
        msg.route,
        JSON.stringify(delivered),
        msg.reportId ?? null,
        this.k.now().toISOString(),
      ],
    )
    if (msg.reportId && delivered.length) {
      const r = this.k.db.get<{ delivered: string }>('SELECT delivered FROM coach_reports WHERE id = ?', [msg.reportId])
      const merged = [...new Set([...parse<DeliveryChannel[]>(r?.delivered ?? '[]', []), ...delivered])]
      this.k.db.run('UPDATE coach_reports SET delivered = ? WHERE id = ?', [JSON.stringify(merged), msg.reportId])
    }
    return delivered
  }

  reportMessage(report: CoachReport, kind: ScheduleKind | 'test', key: string): OutgoingMessage {
    return {
      kind,
      key,
      title: `AI Coach – ${report.label.vi}`,
      body: `${report.advice.headline}. ${report.advice.recommendations[0]?.action ?? ''}`.trim(),
      route: `/coach/reports/${report.id}`,
      html: reportHtml(report),
      buttons: [
        [{ text: 'Xem lời khuyên chi tiết', data: `coach:advice:${report.id}` }],
        [{ text: 'Áp dụng kế hoạch', data: `coach:apply:${report.id}` }],
      ],
      reportId: report.id,
    }
  }

  /** Runs one due schedule. Returns the channels it was delivered to ('skipped' when not needed). */
  async run(due: DueSchedule, cfg: ScheduleConfig): Promise<DeliveryChannel[] | 'skipped'> {
    if (due.kind === 'morningBrief') {
      const brief = await this.morningBrief()
      return this.deliver(
        {
          kind: due.kind,
          key: due.key,
          title: 'B&T English – Chào buổi sáng',
          body: brief.text,
          route: '/',
          html: `<b>☀️ Chào buổi sáng!</b>\n${esc(brief.text)}`,
          buttons: [[{ text: 'Kế hoạch ngày mai / hôm nay', data: 'coach:plan' }]],
        },
        cfg.channels,
      )
    }
    if (due.kind === 'eveningReminder') {
      if (this.habits.studiedToday()) return 'skipped'
      const nudge = await this.eveningNudge()
      return this.deliver(
        {
          kind: due.kind,
          key: due.key,
          title: 'B&T English – Nhắc học',
          body: nudge.text,
          route: nudge.route,
          html: `<b>⏰ Nhắc học</b>\n${esc(nudge.text)}`,
          buttons: [[{ text: 'Thói quen của tôi', data: 'coach:habits' }]],
        },
        cfg.channels,
      )
    }
    const target = reportTarget(due.kind, due.at)
    if (!target) return 'skipped'
    const report = await this.generateReport(target.period, 0, true, target.ref)
    return this.deliver(this.reportMessage(report, due.kind, due.key), cfg.channels)
  }

  /** One scheduler tick: runs every due schedule once (the last-sent key is stored before delivery). */
  async tick(now: Date = this.k.now()): Promise<{ kind: ScheduleKind; key: string; result: string }[]> {
    if (this.running) return []
    this.running = true
    const done: { kind: ScheduleKind; key: string; result: string }[] = []
    try {
      const schedules = this.schedules()
      const lastSent = this.lastSent()
      for (const due of dueSchedules(now, schedules, lastSent)) {
        lastSent[due.kind] = due.key
        this.k.settings.setFlag(LAST_SENT_FLAG, JSON.stringify(lastSent))
        try {
          const res = await this.run(due, schedules[due.kind])
          done.push({ kind: due.kind, key: due.key, result: Array.isArray(res) ? res.join(',') || 'none' : res })
          this.k.log.info(`coach schedule ${due.kind} ${due.key}${due.catchUp ? ' (catch-up)' : ''}: ${String(res)}`)
        } catch (err) {
          done.push({ kind: due.kind, key: due.key, result: 'error' })
          this.k.log.error(`coach schedule ${due.kind} failed: ${err instanceof Error ? err.message : String(err)}`)
        }
      }
    } finally {
      this.running = false
    }
    return done
  }

  async sendTest(channel: 'app' | 'telegram'): Promise<SendTestResult> {
    if (channel === 'app') {
      if (!this.k.settings.get().notificationsEnabled)
        return { ok: false, message: 'Thông báo Windows đang tắt trong Cài đặt chung.' }
      this.k.notify(
        'B&T English – AI Coach',
        'Đây là thông báo thử. Lịch nhắc học của bạn đã sẵn sàng!',
        '/coach/schedule',
      )
      return { ok: true, message: 'Đã gửi thông báo thử trên Windows.' }
    }
    const brief = offlineMorningBrief(this.briefInput())
    const ok = await this.k.telegram.send({
      html: `<b>🔔 Tin nhắn thử từ AI Coach</b>\n${esc(brief)}`,
      buttons: [[{ text: 'Thói quen của tôi', data: 'coach:habits' }]],
    })
    return ok
      ? { ok: true, message: 'Đã gửi tin nhắn thử qua Telegram.' }
      : { ok: false, message: 'Chưa gửi được – hãy kết nối bot Telegram trong Cài đặt → Telegram.' }
  }

  /** Detailed advice text for Telegram. */
  adviceHtml(id: number): string {
    return adviceHtml(this.report(id))
  }
}
