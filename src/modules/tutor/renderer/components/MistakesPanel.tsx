// "My recurring mistakes": the learner's mistake memory (shared with every AI prompt), with delete.
import { ArrowRight, Trash, Repeat } from 'lucide-react'
import { useState } from 'react'
import { Badge, EmptyState, ErrorState, IconButton, LoadingBlock } from '@/components/ui'
import { useL, useTx, useFormat } from '@/i18n'
import { api, toApiError, useApi } from '@/lib/api'
import { useApp } from '@/lib/store'
import { CATEGORY_LABEL } from '../lib/modes'

export function MistakesPanel({ limit = 50, compact }: { limit?: number; compact?: boolean }) {
  const L = useL()
  const tx = useTx()
  const fmt = useFormat()
  const q = useApi('learner:mistakes', { limit }, [limit])
  const [busy, setBusy] = useState<number | null>(null)

  const remove = async (id: number) => {
    setBusy(id)
    try {
      await api('learner:deleteMistake', { id })
      q.setData((prev) => (prev ?? []).filter((m) => m.id !== id))
    } catch (err) {
      useApp.getState().toast({ kind: 'error', title: toApiError(err).message })
    } finally {
      setBusy(null)
    }
  }

  if (q.loading && !q.data) return <LoadingBlock rows={compact ? 2 : 3} />
  if (q.error) return <ErrorState error={q.error} onRetry={q.reload} compact />
  const items = q.data ?? []
  if (!items.length)
    return (
      <EmptyState
        icon={<Repeat />}
        title={L('No recurring mistakes yet', 'Chưa có lỗi lặp lại')}
        body={L(
          'When the tutor corrects you, the mistake is remembered here so every AI lesson can help you fix it.',
          'Khi gia sư sửa lỗi, lỗi sẽ được ghi nhớ ở đây để mọi bài học AI giúp bạn khắc phục.',
        )}
      />
    )
  return (
    <ul className="space-y-2" data-testid="tutor-mistakes">
      {items.map((m) => (
        <li key={m.id} className="group flex items-start gap-3 rounded-xl border border-line bg-surface-2 p-3">
          <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-warning/15 text-sm font-bold text-warning" title={L('Times seen', 'Số lần gặp')}>
            ×{m.count}
          </div>
          <div className="min-w-0 flex-1 text-sm">
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone="neutral">{CATEGORY_LABEL[m.category] ? tx(CATEGORY_LABEL[m.category]!) : m.category}</Badge>
              <span className="font-medium">{m.pattern}</span>
            </div>
            {(m.example || m.correction) && (
              <div className="mt-1 flex flex-wrap items-center gap-1.5 text-muted">
                {m.example && <span className="text-danger line-through decoration-danger/60">{m.example}</span>}
                {m.example && m.correction && <ArrowRight className="size-3.5" />}
                {m.correction && <span className="text-success">{m.correction}</span>}
              </div>
            )}
            {!compact && <div className="mt-1 text-xs text-faint">{L('Last seen', 'Gặp lần cuối')} {fmt.relative(m.lastSeenAt)}</div>}
          </div>
          <IconButton
            label={L('Forget this mistake', 'Xóa lỗi này')}
            disabled={busy === m.id}
            onClick={() => void remove(m.id)}
            className="opacity-60 group-hover:opacity-100"
          >
            <Trash className="size-4" />
          </IconButton>
        </li>
      ))}
    </ul>
  )
}
