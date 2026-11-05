// Vertical bar chart (e.g. minutes or XP per day) with y-axis ticks, optional goal line and hover/keyboard tooltips.
import { motion } from 'framer-motion'
import { ChartEmpty, ChartTooltip, useActiveIndex, useChartIds, useElementWidth } from './common'
import { bandScale, linearScale, niceTicks, shouldShowLabel } from './scale'

export interface BarDatum {
  key: string
  label: string
  value: number
}

export interface BarChartProps {
  data: BarDatum[]
  title: string
  /** Short text summary for screen readers. */
  description?: string
  height?: number
  formatValue: (v: number) => string
  /** Axis tick labels (defaults to formatValue). */
  formatTick?: (v: number) => string
  /** Tooltip heading for a bar (defaults to its label). */
  tooltipTitle?: (d: BarDatum) => string
  emptyText: string
  goal?: { value: number; label: string }
  /** Highlight the last bar (today). */
  highlightLast?: boolean
}

const M = { top: 14, right: 8, bottom: 26, left: 40 }

export function BarChart({
  data,
  title,
  description,
  height = 200,
  formatValue,
  formatTick,
  tooltipTitle,
  emptyText,
  goal,
  highlightLast = true,
}: BarChartProps) {
  const { ref, width } = useElementWidth<HTMLDivElement>()
  const { titleId, descId } = useChartIds()
  const { active, setActive, focusProps } = useActiveIndex(data.length)
  const isEmpty = data.length === 0 || data.every((d) => !(d.value > 0))

  const innerW = Math.max(40, width - M.left - M.right)
  const innerH = Math.max(40, height - M.top - M.bottom)
  const maxVal = Math.max(...data.map((d) => d.value), goal?.value ?? 0, 0)
  const ticks = niceTicks(0, maxVal, 4)
  const top = ticks[ticks.length - 1] ?? 1
  const y = linearScale([0, top], [innerH, 0])
  const band = bandScale(data.length, innerW, data.length > 14 ? 0.3 : 0.4)
  const maxLabels = Math.max(2, Math.floor(innerW / 46))
  const activeDatum = active !== null ? data[active] : undefined

  return (
    <div ref={ref} className="relative w-full">
      {isEmpty ? (
        <ChartEmpty text={emptyText} height={height} />
      ) : (
        <>
          <svg
            width={width}
            height={height}
            role="img"
            aria-labelledby={`${titleId} ${descId}`}
            className="block overflow-visible outline-none focus-visible:outline-2 focus-visible:outline-accent"
            {...focusProps}
            onMouseMove={(e) => {
              const box = e.currentTarget.getBoundingClientRect()
              setActive(band.indexAt(e.clientX - box.left - M.left))
            }}
          >
            <title id={titleId}>{title}</title>
            <desc id={descId}>{description ?? data.map((d) => `${d.label}: ${formatValue(d.value)}`).join(', ')}</desc>
            <g transform={`translate(${M.left},${M.top})`}>
              {ticks.map((t) => (
                <g key={t} transform={`translate(0,${y(t)})`}>
                  <line
                    x1={0}
                    x2={innerW}
                    style={{ stroke: 'var(--line)' }}
                    strokeDasharray={t === 0 ? undefined : '3 4'}
                  />
                  <text x={-8} dy="0.32em" textAnchor="end" fontSize={11} style={{ fill: 'var(--faint)' }}>
                    {(formatTick ?? formatValue)(t)}
                  </text>
                </g>
              ))}
              {data.map((d, i) => {
                const h = Math.max(0, innerH - y(d.value))
                const isLast = highlightLast && i === data.length - 1
                const dim = active !== null && active !== i
                return (
                  <g key={d.key}>
                    <motion.rect
                      x={band.x(i)}
                      width={band.bandwidth}
                      rx={Math.min(6, band.bandwidth / 3)}
                      initial={{ y: innerH, height: 0 }}
                      animate={{
                        y: innerH - Math.max(h, d.value > 0 ? 2 : 0),
                        height: Math.max(h, d.value > 0 ? 2 : 0),
                      }}
                      transition={{ duration: 0.5, delay: Math.min(0.4, i * 0.015), ease: 'easeOut' }}
                      opacity={dim ? 0.45 : isLast ? 1 : 0.75}
                      style={{ fill: 'var(--accent)' }}
                    />
                    {shouldShowLabel(i, data.length, maxLabels) && (
                      <text
                        x={band.center(i)}
                        y={innerH + 17}
                        textAnchor="middle"
                        fontSize={11}
                        style={{ fill: active === i || isLast ? 'var(--text)' : 'var(--faint)' }}
                      >
                        {d.label}
                      </text>
                    )}
                  </g>
                )
              })}
              {goal && goal.value > 0 && goal.value <= top && (
                <g transform={`translate(0,${y(goal.value)})`}>
                  <line
                    x1={0}
                    x2={innerW}
                    strokeWidth={1.5}
                    strokeDasharray="6 4"
                    style={{ stroke: 'var(--warning)' }}
                  />
                  <text
                    x={innerW}
                    y={-5}
                    textAnchor="end"
                    fontSize={10.5}
                    fontWeight={600}
                    style={{ fill: 'var(--warning)' }}
                  >
                    {goal.label}
                  </text>
                </g>
              )}
            </g>
          </svg>
          {activeDatum && active !== null && (
            <ChartTooltip x={M.left + band.center(active)} y={M.top + y(activeDatum.value)} width={width}>
              <div className="text-muted">{tooltipTitle ? tooltipTitle(activeDatum) : activeDatum.label}</div>
              <div className="font-semibold text-text">{formatValue(activeDatum.value)}</div>
            </ChartTooltip>
          )}
        </>
      )}
    </div>
  )
}
