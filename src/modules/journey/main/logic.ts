// Pure helpers of the journey module (no Electron, DB or React imports) – unit tested.
import type { Cefr } from '@shared/content'
import type { ModuleId, RoadmapWeek, Skill } from '@shared/types'
import { averageCefr, cefrAt, cefrIndex } from '@core/cefr'
import { diffDays, hashString } from '@core/dates'

const SLUG = /^[a-z0-9][a-z0-9-]*$/

/** Route that opens a plan item in its module. */
export function routeForPlanItem(module: ModuleId | string, contentRef: string | null, title = ''): string {
  const ref = contentRef && SLUG.test(contentRef) ? encodeURIComponent(contentRef) : null
  switch (module) {
    case 'reading':
    case 'listening':
    case 'cinema':
    case 'grammar':
      return ref ? `/${module}/${ref}` : `/${module}`
    case 'writing':
    case 'speaking':
      return ref ? `/${module}?prompt=${ref}` : `/${module}`
    case 'vocabulary':
      return /review/i.test(title) ? '/vocabulary/review' : '/vocabulary'
    case 'tutor':
      return '/tutor'
    case 'journey':
      return ref ? `/journey/course/${ref}` : '/journey'
    default:
      return '/'
  }
}

/** Skill credited when a plan item of a module is completed. */
export function skillForModule(module: string): Skill | null {
  switch (module) {
    case 'reading':
    case 'listening':
    case 'writing':
    case 'speaking':
    case 'grammar':
    case 'vocabulary':
      return module
    case 'cinema':
      return 'listening'
    case 'tutor':
      return 'speaking'
    default:
      return null
  }
}

/** 1-based week of the roadmap that contains `today`. */
export function currentWeekIndex(startDate: string, today: string): number {
  return Math.max(1, Math.floor(diffDays(today, startDate) / 7) + 1)
}

/** Display status: weeks marked done stay done, the week containing today is current, others upcoming. */
export function deriveWeekStatus(
  stored: RoadmapWeek['status'],
  weekIndex: number,
  current: number,
): RoadmapWeek['status'] {
  if (stored === 'done') return 'done'
  return weekIndex === current ? 'current' : 'upcoming'
}

/**
 * Estimate for a productive skill (writing/speaking) the learner skipped: the average of the measured
 * receptive skills, one level lower (production usually lags behind comprehension), never below A1.
 */
export function estimateFromOtherSkills(levels: Cefr[]): Cefr {
  if (!levels.length) return 'A1'
  const avg = averageCefr(levels)
  return cefrAt(cefrIndex(avg) - 1)
}

/** Speaking rate guess → CEFR band, combined with a text-based level (used offline only). */
export function heuristicSpeakingCefr(textLevel: Cefr, wordsPerMinute: number | null, words: number): Cefr {
  if (words < 8) return 'A1'
  let idx = cefrIndex(textLevel)
  if (wordsPerMinute !== null) {
    if (wordsPerMinute < 60) idx = Math.min(idx, 1)
    else if (wordsPerMinute < 90) idx = Math.min(idx, 2)
    else if (wordsPerMinute >= 130 && idx < 3) idx += 1
  }
  return cefrAt(idx)
}

export type DayPart = 'morning' | 'afternoon' | 'evening' | 'night'

export function dayPart(hour: number): DayPart {
  if (hour >= 5 && hour < 12) return 'morning'
  if (hour >= 12 && hour < 18) return 'afternoon'
  if (hour >= 18 && hour < 22) return 'evening'
  return 'night'
}

export const TIPS: { en: string; vi: string }[] = [
  {
    en: 'Little and often beats long and rare: 20 focused minutes every day builds more than 3 hours on Sunday.',
    vi: 'Ít mà đều hơn nhiều mà thất thường: 20 phút tập trung mỗi ngày hiệu quả hơn 3 giờ vào Chủ nhật.',
  },
  {
    en: 'Say new words out loud. Hearing yourself use a word makes it much easier to remember.',
    vi: 'Hãy đọc to từ mới. Nghe chính mình dùng từ giúp bạn nhớ lâu hơn nhiều.',
  },
  {
    en: 'Shadowing tip: copy the rhythm and stress first, the exact sounds come later.',
    vi: 'Mẹo shadowing: bắt chước nhịp và trọng âm trước, âm chính xác sẽ đến sau.',
  },
  {
    en: 'Learn words in chunks ("make a decision", "take a break") instead of single words.',
    vi: 'Học từ theo cụm ("make a decision", "take a break") thay vì từng từ riêng lẻ.',
  },
  {
    en: 'Mistakes are data. Re-write one sentence from your last writing task without looking at the correction.',
    vi: 'Lỗi sai là dữ liệu quý. Hãy viết lại một câu trong bài viết gần nhất mà không nhìn bản sửa.',
  },
  {
    en: 'Vietnamese speakers often drop final sounds (/t/, /d/, /s/). Exaggerate them while practising.',
    vi: 'Người Việt hay nuốt âm cuối (/t/, /d/, /s/). Khi luyện, hãy phát âm rõ, thậm chí hơi cường điệu.',
  },
  {
    en: 'Review flashcards before new lessons: memory is cheapest to refresh just before you forget.',
    vi: 'Ôn thẻ trước khi học bài mới: củng cố trí nhớ ngay trước lúc quên là hiệu quả nhất.',
  },
  {
    en: 'For IELTS 6.5 you need range AND accuracy. Use one new linking word in every writing task.',
    vi: 'Để đạt IELTS 6.5 bạn cần cả độ đa dạng VÀ độ chính xác. Mỗi bài viết hãy dùng một từ nối mới.',
  },
  {
    en: 'Listen once for the gist, then again for details. Do not read the script until you have tried twice.',
    vi: 'Nghe lần đầu để nắm ý chính, lần hai để lấy chi tiết. Đừng đọc transcript trước khi nghe hai lần.',
  },
  {
    en: 'Think in English for one minute: describe what you see around you right now.',
    vi: 'Thử nghĩ bằng tiếng Anh một phút: mô tả những gì bạn đang thấy xung quanh.',
  },
]

/** Tip of the day, stable within a day. */
export function tipForDate(dateKey: string): { en: string; vi: string } {
  return TIPS[hashString('tip:' + dateKey) % TIPS.length] as { en: string; vi: string }
}

const STOP = new Set([
  'the',
  'a',
  'an',
  'and',
  'or',
  'of',
  'to',
  'in',
  'on',
  'with',
  'for',
  'your',
  'you',
  'is',
  'are',
  'be',
])

function keywords(s: string): Set<string> {
  return new Set(
    s
      .toLowerCase()
      .replace(/\{[^}]*\}/g, ' ')
      .split(/[^a-z]+/)
      .filter((w) => w.length > 2 && !STOP.has(w)),
  )
}

/** Grammar topics related to a syllabus lesson: shared keywords first, otherwise topics at the same level. */
export function relatedGrammarTopics<T extends { id: string; title: string; cefr: Cefr; summaryEn?: string }>(
  lesson: { title: string; cefr: Cefr; grammar: string[] },
  topics: T[],
  max = 2,
): T[] {
  const lessonWords = keywords([lesson.title, ...lesson.grammar].join(' '))
  const scored = topics
    .map((t) => {
      const words = keywords(`${t.title} ${t.summaryEn ?? ''}`)
      let overlap = 0
      for (const w of words) if (lessonWords.has(w)) overlap++
      const levelGap = Math.abs(cefrIndex(t.cefr) - cefrIndex(lesson.cefr))
      return { t, score: overlap * 10 - levelGap * 3 }
    })
    .filter((x) => x.score > -4)
    .sort((a, b) => b.score - a.score)
  return scored.slice(0, max).map((x) => x.t)
}
