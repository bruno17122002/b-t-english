// Pronunciation widgets: safe theory renderer (no raw HTML), phoneme alignment view, phoneme cards and
// the Cadence attribution line.
import { Check, ExternalLink, Lightbulb } from 'lucide-react'
import { useState } from 'react'
import type { PhonemeAlignment } from '@core/phonemes'
import type { PhonemeEntry } from '@shared/packs'
import { SpeakButton } from '@/components/learning'
import { Badge, Modal, cx } from '@/components/ui'
import { useL } from '@/i18n'
import { api } from '@/lib/api'
import type { InlineRun, PackAttribution, TheoryBlock } from '../../contract'

function Runs({ runs }: { runs: InlineRun[] }) {
  return (
    <>
      {runs.map((r, i) => {
        if (r.strong && r.em)
          return (
            <strong key={i}>
              <em>{r.text}</em>
            </strong>
          )
        if (r.strong)
          return (
            <strong key={i} className="font-semibold text-text">
              {r.text}
            </strong>
          )
        if (r.em) return <em key={i}>{r.text}</em>
        return <span key={i}>{r.text}</span>
      })}
    </>
  )
}

/** Renders sanitised theory blocks as React text (never as HTML). */
export function TheoryView({ blocks }: { blocks: TheoryBlock[] }) {
  return (
    <div className="space-y-3 leading-relaxed text-muted" data-testid="pron-theory">
      {blocks.map((b, i) =>
        b.type === 'heading' ? (
          <h3 key={i} className="font-display text-xl font-semibold text-text">
            <Runs runs={b.runs} />
          </h3>
        ) : b.type === 'paragraph' ? (
          <p key={i}>
            <Runs runs={b.runs} />
          </p>
        ) : (
          <ul key={i} className="space-y-1.5 pl-1">
            {b.items.map((it, j) => (
              <li key={j} className="flex gap-2">
                <span className="text-accent">•</span>
                <span>
                  <Runs runs={it} />
                </span>
              </li>
            ))}
          </ul>
        ),
      )}
    </div>
  )
}

/** Per-phoneme comparison of target vs (AI-estimated) produced phonemes. */
export function AlignmentView({ alignment }: { alignment: PhonemeAlignment }) {
  const L = useL()
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-1.5" data-testid="pron-alignment">
        {alignment.ops.map((o, i) => (
          <div
            key={i}
            className={cx(
              'flex min-w-11 flex-col items-center rounded-lg border px-2 py-1 font-mono',
              o.op === 'match' && 'border-success/40 bg-success/10 text-success',
              o.op === 'substitute' && 'border-warning/40 bg-warning/10 text-warning',
              o.op === 'delete' && 'border-danger/40 bg-danger/10 text-danger',
              o.op === 'insert' && 'border-line bg-surface-3 text-faint',
            )}
            title={
              o.op === 'match'
                ? L('Correct', 'Đúng')
                : o.op === 'substitute'
                  ? L(`Expected /${o.expected}/, heard /${o.actual}/`, `Cần /${o.expected}/, nghe như /${o.actual}/`)
                  : o.op === 'delete'
                    ? L(`Missing /${o.expected}/`, `Thiếu /${o.expected}/`)
                    : L(`Extra /${o.actual}/`, `Thừa /${o.actual}/`)
            }
          >
            <span className={cx('text-base', o.op === 'delete' && 'line-through')}>{o.expected ?? '+'}</span>
            <span className="text-[11px] opacity-80">
              {o.op === 'match' ? <Check className="mx-auto size-3" /> : o.op === 'delete' ? '–' : o.actual}
            </span>
          </div>
        ))}
      </div>
      <div className="flex flex-wrap gap-3 text-xs text-faint">
        <span className="text-success">■ {L('match', 'đúng')}</span>
        <span className="text-warning">■ {L('substituted', 'bị thay')}</span>
        <span className="text-danger">■ {L('missing', 'thiếu')}</span>
        <span>■ {L('extra', 'thừa')}</span>
      </div>
    </div>
  )
}

export function PhonemeCard({ p, onOpen }: { p: PhonemeEntry; onOpen: () => void }) {
  return (
    <button
      onClick={onOpen}
      className="flex flex-col items-start rounded-2xl border border-line bg-surface p-4 text-left transition hover:-translate-y-0.5 hover:border-line-strong"
    >
      <span className="font-mono text-3xl text-accent">/{p.symbol}/</span>
      <span className="mt-1 text-sm font-semibold">{p.label}</span>
      <span className="mt-0.5 line-clamp-1 text-xs text-muted">{p.exampleWords.slice(0, 3).join(' · ')}</span>
    </button>
  )
}

export function PhonemeModal({ p, onClose }: { p: PhonemeEntry | null; onClose: () => void }) {
  const L = useL()
  return (
    <Modal
      open={!!p}
      onClose={onClose}
      wide
      title={
        p ? (
          <span className="font-mono">
            /{p.symbol}/ · {p.label}
          </span>
        ) : (
          ''
        )
      }
    >
      {p && (
        <div className="space-y-4 text-sm">
          <div className="flex flex-wrap gap-1.5">
            {p.difficulty && (
              <Badge
                tone={p.difficulty === 'advanced' ? 'danger' : p.difficulty === 'intermediate' ? 'warning' : 'success'}
              >
                {p.difficulty}
              </Badge>
            )}
            <Badge tone="neutral">{p.category.replace(/_/g, ' ')}</Badge>
            {p.spellingPatterns.length > 0 && (
              <Badge tone="info">
                {L('Spellings', 'Cách viết')}: {p.spellingPatterns.join(', ')}
              </Badge>
            )}
          </div>
          {p.viNote && (
            <div className="rounded-xl border border-accent/30 bg-accent/5 p-3">
              <div className="mb-1 flex items-center gap-1.5 font-semibold text-accent">
                <Lightbulb className="size-4" /> {L('Tip for Vietnamese speakers', 'Mẹo cho người Việt')}
              </div>
              <p>{p.viNote}</p>
            </div>
          )}
          {p.articulation && (
            <div>
              <div className="font-semibold">{L('How to make it', 'Cách phát âm')}</div>
              <p className="text-muted">{p.articulation}</p>
            </div>
          )}
          {p.learnerTip && <p className="text-muted italic">{p.learnerTip}</p>}
          <div>
            <div className="mb-1.5 font-semibold">{L('Example words', 'Từ ví dụ')}</div>
            <div className="flex flex-wrap gap-1.5">
              {p.exampleWords.map((w) => (
                <span key={w} className="inline-flex items-center rounded-lg border border-line pl-2.5">
                  {w}
                  <SpeakButton text={w} />
                </span>
              ))}
            </div>
          </div>
          {p.minimalPairs.length > 0 && (
            <div>
              <div className="mb-1.5 font-semibold">{L('Minimal pairs', 'Cặp từ tối thiểu')}</div>
              <div className="flex flex-wrap gap-2">
                {p.minimalPairs.map(([a, b]) => (
                  <span
                    key={`${a}-${b}`}
                    className="inline-flex items-center gap-1 rounded-lg border border-line px-2 py-1"
                  >
                    {a} <SpeakButton text={a ?? ''} /> / {b} <SpeakButton text={b ?? ''} />
                  </span>
                ))}
              </div>
            </div>
          )}
          {p.commonErrors.length > 0 && (
            <div>
              <div className="mb-1 font-semibold">{L('Common errors', 'Lỗi thường gặp')}</div>
              <ul className="space-y-1 text-muted">
                {p.commonErrors.map((e) => (
                  <li key={e}>• {e}</li>
                ))}
              </ul>
            </div>
          )}
          {p.dialectNote && <p className="text-xs text-faint">{p.dialectNote}</p>}
        </div>
      )}
    </Modal>
  )
}

export function CadenceAttribution({ attribution }: { attribution: PackAttribution }) {
  const L = useL()
  const [open, setOpen] = useState(false)
  return (
    <div
      className="mt-8 rounded-xl border border-line bg-surface-2 px-4 py-3 text-xs text-faint"
      data-testid="cadence-attribution"
    >
      <span>
        {L('Pronunciation content adapted from Cadence (MIT).', 'Nội dung phát âm chuyển thể từ Cadence (MIT).')}
      </span>{' '}
      <button className="underline hover:text-text" onClick={() => setOpen((v) => !v)}>
        {open ? L('Hide details', 'Ẩn chi tiết') : L('Details', 'Chi tiết')}
      </button>
      {open && (
        <div className="mt-2 space-y-1">
          <p>{attribution.attribution}</p>
          <p>{attribution.copyright}</p>
          <button
            className="inline-flex items-center gap-1 underline hover:text-text"
            onClick={() => void api('app:openExternal', { url: attribution.source }).catch(() => undefined)}
          >
            {attribution.source} <ExternalLink className="size-3" />
          </button>
        </div>
      )}
    </div>
  )
}
