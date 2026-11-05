// Statistics page: KPI tiles, 7/30-day charts, skill levels, calendar heatmap, goals and the activity feed.
import {
  BarChart3,
  BookOpen,
  CalendarCheck,
  Clapperboard,
  Clock,
  Feather,
  Headphones,
  Layers,
  Leaf,
  Mic,
  Sparkles,
  Swords,
} from 'lucide-react'
import { useMemo, useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { addDays, localDateKey } from '@core/dates'
import { SKILLS, type StatsOverview } from '@shared/types'
import { Button, Card, ErrorState, PageHeader, Section, Skeleton, StatTile, Tabs } from '@/components/ui'
import { useFormat, useL, useTx } from '@/i18n'
import { useApi } from '@/lib/api'
import { useApp } from '@/lib/store'
import { BarChart, HBarChart, Heatmap, LineChart } from '../charts'
import { buildHeatmapWeeks, heatmapRange, heatmapSummary } from '../charts/heatmapData'
import { toPercentSeries } from '../charts/scale'
import { ActivityFeed } from '../components/stats/ActivityFeed'
import { GoalsPanel } from '../components/stats/GoalsPanel'
import { SkillLevelsPanel } from '../components/stats/SkillLevelsPanel'
import { GameMotion } from '../components/GameMotion'
import { SKILL_LABELS } from '../lib/meta'

type Range = '7' | '30'
const HEATMAP_WEEKS = 20

function ChartCard({ title, subtitle, children }: { title: string; subtitle?: ReactNode; children: ReactNode }) {
  return (
    <Card className="min-w-0">
      <div className="mb-3 flex items-baseline justify-between gap-2">
        <h3 className="font-display text-base font-semibold">{title}</h3>
        {subtitle && <span className="text-xs text-muted">{subtitle}</span>}
      </div>
      {children}
    </Card>
  )
}

function Kpis({ stats }: { stats: StatsOverview }) {
  const L = useL()
  const fmt = useFormat()
  const t = stats.totals
  const hours = t.minutes / 60
  const tiles: { label: string; value: string; sub?: string; icon: ReactNode; id: string }[] = [
    {
      id: 'xp',
      label: L('Total XP', 'Tổng XP'),
      value: fmt.number(t.xp),
      icon: <Sparkles />,
      sub: L(`+${fmt.number(stats.today.xp)} today`, `+${fmt.number(stats.today.xp)} hôm nay`),
    },
    {
      id: 'time',
      label: L('Study time', 'Thời gian học'),
      value: hours >= 1 ? `${fmt.number(hours, 1)} ${L('h', 'giờ')}` : `${fmt.number(t.minutes)} ${L('min', 'phút')}`,
      icon: <Clock />,
      sub: L(`${fmt.number(stats.today.minutes)} min today`, `${fmt.number(stats.today.minutes)} phút hôm nay`),
    },
    { id: 'days', label: L('Active days', 'Ngày đã học'), value: fmt.number(t.activeDays), icon: <CalendarCheck /> },
    { id: 'words', label: L('Words saved', 'Từ đã lưu'), value: fmt.number(t.words), icon: <Leaf /> },
    { id: 'reviews', label: L('Reviews', 'Lượt ôn'), value: fmt.number(t.reviews), icon: <Layers /> },
    { id: 'listening', label: L('Listening', 'Bài nghe'), value: fmt.number(t.listening), icon: <Headphones /> },
    { id: 'reading', label: L('Reading', 'Bài đọc'), value: fmt.number(t.reading), icon: <BookOpen /> },
    { id: 'writing', label: L('Writing', 'Bài viết'), value: fmt.number(t.writing), icon: <Feather /> },
    {
      id: 'speaking',
      label: L('Speaking', 'Luyện nói'),
      value: `${fmt.number(t.speakingMinutes)} ${L('min', 'phút')}`,
      icon: <Mic />,
    },
    {
      id: 'cinema',
      label: L('Cinema', 'Điện ảnh'),
      value: fmt.number(t.cinemaScenes),
      icon: <Clapperboard />,
      sub: L(`${fmt.number(t.storiesCompleted)} stories finished`, `${fmt.number(t.storiesCompleted)} phim đã xem hết`),
    },
  ]
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5" data-testid="stats-kpis">
      {tiles.map((k) => (
        <div key={k.id} data-testid={`kpi-${k.id}`}>
          <StatTile label={k.label} value={k.value} sub={k.sub} icon={k.icon} />
        </div>
      ))}
    </div>
  )
}

function HeatmapCard({ reloadKey }: { reloadKey: number }) {
  const L = useL()
  const fmt = useFormat()
  const dailyMinutes = useApp((s) => s.profile?.dailyMinutes ?? 20)
  const today = localDateKey()
  const range = heatmapRange(today, HEATMAP_WEEKS)
  const cal = useApi('progress:calendar', range, [range.from, range.to, reloadKey])
  const cols = useMemo(
    () => buildHeatmapWeeks(today, HEATMAP_WEEKS, cal.data ?? [], dailyMinutes),
    [today, cal.data, dailyMinutes],
  )
  const summary = heatmapSummary(cols)
  // Monday-first short weekday names in the UI language (2026-11-02 is a Monday).
  const weekdays = Array.from({ length: 7 }, (_, i) => fmt.date(addDays('2026-11-02', i), { weekday: 'short' }))

  return (
    <ChartCard
      title={L('Study calendar', 'Lịch học')}
      subtitle={L(
        `${summary.activeDays} active days · ${fmt.number(summary.minutes)} min in ${HEATMAP_WEEKS} weeks`,
        `${summary.activeDays} ngày học · ${fmt.number(summary.minutes)} phút trong ${HEATMAP_WEEKS} tuần`,
      )}
    >
      {cal.error && !cal.data ? (
        <ErrorState error={cal.error} onRetry={() => void cal.reload()} compact />
      ) : !cal.data ? (
        <Skeleton className="h-40" />
      ) : (
        <div data-testid="stats-heatmap">
          <Heatmap
            cols={cols}
            title={L(`Study calendar, last ${HEATMAP_WEEKS} weeks`, `Lịch học ${HEATMAP_WEEKS} tuần gần đây`)}
            description={L(
              `${summary.activeDays} active days, ${summary.minutes} minutes in total.`,
              `${summary.activeDays} ngày học, tổng ${summary.minutes} phút.`,
            )}
            weekdayLabels={weekdays}
            monthLabel={(d) => fmt.date(d, { month: 'short' })}
            tooltip={(c) => ({
              title: fmt.date(c.date, { weekday: 'short', day: 'numeric', month: 'short' }),
              body:
                c.minutes > 0 || c.xp > 0
                  ? L(
                      `${fmt.number(c.minutes)} min · ${fmt.number(c.xp)} XP`,
                      `${fmt.number(c.minutes)} phút · ${fmt.number(c.xp)} XP`,
                    )
                  : L('No study', 'Không học'),
            })}
            legend={{ less: L('Less', 'Ít'), more: L('More', 'Nhiều') }}
          />
          {summary.minutes === 0 && (
            <p className="mt-2 text-xs text-muted">
              {L(
                'Your calendar fills up as you study – one square per day.',
                'Lịch sẽ được tô màu khi bạn học – mỗi ô là một ngày.',
              )}
            </p>
          )}
        </div>
      )}
    </ChartCard>
  )
}

export default function StatsPage() {
  const L = useL()
  const tx = useTx()
  const fmt = useFormat()
  const navigate = useNavigate()
  const [range, setRange] = useState<Range>('7')
  const xpTick = useApp((s) => s.game?.totalXp ?? 0)
  const dailyMinutes = useApp((s) => s.profile?.dailyMinutes ?? 0)
  const dailyGoalXp = useApp((s) => s.settings?.dailyGoalXp ?? 0)
  const stats = useApi('progress:stats', undefined, [xpTick])
  const s = stats.data

  const days = s ? (range === '7' ? s.last7 : s.last30) : []
  const dayLabel = (d: string) =>
    range === '7' ? fmt.date(d, { weekday: 'short' }) : fmt.date(d, { day: 'numeric', month: 'numeric' })
  const fullDate = (d: string) => fmt.date(d, { weekday: 'long', day: 'numeric', month: 'long' })
  const periodMinutes = days.reduce((a, d) => a + d.minutes, 0)
  const periodXp = days.reduce((a, d) => a + d.xp, 0)
  const activeInPeriod = days.filter((d) => d.minutes > 0 || d.xp > 0).length
  const minLabel = L('min', 'phút')

  const skillTotal = s ? SKILLS.reduce((a, k) => a + (s.skillMinutes[k] ?? 0), 0) : 0
  const accuracy = s ? toPercentSeries(s.listeningAccuracy.map((p) => p.accuracy)) : []

  return (
    <GameMotion>
      <div data-testid="page-stats">
        <PageHeader
          icon={<BarChart3 />}
          title={L('Statistics', 'Thống kê')}
          subtitle={L(
            'How your English is growing – time, XP, skills and habits.',
            'Tiếng Anh của bạn tiến bộ ra sao – thời gian, XP, kỹ năng và thói quen.',
          )}
          actions={
            <Button variant="secondary" icon={<Swords className="size-4" />} onClick={() => navigate('/game')}>
              {L('Adventure', 'Phiêu lưu')}
            </Button>
          }
        />

        {stats.error && !s ? (
          <ErrorState error={stats.error} onRetry={() => void stats.reload()} />
        ) : !s ? (
          <div className="space-y-4" aria-busy="true">
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
              {Array.from({ length: 5 }, (_, i) => (
                <Skeleton key={i} className="h-24" />
              ))}
            </div>
            <Skeleton className="h-64" />
          </div>
        ) : (
          <>
            <Section title={L('Overview', 'Tổng quan')}>
              <Kpis stats={s} />
            </Section>

            <Section
              title={L('Activity', 'Hoạt động')}
              actions={
                <Tabs
                  value={range}
                  onChange={setRange}
                  items={[
                    { value: '7', label: L('7 days', '7 ngày') },
                    { value: '30', label: L('30 days', '30 ngày') },
                  ]}
                />
              }
            >
              <p className="-mt-1 mb-3 text-sm text-muted" data-testid="stats-period-summary">
                {L(
                  `${fmt.number(periodMinutes)} min · ${fmt.number(periodXp)} XP · ${activeInPeriod}/${days.length} active days · avg ${fmt.number(periodMinutes / Math.max(1, days.length), 1)} min/day`,
                  `${fmt.number(periodMinutes)} phút · ${fmt.number(periodXp)} XP · ${activeInPeriod}/${days.length} ngày có học · trung bình ${fmt.number(periodMinutes / Math.max(1, days.length), 1)} phút/ngày`,
                )}
              </p>
              <div className="grid gap-4 lg:grid-cols-2">
                <ChartCard title={L('Minutes per day', 'Số phút mỗi ngày')}>
                  <BarChart
                    data={days.map((d) => ({ key: d.date, label: dayLabel(d.date), value: d.minutes }))}
                    title={L('Minutes studied per day', 'Số phút học mỗi ngày')}
                    formatValue={(v) => `${fmt.number(v, 1)} ${minLabel}`}
                    formatTick={(v) => fmt.number(v)}
                    tooltipTitle={(d) => fullDate(d.key)}
                    emptyText={L('No study time in this period yet.', 'Chưa có thời gian học trong khoảng này.')}
                    goal={
                      dailyMinutes > 0
                        ? { value: dailyMinutes, label: L(`Goal ${dailyMinutes} min`, `Mục tiêu ${dailyMinutes} phút`) }
                        : undefined
                    }
                  />
                </ChartCard>
                <ChartCard title={L('XP per day', 'XP mỗi ngày')}>
                  <BarChart
                    data={days.map((d) => ({ key: d.date, label: dayLabel(d.date), value: d.xp }))}
                    title={L('XP earned per day', 'XP nhận được mỗi ngày')}
                    formatValue={(v) => `${fmt.number(v)} XP`}
                    formatTick={(v) => fmt.number(v)}
                    tooltipTitle={(d) => fullDate(d.key)}
                    emptyText={L('No XP earned in this period yet.', 'Chưa nhận XP trong khoảng này.')}
                    goal={
                      dailyGoalXp > 0
                        ? { value: dailyGoalXp, label: L(`Goal ${dailyGoalXp} XP`, `Mục tiêu ${dailyGoalXp} XP`) }
                        : undefined
                    }
                  />
                </ChartCard>
              </div>
            </Section>

            <Section title={L('Skills', 'Kỹ năng')}>
              <div className="space-y-4">
                <SkillLevelsPanel levels={s.skillLevels} />
                <ChartCard
                  title={L('Time per skill', 'Thời gian theo kỹ năng')}
                  subtitle={L(`${fmt.number(skillTotal)} min in total`, `Tổng ${fmt.number(skillTotal)} phút`)}
                >
                  <HBarChart
                    data={SKILLS.map((k) => ({
                      key: k,
                      label: tx(SKILL_LABELS[k]),
                      value: s.skillMinutes[k] ?? 0,
                      sub: skillTotal > 0 ? `${fmt.number(((s.skillMinutes[k] ?? 0) / skillTotal) * 100)}%` : undefined,
                    })).sort((a, b) => b.value - a.value)}
                    title={L('Minutes studied per skill', 'Số phút học theo kỹ năng')}
                    formatValue={(v) => `${fmt.number(v)} ${minLabel}`}
                    emptyText={L(
                      'Study any skill to see where your time goes.',
                      'Học bất kỳ kỹ năng nào để xem thời gian của bạn phân bổ ra sao.',
                    )}
                  />
                </ChartCard>
              </div>
            </Section>

            <Section title={L('Performance trends', 'Xu hướng kết quả')}>
              <div className="grid gap-4 lg:grid-cols-3">
                <ChartCard title={L('Reading speed', 'Tốc độ đọc')} subtitle={L('words / min', 'từ / phút')}>
                  <LineChart
                    data={s.readingWpm.map((p, i) => ({
                      key: `${p.date}-${i}`,
                      label: fmt.date(p.date),
                      value: p.wpm,
                    }))}
                    title={L('Reading speed over time (words per minute)', 'Tốc độ đọc theo thời gian (từ/phút)')}
                    formatValue={(v) => `${fmt.number(v)} ${L('wpm', 'từ/phút')}`}
                    formatTick={(v) => fmt.number(v)}
                    tooltipTitle={(d) => fullDate(d.key.slice(0, 10))}
                    emptyText={L('Finish a reading to start this chart.', 'Đọc xong một bài để bắt đầu biểu đồ này.')}
                  />
                </ChartCard>
                <ChartCard title={L('Listening accuracy', 'Độ chính xác khi nghe')} subtitle="%">
                  <LineChart
                    data={s.listeningAccuracy.map((p, i) => ({
                      key: `${p.date}-${i}`,
                      label: fmt.date(p.date),
                      value: accuracy[i] ?? 0,
                    }))}
                    title={L('Listening accuracy over time (percent)', 'Độ chính xác khi nghe theo thời gian (%)')}
                    domain={[0, 100]}
                    formatValue={(v) => `${fmt.number(v)}%`}
                    tooltipTitle={(d) => fullDate(d.key.slice(0, 10))}
                    emptyText={L(
                      'Finish a listening exercise to start this chart.',
                      'Hoàn thành một bài nghe để bắt đầu biểu đồ này.',
                    )}
                  />
                </ChartCard>
                <ChartCard
                  title={L('Writing scores', 'Điểm bài viết')}
                  subtitle={L('AI estimate, 0–10', 'AI ước lượng, 0–10')}
                >
                  <LineChart
                    data={s.writingScores.map((p, i) => ({
                      key: `${p.date}-${i}`,
                      label: fmt.date(p.date),
                      value: p.score,
                    }))}
                    title={L('Writing scores over time (0 to 10)', 'Điểm bài viết theo thời gian (0–10)')}
                    domain={[0, 10]}
                    formatValue={(v) => fmt.number(v, 1)}
                    tooltipTitle={(d) => fullDate(d.key.slice(0, 10))}
                    emptyText={L(
                      'Submit writing with feedback to start this chart.',
                      'Nộp bài viết có nhận xét để bắt đầu biểu đồ này.',
                    )}
                  />
                </ChartCard>
              </div>
            </Section>
          </>
        )}

        <Section title={L('Habits', 'Thói quen')}>
          <HeatmapCard reloadKey={xpTick} />
        </Section>

        <Section title={L('Goals', 'Mục tiêu')}>
          <GoalsPanel reloadKey={xpTick} />
        </Section>

        <Section title={L('Recent activity', 'Hoạt động gần đây')}>
          <ActivityFeed reloadKey={xpTick} />
        </Section>
      </div>
    </GameMotion>
  )
}
