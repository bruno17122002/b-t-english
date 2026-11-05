// Offline (rule-based) roadmap, progress projection and daily plan builder.
// The AI roadmap uses the same output shape; this module is the always-available fallback.
import type { Cefr } from '@shared/content'
import type { ModuleId, RoadmapSummary, RoadmapWeek, Skill } from '@shared/types'
import { SKILLS } from '@shared/types'
import { CUMULATIVE_HOURS, averageCefr, cefrAt, cefrIndex } from './cefr'
import { hashString, seededRandom } from './dates'

export interface SkillSnapshot {
  skill: Skill
  cefr: Cefr
  score: number
}

export interface RoadmapInput {
  displayName: string
  dailyMinutes: number
  targetCefr: Cefr
  interests: string[]
  purposes: string[]
  skills: SkillSnapshot[]
  grammarTopics: { id: string; title: string; cefr: Cefr }[]
  studyDaysPerWeek?: number
}

export function weakestSkills(skills: SkillSnapshot[], n = 2): Skill[] {
  return [...skills]
    .sort((a, b) => cefrIndex(a.cefr) * 100 + a.score - (cefrIndex(b.cefr) * 100 + b.score))
    .slice(0, n)
    .map((s) => s.skill)
}

export function projectProgress(input: {
  current: Cefr
  currentScore: number
  target: Cefr
  dailyMinutes: number
  studyDaysPerWeek?: number
}): { hoursNeeded: number; estimatedWeeks: number; milestones: { cefr: Cefr; week: number }[] } {
  const days = input.studyDaysPerWeek ?? 6
  const hoursPerWeek = Math.max(0.5, (input.dailyMinutes * days) / 60)
  const ci = cefrIndex(input.current)
  const ti = cefrIndex(input.target)
  // Hours already "banked" inside the current level.
  const levelStart = ci === 0 ? 0 : CUMULATIVE_HOURS[cefrAt(ci - 1)]
  const levelSpan = CUMULATIVE_HOURS[input.current] - levelStart
  const done = levelStart + (levelSpan * Math.min(100, Math.max(0, input.currentScore))) / 100
  if (ti <= ci) return { hoursNeeded: 0, estimatedWeeks: 0, milestones: [] }
  const milestones: { cefr: Cefr; week: number }[] = []
  for (let i = ci + 1; i <= ti; i++) {
    const lvl = cefrAt(i)
    // Reaching level i means completing the hours of level i-1 → i.
    const hours = CUMULATIVE_HOURS[cefrAt(i - 1)] - done
    milestones.push({ cefr: lvl, week: Math.max(1, Math.ceil(Math.max(0, hours) / hoursPerWeek)) })
  }
  const hoursNeeded = Math.max(0, Math.round(CUMULATIVE_HOURS[cefrAt(ti - 1)] - done))
  return { hoursNeeded, estimatedWeeks: Math.max(1, Math.ceil(hoursNeeded / hoursPerWeek)), milestones }
}

const THEME_LABELS: Record<string, string> = {
  travel: 'Travel & adventure',
  technology: 'Technology & gadgets',
  business: 'Work & business',
  movies: 'Movies & stories',
  music: 'Music & culture',
  food: 'Food & cooking',
  science: 'Science & nature',
  sports: 'Sports & health',
  psychology: 'Mind & psychology',
  culture: 'Culture & society',
  ielts: 'IELTS topics',
  daily: 'Everyday life',
}

export function buildOfflineRoadmap(input: RoadmapInput): {
  summary: RoadmapSummary
  weeks: Omit<RoadmapWeek, 'id'>[]
} {
  const levels = input.skills.map((s) => s.cefr)
  const overall = averageCefr(levels.length ? levels : ['A1'])
  const avgScore = input.skills.length ? input.skills.reduce((s, x) => s + x.score, 0) / input.skills.length : 0
  const projection = projectProgress({
    current: overall,
    currentScore: avgScore,
    target: input.targetCefr,
    dailyMinutes: input.dailyMinutes,
    studyDaysPerWeek: input.studyDaysPerWeek,
  })
  // Fill missing skills at the overall level so there are always three priorities to rotate through.
  const known = new Set(input.skills.map((s) => s.skill))
  const allSkills = [...input.skills, ...SKILLS.filter((s) => !known.has(s)).map((s) => ({ skill: s, cefr: overall, score: 50 }))]
  const priority = weakestSkills(allSkills, 3)
  const themes = (input.interests.length ? input.interests : ['daily', 'travel', 'movies']).map((i) => THEME_LABELS[i] ?? i)
  const weeks: Omit<RoadmapWeek, 'id'>[] = []
  const grammarPool = [...input.grammarTopics].sort((a, b) => cefrIndex(a.cefr) - cefrIndex(b.cefr))
  const startGrammar = Math.max(0, grammarPool.findIndex((g) => cefrIndex(g.cefr) >= cefrIndex(overall)))
  const wordsPerWeek = Math.round((input.dailyMinutes / 20) * 50)
  for (let w = 0; w < 12; w++) {
    const theme = themes[w % themes.length] as string
    const rotating = SKILLS[(w + 2) % SKILLS.length] as Skill
    const focus = [...new Set([priority[w % 2] as Skill, priority[(w + 1) % 3] as Skill, rotating])].slice(0, 3)
    const grammar = grammarPool[startGrammar + w] ?? grammarPool[grammarPool.length - 1]
    const objectives = [
      `Collect and review ${wordsPerWeek} words around "${theme}"`,
      grammar ? `Grammar Kingdom: ${grammar.title}` : 'Grammar Kingdom: review mistakes from your writing',
      `${focus.includes('listening') ? 3 : 2} Listening Lab sessions with dictation`,
      `Speak for ${Math.max(10, Math.round(input.dailyMinutes * 0.75))} minutes (shadowing + role-play)`,
      `${focus.includes('writing') ? 2 : 1} Writing Workshop task about "${theme}"`,
      w % 2 === 0 ? 'Play one Cinema Mode story to the end' : 'Read 2 stories or articles in Reading Adventure',
    ]
    weeks.push({ weekIndex: w + 1, theme, focusSkills: focus, objectives, status: w === 0 ? 'current' : 'upcoming' })
  }
  const minutes = input.dailyMinutes
  const routine: RoadmapSummary['dailyRoutine'] = [
    { skill: 'review', minutes: Math.max(5, Math.round(minutes * 0.2)), activity: 'Flashcard review (FSRS)' },
    { skill: priority[0] as Skill, minutes: Math.round(minutes * 0.35), activity: `Focus on ${priority[0]}` },
    { skill: priority[1] as Skill, minutes: Math.round(minutes * 0.25), activity: `Practice ${priority[1]}` },
    { skill: 'cinema', minutes: Math.max(5, Math.round(minutes * 0.2)), activity: 'Cinema Mode scene or AI tutor chat' },
  ]
  const target = input.targetCefr
  return {
    summary: {
      headline: `From ${overall} to ${target}: ${projection.estimatedWeeks} weeks at ${minutes} min/day`,
      shortTermGoals: [
        `Build a daily habit of ${minutes} minutes`,
        `Raise ${priority[0]} to the next level`,
        `Save and review ${wordsPerWeek * 4} words this month`,
      ],
      longTermGoals: [
        `Reach ${target} across all six skills`,
        ...(input.purposes.includes('ielts') ? ['Be ready for IELTS Academic/General at your target band'] : []),
        'Hold a 10-minute natural conversation in English',
      ],
      prioritySkills: priority,
      milestones: projection.milestones.map((m) => ({ title: `Reach ${m.cefr}`, week: m.week, cefr: m.cefr })),
      projection: {
        currentCefr: overall,
        targetCefr: target,
        hoursNeeded: projection.hoursNeeded,
        estimatedWeeks: projection.estimatedWeeks,
        note: 'Estimate based on typical guided learning hours per CEFR level; self-study pace varies.',
      },
      dailyRoutine: routine,
      interestThemes: themes,
    },
    weeks,
  }
}

export const SKILL_MODULE: Record<Skill, ModuleId> = {
  vocabulary: 'vocabulary',
  grammar: 'grammar',
  reading: 'reading',
  listening: 'listening',
  writing: 'writing',
  speaking: 'speaking',
}

export interface LibraryItem {
  module: ModuleId
  ref: string
  title: string
  cefr: Cefr
  minutes: number
}

export interface PlannedLesson {
  module: ModuleId
  title: string
  description: string
  contentRef: string | null
  estimatedMinutes: number
}

/** Pick concrete content for today: review first, then focus skills, then something fun. */
export function buildDailyPlan(input: {
  dateKey: string
  dailyMinutes: number
  focusSkills: Skill[]
  levels: Partial<Record<Skill, Cefr>>
  library: LibraryItem[]
  completedRefs: Set<string>
  dueCards: number
}): PlannedLesson[] {
  const rnd = seededRandom(hashString('plan:' + input.dateKey))
  const plan: PlannedLesson[] = []
  let budget = input.dailyMinutes
  if (input.dueCards > 0) {
    const m = Math.min(10, Math.max(5, Math.round(input.dueCards / 3)))
    plan.push({
      module: 'vocabulary',
      title: `Review ${input.dueCards} due words`,
      description: 'Spaced repetition keeps words in long-term memory.',
      contentRef: null,
      estimatedMinutes: m,
    })
    budget -= m
  }
  const pick = (module: ModuleId, level: Cefr): LibraryItem | null => {
    const fits = (it: LibraryItem, maxUp: number) =>
      it.module === module &&
      !input.completedRefs.has(it.ref) &&
      cefrIndex(it.cefr) <= cefrIndex(level) + maxUp &&
      cefrIndex(it.cefr) >= cefrIndex(level) - 1
    const pool = input.library.filter((it) => fits(it, 0))
    const fallback = pool.length ? pool : input.library.filter((it) => fits(it, 1))
    const any = fallback.length ? fallback : input.library.filter((it) => it.module === module)
    if (!any.length) return null
    return any[Math.floor(rnd() * any.length)] as LibraryItem
  }
  for (const skill of input.focusSkills) {
    if (budget < 5) break
    const module = SKILL_MODULE[skill]
    if (module === 'vocabulary' && plan.some((p) => p.module === 'vocabulary')) continue
    const level = input.levels[skill] ?? 'A1'
    const item = pick(module, level)
    if (item) {
      plan.push({ module, title: item.title, description: describe(module), contentRef: item.ref, estimatedMinutes: item.minutes })
      budget -= item.minutes
    } else if (module === 'vocabulary') {
      plan.push({ module, title: 'Collect 10 new words', description: describe(module), contentRef: null, estimatedMinutes: 10 })
      budget -= 10
    }
  }
  if (budget >= 8) {
    const level = input.levels.listening ?? 'A1'
    const story = pick('cinema', level)
    if (story)
      plan.push({ module: 'cinema', title: story.title, description: describe('cinema'), contentRef: story.ref, estimatedMinutes: Math.min(15, budget) })
  }
  return plan
}

function describe(module: ModuleId): string {
  switch (module) {
    case 'listening':
      return 'Listen sentence by sentence, then try dictation.'
    case 'reading':
      return 'Read, tap unknown words, answer the questions.'
    case 'writing':
      return 'Write, self-correct, then compare with the AI feedback.'
    case 'speaking':
      return 'Shadow, repeat or role-play out loud.'
    case 'grammar':
      return 'Learn the pattern and clear the drill.'
    case 'cinema':
      return 'Play the next scenes of an interactive story.'
    case 'vocabulary':
      return 'Grow your word collection.'
    default:
      return ''
  }
}
