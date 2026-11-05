// Gamification rules: XP, levels, streaks (with forgiving rest days), map regions, quests and achievements.
import type { ActivityType, QuestMetric, RegionKey, RegionProgress, Skill, StreakInfo } from '@shared/types'
import { addDays, diffDays, hashString, seededRandom } from './dates'

// ---------- XP ----------
export const XP_RULES: Record<ActivityType, number> = {
  word_saved: 2,
  review_done: 1,
  lesson_completed: 20,
  listening_done: 15,
  speaking_done: 10,
  reading_done: 15,
  writing_submitted: 25,
  grammar_done: 12,
  cinema_scene: 10,
  story_completed: 50,
  tutor_message: 2,
  assessment_done: 60,
}

/** Bonus multiplier for quality (0..1 score). Quality never reduces the base XP – effort is always rewarded. */
export function xpForActivity(type: ActivityType, opts: { score?: number; minutes?: number } = {}): number {
  let xp = XP_RULES[type]
  if (type === 'speaking_done' && opts.minutes) xp += Math.round(Math.min(opts.minutes, 30) * 5)
  if (opts.score !== undefined && opts.score > 0) xp += Math.round(xp * 0.5 * Math.min(1, opts.score))
  return xp
}

export const TUTOR_DAILY_XP_CAP = 20

// ---------- Levels ----------
/** XP needed to go from `level` to `level + 1`. Grows gently so early levels come fast. */
export function xpToNextLevel(level: number): number {
  const l = Math.max(1, level) - 1
  return 100 + 40 * l + 5 * l * l
}

export function levelFromXp(totalXp: number): { level: number; xpIntoLevel: number; xpForNextLevel: number } {
  let level = 1
  let remaining = Math.max(0, Math.floor(totalXp))
  while (remaining >= xpToNextLevel(level)) {
    remaining -= xpToNextLevel(level)
    level++
  }
  return { level, xpIntoLevel: remaining, xpForNextLevel: xpToNextLevel(level) }
}

const LEVEL_TITLES: [number, string][] = [
  [1, 'Wanderer'],
  [3, 'Explorer'],
  [6, 'Pathfinder'],
  [10, 'Adventurer'],
  [15, 'Voyager'],
  [20, 'Ranger'],
  [30, 'Sage'],
  [40, 'Legend'],
]
export function levelTitle(level: number): string {
  let title = 'Wanderer'
  for (const [min, t] of LEVEL_TITLES) if (level >= min) title = t
  return title
}

/** Accent colour themes unlocked by level – a real, visible reward. */
export const ACCENT_UNLOCKS: { key: string; level: number }[] = [
  { key: 'aurora', level: 1 },
  { key: 'ember', level: 3 },
  { key: 'jade', level: 6 },
  { key: 'royal', level: 10 },
  { key: 'sunset', level: 15 },
]
export const unlockedAccents = (level: number) => ACCENT_UNLOCKS.filter((a) => level >= a.level).map((a) => a.key)

// ---------- Streak ----------
/**
 * Streak with forgiving rest days: a single missed day is bridged automatically if no other
 * day was bridged in the previous 7 days. Two missed days in a row end the streak, but
 * total active days never decrease – missing a day is never punished beyond that.
 */
export function computeStreak(activeDays: string[], today: string): StreakInfo {
  const set = new Set(activeDays)
  const activeToday = set.has(today)
  const rest: string[] = []
  // Walk backwards from today (or yesterday if today isn't done yet – the day isn't over).
  let cursor = activeToday ? today : addDays(today, -1)
  let current = 0
  let lastRest: string | null = null
  const earliest = activeDays.length ? activeDays.reduce((a, b) => (a < b ? a : b)) : today
  while (cursor >= earliest) {
    if (set.has(cursor)) {
      current++
      cursor = addDays(cursor, -1)
      continue
    }
    const prev = addDays(cursor, -1)
    // Yesterday may be bridged while today is still pending, so the streak doesn't look lost before the learner studies.
    const pendingToday = !activeToday && cursor === addDays(today, -1)
    const canRest =
      set.has(prev) && (current > 0 || pendingToday) && (lastRest === null || diffDays(lastRest, cursor) >= 7)
    if (!canRest) break
    rest.push(cursor)
    lastRest = cursor
    cursor = prev
  }
  const longest = longestStreak(activeDays)
  const recentRest = rest.filter((d) => diffDays(today, d) < 7)
  return {
    current,
    longest: Math.max(longest, current),
    activeToday,
    restDayAvailable: recentRest.length === 0,
    restDaysUsedRecently: recentRest,
  }
}

function longestStreak(days: string[]): number {
  const sorted = [...new Set(days)].sort()
  let best = 0
  let run = 0
  let lastRest: string | null = null
  for (let i = 0; i < sorted.length; i++) {
    const day = sorted[i] as string
    const prev = sorted[i - 1]
    if (!prev) run = 1
    else {
      const gap = diffDays(day, prev)
      if (gap === 1) run++
      else if (gap === 2 && (lastRest === null || diffDays(day, lastRest) > 7)) {
        run++
        lastRest = addDays(prev, 1)
      } else {
        run = 1
        lastRest = null
      }
    }
    best = Math.max(best, run)
  }
  return best
}

// ---------- Regions ----------
export const REGION_SKILL: Record<RegionKey, Skill | 'all'> = {
  'vocabulary-forest': 'vocabulary',
  'grammar-kingdom': 'grammar',
  'listening-ocean': 'listening',
  'speaking-arena': 'speaking',
  'reading-library': 'reading',
  'writing-academy': 'writing',
  'mastery-challenge': 'all',
}

export const REGION_STAGE_XP = [0, 150, 400, 900, 1800, 3500] as const

export function regionProgress(key: RegionKey, xp: number, unlocked: boolean): RegionProgress {
  let stage = 0
  for (let i = 0; i < REGION_STAGE_XP.length; i++) if (xp >= (REGION_STAGE_XP[i] as number)) stage = i
  const next = stage < REGION_STAGE_XP.length - 1 ? (REGION_STAGE_XP[stage + 1] as number) : null
  return {
    key,
    skill: REGION_SKILL[key],
    xp,
    stage,
    stageXp: xp - (REGION_STAGE_XP[stage] as number),
    nextStageXp: next === null ? null : next - (REGION_STAGE_XP[stage] as number),
    unlocked,
  }
}

/** The Mastery Challenge opens once every skill region reaches stage 2. */
export function computeRegions(xpBySkill: Record<Skill, number>): RegionProgress[] {
  const skillRegions = (Object.keys(REGION_SKILL) as RegionKey[]).filter((k) => k !== 'mastery-challenge')
  const regions = skillRegions.map((k) => regionProgress(k, xpBySkill[REGION_SKILL[k] as Skill] ?? 0, true))
  const masteryUnlocked = regions.every((r) => r.stage >= 2)
  const totalXp = Object.values(xpBySkill).reduce((a, b) => a + b, 0)
  regions.push(regionProgress('mastery-challenge', masteryUnlocked ? Math.round(totalXp / 6) : 0, masteryUnlocked))
  return regions
}

// ---------- Quests ----------
export interface QuestTemplate {
  key: string
  metric: QuestMetric
  title: string
  titleVi: string
  base: number // target for a 20-minute learner
  xp: number
  skill: Skill | null
  route: string
}

export const DAILY_QUESTS: QuestTemplate[] = [
  {
    key: 'learn-words',
    metric: 'words_saved',
    title: 'Collect {n} new words',
    titleVi: 'Thu thập {n} từ mới',
    base: 10,
    xp: 30,
    skill: 'vocabulary',
    route: '/reading',
  },
  {
    key: 'review-words',
    metric: 'reviews_done',
    title: 'Review {n} flashcards',
    titleVi: 'Ôn {n} thẻ từ',
    base: 15,
    xp: 25,
    skill: 'vocabulary',
    route: '/vocabulary',
  },
  {
    key: 'listen',
    metric: 'listening_done',
    title: 'Finish {n} listening session',
    titleVi: 'Hoàn thành {n} bài nghe',
    base: 1,
    xp: 30,
    skill: 'listening',
    route: '/listening',
  },
  {
    key: 'speak',
    metric: 'speaking_seconds',
    title: 'Speak English for {m} minutes',
    titleVi: 'Nói tiếng Anh {m} phút',
    base: 300,
    xp: 35,
    skill: 'speaking',
    route: '/speaking',
  },
  {
    key: 'read',
    metric: 'reading_done',
    title: 'Read {n} story or article',
    titleVi: 'Đọc {n} truyện/bài báo',
    base: 1,
    xp: 30,
    skill: 'reading',
    route: '/reading',
  },
  {
    key: 'write',
    metric: 'writing_done',
    title: 'Write {n} paragraph',
    titleVi: 'Viết {n} đoạn văn',
    base: 1,
    xp: 35,
    skill: 'writing',
    route: '/writing',
  },
  {
    key: 'grammar',
    metric: 'grammar_done',
    title: 'Clear {n} Grammar Kingdom drill',
    titleVi: 'Vượt {n} thử thách ngữ pháp',
    base: 1,
    xp: 25,
    skill: 'grammar',
    route: '/grammar',
  },
  {
    key: 'cinema',
    metric: 'cinema_scenes',
    title: 'Play {n} Cinema scenes',
    titleVi: 'Chơi {n} cảnh phim',
    base: 2,
    xp: 30,
    skill: 'listening',
    route: '/cinema',
  },
  {
    key: 'tutor',
    metric: 'tutor_messages',
    title: 'Send {n} messages to your tutor',
    titleVi: 'Gửi {n} tin nhắn cho gia sư AI',
    base: 5,
    xp: 20,
    skill: 'writing',
    route: '/tutor',
  },
]

export const WEEKLY_QUESTS: QuestTemplate[] = [
  {
    key: 'week-active',
    metric: 'active_days',
    title: 'Learn on {n} different days',
    titleVi: 'Học trong {n} ngày khác nhau',
    base: 5,
    xp: 120,
    skill: null,
    route: '/',
  },
  {
    key: 'week-minutes',
    metric: 'minutes',
    title: 'Study {n} minutes this week',
    titleVi: 'Học {n} phút trong tuần',
    base: 100,
    xp: 120,
    skill: null,
    route: '/',
  },
  {
    key: 'week-speak',
    metric: 'speaking_seconds',
    title: 'Speak for {m} minutes this week',
    titleVi: 'Nói {m} phút trong tuần',
    base: 900,
    xp: 100,
    skill: 'speaking',
    route: '/speaking',
  },
  {
    key: 'week-story',
    metric: 'cinema_scenes',
    title: 'Play {n} Cinema scenes',
    titleVi: 'Chơi {n} cảnh phim',
    base: 8,
    xp: 100,
    skill: 'listening',
    route: '/cinema',
  },
  {
    key: 'week-words',
    metric: 'words_saved',
    title: 'Collect {n} words',
    titleVi: 'Thu thập {n} từ',
    base: 40,
    xp: 100,
    skill: 'vocabulary',
    route: '/vocabulary',
  },
  {
    key: 'week-write',
    metric: 'writing_done',
    title: 'Submit {n} pieces of writing',
    titleVi: 'Nộp {n} bài viết',
    base: 3,
    xp: 100,
    skill: 'writing',
    route: '/writing',
  },
]

export interface GeneratedQuest {
  key: string
  metric: QuestMetric
  title: string
  titleVi: string
  target: number
  xpReward: number
  route: string
}

function scaleTarget(t: QuestTemplate, dailyMinutes: number): number {
  const factor = Math.max(0.5, Math.min(3, dailyMinutes / 20))
  if (t.base <= 2) return t.base // session counts stay small
  const raw = t.base * factor
  return t.metric === 'speaking_seconds' ? Math.max(120, Math.round(raw / 60) * 60) : Math.max(1, Math.round(raw))
}

function render(t: QuestTemplate, target: number): Pick<GeneratedQuest, 'title' | 'titleVi'> {
  const n = String(target)
  const m = String(Math.round(target / 60))
  return {
    title: t.title.replace('{n}', n).replace('{m}', m),
    titleVi: t.titleVi.replace('{n}', n).replace('{m}', m),
  }
}

/**
 * Three daily quests: a vocabulary quest (review when cards are due, otherwise collect),
 * one for the weakest skill and one random variety quest. Stable for a given date.
 */
export function generateDailyQuests(input: {
  dateKey: string
  dailyMinutes: number
  dueCards: number
  weakestSkills: Skill[]
}): GeneratedQuest[] {
  const rnd = seededRandom(hashString('daily:' + input.dateKey))
  const chosen: QuestTemplate[] = []
  const byKey = (k: string) => DAILY_QUESTS.find((q) => q.key === k) as QuestTemplate
  chosen.push(input.dueCards >= 5 ? byKey('review-words') : byKey('learn-words'))
  // Respect the order of weakness: the weakest skill that has a quest wins.
  const weakTemplate = input.weakestSkills
    .filter((s) => s !== 'vocabulary')
    .map((s) => DAILY_QUESTS.find((q) => q.skill === s && !chosen.includes(q)))
    .find((q): q is QuestTemplate => q !== undefined)
  if (weakTemplate) chosen.push(weakTemplate)
  const rest = DAILY_QUESTS.filter((q) => !chosen.includes(q) && q.key !== 'review-words' && q.key !== 'learn-words')
  while (chosen.length < 3 && rest.length)
    chosen.push(rest.splice(Math.floor(rnd() * rest.length), 1)[0] as QuestTemplate)
  return chosen.map((t) => {
    const target = scaleTarget(t, input.dailyMinutes)
    return { key: t.key, metric: t.metric, target, xpReward: t.xp, route: t.route, ...render(t, target) }
  })
}

export function generateWeeklyQuests(input: { weekKey: string; dailyMinutes: number }): GeneratedQuest[] {
  const rnd = seededRandom(hashString('weekly:' + input.weekKey))
  const pool = WEEKLY_QUESTS.filter((q) => q.key !== 'week-active')
  const chosen: QuestTemplate[] = [WEEKLY_QUESTS[0] as QuestTemplate]
  while (chosen.length < 3) chosen.push(pool.splice(Math.floor(rnd() * pool.length), 1)[0] as QuestTemplate)
  return chosen.map((t) => {
    const target =
      t.metric === 'minutes'
        ? Math.round((input.dailyMinutes * 5) / 10) * 10
        : t.metric === 'active_days'
          ? 5
          : scaleTarget(t, input.dailyMinutes)
    return { key: t.key, metric: t.metric, target, xpReward: t.xp, route: t.route, ...render(t, target) }
  })
}

// ---------- Achievements ----------
export interface AchievementStats {
  words: number
  reviews: number
  listening: number
  reading: number
  writing: number
  speakingSeconds: number
  cinemaScenes: number
  storiesCompleted: number
  goodEndings: number
  longestStreak: number
  level: number
  assessments: number
  tutorMessages: number
  grammar: number
  activeDays: number
  perfectQuizzes: number
  questsCompleted: number
}

export interface AchievementDef {
  key: string
  title: string
  titleVi: string
  description: string
  descriptionVi: string
  icon: string
  tier: 'bronze' | 'silver' | 'gold' | 'legend'
  stat: keyof AchievementStats
  target: number
}

export const ACHIEVEMENTS: AchievementDef[] = [
  {
    key: 'first-steps',
    title: 'First Steps',
    titleVi: 'Những bước đầu tiên',
    description: 'Complete the placement assessment',
    descriptionVi: 'Hoàn thành bài đánh giá trình độ',
    icon: 'Compass',
    tier: 'bronze',
    stat: 'assessments',
    target: 1,
  },
  {
    key: 'word-collector',
    title: 'Word Collector',
    titleVi: 'Nhà sưu tầm từ',
    description: 'Save 25 words',
    descriptionVi: 'Lưu 25 từ',
    icon: 'Leaf',
    tier: 'bronze',
    stat: 'words',
    target: 25,
  },
  {
    key: 'lexicon-keeper',
    title: 'Lexicon Keeper',
    titleVi: 'Người giữ kho từ',
    description: 'Save 250 words',
    descriptionVi: 'Lưu 250 từ',
    icon: 'Trees',
    tier: 'gold',
    stat: 'words',
    target: 250,
  },
  {
    key: 'memory-spark',
    title: 'Memory Spark',
    titleVi: 'Tia sáng trí nhớ',
    description: 'Review 50 flashcards',
    descriptionVi: 'Ôn 50 thẻ từ',
    icon: 'Sparkles',
    tier: 'bronze',
    stat: 'reviews',
    target: 50,
  },
  {
    key: 'memory-palace',
    title: 'Memory Palace',
    titleVi: 'Cung điện trí nhớ',
    description: 'Review 1,000 flashcards',
    descriptionVi: 'Ôn 1.000 thẻ từ',
    icon: 'Castle',
    tier: 'gold',
    stat: 'reviews',
    target: 1000,
  },
  {
    key: 'tuned-in',
    title: 'Tuned In',
    titleVi: 'Bắt sóng',
    description: 'Finish 5 listening sessions',
    descriptionVi: 'Hoàn thành 5 bài nghe',
    icon: 'Headphones',
    tier: 'bronze',
    stat: 'listening',
    target: 5,
  },
  {
    key: 'deep-diver',
    title: 'Deep Diver',
    titleVi: 'Thợ lặn đại dương',
    description: 'Finish 40 listening sessions',
    descriptionVi: 'Hoàn thành 40 bài nghe',
    icon: 'Waves',
    tier: 'gold',
    stat: 'listening',
    target: 40,
  },
  {
    key: 'first-words-aloud',
    title: 'Voice Unlocked',
    titleVi: 'Mở khóa giọng nói',
    description: 'Speak English for 5 minutes in total',
    descriptionVi: 'Nói tiếng Anh tổng cộng 5 phút',
    icon: 'Mic',
    tier: 'bronze',
    stat: 'speakingSeconds',
    target: 300,
  },
  {
    key: 'arena-champion',
    title: 'Arena Champion',
    titleVi: 'Nhà vô địch đấu trường',
    description: 'Speak English for 2 hours in total',
    descriptionVi: 'Nói tiếng Anh tổng cộng 2 giờ',
    icon: 'Trophy',
    tier: 'gold',
    stat: 'speakingSeconds',
    target: 7200,
  },
  {
    key: 'bookworm',
    title: 'Bookworm',
    titleVi: 'Mọt sách',
    description: 'Read 5 stories or articles',
    descriptionVi: 'Đọc 5 truyện/bài báo',
    icon: 'BookOpen',
    tier: 'bronze',
    stat: 'reading',
    target: 5,
  },
  {
    key: 'librarian',
    title: 'Grand Librarian',
    titleVi: 'Đại thủ thư',
    description: 'Read 50 stories or articles',
    descriptionVi: 'Đọc 50 truyện/bài báo',
    icon: 'Library',
    tier: 'gold',
    stat: 'reading',
    target: 50,
  },
  {
    key: 'first-draft',
    title: 'First Draft',
    titleVi: 'Bản nháp đầu tiên',
    description: 'Submit your first piece of writing',
    descriptionVi: 'Nộp bài viết đầu tiên',
    icon: 'PenLine',
    tier: 'bronze',
    stat: 'writing',
    target: 1,
  },
  {
    key: 'wordsmith',
    title: 'Wordsmith',
    titleVi: 'Thợ rèn chữ',
    description: 'Submit 25 pieces of writing',
    descriptionVi: 'Nộp 25 bài viết',
    icon: 'Feather',
    tier: 'gold',
    stat: 'writing',
    target: 25,
  },
  {
    key: 'grammar-squire',
    title: 'Grammar Squire',
    titleVi: 'Hiệp sĩ tập sự ngữ pháp',
    description: 'Clear 5 grammar drills',
    descriptionVi: 'Vượt 5 thử thách ngữ pháp',
    icon: 'Shield',
    tier: 'bronze',
    stat: 'grammar',
    target: 5,
  },
  {
    key: 'grammar-knight',
    title: 'Grammar Knight',
    titleVi: 'Hiệp sĩ ngữ pháp',
    description: 'Clear 30 grammar drills',
    descriptionVi: 'Vượt 30 thử thách ngữ pháp',
    icon: 'Swords',
    tier: 'silver',
    stat: 'grammar',
    target: 30,
  },
  {
    key: 'opening-night',
    title: 'Opening Night',
    titleVi: 'Đêm công chiếu',
    description: 'Play 3 Cinema scenes',
    descriptionVi: 'Chơi 3 cảnh phim',
    icon: 'Clapperboard',
    tier: 'bronze',
    stat: 'cinemaScenes',
    target: 3,
  },
  {
    key: 'the-end',
    title: 'The End',
    titleVi: 'Hết phim',
    description: 'Finish a Cinema story',
    descriptionVi: 'Xem hết một bộ phim tương tác',
    icon: 'Film',
    tier: 'silver',
    stat: 'storiesCompleted',
    target: 1,
  },
  {
    key: 'happy-ending',
    title: 'Happy Ending',
    titleVi: 'Kết thúc có hậu',
    description: 'Reach 3 good endings',
    descriptionVi: 'Đạt 3 kết thúc tốt',
    icon: 'Heart',
    tier: 'gold',
    stat: 'goodEndings',
    target: 3,
  },
  {
    key: 'streak-3',
    title: 'Warming Up',
    titleVi: 'Khởi động',
    description: 'Reach a 3-day streak',
    descriptionVi: 'Chuỗi học 3 ngày',
    icon: 'Flame',
    tier: 'bronze',
    stat: 'longestStreak',
    target: 3,
  },
  {
    key: 'streak-14',
    title: 'Habit Forged',
    titleVi: 'Thói quen thành hình',
    description: 'Reach a 14-day streak',
    descriptionVi: 'Chuỗi học 14 ngày',
    icon: 'Flame',
    tier: 'silver',
    stat: 'longestStreak',
    target: 14,
  },
  {
    key: 'streak-60',
    title: 'Unstoppable',
    titleVi: 'Không thể cản',
    description: 'Reach a 60-day streak',
    descriptionVi: 'Chuỗi học 60 ngày',
    icon: 'Zap',
    tier: 'legend',
    stat: 'longestStreak',
    target: 60,
  },
  {
    key: 'days-30',
    title: 'Thirty Sunrises',
    titleVi: 'Ba mươi bình minh',
    description: 'Learn on 30 different days',
    descriptionVi: 'Học trong 30 ngày khác nhau',
    icon: 'Sunrise',
    tier: 'silver',
    stat: 'activeDays',
    target: 30,
  },
  {
    key: 'level-5',
    title: 'Rising Star',
    titleVi: 'Ngôi sao đang lên',
    description: 'Reach level 5',
    descriptionVi: 'Đạt level 5',
    icon: 'Star',
    tier: 'bronze',
    stat: 'level',
    target: 5,
  },
  {
    key: 'level-15',
    title: 'Seasoned Voyager',
    titleVi: 'Lữ khách dày dạn',
    description: 'Reach level 15',
    descriptionVi: 'Đạt level 15',
    icon: 'Medal',
    tier: 'gold',
    stat: 'level',
    target: 15,
  },
  {
    key: 'tutor-friend',
    title: 'Good Conversation',
    titleVi: 'Trò chuyện vui vẻ',
    description: 'Send 30 messages to your tutor',
    descriptionVi: 'Gửi 30 tin nhắn cho gia sư',
    icon: 'MessagesSquare',
    tier: 'bronze',
    stat: 'tutorMessages',
    target: 30,
  },
  {
    key: 'sharp-mind',
    title: 'Sharp Mind',
    titleVi: 'Trí óc sắc bén',
    description: 'Get 5 perfect quiz scores',
    descriptionVi: 'Đạt điểm tuyệt đối 5 bài quiz',
    icon: 'Target',
    tier: 'silver',
    stat: 'perfectQuizzes',
    target: 5,
  },
  {
    key: 'quest-hunter',
    title: 'Quest Hunter',
    titleVi: 'Thợ săn nhiệm vụ',
    description: 'Complete 20 quests',
    descriptionVi: 'Hoàn thành 20 nhiệm vụ',
    icon: 'ScrollText',
    tier: 'silver',
    stat: 'questsCompleted',
    target: 20,
  },
]

export function evaluateAchievements(
  stats: AchievementStats,
  alreadyUnlocked: Set<string>,
): { key: string; current: number; target: number; progress: number; newlyUnlocked: boolean }[] {
  return ACHIEVEMENTS.map((a) => {
    const current = stats[a.stat]
    const done = current >= a.target
    return {
      key: a.key,
      current,
      target: a.target,
      progress: Math.min(1, current / a.target),
      newlyUnlocked: done && !alreadyUnlocked.has(a.key),
    }
  })
}
