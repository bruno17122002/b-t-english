// Habit overview: period switcher, KPI tiles with deltas, hour / weekday / module charts, consistency heatmap,
// detected anomalies and the AI insight card.
import {
  AlertTriangle,
  CalendarCheck,
  ChevronLeft,
  ChevronRight,
  Clock,
  Gauge,
  Layers,
  MonitorSmartphone,
  Sparkles,
  Target,
  Timer,
} from 'lucide-react'
import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorState,
  IconButton,
  LoadingBlock,
  Section,
  StatTile,
  Tabs,
} from '@/components/ui'
import { useFormat, useL, useTx } from '@/i18n'
import { api, useAction, useApi } from '@/lib/api'
import { useApp } from '@/lib/store'
import { BarChart, HBarChart, Heatmap } from '../../../game/renderer/charts'
import { buildHeatmapWeeks } from '../../../game/renderer/charts/heatmapData'
import type { CoachOverview, CoachPeriod } from '../../types'
import { hourLabel, moduleLabel, PERIOD_LABELS, SKILL_LABELS, WEEKDAYS_MON_FIRST } from '../meta'
import { DeltaText, RecommendationList, SourceBadge } from './shared'

const HEATMAP_WEEKS = 17

export function OverviewTab() {
  const L = useL()
  const tx = useTx()
  const [period, setPeriod] = useState<CoachPeriod>('week')
  const [offset, setOffset] = useState(0)
  const q = useApi('coach:overview', { period, offset }, [period, offset])

  return (
    <div data-testid="coach-overview">
      <div className="mb-5 flex flex-wrap items-center gap-3">
        <Tabs<CoachPeriod>
          value={period}
          onChange={(p) => {
            setPeriod(p)
            setOffset(0)
          }}
          items={(['day', 'week', 'month'] as const).map((p) => ({ value: p, label: tx(PERIOD_LABELS[p]) }))}
        />
        <div className="flex items-center gap-1">
          <IconButton
            label={L('Previous period', 'Kỳ trước')}
            data-testid="coach-prev"
            onClick={() => setOffset((o) => o - 1)}
          >
            <ChevronLeft className="size-4" />
          </IconButton>
          <span className="min-w-40 text-center text-sm font-semibold" data-testid="coach-period-label">
            {q.data ? tx(q.data.stats.label) : '…'}
          </span>
          <IconButton
            label={L('Next period', 'Kỳ sau')}
            data-testid="coach-next"
            disabled={offset >= 0}
            onClick={() => setOffset((o) => Math.min(0, o + 1))}
          >
            <ChevronRight className="size-4" />
          </IconButton>
        </div>
      </div>
      {q.error ? (
        <ErrorState error={q.error} onRetry={() => void q.reload()} />
      ) : !q.data ? (
        <LoadingBlock rows={4} />
      ) : (
        <OverviewBody data={q.data} offset={offset} onReload={() => void q.reload()} />
      )}
    </div>
  )
}

function OverviewBody({ data, offset, onReload }: { data: CoachOverview; offset: number; onReload: () => void }) {
  const L = useL()
  const tx = useTx()
  const fmt = useFormat()
  const s = data.stats
  const d = s.deltas
  const min = (n: number) => L(`${fmt.number(n)} min`, `${fmt.number(n)} phút`)
  const dailyGoal = useApp((st) => st.profile?.dailyMinutes ?? 20)
  const end = s.to < data.today ? s.to : data.today
  const heatCols = useMemo(
    () => buildHeatmapWeeks(end, HEATMAP_WEEKS, data.heatmap, dailyGoal),
    [end, data.heatmap, dailyGoal],
  )
  const empty = s.activeDays === 0 && s.appMinutes < 1

  return (
    <>
      <div className="mb-8 grid grid-cols-2 gap-3 lg:grid-cols-4" data-testid="coach-kpis">
        <StatTile
          icon={<Clock />}
          label={L('Studied', 'Thời gian học')}
          value={<span data-testid="coach-kpi-minutes">{min(s.studyMinutes)}</span>}
          sub={<DeltaText delta={d?.studyMinutes} />}
        />
        <StatTile
          icon={<CalendarCheck />}
          label={L('Active days', 'Ngày có học')}
          value={`${s.activeDays}/${s.elapsedDays}`}
          sub={<DeltaText delta={d?.activeDays} />}
        />
        <StatTile
          icon={<Timer />}
          label={L('Study sessions', 'Buổi học')}
          value={s.studySessions.count}
          sub={L(
            `median ${fmt.number(s.studySessions.medianMinutes)} min`,
            `trung vị ${fmt.number(s.studySessions.medianMinutes)} phút`,
          )}
        />
        <StatTile
          icon={<MonitorSmartphone />}
          label={L('App open (active)', 'Mở ứng dụng')}
          value={min(s.appMinutes)}
          sub={L(`${s.appSessions.count} sessions`, `${s.appSessions.count} phiên`)}
        />
        <StatTile
          icon={<Gauge />}
          label={L('Consistency', 'Độ đều đặn')}
          value={`${s.consistency}/100`}
          sub={<DeltaText delta={d?.consistency} />}
        />
        <StatTile
          icon={<Target />}
          label={L('Accuracy', 'Độ chính xác')}
          value={s.avgScore === null ? '—' : `${Math.round(s.avgScore * 100)}%`}
          sub={
            d && s.avgScore !== null ? (
              <DeltaText delta={d.avgScore} unit=" pt" />
            ) : (
              L('no scored activity', 'chưa có bài chấm điểm')
            )
          }
        />
        <StatTile
          icon={<Layers />}
          label={L('Words saved / reviews', 'Từ mới / lượt ôn')}
          value={`${s.wordsSaved} / ${s.reviews}`}
          sub={L(`${s.reviewBacklog} cards due`, `${s.reviewBacklog} thẻ đến hạn`)}
        />
        <StatTile
          icon={<CalendarCheck />}
          label={L('Plan completed', 'Hoàn thành kế hoạch')}
          value={s.plan.rate === null ? '—' : `${Math.round(s.plan.rate * 100)}%`}
          sub={L(
            `${s.plan.done}/${s.plan.total} lessons · streak ${s.streak.current}`,
            `${s.plan.done}/${s.plan.total} bài · chuỗi ${s.streak.current} ngày`,
          )}
        />
      </div>

      <InsightCard data={data} offset={offset} onChanged={onReload} />

      {empty ? (
        <EmptyState
          icon={<Sparkles />}
          title={L('No habit data for this period yet', 'Chưa có dữ liệu thói quen trong kỳ này')}
          body={L(
            'Study a little and come back – the coach records when and how you learn automatically.',
            'Hãy học một chút rồi quay lại – AI Coach tự ghi lại bạn học lúc nào và học gì.',
          )}
        />
      ) : (
        <>
          {s.anomalies.length > 0 && (
            <Section title={L('Things to watch', 'Điểm cần chú ý')}>
              <ul className="space-y-2" data-testid="coach-anomalies">
                {s.anomalies.map((a) => (
                  <li
                    key={a.code}
                    className="flex items-start gap-2 rounded-lg border border-line bg-surface p-3 text-sm"
                  >
                    <AlertTriangle
                      className={
                        a.severity === 'warning' ? 'size-4 shrink-0 text-warning' : 'size-4 shrink-0 text-info'
                      }
                    />
                    {tx(a)}
                  </li>
                ))}
              </ul>
            </Section>
          )}
          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <h3 className="mb-3 font-semibold">{L('When you study (hour of day)', 'Bạn học vào giờ nào')}</h3>
              <BarChart
                data={s.hourHistogram.map((v, h) => ({ key: `h${h}`, label: `${h}h`, value: v }))}
                title={L('Study minutes by hour', 'Số phút học theo giờ')}
                formatValue={(v) => min(v)}
                formatTick={(v) => fmt.number(v)}
                tooltipTitle={(b) => hourLabel(Number(b.key.slice(1)))}
                emptyText={L('No study yet', 'Chưa có buổi học')}
                highlightLast={false}
              />
              {s.preferredHours.length > 0 && (
                <p className="mt-2 text-sm text-muted">
                  {L('Peak hours: ', 'Giờ học nhiều nhất: ')}
                  {s.preferredHours.map(hourLabel).join(', ')}
                </p>
              )}
            </Card>
            <Card>
              <h3 className="mb-3 font-semibold">{L('Weekdays', 'Các ngày trong tuần')}</h3>
              <BarChart
                data={s.weekdayMinutes.map((v, i) => ({
                  key: `wd${i}`,
                  label: tx(WEEKDAYS_MON_FIRST[i] ?? { en: '', vi: '' }),
                  value: v,
                }))}
                title={L('Study minutes by weekday', 'Số phút học theo thứ')}
                formatValue={(v) => min(v)}
                formatTick={(v) => fmt.number(v)}
                emptyText={L('No study yet', 'Chưa có buổi học')}
                highlightLast={false}
              />
            </Card>
            <Card>
              <h3 className="mb-3 font-semibold">{L('Where your time goes', 'Thời gian dành cho từng phần')}</h3>
              <HBarChart
                data={s.moduleMix.slice(0, 8).map((m) => ({
                  key: m.module,
                  label: tx(moduleLabel(m.module)),
                  value: Math.round(Math.max(m.studyMinutes, m.appMinutes)),
                  sub: L(
                    `${fmt.number(m.studyMinutes)} min studied · ${fmt.number(m.appMinutes)} min open`,
                    `${fmt.number(m.studyMinutes)} phút học · ${fmt.number(m.appMinutes)} phút mở`,
                  ),
                }))}
                title={L('Minutes per module', 'Số phút theo mục')}
                formatValue={(v) => min(v)}
                emptyText={L('No data yet', 'Chưa có dữ liệu')}
              />
            </Card>
            <Card>
              <h3 className="mb-3 font-semibold">
                {L('Skill mix vs. weakest skills', 'Kỹ năng luyện tập so với kỹ năng yếu')}
              </h3>
              <HBarChart
                data={s.skillMix.map((m) => ({
                  key: m.skill,
                  label: `${tx(SKILL_LABELS[m.skill])}${s.weakestSkills.includes(m.skill) ? ' ⚑' : ''}`,
                  value: m.minutes,
                  sub: L(`${Math.round(m.share * 100)}% of study time`, `${Math.round(m.share * 100)}% thời gian học`),
                }))}
                title={L('Minutes per skill', 'Số phút theo kỹ năng')}
                formatValue={(v) => min(v)}
                emptyText={L('No data yet', 'Chưa có dữ liệu')}
              />
              {s.weakestSkills.length > 0 && (
                <p className="mt-2 text-sm text-muted">
                  ⚑ {L('Weakest: ', 'Yếu nhất: ')}
                  {s.weakestSkills.map((k) => tx(SKILL_LABELS[k])).join(', ')} –{' '}
                  {L(
                    `${Math.round(s.weakSkillShare * 100)}% of your time`,
                    `${Math.round(s.weakSkillShare * 100)}% thời gian của bạn`,
                  )}
                </p>
              )}
            </Card>
          </div>
        </>
      )}
      <Section title={L('Consistency calendar', 'Lịch đều đặn')} className="mt-8">
        <Card>
          <Heatmap
            cols={heatCols}
            title={L('Study calendar', 'Lịch học')}
            description={L('Minutes studied per day', 'Số phút học mỗi ngày')}
            weekdayLabels={WEEKDAYS_MON_FIRST.map((w) => tx(w))}
            monthLabel={(date) => fmt.date(date, { month: 'short' })}
            tooltip={(c) => ({
              title: fmt.date(c.date, { weekday: 'short', day: 'numeric', month: 'short' }),
              body: min(c.minutes),
            })}
            legend={{ less: L('Less', 'Ít'), more: L('More', 'Nhiều') }}
          />
        </Card>
      </Section>
    </>
  )
}

function InsightCard({ data, offset, onChanged }: { data: CoachOverview; offset: number; onChanged: () => void }) {
  const L = useL()
  const navigate = useNavigate()
  const latestId = data.latestReport?.id ?? null
  const report = useApi('coach:report', latestId ? { id: latestId } : null, [latestId])
  const gen = useAction(() => api('coach:generateReport', { period: data.stats.period, offset, useAi: true }))
  const generate = async () => {
    const r = await gen.run()
    if (r) onChanged()
  }

  return (
    <Card className="mb-8" data-testid="coach-insight">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 font-semibold">
          <Sparkles className="size-4 text-accent" />
          {L('AI insight', 'Nhận định của AI')}
          {report.data && <SourceBadge source={report.data.source} />}
        </h3>
        <div className="flex gap-2">
          {report.data && (
            <Button size="sm" variant="ghost" onClick={() => navigate(`/coach/reports/${report.data?.id}`)}>
              {L('Full report', 'Xem báo cáo đầy đủ')}
            </Button>
          )}
          <Button
            size="sm"
            variant="primary"
            loading={gen.pending}
            onClick={() => void generate()}
            data-testid="coach-generate"
          >
            {data.aiAvailable
              ? report.data
                ? L('Re-analyse with AI', 'AI phân tích lại')
                : L('Analyse with AI', 'Phân tích bằng AI')
              : L('Analyse (offline)', 'Phân tích (offline)')}
          </Button>
        </div>
      </div>
      {gen.error && <ErrorState error={gen.error} compact />}
      {!data.aiAvailable && (
        <p className="mb-3 text-xs text-faint">
          {L(
            'No AI key configured – advice is rule-based. Add a key in AI Settings for personalised analysis.',
            'Chưa có API key AI – lời khuyên đang theo quy tắc. Thêm key trong Cài đặt AI để được phân tích cá nhân hoá.',
          )}{' '}
          <button className="text-accent underline" onClick={() => navigate('/settings/ai')}>
            {L('AI Settings', 'Cài đặt AI')}
          </button>
        </p>
      )}
      {report.loading && latestId ? (
        <LoadingBlock rows={2} />
      ) : report.error ? (
        <ErrorState error={report.error} compact onRetry={() => void report.reload()} />
      ) : report.data ? (
        <div>
          <p className="font-display text-lg font-semibold">{report.data.advice.headline}</p>
          <p className="mt-1 mb-4 text-sm text-muted">{report.data.advice.summary}</p>
          <RecommendationList items={report.data.advice.recommendations.slice(0, 3)} />
          {report.data.advice.bestStudyTimes.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-2">
              {report.data.advice.bestStudyTimes.map((t) => (
                <Badge key={t} tone="accent">
                  <Clock className="size-3" />
                  {t}
                </Badge>
              ))}
            </div>
          )}
        </div>
      ) : (
        <p className="text-sm text-muted">
          {L(
            'No analysis for this period yet. Let the AI read your habits and suggest what to do next.',
            'Chưa có phân tích cho kỳ này. Hãy để AI đọc thói quen của bạn và gợi ý bước tiếp theo.',
          )}
        </p>
      )}
    </Card>
  )
}
