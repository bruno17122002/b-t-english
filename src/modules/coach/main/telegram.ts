// Telegram side of the coach module: HTML message builders and the /report, /advice, /habits, /plan commands
// plus inline-button callbacks ('coach:*'). Uses only the kernel TelegramPort.
import type { Kernel } from '../../../main/kernel'
import type { TelegramReply } from '../../../main/kernel/telegram/port'
import type { CoachPeriod, CoachReport, HabitStats } from '../types'
import { hourLabel, SKILL_VI } from './analytics'
import type { CoachService } from './service'

/** Escapes text for Telegram HTML. */
export const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

const WEEKDAY_VI = ['Thứ 2', 'Thứ 3', 'Thứ 4', 'Thứ 5', 'Thứ 6', 'Thứ 7', 'Chủ nhật']

const sign = (n: number) => (n > 0 ? `+${n}` : String(n))

export function statsLines(s: HabitStats): string[] {
  const lines = [
    `📚 Học: <b>${Math.round(s.studyMinutes)} phút</b> · ${s.activeDays}/${s.elapsedDays} ngày${s.deltas ? ` (${sign(Math.round(s.deltas.studyMinutes.change))} phút)` : ''}`,
    `🖥️ Mở app: ${Math.round(s.appMinutes)} phút · ${s.appSessions.count} phiên`,
    `⏱️ Buổi học: ${s.studySessions.count} (trung vị ${Math.round(s.studySessions.medianMinutes)} phút)`,
    `🎯 Đều đặn: <b>${s.consistency}/100</b> · 🔥 chuỗi ${s.streak.current} ngày`,
  ]
  if (s.preferredHours.length) lines.push(`🕘 Giờ học nhiều nhất: ${s.preferredHours.map(hourLabel).join(', ')}`)
  if (s.avgScore !== null) lines.push(`✅ Độ chính xác TB: ${Math.round(s.avgScore * 100)}%`)
  if (s.plan.total) lines.push(`🗓️ Kế hoạch: ${s.plan.done}/${s.plan.total} bài`)
  return lines
}

export function reportHtml(r: CoachReport): string {
  const a = r.advice
  const parts = [
    `<b>📊 ${esc(r.label.vi)}</b>${r.source === 'ai' ? ' · AI' : ' · offline'}`,
    `<b>${esc(a.headline)}</b>`,
    ...statsLines(r.stats),
    '',
    esc(a.summary),
  ]
  const rec = a.recommendations.slice(0, 2)
  if (rec.length) parts.push('', '<b>Gợi ý:</b>', ...rec.map((x) => `• ${esc(x.title)} – ${esc(x.action)}`))
  return parts.join('\n').slice(0, 3800)
}

export function adviceHtml(r: CoachReport): string {
  const a = r.advice
  const list = (title: string, items: string[]) =>
    items.length ? ['', `<b>${title}</b>`, ...items.slice(0, 5).map((x) => `• ${esc(x)}`)] : []
  const parts = [
    `<b>🧠 Lời khuyên – ${esc(r.label.vi)}</b>`,
    `<i>${esc(a.headline)}</i>`,
    ...list('Điểm mạnh', a.strengths),
    ...list('Cần chú ý', a.concerns),
    '',
    '<b>Nên làm</b>',
    ...a.recommendations.slice(0, 5).map((x) => `• <b>${esc(x.title)}</b> (${x.minutes}′): ${esc(x.action)}`),
    ...list('Giờ học tốt nhất', a.bestStudyTimes),
    '',
    `<b>IELTS:</b> ${esc(a.ieltsOutlook)}`,
    `💪 ${esc(a.motivation)}`,
  ]
  return parts.join('\n').slice(0, 3800)
}

export function planHtml(r: CoachReport): string {
  const parts = [`<b>🗓️ Kế hoạch AI</b> (${esc(r.label.vi)})`]
  for (const d of r.advice.nextPeriodPlan.slice(0, 7)) {
    parts.push(
      '',
      `<b>${esc(d.day)}</b> – ${esc(d.focus)} (${d.minutes} phút)`,
      ...d.activities.map((x) => `• ${esc(x)}`),
    )
  }
  return parts.join('\n').slice(0, 3800)
}

export function habitsHtml(week: HabitStats, last28: HabitStats): string {
  const parts = [`<b>📈 Thói quen học – ${esc(week.label.vi)}</b>`, ...statsLines(week), '', '<b>28 ngày qua</b>']
  parts.push(`Học ${Math.round(last28.studyMinutes)} phút trong ${last28.activeDays} ngày`)
  if (last28.preferredWeekdays.length)
    parts.push(`Ngày học nhiều nhất: ${last28.preferredWeekdays.map((d) => WEEKDAY_VI[d]).join(', ')}`)
  if (last28.weakestSkills.length)
    parts.push(
      `Kỹ năng yếu: ${last28.weakestSkills.map((s) => SKILL_VI[s]).join(', ')} (${Math.round(last28.weakSkillShare * 100)}% thời gian)`,
    )
  for (const a of week.anomalies.slice(0, 3)) parts.push(`⚠️ ${esc(a.vi)}`)
  return parts.join('\n')
}

/** Maps /report arguments (Vietnamese with or without diacritics, or English) to a period. */
export function parsePeriodArg(args: string): CoachPeriod {
  const a = args.trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd')
  if (/^(tuan|week|w)\b/.test(a)) return 'week'
  if (/^(thang|month|m)\b/.test(a)) return 'month'
  return 'day'
}

const reportButtons = (id: number) => [
  [{ text: 'Xem lời khuyên chi tiết', data: `coach:advice:${id}` }],
  [{ text: 'Áp dụng kế hoạch', data: `coach:apply:${id}` }],
]

export function registerCoachTelegram(kernel: Kernel, svc: CoachService): void {
  const tg = kernel.telegram
  const reportReply = async (period: CoachPeriod): Promise<TelegramReply> => {
    const r = await svc.generateReport(period, 0, true)
    return { html: reportHtml(r), buttons: reportButtons(r.id) }
  }
  const planReply = async (): Promise<TelegramReply> => {
    const r = await svc.recentOrGenerate('day')
    return { html: planHtml(r), buttons: [[{ text: 'Áp dụng vào kế hoạch học', data: `coach:apply:${r.id}` }]] }
  }
  const habitsReply = (): TelegramReply => ({
    html: habitsHtml(svc.habits.stats('week', 0), svc.habits.profile()),
    buttons: [[{ text: 'Lời khuyên AI', data: 'coach:advice:new' }]],
  })

  tg.registerCommand({
    name: 'report',
    description: { en: 'Habit report: /report day|week|month', vi: 'Báo cáo thói quen: /report ngay|tuan|thang' },
    run: (ctx) => reportReply(parsePeriodArg(ctx.args)),
  })
  tg.registerCommand({
    name: 'advice',
    description: { en: 'Fresh AI analysis of your study habits', vi: 'AI phân tích thói quen học ngay bây giờ' },
    run: async () => {
      const r = await svc.generateReport('week', 0, true)
      return { html: adviceHtml(r), buttons: [[{ text: 'Áp dụng kế hoạch', data: `coach:apply:${r.id}` }]] }
    },
  })
  tg.registerCommand({
    name: 'habits',
    description: { en: 'Quick habit statistics', vi: 'Thống kê thói quen nhanh' },
    run: async () => habitsReply(),
  })
  tg.registerCommand({
    name: 'plan',
    description: { en: 'AI study plan for tomorrow', vi: 'Kế hoạch học ngày mai do AI đề xuất' },
    run: () => planReply(),
  })

  tg.registerCallback('coach', async (data) => {
    try {
      return await handleCallback(data)
    } catch (err) {
      return { text: err instanceof Error ? err.message : 'Đã xảy ra lỗi.' }
    }
  })

  const handleCallback = async (data: string): Promise<TelegramReply> => {
    const [, action, arg] = data.split(':')
    if (action === 'advice') {
      if (arg === 'new') {
        const r = await svc.generateReport('week', 0, true)
        return { html: adviceHtml(r) }
      }
      const id = Number(arg)
      return Number.isInteger(id) && id > 0 ? { html: svc.adviceHtml(id) } : { text: 'Không tìm thấy báo cáo.' }
    }
    if (action === 'apply') {
      const id = Number(arg)
      try {
        const res = svc.applyPlan(id)
        return {
          html: `✅ Đã thêm <b>${res.created}</b> bài vào kế hoạch (${res.dates.map(esc).join(', ')}). Mở Lingua Quest → Hành trình để bắt đầu.`,
        }
      } catch (err) {
        return { text: err instanceof Error ? err.message : 'Không áp dụng được kế hoạch.' }
      }
    }
    if (action === 'plan') return planReply()
    if (action === 'habits') return habitsReply()
    if (action === 'report') return reportReply(parsePeriodArg(arg ?? 'day'))
    return { text: 'Lệnh không hợp lệ.' }
  }
}
