// Speaking history: every stored session with measured metrics and (optional) AI feedback.
import { ArrowLeft, ChevronDown, History, Mic } from 'lucide-react'
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import type { SpeakingSession } from '@shared/types'
import { Badge, Button, EmptyState, ErrorState, LoadingBlock, PageHeader, StatTile, cx } from '@/components/ui'
import { useFormat, useL, useTx } from '@/i18n'
import { useApi } from '@/lib/api'
import { FeedbackPanel, MetricsPanel } from '../components/Panels'
import { KIND_META, useAiReady } from '../lib/shared'

const modeLabel = (mode: string) => KIND_META[mode as keyof typeof KIND_META] ?? null

export default function HistoryPage() {
  const L = useL()
  const tx = useTx()
  const fmt = useFormat()
  const navigate = useNavigate()
  const ai = useAiReady()
  const { data, error, loading, reload, setData } = useApi('speaking:history', { limit: 100 }, [])
  const [open, setOpen] = useState<number | null>(null)

  const sessions = data ?? []
  const totalSec = sessions.reduce((s, x) => s + x.measured.speakingSec, 0)
  const wpm = sessions.map((s) => s.measured.wordsPerMinute).filter((v): v is number => v !== null)
  const update = (s: SpeakingSession) => setData((prev) => (prev ?? []).map((x) => (x.id === s.id ? s : x)))

  return (
    <div data-testid="page-speaking">
      <Button
        variant="ghost"
        size="sm"
        icon={<ArrowLeft className="size-4" />}
        onClick={() => navigate('/speaking')}
        className="mb-4"
      >
        {L('Speaking Studio', 'Phòng nói')}
      </Button>
      <PageHeader icon={<History />} title={L('Speaking history', 'Lịch sử luyện nói')} />
      {loading && !data ? (
        <LoadingBlock rows={4} />
      ) : error ? (
        <ErrorState error={error} onRetry={reload} />
      ) : sessions.length === 0 ? (
        <EmptyState
          icon={<Mic />}
          title={L('No sessions yet', 'Chưa có lượt luyện nào')}
          action={<Button onClick={() => navigate('/speaking')}>{L('Start speaking', 'Bắt đầu luyện nói')}</Button>}
        />
      ) : (
        <>
          <div className="mb-6 grid gap-3 sm:grid-cols-3">
            <StatTile label={L('Sessions', 'Số lượt')} value={sessions.length} />
            <StatTile label={L('Time speaking', 'Thời gian nói')} value={`${Math.round(totalSec / 60)} min`} />
            <StatTile
              label={L('Average speech rate', 'Tốc độ nói TB')}
              value={wpm.length ? `${Math.round(wpm.reduce((a, b) => a + b, 0) / wpm.length)} wpm` : '—'}
            />
          </div>
          <div className="space-y-2">
            {sessions.map((s) => {
              const meta = modeLabel(s.mode)
              const expanded = open === s.id
              return (
                <div key={s.id} className="rounded-2xl border border-line bg-surface">
                  <button
                    className="flex w-full items-center gap-3 px-4 py-3 text-left"
                    onClick={() => setOpen(expanded ? null : s.id)}
                  >
                    <span className="w-28 shrink-0 text-xs text-muted">
                      {fmt.date(s.createdAt, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                    </span>
                    <Badge tone="neutral">{meta ? tx(meta) : s.mode}</Badge>
                    <span className="min-w-0 flex-1 truncate text-sm">{s.transcript || s.prompt}</span>
                    <span className="text-xs text-muted tabular-nums">{s.measured.speakingSec}s</span>
                    {s.measured.wordAccuracy !== null && (
                      <span className="w-12 text-right text-sm font-semibold tabular-nums">
                        {Math.round(s.measured.wordAccuracy * 100)}%
                      </span>
                    )}
                    {s.feedback && <Badge tone="info">{s.feedback.cefrEstimate}</Badge>}
                    <ChevronDown className={cx('size-4 text-muted transition', expanded && 'rotate-180')} />
                  </button>
                  {expanded && (
                    <div className="space-y-4 border-t border-line p-4">
                      {s.prompt && <p className="text-sm whitespace-pre-wrap text-muted">{s.prompt}</p>}
                      <MetricsPanel measured={s.measured} transcript={s.transcript || null} aiReady={ai.ready} />
                      <FeedbackPanel session={s} aiReady={ai.ready} onUpdated={update} />
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </>
      )}
    </div>
  )
}
