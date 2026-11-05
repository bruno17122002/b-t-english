// Writing history: every submission with its scores and a trend chart of AI scores over time.
import { ArrowLeft, FileText, GraduationCap, PenLine, Sigma, Trash2, TrendingUp } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { AiBadge } from '@/components/learning'
import {
  Badge,
  Button,
  Card,
  CefrBadge,
  ConfirmDialog,
  EmptyState,
  ErrorState,
  IconButton,
  LoadingBlock,
  PageHeader,
  Section,
  StatTile,
} from '@/components/ui'
import { useFormat, useL, useTx } from '@/i18n'
import { api, toApiError, useApi } from '@/lib/api'
import { useApp } from '@/lib/store'
import type { WritingHistoryItem } from '../../contract'
import { ScoreTrend, taskMeta } from '../components/shared'

export default function HistoryPage() {
  const L = useL()
  const tx = useTx()
  const fmt = useFormat()
  const navigate = useNavigate()
  const toast = useApp((s) => s.toast)
  const q = useApi('writing:history', { limit: 200 })
  const [toDelete, setToDelete] = useState<WritingHistoryItem | null>(null)
  const items = useMemo(() => q.data ?? [], [q.data])

  const scored = useMemo(() => [...items].reverse().filter((h) => h.score !== null), [items])
  const stats = useMemo(() => {
    const scores = scored.map((h) => h.score as number)
    const bands = items.map((h) => h.ieltsBand).filter((b): b is number => b !== null)
    return {
      total: items.length,
      words: items.reduce((n, h) => n + h.words, 0),
      avg: scores.length ? Math.round((scores.reduce((a, b) => a + b, 0) / scores.length) * 10) / 10 : null,
      bestBand: bands.length ? Math.max(...bands) : null,
    }
  }, [items, scored])

  const remove = async (h: WritingHistoryItem) => {
    setToDelete(null)
    try {
      await api('writing:delete', { id: h.id })
      q.setData((prev) => (prev ?? []).filter((x) => x.id !== h.id))
    } catch (err) {
      toast({ kind: 'error', title: toApiError(err).message })
    }
  }

  return (
    <div data-testid="page-writing" className="mx-auto max-w-5xl">
      <Button
        variant="ghost"
        className="mb-3"
        icon={<ArrowLeft className="size-4" />}
        onClick={() => navigate('/writing')}
      >
        {L('Writing Workshop', 'Xưởng viết')}
      </Button>
      <PageHeader
        icon={<FileText />}
        title={L('Writing history', 'Lịch sử bài viết')}
        subtitle={L(
          'Every piece you have written, with feedback and progress.',
          'Mọi bài bạn đã viết, kèm nhận xét và tiến bộ.',
        )}
      />

      {q.error ? (
        <ErrorState error={q.error} onRetry={q.reload} />
      ) : !q.data ? (
        <LoadingBlock rows={4} />
      ) : items.length === 0 ? (
        <EmptyState
          icon={<PenLine />}
          title={L('No writing yet', 'Chưa có bài viết')}
          body={L(
            'Pick a prompt or write freely – your submissions will appear here.',
            'Chọn một đề hoặc viết tự do – bài của bạn sẽ hiện ở đây.',
          )}
          action={
            <Button variant="primary" onClick={() => navigate('/writing')}>
              {L('Start writing', 'Bắt đầu viết')}
            </Button>
          }
        />
      ) : (
        <>
          <div className="mb-8 grid grid-cols-2 gap-3 md:grid-cols-4">
            <StatTile icon={<FileText />} label={L('Submissions', 'Số bài')} value={fmt.number(stats.total)} />
            <StatTile icon={<Sigma />} label={L('Words written', 'Số từ đã viết')} value={fmt.number(stats.words)} />
            <StatTile
              icon={<TrendingUp />}
              label={L('Average score', 'Điểm TB')}
              value={stats.avg !== null ? `${stats.avg}/10` : '—'}
              sub={stats.avg !== null ? <AiBadge /> : L('needs AI feedback', 'cần AI nhận xét')}
            />
            <StatTile
              icon={<GraduationCap />}
              label={L('Best IELTS band', 'Band IELTS cao nhất')}
              value={stats.bestBand !== null ? stats.bestBand.toFixed(1) : '—'}
            />
          </div>

          <Section title={L('Score trend', 'Xu hướng điểm')}>
            <Card>
              {scored.length === 0 ? (
                <p className="text-sm text-muted">
                  {L('Scores appear after AI feedback.', 'Điểm sẽ hiện khi có nhận xét từ AI.')}
                </p>
              ) : (
                <ScoreTrend
                  points={scored.map((h) => ({ score: h.score as number, label: fmt.date(h.createdAt) }))}
                  label={L('AI score per submission', 'Điểm AI theo từng bài')}
                />
              )}
            </Card>
          </Section>

          <Section title={L('All submissions', 'Tất cả bài viết')}>
            <ul className="space-y-2" data-testid="writing-history">
              {items.map((h) => {
                const meta = taskMeta(h.taskType)
                return (
                  <li key={h.id}>
                    <Card
                      interactive
                      onClick={() => navigate(`/writing/result/${h.id}`)}
                      className="flex items-center gap-4 p-4"
                    >
                      <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-accent/15 text-accent">
                        <meta.icon className="size-5" />
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="truncate font-medium">{h.title}</div>
                        <div className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-faint">
                          <span>{tx(meta)}</span>·
                          <span>{fmt.date(h.createdAt, { day: 'numeric', month: 'short', year: 'numeric' })}</span>·
                          <span>
                            {h.words} {L('words', 'từ')}
                          </span>
                          {h.selfCorrected && <Badge tone="success">{L('Self-corrected', 'Đã tự sửa')}</Badge>}
                        </div>
                      </div>
                      <div className="flex shrink-0 items-center gap-2 text-sm">
                        {h.score !== null ? (
                          <>
                            {h.cefr && <CefrBadge level={h.cefr} />}
                            <span className="font-display text-xl font-semibold tabular-nums">{h.score}</span>
                            <span className="text-faint">/10</span>
                          </>
                        ) : (
                          <span className="flex items-center gap-1.5" title={L('rough estimate', 'ước lượng thô')}>
                            <CefrBadge level={h.heuristicCefr} />
                            <Badge>{L('rough', 'thô')}</Badge>
                          </span>
                        )}
                        <span onClick={(e) => e.stopPropagation()}>
                          <IconButton label={L('Delete', 'Xóa')} onClick={() => setToDelete(h)}>
                            <Trash2 className="size-4" />
                          </IconButton>
                        </span>
                      </div>
                    </Card>
                  </li>
                )
              })}
            </ul>
          </Section>
        </>
      )}

      <ConfirmDialog
        open={toDelete !== null}
        danger
        title={L('Delete this submission?', 'Xóa bài viết này?')}
        body={L(
          'The text and its feedback will be removed. XP already earned is kept.',
          'Bài viết và nhận xét sẽ bị xóa. XP đã nhận vẫn được giữ.',
        )}
        confirmLabel={L('Delete', 'Xóa')}
        onConfirm={() => toDelete && void remove(toDelete)}
        onCancel={() => setToDelete(null)}
      />
    </div>
  )
}
