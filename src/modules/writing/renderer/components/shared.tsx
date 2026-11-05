// Presentational building blocks for the Writing Workshop pages.
import {
  AlignLeft,
  Briefcase,
  Feather,
  GraduationCap,
  Mail,
  NotebookPen,
  PenLine,
  Pilcrow,
  SpellCheck,
  type LucideIcon,
} from 'lucide-react'
import type { WritingPrompt } from '@shared/content'
import type { TextMetrics, WritingFeedback } from '@shared/types'
import { Badge, CefrBadge, cx } from '@/components/ui'
import { useL } from '@/i18n'
import type { CheckItem, DiffOp } from '../../contract'

type TaskType = WritingPrompt['taskType']

export const TASK_META: Record<TaskType, { icon: LucideIcon; en: string; vi: string; timerMinutes?: number }> = {
  sentence: { icon: AlignLeft, en: 'Sentences', vi: 'Viết câu' },
  grammar: { icon: SpellCheck, en: 'Grammar practice', vi: 'Luyện ngữ pháp' },
  paragraph: { icon: Pilcrow, en: 'Paragraph', vi: 'Đoạn văn' },
  journal: { icon: NotebookPen, en: 'Journal', vi: 'Nhật ký' },
  email: { icon: Mail, en: 'Email', vi: 'Email', timerMinutes: 20 },
  business: { icon: Briefcase, en: 'Business', vi: 'Công việc', timerMinutes: 20 },
  essay: { icon: GraduationCap, en: 'Essay (IELTS Task 2)', vi: 'Bài luận (IELTS Task 2)', timerMinutes: 40 },
  creative: { icon: Feather, en: 'Creative', vi: 'Sáng tác' },
  free: { icon: PenLine, en: 'Free writing', vi: 'Viết tự do' },
}
export const TASK_TYPES = Object.keys(TASK_META) as TaskType[]

export const taskMeta = (t: string) => TASK_META[(t in TASK_META ? t : 'free') as TaskType]

export const SCORE_LABELS: Record<keyof WritingFeedback['scores'], { en: string; vi: string }> = {
  grammar: { en: 'Grammar', vi: 'Ngữ pháp' },
  spelling: { en: 'Spelling', vi: 'Chính tả' },
  vocabulary: { en: 'Vocabulary', vi: 'Từ vựng' },
  sentenceStructure: { en: 'Sentence structure', vi: 'Cấu trúc câu' },
  clarity: { en: 'Clarity', vi: 'Rõ ràng' },
  coherence: { en: 'Coherence', vi: 'Mạch lạc' },
  naturalness: { en: 'Naturalness', vi: 'Tự nhiên' },
  toneRegister: { en: 'Tone & register', vi: 'Giọng văn' },
}

export const CATEGORY_LABELS: Record<
  WritingFeedback['errors'][number]['category'],
  { en: string; vi: string; tone: 'danger' | 'warning' | 'info' | 'accent' }
> = {
  grammar: { en: 'Grammar', vi: 'Ngữ pháp', tone: 'danger' },
  spelling: { en: 'Spelling', vi: 'Chính tả', tone: 'warning' },
  vocabulary: { en: 'Vocabulary', vi: 'Từ vựng', tone: 'info' },
  punctuation: { en: 'Punctuation', vi: 'Dấu câu', tone: 'warning' },
  structure: { en: 'Structure', vi: 'Cấu trúc', tone: 'accent' },
  register: { en: 'Register', vi: 'Văn phong', tone: 'accent' },
  coherence: { en: 'Coherence', vi: 'Mạch lạc', tone: 'info' },
}

/** Word-level diff: deletions struck through, insertions highlighted. */
export function DiffView({ ops, className }: { ops: DiffOp[]; className?: string }) {
  const L = useL()
  return (
    <div className={cx('leading-loose whitespace-pre-wrap', className)} data-testid="writing-diff">
      {ops.map((op, i) =>
        op.type === 'equal' ? (
          <span key={i}>{op.text}</span>
        ) : op.type === 'delete' ? (
          <del
            key={i}
            className="rounded bg-danger/15 px-0.5 text-danger decoration-danger/70"
            title={L('Remove', 'Bỏ')}
          >
            {op.text}
          </del>
        ) : (
          <ins key={i} className="rounded bg-success/15 px-0.5 text-success no-underline" title={L('Add', 'Thêm')}>
            {op.text}
          </ins>
        ),
      )}
    </div>
  )
}

export function MetricsPanel({ metrics, compact }: { metrics: TextMetrics; compact?: boolean }) {
  const L = useL()
  const rows: [string, string | number][] = [
    [L('Words', 'Số từ'), metrics.words],
    [L('Sentences', 'Số câu'), metrics.sentences],
    [L('Avg. sentence length', 'Độ dài câu TB'), metrics.avgSentenceLength],
    [L('Lexical diversity', 'Độ đa dạng từ'), `${Math.round(metrics.lexicalDiversity * 100)}%`],
    [L('Long words (7+ letters)', 'Từ dài (7+ chữ)'), `${Math.round(metrics.longWordRatio * 100)}%`],
    [L('Linking words', 'Từ nối'), metrics.linkingWords],
  ]
  return (
    <div className="space-y-2 text-sm" data-testid="writing-metrics">
      <dl className={cx('grid gap-x-4 gap-y-1.5', compact ? 'grid-cols-2' : 'grid-cols-1')}>
        {rows.map(([k, v]) => (
          <div key={k} className="flex justify-between gap-2">
            <dt className="text-muted">{k}</dt>
            <dd className="font-medium tabular-nums">{v}</dd>
          </div>
        ))}
      </dl>
      <div className="flex items-center justify-between gap-2 border-t border-line pt-2">
        <span className="text-muted">{L('Level (heuristic)', 'Cấp độ (heuristic)')}</span>
        <span className="flex items-center gap-1.5">
          <CefrBadge level={metrics.heuristicCefr} />
          <Badge>{L('rough estimate', 'ước lượng thô')}</Badge>
        </span>
      </div>
    </div>
  )
}

const STATUS_STYLE: Record<CheckItem['status'], { mark: string; cls: string }> = {
  pass: { mark: '✓', cls: 'bg-success/15 text-success' },
  warn: { mark: '!', cls: 'bg-warning/15 text-warning' },
  fail: { mark: '✕', cls: 'bg-danger/15 text-danger' },
  manual: { mark: '?', cls: 'bg-surface-3 text-muted' },
}

export function Checklist({ items }: { items: CheckItem[] }) {
  const L = useL()
  return (
    <ul className="space-y-1.5 text-sm" data-testid="writing-checklist">
      {items.map((c) => (
        <li key={c.id} className="flex items-start gap-2">
          <span
            className={cx(
              'mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full text-xs font-bold',
              STATUS_STYLE[c.status].cls,
            )}
          >
            {STATUS_STYLE[c.status].mark}
          </span>
          <span className={c.status === 'manual' ? 'text-muted' : undefined}>
            {L(c.en, c.vi)}
            {c.status === 'manual' && (
              <span className="ml-1 text-xs text-faint">({L('check yourself', 'tự kiểm tra')})</span>
            )}
          </span>
        </li>
      ))}
    </ul>
  )
}

/** Line chart of AI scores (0–10) over submissions. */
export function ScoreTrend({ points, label }: { points: { score: number; label: string }[]; label: string }) {
  const w = 560
  const h = 160
  const pad = { l: 28, r: 12, t: 12, b: 24 }
  if (points.length === 0) return null
  const x = (i: number) =>
    pad.l + (points.length === 1 ? (w - pad.l - pad.r) / 2 : (i * (w - pad.l - pad.r)) / (points.length - 1))
  const y = (s: number) => pad.t + (1 - s / 10) * (h - pad.t - pad.b)
  const path = points.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.score).toFixed(1)}`).join(' ')
  const area = `${path} L${x(points.length - 1).toFixed(1)},${y(0)} L${x(0).toFixed(1)},${y(0)} Z`
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="h-auto w-full" role="img" aria-label={label} data-testid="writing-trend">
      <defs>
        <linearGradient id="wt-fill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="var(--accent)" stopOpacity="0.35" />
          <stop offset="100%" stopColor="var(--accent)" stopOpacity="0" />
        </linearGradient>
      </defs>
      {[0, 5, 10].map((g) => (
        <g key={g}>
          <line x1={pad.l} x2={w - pad.r} y1={y(g)} y2={y(g)} stroke="var(--line)" />
          <text x={pad.l - 8} y={y(g) + 4} textAnchor="end" fontSize="10" fill="var(--faint)">
            {g}
          </text>
        </g>
      ))}
      {points.length > 1 && <path d={area} fill="url(#wt-fill)" />}
      <path
        d={path}
        fill="none"
        stroke="var(--accent)"
        strokeWidth="2.5"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      {points.map((p, i) => (
        <g key={i}>
          <circle cx={x(i)} cy={y(p.score)} r="4" fill="var(--surface)" stroke="var(--accent)" strokeWidth="2">
            <title>{`${p.label}: ${p.score}/10`}</title>
          </circle>
          {(i === 0 || i === points.length - 1 || points.length <= 8) && (
            <text x={x(i)} y={h - 6} textAnchor="middle" fontSize="10" fill="var(--faint)">
              {p.label}
            </text>
          )}
        </g>
      ))}
    </svg>
  )
}

export function formatClock(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}
