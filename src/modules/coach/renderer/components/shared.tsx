// Small building blocks shared by the coach tabs.
import { ArrowRight, Sparkles } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { Badge, Button, cx } from '@/components/ui'
import { useL } from '@/i18n'
import type { CoachRecommendation, Delta } from '../../types'

/** "+12 vs. previous" with a flat success / danger colour. */
export function DeltaText({ delta, unit = '', testId }: { delta: Delta | undefined; unit?: string; testId?: string }) {
  const L = useL()
  if (!delta) return null
  const up = delta.change > 0
  const down = delta.change < 0
  const value = `${up ? '+' : ''}${Math.round(delta.change * 10) / 10}${unit}`
  return (
    <span data-testid={testId} className={cx('font-medium', up && 'text-success', down && 'text-danger')}>
      {value}
      {delta.pct !== null && delta.change !== 0 && ` (${up ? '+' : ''}${delta.pct}%)`}{' '}
      <span className="font-normal text-faint">{L('vs. previous', 'so với kỳ trước')}</span>
    </span>
  )
}

export function SourceBadge({ source }: { source: 'ai' | 'offline' }) {
  const L = useL()
  return source === 'ai' ? (
    <Badge tone="info">
      <Sparkles className="size-3" />
      {L('AI analysis', 'AI phân tích')}
    </Badge>
  ) : (
    <Badge tone="neutral">{L('Rule-based (offline)', 'Theo quy tắc (offline)')}</Badge>
  )
}

export function RecommendationList({ items }: { items: CoachRecommendation[] }) {
  const L = useL()
  const navigate = useNavigate()
  return (
    <ul className="space-y-2">
      {items.map((r, i) => (
        <li
          key={`${r.title}-${i}`}
          className="flex flex-wrap items-start justify-between gap-3 rounded-lg border border-line bg-layer p-3"
        >
          <div className="min-w-0 flex-1">
            <div className="font-semibold">{r.title}</div>
            <p className="mt-0.5 text-sm text-muted">{r.why}</p>
            <p className="mt-1 text-sm">{r.action}</p>
          </div>
          <Button
            size="sm"
            variant="secondary"
            data-testid={`coach-rec-${i}`}
            icon={<ArrowRight className="size-4" />}
            onClick={() => navigate(r.route)}
          >
            {L(`Start · ${r.minutes} min`, `Bắt đầu · ${r.minutes} phút`)}
          </Button>
        </li>
      ))}
    </ul>
  )
}
