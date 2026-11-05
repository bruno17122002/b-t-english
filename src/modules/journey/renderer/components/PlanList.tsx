// Today's plan: each lesson opens its module and can be marked done or skipped.
import { AnimatePresence, motion } from 'framer-motion'
import { Check, ChevronRight, Clock, RotateCcw, SkipForward } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { Badge, IconButton, cx } from '@/components/ui'
import { useL, useTx } from '@/i18n'
import type { PlanLessonView } from '../../contract'
import { moduleMeta } from '../shared'

export function PlanList({
  lessons,
  pendingId,
  onStatus,
}: {
  lessons: PlanLessonView[]
  pendingId: number | null
  onStatus: (id: number, status: PlanLessonView['status']) => void
}) {
  const L = useL()
  const tx = useTx()
  const navigate = useNavigate()
  return (
    <ol className="space-y-2" data-testid="journey-plan">
      <AnimatePresence initial={false}>
        {lessons.map((l, i) => {
          const meta = moduleMeta(l.module)
          const Icon = meta.icon
          const done = l.status === 'done'
          const skipped = l.status === 'skipped'
          return (
            <motion.li
              key={l.id}
              layout
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.03 }}
              className={cx(
                'group flex items-center gap-3 rounded-xl border p-3 transition',
                done
                  ? 'border-success/25 bg-success/5'
                  : skipped
                    ? 'border-line bg-surface-2/40 opacity-60'
                    : 'border-line bg-surface-2/60 hover:border-line-strong',
              )}
              data-testid={`plan-item-${l.id}`}
            >
              <button
                onClick={() => onStatus(l.id, done ? 'todo' : 'done')}
                disabled={pendingId === l.id}
                aria-label={done ? L('Mark as not done', 'Đánh dấu chưa xong') : L('Mark as done', 'Đánh dấu đã xong')}
                data-testid="plan-toggle-done"
                className={cx(
                  'flex size-7 shrink-0 items-center justify-center rounded-full border-2 transition',
                  done
                    ? 'border-success bg-success text-bg'
                    : 'border-line-strong text-transparent hover:border-success hover:text-success',
                )}
              >
                <Check className="size-4" strokeWidth={3} />
              </button>
              <button
                className="flex min-w-0 flex-1 items-center gap-3 text-left"
                onClick={() => navigate(l.route)}
                data-testid="plan-open"
              >
                <span className={cx('flex size-10 shrink-0 items-center justify-center rounded-xl', meta.tone)}>
                  <Icon className="size-5" />
                </span>
                <span className="min-w-0 flex-1">
                  <span
                    className={cx(
                      'block truncate text-sm font-semibold',
                      (done || skipped) && 'line-through decoration-faint',
                    )}
                  >
                    {l.title}
                  </span>
                  <span className="mt-0.5 flex items-center gap-2 text-xs text-muted">
                    <span>{tx(meta.label)}</span>
                    <span className="flex items-center gap-1 text-faint">
                      <Clock className="size-3" />
                      {l.estimatedMinutes} {L('min', 'phút')}
                    </span>
                    {l.autoDone && <Badge tone="success">{L('done in module', 'đã học ở mục')}</Badge>}
                  </span>
                </span>
                {!done && !skipped && (
                  <ChevronRight className="size-4 shrink-0 text-faint transition group-hover:translate-x-0.5 group-hover:text-text" />
                )}
              </button>
              {!done &&
                (skipped ? (
                  <IconButton
                    label={L('Restore', 'Khôi phục')}
                    onClick={() => onStatus(l.id, 'todo')}
                    disabled={pendingId === l.id}
                  >
                    <RotateCcw className="size-4" />
                  </IconButton>
                ) : (
                  <IconButton
                    label={L('Skip for today', 'Bỏ qua hôm nay')}
                    onClick={() => onStatus(l.id, 'skipped')}
                    disabled={pendingId === l.id}
                    className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
                  >
                    <SkipForward className="size-4" />
                  </IconButton>
                ))}
            </motion.li>
          )
        })}
      </AnimatePresence>
    </ol>
  )
}
