// Weekly minutes mini-chart (hand-drawn SVG, no chart library).
import { motion } from 'framer-motion'
import type { DailyStat } from '@shared/types'
import { useFormat, useL } from '@/i18n'

export function WeeklyChart({ days, goal }: { days: DailyStat[]; goal: number }) {
  const L = useL()
  const fmt = useFormat()
  const W = 280
  const H = 120
  const pad = { top: 14, bottom: 22, left: 4, right: 4 }
  const max = Math.max(goal, ...days.map((d) => d.minutes), 10)
  const innerH = H - pad.top - pad.bottom
  const slot = (W - pad.left - pad.right) / Math.max(1, days.length)
  const barW = Math.min(26, slot * 0.56)
  const y = (v: number) => pad.top + innerH - (v / max) * innerH
  const total = Math.round(days.reduce((n, d) => n + d.minutes, 0))
  const hit = days.filter((d) => d.minutes >= goal).length
  return (
    <div>
      <div className="mb-2 flex items-baseline justify-between">
        <div className="font-display text-2xl font-semibold tabular-nums">
          {fmt.number(total)}{' '}
          <span className="text-sm font-normal text-muted">{L('min this week', 'phút tuần này')}</span>
        </div>
        <div className="text-xs text-faint">{L(`${hit}/7 days on goal`, `${hit}/7 ngày đạt mục tiêu`)}</div>
      </div>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="w-full"
        role="img"
        aria-label={L('Minutes studied in the last 7 days', 'Số phút học 7 ngày qua')}
      >
        <line
          x1={pad.left}
          x2={W - pad.right}
          y1={y(goal)}
          y2={y(goal)}
          className="stroke-accent/50"
          strokeDasharray="4 4"
          strokeWidth={1}
        />
        <text x={W - pad.right} y={y(goal) - 4} textAnchor="end" className="fill-faint text-[9px]">
          {L(`goal ${goal}m`, `mục tiêu ${goal}p`)}
        </text>
        {days.map((d, i) => {
          const x = pad.left + slot * i + (slot - barW) / 2
          const h = Math.max(2, (d.minutes / max) * innerH)
          const isToday = i === days.length - 1
          const reached = d.minutes >= goal
          return (
            <g key={d.date}>
              <title>{`${fmt.date(d.date, { weekday: 'short', day: 'numeric', month: 'short' })}: ${Math.round(d.minutes)} ${L('min', 'phút')}`}</title>
              <rect x={x} y={pad.top} width={barW} height={innerH} rx={6} className="fill-surface-3/60" />
              <motion.rect
                x={x}
                width={barW}
                rx={6}
                initial={{ y: pad.top + innerH, height: 0 }}
                animate={{ y: pad.top + innerH - h, height: h }}
                transition={{ duration: 0.6, delay: i * 0.04, ease: 'easeOut' }}
                style={{ fill: reached ? 'var(--accent)' : 'color-mix(in oklab, var(--accent) 45%, transparent)' }}
              />
              <text
                x={x + barW / 2}
                y={H - 6}
                textAnchor="middle"
                className={isToday ? 'fill-text text-[10px] font-bold' : 'fill-faint text-[10px]'}
              >
                {fmt.date(d.date, { weekday: 'narrow' })}
              </text>
            </g>
          )
        })}
      </svg>
    </div>
  )
}
