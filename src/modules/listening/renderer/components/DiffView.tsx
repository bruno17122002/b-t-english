// Word-level diff of a dictation attempt. Expected words stay hidden until the answer is accepted or revealed.
import type { DiffToken } from '../../contract'
import { useL } from '@/i18n'
import { cx } from '@/components/ui'

export function DiffView({ tokens, showExpected }: { tokens: DiffToken[]; showExpected: boolean }) {
  const L = useL()
  return (
    <div
      className="flex flex-wrap items-baseline gap-x-1.5 gap-y-2 font-mono text-[15px] leading-relaxed"
      data-testid="listening-diff"
    >
      {tokens.map((t, i) => {
        if (t.status === 'ok')
          return (
            <span key={i} className="text-success">
              {t.typed}
            </span>
          )
        if (t.status === 'typo')
          return (
            <span
              key={i}
              className="text-warning underline decoration-wavy underline-offset-4"
              title={L(`Spelling: ${t.expected}`, `Chính tả: ${t.expected}`)}
            >
              {t.typed}
              {showExpected && <span className="ml-1 text-xs text-muted">({t.expected})</span>}
            </span>
          )
        if (t.status === 'extra')
          return (
            <span key={i} className="text-faint line-through" title={L('Not in the audio', 'Không có trong bài')}>
              {t.typed}
            </span>
          )
        if (t.status === 'wrong')
          return (
            <span key={i} className="inline-flex items-baseline gap-1">
              <span className="text-danger line-through">{t.typed}</span>
              <span
                className={cx(
                  'rounded border border-dashed px-1',
                  showExpected ? 'border-success/40 text-success' : 'border-danger/40 text-danger/60 select-none',
                )}
              >
                {showExpected ? t.expected : (t.expected ?? '').replace(/./g, '•')}
              </span>
            </span>
          )
        return (
          <span
            key={i}
            className={cx(
              'rounded border border-dashed px-1',
              showExpected ? 'border-success/40 text-success' : 'border-danger/50 text-danger/70',
            )}
            title={L('Missing word', 'Thiếu từ')}
          >
            {showExpected ? t.expected : '_'.repeat(Math.max(2, Math.min(10, (t.expected ?? '').length)))}
          </span>
        )
      })}
    </div>
  )
}
