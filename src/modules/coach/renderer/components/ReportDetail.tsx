// One report: key numbers, AI (or rule-based) advice, recommendations as actions and the plan with "Apply".
import {
  ArrowLeft,
  CalendarPlus,
  CheckCircle2,
  Clock,
  GraduationCap,
  Heart,
  ThumbsUp,
  TriangleAlert,
} from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { localDateKey } from '@core/dates'
import { Badge, Button, Card, ErrorState, LoadingBlock, Section, StatTile } from '@/components/ui'
import { useFormat, useL, useTx } from '@/i18n'
import { api, useAction, useApi } from '@/lib/api'
import { useApp } from '@/lib/store'
import type { ApplyPlanResult } from '../../types'
import { PERIOD_LABELS } from '../meta'
import { DeltaText, RecommendationList, SourceBadge } from './shared'

export function ReportDetail({ id }: { id: number }) {
  const L = useL()
  const tx = useTx()
  const fmt = useFormat()
  const navigate = useNavigate()
  const q = useApi('coach:report', { id }, [id])
  const apply = useAction(() => api('coach:applyPlan', { reportId: id }))
  const onApply = async () => {
    const res: ApplyPlanResult | undefined = await apply.run()
    if (!res) return
    useApp.getState().toast({
      kind: 'success',
      title: L(`Added ${res.created} lessons to your plan`, `Đã thêm ${res.created} bài vào kế hoạch`),
    })
    void q.reload()
  }

  if (q.error) return <ErrorState error={q.error} onRetry={() => void q.reload()} />
  if (!q.data) return <LoadingBlock rows={5} />
  const r = q.data
  const a = r.advice
  const s = r.stats
  const min = (n: number) => L(`${fmt.number(n)} min`, `${fmt.number(n)} phút`)
  const today = localDateKey()
  const canApply = a.nextPeriodPlan.some((d) => d.day >= today)

  return (
    <div data-testid="coach-report-detail">
      <Button
        variant="ghost"
        size="sm"
        icon={<ArrowLeft className="size-4" />}
        onClick={() => navigate('/coach/reports')}
      >
        {L('All reports', 'Tất cả báo cáo')}
      </Button>
      <Card className="mt-3 mb-6">
        <div className="mb-2 flex flex-wrap items-center gap-2 text-sm text-muted">
          <Badge tone="accent">{tx(PERIOD_LABELS[r.period])}</Badge>
          <span>{tx(r.label)}</span>
          <SourceBadge source={r.source} />
          <span>· {fmt.date(r.createdAt, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</span>
        </div>
        <h2 className="font-display text-2xl font-semibold" data-testid="coach-report-headline">
          {a.headline}
        </h2>
        <p className="mt-2 text-muted">{a.summary}</p>
        {r.fallbackReason && (
          <p className="mt-3 rounded-lg border border-line bg-layer p-3 text-xs text-muted">
            {L('Offline advice: ', 'Lời khuyên offline: ')}
            {r.fallbackReason}
          </p>
        )}
      </Card>

      <div className="mb-8 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile
          label={L('Studied', 'Thời gian học')}
          value={min(s.studyMinutes)}
          sub={<DeltaText delta={s.deltas?.studyMinutes} />}
        />
        <StatTile
          label={L('Active days', 'Ngày có học')}
          value={`${s.activeDays}/${s.elapsedDays}`}
          sub={<DeltaText delta={s.deltas?.activeDays} />}
        />
        <StatTile
          label={L('Consistency', 'Độ đều đặn')}
          value={`${s.consistency}/100`}
          sub={<DeltaText delta={s.deltas?.consistency} />}
        />
        <StatTile
          label={L('Plan completed', 'Hoàn thành kế hoạch')}
          value={s.plan.rate === null ? '—' : `${Math.round(s.plan.rate * 100)}%`}
          sub={L(`${s.plan.done}/${s.plan.total} lessons`, `${s.plan.done}/${s.plan.total} bài`)}
        />
      </div>

      <div className="mb-8 grid gap-4 lg:grid-cols-2">
        <Card>
          <h3 className="mb-2 flex items-center gap-2 font-semibold">
            <ThumbsUp className="size-4 text-success" />
            {L('Strengths', 'Điểm mạnh')}
          </h3>
          <ul className="list-disc space-y-1 pl-5 text-sm">
            {a.strengths.length ? a.strengths.map((x) => <li key={x}>{x}</li>) : <li>{L('—', '—')}</li>}
          </ul>
        </Card>
        <Card>
          <h3 className="mb-2 flex items-center gap-2 font-semibold">
            <TriangleAlert className="size-4 text-warning" />
            {L('Concerns', 'Cần chú ý')}
          </h3>
          <ul className="list-disc space-y-1 pl-5 text-sm">
            {a.concerns.length ? a.concerns.map((x) => <li key={x}>{x}</li>) : <li>—</li>}
          </ul>
        </Card>
      </div>

      <Section title={L('Recommendations', 'Nên làm')}>
        <RecommendationList items={a.recommendations} />
      </Section>

      {a.bestStudyTimes.length > 0 && (
        <Section title={L('Best times to study', 'Giờ học tốt nhất')}>
          <div className="flex flex-wrap gap-2">
            {a.bestStudyTimes.map((t) => (
              <Badge key={t} tone="accent">
                <Clock className="size-3" />
                {t}
              </Badge>
            ))}
          </div>
        </Section>
      )}

      <Section
        title={L('Plan for the coming days', 'Kế hoạch những ngày tới')}
        actions={
          r.appliedAt ? (
            <Badge tone="success">
              <CheckCircle2 className="size-3" />
              {L('Applied', 'Đã áp dụng')}
            </Badge>
          ) : (
            <Button
              size="sm"
              variant="primary"
              icon={<CalendarPlus className="size-4" />}
              loading={apply.pending}
              disabled={!canApply}
              onClick={() => void onApply()}
              data-testid="coach-apply-plan"
            >
              {L('Apply', 'Áp dụng')}
            </Button>
          )
        }
      >
        {apply.error && (
          <div className="mb-3">
            <ErrorState error={apply.error} compact />
          </div>
        )}
        <div className="grid gap-3 md:grid-cols-2">
          {a.nextPeriodPlan.map((d) => (
            <Card key={d.day} className="!p-4">
              <div className="flex items-center justify-between gap-2">
                <span className="font-semibold">
                  {fmt.date(d.day, { weekday: 'long', day: 'numeric', month: 'short' })}
                </span>
                <span className="text-xs text-muted">{min(d.minutes)}</span>
              </div>
              <div className="mt-1 text-sm text-accent">{d.focus}</div>
              <ul className="mt-2 list-disc space-y-0.5 pl-5 text-sm text-muted">
                {d.activities.map((x) => (
                  <li key={x}>{x}</li>
                ))}
              </ul>
            </Card>
          ))}
        </div>
        <p className="mt-2 text-xs text-faint">
          {L(
            '“Apply” adds these lessons to your daily plan (Journey) for each day.',
            '“Áp dụng” thêm các bài này vào kế hoạch hằng ngày (Hành trình) của từng ngày.',
          )}
        </p>
      </Section>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <h3 className="mb-2 flex items-center gap-2 font-semibold">
            <GraduationCap className="size-4 text-accent" />
            {L('IELTS outlook', 'Dự báo IELTS')}
          </h3>
          <p className="text-sm text-muted">{a.ieltsOutlook}</p>
        </Card>
        <Card>
          <h3 className="mb-2 flex items-center gap-2 font-semibold">
            <Heart className="size-4 text-danger" />
            {L('Motivation', 'Động lực')}
          </h3>
          <p className="text-sm text-muted">{a.motivation}</p>
        </Card>
      </div>
    </div>
  )
}
