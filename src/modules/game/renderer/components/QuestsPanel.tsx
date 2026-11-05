// Daily and weekly quests with progress, XP rewards, completed state and a "go" shortcut to the right module.
import { motion } from 'framer-motion'
import { ArrowRight, CalendarRange, CheckCircle2, ScrollText, Sun } from 'lucide-react'
import type { ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import type { Quest } from '@shared/types'
import { Badge, Button, cx, EmptyState, ErrorState, LoadingBlock, ProgressBar } from '@/components/ui'
import { useFormat, useL, useTx } from '@/i18n'
import type { ApiError } from '@/lib/api'
import { questDisplay, questFraction } from '../lib/meta'

function QuestRow({ quest, index }: { quest: Quest; index: number }) {
  const L = useL()
  const tx = useTx()
  const fmt = useFormat()
  const navigate = useNavigate()
  const done = !!quest.completedAt
  const disp = questDisplay(quest)
  return (
    <motion.li
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, delay: index * 0.05 }}
      className={cx(
        'flex items-center gap-3 rounded-2xl border p-3.5 transition',
        done ? 'border-success/30 bg-success/5' : 'border-line bg-surface-2/60 hover:border-line-strong',
      )}
      data-testid={`quest-${quest.period}-${quest.key}`}
    >
      <div
        className={cx(
          'flex size-10 shrink-0 items-center justify-center rounded-xl',
          done ? 'bg-success/15 text-success' : 'bg-accent/15 text-accent',
        )}
      >
        {done ? <CheckCircle2 className="size-5" /> : <ScrollText className="size-5" />}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-2">
          <span className={cx('text-sm font-medium', done && 'text-muted line-through decoration-success/50')}>
            {tx({ en: quest.title, vi: quest.titleVi })}
          </span>
          <Badge tone={done ? 'success' : 'warning'} className="shrink-0">
            +{fmt.number(quest.xpReward)} XP
          </Badge>
        </div>
        <div className="mt-2 flex items-center gap-3">
          <ProgressBar value={questFraction(quest)} tone={done ? 'success' : 'accent'} className="flex-1" />
          <span className="shrink-0 text-xs text-muted tabular-nums">
            {fmt.number(Math.min(disp.value, disp.target))}/{fmt.number(disp.target)}
            {disp.unit ? ` ${tx(disp.unit)}` : ''}
          </span>
        </div>
      </div>
      {done ? (
        <span className="hidden shrink-0 text-xs font-semibold text-success sm:block">{L('Done', 'Xong')}</span>
      ) : (
        <Button
          size="sm"
          variant="secondary"
          className="shrink-0"
          onClick={() => navigate(quest.route || '/')}
          aria-label={`${L('Go', 'Đi')}: ${tx({ en: quest.title, vi: quest.titleVi })}`}
          data-testid={`quest-go-${quest.key}`}
        >
          {L('Go', 'Đi')}
          <ArrowRight className="size-3.5" />
        </Button>
      )}
    </motion.li>
  )
}

function QuestColumn({ title, icon, quests, note }: { title: string; icon: ReactNode; quests: Quest[]; note: string }) {
  const L = useL()
  const doneCount = quests.filter((q) => q.completedAt).length
  return (
    <div className="rounded-3xl border border-line bg-surface p-5 shadow-card">
      <div className="mb-3 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 font-display text-lg font-semibold [&>svg]:size-5 [&>svg]:text-accent">
          {icon}
          {title}
        </div>
        <span className="text-xs text-muted">
          {doneCount}/{quests.length} {L('done', 'xong')}
        </span>
      </div>
      {quests.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted">{L('No quests right now.', 'Hiện chưa có nhiệm vụ.')}</p>
      ) : (
        <ul className="space-y-2.5">
          {quests.map((q, i) => (
            <QuestRow key={q.id} quest={q} index={i} />
          ))}
        </ul>
      )}
      <p className="mt-3 text-xs text-faint">{note}</p>
    </div>
  )
}

export function QuestsPanel({
  data,
  error,
  loading,
  onRetry,
}: {
  data: { daily: Quest[]; weekly: Quest[] } | undefined
  error: ApiError | null
  loading: boolean
  onRetry: () => void
}) {
  const L = useL()
  if (error && !data) return <ErrorState error={error} onRetry={onRetry} />
  if (!data) return loading ? <LoadingBlock rows={3} /> : null
  if (!data.daily.length && !data.weekly.length)
    return (
      <EmptyState
        icon={<ScrollText />}
        title={L('No quests yet', 'Chưa có nhiệm vụ')}
        body={L('Quests appear after your first study session.', 'Nhiệm vụ sẽ xuất hiện sau buổi học đầu tiên.')}
      />
    )
  return (
    <div className="grid gap-4 lg:grid-cols-2" data-testid="quests">
      <QuestColumn
        title={L('Daily quests', 'Nhiệm vụ ngày')}
        icon={<Sun />}
        quests={data.daily}
        note={L(
          'New daily quests every morning, tuned to your weakest skills.',
          'Nhiệm vụ mới mỗi sáng, ưu tiên kỹ năng còn yếu.',
        )}
      />
      <QuestColumn
        title={L('Weekly quests', 'Nhiệm vụ tuần')}
        icon={<CalendarRange />}
        quests={data.weekly}
        note={L('Weekly quests reset every Monday.', 'Nhiệm vụ tuần làm mới vào thứ Hai.')}
      />
    </div>
  )
}
