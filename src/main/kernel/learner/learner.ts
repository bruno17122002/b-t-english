// Learner model: profile, per-skill CEFR, goals and the recurring-mistake memory that personalises AI.
import type { Cefr } from '@shared/content'
import type { LearningGoal, Profile, Skill, SkillLevel } from '@shared/types'
import { SKILLS } from '@shared/types'
import { averageCefr, SELF_LEVEL_TO_CEFR } from '@core/cefr'
import { cleanInline } from '@core/text'
import type { AppDatabase } from '../../db/database'
import type { LearnerSummary } from '../ai/prompt'
import { definedOnly } from '../errors'

interface ProfileRow {
  display_name: string
  self_reported_level: Profile['selfReportedLevel']
  overall_cefr: Cefr | null
  target_cefr: Cefr
  target_ielts: number | null
  daily_minutes: number
  purposes: string
  interests: string
  learning_style: Profile['learningStyle']
  onboarding_completed_at: string | null
  created_at: string
}

interface SkillRow {
  skill: Skill
  cefr: Cefr
  score: number
  source: SkillLevel['source']
  estimated: number
  updated_at: string
}

interface GoalRow {
  id: number
  kind: LearningGoal['kind']
  title: string
  metric: LearningGoal['metric']
  target_value: number
  current_value: number
  target_date: string | null
  status: LearningGoal['status']
  created_at: string
}

const parseList = (s: string): string[] => {
  try {
    const v = JSON.parse(s) as unknown
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []
  } catch {
    return []
  }
}

export type ProfilePatch = Partial<Omit<Profile, 'createdAt' | 'onboardingCompletedAt'>> & {
  onboardingCompleted?: boolean
}

export class LearnerService {
  constructor(
    private readonly db: AppDatabase,
    private readonly now: () => Date = () => new Date(),
  ) {}

  private ensureProfile(): ProfileRow {
    const row = this.db.get<ProfileRow>('SELECT * FROM user_profile WHERE id = 1')
    if (row) return row
    const ts = this.now().toISOString()
    this.db.run('INSERT INTO user_profile(id, created_at, updated_at) VALUES (1, ?, ?)', [ts, ts])
    return this.db.get<ProfileRow>('SELECT * FROM user_profile WHERE id = 1') as ProfileRow
  }

  profile(): Profile {
    const r = this.ensureProfile()
    return {
      displayName: r.display_name,
      selfReportedLevel: r.self_reported_level,
      overallCefr: r.overall_cefr,
      targetCefr: r.target_cefr,
      targetIelts: r.target_ielts,
      dailyMinutes: r.daily_minutes,
      purposes: parseList(r.purposes),
      interests: parseList(r.interests),
      learningStyle: r.learning_style,
      onboardingCompletedAt: r.onboarding_completed_at,
      createdAt: r.created_at,
    }
  }

  updateProfile(patch: ProfilePatch): Profile {
    const cur = this.profile()
    // `{ displayName: undefined }` means "unchanged", never "clear the column".
    const next = { ...cur, ...definedOnly(patch) }
    const completedAt =
      patch.onboardingCompleted === true
        ? (cur.onboardingCompletedAt ?? this.now().toISOString())
        : patch.onboardingCompleted === false
          ? null
          : cur.onboardingCompletedAt
    this.db.run(
      `UPDATE user_profile SET display_name = ?, self_reported_level = ?, overall_cefr = ?, target_cefr = ?, target_ielts = ?,
       daily_minutes = ?, purposes = ?, interests = ?, learning_style = ?, onboarding_completed_at = ?, updated_at = ? WHERE id = 1`,
      [
        cleanInline(next.displayName, 60),
        next.selfReportedLevel,
        next.overallCefr,
        next.targetCefr,
        next.targetIelts,
        Math.round(Math.min(240, Math.max(5, next.dailyMinutes))),
        JSON.stringify(next.purposes.slice(0, 12)),
        JSON.stringify(next.interests.slice(0, 20)),
        next.learningStyle,
        completedAt,
        this.now().toISOString(),
      ],
    )
    return this.profile()
  }

  skillLevels(): SkillLevel[] {
    const rows = this.db.all<SkillRow>('SELECT * FROM skill_levels')
    const byKey = new Map(rows.map((r) => [r.skill, r]))
    const fallback = SELF_LEVEL_TO_CEFR[this.profile().selfReportedLevel]
    return SKILLS.map((skill) => {
      const r = byKey.get(skill)
      return r
        ? {
            skill,
            cefr: r.cefr,
            score: r.score,
            source: r.source,
            estimated: r.estimated === 1,
            updatedAt: r.updated_at,
          }
        : { skill, cefr: fallback, score: 0, source: 'self' as const, estimated: true, updatedAt: '' }
    })
  }

  setSkillLevel(level: Omit<SkillLevel, 'updatedAt'>): void {
    this.db.run(
      `INSERT INTO skill_levels(skill, cefr, score, source, estimated, updated_at) VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(skill) DO UPDATE SET cefr = excluded.cefr, score = excluded.score, source = excluded.source,
       estimated = excluded.estimated, updated_at = excluded.updated_at`,
      [
        level.skill,
        level.cefr,
        Math.min(100, Math.max(0, level.score)),
        level.source,
        level.estimated ? 1 : 0,
        this.now().toISOString(),
      ],
    )
    this.refreshOverall()
  }

  /** Nudges the progress score inside the current level; promotes to the next level at 100. */
  addSkillProgress(skill: Skill, delta: number): SkillLevel {
    const cur = this.skillLevels().find((s) => s.skill === skill) as SkillLevel
    let score = cur.score + delta
    let cefr = cur.cefr
    const order = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'] as const
    if (score >= 100 && cefr !== 'C2') {
      cefr = order[order.indexOf(cefr) + 1] as Cefr
      score = score - 100
    }
    this.setSkillLevel({ skill, cefr, score: Math.min(100, Math.max(0, score)), source: 'progress', estimated: true })
    return this.skillLevels().find((s) => s.skill === skill) as SkillLevel
  }

  private refreshOverall() {
    const overall = averageCefr(this.skillLevels().map((s) => s.cefr))
    this.db.run('UPDATE user_profile SET overall_cefr = ? WHERE id = 1', [overall])
  }

  overallCefr(): Cefr {
    const p = this.profile()
    return p.overallCefr ?? SELF_LEVEL_TO_CEFR[p.selfReportedLevel]
  }

  // ---------- goals ----------
  goals(): LearningGoal[] {
    return this.db
      .all<GoalRow>("SELECT * FROM learning_goals WHERE status != 'archived' ORDER BY status, created_at DESC")
      .map((r) => ({
        id: r.id,
        kind: r.kind,
        title: r.title,
        metric: r.metric,
        targetValue: r.target_value,
        currentValue: r.current_value,
        targetDate: r.target_date,
        status: r.status,
        createdAt: r.created_at,
      }))
  }

  saveGoal(goal: Omit<LearningGoal, 'id' | 'createdAt' | 'currentValue'> & { id?: number }): LearningGoal[] {
    if (goal.id) {
      this.db.run(
        'UPDATE learning_goals SET kind = ?, title = ?, metric = ?, target_value = ?, target_date = ?, status = ? WHERE id = ?',
        [
          goal.kind,
          cleanInline(goal.title, 200),
          goal.metric,
          goal.targetValue,
          goal.targetDate || null,
          goal.status,
          goal.id,
        ],
      )
    } else {
      this.db.run(
        'INSERT INTO learning_goals(kind, title, metric, target_value, target_date, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [
          goal.kind,
          cleanInline(goal.title, 200),
          goal.metric,
          goal.targetValue,
          goal.targetDate || null,
          goal.status,
          this.now().toISOString(),
        ],
      )
    }
    return this.goals()
  }

  deleteGoal(id: number): LearningGoal[] {
    this.db.run('DELETE FROM learning_goals WHERE id = ?', [id])
    return this.goals()
  }

  /** Advances metric-based goals; called by the progress service. */
  bumpGoals(metric: LearningGoal['metric'], amount: number): void {
    if (amount <= 0 || metric === 'none') return
    this.db.run(
      `UPDATE learning_goals SET current_value = current_value + ?,
       status = CASE WHEN current_value + ? >= target_value AND target_value > 0 THEN 'done' ELSE status END
       WHERE status = 'active' AND metric = ?`,
      [amount, amount, metric],
    )
  }

  // ---------- mistake memory ----------
  recordMistake(m: { category: string; pattern: string; example?: string; correction?: string }): void {
    const key = `${m.category}:${m.pattern}`.toLowerCase().replace(/\s+/g, ' ').trim().slice(0, 200)
    if (!m.pattern.trim()) return
    this.db.run(
      `INSERT INTO learner_mistakes(category, pattern, pattern_key, example, correction, count, last_seen_at)
       VALUES (?, ?, ?, ?, ?, 1, ?)
       ON CONFLICT(pattern_key) DO UPDATE SET count = count + 1, example = excluded.example,
       correction = excluded.correction, last_seen_at = excluded.last_seen_at`,
      [
        m.category.slice(0, 40),
        m.pattern.slice(0, 200),
        key,
        (m.example ?? '').slice(0, 300),
        (m.correction ?? '').slice(0, 300),
        this.now().toISOString(),
      ],
    )
  }

  mistakes(limit = 20) {
    return this.db
      .all<{
        id: number
        category: string
        pattern: string
        example: string
        correction: string
        count: number
        last_seen_at: string
      }>('SELECT * FROM learner_mistakes ORDER BY count DESC, last_seen_at DESC LIMIT ?', [limit])
      .map((r) => ({
        id: r.id,
        category: r.category,
        pattern: r.pattern,
        example: r.example,
        correction: r.correction,
        count: r.count,
        lastSeenAt: r.last_seen_at,
      }))
  }

  deleteMistake(id: number): void {
    this.db.run('DELETE FROM learner_mistakes WHERE id = ?', [id])
  }

  /** Compact profile handed to every AI prompt (no personal data beyond display name and interests). */
  summary(): LearnerSummary {
    const p = this.profile()
    return {
      displayName: p.displayName,
      overallCefr: this.overallCefr(),
      targetCefr: p.targetCefr,
      skills: this.skillLevels().map((s) => ({ skill: s.skill, cefr: s.cefr })),
      interests: p.interests,
      purposes: p.purposes,
      mistakes: this.mistakes(5).map((m) => ({
        category: m.category,
        pattern: m.pattern,
        correction: m.correction,
        count: m.count,
      })),
    }
  }
}
