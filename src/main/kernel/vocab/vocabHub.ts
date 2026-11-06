// Vocab Hub: the single word bank shared by every module. Saving a word from Reading, Listening,
// Cinema, Tutor… lands here and is scheduled with FSRS (ts-fsrs) automatically.
import { z } from 'zod'
import type { Cefr } from '@shared/content'
import { CefrSchema } from '@shared/content'
import type { DictionaryResult, DueCard, ModuleId, ReviewInfo, VocabItem, VocabStats } from '@shared/types'
import { FsrsScheduler, newCard, type CardMemory, type Rating } from '@core/srs'
import { addDays, localDateKey } from '@core/dates'
import type { AppDatabase } from '../../db/database'
import type { AiGateway } from '../ai/gateway'
import { definedOnly, UserError } from '../errors'
import { JSON_ONLY, jsonPrompt } from '../ai/prompt'
import type { ContentRegistry } from '../content/registry'
import type { LearnerService } from '../learner/learner'
import type { ProgressService } from '../progress/progress'

export interface SaveWordInput {
  word: string
  ipa?: string
  pos?: string
  meaningVi?: string
  meaningEn?: string
  examples?: string[]
  context?: string
  sourceModule: ModuleId | 'manual' | 'dictionary'
  sourceRef?: string
  collocations?: string[]
  idioms?: string[]
  phrasalVerbs?: string[]
  cefr?: Cefr | null
  topic?: string
  notes?: string
}

export interface VocabFilter {
  query?: string
  topic?: string
  sourceModule?: string
  state?: 'new' | 'learning' | 'review' | 'relearning' | 'difficult' | 'due' | 'favorite'
  sort?: 'recent' | 'alpha' | 'due' | 'difficulty'
  limit?: number
  offset?: number
}

interface VocabRow {
  id: number
  word: string
  ipa: string
  pos: string
  meaning_vi: string
  meaning_en: string
  examples: string
  context: string
  source_module: VocabItem['sourceModule']
  source_ref: string
  collocations: string
  idioms: string
  phrasal_verbs: string
  cefr: Cefr | null
  topic: string
  notes: string
  is_favorite: number
  created_at: string
  state: ReviewInfo['state']
  due_at: string
  stability: number
  difficulty: number
  reps: number
  lapses: number
  scheduled_days: number
  last_review_at: string | null
  learning_steps: number
}

const list = (s: string): string[] => {
  try {
    const v = JSON.parse(s) as unknown
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []
  } catch {
    return []
  }
}
const uniq = (xs: string[]) => [...new Set(xs.map((x) => x.trim()).filter(Boolean))]
/** Minimal card for retrievability (state 'review' so the stored stability is used). */
const memoryOf = (r: { stability: number; last_review_at: string | null }): CardMemory => ({
  state: 'review',
  stability: r.stability,
  difficulty: 0,
  reps: 1,
  lapses: 0,
  lastReviewAt: r.last_review_at,
  dueAt: '',
  scheduledDays: 0,
})
const notFound = () => new UserError('not_found', 'Không tìm thấy từ này trong kho từ (có thể đã bị xoá).')
/** Escapes LIKE wildcards so a search for "50%" or "a_b" matches literally (used with ESCAPE '\'). */
export const likeEscape = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`)
export const wordKey = (w: string) => w.trim().toLowerCase().replace(/\s+/g, ' ')

const SELECT = `SELECT v.*, r.state, r.due_at, r.stability, r.difficulty, r.reps, r.lapses, r.scheduled_days,
  r.last_review_at, r.learning_steps FROM vocabulary v JOIN review_schedules r ON r.vocab_id = v.id`

const WordInfoSchema = z.object({
  word: z.string().min(1),
  ipa: z.string().default(''),
  pos: z.string().default(''),
  meaningVi: z.string().min(1),
  meaningEn: z.string().min(1),
  examples: z.array(z.string()).default([]),
  collocations: z.array(z.string()).default([]),
  cefr: CefrSchema.nullable().default(null),
  note: z.string().default(''),
})
type WordInfo = z.infer<typeof WordInfoSchema>

export const wordLookupPrompt = jsonPrompt<{ word: string; context?: string }, WordInfo>({
  id: 'vocab.lookup',
  version: 1,
  skill: 'vocabulary',
  temperature: 0.2,
  schema: WordInfoSchema,
  build: (input, ctx) => ({
    system: [
      'You are a bilingual English–Vietnamese learner dictionary for Vietnamese learners of English.',
      ctx.learnerLine,
      'Give the meaning that fits the context sentence when one is provided.',
      'Fields: word (base form), ipa (General American IPA between slashes), pos, meaningVi (concise Vietnamese with diacritics),',
      `meaningEn (simple English definition for a ${ctx.level} learner), examples (2 natural sentences at ${ctx.level} level),`,
      'collocations (up to 4 common collocations), cefr (estimated CEFR of the word or null), note (Vietnamese tip about usage or pronunciation pitfalls, may be empty).',
      JSON_ONLY,
    ].join('\n'),
    messages: [
      {
        role: 'user',
        content: `Word: ${input.word}${input.context ? `\nContext: ${input.context.slice(0, 400)}` : ''}`,
      },
    ],
  }),
  mock: (input) => ({
    word: input.word,
    ipa: '/ˈmɒk/',
    pos: 'noun',
    meaningVi: `nghĩa của "${input.word}"`,
    meaningEn: `meaning of ${input.word}`,
    examples: [`I use the word ${input.word} every day.`],
    collocations: [],
    cefr: 'B1',
    note: '',
  }),
})

export class VocabHub {
  private readonly scheduler = new FsrsScheduler()

  constructor(
    private readonly db: AppDatabase,
    private readonly content: ContentRegistry,
    private readonly progress: () => ProgressService,
    private readonly learner: LearnerService,
    private readonly ai: AiGateway,
    private readonly now: () => Date = () => new Date(),
  ) {}

  private toItem(r: VocabRow): VocabItem {
    const card = this.toCard(r)
    return {
      id: r.id,
      word: r.word,
      ipa: r.ipa,
      pos: r.pos,
      meaningVi: r.meaning_vi,
      meaningEn: r.meaning_en,
      examples: list(r.examples),
      context: r.context,
      sourceModule: r.source_module,
      sourceRef: r.source_ref,
      collocations: list(r.collocations),
      idioms: list(r.idioms),
      phrasalVerbs: list(r.phrasal_verbs),
      cefr: r.cefr,
      topic: r.topic,
      notes: r.notes,
      isFavorite: r.is_favorite === 1,
      createdAt: r.created_at,
      review: {
        state: r.state,
        dueAt: r.due_at,
        stability: r.stability,
        difficulty: r.difficulty,
        reps: r.reps,
        lapses: r.lapses,
        lastReviewAt: r.last_review_at,
        retrievability: Math.round(this.scheduler.currentRetrievability(card, this.now()) * 1000) / 1000,
        scheduledDays: r.scheduled_days,
      },
    }
  }

  private toCard(r: VocabRow): CardMemory {
    return {
      state: r.state,
      stability: r.stability,
      difficulty: r.difficulty,
      reps: r.reps,
      lapses: r.lapses,
      lastReviewAt: r.last_review_at,
      dueAt: r.due_at,
      scheduledDays: r.scheduled_days,
      learningSteps: r.learning_steps,
    }
  }

  get(id: number): VocabItem | null {
    const r = this.db.get<VocabRow>(`${SELECT} WHERE v.id = ?`, [id])
    return r ? this.toItem(r) : null
  }

  findByWord(word: string): VocabItem | null {
    const r = this.db.get<VocabRow>(`${SELECT} WHERE v.word_key = ?`, [wordKey(word)])
    return r ? this.toItem(r) : null
  }

  /** Saves (or enriches) a word. Returns created=false when the word was already in the bank. */
  save(input: SaveWordInput): { item: VocabItem; created: boolean } {
    const word = input.word.trim().slice(0, 80)
    if (!word) throw new UserError('invalid_input', 'Từ vựng không được để trống.')
    const ts = this.now().toISOString()
    const existing = this.db.get<VocabRow>(`${SELECT} WHERE v.word_key = ?`, [wordKey(word)])
    if (existing) {
      this.db.run(
        `UPDATE vocabulary SET ipa = COALESCE(NULLIF(ipa, ''), ?), pos = COALESCE(NULLIF(pos, ''), ?),
         meaning_vi = COALESCE(NULLIF(meaning_vi, ''), ?), meaning_en = COALESCE(NULLIF(meaning_en, ''), ?),
         examples = ?, collocations = ?, context = COALESCE(NULLIF(context, ''), ?), updated_at = ? WHERE id = ?`,
        [
          input.ipa ?? '',
          input.pos ?? '',
          input.meaningVi ?? '',
          input.meaningEn ?? '',
          JSON.stringify(uniq([...list(existing.examples), ...(input.examples ?? [])]).slice(0, 8)),
          JSON.stringify(uniq([...list(existing.collocations), ...(input.collocations ?? [])]).slice(0, 10)),
          input.context ?? '',
          ts,
          existing.id,
        ],
      )
      return { item: this.get(existing.id) as VocabItem, created: false }
    }
    const id = this.db.transaction(() => {
      const res = this.db.run(
        `INSERT INTO vocabulary(word, word_key, ipa, pos, meaning_vi, meaning_en, examples, context, source_module, source_ref,
         collocations, idioms, phrasal_verbs, cefr, topic, notes, is_favorite, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`,
        [
          word,
          wordKey(word),
          input.ipa ?? '',
          input.pos ?? '',
          input.meaningVi ?? '',
          input.meaningEn ?? '',
          JSON.stringify(uniq(input.examples ?? []).slice(0, 8)),
          (input.context ?? '').slice(0, 500),
          input.sourceModule,
          input.sourceRef ?? '',
          JSON.stringify(uniq(input.collocations ?? []).slice(0, 10)),
          JSON.stringify(uniq(input.idioms ?? []).slice(0, 10)),
          JSON.stringify(uniq(input.phrasalVerbs ?? []).slice(0, 10)),
          input.cefr ?? null,
          (input.topic ?? '').slice(0, 60),
          (input.notes ?? '').slice(0, 1000),
          ts,
          ts,
        ],
      )
      const card = newCard(this.now())
      this.db.run(
        `INSERT INTO review_schedules(vocab_id, state, due_at, stability, difficulty, reps, lapses, scheduled_days, last_review_at, learning_steps)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          res.lastInsertRowid,
          card.state,
          card.dueAt,
          card.stability,
          card.difficulty,
          card.reps,
          card.lapses,
          card.scheduledDays,
          card.lastReviewAt,
          card.learningSteps ?? 0,
        ],
      )
      return res.lastInsertRowid
    })
    this.progress().record({
      type: 'word_saved',
      module: input.sourceModule,
      skill: 'vocabulary',
      ref: String(id),
      title: word,
      minutes: 0.3,
    })
    return { item: this.get(id) as VocabItem, created: true }
  }

  /**
   * Bulk import (CSV / JSON export): new words are inserted and existing ones enriched like save(), but with
   * prepared statements in one transaction (20 000 words in well under a second instead of ~8 s of frozen
   * main process) and without XP – importing a word list must not farm 2 XP per word.
   */
  importMany(inputs: SaveWordInput[]): { added: number; merged: number } {
    const ts = this.now().toISOString()
    const existing = new Map(
      this.db
        .all<{ id: number; word_key: string; examples: string }>('SELECT id, word_key, examples FROM vocabulary')
        .map((r) => [r.word_key, r]),
    )
    const fresh = new Map<string, SaveWordInput & { word: string }>()
    const updates: (string | number)[][] = []
    let merged = 0
    for (const input of inputs) {
      const word = input.word.trim().slice(0, 80)
      if (!word) continue
      const key = wordKey(word)
      const ex = existing.get(key)
      if (ex) {
        updates.push([
          input.ipa ?? '',
          input.pos ?? '',
          input.meaningVi ?? '',
          input.meaningEn ?? '',
          JSON.stringify(uniq([...list(ex.examples), ...(input.examples ?? [])]).slice(0, 8)),
          ts,
          ex.id,
        ])
        merged++
      } else if (fresh.has(key)) merged++
      else fresh.set(key, { ...input, word })
    }
    const card = newCard(this.now())
    this.db.transaction(() => {
      this.db.runBatch(
        `UPDATE vocabulary SET ipa = COALESCE(NULLIF(ipa, ''), ?), pos = COALESCE(NULLIF(pos, ''), ?),
         meaning_vi = COALESCE(NULLIF(meaning_vi, ''), ?), meaning_en = COALESCE(NULLIF(meaning_en, ''), ?),
         examples = ?, updated_at = ? WHERE id = ?`,
        updates,
      )
      const rows = [...fresh.entries()]
      this.db.runBatch(
        `INSERT INTO vocabulary(word, word_key, ipa, pos, meaning_vi, meaning_en, examples, context, source_module, source_ref,
         collocations, idioms, phrasal_verbs, cefr, topic, notes, is_favorite, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, '', ?, ?, '[]', '[]', '[]', NULL, ?, ?, 0, ?, ?)`,
        rows.map(([key, it]) => [
          it.word,
          key,
          it.ipa ?? '',
          it.pos ?? '',
          it.meaningVi ?? '',
          it.meaningEn ?? '',
          JSON.stringify(uniq(it.examples ?? []).slice(0, 8)),
          it.sourceModule,
          it.sourceRef ?? '',
          (it.topic ?? '').slice(0, 60),
          (it.notes ?? '').slice(0, 1000),
          ts,
          ts,
        ]),
      )
      this.db.runBatch(
        `INSERT INTO review_schedules(vocab_id, state, due_at, stability, difficulty, reps, lapses, scheduled_days, last_review_at, learning_steps)
         SELECT id, ?, ?, ?, ?, ?, ?, ?, ?, ? FROM vocabulary WHERE word_key = ?`,
        rows.map(([key]) => [
          card.state,
          card.dueAt,
          card.stability,
          card.difficulty,
          card.reps,
          card.lapses,
          card.scheduledDays,
          card.lastReviewAt,
          card.learningSteps ?? 0,
          key,
        ]),
      )
    })
    return { added: fresh.size, merged }
  }

  update(
    id: number,
    patch: Partial<Omit<SaveWordInput, 'sourceModule' | 'word'>> & { isFavorite?: boolean },
  ): VocabItem {
    const cur = this.get(id)
    if (!cur) throw notFound()
    const n = { ...cur, ...definedOnly(patch) }
    this.db.run(
      `UPDATE vocabulary SET ipa = ?, pos = ?, meaning_vi = ?, meaning_en = ?, examples = ?, context = ?, collocations = ?,
       idioms = ?, phrasal_verbs = ?, cefr = ?, topic = ?, notes = ?, is_favorite = ?, updated_at = ? WHERE id = ?`,
      [
        n.ipa,
        n.pos,
        n.meaningVi,
        n.meaningEn,
        JSON.stringify(uniq(n.examples).slice(0, 8)),
        n.context,
        JSON.stringify(uniq(n.collocations).slice(0, 10)),
        JSON.stringify(uniq(n.idioms).slice(0, 10)),
        JSON.stringify(uniq(n.phrasalVerbs).slice(0, 10)),
        n.cefr ?? null,
        n.topic,
        n.notes,
        n.isFavorite ? 1 : 0,
        this.now().toISOString(),
        id,
      ],
    )
    return this.get(id) as VocabItem
  }

  remove(id: number): void {
    this.db.run('DELETE FROM vocabulary WHERE id = ?', [id])
  }

  list(filter: VocabFilter = {}): { items: VocabItem[]; total: number } {
    const where: string[] = []
    const params: (string | number)[] = []
    if (filter.query?.trim()) {
      const q = `%${likeEscape(filter.query.trim().toLowerCase())}%`
      where.push(
        "(v.word_key LIKE ? ESCAPE '\\' OR lower(v.meaning_vi) LIKE ? ESCAPE '\\' OR lower(v.meaning_en) LIKE ? ESCAPE '\\')",
      )
      params.push(q, q, q)
    }
    if (filter.topic) {
      where.push('v.topic = ?')
      params.push(filter.topic)
    }
    if (filter.sourceModule) {
      where.push('v.source_module = ?')
      params.push(filter.sourceModule)
    }
    switch (filter.state) {
      case 'new':
      case 'learning':
      case 'review':
      case 'relearning':
        where.push('r.state = ?')
        params.push(filter.state)
        break
      case 'difficult':
        where.push('(r.lapses >= 2 OR r.difficulty >= 7)')
        break
      case 'due':
        where.push('r.due_at <= ?')
        params.push(this.now().toISOString())
        break
      case 'favorite':
        where.push('v.is_favorite = 1')
        break
    }
    const w = where.length ? `WHERE ${where.join(' AND ')}` : ''
    const order =
      filter.sort === 'alpha'
        ? 'v.word_key'
        : filter.sort === 'due'
          ? 'r.due_at'
          : filter.sort === 'difficulty'
            ? 'r.difficulty DESC'
            : 'v.created_at DESC'
    const total = Number(
      this.db.value(`SELECT COUNT(*) FROM vocabulary v JOIN review_schedules r ON r.vocab_id = v.id ${w}`, params) ?? 0,
    )
    const rows = this.db.all<VocabRow>(`${SELECT} ${w} ORDER BY ${order} LIMIT ? OFFSET ?`, [
      ...params,
      Math.min(500, filter.limit ?? 100),
      filter.offset ?? 0,
    ])
    return { items: rows.map((r) => this.toItem(r)), total }
  }

  topics(): string[] {
    return this.db
      .all<{ topic: string }>("SELECT DISTINCT topic FROM vocabulary WHERE topic != '' ORDER BY topic")
      .map((r) => r.topic)
  }

  dueCount(): number {
    return Number(
      this.db.value('SELECT COUNT(*) FROM review_schedules WHERE due_at <= ?', [this.now().toISOString()]) ?? 0,
    )
  }

  /** Due cards (oldest first), with interval previews for the four rating buttons. */
  due(limit = 30): DueCard[] {
    const now = this.now()
    return this.db
      .all<VocabRow>(
        `${SELECT} WHERE r.due_at <= ? ORDER BY CASE r.state WHEN 'new' THEN 1 ELSE 0 END, r.due_at LIMIT ?`,
        [now.toISOString(), Math.min(200, limit)],
      )
      .map((r) => {
        const p = this.scheduler.preview(this.toCard(r), now)
        return { ...this.toItem(r), preview: { 1: p[1].label, 2: p[2].label, 3: p[3].label, 4: p[4].label } }
      })
  }

  review(id: number, rating: Rating, durationMs = 0): VocabItem {
    const row = this.db.get<VocabRow>(`${SELECT} WHERE v.id = ?`, [id])
    if (!row) throw notFound()
    const now = this.now()
    const before = this.toCard(row)
    const next = this.scheduler.review(before, rating, now)
    // Clamped: the clock may have moved back since the last review.
    const elapsed = before.lastReviewAt
      ? Math.max(0, (now.getTime() - new Date(before.lastReviewAt).getTime()) / 86_400_000)
      : 0
    this.db.transaction(() => {
      this.db.run(
        `UPDATE review_schedules SET state = ?, due_at = ?, stability = ?, difficulty = ?, reps = ?, lapses = ?,
         scheduled_days = ?, last_review_at = ?, learning_steps = ? WHERE vocab_id = ?`,
        [
          next.state,
          next.dueAt,
          next.stability,
          next.difficulty,
          next.reps,
          next.lapses,
          next.scheduledDays,
          next.lastReviewAt,
          next.learningSteps ?? 0,
          id,
        ],
      )
      this.db.run(
        `INSERT INTO review_logs(vocab_id, rating, state_before, elapsed_days, scheduled_days, duration_ms, reviewed_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [id, rating, before.state, elapsed, next.scheduledDays, Math.max(0, Math.round(durationMs)), now.toISOString()],
      )
    })
    this.progress().record({
      type: 'review_done',
      module: 'vocabulary',
      skill: 'vocabulary',
      ref: String(id),
      title: row.word,
      minutes: Math.min(2, Math.max(0.1, durationMs / 60_000 || 0.2)),
    })
    if (rating >= 3 && before.state === 'review') this.learner.addSkillProgress('vocabulary', 0.3)
    return this.get(id) as VocabItem
  }

  stats(): VocabStats {
    const now = this.now()
    const today = localDateKey(now)
    const endOfToday = new Date(now)
    endOfToday.setHours(23, 59, 59, 999)
    const n = (sql: string, p: (string | number)[] = []) => Number(this.db.value(sql, p) ?? 0)
    // Only the columns needed (a 20 000-word bank took ~300 ms with SELECT v.* and 14 COUNT scans).
    const rows = this.db.all<{ stability: number; last_review_at: string | null }>(
      "SELECT stability, last_review_at FROM review_schedules WHERE state != 'new'",
    )
    const retention = rows.length
      ? rows.reduce((s, r) => s + this.scheduler.currentRetrievability(memoryOf(r), now), 0) / rows.length
      : 0
    const last = addDays(today, 13)
    const buckets = new Map<string, number>()
    for (const r of this.db.all<{ due_at: string }>('SELECT due_at FROM review_schedules WHERE due_at <= ?', [
      new Date(`${last}T23:59:59.999`).toISOString(),
    ])) {
      // Everything overdue counts for today; the rest by the learner's local calendar day.
      const d = new Date(r.due_at)
      const key = Number.isNaN(d.getTime()) || d <= now ? today : localDateKey(d)
      buckets.set(key, (buckets.get(key) ?? 0) + 1)
    }
    const forecast: { date: string; count: number }[] = []
    for (let i = 0; i < 14; i++) {
      const date = addDays(today, i)
      forecast.push({ date, count: buckets.get(date) ?? 0 })
    }
    return {
      total: n('SELECT COUNT(*) FROM vocabulary'),
      dueNow: n('SELECT COUNT(*) FROM review_schedules WHERE due_at <= ?', [now.toISOString()]),
      dueToday: n('SELECT COUNT(*) FROM review_schedules WHERE due_at <= ?', [endOfToday.toISOString()]),
      learning: n("SELECT COUNT(*) FROM review_schedules WHERE state IN ('learning','relearning')"),
      mature: n('SELECT COUNT(*) FROM review_schedules WHERE stability >= 21'),
      difficult: n('SELECT COUNT(*) FROM review_schedules WHERE lapses >= 2 OR difficulty >= 7'),
      averageRetention: Math.round(retention * 1000) / 1000,
      reviewsToday: n('SELECT COUNT(*) FROM review_logs WHERE reviewed_at >= ?', [
        new Date(`${today}T00:00:00`).toISOString(),
      ]),
      forecast,
    }
  }

  /** Offline dictionary and content glossaries first; AI only when asked and available. */
  async lookup(word: string, opts: { context?: string; useAi?: boolean } = {}): Promise<DictionaryResult | null> {
    const saved = this.findByWord(word) !== null
    const offline = this.content.lookup(word)
    if (offline && !opts.useAi) return { entry: offline.entry, source: offline.source, saved }
    if (opts.useAi && this.ai.isAvailable()) {
      const { data } = await this.ai.run(wordLookupPrompt, { word: word.trim(), context: opts.context })
      return {
        entry: {
          word: data.word,
          ipa: data.ipa || '-',
          pos: data.pos || '-',
          meaningVi: data.meaningVi,
          meaningEn: data.meaningEn,
          example: data.examples[0] ?? '',
          ...(data.cefr ? { cefr: data.cefr } : {}),
          collocations: data.collocations,
        },
        source: 'ai',
        saved,
      }
    }
    return offline ? { entry: offline.entry, source: offline.source, saved } : null
  }
}
