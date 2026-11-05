// Result card shown when a practice stage is submitted.
import { motion } from 'framer-motion'
import { ArrowRight, RotateCcw, Zap } from 'lucide-react'
import { Button, ErrorState, ProgressRing, Spinner } from '@/components/ui'
import { useL } from '@/i18n'
import type { ApiError } from '@/lib/api'
import type { ListeningSubmitResult } from '../../contract'

export function StageResult({
  result,
  pending,
  error,
  title,
  onRetry,
  onNext,
  nextLabel,
  onResubmit,
}: {
  result: ListeningSubmitResult | undefined
  pending: boolean
  error: ApiError | null
  title: string
  onRetry: () => void
  onNext?: () => void
  nextLabel?: string
  onResubmit: () => void
}) {
  const L = useL()
  if (pending)
    return (
      <div className="flex items-center gap-3 rounded-2xl border border-line bg-surface p-5 text-sm text-muted">
        <Spinner /> {L('Saving your result…', 'Đang lưu kết quả…')}
      </div>
    )
  if (error) return <ErrorState error={error} onRetry={onResubmit} />
  if (!result) return null
  const acc = result.attempt.accuracy ?? 0
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="flex flex-wrap items-center gap-5 rounded-2xl border border-line bg-surface p-5"
      data-testid="listening-stage-result"
    >
      <ProgressRing value={acc} size={76}>
        {Math.round(acc * 100)}%
      </ProgressRing>
      <div className="flex-1">
        <div className="font-display text-lg font-semibold">{title}</div>
        <p className="text-sm text-muted">
          {L(
            `${result.attempt.correct} of ${result.attempt.total} correct`,
            `Đúng ${result.attempt.correct}/${result.attempt.total}`,
          )}{' '}
          · {L(`${result.minutes} min`, `${result.minutes} phút`)}
        </p>
        {result.reward.xpGained > 0 && (
          <p className="mt-1 inline-flex items-center gap-1 text-sm font-semibold text-accent">
            <Zap className="size-4" />+{result.reward.xpGained} XP
          </p>
        )}
      </div>
      <div className="flex flex-wrap gap-2">
        <Button variant="secondary" icon={<RotateCcw className="size-4" />} onClick={onRetry}>
          {L('Practise again', 'Luyện lại')}
        </Button>
        {onNext && (
          <Button variant="primary" icon={<ArrowRight className="size-4" />} onClick={onNext}>
            {nextLabel ?? L('Next stage', 'Chặng tiếp')}
          </Button>
        )}
      </div>
    </motion.div>
  )
}
