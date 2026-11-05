// Word bank statistics + 14-day review forecast (hand-drawn SVG bars).
import { Brain, CalendarDays, Flame, Layers, Repeat, Sprout, Target, TriangleAlert } from 'lucide-react'
import type { VocabStats } from '@shared/types'
import { StatTile } from '@/components/ui'
import { useFormat, useL } from '@/i18n'
import { forecastBars } from '../lib/practice'

export function StatsHeader({ stats }: { stats: VocabStats }) {
  const L = useL()
  const fmt = useFormat()
  return (
    <div className="grid gap-3 lg:grid-cols-[1fr_320px]" data-testid="vocab-stats">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatTile icon={<Layers />} label={L('Words', 'Số từ')} value={fmt.number(stats.total)} />
        <StatTile
          icon={<Target />}
          label={L('Due now', 'Đến hạn')}
          value={fmt.number(stats.dueNow)}
          sub={L(`${stats.dueToday} due today`, `${stats.dueToday} từ trong hôm nay`)}
        />
        <StatTile icon={<Sprout />} label={L('Learning', 'Đang học')} value={fmt.number(stats.learning)} />
        <StatTile
          icon={<Brain />}
          label={L('Mature', 'Nhớ lâu')}
          value={fmt.number(stats.mature)}
          sub={L('interval ≥ 21 days', 'khoảng ôn ≥ 21 ngày')}
        />
        <StatTile icon={<TriangleAlert />} label={L('Difficult', 'Khó nhớ')} value={fmt.number(stats.difficult)} />
        <StatTile
          icon={<Flame />}
          label={L('Retention', 'Tỉ lệ nhớ')}
          value={stats.total ? `${Math.round(stats.averageRetention * 100)}%` : '–'}
          sub={L('average recall chance', 'xác suất nhớ trung bình')}
        />
        <StatTile
          icon={<Repeat />}
          label={L('Reviews today', 'Lượt ôn hôm nay')}
          value={fmt.number(stats.reviewsToday)}
        />
        <StatTile
          icon={<CalendarDays />}
          label={L('Next 7 days', '7 ngày tới')}
          value={fmt.number(stats.forecast.slice(0, 7).reduce((s, f) => s + f.count, 0))}
          sub={L('cards to review', 'thẻ cần ôn')}
        />
      </div>
      <ForecastChart forecast={stats.forecast} />
    </div>
  )
}

function ForecastChart({ forecast }: { forecast: VocabStats['forecast'] }) {
  const L = useL()
  const fmt = useFormat()
  const H = 90
  const W = 280
  const days = forecast.slice(0, 14)
  const bars = forecastBars(days, H - 20)
  const gap = 4
  const bw = days.length ? (W - gap * (days.length - 1)) / days.length : 0
  const total = days.reduce((s, d) => s + d.count, 0)
  return (
    <div className="rounded-2xl border border-line bg-surface p-4">
      <div className="mb-2 flex items-center justify-between text-xs font-semibold tracking-wide text-muted uppercase">
        <span>{L('14-day forecast', 'Dự báo 14 ngày')}</span>
        <span className="font-normal normal-case">{L(`${total} reviews`, `${total} lượt ôn`)}</span>
      </div>
      {days.length ? (
        <svg
          viewBox={`0 0 ${W} ${H}`}
          className="h-28 w-full"
          role="img"
          aria-label={L('Reviews due per day for the next 14 days', 'Số thẻ đến hạn mỗi ngày trong 14 ngày tới')}
        >
          {bars.map((b, i) => {
            const x = i * (bw + gap)
            const y = H - 16 - b.h
            return (
              <g key={b.date}>
                <title>{`${fmt.date(b.date)}: ${b.count}`}</title>
                <rect
                  x={x}
                  y={y}
                  width={bw}
                  height={b.h}
                  rx={3}
                  style={{
                    fill: i === 0 ? 'var(--accent)' : 'var(--accent-2)',
                    opacity: b.count ? (i === 0 ? 1 : 0.7) : 0.25,
                  }}
                />
                {b.count > 0 && (
                  <text x={x + bw / 2} y={y - 3} textAnchor="middle" className="fill-muted" style={{ fontSize: 8 }}>
                    {b.count}
                  </text>
                )}
                {(i === 0 || i === 7 || i === days.length - 1) && (
                  <text x={x + bw / 2} y={H - 3} textAnchor="middle" className="fill-faint" style={{ fontSize: 8 }}>
                    {i === 0 ? L('Today', 'Nay') : fmt.date(b.date, { day: 'numeric', month: 'numeric' })}
                  </text>
                )}
              </g>
            )
          })}
        </svg>
      ) : (
        <p className="py-8 text-center text-sm text-muted">{L('No reviews scheduled.', 'Chưa có lịch ôn.')}</p>
      )}
    </div>
  )
}
