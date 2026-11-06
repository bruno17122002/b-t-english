// Coach texts for the server bot and scheduler: rule-based advice, morning brief and evening nudge (port of
// src/modules/coach/main/advice.ts), the Telegram HTML builders (port of coach/main/telegram.ts) and the AI prompts
// (port of coach/main/prompts.ts) with manual validation. Offline texts are always the fallback.
import { generateJson, InvalidOutput, isObj, objList, str, strList, type AiModel } from './gemini.ts'
import { esc, foldVi } from './format.ts'
import { hashString } from './dates.ts'
import { hourLabel, SKILL_VI_LOWER as SKILL_VI, type CoachPeriod, type HabitStats } from './habits.ts'
import type { Cefr, Skill } from './learner.ts'

export type PlanModule =
  'listening' | 'speaking' | 'reading' | 'writing' | 'grammar' | 'vocabulary' | 'cinema' | 'tutor'
const PLAN_MODULES: PlanModule[] = [
  'listening',
  'speaking',
  'reading',
  'writing',
  'grammar',
  'vocabulary',
  'cinema',
  'tutor',
]

export interface CoachRecommendation {
  title: string
  why: string
  action: string
  route: string
  minutes: number
}
export interface CoachPlanDay {
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
export interface CoachReport {
  period: CoachPeriod
  label: { en: string; vi: string }
  stats: HabitStats
  advice: CoachAdvice
  source: 'ai' | 'offline'
}

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

export const CEFR_IELTS: Record<Cefr, number> = { A1: 2.5, A2: 3.5, B1: 4.5, B2: 6, C1: 7, C2: 8.5 }
const fmtMin = (m: number) => `${Math.round(m)} phút`

export function ieltsOutlookText(level: Cefr, target: number | null, st: HabitStats): string {
  const goal = target ?? 6.5
  const band = CEFR_IELTS[level]
  const gap = Math.max(0, goal - band)
  if (gap <= 0)
    return `Trình độ hiện tại (${level} ≈ IELTS ${band}) đã chạm mục tiêu ${goal}. Hãy luyện đề để giữ phong độ.`
  const weekly = st.period === 'day' ? st.studyMinutes * 7 : (st.studyMinutes / st.elapsedDays) * 7
  const hours = Math.round(gap * 150)
  const weeks = weekly > 0 ? Math.ceil((hours * 60) / weekly) : null
  return weeks
    ? `Bạn đang ở ${level} (≈ IELTS ${band}). Để đạt ${goal} cần khoảng ${hours} giờ học; với nhịp ${Math.round(weekly)} phút/tuần mất khoảng ${weeks} tuần.`
    : `Bạn đang ở ${level} (≈ IELTS ${band}). Để đạt ${goal} cần khoảng ${hours} giờ học có hướng dẫn – hãy bắt đầu lại nhịp học hằng ngày.`
}

function strengths(st: HabitStats): string[] {
  const out: string[] = []
  if (st.streak.current >= 3) out.push(`Chuỗi ${st.streak.current} ngày học liên tiếp – rất đáng khen.`)
  if (st.goalRate >= 1) out.push(`Đạt ${Math.round(st.goalRate * 100)}% mục tiêu thời gian học.`)
  if (st.avgScore !== null && st.avgScore >= 0.8)
    out.push(`Độ chính xác trung bình cao (${Math.round(st.avgScore * 100)}%).`)
  if (st.plan.rate !== null && st.plan.rate >= 0.7) out.push(`Hoàn thành ${Math.round(st.plan.rate * 100)}% kế hoạch.`)
  if (st.reviewAccuracy !== null && st.reviewAccuracy >= 0.8 && st.reviews >= 5)
    out.push(`Ôn ${st.reviews} thẻ với ${Math.round(st.reviewAccuracy * 100)}% nhớ đúng.`)
  if (st.consistency >= 70) out.push(`Điểm đều đặn ${st.consistency}/100 – thói quen đã hình thành.`)
  if (st.deltas && st.deltas.studyMinutes.change > 0)
    out.push(`Thời gian học tăng ${fmtMin(st.deltas.studyMinutes.change)} so với kỳ trước.`)
  if (!out.length && st.activeDays > 0) out.push(`Bạn đã học ${st.activeDays} ngày – mỗi buổi học đều có giá trị.`)
  return out.slice(0, 5)
}

function recommendations(st: HabitStats, ctx: AdviceContext): CoachRecommendation[] {
  const out: CoachRecommendation[] = []
  const weak = st.weakestSkills[0]
  const best = st.preferredHours[0]
  const goal = Math.max(10, ctx.dailyGoalMinutes)
  if (weak)
    out.push({
      title: `Ưu tiên kỹ năng ${SKILL_VI[weak]}`,
      why: `Đây là kỹ năng yếu nhất và chỉ chiếm ${Math.round(st.weakSkillShare * 100)}% thời gian học.`,
      action: `Mỗi ngày dành 15 phút cho ${SKILL_VI[weak]} trước khi học phần khác.`,
      route: SKILL_ROUTE[weak],
      minutes: 15,
    })
  if (ctx.dueCards > 0 || st.reviewBacklog > 0)
    out.push({
      title: 'Dọn thẻ từ đến hạn',
      why: `${Math.max(ctx.dueCards, st.reviewBacklog)} thẻ đang chờ ôn – ôn đúng hạn giúp nhớ lâu hơn.`,
      action: 'Ôn hết thẻ đến hạn trong 5–10 phút (gõ /review ngay trên Telegram).',
      route: '/vocabulary/review',
      minutes: 10,
    })
  if (st.activeDays < st.elapsedDays || st.consistency < 60)
    out.push({
      title: best !== undefined ? `Giữ khung giờ ${hourLabel(best)}` : 'Chọn một khung giờ cố định',
      why: `Bạn học ${st.activeDays}/${st.elapsedDays} ngày; học cùng giờ mỗi ngày giúp duy trì thói quen.`,
      action:
        best !== undefined
          ? `Đặt nhắc nhở lúc ${hourLabel(best)} và học ít nhất ${goal} phút.`
          : `Đặt nhắc nhở buổi tối và học ít nhất ${goal} phút.`,
      route: '/coach/schedule',
      minutes: goal,
    })
  if (st.plan.rate !== null && st.plan.rate < 0.6)
    out.push({
      title: 'Hoàn thành kế hoạch hôm nay',
      why: `Mới hoàn thành ${Math.round(st.plan.rate * 100)}% bài trong kế hoạch.`,
      action: 'Mở Hành trình và làm bài đầu tiên trong danh sách.',
      route: '/journey',
      minutes: 15,
    })
  if (out.length < 2)
    out.push({
      title: 'Luyện nói với gia sư AI',
      why: 'IELTS Speaking cần phản xạ – luyện hội thoại ngắn mỗi ngày.',
      action: 'Trò chuyện 10 phút về một chủ đề IELTS Part 1 (nhắn tin thoại cho bot cũng được).',
      route: '/tutor',
      minutes: 10,
    })
  return out.slice(0, 5)
}

export function offlinePlan(st: HabitStats, ctx: AdviceContext): CoachPlanDay[] {
  const weak = st.weakestSkills.length ? st.weakestSkills : (['listening', 'speaking'] as Skill[])
  const rotation: PlanModule[] = [...(weak as PlanModule[]), 'reading', 'listening', 'speaking', 'writing']
  const uniq = [...new Set(rotation)].filter((m) => m !== 'vocabulary')
  const minutes = Math.max(10, Math.min(120, ctx.dailyGoalMinutes))
  return ctx.planDates.map((day, i) => {
    const main = uniq[(i + (hashString(st.key) % 2)) % uniq.length] ?? 'listening'
    const name = SKILL_VI[main as Skill] ?? main
    return {
      day,
      focus: `Tập trung ${name}`,
      modules: [main, 'vocabulary'],
      activities: [`Một bài ${name} phù hợp trình độ`, 'Ôn thẻ từ đến hạn'],
      minutes,
    }
  })
}

export function offlineAdvice(st: HabitStats, ctx: AdviceContext): CoachAdvice {
  const headline =
    st.activeDays === 0
      ? 'Bắt đầu lại nhịp học – chỉ cần 10 phút hôm nay'
      : st.consistency >= 70
        ? 'Nhịp học rất đều – hãy giữ vững phong độ'
        : st.consistency >= 40
          ? 'Khá ổn – cần học đều đặn hơn'
          : 'Hãy xây lại thói quen học mỗi ngày'
  const deltaText = st.deltas
    ? ` So với kỳ trước: ${st.deltas.studyMinutes.change >= 0 ? '+' : ''}${Math.round(st.deltas.studyMinutes.change)} phút, ${st.deltas.activeDays.change >= 0 ? '+' : ''}${st.deltas.activeDays.change} ngày học.`
    : ''
  const summary =
    `${st.label.vi}: học ${fmtMin(st.studyMinutes)} trong ${st.activeDays}/${st.elapsedDays} ngày, ` +
    `${st.studySessions.count} buổi học (trung vị ${fmtMin(st.studySessions.medianMinutes)}), ` +
    `mở ứng dụng ${fmtMin(st.appMinutes)}. Điểm đều đặn ${st.consistency}/100.${deltaText}`
  const concerns = st.anomalies.map((a) => a.vi)
  if (!concerns.length) concerns.push('Chưa thấy vấn đề lớn – tiếp tục duy trì.')
  const best = st.preferredHours.length
    ? st.preferredHours.slice(0, 2).map((h) => `${hourLabel(h)}–${hourLabel((h + 1) % 24)} (giờ bạn học nhiều nhất)`)
    : ['20:00–21:00 (gợi ý: sau bữa tối, trước khi mệt)']
  return {
    headline,
    summary,
    strengths: strengths(st),
    concerns: concerns.slice(0, 5),
    recommendations: recommendations(st, ctx),
    bestStudyTimes: best,
    nextPeriodPlan: offlinePlan(st, ctx),
    motivation:
      st.streak.current > 0
        ? `Chuỗi ${st.streak.current} ngày đang chờ bạn nối dài – mỗi ngày một chút là đủ!`
        : 'Hôm nay là ngày tốt nhất để bắt đầu lại. 10 phút thôi!',
    ieltsOutlook: ieltsOutlookText(ctx.overallCefr, ctx.targetIelts, st),
  }
}

// ---------- briefs & nudges ----------
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

export function offlineEveningNudge(x: NudgeInput): string {
  const when = x.preferredHour !== null ? `Bạn thường học lúc ${hourLabel(x.preferredHour)}` : 'Tối nay còn thời gian'
  const what = `${x.suggestion.minutes} phút ${SKILL_VI[x.suggestion.skill]} tối nay nhé?`
  const streak = x.streak > 0 ? ` Giữ chuỗi ${x.streak} ngày!` : ''
  const due = x.dueCards > 0 ? ` (${x.dueCards} thẻ từ đang chờ.)` : ''
  return `${when} – ${what}${streak}${due}`
}

// ---------- Telegram HTML ----------
const WEEKDAY_VI = ['Thứ 2', 'Thứ 3', 'Thứ 4', 'Thứ 5', 'Thứ 6', 'Thứ 7', 'Chủ nhật']
const sign = (x: number) => (x > 0 ? `+${x}` : String(x))

export function statsLines(st: HabitStats): string[] {
  const lines = [
    `📚 Học: <b>${Math.round(st.studyMinutes)} phút</b> · ${st.activeDays}/${st.elapsedDays} ngày${st.deltas ? ` (${sign(Math.round(st.deltas.studyMinutes.change))} phút)` : ''}`,
    `🖥️ Mở app: ${Math.round(st.appMinutes)} phút · ${st.appSessions.count} phiên`,
    `⏱️ Buổi học: ${st.studySessions.count} (trung vị ${Math.round(st.studySessions.medianMinutes)} phút)`,
    `🎯 Đều đặn: <b>${st.consistency}/100</b> · 🔥 chuỗi ${st.streak.current} ngày`,
  ]
  if (st.preferredHours.length) lines.push(`🕘 Giờ học nhiều nhất: ${st.preferredHours.map(hourLabel).join(', ')}`)
  if (st.avgScore !== null) lines.push(`✅ Độ chính xác TB: ${Math.round(st.avgScore * 100)}%`)
  if (st.plan.total) lines.push(`🗓️ Kế hoạch: ${st.plan.done}/${st.plan.total} bài`)
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
  return [
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
    .join('\n')
    .slice(0, 3800)
}

export function planHtml(r: CoachReport): string {
  const parts = [`<b>🗓️ Kế hoạch AI</b> (${esc(r.label.vi)})`]
  for (const d of r.advice.nextPeriodPlan.slice(0, 7))
    parts.push(
      '',
      `<b>${esc(d.day)}</b> – ${esc(d.focus)} (${d.minutes} phút)`,
      ...d.activities.map((x) => `• ${esc(x)}`),
    )
  parts.push('', '<i>Muốn đưa kế hoạch vào Hành trình? Mở B&amp;T English → AI Coach → Áp dụng kế hoạch.</i>')
  return parts.join('\n').slice(0, 3800)
}

export function habitsHtml(week: HabitStats, last28: HabitStats): string {
  const parts = [`<b>📈 Thói quen học – ${esc(week.label.vi)}</b>`, ...statsLines(week), '', '<b>28 ngày qua</b>']
  parts.push(`Học ${Math.round(last28.studyMinutes)} phút trong ${last28.activeDays} ngày`)
  if (last28.preferredWeekdays.length)
    parts.push(`Ngày học nhiều nhất: ${last28.preferredWeekdays.map((d) => WEEKDAY_VI[d]).join(', ')}`)
  if (last28.weakestSkills.length)
    parts.push(
      `Kỹ năng yếu: ${last28.weakestSkills.map((x) => SKILL_VI[x]).join(', ')} (${Math.round(last28.weakSkillShare * 100)}% thời gian)`,
    )
  for (const a of week.anomalies.slice(0, 3)) parts.push(`⚠️ ${esc(a.vi)}`)
  return parts.join('\n')
}

/** /report argument → period (Vietnamese with or without diacritics, or English). */
export function parsePeriodArg(args: string): CoachPeriod {
  const a = foldVi(args)
  if (/^(tuan|week|w)\b/.test(a)) return 'week'
  if (/^(thang|month|m)\b/.test(a)) return 'month'
  return 'day'
}

// ---------- AI prompts ----------
const COACH_ROLE =
  'You are an expert, warm English-learning coach for a Vietnamese adult preparing for IELTS (goal band 6.5). ' +
  'You analyse the learner’s real study-habit data and give concrete, actionable advice. Never invent numbers that are not in the data.'
const VI_FIRST =
  'Write every text field primarily in Vietnamese (tiếng Việt có dấu), addressing the learner as "bạn"; keep English terms like IELTS Band in English.'
const JSON_ONLY =
  'Respond with a single valid JSON object only – no markdown fences, no commentary. Use exactly the fields described.'

export function compactStats(st: HabitStats) {
  return {
    period: st.period,
    label: st.label.en,
    from: st.from,
    to: st.to,
    elapsedDays: st.elapsedDays,
    activeDays: st.activeDays,
    studyMinutes: st.studyMinutes,
    appMinutes: st.appMinutes,
    dailyGoalMinutes: st.dailyGoalMinutes,
    goalRate: st.goalRate,
    studySessions: { count: st.studySessions.count, medianMinutes: st.studySessions.medianMinutes },
    preferredHours: st.preferredHours.map(hourLabel),
    preferredWeekdays: st.preferredWeekdays.map((d) => ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'][d]),
    skillMix: Object.fromEntries(st.skillMix.map((m) => [m.skill, m.minutes])),
    moduleMix: st.moduleMix.slice(0, 8).map((m) => `${m.module}: ${m.studyMinutes} min`),
    weakestSkills: st.weakestSkills,
    weakSkillShare: st.weakSkillShare,
    avgScore: st.avgScore,
    reviews: st.reviews,
    reviewAccuracy: st.reviewAccuracy,
    wordsSaved: st.wordsSaved,
    reviewBacklog: st.reviewBacklog,
    plan: st.plan,
    quests: st.quests,
    streak: st.streak,
    consistency: st.consistency,
    anomalies: st.anomalies.map((a) => a.en),
    deltas: st.deltas
      ? Object.fromEntries(Object.entries(st.deltas).map(([k, d]) => [k, `${d.previous} → ${d.current}`]))
      : null,
  }
}

/** Validates and normalises AI advice (allowed routes, plan days restricted to the requested dates). */
export function validateAdvice(raw: unknown, ctx: AdviceContext, offline: CoachAdvice): CoachAdvice {
  if (!isObj(raw)) throw new InvalidOutput('Expected a JSON object.')
  const recs = objList(raw.recommendations, 6).map((r) => ({
    title: str(r.title, 120, { required: 'recommendations.title' }),
    why: str(r.why, 400, { fallback: '' }),
    action: str(r.action, 400, { required: 'recommendations.action' }),
    route: sanitizeRoute(str(r.route, 80, { fallback: '/journey' })),
    minutes: Math.max(1, Math.min(180, Math.round(Number(r.minutes) || 10))),
  }))
  if (!recs.length) throw new InvalidOutput('recommendations must contain 1–5 items.')
  const seen = new Set<string>()
  const plan = objList(raw.nextPeriodPlan, 7)
    .map((d) => ({
      day: str(d.day, 10),
      focus: str(d.focus, 160, { fallback: 'Ôn tập' }),
      modules: [
        ...new Set(strList(d.modules, 3, 20).filter((m): m is PlanModule => PLAN_MODULES.includes(m as PlanModule))),
      ],
      activities: strList(d.activities, 4, 200),
      minutes: Math.max(5, Math.min(180, Math.round(Number(d.minutes) || ctx.dailyGoalMinutes))),
    }))
    .filter(
      (d) =>
        ctx.planDates.includes(d.day) && d.modules.length && d.activities.length && !seen.has(d.day) && seen.add(d.day),
    )
    .sort((a, b) => (a.day < b.day ? -1 : 1))
  return {
    headline: str(raw.headline, 200, { required: 'headline' }),
    summary: str(raw.summary, 1200, { required: 'summary' }),
    strengths: strList(raw.strengths, 6, 300),
    concerns: strList(raw.concerns, 6, 300),
    recommendations: recs,
    bestStudyTimes: strList(raw.bestStudyTimes, 4, 120),
    nextPeriodPlan: plan.length ? plan : offline.nextPeriodPlan,
    motivation: str(raw.motivation, 400, { fallback: offline.motivation }),
    ieltsOutlook: str(raw.ieltsOutlook, 600, { fallback: offline.ieltsOutlook }),
  }
}

export async function aiAdvice(
  ai: AiModel,
  st: HabitStats,
  ctx: AdviceContext,
  skills: { skill: string; cefr: string }[],
  learnerLine: string,
  offline: CoachAdvice,
): Promise<CoachAdvice> {
  return generateJson(
    ai,
    {
      temperature: 0.5,
      maxOutputTokens: 3000,
      system: [
        COACH_ROLE,
        learnerLine,
        VI_FIRST,
        'Output fields: headline (≤ 15 words), summary (3–4 sentences interpreting the numbers and the changes vs the previous period), ' +
          'strengths[] and concerns[] (habit-based, 1–5 items each), recommendations[] (2–5 items: title, why (cite the data), action (specific, doable today), ' +
          'route (one of /listening /speaking /reading /writing /grammar /vocabulary /vocabulary/review /cinema /tutor /journey /coach/schedule), minutes), ' +
          'bestStudyTimes[] (time windows with a reason, based on preferredHours), ' +
          `nextPeriodPlan[] (exactly one entry for each of these dates: ${ctx.planDates.join(', ')}; ` +
          'fields day, focus, modules (1–3 of listening, speaking, reading, writing, grammar, vocabulary, cinema, tutor; prioritise the weakest skills), ' +
          'activities (1–4 short items), minutes (close to the daily goal)), motivation (1–2 sentences), ieltsOutlook (realistic, 1–3 sentences).',
        JSON_ONLY,
      ].join('\n'),
      messages: [
        {
          role: 'user',
          content: JSON.stringify({
            habitStats: compactStats(st),
            skillLevels: skills,
            targetIelts: ctx.targetIelts ?? 6.5,
            ruleBasedDraft: { headline: offline.headline, concerns: offline.concerns },
          }),
        },
      ],
    },
    (raw) => validateAdvice(raw, ctx, offline),
  )
}

const plainText = (text: string, max: number) =>
  text
    .replace(/\*\*|__|^#+\s*/gm, '')
    .trim()
    .slice(0, max)

export async function aiMorningBrief(ai: AiModel, input: BriefInput, learnerLine: string): Promise<string> {
  const text = await ai.generate({
    temperature: 0.7,
    maxOutputTokens: 400,
    system: [
      COACH_ROLE,
      learnerLine,
      VI_FIRST,
      'Write a short, energising morning brief (2–4 sentences, ≤ 60 words, plain text, no markdown): greet, mention yesterday, ' +
        'what to do today (use the plan), the best time to study based on the habit data, and one tiny motivating fact.',
    ].join('\n'),
    messages: [{ role: 'user', content: JSON.stringify(input) }],
  })
  return plainText(text, 700)
}

export async function aiEveningNudge(ai: AiModel, input: NudgeInput, learnerLine: string): Promise<string> {
  const text = await ai.generate({
    temperature: 0.7,
    maxOutputTokens: 200,
    system: [
      COACH_ROLE,
      learnerLine,
      VI_FIRST,
      'The learner has not studied today. Write ONE friendly reminder (≤ 30 words, plain text) tailored to the habit data, e.g. ' +
        '"Bạn thường học lúc 21:00 – 15 phút luyện nghe tối nay nhé?". Mention the suggested activity and minutes.',
    ].join('\n'),
    messages: [{ role: 'user', content: JSON.stringify(input) }],
  })
  return plainText(text, 300)
}
