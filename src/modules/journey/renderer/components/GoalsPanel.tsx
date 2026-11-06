// Learning goals CRUD (kernel channels learner:goals / saveGoal / deleteGoal).
import { AnimatePresence, motion } from 'framer-motion'
import { CalendarDays, Check, Pencil, Plus, Target, Trash2 } from 'lucide-react'
import { useState } from 'react'
import type { LearningGoal } from '@shared/types'
import {
  Badge,
  Button,
  Card,
  ConfirmDialog,
  ErrorState,
  Field,
  IconButton,
  Input,
  LoadingBlock,
  Modal,
  ProgressBar,
  Select,
  cx,
} from '@/components/ui'
import { useFormat, useL } from '@/i18n'
import { api, toApiError, useApi, type ApiError } from '@/lib/api'

type GoalDraft = {
  id?: number
  kind: LearningGoal['kind']
  title: string
  metric: LearningGoal['metric']
  targetValue: number
  targetDate: string | null
  status: LearningGoal['status']
}

const EMPTY: GoalDraft = {
  kind: 'short',
  title: '',
  metric: 'minutes',
  targetValue: 300,
  targetDate: null,
  status: 'active',
}

export function GoalsPanel() {
  const L = useL()
  const fmt = useFormat()
  const goals = useApi('learner:goals', undefined)
  const [editing, setEditing] = useState<GoalDraft | null>(null)
  const [deleting, setDeleting] = useState<LearningGoal | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<ApiError | null>(null)

  const metricLabel = (m: LearningGoal['metric']) =>
    ({
      minutes: L('minutes', 'phút'),
      words: L('words', 'từ'),
      lessons: L('lessons', 'bài học'),
      xp: 'XP',
      none: '',
    })[m]

  const save = async (g: GoalDraft) => {
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      goals.setData(
        await api('learner:saveGoal', {
          ...g,
          title: g.title.trim(),
          // The contract accepts exactly 'YYYY-MM-DD' or null (older goals may carry a full timestamp).
          targetDate: /^\d{4}-\d{2}-\d{2}/.test(g.targetDate ?? '') ? (g.targetDate as string).slice(0, 10) : null,
          targetValue: g.metric === 'none' ? 0 : g.targetValue,
        }),
      )
      setEditing(null)
    } catch (err) {
      setError(toApiError(err))
    } finally {
      setBusy(false)
    }
  }

  const toggleDone = (g: LearningGoal) =>
    void save({
      id: g.id,
      kind: g.kind,
      title: g.title,
      metric: g.metric,
      targetValue: g.targetValue,
      targetDate: g.targetDate,
      status: g.status === 'done' ? 'active' : 'done',
    })

  const remove = async () => {
    if (!deleting) return
    try {
      goals.setData(await api('learner:deleteGoal', { id: deleting.id }))
    } catch (err) {
      setError(toApiError(err))
    }
    setDeleting(null)
  }

  return (
    <Card data-testid="journey-goals">
      <div className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-2 font-semibold">
          <Target className="size-5 text-accent" /> {L('My goals', 'Mục tiêu của tôi')}
        </div>
        <Button
          size="sm"
          icon={<Plus className="size-4" />}
          onClick={() => setEditing({ ...EMPTY })}
          data-testid="goal-add"
        >
          {L('Add goal', 'Thêm mục tiêu')}
        </Button>
      </div>
      {goals.loading && !goals.data ? (
        <LoadingBlock rows={2} />
      ) : goals.error ? (
        <ErrorState error={goals.error} onRetry={goals.reload} compact />
      ) : goals.data && goals.data.length ? (
        <ul className="space-y-2">
          <AnimatePresence initial={false}>
            {goals.data.map((g) => {
              const done = g.status === 'done'
              return (
                <motion.li
                  key={g.id}
                  layout
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="group rounded-xl border border-line bg-surface-2/50 p-3"
                >
                  <div className="flex items-start gap-3">
                    <button
                      onClick={() => toggleDone(g)}
                      aria-label={
                        done ? L('Mark as active', 'Đánh dấu đang thực hiện') : L('Mark as achieved', 'Đánh dấu đã đạt')
                      }
                      className={cx(
                        'mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full border-2 transition',
                        done
                          ? 'border-success bg-success text-bg'
                          : 'border-line-strong text-transparent hover:border-success hover:text-success',
                      )}
                    >
                      <Check className="size-3.5" strokeWidth={3} />
                    </button>
                    <div className="min-w-0 flex-1">
                      <div className={cx('text-sm font-semibold', done && 'text-muted line-through')}>{g.title}</div>
                      <div className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-faint">
                        <Badge tone={g.kind === 'long' ? 'info' : g.kind === 'short' ? 'accent' : 'neutral'}>
                          {g.kind === 'short'
                            ? L('short-term', 'ngắn hạn')
                            : g.kind === 'long'
                              ? L('long-term', 'dài hạn')
                              : L('custom', 'tùy chỉnh')}
                        </Badge>
                        {g.targetDate && (
                          <span className="flex items-center gap-1">
                            <CalendarDays className="size-3" />
                            {fmt.date(g.targetDate, { day: 'numeric', month: 'short', year: 'numeric' })}
                          </span>
                        )}
                      </div>
                      {g.metric !== 'none' && g.targetValue > 0 && (
                        <div className="mt-2">
                          <ProgressBar
                            value={g.currentValue}
                            max={g.targetValue}
                            className="h-1.5"
                            tone={done ? 'success' : 'accent'}
                          />
                          <div className="mt-1 text-[11px] text-faint tabular-nums">
                            {fmt.number(Math.min(g.currentValue, g.targetValue))} / {fmt.number(g.targetValue)}{' '}
                            {metricLabel(g.metric)}
                          </div>
                        </div>
                      )}
                    </div>
                    <div className="flex opacity-0 transition group-hover:opacity-100 focus-within:opacity-100">
                      <IconButton
                        label={L('Edit', 'Sửa')}
                        onClick={() =>
                          setEditing({
                            id: g.id,
                            kind: g.kind,
                            title: g.title,
                            metric: g.metric,
                            targetValue: g.targetValue,
                            targetDate: g.targetDate,
                            status: g.status,
                          })
                        }
                      >
                        <Pencil className="size-4" />
                      </IconButton>
                      <IconButton label={L('Delete', 'Xóa')} onClick={() => setDeleting(g)}>
                        <Trash2 className="size-4" />
                      </IconButton>
                    </div>
                  </div>
                </motion.li>
              )
            })}
          </AnimatePresence>
        </ul>
      ) : (
        <p className="rounded-xl border border-dashed border-line p-4 text-center text-sm text-faint">
          {L(
            'Set a goal such as "Study 600 minutes this month" – progress updates automatically.',
            'Đặt một mục tiêu như "Học 600 phút trong tháng này" – tiến độ tự cập nhật.',
          )}
        </p>
      )}
      {error && (
        <div className="mt-3">
          <ErrorState error={error} compact />
        </div>
      )}

      <Modal
        open={editing !== null}
        onClose={() => setEditing(null)}
        title={editing?.id ? L('Edit goal', 'Sửa mục tiêu') : L('New goal', 'Mục tiêu mới')}
        footer={
          <>
            <Button variant="ghost" onClick={() => setEditing(null)}>
              {L('Cancel', 'Hủy')}
            </Button>
            <Button
              variant="primary"
              loading={busy}
              disabled={!editing?.title.trim()}
              onClick={() => editing && void save(editing)}
              data-testid="goal-save"
            >
              {L('Save', 'Lưu')}
            </Button>
          </>
        }
      >
        {editing && (
          <div className="space-y-4">
            <Field label={L('Goal', 'Mục tiêu')}>
              <Input
                autoFocus
                value={editing.title}
                maxLength={200}
                placeholder={L('e.g. Learn 300 new words', 'VD: Học 300 từ mới')}
                onChange={(e) => setEditing({ ...editing, title: e.target.value })}
                data-testid="goal-title"
              />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label={L('Type', 'Loại')}>
                <Select
                  value={editing.kind}
                  onChange={(e) => setEditing({ ...editing, kind: e.target.value as GoalDraft['kind'] })}
                >
                  <option value="short">{L('Short-term', 'Ngắn hạn')}</option>
                  <option value="long">{L('Long-term', 'Dài hạn')}</option>
                  <option value="custom">{L('Custom', 'Tùy chỉnh')}</option>
                </Select>
              </Field>
              <Field label={L('Deadline (optional)', 'Hạn (tùy chọn)')}>
                <Input
                  type="date"
                  value={editing.targetDate ?? ''}
                  onChange={(e) => setEditing({ ...editing, targetDate: e.target.value || null })}
                />
              </Field>
              <Field
                label={L('Track', 'Theo dõi')}
                hint={L('Counted automatically from your activity', 'Tự động đếm từ hoạt động của bạn')}
              >
                <Select
                  value={editing.metric}
                  onChange={(e) => setEditing({ ...editing, metric: e.target.value as GoalDraft['metric'] })}
                >
                  <option value="minutes">{L('Minutes studied', 'Số phút học')}</option>
                  <option value="words">{L('Words saved', 'Số từ đã lưu')}</option>
                  <option value="lessons">{L('Lessons completed', 'Số bài hoàn thành')}</option>
                  <option value="xp">XP</option>
                  <option value="none">{L('Nothing (tick manually)', 'Không (tự đánh dấu)')}</option>
                </Select>
              </Field>
              {editing.metric !== 'none' && (
                <Field label={L('Target', 'Chỉ tiêu')}>
                  <Input
                    type="number"
                    min={1}
                    max={1000000}
                    value={editing.targetValue}
                    onChange={(e) =>
                      setEditing({
                        ...editing,
                        targetValue: Math.max(0, Math.min(1_000_000, Number(e.target.value) || 0)),
                      })
                    }
                  />
                </Field>
              )}
            </div>
          </div>
        )}
      </Modal>
      <ConfirmDialog
        open={deleting !== null}
        title={L('Delete goal?', 'Xóa mục tiêu?')}
        body={deleting?.title}
        confirmLabel={L('Delete', 'Xóa')}
        danger
        onConfirm={() => void remove()}
        onCancel={() => setDeleting(null)}
      />
    </Card>
  )
}
