// Learning goals with progress (read-only here; goals are created and edited in the Journey module).
import { CalendarClock, CheckCircle2, Flag, Target } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { localDateKey } from '@core/dates'
import { Badge, Button, EmptyState, ErrorState, LoadingBlock, ProgressBar } from '@/components/ui'
import { useFormat, useL, useTx } from '@/i18n'
import { useApi } from '@/lib/api'
import { GOAL_METRIC_LABELS } from '../../lib/meta'

const KIND_LABELS = {
  short: { en: 'Short-term', vi: 'Ngắn hạn' },
  long: { en: 'Long-term', vi: 'Dài hạn' },
  custom: { en: 'Custom', vi: 'Tự đặt' },
}

export function GoalsPanel({ reloadKey }: { reloadKey: number }) {
  const L = useL()
  const tx = useTx()
  const fmt = useFormat()
  const navigate = useNavigate()
  const goals = useApi('learner:goals', undefined, [reloadKey])

  if (goals.error && !goals.data) return <ErrorState error={goals.error} onRetry={() => void goals.reload()} />
  if (!goals.data) return <LoadingBlock rows={2} />
  const list = goals.data
    .filter((g) => g.status !== 'archived')
    .sort((a, b) => (a.status === b.status ? 0 : a.status === 'active' ? -1 : 1))
  if (!list.length)
    return (
      <EmptyState
        icon={<Target />}
        title={L('No goals yet', 'Chưa có mục tiêu')}
        body={L('Set a goal in your Journey to track it here.', 'Đặt mục tiêu trong Lộ trình để theo dõi tại đây.')}
        action={
          <Button size="sm" variant="secondary" onClick={() => navigate('/journey')}>
            {L('Open Journey', 'Mở Lộ trình')}
          </Button>
        }
      />
    )

  return (
    <ul className="grid gap-3 md:grid-cols-2" data-testid="goals">
      {list.map((g) => {
        const done =
          g.status === 'done' || (g.metric !== 'none' && g.targetValue > 0 && g.currentValue >= g.targetValue)
        const unit = GOAL_METRIC_LABELS[g.metric]
        const overdue = !done && g.targetDate !== null && g.targetDate < localDateKey()
        return (
          <li key={g.id} className="rounded-2xl border border-line bg-surface p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="flex min-w-0 items-start gap-2.5">
                {done ? (
                  <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success" />
                ) : (
                  <Flag className="mt-0.5 size-4 shrink-0 text-accent" />
                )}
                <span className="text-sm font-medium">{g.title}</span>
              </div>
              <Badge tone={done ? 'success' : 'neutral'} className="shrink-0">
                {tx(KIND_LABELS[g.kind])}
              </Badge>
            </div>
            {g.metric !== 'none' && g.targetValue > 0 && (
              <div className="mt-3">
                <ProgressBar value={g.currentValue} max={g.targetValue} tone={done ? 'success' : 'accent'} />
                <div className="mt-1.5 flex justify-between text-xs text-muted tabular-nums">
                  <span>
                    {fmt.number(g.currentValue)} / {fmt.number(g.targetValue)} {unit ? tx(unit) : ''}
                  </span>
                  <span>{fmt.number(Math.min(100, (g.currentValue / g.targetValue) * 100))}%</span>
                </div>
              </div>
            )}
            {g.targetDate && (
              <div className={`mt-2 flex items-center gap-1.5 text-xs ${overdue ? 'text-warning' : 'text-faint'}`}>
                <CalendarClock className="size-3.5" />
                {L('Target', 'Hạn')}: {fmt.date(g.targetDate, { day: 'numeric', month: 'short', year: 'numeric' })}
              </div>
            )}
          </li>
        )
      })}
    </ul>
  )
}
