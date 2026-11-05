// Small presentational pieces shared by the vocabulary pages.
import type { ReactNode } from 'react'
import type { VocabItem } from '@shared/types'
import { cx } from '@/components/ui'
import { useTx } from '@/i18n'
import { STRENGTH_LABEL } from '../lib/labels'
import { buildCloze, strengthOf } from '../lib/practice'

const STRENGTH_TONE = { new: 'bg-surface-3', weak: 'bg-danger', fair: 'bg-warning', strong: 'bg-success' } as const

/** 4-segment memory strength meter (FSRS retrievability). */
export function StrengthMeter({ review, showLabel }: { review: VocabItem['review']; showLabel?: boolean }) {
  const tx = useTx()
  const s = strengthOf(review)
  const filled = s === 'new' ? 0 : s === 'weak' ? 1 : s === 'fair' ? 2 : review.retrievability >= 0.97 ? 4 : 3
  const title = `${tx(STRENGTH_LABEL[s])}${s === 'new' ? '' : ` · ${Math.round(review.retrievability * 100)}%`}`
  return (
    <div className="flex items-center gap-2" title={title} aria-label={title}>
      <div className="flex gap-0.5">
        {[0, 1, 2, 3].map((i) => (
          <span key={i} className={cx('h-1.5 w-3 rounded-full', i < filled ? STRENGTH_TONE[s] : 'bg-surface-3')} />
        ))}
      </div>
      {showLabel && <span className="text-xs text-muted">{title}</span>}
    </div>
  )
}

/** Renders a sentence with the target word highlighted (plain React nodes, no HTML). */
export function Highlight({ text, word, className }: { text: string; word: string; className?: string }): ReactNode {
  const c = buildCloze(word, text)
  if (!c) return <span className={className}>{text}</span>
  return (
    <span className={className}>
      {c.before}
      <mark className="rounded bg-accent/20 px-0.5 text-text">{c.answer}</mark>
      {c.after}
    </span>
  )
}
