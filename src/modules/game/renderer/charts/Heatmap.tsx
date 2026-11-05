// Calendar heatmap: one column per week (Monday first), five intensity levels relative to the daily goal.
import { useState } from 'react'
import { ChartTooltip, useChartIds, useElementWidth } from './common'
import { monthStarts, type HeatCell } from './heatmapData'

export interface HeatmapProps {
  cols: HeatCell[][]
  title: string
  description: string
  /** Seven short weekday names, Monday first. */
  weekdayLabels: string[]
  monthLabel: (date: string) => string
  tooltip: (cell: HeatCell) => { title: string; body: string }
  legend: { less: string; more: string }
}

/** Fill for each intensity level – mixes the accent into the empty-cell colour. */
export const HEAT_FILLS = [
  'var(--surface-3)',
  'color-mix(in oklab, var(--accent) 30%, var(--surface-3))',
  'color-mix(in oklab, var(--accent) 55%, var(--surface-3))',
  'color-mix(in oklab, var(--accent) 80%, var(--surface-3))',
  'var(--accent-2)',
]

const LEFT = 30
const TOP = 18

export function Heatmap({ cols, title, description, weekdayLabels, monthLabel, tooltip, legend }: HeatmapProps) {
  const { ref, width } = useElementWidth<HTMLDivElement>()
  const { titleId, descId } = useChartIds()
  const [hover, setHover] = useState<{ w: number; d: number } | null>(null)
  const gap = 3
  const cell = Math.max(9, Math.min(20, Math.floor((width - LEFT) / Math.max(1, cols.length)) - gap))
  const step = cell + gap
  const gridW = cols.length * step
  const height = TOP + 7 * step
  const months = monthStarts(cols)
  const hovered = hover ? cols[hover.w]?.[hover.d] : undefined
  const tip = hovered && !hovered.future ? tooltip(hovered) : null

  return (
    <div ref={ref} className="relative w-full">
      <svg
        width={Math.max(LEFT + gridW, 0)}
        height={height}
        role="img"
        aria-labelledby={`${titleId} ${descId}`}
        className="block"
        onMouseLeave={() => setHover(null)}
      >
        <title id={titleId}>{title}</title>
        <desc id={descId}>{description}</desc>
        {months.map((m) => (
          <text key={m.date} x={LEFT + m.index * step} y={11} fontSize={10.5} style={{ fill: 'var(--faint)' }}>
            {monthLabel(m.date)}
          </text>
        ))}
        {weekdayLabels.map((label, d) =>
          d % 2 === 0 ? (
            <text
              key={label + d}
              x={LEFT - 6}
              y={TOP + d * step + cell / 2}
              dy="0.32em"
              textAnchor="end"
              fontSize={10}
              style={{ fill: 'var(--faint)' }}
            >
              {label}
            </text>
          ) : null,
        )}
        {cols.map((col, w) =>
          col.map((c, d) => (
            <rect
              key={c.date}
              x={LEFT + w * step}
              y={TOP + d * step}
              width={cell}
              height={cell}
              rx={Math.min(4, cell / 4)}
              style={{
                fill: c.future ? 'transparent' : (HEAT_FILLS[c.level] ?? HEAT_FILLS[0]),
                stroke:
                  hover && hover.w === w && hover.d === d ? 'var(--text)' : c.future ? 'var(--line)' : 'transparent',
                strokeWidth: 1.2,
              }}
              opacity={c.future ? 0.5 : 1}
              onMouseEnter={() => setHover({ w, d })}
            />
          )),
        )}
      </svg>
      {tip && hover && (
        <ChartTooltip
          x={LEFT + hover.w * step + cell / 2}
          y={TOP + hover.d * step}
          width={Math.max(width, LEFT + gridW)}
        >
          <div className="text-muted">{tip.title}</div>
          <div className="font-semibold text-text">{tip.body}</div>
        </ChartTooltip>
      )}
      <div className="mt-2 flex items-center justify-end gap-1.5 text-[11px] text-faint" aria-hidden>
        <span>{legend.less}</span>
        {HEAT_FILLS.map((f) => (
          <span key={f} className="inline-block size-3 rounded-[3px]" style={{ background: f }} />
        ))}
        <span>{legend.more}</span>
      </div>
    </div>
  )
}
