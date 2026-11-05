// Progress kernel: modules emit LearningEvents; this service turns them into XP, quests, achievements,
// streaks, goal progress and statistics inside one transaction, then notifies listeners (UI celebration).
import type {
  Achievement,
  ActivityEntry,
  ActivityType,
  DailyStat,
  GameState,
  Quest,
  QuestMetric,
  Reward,
  Skill,
  StatsOverview,
} from '@shared/types'
import { SKILLS } from '@shared/types'
import {
  ACHIEVEMENTS,
  computeRegions,
  computeStreak,
  evaluateAchievements,
  generateDailyQuests,
  generateWeeklyQuests,
  levelFromXp,
  levelTitle,
  TUTOR_DAILY_XP_CAP,
  unlockedAccents,
  xpForActivity,
  type AchievementStats,
  type GeneratedQuest,
} from '@core/game'
import { addDays, isoWeekKey, localDateKey, weekStart } from '@core/dates'
import { weakestSkills } from '@core/roadmap'
import type { AppDatabase } from '../../db/database'
import type { LearnerService } from '../learner/learner'

export interface LearningEvent {
  type: ActivityType
  /** Module that produced the event, e.g. 'listening'. */
  module: string
  skill?: Skill | null
  minutes?: number
  /** Quality 0..1 – adds bonus XP, never reduces base XP. */
  score?: number
  ref?: string
  title?: string
  /** For speaking events: seconds actually spoken. */
  speakingSeconds?: number
  /** Overrides computed XP (used for quest rewards etc.). */
  xpOverride?: number
}

const EVENT_METRICS: Partial<Record<ActivityType, QuestMetric>> = {
  word_saved: 'words_saved',
  review_done: 'reviews_done',
  listening_done: 'listening_done',
  reading_done: 'reading_done',
  writing_submitted: 'writing_done',
  grammar_done: 'grammar_done',
  cinema_scene: 'cinema_scenes',
  tutor_message: 'tutor_messages',
  lesson_completed: 'lessons_done',
}

interface QuestRow {
  id: number
  period: 'daily' | 'weekly'
  period_key: string
  quest_key: string
  metric: QuestMetric
  title: string
  title_vi: string
  target: number
  progress: number
  xp_reward: number
  route: string
  completed_at: string | null
}

const toQuest = (r: QuestRow): Quest => ({
  id: r.id,
  period: r.period,
  periodKey: r.period_key,
  key: r.quest_key,
  metric: r.metric,
  title: r.title,
  titleVi: r.title_vi,
  target: r.target,
  progress: Math.min(r.progress, r.target),
  xpReward: r.xp_reward,
  completedAt: r.completed_at,
  route: r.route,
})

export type RewardListener = (reward: Reward, event: LearningEvent) => void

export class ProgressService {
  private listeners: RewardListener[] = []

  constructor(
    private readonly db: AppDatabase,
    private readonly learner: LearnerService,
    private readonly dueCards: () => number,
    private readonly now: () => Date = () => new Date(),
  ) {}

  onReward(listener: RewardListener): () => void {
    this.listeners.push(listener)
    return () => {
      this.listeners = this.listeners.filter((l) => l !== listener)
    }
  }

  private today(): string {
    return localDateKey(this.now())
  }

  totalXp(): number {
    return Number(this.db.value('SELECT COALESCE(SUM(amount), 0) FROM xp_events') ?? 0)
  }

  activeDays(): string[] {
    return this.db.all<{ date: string }>('SELECT DISTINCT date FROM activity_log ORDER BY date').map((r) => r.date)
  }

  // ---------- recording ----------
  record(event: LearningEvent): Reward {
    const reward = this.db.transaction(() => this.recordInTx(event))
    if (reward.xpGained > 0 || reward.questsCompleted.length || reward.achievementsUnlocked.length) {
      for (const l of this.listeners) {
        try {
          l(reward, event)
        } catch {
          /* listeners must never break recording */
        }
      }
    }
    return reward
  }

  private recordInTx(event: LearningEvent): Reward {
    const nowIso = this.now().toISOString()
    const date = this.today()
    this.ensureQuests()
    const levelBefore = levelFromXp(this.totalXp()).level

    let xp = event.xpOverride ?? xpForActivity(event.type, { score: event.score, minutes: event.minutes })
    if (event.type === 'tutor_message') {
      const todayTutor = Number(
        this.db.value("SELECT COALESCE(SUM(amount), 0) FROM xp_events WHERE date = ? AND source = 'tutor_message'", [
          date,
        ]) ?? 0,
      )
      xp = Math.max(0, Math.min(xp, TUTOR_DAILY_XP_CAP - todayTutor))
    }
    const skill = event.skill ?? null
    const minutes = Math.max(0, event.minutes ?? 0)
    if (xp > 0) {
      this.db.run('INSERT INTO xp_events(amount, source, skill, ref, date, created_at) VALUES (?, ?, ?, ?, ?, ?)', [
        xp,
        event.type,
        skill,
        event.ref ?? null,
        date,
        nowIso,
      ])
    }
    this.db.run(
      `INSERT INTO activity_log(module, action, title, ref, skill, minutes, xp, date, created_at, score)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        event.module,
        event.type,
        (event.title ?? '').slice(0, 200),
        event.ref ?? '',
        skill,
        minutes,
        xp,
        date,
        nowIso,
        event.score ?? null,
      ],
    )
    this.bumpDaily(date, {
      minutes,
      xp,
      words: event.type === 'word_saved' ? 1 : 0,
      reviews: event.type === 'review_done' ? 1 : 0,
      lessons: event.type === 'lesson_completed' ? 1 : 0,
      skill,
    })

    // Goals
    if (minutes) this.learner.bumpGoals('minutes', minutes)
    if (event.type === 'word_saved') this.learner.bumpGoals('words', 1)
    if (event.type === 'lesson_completed') this.learner.bumpGoals('lessons', 1)
    if (xp) this.learner.bumpGoals('xp', xp)

    // Quests
    const increments: [QuestMetric, number][] = []
    const metric = EVENT_METRICS[event.type]
    if (metric) increments.push([metric, 1])
    if (event.type === 'speaking_done') increments.push(['speaking_seconds', Math.round(event.speakingSeconds ?? minutes * 60)])
    if (minutes) increments.push(['minutes', minutes])
    if (xp) increments.push(['xp', xp])
    const completed: Quest[] = []
    for (const [m, amount] of increments) completed.push(...this.advanceQuests(m, amount, nowIso))
    completed.push(...this.refreshActiveDaysQuest(nowIso))
    let questXp = 0
    for (const q of completed) {
      questXp += q.xpReward
      this.db.run('INSERT INTO xp_events(amount, source, skill, ref, date, created_at) VALUES (?, ?, ?, ?, ?, ?)', [
        q.xpReward,
        'quest',
        null,
        q.key,
        date,
        nowIso,
      ])
      this.bumpDaily(date, { minutes: 0, xp: q.xpReward, words: 0, reviews: 0, lessons: 0, skill: null })
    }

    // Achievements
    const unlocked = this.unlockAchievements(nowIso)
    const levelAfter = levelFromXp(this.totalXp()).level
    return {
      xpGained: xp + questXp,
      levelUp: levelAfter > levelBefore ? levelAfter : null,
      questsCompleted: completed,
      achievementsUnlocked: unlocked,
    }
  }

  private bumpDaily(
    date: string,
    d: { minutes: number; xp: number; words: number; reviews: number; lessons: number; skill: Skill | null },
  ) {
    const row = this.db.get<{ skill_minutes: string }>('SELECT skill_minutes FROM daily_stats WHERE date = ?', [date])
    const skillMinutes = row ? (JSON.parse(row.skill_minutes) as Record<string, number>) : {}
    if (d.skill && d.minutes) skillMinutes[d.skill] = (skillMinutes[d.skill] ?? 0) + d.minutes
    this.db.run(
      `INSERT INTO daily_stats(date, minutes, xp, words_saved, reviews, lessons, skill_minutes) VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(date) DO UPDATE SET minutes = minutes + excluded.minutes, xp = xp + excluded.xp,
       words_saved = words_saved + excluded.words_saved, reviews = reviews + excluded.reviews,
       lessons = lessons + excluded.lessons, skill_minutes = excluded.skill_minutes`,
      [date, d.minutes, d.xp, d.words, d.reviews, d.lessons, JSON.stringify(skillMinutes)],
    )
  }

  // ---------- quests ----------
  private periodKeys() {
    const now = this.now()
    return { daily: this.today(), weekly: isoWeekKey(now) }
  }

  ensureQuests(): void {
    const { daily, weekly } = this.periodKeys()
    const dailyMinutes = this.learner.profile().dailyMinutes
    const insert = (period: 'daily' | 'weekly', key: string, quests: GeneratedQuest[]) => {
      const exists = Number(
        this.db.value('SELECT COUNT(*) FROM quests WHERE period = ? AND period_key = ?', [period, key]) ?? 0,
      )
      if (exists) return
      for (const q of quests) {
        this.db.run(
          `INSERT OR IGNORE INTO quests(period, period_key, quest_key, metric, title, title_vi, target, progress, xp_reward, route)
           VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`,
          [period, key, q.key, q.metric, q.title, q.titleVi, q.target, q.xpReward, q.route],
        )
      }
    }
    const levels = this.learner.skillLevels()
    insert(
      'daily',
      daily,
      generateDailyQuests({ dateKey: daily, dailyMinutes, dueCards: this.dueCards(), weakestSkills: weakestSkills(levels, 2) }),
    )
    insert('weekly', weekly, generateWeeklyQuests({ weekKey: weekly, dailyMinutes }))
  }

  private advanceQuests(metric: QuestMetric, amount: number, nowIso: string): Quest[] {
    const { daily, weekly } = this.periodKeys()
    const rows = this.db.all<QuestRow>(
      `SELECT * FROM quests WHERE metric = ? AND completed_at IS NULL
       AND ((period = 'daily' AND period_key = ?) OR (period = 'weekly' AND period_key = ?))`,
      [metric, daily, weekly],
    )
    const done: Quest[] = []
    for (const r of rows) {
      const progress = Math.round(r.progress + amount)
      const complete = progress >= r.target
      this.db.run('UPDATE quests SET progress = ?, completed_at = ? WHERE id = ?', [
        progress,
        complete ? nowIso : null,
        r.id,
      ])
      if (complete) done.push(toQuest({ ...r, progress, completed_at: nowIso }))
    }
    return done
  }

  private refreshActiveDaysQuest(nowIso: string): Quest[] {
    const { weekly } = this.periodKeys()
    const start = weekStart(this.today())
    const days = Number(
      this.db.value('SELECT COUNT(DISTINCT date) FROM activity_log WHERE date >= ? AND date <= ?', [
        start,
        addDays(start, 6),
      ]) ?? 0,
    )
    const rows = this.db.all<QuestRow>(
      "SELECT * FROM quests WHERE metric = 'active_days' AND period = 'weekly' AND period_key = ? AND completed_at IS NULL",
      [weekly],
    )
    const done: Quest[] = []
    for (const r of rows) {
      const complete = days >= r.target
      this.db.run('UPDATE quests SET progress = ?, completed_at = ? WHERE id = ?', [days, complete ? nowIso : null, r.id])
      if (complete) done.push(toQuest({ ...r, progress: days, completed_at: nowIso }))
    }
    return done
  }

  quests(): { daily: Quest[]; weekly: Quest[] } {
    this.ensureQuests()
    const { daily, weekly } = this.periodKeys()
    const list = (period: string, key: string) =>
      this.db
        .all<QuestRow>('SELECT * FROM quests WHERE period = ? AND period_key = ? ORDER BY id', [period, key])
        .map(toQuest)
    return { daily: list('daily', daily), weekly: list('weekly', weekly) }
  }

  // ---------- achievements ----------
  achievementStats(): AchievementStats {
    const count = (action: string) =>
      Number(this.db.value('SELECT COUNT(*) FROM activity_log WHERE action = ?', [action]) ?? 0)
    const days = this.activeDays()
    return {
      words: Number(this.db.value('SELECT COUNT(*) FROM vocabulary') ?? 0),
      reviews: Number(this.db.value('SELECT COUNT(*) FROM review_logs') ?? 0),
      listening: count('listening_done'),
      reading: count('reading_done'),
      writing: count('writing_submitted'),
      speakingSeconds: Math.round(
        Number(
          this.db.value("SELECT COALESCE(SUM(minutes), 0) FROM activity_log WHERE action = 'speaking_done'") ?? 0,
        ) * 60,
      ),
      cinemaScenes: count('cinema_scene'),
      storiesCompleted: count('story_completed'),
      // Counted from history so replaying a film never lowers it (a good ending is recorded with score 1).
      goodEndings: Number(this.db.value("SELECT COUNT(*) FROM activity_log WHERE action = 'story_completed' AND score >= 1") ?? 0),
      longestStreak: computeStreak(days, this.today()).longest,
      level: levelFromXp(this.totalXp()).level,
      assessments: count('assessment_done'),
      tutorMessages: count('tutor_message'),
      grammar: count('grammar_done'),
      activeDays: days.length,
      perfectQuizzes: Number(this.db.value('SELECT COUNT(*) FROM activity_log WHERE score >= 1') ?? 0),
      questsCompleted: Number(this.db.value('SELECT COUNT(*) FROM quests WHERE completed_at IS NOT NULL') ?? 0),
    }
  }

  private unlockAchievements(nowIso: string): Achievement[] {
    const unlockedKeys = new Set(this.db.all<{ key: string }>('SELECT key FROM achievements').map((r) => r.key))
    const evals = evaluateAchievements(this.achievementStats(), unlockedKeys)
    const fresh: Achievement[] = []
    for (const e of evals.filter((x) => x.newlyUnlocked)) {
      this.db.run('INSERT OR IGNORE INTO achievements(key, unlocked_at) VALUES (?, ?)', [e.key, nowIso])
      const def = ACHIEVEMENTS.find((a) => a.key === e.key)
      if (def) fresh.push({ ...def, progress: 1, current: e.current, target: e.target, unlockedAt: nowIso })
    }
    return fresh
  }

  achievements(): Achievement[] {
    const unlocked = new Map(
      this.db.all<{ key: string; unlocked_at: string }>('SELECT * FROM achievements').map((r) => [r.key, r.unlocked_at]),
    )
    const evals = new Map(evaluateAchievements(this.achievementStats(), new Set(unlocked.keys())).map((e) => [e.key, e]))
    return ACHIEVEMENTS.map((a) => {
      const e = evals.get(a.key)
      return {
        key: a.key,
        title: a.title,
        titleVi: a.titleVi,
        description: a.description,
        descriptionVi: a.descriptionVi,
        icon: a.icon,
        tier: a.tier,
        progress: unlocked.has(a.key) ? 1 : (e?.progress ?? 0),
        current: e?.current ?? 0,
        target: a.target,
        unlockedAt: unlocked.get(a.key) ?? null,
      }
    })
  }

  // ---------- game state ----------
  gameState(): GameState {
    const total = this.totalXp()
    const lvl = levelFromXp(total)
    const xpBySkill = Object.fromEntries(SKILLS.map((s) => [s, 0])) as Record<Skill, number>
    for (const r of this.db.all<{ skill: Skill | null; xp: number }>(
      'SELECT skill, SUM(amount) AS xp FROM xp_events WHERE skill IS NOT NULL GROUP BY skill',
    )) {
      if (r.skill && r.skill in xpBySkill) xpBySkill[r.skill] = Number(r.xp)
    }
    const days = this.activeDays()
    return {
      totalXp: total,
      level: lvl.level,
      levelTitle: levelTitle(lvl.level),
      xpIntoLevel: lvl.xpIntoLevel,
      xpForNextLevel: lvl.xpForNextLevel,
      streak: computeStreak(days, this.today()),
      totalActiveDays: days.length,
      todayXp: Number(this.db.value('SELECT COALESCE(SUM(amount), 0) FROM xp_events WHERE date = ?', [this.today()]) ?? 0),
      regions: computeRegions(xpBySkill),
      unlockedAccents: unlockedAccents(lvl.level),
    }
  }

  // ---------- statistics ----------
  private dailyRange(days: number): DailyStat[] {
    const today = this.today()
    const from = addDays(today, -(days - 1))
    const rows = new Map(
      this.db
        .all<{ date: string; minutes: number; xp: number; words_saved: number; reviews: number; lessons: number }>(
          'SELECT * FROM daily_stats WHERE date >= ? AND date <= ?',
          [from, today],
        )
        .map((r) => [r.date, r]),
    )
    const out: DailyStat[] = []
    for (let i = 0; i < days; i++) {
      const date = addDays(from, i)
      const r = rows.get(date)
      out.push({
        date,
        minutes: Math.round((r?.minutes ?? 0) * 10) / 10,
        xp: r?.xp ?? 0,
        wordsSaved: r?.words_saved ?? 0,
        reviews: r?.reviews ?? 0,
        lessons: r?.lessons ?? 0,
      })
    }
    return out
  }

  stats(): StatsOverview {
    const last30 = this.dailyRange(30)
    const last7 = last30.slice(-7)
    const count = (action: string) =>
      Number(this.db.value('SELECT COUNT(*) FROM activity_log WHERE action = ?', [action]) ?? 0)
    const skillMinutes = Object.fromEntries(SKILLS.map((s) => [s, 0])) as Record<Skill, number>
    for (const r of this.db.all<{ skill: Skill; m: number }>(
      'SELECT skill, SUM(minutes) AS m FROM activity_log WHERE skill IS NOT NULL GROUP BY skill',
    )) {
      if (r.skill in skillMinutes) skillMinutes[r.skill] = Math.round(Number(r.m))
    }
    const series = <T>(sql: string, map: (r: Record<string, unknown>) => T) =>
      this.db.all<Record<string, unknown>>(sql).map(map)
    return {
      today: last30[last30.length - 1] as DailyStat,
      last7,
      last30,
      totals: {
        xp: this.totalXp(),
        minutes: Math.round(Number(this.db.value('SELECT COALESCE(SUM(minutes), 0) FROM daily_stats') ?? 0)),
        words: Number(this.db.value('SELECT COUNT(*) FROM vocabulary') ?? 0),
        reviews: Number(this.db.value('SELECT COUNT(*) FROM review_logs') ?? 0),
        listening: count('listening_done'),
        reading: count('reading_done'),
        writing: count('writing_submitted'),
        speakingMinutes: Math.round(
          Number(this.db.value("SELECT COALESCE(SUM(minutes), 0) FROM activity_log WHERE action = 'speaking_done'") ?? 0),
        ),
        cinemaScenes: count('cinema_scene'),
        storiesCompleted: count('story_completed'),
        activeDays: this.activeDays().length,
      },
      skillMinutes,
      skillLevels: this.learner.skillLevels(),
      readingWpm: series(
        'SELECT substr(created_at, 1, 10) AS d, AVG(wpm) AS v FROM reading_history GROUP BY d ORDER BY d DESC LIMIT 30',
        (r) => ({ date: String(r.d), wpm: Math.round(Number(r.v)) }),
      ).reverse(),
      listeningAccuracy: series(
        'SELECT substr(created_at, 1, 10) AS d, AVG(accuracy) AS v FROM listening_history WHERE accuracy IS NOT NULL GROUP BY d ORDER BY d DESC LIMIT 30',
        (r) => ({ date: String(r.d), accuracy: Math.round(Number(r.v) * 100) / 100 }),
      ).reverse(),
      writingScores: series(
        `SELECT substr(created_at, 1, 10) AS d, feedback FROM writing_submissions WHERE feedback IS NOT NULL ORDER BY created_at DESC LIMIT 30`,
        (r) => {
          let score = 0
          try {
            const fb = JSON.parse(String(r.feedback)) as { scores?: Record<string, number> }
            const vals = Object.values(fb.scores ?? {})
            score = vals.length ? Math.round((vals.reduce((a, b) => a + b, 0) / vals.length) * 10) / 10 : 0
          } catch {
            /* ignore malformed feedback */
          }
          return { date: String(r.d), score }
        },
      ).reverse(),
    }
  }

  activity(limit = 50, beforeId?: number): ActivityEntry[] {
    return this.db
      .all<{
        id: number
        module: string
        action: string
        title: string
        ref: string
        minutes: number
        xp: number
        created_at: string
      }>(
        `SELECT id, module, action, title, ref, minutes, xp, created_at FROM activity_log
         ${beforeId ? 'WHERE id < ?' : ''} ORDER BY id DESC LIMIT ?`,
        beforeId ? [beforeId, limit] : [limit],
      )
      .map((r) => ({ ...r, createdAt: r.created_at }))
  }

  /** Activity counts per day for the calendar heatmap (inclusive range). */
  calendar(from: string, to: string): { date: string; minutes: number; xp: number }[] {
    return this.db
      .all<{ date: string; minutes: number; xp: number }>(
        'SELECT date, minutes, xp FROM daily_stats WHERE date >= ? AND date <= ? ORDER BY date',
        [from, to],
      )
      .map((r) => ({ date: r.date, minutes: Math.round(r.minutes), xp: r.xp }))
  }

  /** Minutes already studied today – used by reminders. */
  minutesToday(): number {
    return Number(this.db.value('SELECT minutes FROM daily_stats WHERE date = ?', [this.today()]) ?? 0)
  }
}
