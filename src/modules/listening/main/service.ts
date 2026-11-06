// Listening Lab business logic: track library (built-in + AI-generated), attempts, progress and generation.
import { ListeningTrackSchema, type Cefr, type ListeningTrack } from '@shared/content'
import { countWords } from '@core/text'
import type { Kernel } from '../../../main/kernel'
import { UserError } from '../../../main/ipc/router'
import {
  LISTENING_MODES,
  type DictationCheck,
  type GapResult,
  type ListeningAttempt,
  type ListeningMode,
  type ListeningSubmitResult,
  type TrackDetail,
  type TrackSource,
  type TrackSummary,
} from '../contract'
import { buildGaps, checkDictation, checkGap, estimateSeconds, lineSeed } from './dictation'
import { generateTrackPrompt } from './prompts'

export interface ListFilter {
  cefr?: Cefr
  topic?: string
  accent?: ListeningTrack['accent']
  source?: TrackSource
  status?: 'new' | 'done' | 'favorite'
}

export interface SubmitInput {
  trackId: string
  mode: ListeningMode
  correct: number
  total: number
  speed: number
  durationSec?: number
  lines?: { line: number; accuracy: number; attempts: number; revealed?: boolean }[]
}

interface StoredTrack {
  track: ListeningTrack
  source: TrackSource
  provider: string | null
  createdAt: string | null
}

interface HistoryRow {
  id: number
  track_id: string
  mode: string
  correct: number
  total: number
  accuracy: number | null
  speed: number
  created_at: string
}

interface StatRow {
  track_id: string
  n: number
  best: number | null
  last: string
  modes: string | null
}

const CEFR_ORDER: Cefr[] = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2']

/** Work factor per mode: how many times longer than the audio a stage usually takes. */
const MODE_FACTOR: Record<ListeningMode, number> = { gist: 2, dictation: 4, gap: 2.5, shadow: 3 }

const toMode = (m: string): ListeningMode =>
  (LISTENING_MODES as readonly string[]).includes(m) ? (m as ListeningMode) : 'gist'

const toAttempt = (r: HistoryRow): ListeningAttempt => ({
  id: r.id,
  trackId: r.track_id,
  mode: toMode(r.mode),
  correct: r.correct,
  total: r.total,
  accuracy: r.accuracy,
  speed: r.speed,
  createdAt: r.created_at,
})

export function slugify(text: string, max = 32): string {
  const slug = text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/gi, 'd')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, max)
    .replace(/-+$/g, '')
  return slug || 'track'
}

export class ListeningService {
  constructor(private readonly k: Kernel) {}

  // ---------- library ----------
  private generated(): StoredTrack[] {
    const rows = this.k.db.all<{ id: string; data: string; provider: string | null; created_at: string }>(
      "SELECT id, data, provider, created_at FROM generated_content WHERE kind = 'listening' ORDER BY created_at DESC",
    )
    const out: StoredTrack[] = []
    for (const r of rows) {
      try {
        const parsed = ListeningTrackSchema.safeParse(JSON.parse(r.data))
        if (parsed.success)
          out.push({ track: { ...parsed.data, id: r.id }, source: 'ai', provider: r.provider, createdAt: r.created_at })
        else this.k.log.warn(`listening: generated track ${r.id} failed validation`)
      } catch {
        this.k.log.warn(`listening: generated track ${r.id} is not valid JSON`)
      }
    }
    return out
  }

  private all(): StoredTrack[] {
    const builtin = this.k.content
      .listening()
      .map((track): StoredTrack => ({ track, source: 'builtin', provider: null, createdAt: null }))
    return [...builtin, ...this.generated()]
  }

  private find(id: string): StoredTrack {
    const found = this.all().find((t) => t.track.id === id)
    if (!found) throw new UserError('not_found', 'Không tìm thấy bài nghe này. / Listening track not found.')
    return found
  }

  private stats(): Map<string, StatRow> {
    const rows = this.k.db.all<StatRow>(
      `SELECT track_id, COUNT(*) AS n, MAX(accuracy) AS best, MAX(created_at) AS last, GROUP_CONCAT(DISTINCT mode) AS modes
       FROM listening_history GROUP BY track_id`,
    )
    return new Map(rows.map((r) => [r.track_id, r]))
  }

  private summarize(t: StoredTrack, stats: Map<string, StatRow>, favorites: Set<string>): TrackSummary {
    const s = stats.get(t.track.id)
    const words = t.track.lines.reduce((n, l) => n + countWords(l.text), 0)
    const modes = (s?.modes ?? '').split(',').filter(Boolean).map(toMode)
    return {
      id: t.track.id,
      title: t.track.title,
      cefr: t.track.cefr,
      topic: t.track.topic,
      accent: t.track.accent,
      kind: t.track.kind,
      lineCount: t.track.lines.length,
      wordCount: words,
      estSeconds: estimateSeconds(words, t.track.lines.length),
      source: t.source,
      provider: t.provider,
      favorite: favorites.has(t.track.id),
      attempts: s?.n ?? 0,
      bestAccuracy: s?.best ?? null,
      modesDone: [...new Set(modes)],
      lastAt: s?.last ?? null,
      createdAt: t.createdAt,
    }
  }

  private favorites(): Set<string> {
    return new Set(this.k.settings.favorites('listening').map((f) => f.ref))
  }

  list(filter: ListFilter = {}): TrackSummary[] {
    const stats = this.stats()
    const favs = this.favorites()
    const topic = filter.topic?.trim().toLowerCase()
    return this.all()
      .map((t) => this.summarize(t, stats, favs))
      .filter(
        (s) =>
          (!filter.cefr || s.cefr === filter.cefr) &&
          (!topic || s.topic.toLowerCase() === topic) &&
          (!filter.accent || s.accent === filter.accent) &&
          (!filter.source || s.source === filter.source) &&
          (filter.status !== 'new' || s.attempts === 0) &&
          (filter.status !== 'done' || s.attempts > 0) &&
          (filter.status !== 'favorite' || s.favorite),
      )
      .sort((a, b) =>
        a.source !== b.source
          ? a.source === 'builtin'
            ? -1
            : 1
          : CEFR_ORDER.indexOf(a.cefr) - CEFR_ORDER.indexOf(b.cefr) || a.title.localeCompare(b.title),
      )
  }

  get(id: string): TrackDetail {
    const t = this.find(id)
    return {
      track: t.track,
      summary: this.summarize(t, this.stats(), this.favorites()),
      history: this.history({ trackId: id, limit: 20 }),
      gaps: t.track.lines.map((l, i) => buildGaps(l.text, lineSeed(t.track.id, i))),
    }
  }

  private line(trackId: string, line: number): string {
    const text = this.find(trackId).track.lines[line]?.text
    if (text === undefined) throw new UserError('not_found', 'Không có câu này trong bài nghe. / Line not found.')
    return text
  }

  checkLine(input: { trackId: string; line: number; typed: string }): DictationCheck {
    return checkDictation(this.line(input.trackId, input.line), input.typed)
  }

  checkGaps(input: { trackId: string; line: number; answers: string[] }): GapResult[] {
    const gap = buildGaps(this.line(input.trackId, input.line), lineSeed(input.trackId, input.line))
    return gap.blanks.map((b, i) => checkGap(b.answer, input.answers[i] ?? ''))
  }

  history(input: { trackId?: string; limit?: number } = {}): ListeningAttempt[] {
    const limit = input.limit ?? 50
    const rows = input.trackId
      ? this.k.db.all<HistoryRow>('SELECT * FROM listening_history WHERE track_id = ? ORDER BY id DESC LIMIT ?', [
          input.trackId,
          limit,
        ])
      : this.k.db.all<HistoryRow>('SELECT * FROM listening_history ORDER BY id DESC LIMIT ?', [limit])
    return rows.map(toAttempt)
  }

  // ---------- results ----------
  submit(input: SubmitInput): ListeningSubmitResult {
    const { track } = this.find(input.trackId)
    const accuracy = Math.round((input.correct / input.total) * 1000) / 1000
    const words = track.lines.reduce((n, l) => n + countWords(l.text), 0)
    const audioSec = estimateSeconds(words, track.lines.length, input.speed)
    // Prefer the measured stopwatch time, capped to a realistic range for this track and mode.
    const expectedSec = audioSec * MODE_FACTOR[input.mode]
    const measured = input.durationSec && input.durationSec > 5 ? input.durationSec : expectedSec
    const seconds = Math.min(Math.max(measured, audioSec * 0.8), expectedSec * 3, 45 * 60)
    const minutes = Math.max(0.5, Math.round((seconds / 60) * 10) / 10)
    const nowIso = this.k.now().toISOString()
    const details = JSON.stringify({ durationSec: input.durationSec ?? null, lines: input.lines ?? [] })
    const id = this.k.db.run(
      `INSERT INTO listening_history(track_id, mode, correct, total, accuracy, speed, details, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [track.id, input.mode, input.correct, input.total, accuracy, input.speed, details, nowIso],
    ).lastInsertRowid
    const reward = this.k.progress.record({
      type: 'listening_done',
      module: 'listening',
      skill: 'listening',
      minutes,
      score: accuracy,
      ref: track.id,
      title: `${track.title} · ${input.mode}`,
    })
    // Skill progress: harder stages and harder tracks (relative to the learner) count more.
    const learnerLevel = this.k.learner.skillLevels().find((s) => s.skill === 'listening')?.cefr ?? 'A1'
    const stretch = CEFR_ORDER.indexOf(track.cefr) - CEFR_ORDER.indexOf(learnerLevel)
    const modeWeight = input.mode === 'dictation' ? 1.2 : input.mode === 'gist' ? 1 : 0.8
    const delta = Math.min(
      3,
      Math.max(0.5, (0.5 + accuracy * 2) * modeWeight * (stretch < 0 ? 0.6 : stretch > 0 ? 1.2 : 1)),
    )
    const skill = this.k.learner.addSkillProgress('listening', Math.round(delta * 10) / 10)
    return {
      attempt: {
        id,
        trackId: track.id,
        mode: input.mode,
        correct: input.correct,
        total: input.total,
        accuracy,
        speed: input.speed,
        createdAt: nowIso,
      },
      reward,
      skill,
      minutes,
    }
  }

  // ---------- AI generation ----------
  async generate(input: {
    cefr: Cefr
    topic: string
    accent: ListeningTrack['accent']
    kind: ListeningTrack['kind']
  }): Promise<TrackSummary> {
    const stamp = this.k.now().getTime().toString(36)
    const id = `ai-${slugify(input.topic, 40)}-${stamp}`
    const res = await this.k.ai.run(generateTrackPrompt, { id, ...input }, { level: input.cefr })
    // Never replace an earlier track that got the same id (same topic + millisecond, or the clock moved back).
    const uid = this.k.db.uniqueId('generated_content', id)
    // The model must not override what the learner chose.
    const track: ListeningTrack = { ...res.data, id: uid, cefr: input.cefr, accent: input.accent, kind: input.kind }
    const nowIso = this.k.now().toISOString()
    this.k.db.run(
      'INSERT INTO generated_content(id, kind, cefr, title, data, provider, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [uid, 'listening', track.cefr, track.title.slice(0, 200), JSON.stringify(track), res.provider, nowIso],
    )
    this.k.log.info(`listening: generated track ${uid} via ${res.provider}`)
    return this.summarize(
      { track, source: 'ai', provider: res.provider, createdAt: nowIso },
      this.stats(),
      this.favorites(),
    )
  }

  deleteGenerated(id: string): null {
    const n = this.k.db.run("DELETE FROM generated_content WHERE id = ? AND kind = 'listening'", [id]).changes
    if (!n)
      throw new UserError('not_found', 'Chỉ xoá được bài nghe do AI tạo. / Only AI-generated tracks can be deleted.')
    return null
  }
}
