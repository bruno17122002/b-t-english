// Single-series line chart with area fill, nice y ticks, optional target line and hover/keyboard tooltips.
import { motion } from 'framer-motion'
import { useId } from 'react'
import { AccentGradient, ChartEmpty, ChartTooltip, svgId, useActiveIndex, useChartIds, useElementWidth } from './common'
import { closeArea, linearScale, linePath, niceTicks, shouldShowLabel, smoothPath, type Point } from './scale'

export interface LineDatum {
  key: string
  label: string
  value: number
}

export interface LineChartProps {
  data: LineDatum[]
  title: string
  description?: string
  height?: number
  formatValue: (v: number) => string
  formatTick?: (v: number) => string
  tooltipTitle?: (d: LineDatum) => string
  emptyText: string
  /** Fixed y domain (e.g. [0, 100] for percentages); otherwise computed from the data. */
  domain?: [number, number]
  target?: { value: number; label: string }
  /** Points needed before a line is drawn (a single point is still shown as a dot). */
  minPoints?: number
}

const M = { top: 16, right: 14, bottom: 26, left: 40 }

export function LineChart({
  data,
  title,
  description,
  height = 180,
  formatValue,
  formatTick,
  tooltipTitle,
  emptyText,
  domain,
  target,
  minPoints = 1,
}: LineChartProps) {
  const { ref, width } = useElementWidth<HTMLDivElement>()
  const { titleId, descId } = useChartIds()
  const baseId = svgId(useId())
  const { active, setActive, focusProps } = useActiveIndex(data.length)
  const isEmpty = data.length < minPoints || data.length === 0

  const innerW = Math.max(40, width - M.left - M.right)
  const innerH = Math.max(40, height - M.top - M.bottom)
  const values = data.map((d) => d.value)
  const lo = domain ? domain[0] : Math.min(...values, target?.value ?? Infinity)
  const hi = domain ? domain[1] : Math.max(...values, target?.value ?? -Infinity)
  const ticks = domain ? niceTicks(domain[0], domain[1], 4) : niceTicks(Math.min(0, lo), hi, 4)
  const d0 = ticks[0] ?? 0
  const d1 = ticks[ticks.length - 1] ?? 1
  const y = linearScale([d0, d1], [innerH, 0])
  const x = (i: number) => (data.length <= 1 ? innerW / 2 : (i / (data.length - 1)) * innerW)
  const points: Point[] = data.map((d, i) => ({ x: x(i), y: y(d.value) }))
  const line = points.length > 2 ? smoothPath(points, 0.35) : linePath(points)
  const maxLabels = Math.max(2, Math.floor(innerW / 64))
  const activeDatum = active !== null ? data[active] : undefined
  const activePoint = active !== null ? points[active] : undefined

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
              const px = e.clientX - box.left - M.left
              const i = data.length <= 1 ? 0 : Math.round((px / innerW) * (data.length - 1))
              setActive(Math.max(0, Math.min(data.length - 1, i)))
            }}
          >
            <title id={titleId}>{title}</title>
            <desc id={descId}>{description ?? data.map((d) => `${d.label}: ${formatValue(d.value)}`).join(', ')}</desc>
            <defs>
              <AccentGradient id={`${baseId}-stroke`} vertical={false} />
              <linearGradient id={`${baseId}-area`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0" style={{ stopColor: 'var(--accent)', stopOpacity: 0.28 }} />
                <stop offset="1" style={{ stopColor: 'var(--accent)', stopOpacity: 0 }} />
              </linearGradient>
            </defs>
            <g transform={`translate(${M.left},${M.top})`}>
              {ticks.map((t) => (
                <g key={t} transform={`translate(0,${y(t)})`}>
                  <line
                    x1={0}
                    x2={innerW}
                    style={{ stroke: 'var(--line)' }}
                    strokeDasharray={t === d0 ? undefined : '3 4'}
                  />
                  <text x={-8} dy="0.32em" textAnchor="end" fontSize={11} style={{ fill: 'var(--faint)' }}>
                    {(formatTick ?? formatValue)(t)}
                  </text>
                </g>
              ))}
              {target && target.value >= d0 && target.value <= d1 && (
                <g transform={`translate(0,${y(target.value)})`}>
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
                    {target.label}
                  </text>
                </g>
              )}
              {points.length > 1 && (
                <>
                  <path d={closeArea(line, points, innerH)} fill={`url(#${baseId}-area)`} />
                  <motion.path
                    d={line}
                    fill="none"
                    stroke={`url(#${baseId}-stroke)`}
                    strokeWidth={2.5}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    initial={{ pathLength: 0 }}
                    animate={{ pathLength: 1 }}
                    transition={{ duration: 0.9, ease: 'easeOut' }}
                  />
                </>
              )}
              {points.map((p, i) => (
                <circle
                  key={(data[i] as LineDatum).key}
                  cx={p.x}
                  cy={p.y}
                  r={active === i ? 5 : data.length > 20 ? 0 : 3}
                  strokeWidth={2}
                  style={{ fill: 'var(--surface)', stroke: 'var(--accent)' }}
                />
              ))}
              {activePoint && (
                <line
                  x1={activePoint.x}
                  x2={activePoint.x}
                  y1={0}
                  y2={innerH}
                  style={{ stroke: 'var(--line-strong)' }}
                />
              )}
              {data.map((d, i) =>
                shouldShowLabel(i, data.length, maxLabels) ? (
                  <text
                    key={d.key}
                    x={x(i)}
                    y={innerH + 17}
                    textAnchor={
                      data.length > 1 && i === 0 ? 'start' : data.length > 1 && i === data.length - 1 ? 'end' : 'middle'
                    }
                    fontSize={11}
                    style={{ fill: active === i ? 'var(--text)' : 'var(--faint)' }}
                  >
                    {d.label}
                  </text>
                ) : null,
              )}
            </g>
          </svg>
          {activeDatum && activePoint && (
            <ChartTooltip x={M.left + activePoint.x} y={M.top + activePoint.y} width={width}>
              <div className="text-muted">{tooltipTitle ? tooltipTitle(activeDatum) : activeDatum.label}</div>
              <div className="font-semibold text-text">{formatValue(activeDatum.value)}</div>
            </ChartTooltip>
          )}
        </>
      )}
    </div>
  )
}
