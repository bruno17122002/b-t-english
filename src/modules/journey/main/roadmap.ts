// Personalised roadmap: AI-generated when a provider is configured, otherwise the offline rule-based builder.
// Stored in roadmaps / roadmap_weeks; only one roadmap is active at a time.
import type { ProviderId, RoadmapSummary, RoadmapWeek, Skill } from '@shared/types'
import { buildOfflineRoadmap, projectProgress } from '@core/roadmap'
import { averageCefr } from '@core/cefr'
import { localDateKey } from '@core/dates'
import type { Kernel } from '../../../main/kernel'
import { AiError } from '../../../main/kernel/ai/types'
import { UserError } from '../../../main/ipc/router'
import { currentWeekIndex, deriveWeekStatus } from './logic'
import type { RoadmapView } from '../contract'
import { roadmapPrompt, type RoadmapPromptInput } from './prompts'

interface RoadmapRow {
  id: number
  created_at: string
  start_date: string
  source: 'ai' | 'offline'
  provider: ProviderId | null
  summary: string
  user_notes: string
}

interface WeekRow {
  id: number
  week_index: number
  theme: string
  focus_skills: string
  objectives: string
  status: RoadmapWeek['status']
}

const PROJECTION_NOTE =
  'Estimate based on typical guided learning hours per CEFR level (Cambridge guidance); real progress depends on practice quality and consistency. / Ước tính theo số giờ học có hướng dẫn điển hình cho mỗi cấp CEFR; tiến độ thực tế phụ thuộc vào chất lượng và sự đều đặn.'

const parse = <T>(s: string, fallback: T): T => {
  try {
    return JSON.parse(s) as T
  } catch {
    return fallback
  }
}

export class RoadmapService {
  constructor(private readonly k: Kernel) {}

  private today(): string {
    return localDateKey(this.k.now())
  }

  input(): RoadmapPromptInput {
    const profile = this.k.learner.profile()
    const skills = this.k.learner.skillLevels().map((s) => ({ skill: s.skill, cefr: s.cefr, score: s.score }))
    const grammarTopics = this.k.content.grammar().map((g) => ({ id: g.id, title: g.title, cefr: g.cefr }))
    const current = averageCefr(skills.map((s) => s.cefr))
    const avgScore = skills.length ? skills.reduce((n, s) => n + s.score, 0) / skills.length : 0
    const p = projectProgress({
      current,
      currentScore: avgScore,
      target: profile.targetCefr,
      dailyMinutes: profile.dailyMinutes,
    })
    return {
      displayName: profile.displayName,
      dailyMinutes: profile.dailyMinutes,
      targetCefr: profile.targetCefr,
      targetIelts: profile.targetIelts,
      learningStyle: profile.learningStyle,
      interests: profile.interests,
      purposes: profile.purposes,
      skills,
      grammarTopics,
      projection: {
        currentCefr: current,
        hoursNeeded: p.hoursNeeded,
        estimatedWeeks: p.estimatedWeeks,
        milestones: p.milestones,
      },
    }
  }

  get(): RoadmapView | null {
    const row = this.k.db.get<RoadmapRow>('SELECT * FROM roadmaps WHERE is_active = 1 ORDER BY id DESC LIMIT 1')
    return row ? this.view(row) : null
  }

  private view(row: RoadmapRow, fallbackReason?: string): RoadmapView {
    const current = currentWeekIndex(row.start_date, this.today())
    const weeks = this.k.db
      .all<WeekRow>('SELECT * FROM roadmap_weeks WHERE roadmap_id = ? ORDER BY week_index', [row.id])
      .map((w) => ({
        id: w.id,
        weekIndex: w.week_index,
        theme: w.theme,
        focusSkills: parse<Skill[]>(w.focus_skills, []),
        objectives: parse<string[]>(w.objectives, []),
        status: deriveWeekStatus(w.status, w.week_index, current),
      }))
    return {
      id: row.id,
      createdAt: row.created_at,
      source: row.source,
      provider: row.provider,
      summary: parse<RoadmapSummary>(row.summary, {} as RoadmapSummary),
      userNotes: row.user_notes,
      weeks,
      startDate: row.start_date,
      currentWeek: current,
      ...(fallbackReason ? { fallbackReason } : {}),
    }
  }

  async generate(useAi = true): Promise<RoadmapView> {
    const input = this.input()
    const offline = buildOfflineRoadmap(input)
    let summary: RoadmapSummary = offline.summary
    let weeks: Omit<RoadmapWeek, 'id' | 'status'>[] = offline.weeks
    let source: 'ai' | 'offline' = 'offline'
    let provider: ProviderId | null = null
    let fallbackReason: string | undefined
    if (useAi && this.k.ai.isAvailable()) {
      try {
        const res = await this.k.ai.run(roadmapPrompt, input)
        const ai = res.data
        // Numbers come from the deterministic projection, never from the model.
        summary = {
          ...ai.summary,
          projection: { ...offline.summary.projection, note: PROJECTION_NOTE },
          milestones: ai.summary.milestones.length ? ai.summary.milestones : offline.summary.milestones,
        }
        weeks = [...ai.weeks].sort((a, b) => a.weekIndex - b.weekIndex).map((w, i) => ({ ...w, weekIndex: i + 1 }))
        source = 'ai'
        provider = res.provider
      } catch (err) {
        if (!(err instanceof AiError)) throw err
        fallbackReason = err.userMessage
        this.k.log.warn(`journey: AI roadmap failed (${err.code}), using offline builder`)
      }
    }
    if (source === 'offline') summary = { ...summary, projection: { ...summary.projection, note: PROJECTION_NOTE } }

    const prev = this.k.db.get<{ user_notes: string }>(
      'SELECT user_notes FROM roadmaps WHERE is_active = 1 ORDER BY id DESC LIMIT 1',
    )
    const nowIso = this.k.now().toISOString()
    const id = this.k.db.transaction(() => {
      this.k.db.run('UPDATE roadmaps SET is_active = 0 WHERE is_active = 1')
      const res = this.k.db.run(
        `INSERT INTO roadmaps(created_at, start_date, source, provider, is_active, summary, user_notes)
         VALUES (?, ?, ?, ?, 1, ?, ?)`,
        [nowIso, this.today(), source, provider, JSON.stringify(summary), prev?.user_notes ?? ''],
      )
      for (const w of weeks) {
        this.k.db.run(
          `INSERT INTO roadmap_weeks(roadmap_id, week_index, theme, focus_skills, objectives, status) VALUES (?, ?, ?, ?, ?, ?)`,
          [
            res.lastInsertRowid,
            w.weekIndex,
            w.theme,
            JSON.stringify(w.focusSkills),
            JSON.stringify(w.objectives),
            'upcoming',
          ],
        )
      }
      return res.lastInsertRowid
    })
    return this.view(
      this.k.db.get<RoadmapRow>('SELECT * FROM roadmaps WHERE id = ?', [id]) as RoadmapRow,
      fallbackReason,
    )
  }

  setWeekStatus(weekId: number, status: 'upcoming' | 'done'): RoadmapView {
    const active = this.k.db.get<RoadmapRow>('SELECT * FROM roadmaps WHERE is_active = 1 ORDER BY id DESC LIMIT 1')
    if (!active) throw new UserError('no_roadmap', 'Chưa có lộ trình. Hãy tạo lộ trình trước.')
    const res = this.k.db.run('UPDATE roadmap_weeks SET status = ? WHERE id = ? AND roadmap_id = ?', [
      status,
      weekId,
      active.id,
    ])
    if (!res.changes) throw new UserError('not_found', 'Không tìm thấy tuần này trong lộ trình hiện tại.')
    return this.view(active)
  }

  setNotes(notes: string): RoadmapView {
    const active = this.k.db.get<RoadmapRow>('SELECT * FROM roadmaps WHERE is_active = 1 ORDER BY id DESC LIMIT 1')
    if (!active) throw new UserError('no_roadmap', 'Chưa có lộ trình. Hãy tạo lộ trình trước.')
    this.k.db.run('UPDATE roadmaps SET user_notes = ? WHERE id = ?', [notes, active.id])
    return this.view({ ...active, user_notes: notes })
  }
}
