import { describe, expect, it } from 'vitest'
import type { NullTelegram, TelegramReply } from '../../../src/main/kernel/telegram/port'
import type { Kernel } from '../../../src/main/kernel'
import type { TodayPlan } from '../../../src/modules/journey/contract'
import { coachServicesFor } from '../../../src/modules/coach/main'
import { HabitTracker } from '../../../src/modules/coach/shared/tracker'
import type {
  ApplyPlanResult,
  AskResult,
  CoachOverview,
  CoachReport,
  CoachReportSummary,
  ScheduleState,
  SendTestResult,
  TrackResult,
} from '../../../src/modules/coach/types'
import { makeApp } from '../../helpers/kernel'

// 2026-11-05 is a Thursday (ISO week 45: Mon 02 – Sun 08).
const local = (d: number, hh: number, mm = 0, month = 10) => new Date(2026, month, d, hh, mm)

async function setup(opts: { mockAi?: boolean } = {}) {
  const clock = { now: local(5, 10) }
  const app = await makeApp({ mockAi: opts.mockAi, now: () => clock.now })
  const notes: { title: string; body: string; route?: string }[] = []
  app.kernel.notify = (title, body, route) => notes.push({ title, body, route })
  return { ...app, clock, notes, tg: app.kernel.telegram as NullTelegram }
}

function record(k: Kernel, clock: { now: Date }, at: Date, ev: Parameters<Kernel['progress']['record']>[0]) {
  const prev = clock.now
  clock.now = at
  k.progress.record(ev)
  clock.now = prev
}

/** Seeds a learning history across the current and previous week / month. */
function seed(k: Kernel, clock: { now: Date }) {
  record(k, clock, local(28, 20, 0, 9), { type: 'listening_done', module: 'listening', skill: 'listening', minutes: 5 })
  record(k, clock, local(2, 21), {
    type: 'listening_done',
    module: 'listening',
    skill: 'listening',
    minutes: 15,
    score: 0.8,
  })
  record(k, clock, local(3, 21, 10), {
    type: 'reading_done',
    module: 'reading',
    skill: 'reading',
    minutes: 10,
    score: 0.6,
  })
  record(k, clock, local(5, 9, 30), {
    type: 'grammar_done',
    module: 'grammar',
    skill: 'grammar',
    minutes: 20,
    score: 1,
  })
}

const html = (r: TelegramReply | TelegramReply[] | void) =>
  Array.isArray(r) ? r.map((x) => x.html).join('\n') : (r?.html ?? '')

describe('coach module – tracking', () => {
  it('persists heartbeat snapshots idempotently and clamps active time', async () => {
    const { call, kernel, clock } = await setup()
    const tr = new HabitTracker(local(5, 9).getTime(), () => 0.42)
    tr.navigate('/listening', local(5, 9).getTime())
    tr.input(local(5, 9, 1).getTime())
    tr.navigate('/coach', local(5, 9, 2).getTime())
    // No input for 10 minutes → only 2 more active minutes (idle after 2 min).
    const payload = tr.flush(local(5, 9, 12).getTime())
    expect(payload).not.toBeNull()
    const res = await call<TrackResult>('coach:track', payload)
    expect(res).toEqual({ sessions: 1, views: 2 })
    // Same snapshot again (retry) and an older, smaller snapshot never inflate or shrink the values.
    await call('coach:track', payload)
    const session = kernel.db.get<{ active_seconds: number; idle_seconds: number; start_hour: number; date: string }>(
      'SELECT * FROM coach_sessions',
    )
    expect(session).toMatchObject({ active_seconds: 240, idle_seconds: 480, start_hour: 9, date: '2026-11-05' })
    const views = kernel.db.all<{ module: string; active_seconds: number }>(
      'SELECT module, active_seconds FROM coach_views ORDER BY started_at',
    )
    expect(views).toEqual([
      { module: 'listening', active_seconds: 120 },
      { module: 'coach', active_seconds: 120 },
    ])
    const s0 = payload?.sessions[0]
    if (!s0) throw new Error('no session')
    await call('coach:track', { sessions: [{ ...s0, activeSeconds: 10 }], views: [] })
    expect(kernel.db.value('SELECT active_seconds FROM coach_sessions')).toBe(240)

    // A renderer claiming more active time than the wall clock allows is clamped; future timestamps are rejected.
    await call('coach:track', {
      sessions: [
        { ...s0, id: 'abcd-1', activeSeconds: 50_000 },
        { ...s0, id: 'abcd-2', startedAt: local(6, 9).toISOString(), lastActiveAt: local(6, 10).toISOString() },
      ],
      views: [],
    })
    expect(kernel.db.value("SELECT active_seconds FROM coach_sessions WHERE id = 'abcd-1'")).toBe(300)
    expect(kernel.db.value("SELECT COUNT(*) FROM coach_sessions WHERE id = 'abcd-2'")).toBe(0)

    // Invalid payloads are rejected by the contract.
    await expect(call('coach:track', { sessions: [{ id: 'X Y' }], views: [] })).rejects.toThrow(/invalid_input/)

    clock.now = local(5, 12)
    const o = await call<CoachOverview>('coach:overview', { period: 'day' })
    expect(o.stats.appSessions.count).toBe(2)
    expect(o.stats.appMinutes).toBe(9)
    expect(o.stats.moduleMix.find((m) => m.module === 'coach')?.appMinutes).toBe(2)
    expect(o.stats.appHourHistogram[9]).toBe(4)
  })
})

describe('coach module – analytics', () => {
  it('computes day / week / month numbers with deltas from seeded activity', async () => {
    const { call, kernel, clock } = await setup()
    seed(kernel, clock)
    const week = await call<CoachOverview>('coach:overview', { period: 'week', offset: 0 })
    expect(week.stats.key).toBe('2026-W45')
    expect(week.stats.studyMinutes).toBe(45)
    expect(week.stats.activeDays).toBe(3)
    expect(week.stats.elapsedDays).toBe(4)
    expect(week.stats.preferredHours[0]).toBe(21)
    expect(week.stats.hourHistogram[9]).toBe(20)
    expect(week.stats.weekdayMinutes.slice(0, 4)).toEqual([15, 10, 0, 20])
    expect(week.stats.avgScore).toBe(0.8)
    expect(week.stats.studySessions.count).toBe(3)
    expect(week.stats.deltas?.studyMinutes).toMatchObject({ previous: 5, change: 40 })
    expect(week.stats.deltas?.activeDays.change).toBe(2)
    expect(week.heatmap.some((d) => d.date === '2026-11-02' && d.minutes === 15)).toBe(true)
    expect(week.aiAvailable).toBe(true)
    expect(week.latestReport).toBeNull()

    const day = await call<CoachOverview>('coach:overview', { period: 'day' })
    expect(day.stats.studyMinutes).toBe(20)
    expect(day.stats.deltas?.studyMinutes.previous).toBe(0)

    const month = await call<CoachOverview>('coach:overview', { period: 'month' })
    expect(month.stats.key).toBe('2026-11')
    expect(month.stats.studyMinutes).toBe(45)
    expect(month.stats.deltas?.studyMinutes.previous).toBe(5)

    const prevWeek = await call<CoachOverview>('coach:overview', { period: 'week', offset: -1 })
    expect(prevWeek.stats).toMatchObject({ key: '2026-W44', studyMinutes: 5, activeDays: 1, elapsedDays: 7 })
  })

  it('counts plan completion from the lessons table', async () => {
    const { call, kernel } = await setup()
    await call<TodayPlan>('journey:today')
    const total = Number(kernel.db.value("SELECT COUNT(*) FROM lessons WHERE date = '2026-11-05'"))
    kernel.db.run("UPDATE lessons SET status = 'done' WHERE id = (SELECT MIN(id) FROM lessons)")
    const o = await call<CoachOverview>('coach:overview', { period: 'day' })
    expect(o.stats.plan).toMatchObject({ done: 1, total })
  })
})

describe('coach module – reports', () => {
  it('generates an AI report (mock provider), lists it and links it from the overview', async () => {
    const { call, kernel, clock } = await setup()
    seed(kernel, clock)
    const r = await call<CoachReport>('coach:generateReport', { period: 'week' })
    expect(r.source).toBe('ai')
    expect(r.provider).toBe('mock')
    expect(r.periodKey).toBe('2026-W45')
    expect(r.stats.studyMinutes).toBe(45)
    expect(r.advice.headline.length).toBeGreaterThan(0)
    expect(r.advice.recommendations.length).toBeGreaterThan(0)
    expect(r.advice.recommendations.every((x) => x.route.startsWith('/'))).toBe(true)
    expect(r.advice.nextPeriodPlan.map((d) => d.day)).toEqual([
      '2026-11-06',
      '2026-11-07',
      '2026-11-08',
      '2026-11-09',
      '2026-11-10',
      '2026-11-11',
      '2026-11-12',
    ])
    expect(r.fallbackReason).toBeNull()

    const list = await call<CoachReportSummary[]>('coach:reports')
    expect(list.map((x) => x.id)).toEqual([r.id])
    expect((await call<CoachReport>('coach:report', { id: r.id })).advice).toEqual(r.advice)
    const o = await call<CoachOverview>('coach:overview', { period: 'week' })
    expect(o.latestReport?.id).toBe(r.id)
    await expect(call('coach:report', { id: 999 })).rejects.toThrow(/not_found/)

    const day = await call<CoachReport>('coach:generateReport', { period: 'day' })
    expect(day.advice.nextPeriodPlan).toHaveLength(1)
    expect((await call<CoachReportSummary[]>('coach:reports', { period: 'day' })).map((x) => x.id)).toEqual([day.id])
  })

  it('falls back to clearly labelled offline advice without an AI key', async () => {
    const { call, kernel, clock } = await setup({ mockAi: false })
    seed(kernel, clock)
    const o = await call<CoachOverview>('coach:overview', { period: 'week' })
    expect(o.aiAvailable).toBe(false)
    const r = await call<CoachReport>('coach:generateReport', { period: 'month' })
    expect(r.source).toBe('offline')
    expect(r.provider).toBeNull()
    expect(r.fallbackReason).toMatch(/offline/)
    expect(r.advice.summary).toContain('45 phút')
    expect(r.advice.ieltsOutlook).toMatch(/IELTS/)
    const off = await call<CoachReport>('coach:generateReport', { period: 'day', useAi: false })
    expect(off.fallbackReason).toBeNull()

    const ask = await call<AskResult>('coach:askHabits', { question: 'Khi nào tôi học hiệu quả nhất?' })
    expect(ask.source).toBe('offline')
    expect(ask.answer).toContain('21:00')
  })

  it('answers habit questions with AI and keeps a history', async () => {
    const { call, kernel, clock } = await setup()
    seed(kernel, clock)
    const a = await call<AskResult>('coach:askHabits', { question: 'Tôi đang bỏ bê kỹ năng nào?', period: 'week' })
    expect(a.source).toBe('ai')
    expect(a.answer.length).toBeGreaterThan(10)
    const h = await call<AskResult[]>('coach:qaHistory')
    expect(h.map((x) => x.id)).toEqual([a.id])
    await expect(call('coach:askHabits', { question: '' })).rejects.toThrow(/invalid_input/)
  })

  it('applies the AI plan as lessons for the coming days (once)', async () => {
    const { call, kernel, clock } = await setup()
    seed(kernel, clock)
    const r = await call<CoachReport>('coach:generateReport', { period: 'week' })
    const res = await call<ApplyPlanResult>('coach:applyPlan', { reportId: r.id })
    expect(res.created).toBeGreaterThanOrEqual(7)
    expect(res.dates).toHaveLength(7)
    const rows = kernel.db.all<{ date: string; module: string; description: string; content_ref: string | null }>(
      "SELECT date, module, description, content_ref FROM lessons WHERE date > '2026-11-05' ORDER BY date, position",
    )
    expect(new Set(rows.map((x) => x.date)).size).toBe(7)
    expect(rows.every((x) => x.description.startsWith('AI Coach'))).toBe(true)
    expect(rows.some((x) => x.module === 'vocabulary')).toBe(true)
    const contentRows = rows.filter((x) => x.module !== 'vocabulary' && x.module !== 'tutor')
    expect(contentRows.every((x) => !!x.content_ref)).toBe(true)
    expect(new Set(contentRows.map((x) => x.content_ref)).size).toBe(contentRows.length)

    const again = await call<ApplyPlanResult>('coach:applyPlan', { reportId: r.id })
    expect(again.created).toBe(0)
    expect(again.skipped).toBe(res.created)
    expect((await call<CoachReport>('coach:report', { id: r.id })).appliedAt).not.toBeNull()

    // The journey module shows the applied lessons as tomorrow's plan.
    clock.now = local(6, 8)
    const plan = await call<TodayPlan>('journey:today')
    expect(plan.lessons.length).toBe(rows.filter((x) => x.date === '2026-11-06').length)

    // A plan whose days are all in the past cannot be applied.
    clock.now = local(20, 8)
    await expect(call('coach:applyPlan', { reportId: r.id })).rejects.toThrow(/plan_expired/)
  })
})

describe('coach module – schedules', () => {
  it('stores schedules, keeps the reminder time in sync and lists next runs', async () => {
    const { call, kernel } = await setup()
    const s = await call<ScheduleState>('coach:schedules')
    expect(s.schedules.morningBrief).toMatchObject({ enabled: true, time: '07:00' })
    expect(s.schedules.eveningReminder.time).toBe('20:00')
    expect(s.telegramConnected).toBe(false)
    expect(s.nextRuns[0]?.kind).toBe('eveningReminder')
    const u = await call<ScheduleState>('coach:updateSchedules', {
      eveningReminder: { time: '21:15', channels: { app: true, telegram: false } },
      monthlyReport: { enabled: false },
    })
    expect(u.schedules.eveningReminder).toMatchObject({ time: '21:15', channels: { app: true, telegram: false } })
    expect(u.schedules.monthlyReport.enabled).toBe(false)
    expect(u.nextRuns.some((r) => r.kind === 'monthlyReport')).toBe(false)
    expect(kernel.settings.get().reminderTime).toBe('21:15')
    await expect(call('coach:updateSchedules', { morningBrief: { time: '7am' } })).rejects.toThrow(/invalid_input/)
  })

  it('runs due schedules once, with catch-up, via Windows notifications and Telegram', async () => {
    const { kernel, clock, notes, tg } = await setup()
    const svc = coachServicesFor(kernel)

    // 07:00 morning brief → app + Telegram.
    clock.now = local(5, 7)
    const t1 = await svc.tick()
    expect(t1.map((x) => x.kind)).toEqual(['morningBrief'])
    expect(notes).toHaveLength(1)
    expect(notes[0]?.title).toContain('Chào buổi sáng')
    expect(tg.sent).toHaveLength(1)
    expect(html(tg.sent[0] as TelegramReply)).toContain('Chào buổi sáng')
    // Same minute and later the same day → never twice.
    expect(await svc.tick(local(5, 7, 1))).toEqual([])
    expect(await svc.tick(local(5, 12))).toEqual([])

    // 20:00 evening reminder: nothing studied today → AI nudge routed to the weakest skill.
    clock.now = local(5, 20)
    const t2 = await svc.tick()
    expect(t2.map((x) => x.kind)).toEqual(['eveningReminder'])
    expect(notes[1]?.body.length).toBeGreaterThan(10)
    expect(notes[1]?.route).toMatch(/^\//)

    // App off at 21:30, opened at 23:00 → daily report is caught up once and links to the report page.
    clock.now = local(5, 23)
    const t3 = await svc.tick()
    expect(t3.map((x) => x.kind)).toEqual(['dailyReport'])
    const last = tg.sent[tg.sent.length - 1] as TelegramReply
    expect(html(last)).toContain('📊')
    expect(last.buttons?.[0]?.[0]?.text).toBe('Xem lời khuyên chi tiết')
    const report = kernel.db.get<{ id: number; period: string; period_key: string }>('SELECT * FROM coach_reports')
    expect(report).toMatchObject({ period: 'day', period_key: '2026-11-05' })
    expect(await svc.tick(local(5, 23, 30))).toEqual([])

    // Next morning: yesterday is not re-sent, today's brief is.
    expect((await svc.tick(local(6, 7, 5))).map((x) => x.kind)).toEqual(['morningBrief'])
    expect(kernel.settings.getFlag('coach.lastSent')).toContain('2026-11-06')
    const reminders = kernel.db.all<{ kind: string; channels: string }>(
      'SELECT kind, channels FROM coach_notifications ORDER BY id',
    )
    expect(reminders.map((r) => r.kind)).toEqual(['morningBrief', 'eveningReminder', 'dailyReport', 'morningBrief'])
    // NullTelegram reports "not delivered", so only the app channel is recorded (the daily report is Telegram-only).
    expect(reminders.map((r) => r.channels)).toEqual(['["app"]', '["app"]', '[]', '["app"]'])
    expect(tg.sent).toHaveLength(4)
  })

  it('skips the evening reminder when the learner already studied today', async () => {
    const { kernel, clock, notes, tg } = await setup()
    seed(kernel, clock)
    const svc = coachServicesFor(kernel)
    kernel.settings.setFlag('coach.lastSent', JSON.stringify({ morningBrief: '2026-11-05' }))
    const res = await svc.tick(local(5, 20, 10))
    expect(res).toEqual([{ kind: 'eveningReminder', key: '2026-11-05', result: 'skipped' }])
    expect(notes).toHaveLength(0)
    expect(tg.sent).toHaveLength(0)
  })

  it('sends the weekly report on Sunday and catches up on Monday only once', async () => {
    const { kernel, clock, tg } = await setup()
    seed(kernel, clock)
    const svc = coachServicesFor(kernel)
    const only = { weeklyReport: { enabled: true } }
    svc.updateSchedules({
      morningBrief: { enabled: false },
      eveningReminder: { enabled: false },
      dailyReport: { enabled: false },
      monthlyReport: { enabled: false },
      ...only,
    })
    clock.now = local(9, 9)
    expect((await svc.tick()).map((x) => [x.kind, x.key])).toEqual([['weeklyReport', '2026-W45']])
    const r = kernel.db.get<{ period_key: string; stats: string }>('SELECT period_key, stats FROM coach_reports')
    expect(r?.period_key).toBe('2026-W45')
    expect((JSON.parse(r?.stats ?? '{}') as { studyMinutes: number }).studyMinutes).toBe(45)
    expect(tg.sent).toHaveLength(1)
    expect(await svc.tick(local(9, 10))).toEqual([])
  })

  it('sends test messages', async () => {
    const { call, notes, tg } = await setup()
    const app = await call<SendTestResult>('coach:sendTest', { channel: 'app' })
    expect(app.ok).toBe(true)
    expect(notes).toHaveLength(1)
    const t = await call<SendTestResult>('coach:sendTest', { channel: 'telegram' })
    expect(t.ok).toBe(false)
    expect(tg.sent).toHaveLength(1)
  })
})

describe('coach module – Telegram commands', () => {
  it('registers /report, /advice, /habits and /plan and answers through the port', async () => {
    const { kernel, clock, tg } = await setup()
    seed(kernel, clock)
    const names = tg.commands.map((c) => c.name)
    expect(names).toEqual(expect.arrayContaining(['report', 'advice', 'habits', 'plan']))
    const cmd = (name: string) => {
      const c = tg.commands.find((x) => x.name === name)
      if (!c) throw new Error(`missing /${name}`)
      return c
    }
    const ctx = { chatId: '1', args: '' }

    const week = await cmd('report').run({ ...ctx, args: 'tuần' })
    expect(html(week)).toContain('Tuần 45')
    expect(html(week)).toContain('45 phút')
    const month = await cmd('report').run({ ...ctx, args: 'month' })
    expect(html(month)).toContain('Tháng 11/2026')
    const day = await cmd('report').run(ctx)
    expect(html(day)).toContain('05/11/2026')

    const advice = await cmd('advice').run(ctx)
    expect(html(advice)).toContain('Lời khuyên')
    const habits = await cmd('habits').run(ctx)
    expect(html(habits)).toContain('Thói quen học')
    expect(html(habits)).toContain('21:00')

    const plan = (await cmd('plan').run(ctx)) as TelegramReply
    expect(html(plan)).toContain('2026-11-06')
    const data = plan.buttons?.[0]?.[0]?.data ?? ''
    expect(data).toMatch(/^coach:apply:\d+$/)

    // Inline buttons are handled by the 'coach' callback.
    const cb = tg.callbacks.get('coach')
    if (!cb) throw new Error('no coach callback')
    const applied = await cb(data, ctx)
    expect(applied?.html).toContain('Đã thêm')
    expect(Number(kernel.db.value("SELECT COUNT(*) FROM lessons WHERE date = '2026-11-06'"))).toBeGreaterThan(0)
    const reportId = data.split(':')[2]
    expect((await cb(`coach:advice:${reportId}`, ctx))?.html).toContain('Nên làm')
    expect((await cb('coach:advice:999', ctx))?.text).toContain('Không tìm thấy')
  })
})
