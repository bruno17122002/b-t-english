// Learner data on the server, read from sync_rows (tbl = local SQLite table, data = the local row with local column
// names, see docs/ONLINE_PLAN.md). Builds the same context and /today summary as the in-app bot
// (src/main/kernel/telegram/context.ts), but in the learner's time zone. Also writes rows back (reviews, saved words).
import { addDays, computeStreak, dateKeyIn, DEFAULT_TIMEZONE, validTimeZone, weekdayOf } from './dates.ts'
import { escapeHtml } from './format.ts'
import { eq, inList, type Filters, type UserRest } from './rest.ts'
import { sortDue, type ScheduleRow } from './srs.ts'
import type { TelegramButton } from './telegram.ts'

export type Cefr = 'A1' | 'A2' | 'B1' | 'B2' | 'C1' | 'C2'
export const CEFR_LEVELS: Cefr[] = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2']
export type Skill = 'vocabulary' | 'grammar' | 'reading' | 'listening' | 'writing' | 'speaking'
export const SKILLS: Skill[] = ['vocabulary', 'grammar', 'reading', 'listening', 'writing', 'speaking']

export interface SyncRow {
  tbl: string
  row_key: string
  data: Record<string, unknown>
  client_updated_at: string
  deleted?: boolean
}

export interface Profile {
  displayName: string
  overallCefr: Cefr | null
  selfReportedLevel: string
  targetCefr: Cefr
  targetIelts: number | null
  dailyMinutes: number
  interests: string[]
}

export interface RawActivity {
  createdAt: string
  date: string
  module: string
  action: string
  title: string
  skill: Skill | null
  minutes: number
  xp: number
  score: number | null
}

export interface VocabRow {
  word: string
  word_key: string
  ipa?: string
  pos?: string
  meaning_vi?: string
  meaning_en?: string
  examples?: string | string[]
  [extra: string]: unknown
}

export interface LessonRow {
  date: string
  module: string
  title: string
  status: 'todo' | 'done' | 'skipped'
  estimated_minutes: number
  position: number
}

export interface LearnerData {
  timezone: string
  profile: Profile
  skills: { skill: Skill; cefr: Cefr; score: number }[]
  vocab: Map<string, VocabRow>
  /** word_key → schedule row and its client_updated_at. */
  schedules: Map<string, { row: ScheduleRow; updatedAt: string }>
  activities: RawActivity[]
  reviews: { reviewedAt: string; rating: number }[]
  lessons: LessonRow[]
  mistakes: { category: string; pattern: string; correction: string; count: number; lastSeenAt: string }[]
  quests: {
    period: string
    periodKey: string
    titleVi: string
    title: string
    progress: number
    target: number
    xpReward: number
    completed: boolean
  }[]
  sessions: { id: string; startedAt: string; lastActiveAt: string; date: string; activeSeconds: number }[]
  coachReports: { period: string; periodKey: string; headline: string; summary: string; createdAt: string }[]
  /** Oldest day for which logs were loaded. */
  since: string
}

// ---------- tolerant field readers ----------
const s = (v: unknown, d = ''): string => (typeof v === 'string' ? v : v === null || v === undefined ? d : String(v))
const n = (v: unknown, d = 0): number => {
  const x = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(x) ? x : d
}
const nullableNum = (v: unknown): number | null => {
  if (v === null || v === undefined || v === '') return null
  const x = Number(v)
  return Number.isFinite(x) ? x : null
}
export function jsonList(v: unknown): string[] {
  if (Array.isArray(v)) return v.map((x) => s(x)).filter(Boolean)
  if (typeof v === 'string' && v.trim().startsWith('[')) {
    try {
      return jsonList(JSON.parse(v))
    } catch {
      return []
    }
  }
  return []
}
const cefr = (v: unknown): Cefr | null => (CEFR_LEVELS.includes(v as Cefr) ? (v as Cefr) : null)
const skill = (v: unknown): Skill | null => (SKILLS.includes(v as Skill) ? (v as Skill) : null)

const SELF_LEVEL_TO_CEFR: Record<string, Cefr> = {
  beginner: 'A1',
  elementary: 'A2',
  intermediate: 'B1',
  upper: 'B2',
  advanced: 'C1',
}

export function overallCefr(p: Profile): Cefr {
  return p.overallCefr ?? SELF_LEVEL_TO_CEFR[p.selfReportedLevel] ?? 'A1'
}

/** Same as weakestSkills() in src/core/roadmap.ts. */
export function weakestSkills(skills: { skill: Skill; cefr: Cefr; score: number }[], k = 2): Skill[] {
  return [...skills]
    .sort((a, b) => CEFR_LEVELS.indexOf(a.cefr) * 100 + a.score - (CEFR_LEVELS.indexOf(b.cefr) * 100 + b.score))
    .slice(0, k)
    .map((x) => x.skill)
}

// ---------- loading ----------
const PAGE = 1000
const MAX_PAGES = 20

async function pages(user: UserRest, filters: Filters, order: string): Promise<SyncRow[]> {
  const out: SyncRow[] = []
  for (let page = 0; page < MAX_PAGES; page++) {
    const rows = await user.select<SyncRow>('sync_rows', [['deleted', 'eq.false'], ...filters], {
      select: 'tbl,row_key,data,client_updated_at',
      order,
      limit: PAGE,
      offset: page * PAGE,
    })
    out.push(...rows)
    if (rows.length < PAGE) break
  }
  return out
}

export interface LoadOptions {
  /** Days of logs (activity, reviews, lessons, sessions) to load; 60 by default. */
  sinceDays?: number
  /** Skip the vocabulary table (schedules are always loaded). */
  skipVocab?: boolean
}

export async function loadTimezone(user: UserRest, fallback?: string | null): Promise<string> {
  const rows = await user.select<{ timezone: string | null }>('profiles', [], { select: 'timezone', limit: 1 })
  const tz = rows[0]?.timezone
  if (validTimeZone(tz)) return tz
  return validTimeZone(fallback) ? fallback : DEFAULT_TIMEZONE
}

export async function loadLearner(
  user: UserRest,
  now: Date,
  opts: LoadOptions & { timezone?: string } = {},
): Promise<LearnerData> {
  const timezone = opts.timezone ?? (await loadTimezone(user))
  const today = dateKeyIn(now, timezone)
  const since = addDays(today, -(opts.sinceDays ?? 60))
  const sinceIso = new Date(now.getTime() - ((opts.sinceDays ?? 60) + 1) * 86_400_000).toISOString()
  const small = [
    'user_profile',
    'skill_levels',
    'learner_mistakes',
    'review_schedules',
    ...(opts.skipVocab ? [] : ['vocabulary']),
  ]
  const [base, acts, reviews, lessons, quests, sessions, reports] = await Promise.all([
    pages(user, [['tbl', inList(small)]], 'tbl.asc,row_key.asc'),
    pages(
      user,
      [
        ['tbl', eq('activity_log')],
        ['data->>date', `gte.${since}`],
      ],
      'row_key.asc',
    ),
    pages(
      user,
      [
        ['tbl', eq('review_logs')],
        ['data->>reviewed_at', `gte.${sinceIso}`],
      ],
      'row_key.asc',
    ),
    pages(
      user,
      [
        ['tbl', eq('lessons')],
        ['data->>date', `gte.${since}`],
      ],
      'row_key.asc',
    ),
    pages(
      user,
      [
        ['tbl', eq('quests')],
        ['data->>period_key', `gte.${addDays(today, -1)}`],
      ],
      'row_key.asc',
    ),
    pages(
      user,
      [
        ['tbl', eq('coach_sessions')],
        ['data->>date', `gte.${since}`],
      ],
      'row_key.asc',
    ),
    user.select<SyncRow>(
      'sync_rows',
      [
        ['tbl', eq('coach_reports')],
        ['deleted', 'eq.false'],
      ],
      {
        select: 'tbl,row_key,data,client_updated_at',
        order: 'client_updated_at.desc',
        limit: 6,
      },
    ),
  ])
  return buildLearner([...base, ...acts, ...reviews, ...lessons, ...quests, ...sessions, ...reports], timezone, since)
}

/** Builds LearnerData from raw sync rows (also used directly by tests). */
export function buildLearner(rows: SyncRow[], timezone: string, since = '0000-00-00'): LearnerData {
  const by = (tbl: string) => rows.filter((r) => r.tbl === tbl && !r.deleted)
  const p = by('user_profile')[0]?.data ?? {}
  const profile: Profile = {
    displayName: s(p.display_name),
    overallCefr: cefr(p.overall_cefr),
    selfReportedLevel: s(p.self_reported_level, 'beginner'),
    targetCefr: cefr(p.target_cefr) ?? 'B2',
    targetIelts: nullableNum(p.target_ielts),
    dailyMinutes: Math.max(5, n(p.daily_minutes, 20)),
    interests: jsonList(p.interests),
  }
  const skills = by('skill_levels')
    .map((r) => ({ skill: skill(r.data.skill ?? r.row_key), cefr: cefr(r.data.cefr), score: n(r.data.score) }))
    .filter((x): x is { skill: Skill; cefr: Cefr; score: number } => !!x.skill && !!x.cefr)
  const vocab = new Map<string, VocabRow>()
  for (const r of by('vocabulary')) {
    const key = s(r.data.word_key) || r.row_key
    vocab.set(key, { ...(r.data as VocabRow), word_key: key, word: s(r.data.word, key) })
  }
  const schedules = new Map<string, { row: ScheduleRow; updatedAt: string }>()
  for (const r of by('review_schedules')) {
    const key = s(r.data.word_key) || r.row_key
    if (!s(r.data.due_at)) continue
    schedules.set(key, { row: { ...(r.data as ScheduleRow), word_key: key }, updatedAt: r.client_updated_at })
  }
  const activities = by('activity_log')
    .map<RawActivity>((r) => ({
      createdAt: s(r.data.created_at, r.client_updated_at),
      date: s(r.data.date),
      module: s(r.data.module),
      action: s(r.data.action),
      title: s(r.data.title),
      skill: skill(r.data.skill),
      minutes: n(r.data.minutes),
      xp: n(r.data.xp),
      score: nullableNum(r.data.score),
    }))
    .filter((a) => a.date)
    .sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1))
  const reviews = by('review_logs').map((r) => ({ reviewedAt: s(r.data.reviewed_at), rating: n(r.data.rating) }))
  const lessons = by('lessons')
    .map<LessonRow>((r) => ({
      date: s(r.data.date),
      module: s(r.data.module),
      title: s(r.data.title),
      status: (['todo', 'done', 'skipped'].includes(s(r.data.status))
        ? s(r.data.status)
        : 'todo') as LessonRow['status'],
      estimated_minutes: n(r.data.estimated_minutes, 10),
      position: n(r.data.position),
    }))
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.position - b.position))
  const mistakes = by('learner_mistakes')
    .map((r) => ({
      category: s(r.data.category, 'grammar'),
      pattern: s(r.data.pattern),
      correction: s(r.data.correction),
      count: n(r.data.count, 1),
      lastSeenAt: s(r.data.last_seen_at),
    }))
    .filter((m) => m.pattern)
    .sort((a, b) => b.count - a.count || (a.lastSeenAt < b.lastSeenAt ? 1 : -1))
  const quests = by('quests').map((r) => ({
    period: s(r.data.period),
    periodKey: s(r.data.period_key),
    titleVi: s(r.data.title_vi),
    title: s(r.data.title),
    progress: n(r.data.progress),
    target: Math.max(1, n(r.data.target, 1)),
    xpReward: n(r.data.xp_reward),
    completed: !!r.data.completed_at,
  }))
  const sessions = by('coach_sessions').map((r) => ({
    id: s(r.data.id, r.row_key),
    startedAt: s(r.data.started_at),
    lastActiveAt: s(r.data.last_active_at),
    date: s(r.data.date),
    activeSeconds: n(r.data.active_seconds),
  }))
  const coachReports = by('coach_reports').map((r) => {
    let advice: Record<string, unknown> = {}
    try {
      advice = typeof r.data.advice === 'string' ? (JSON.parse(r.data.advice) as Record<string, unknown>) : {}
    } catch {
      advice = {}
    }
    return {
      period: s(r.data.period),
      periodKey: s(r.data.period_key),
      headline: s(advice.headline),
      summary: s(advice.summary),
      createdAt: s(r.data.created_at, r.client_updated_at),
    }
  })
  return {
    timezone,
    profile,
    skills,
    vocab,
    schedules,
    activities,
    reviews,
    lessons,
    mistakes,
    quests,
    sessions,
    coachReports,
    since,
  }
}

// ---------- derived values ----------
export const scheduleRows = (d: LearnerData) => [...d.schedules.values()].map((x) => x.row)
export const dueCount = (d: LearnerData, now: Date) => sortDue(scheduleRows(d), now).length
export const activeDays = (d: LearnerData) => [...new Set(d.activities.map((a) => a.date))].sort()
export const todayLessons = (d: LearnerData, today: string) => d.lessons.filter((l) => l.date === today)
export const studiedOn = (d: LearnerData, day: string) => d.activities.some((a) => a.date === day)
export const minutesOn = (d: LearnerData, day: string) =>
  d.activities.filter((a) => a.date === day).reduce((sum, a) => sum + Math.max(0, a.minutes), 0)
export const xpOn = (d: LearnerData, day: string) =>
  d.activities.filter((a) => a.date === day).reduce((sum, a) => sum + Math.max(0, a.xp), 0)

const MODULE_VI: Record<string, string> = {
  listening: 'Nghe',
  speaking: 'Nói',
  reading: 'Đọc',
  writing: 'Viết',
  grammar: 'Ngữ pháp',
  vocabulary: 'Từ vựng',
  cinema: 'Phim',
  tutor: 'Gia sư',
  assessment: 'Kiểm tra',
}

export const SKILL_VI: Record<string, string> = {
  vocabulary: 'Từ vựng',
  grammar: 'Ngữ pháp',
  reading: 'Đọc',
  listening: 'Nghe',
  writing: 'Viết',
  speaking: 'Nói',
}

const WEEKDAY_VI = ['Chủ nhật', 'Thứ 2', 'Thứ 3', 'Thứ 4', 'Thứ 5', 'Thứ 6', 'Thứ 7']

/** Compact learner context for the tutor prompt (same lines as the in-app bot). */
export function learnerContext(d: LearnerData, now: Date): string {
  const today = dateKeyIn(now, d.timezone)
  const lessons = todayLessons(d, today)
  const done = lessons.filter((l) => l.status === 'done').length
  const todo = lessons.filter((l) => l.status === 'todo')
  const streak = computeStreak(activeDays(d), today)
  const recent = [...d.activities].reverse().slice(0, 6)
  const p = d.profile
  const lines = [
    `Name: ${p.displayName || 'learner'}; overall CEFR ${overallCefr(p)}, target ${p.targetCefr}${p.targetIelts ? ` (IELTS ${p.targetIelts})` : ''}; daily goal ${p.dailyMinutes} min.`,
    d.skills.length
      ? `Skill levels: ${d.skills.map((x) => `${x.skill} ${x.cefr}`).join(', ')}.`
      : 'Skill levels: not assessed yet.',
    d.mistakes.length
      ? `Recurring mistakes:\n${d.mistakes
          .slice(0, 6)
          .map((m) => `- [${m.category}] ${m.pattern}${m.correction ? ` → ${m.correction}` : ''} (×${m.count})`)
          .join('\n')}`
      : 'Recurring mistakes: none recorded yet.',
    `Flashcards due now: ${dueCount(d, now)}.`,
    `Streak: ${streak.current} day(s); studied today: ${streak.activeToday ? 'yes' : 'not yet'}; minutes today: ${Math.round(minutesOn(d, today))}; XP today: ${xpOn(d, today)}.`,
    lessons.length
      ? `Today's plan: ${done}/${lessons.length} done.${todo.length ? ` Still to do: ${todo.map((l) => `${l.title} (${l.module})`).join('; ')}.` : ''}`
      : "Today's plan: no plan generated for today.",
    recent.length
      ? `Recent activity: ${recent.map((a) => `${a.action}${a.title ? ` "${a.title.slice(0, 40)}"` : ''}`).join('; ')}.`
      : 'Recent activity: none yet.',
  ]
  const report = d.coachReports[0]
  if (report?.headline) lines.push(`Latest coach report (${report.period} ${report.periodKey}): ${report.headline}.`)
  if (p.interests.length) lines.push(`Interests: ${p.interests.slice(0, 6).join(', ')}.`)
  return lines.join('\n')
}

/** One-line learner profile for system prompts. */
export function learnerLine(d: LearnerData): string {
  const interests = d.profile.interests.length ? ` Interests: ${d.profile.interests.slice(0, 5).join(', ')}.` : ''
  return `The learner is Vietnamese, overall CEFR ${overallCefr(d.profile)}, aiming for ${d.profile.targetCefr} (≈ IELTS ${d.profile.targetIelts ?? 6.5}).${interests}`
}

/** HTML for /today with quick-action buttons (in the learner's time zone). */
export function todayReply(d: LearnerData, now: Date): { html: string; buttons: TelegramButton[][] } {
  const today = dateKeyIn(now, d.timezone)
  const [y, m, day] = today.split('-')
  const date = `${WEEKDAY_VI[weekdayOf(today)]}, ${day}/${m}/${y}`
  const streak = computeStreak(activeDays(d), today)
  const p = d.profile
  const lessons = todayLessons(d, today)
  const done = lessons.filter((l) => l.status === 'done').length
  const quests = d.quests.filter((q) => q.period === 'daily' && q.periodKey === today)
  const due = dueCount(d, now)
  const out: string[] = [
    `📅 <b>Hôm nay – ${date}</b>`,
    `🔥 Chuỗi: <b>${streak.current} ngày</b> ${streak.activeToday ? '(hôm nay đã học ✅)' : '(hôm nay chưa học)'}`,
    `⭐ XP hôm nay: <b>${xpOn(d, today)}</b> · ⏱ ${Math.round(minutesOn(d, today))}/${p.dailyMinutes} phút`,
    `🎯 Trình độ: <b>${overallCefr(p)}</b> → mục tiêu ${p.targetCefr}${p.targetIelts ? ` (IELTS ${p.targetIelts})` : ''}`,
    '',
  ]
  if (lessons.length) {
    out.push(`📚 <b>Kế hoạch hôm nay</b> (${done}/${lessons.length})`)
    for (const l of lessons) {
      const mark = l.status === 'done' ? '✅' : l.status === 'skipped' ? '⏭' : '⬜'
      out.push(`${mark} ${escapeHtml(l.title)} <i>(${MODULE_VI[l.module] ?? l.module}, ${l.estimated_minutes}′)</i>`)
    }
  } else out.push('📚 Chưa có kế hoạch cho hôm nay – mở Lingua Quest → Hành trình để tạo lộ trình.')
  if (quests.length) {
    out.push('', '🏆 <b>Nhiệm vụ ngày</b>')
    for (const q of quests)
      out.push(
        `${q.completed ? '✅' : '▫️'} ${escapeHtml(q.titleVi || q.title)} – ${Math.round(q.progress)}/${q.target} (+${q.xpReward} XP)`,
      )
  }
  out.push('', due ? `🃏 Thẻ từ cần ôn: <b>${due}</b> → /review` : '🃏 Không có thẻ từ nào cần ôn. Tuyệt vời!')
  out.push('<i>(Dữ liệu theo lần đồng bộ gần nhất của app.)</i>')
  const buttons: TelegramButton[][] = [
    [
      ...(due ? [{ text: `🃏 Ôn ${due} thẻ`, data: 'review:start' }] : []),
      { text: '❓ Quiz', data: 'quiz:new' },
      { text: '📖 Từ mới', data: 'word:new' },
    ],
  ]
  return { html: out.join('\n'), buttons }
}

// ---------- writing rows back ----------
export interface OutRow {
  tbl: string
  row_key: string
  data: Record<string, unknown>
  client_updated_at: string
  deleted?: boolean
}

/**
 * client_updated_at for an edited row: the server time, but never older than the stored version (a device clock that
 * runs ahead must not make the server's change lose last-writer-wins on the desktops).
 */
export function nextUpdatedAt(now: Date, previous?: string | null): string {
  const prev = previous ? new Date(previous).getTime() : NaN
  const t = Number.isFinite(prev) && prev >= now.getTime() ? prev + 1 : now.getTime()
  return new Date(t).toISOString()
}

/** Upserts rows into sync_rows (a fresh seq is assigned, so every desktop pulls them on its next sync). */
export async function pushRows(user: UserRest, rows: OutRow[]): Promise<void> {
  if (!rows.length) return
  await user.insert(
    'sync_rows',
    rows.map((r) => ({ ...r, deleted: r.deleted ?? false, device_id: null })),
    { onConflict: 'user_id,tbl,row_key', resolution: 'merge' },
  )
}

export const wordKeyOf = (w: string) => w.trim().toLowerCase().replace(/\s+/g, ' ')

/** examples column may be a JSON string (SQLite TEXT) or an array. */
export const examplesOf = (v: VocabRow) => jsonList(v.examples)
