// Report list with period filter and buttons to generate a new day / week / month report.
import { FileText, Send, Monitor } from 'lucide-react'
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Badge, Button, Card, EmptyState, ErrorState, LoadingBlock, Tabs } from '@/components/ui'
import { useFormat, useL, useTx } from '@/i18n'
import { api, useAction, useApi } from '@/lib/api'
import type { CoachPeriod } from '../../types'
import { PERIOD_LABELS } from '../meta'
import { SourceBadge } from './shared'

type Filter = 'all' | CoachPeriod

export function ReportsTab() {
  const L = useL()
  const tx = useTx()
  const fmt = useFormat()
  const navigate = useNavigate()
  const [filter, setFilter] = useState<Filter>('all')
  const list = useApi('coach:reports', filter === 'all' ? { limit: 100 } : { period: filter, limit: 100 }, [filter])
  const gen = useAction((period: CoachPeriod) => api('coach:generateReport', { period, offset: 0, useAi: true }))
  const generate = async (period: CoachPeriod) => {
    const r = await gen.run(period)
    if (r) navigate(`/coach/reports/${r.id}`)
  }

  return (
    <div data-testid="coach-reports">
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <Tabs<Filter>
          value={filter}
          onChange={setFilter}
          items={[
            { value: 'all', label: L('All', 'Tất cả') },
            ...(['day', 'week', 'month'] as const).map((p) => ({ value: p, label: tx(PERIOD_LABELS[p]) })),
          ]}
        />
        <div className="flex flex-wrap gap-2">
          {(['day', 'week', 'month'] as const).map((p) => (
            <Button
              key={p}
              size="sm"
              variant={p === 'week' ? 'primary' : 'secondary'}
              loading={gen.pending}
              data-testid={`coach-generate-${p}`}
              onClick={() => void generate(p)}
            >
              {L(`New ${PERIOD_LABELS[p].en.toLowerCase()} report`, `Báo cáo ${PERIOD_LABELS[p].vi.toLowerCase()} mới`)}
            </Button>
          ))}
        </div>
      </div>
      {gen.error && (
        <div className="mb-4">
          <ErrorState error={gen.error} compact />
        </div>
      )}
      {list.error ? (
        <ErrorState error={list.error} onRetry={() => void list.reload()} />
      ) : !list.data ? (
        <LoadingBlock rows={4} />
      ) : list.data.length === 0 ? (
        <EmptyState
          icon={<FileText />}
          title={L('No reports yet', 'Chưa có báo cáo')}
          body={L(
            'Reports are created automatically on schedule, or create one now.',
            'Báo cáo được tạo tự động theo lịch, hoặc bạn có thể tạo ngay bây giờ.',
          )}
        />
      ) : (
        <div className="space-y-2">
          {list.data.map((r) => (
            <Card
              key={r.id}
              className="!p-4"
              onClick={() => navigate(`/coach/reports/${r.id}`)}
              data-testid={`coach-report-${r.id}`}
            >
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
                    <Badge tone="accent">{tx(PERIOD_LABELS[r.period])}</Badge>
                    <span>{tx(r.label)}</span>
                    <span>
                      · {fmt.date(r.createdAt, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                    </span>
                  </div>
                  <div className="mt-1 truncate font-semibold">{r.headline || L('Report', 'Báo cáo')}</div>
                </div>
                <div className="flex items-center gap-2">
                  {r.delivered.includes('app') && (
                    <span title={L('Sent as Windows notification', 'Đã gửi thông báo Windows')}>
                      <Monitor className="size-4 text-faint" />
                    </span>
                  )}
                  {r.delivered.includes('telegram') && (
                    <span title={L('Sent to Telegram', 'Đã gửi Telegram')}>
                      <Send className="size-4 text-faint" />
                    </span>
                  )}
                  {r.appliedAt && <Badge tone="success">{L('Plan applied', 'Đã áp dụng')}</Badge>}
                  <SourceBadge source={r.source} />
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}
