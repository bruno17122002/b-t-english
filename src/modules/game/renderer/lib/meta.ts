// Small pure helpers and bilingual metadata for the game and statistics pages.
import { ACCENT_UNLOCKS } from '@core/game'
import { addDays } from '@core/dates'
import { CEFR_LEVELS, type Cefr } from '@shared/content'
import type { Achievement, Quest, Skill } from '@shared/types'

/** Bilingual label (same shape as regions.ts `Bi`; kept local so this file has no sibling imports). */
type Bi = { en: string; vi: string }

/** Vietnamese names for the level titles produced by core/game levelTitle(). */
export const LEVEL_TITLE_VI: Record<string, string> = {
  Wanderer: 'Lữ khách',
  Explorer: 'Nhà thám hiểm',
  Pathfinder: 'Người mở lối',
  Adventurer: 'Nhà phiêu lưu',
  Voyager: 'Hành giả viễn du',
  Ranger: 'Kiểm lâm',
  Sage: 'Hiền giả',
  Legend: 'Huyền thoại',
}

export function levelTitleBi(title: string): Bi {
  return { en: title, vi: LEVEL_TITLE_VI[title] ?? title }
}

export interface AccentTheme {
  key: string
  level: number
  name: Bi
  /** Flat swatch colour (Windows accent colour) – mirrors the CSS accent tokens. Single-element tuple kept for compatibility. */
  swatch: [string, string]
}

const ACCENT_META: Record<string, { name: Bi; swatch: [string, string] }> = {
  aurora: { name: { en: 'Windows Blue', vi: 'Xanh Windows' }, swatch: ['#0078d4', '#0078d4'] },
  ember: { name: { en: 'Ember', vi: 'Than hồng' }, swatch: ['#ca5010', '#ca5010'] },
  jade: { name: { en: 'Jade', vi: 'Ngọc bích' }, swatch: ['#107c10', '#107c10'] },
  royal: { name: { en: 'Royal', vi: 'Hoàng gia' }, swatch: ['#8764b8', '#8764b8'] },
  sunset: { name: { en: 'Sunset', vi: 'Hoàng hôn' }, swatch: ['#c239b3', '#c239b3'] },
}

export function accentThemes(): AccentTheme[] {
  return ACCENT_UNLOCKS.map((a) => {
    const meta = ACCENT_META[a.key] ?? {
      name: { en: a.key, vi: a.key },
      swatch: ['#0078d4', '#0078d4'] as [string, string],
    }
    return { key: a.key, level: a.level, ...meta }
  })
}

/** The next accent the learner will unlock, or null when all are unlocked. */
export function nextAccentUnlock(level: number): AccentTheme | null {
  return accentThemes().find((a) => a.level > level) ?? null
}

/** Quest progress as 0..1. */
export function questFraction(q: Pick<Quest, 'progress' | 'target' | 'completedAt'>): number {
  if (q.completedAt) return 1
  if (q.target <= 0) return 0
  return Math.max(0, Math.min(1, q.progress / q.target))
}

/** Speaking quests count seconds; show them as whole minutes. */
export function questDisplay(q: Pick<Quest, 'metric' | 'progress' | 'target'>): {
  value: number
  target: number
  unit: Bi | null
} {
  if (q.metric === 'speaking_seconds')
    return {
      value: Math.floor(q.progress / 60),
      target: Math.round(q.target / 60),
      unit: { en: 'min', vi: 'phút' },
    }
  if (q.metric === 'minutes')
    return { value: Math.floor(q.progress), target: q.target, unit: { en: 'min', vi: 'phút' } }
  return { value: Math.min(q.progress, q.target), target: q.target, unit: null }
}

export type AchievementFilter = 'all' | 'unlocked' | 'locked'

/** Unlocked first (newest first), then locked by how close they are. */
export function sortAchievements(list: Achievement[]): Achievement[] {
  return [...list].sort((a, b) => {
    if (!!a.unlockedAt !== !!b.unlockedAt) return a.unlockedAt ? -1 : 1
    if (a.unlockedAt && b.unlockedAt) return b.unlockedAt.localeCompare(a.unlockedAt)
    return b.progress - a.progress
  })
}

export function filterAchievements(list: Achievement[], filter: AchievementFilter): Achievement[] {
  if (filter === 'unlocked') return list.filter((a) => !!a.unlockedAt)
  if (filter === 'locked') return list.filter((a) => !a.unlockedAt)
  return list
}

/** When the rest-day shield recharges (7 days after the most recent bridged day). */
export function restDayRechargeDate(restDaysUsedRecently: string[]): string | null {
  if (!restDaysUsedRecently.length) return null
  const last = restDaysUsedRecently.reduce((a, b) => (a > b ? a : b))
  return addDays(last, 7)
}

export const SKILL_LABELS: Record<Skill, Bi> = {
  vocabulary: { en: 'Vocabulary', vi: 'Từ vựng' },
  grammar: { en: 'Grammar', vi: 'Ngữ pháp' },
  reading: { en: 'Reading', vi: 'Đọc' },
  listening: { en: 'Listening', vi: 'Nghe' },
  writing: { en: 'Writing', vi: 'Viết' },
  speaking: { en: 'Speaking', vi: 'Nói' },
}

/** Labels for activity_log actions (ActivityType). Unknown actions fall back to the raw key. */
export const ACTION_LABELS: Record<string, Bi> = {
  word_saved: { en: 'Saved a word', vi: 'Lưu từ mới' },
  review_done: { en: 'Flashcard review', vi: 'Ôn thẻ từ' },
  lesson_completed: { en: 'Lesson completed', vi: 'Hoàn thành bài học' },
  listening_done: { en: 'Listening', vi: 'Luyện nghe' },
  speaking_done: { en: 'Speaking', vi: 'Luyện nói' },
  reading_done: { en: 'Reading', vi: 'Luyện đọc' },
  writing_submitted: { en: 'Writing submitted', vi: 'Nộp bài viết' },
  grammar_done: { en: 'Grammar drill', vi: 'Thử thách ngữ pháp' },
  cinema_scene: { en: 'Cinema scene', vi: 'Cảnh phim' },
  story_completed: { en: 'Story finished', vi: 'Xem hết phim' },
  tutor_message: { en: 'Tutor chat', vi: 'Trò chuyện gia sư' },
  assessment_done: { en: 'Assessment', vi: 'Bài đánh giá' },
}

export function actionLabel(action: string): Bi {
  return Object.hasOwn(ACTION_LABELS, action) ? (ACTION_LABELS[action] as Bi) : { en: action, vi: action }
}

export const GOAL_METRIC_LABELS: Record<string, Bi> = {
  minutes: { en: 'minutes', vi: 'phút' },
  words: { en: 'words', vi: 'từ' },
  lessons: { en: 'lessons', vi: 'bài học' },
  xp: { en: 'XP', vi: 'XP' },
  none: { en: '', vi: '' },
}

/** Groups activity entries by local calendar day, keeping order. */
export function groupByDay<T extends { createdAt: string }>(
  items: T[],
  dayOf: (iso: string) => string,
): { day: string; items: T[] }[] {
  const out: { day: string; items: T[] }[] = []
  for (const it of items) {
    const day = dayOf(it.createdAt)
    const last = out[out.length - 1]
    if (last && last.day === day) last.items.push(it)
    else out.push({ day, items: [it] })
  }
  return out
}

/** Radius fraction (0..1) of the ring marking the start of CEFR level `index` (A1 = 0). The centre is "pre-A1". */
export function cefrRingFraction(index: number): number {
  return (index + 1) / (CEFR_LEVELS.length + 1)
}

/** Position of a skill on the radar: start of its CEFR ring plus progress inside the level (score 0..100). */
export function cefrFraction(cefr: Cefr, score: number): number {
  const idx = Math.max(0, CEFR_LEVELS.indexOf(cefr))
  const inLevel = Math.max(0, Math.min(100, Number.isFinite(score) ? score : 0)) / 100
  return Math.min(1, (idx + 1 + inLevel) / (CEFR_LEVELS.length + 1))
}
