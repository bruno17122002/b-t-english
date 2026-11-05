// Rule-based (offline) coaching texts built from the habit analytics. Used when no AI key is configured, when
// an AI call fails, and as the deterministic mock of the AI prompts. Vietnamese-first.
import type { Cefr } from '@shared/content'
import type { Skill } from '@shared/types'
import { hashString } from '@core/dates'
import type { CoachAdvice, CoachPlanDay, CoachRecommendation, HabitStats, PlanModule } from '../types'
import { hourLabel, SKILL_VI } from './analytics'

export interface AdviceContext {
  planDates: string[]
  overallCefr: Cefr
  targetIelts: number | null
  dailyGoalMinutes: number
  dueCards: number
}

export const SKILL_ROUTE: Record<Skill, string> = {
  vocabulary: '/vocabulary/review',
  grammar: '/grammar',
  reading: '/reading',
  listening: '/listening',
  writing: '/writing',
  speaking: '/speaking',
}

const SKILL_MODULE: Record<Skill, PlanModule> = {
  vocabulary: 'vocabulary',
  grammar: 'grammar',
  reading: 'reading',
  listening: 'listening',
  writing: 'writing',
  speaking: 'speaking',
}

/** Routes the AI may link to; anything else is mapped to the closest allowed route. */
export const ALLOWED_ROUTES = [
  '/',
  '/journey',
  '/listening',
  '/speaking',
  '/reading',
  '/writing',
  '/grammar',
  '/vocabulary',
  '/vocabulary/review',
  '/cinema',
  '/tutor',
  '/stats',
  '/coach',
  '/coach/schedule',
  '/coach/ask',
]

export function sanitizeRoute(route: string): string {
  const r = route.trim().split('?')[0]?.replace(/\/+$/, '') || '/'
  if (ALLOWED_ROUTES.includes(r)) return r
  const root = `/${r.split('/').filter(Boolean)[0] ?? ''}`
  return ALLOWED_ROUTES.includes(root) ? root : '/journey'
}

/** Rough IELTS band for a CEFR level (Cambridge alignment). */
export const CEFR_IELTS: Record<Cefr, number> = { A1: 2.5, A2: 3.5, B1: 4.5, B2: 6, C1: 7, C2: 8.5 }

const fmtMin = (m: number) => `${Math.round(m)} phút`

export function ieltsOutlookText(cefr: Cefr, target: number | null, stats: HabitStats): string {
  const goal = target ?? 6.5
  const band = CEFR_IELTS[cefr]
  const gap = Math.max(0, goal - band)
  if (gap <= 0)
    return `Trình độ hiện tại (${cefr} ≈ IELTS ${band}) đã chạm mục tiêu ${goal}. Hãy luyện đề để giữ phong độ.`
  const weekly = stats.period === 'day' ? stats.studyMinutes * 7 : (stats.studyMinutes / stats.elapsedDays) * 7
  const hours = Math.round(gap * 150)
  const weeks = weekly > 0 ? Math.ceil((hours * 60) / weekly) : null
  return weeks
    ? `Bạn đang ở ${cefr} (≈ IELTS ${band}). Để đạt ${goal} cần khoảng ${hours} giờ học; với nhịp ${Math.round(weekly)} phút/tuần mất khoảng ${weeks} tuần.`
    : `Bạn đang ở ${cefr} (≈ IELTS ${band}). Để đạt ${goal} cần khoảng ${hours} giờ học có hướng dẫn – hãy bắt đầu lại nhịp học hằng ngày.`
}

function strengths(s: HabitStats): string[] {
  const out: string[] = []
  if (s.streak.current >= 3) out.push(`Chuỗi ${s.streak.current} ngày học liên tiếp – rất đáng khen.`)
  if (s.goalRate >= 1) out.push(`Đạt ${Math.round(s.goalRate * 100)}% mục tiêu thời gian học.`)
  if (s.avgScore !== null && s.avgScore >= 0.8)
    out.push(`Độ chính xác trung bình cao (${Math.round(s.avgScore * 100)}%).`)
  if (s.plan.rate !== null && s.plan.rate >= 0.7) out.push(`Hoàn thành ${Math.round(s.plan.rate * 100)}% kế hoạch.`)
  if (s.reviewAccuracy !== null && s.reviewAccuracy >= 0.8 && s.reviews >= 5)
    out.push(`Ôn ${s.reviews} thẻ với ${Math.round(s.reviewAccuracy * 100)}% nhớ đúng.`)
  if (s.consistency >= 70) out.push(`Điểm đều đặn ${s.consistency}/100 – thói quen đã hình thành.`)
  if (s.deltas && s.deltas.studyMinutes.change > 0)
    out.push(`Thời gian học tăng ${fmtMin(s.deltas.studyMinutes.change)} so với kỳ trước.`)
  if (!out.length && s.activeDays > 0) out.push(`Bạn đã học ${s.activeDays} ngày – mỗi buổi học đều có giá trị.`)
  return out.slice(0, 5)
}

function recommendations(s: HabitStats, ctx: AdviceContext): CoachRecommendation[] {
  const out: CoachRecommendation[] = []
  const weak = s.weakestSkills[0]
  const best = s.preferredHours[0]
  const goal = Math.max(10, ctx.dailyGoalMinutes)
  if (weak)
    out.push({
      title: `Ưu tiên kỹ năng ${SKILL_VI[weak]}`,
      why: `Đây là kỹ năng yếu nhất và chỉ chiếm ${Math.round(s.weakSkillShare * 100)}% thời gian học.`,
      action: `Mỗi ngày dành 15 phút cho ${SKILL_VI[weak]} trước khi học phần khác.`,
      route: SKILL_ROUTE[weak],
      minutes: 15,
    })
  if (ctx.dueCards > 0 || s.reviewBacklog > 0)
    out.push({
      title: 'Dọn thẻ từ đến hạn',
      why: `${Math.max(ctx.dueCards, s.reviewBacklog)} thẻ đang chờ ôn – ôn đúng hạn giúp nhớ lâu hơn.`,
      action: 'Ôn hết thẻ đến hạn trong 5–10 phút.',
      route: '/vocabulary/review',
      minutes: 10,
    })
  if (s.activeDays < s.elapsedDays || s.consistency < 60)
    out.push({
      title: best !== undefined ? `Giữ khung giờ ${hourLabel(best)}` : 'Chọn một khung giờ cố định',
      why: `Bạn học ${s.activeDays}/${s.elapsedDays} ngày; học cùng giờ mỗi ngày giúp duy trì thói quen.`,
      action:
        best !== undefined
          ? `Đặt nhắc nhở lúc ${hourLabel(best)} và học ít nhất ${goal} phút.`
          : `Đặt nhắc nhở buổi tối và học ít nhất ${goal} phút.`,
      route: '/coach/schedule',
      minutes: goal,
    })
  if (s.plan.rate !== null && s.plan.rate < 0.6)
    out.push({
      title: 'Hoàn thành kế hoạch hôm nay',
      why: `Mới hoàn thành ${Math.round(s.plan.rate * 100)}% bài trong kế hoạch.`,
      action: 'Mở Hành trình và làm bài đầu tiên trong danh sách.',
      route: '/journey',
      minutes: 15,
    })
  if (out.length < 2)
    out.push({
      title: 'Luyện nói với gia sư AI',
      why: 'IELTS Speaking cần phản xạ – luyện hội thoại ngắn mỗi ngày.',
      action: 'Trò chuyện 10 phút về một chủ đề IELTS Part 1.',
      route: '/tutor',
      minutes: 10,
    })
  return out.slice(0, 5)
}

/** Day-by-day plan rotating through the weakest skills plus vocabulary review. */
export function offlinePlan(s: HabitStats, ctx: AdviceContext): CoachPlanDay[] {
  const weak = s.weakestSkills.length ? s.weakestSkills : (['listening', 'speaking'] as Skill[])
  const rotation: PlanModule[] = [...weak.map((w) => SKILL_MODULE[w]), 'reading', 'listening', 'speaking', 'writing']
  const uniq = [...new Set(rotation)].filter((m) => m !== 'vocabulary')
  const minutes = Math.max(10, Math.min(120, ctx.dailyGoalMinutes))
  return ctx.planDates.map((day, i) => {
    const main = uniq[(i + (hashString(s.key) % 2)) % uniq.length] ?? 'listening'
    const skillName = SKILL_VI[main as Skill] ?? main
    return {
      day,
      focus: `Tập trung ${skillName}`,
      modules: [main, 'vocabulary'],
      activities: [`Một bài ${skillName} phù hợp trình độ`, 'Ôn thẻ từ đến hạn'],
      minutes,
    }
  })
}

export function offlineAdvice(s: HabitStats, ctx: AdviceContext): CoachAdvice {
  const headline =
    s.activeDays === 0
      ? 'Bắt đầu lại nhịp học – chỉ cần 10 phút hôm nay'
      : s.consistency >= 70
        ? 'Nhịp học rất đều – hãy giữ vững phong độ'
        : s.consistency >= 40
          ? 'Khá ổn – cần học đều đặn hơn'
          : 'Hãy xây lại thói quen học mỗi ngày'
  const deltaText = s.deltas
    ? ` So với kỳ trước: ${s.deltas.studyMinutes.change >= 0 ? '+' : ''}${Math.round(s.deltas.studyMinutes.change)} phút, ${s.deltas.activeDays.change >= 0 ? '+' : ''}${s.deltas.activeDays.change} ngày học.`
    : ''
  const summary =
    `${s.label.vi}: học ${fmtMin(s.studyMinutes)} trong ${s.activeDays}/${s.elapsedDays} ngày, ` +
    `${s.studySessions.count} buổi học (trung vị ${fmtMin(s.studySessions.medianMinutes)}), ` +
    `mở ứng dụng ${fmtMin(s.appMinutes)}. Điểm đều đặn ${s.consistency}/100.${deltaText}`
  const concerns = s.anomalies.map((a) => a.vi)
  if (!concerns.length) concerns.push('Chưa thấy vấn đề lớn – tiếp tục duy trì.')
  const best = s.preferredHours.length
    ? s.preferredHours.slice(0, 2).map((h) => `${hourLabel(h)}–${hourLabel((h + 1) % 24)} (giờ bạn học nhiều nhất)`)
    : ['20:00–21:00 (gợi ý: sau bữa tối, trước khi mệt)']
  const motivation =
    s.streak.current > 0
      ? `Chuỗi ${s.streak.current} ngày đang chờ bạn nối dài – mỗi ngày một chút là đủ!`
      : 'Hôm nay là ngày tốt nhất để bắt đầu lại. 10 phút thôi!'
  return {
    headline,
    summary,
    strengths: strengths(s),
    concerns: concerns.slice(0, 5),
    recommendations: recommendations(s, ctx),
    bestStudyTimes: best,
    nextPeriodPlan: offlinePlan(s, ctx),
    motivation,
    ieltsOutlook: ieltsOutlookText(ctx.overallCefr, ctx.targetIelts, s),
  }
}

// ---------- short texts (briefs, nudges, Q&A) ----------
export interface BriefInput {
  name: string
  todayPlan: { title: string; module: string; minutes: number }[]
  dueCards: number
  streak: number
  preferredHour: number | null
  yesterdayMinutes: number
  weakestSkill: Skill | null
  dailyGoalMinutes: number
}

export function offlineMorningBrief(b: BriefInput): string {
  const hello = b.name ? `Chào buổi sáng, ${b.name}!` : 'Chào buổi sáng!'
  const y = b.yesterdayMinutes > 0 ? `Hôm qua bạn học ${fmtMin(b.yesterdayMinutes)}.` : 'Hôm qua bạn chưa học.'
  const plan = b.todayPlan.length
    ? `Kế hoạch hôm nay: ${b.todayPlan
        .slice(0, 3)
        .map((p) => p.title)
        .join(', ')}.`
    : `Mục tiêu hôm nay: ${b.dailyGoalMinutes} phút.`
  const due = b.dueCards > 0 ? ` Có ${b.dueCards} thẻ từ cần ôn.` : ''
  const when =
    b.preferredHour !== null ? ` Bạn thường học lúc ${hourLabel(b.preferredHour)} – hẹn gặp lại lúc đó nhé.` : ''
  const weak = b.weakestSkill ? ` Ưu tiên: ${SKILL_VI[b.weakestSkill]}.` : ''
  return `${hello} ${y} ${plan}${due}${weak}${when}`.replace(/\s+/g, ' ').trim()
}

export interface NudgeInput {
  minutesToday: number
  preferredHour: number | null
  streak: number
  weakestSkill: Skill | null
  dueCards: number
  suggestion: { skill: Skill; minutes: number }
}

export function offlineEveningNudge(n: NudgeInput): string {
  const when = n.preferredHour !== null ? `Bạn thường học lúc ${hourLabel(n.preferredHour)}` : 'Tối nay còn thời gian'
  const what = `${n.suggestion.minutes} phút ${SKILL_VI[n.suggestion.skill]} tối nay nhé?`
  const streak = n.streak > 0 ? ` Giữ chuỗi ${n.streak} ngày!` : ''
  const due = n.dueCards > 0 ? ` (${n.dueCards} thẻ từ đang chờ.)` : ''
  return `${when} – ${what}${streak}${due}`
}

export function offlineHabitAnswer(question: string, s: HabitStats): string {
  const q = question.toLowerCase()
  const best = s.preferredHours.length ? s.preferredHours.map(hourLabel).join(', ') : 'chưa đủ dữ liệu'
  const parts = [
    `Trong ${s.label.vi.toLowerCase()} bạn học ${fmtMin(s.studyMinutes)} trong ${s.activeDays}/${s.elapsedDays} ngày (điểm đều đặn ${s.consistency}/100).`,
  ]
  if (/giờ|time|khi nào|when|lúc/.test(q)) parts.push(`Khung giờ bạn học nhiều nhất: ${best}.`)
  if (/yếu|weak|kỹ năng|skill/.test(q) && s.weakestSkills[0])
    parts.push(`Kỹ năng cần ưu tiên: ${s.weakestSkills.map((w) => SKILL_VI[w]).join(', ')}.`)
  if (s.anomalies[0]) parts.push(`Lưu ý: ${s.anomalies[0].vi}`)
  parts.push('(Trả lời theo quy tắc – thêm API key AI để có câu trả lời chi tiết hơn.)')
  return parts.join(' ')
}
