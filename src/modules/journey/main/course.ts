// Course path built from the Sprigo-derived syllabus pack (MIT). Lesson completion is stored in
// lesson_attempts (module 'journey', content_ref = lesson id).
import packJson from '@content/packs/sprigo-en-syllabus/pack.json'
import syllabusJson from '@content/packs/sprigo-en-syllabus/syllabus.json'
import type { Cefr } from '@shared/content'
import {
  PackMetaSchema,
  SyllabusPackSchema,
  type PackMeta,
  type SyllabusLesson,
  type SyllabusPack,
} from '@shared/packs'
import type { Reward } from '@shared/types'
import type { Kernel } from '../../../main/kernel'
import { UserError } from '../../../main/ipc/router'
import { relatedGrammarTopics } from './logic'
import type { CourseLessonDetail, CourseOverview, LessonCompleteResult, SaveWordsResult } from '../contract'

export const COURSE_ATTRIBUTION = 'Course outline adapted from Sprigo (MIT)'

interface Located {
  lesson: SyllabusLesson
  levelIndex: number
  unitIndex: number
  flatIndex: number
}

export class CourseService {
  private syllabus: SyllabusPack | null = null
  private meta: PackMeta | null = null
  private flat: Located[] = []

  constructor(
    private readonly k: Kernel,
    private readonly sources: { syllabus: unknown; meta: unknown } = { syllabus: syllabusJson, meta: packJson },
  ) {}

  private load(): SyllabusPack {
    if (this.syllabus) return this.syllabus
    const parsed = SyllabusPackSchema.safeParse(this.sources.syllabus)
    if (!parsed.success) {
      this.k.log.error(`journey: syllabus pack invalid: ${parsed.error.issues[0]?.message ?? 'unknown'}`)
      throw new UserError(
        'content_invalid',
        'Dữ liệu khóa học bị lỗi. Hãy cài lại ứng dụng hoặc xem nhật ký trong Cài đặt → Chẩn đoán.',
      )
    }
    const meta = PackMetaSchema.safeParse(this.sources.meta)
    this.meta = meta.success ? meta.data : null
    this.syllabus = parsed.data
    this.flat = []
    parsed.data.forEach((level, levelIndex) =>
      level.units.forEach((unit, unitIndex) =>
        unit.lessons.forEach((lesson) =>
          this.flat.push({ lesson, levelIndex, unitIndex, flatIndex: this.flat.length }),
        ),
      ),
    )
    return parsed.data
  }

  private completedMap(): Map<string, string> {
    const rows = this.k.db.all<{ content_ref: string; at: string }>(
      `SELECT content_ref, MIN(created_at) AS at FROM lesson_attempts
       WHERE module = 'journey' AND content_ref IS NOT NULL GROUP BY content_ref`,
    )
    return new Map(rows.map((r) => [r.content_ref, r.at]))
  }

  overview(): CourseOverview {
    const syllabus = this.load()
    const done = this.completedMap()
    const levels = syllabus.map((level) => {
      const units = level.units.map((u) => {
        const lessons = u.lessons.map((l) => ({
          id: l.id,
          order: l.order,
          title: l.title,
          description: l.description,
          completed: done.has(l.id),
        }))
        return {
          id: u.id,
          order: u.order,
          cefr: u.cefr,
          title: u.title,
          description: u.description,
          icon: u.icon,
          lessons,
          completed: lessons.filter((l) => l.completed).length,
          total: lessons.length,
        }
      })
      return {
        cefr: level.cefr,
        title: level.title,
        canDo: level.canDo,
        checkpoint: level.checkpoint?.title ?? null,
        units,
        completed: units.reduce((n, u) => n + u.completed, 0),
        total: units.reduce((n, u) => n + u.total, 0),
      }
    })
    return {
      attribution: COURSE_ATTRIBUTION,
      sourceUrl: this.meta?.source ?? 'https://github.com/ozerozdas/sprigo',
      license: this.meta?.license ?? 'MIT',
      recommendedLevel: this.k.learner.overallCefr(),
      levels,
      completed: levels.reduce((n, l) => n + l.completed, 0),
      total: levels.reduce((n, l) => n + l.total, 0),
    }
  }

  private locate(id: string): Located {
    this.load()
    const found = this.flat.find((f) => f.lesson.id === id)
    if (!found) throw new UserError('not_found', 'Không tìm thấy bài học này trong khóa học.')
    return found
  }

  lesson(id: string): CourseLessonDetail {
    const syllabus = this.load()
    const loc = this.locate(id)
    const level = syllabus[loc.levelIndex] as SyllabusPack[number]
    const unit = level.units[loc.unitIndex] as SyllabusPack[number]['units'][number]
    const l = loc.lesson
    const completedAt = this.completedMap().get(l.id) ?? null
    const vocabulary = l.vocabulary.map((word) => {
      const hit = this.k.content.lookup(word)
      return {
        word,
        ipa: hit?.entry.ipa ?? null,
        meaningVi: hit?.entry.meaningVi ?? null,
        saved: this.k.vocab.findByWord(word) !== null,
      }
    })
    return {
      id: l.id,
      cefr: l.cefr,
      title: l.title,
      description: l.description,
      order: l.order,
      unit: { id: unit.id, title: unit.title, icon: unit.icon, lessonCount: unit.lessons.length },
      levelTitle: level.title,
      canDo: level.canDo,
      grammar: l.grammar,
      vocabulary,
      activities: l.activities.map((a) => ({
        type: a.type,
        count: a.count,
        ...(a.scenario ? { scenario: a.scenario } : {}),
        ...(a.goal ? { goal: a.goal } : {}),
      })),
      completed: completedAt !== null,
      completedAt,
      prevId: this.flat[loc.flatIndex - 1]?.lesson.id ?? null,
      nextId: this.flat[loc.flatIndex + 1]?.lesson.id ?? null,
      relatedGrammar: relatedGrammarTopics(l, this.k.content.grammar()).map((g) => ({
        id: g.id,
        title: g.title,
        cefr: g.cefr as Cefr,
      })),
    }
  }

  complete(id: string, completed: boolean): LessonCompleteResult {
    const { lesson } = this.locate(id)
    const already = this.completedMap().has(id)
    let reward: Reward | null = null
    if (completed && !already) {
      const minutes = Math.max(
        5,
        Math.min(
          25,
          lesson.activities.reduce((n, a) => n + a.count, 0),
        ),
      )
      this.k.db.run(
        `INSERT INTO lesson_attempts(module, content_ref, title, score, duration_sec, details, created_at)
         VALUES ('journey', ?, ?, NULL, ?, ?, ?)`,
        [
          id,
          lesson.title,
          minutes * 60,
          JSON.stringify({ kind: 'course', cefr: lesson.cefr }),
          this.k.now().toISOString(),
        ],
      )
      const skill = lesson.grammar.length ? 'grammar' : 'vocabulary'
      reward = this.k.progress.record({
        type: 'lesson_completed',
        module: 'journey',
        skill,
        minutes,
        ref: `course:${id}`,
        title: lesson.title,
      })
      this.k.learner.addSkillProgress(skill, 0.5)
    } else if (!completed && already) {
      this.k.db.run("DELETE FROM lesson_attempts WHERE module = 'journey' AND content_ref = ?", [id])
    }
    return { lesson: this.lesson(id), reward }
  }

  saveWords(id: string): SaveWordsResult {
    const loc = this.locate(id)
    const syllabus = this.load()
    const unit = syllabus[loc.levelIndex]?.units[loc.unitIndex]
    let saved = 0
    let existing = 0
    for (const word of loc.lesson.vocabulary) {
      const hit = this.k.content.lookup(word)
      const e = hit?.entry
      const res = this.k.vocab.save({
        word,
        ipa: e?.ipa,
        pos: e?.pos,
        meaningVi: e?.meaningVi,
        meaningEn: e?.meaningEn,
        examples: e?.example ? [e.example] : [],
        sourceModule: 'manual',
        sourceRef: `course:${id}`,
        cefr: e?.cefr ?? loc.lesson.cefr,
        topic: unit?.title.slice(0, 60),
      })
      if (res.created) saved++
      else existing++
    }
    return { saved, existing, lesson: this.lesson(id) }
  }
}
