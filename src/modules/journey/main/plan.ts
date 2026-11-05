// Today's plan: concrete lessons picked from bundled content at the learner's levels, persisted in `lessons`
// so the plan stays stable for the day. Also builds the dashboard summary.
import type { Cefr } from '@shared/content'
import type { ModuleId, PlanLesson, Reward, Skill } from '@shared/types'
import { buildDailyPlan, weakestSkills, type LibraryItem } from '@core/roadmap'
import { localDateKey } from '@core/dates'
import { countWords } from '@core/text'
import type { Kernel } from '../../../main/kernel'
import { UserError } from '../../../main/ipc/router'
import { routeForPlanItem, skillForModule, tipForDate } from './logic'
import type { ContinueItem, DashboardData, PlanLessonView, PlanStatusResult, TodayPlan } from '../contract'
import type { RoadmapService } from './roadmap'

interface LessonRow {
  id: number
  date: string
  module: ModuleId
  title: string
  description: string
  content_ref: string | null
  estimated_minutes: number
  status: PlanLesson['status']
  completed_at: string | null
  position: number
}

/** Runs a query against a table that another module owns; returns [] if the shape differs. */
function safe<T>(fn: () => T[]): T[] {
  try {
    return fn()
  } catch {
    return []
  }
}

export class PlanService {
  /** Lesson ids auto-completed in this process (shown with a hint in the UI). */
  private readonly auto = new Set<number>()

  constructor(
    private readonly k: Kernel,
    private readonly roadmaps: RoadmapService,
  ) {}

  private today(): string {
    return localDateKey(this.k.now())
  }

  /** Bundled content as plan candidates. */
  library(): LibraryItem[] {
    const c = this.k.content
    const items: LibraryItem[] = []
    for (const p of c.reading())
      items.push({
        module: 'reading',
        ref: p.id,
        title: p.title,
        cefr: p.cefr,
        minutes: Math.min(15, Math.max(6, Math.round(countWords(p.body) / 60) + 4)),
      })
    for (const t of c.listening())
      items.push({ module: 'listening', ref: t.id, title: t.title, cefr: t.cefr, minutes: 10 })
    for (const g of c.grammar()) items.push({ module: 'grammar', ref: g.id, title: g.title, cefr: g.cefr, minutes: 12 })
    for (const s of c.stories()) items.push({ module: 'cinema', ref: s.id, title: s.title, cefr: s.cefr, minutes: 15 })
    for (const w of c.writingPrompts())
      items.push({ module: 'writing', ref: w.id, title: w.title, cefr: w.cefr, minutes: w.maxWords > 150 ? 20 : 12 })
    for (const s of c.speakingPrompts())
      items.push({
        module: 'speaking',
        ref: s.id,
        title: s.title,
        cefr: s.cefr,
        minutes: Math.min(15, Math.max(6, Math.round(s.durationSec / 60) * 3)),
      })
    return items
  }

  /** Content already finished, so the plan offers something new. */
  completedRefs(): Set<string> {
    const db = this.k.db
    const refs = [
      ...safe(() => db.all<{ r: string }>('SELECT DISTINCT passage_id AS r FROM reading_history')),
      ...safe(() => db.all<{ r: string }>('SELECT DISTINCT track_id AS r FROM listening_history')),
      ...safe(() =>
        db.all<{ r: string }>('SELECT DISTINCT prompt_id AS r FROM writing_submissions WHERE prompt_id IS NOT NULL'),
      ),
      ...safe(() =>
        db.all<{ r: string }>('SELECT DISTINCT prompt_id AS r FROM speaking_sessions WHERE prompt_id IS NOT NULL'),
      ),
      ...safe(() => db.all<{ r: string }>('SELECT story_id AS r FROM story_progress WHERE completed_at IS NOT NULL')),
      ...safe(() =>
        db.all<{ r: string }>(
          "SELECT DISTINCT content_ref AS r FROM lesson_attempts WHERE module = 'grammar' AND content_ref IS NOT NULL",
        ),
      ),
    ]
    return new Set(refs.map((x) => x.r).filter(Boolean))
  }

  private focusSkills(): { skills: Skill[]; roadmapId: number | null } {
    const roadmap = this.roadmaps.get()
    const levels = this.k.learner.skillLevels()
    const weakest = weakestSkills(levels, 3)
    if (roadmap) {
      const week =
        roadmap.weeks.find((w) => w.weekIndex === roadmap.currentWeek) ?? roadmap.weeks[roadmap.weeks.length - 1]
      const focus = week?.focusSkills.length ? week.focusSkills : roadmap.summary.prioritySkills
      return { skills: [...new Set([...focus, ...weakest])].slice(0, 4), roadmapId: roadmap.id }
    }
    return { skills: weakest, roadmapId: null }
  }

  private rows(date: string): LessonRow[] {
    return this.k.db.all<LessonRow>('SELECT * FROM lessons WHERE date = ? ORDER BY position, id', [date])
  }

  private create(date: string): void {
    const profile = this.k.learner.profile()
    const levels: Partial<Record<Skill, Cefr>> = {}
    for (const s of this.k.learner.skillLevels()) levels[s.skill] = s.cefr
    const { skills, roadmapId } = this.focusSkills()
    const plan = buildDailyPlan({
      dateKey: date,
      dailyMinutes: profile.dailyMinutes,
      focusSkills: skills,
      levels,
      library: this.library(),
      completedRefs: this.completedRefs(),
      dueCards: this.k.vocab.dueCount(),
    })
    this.k.db.transaction(() => {
      // Re-check inside the transaction so a plan is never created twice for a day.
      if (Number(this.k.db.value('SELECT COUNT(*) FROM lessons WHERE date = ?', [date]) ?? 0) > 0) return
      plan.forEach((p, i) => {
        this.k.db.run(
          `INSERT INTO lessons(roadmap_id, date, module, title, description, content_ref, estimated_minutes, status, position)
           VALUES (?, ?, ?, ?, ?, ?, ?, 'todo', ?)`,
          [
            roadmapId,
            date,
            p.module,
            p.title,
            p.description,
            p.contentRef,
            Math.max(1, Math.round(p.estimatedMinutes)),
            i,
          ],
        )
      })
    })
  }

  /** Marks plan items done when the learner already did that activity today in its module (no extra XP). */
  private autoComplete(date: string, rows: LessonRow[]): void {
    const todo = rows.filter((r) => r.status === 'todo')
    if (!todo.length) return
    const activity = safe(() =>
      this.k.db.all<{ module: string; action: string; ref: string }>(
        'SELECT module, action, ref FROM activity_log WHERE date = ?',
        [date],
      ),
    )
    if (!activity.length) return
    const nowIso = this.k.now().toISOString()
    for (const r of todo) {
      let done = false
      if (r.module === 'vocabulary') {
        const reviewed = activity.some((a) => a.action === 'review_done')
        const saved = activity.filter((a) => a.action === 'word_saved').length
        done = /review/i.test(r.title) ? reviewed && this.k.vocab.dueCount() === 0 : saved >= 10
      } else if (r.content_ref) {
        done = activity.some((a) => a.module === r.module && a.ref === r.content_ref)
      }
      if (done) {
        this.k.db.run("UPDATE lessons SET status = 'done', completed_at = ? WHERE id = ? AND status = 'todo'", [
          nowIso,
          r.id,
        ])
        r.status = 'done'
        r.completed_at = nowIso
        this.auto.add(r.id)
      }
    }
  }

  private toView(r: LessonRow): PlanLessonView {
    return {
      id: r.id,
      date: r.date,
      module: r.module,
      title: r.title,
      description: r.description,
      contentRef: r.content_ref,
      estimatedMinutes: r.estimated_minutes,
      status: r.status,
      completedAt: r.completed_at,
      route: routeForPlanItem(r.module, r.content_ref, r.title),
      skill: skillForModule(r.module),
      autoDone: this.auto.has(r.id),
    }
  }

  todayPlan(): TodayPlan {
    const date = this.today()
    if (!this.rows(date).length) this.create(date)
    const rows = this.rows(date)
    this.autoComplete(date, rows)
    const lessons = rows.map((r) => this.toView(r))
    const done = lessons.filter((l) => l.status === 'done')
    return {
      date,
      lessons,
      doneCount: done.length,
      totalMinutes: lessons.filter((l) => l.status !== 'skipped').reduce((n, l) => n + l.estimatedMinutes, 0),
      doneMinutes: done.reduce((n, l) => n + l.estimatedMinutes, 0),
    }
  }

  setStatus(id: number, status: PlanLesson['status']): PlanStatusResult {
    const row = this.k.db.get<LessonRow>('SELECT * FROM lessons WHERE id = ?', [id])
    if (!row) throw new UserError('not_found', 'Không tìm thấy bài học trong kế hoạch.')
    let reward: Reward | null = null
    const nowIso = this.k.now().toISOString()
    if (status === 'done' && row.status !== 'done') {
      this.k.db.run("UPDATE lessons SET status = 'done', completed_at = ? WHERE id = ?", [nowIso, id])
      // Minutes are only counted when the module itself did not already log this activity today.
      const logged = Number(
        this.k.db.value('SELECT COUNT(*) FROM activity_log WHERE date = ? AND module = ? AND ref = ?', [
          this.today(),
          row.module,
          row.content_ref ?? '',
        ]) ?? 0,
      )
      reward = this.k.progress.record({
        type: 'lesson_completed',
        module: 'journey',
        skill: skillForModule(row.module),
        minutes: logged ? 0 : row.estimated_minutes,
        ref: `plan:${id}`,
        title: row.title,
      })
    } else if (status !== 'done') {
      this.k.db.run('UPDATE lessons SET status = ?, completed_at = NULL WHERE id = ?', [status, id])
      this.auto.delete(id)
    }
    return { plan: this.todayPlan(), reward }
  }

  private continueItem(): ContinueItem | null {
    const c = this.k.content
    const rows = safe(() =>
      this.k.db.all<{ module: string; ref: string; title: string; created_at: string; action: string }>(
        `SELECT module, ref, title, created_at, action FROM activity_log
         WHERE action NOT IN ('word_saved', 'review_done', 'assessment_done') ORDER BY id DESC LIMIT 20`,
      ),
    )
    // Content modules need a ref that still exists; open-ended modules resume at their home page.
    const withRef: Record<string, (ref: string) => boolean> = {
      reading: (ref) => c.reading().some((x) => x.id === ref),
      listening: (ref) => c.listening().some((x) => x.id === ref),
      grammar: (ref) => c.grammar().some((x) => x.id === ref),
      cinema: (ref) => c.stories().some((x) => x.id === ref),
    }
    for (const r of rows) {
      const at = r.created_at
      if (r.module === 'journey') {
        if (r.ref.startsWith('plan:')) continue
        const lessonId = r.ref.startsWith('course:') ? r.ref.slice(7) : null
        return { module: 'journey', title: r.title || 'Course', route: routeForPlanItem('journey', lessonId), at }
      }
      if (r.module === 'writing' || r.module === 'speaking' || r.module === 'tutor')
        return { module: r.module, title: r.title || r.module, route: `/${r.module}`, at }
      const check = withRef[r.module]
      if (check?.(r.ref))
        return { module: r.module, title: r.title || r.module, route: routeForPlanItem(r.module, r.ref), at }
    }
    return null
  }

  dashboard(lastAssessment: DashboardData['lastAssessment']): DashboardData {
    const plan = this.todayPlan()
    const roadmap = this.roadmaps.get()
    const week = roadmap?.weeks.find((w) => w.weekIndex === roadmap.currentWeek) ?? null
    return {
      plan,
      roadmap: roadmap
        ? {
            id: roadmap.id,
            headline: roadmap.summary.headline,
            currentWeek: roadmap.currentWeek,
            totalWeeks: roadmap.weeks.length,
            weekTheme: week?.theme ?? null,
            weekObjectives: week?.objectives ?? [],
            weekFocus: week?.focusSkills ?? [],
          }
        : null,
      lastAssessment,
      continue: this.continueItem(),
      tip: tipForDate(plan.date),
      dueCards: this.k.vocab.dueCount(),
    }
  }
}
