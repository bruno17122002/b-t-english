// Horizontal bar chart (e.g. minutes per skill): label column, proportional bars, value at the end of each bar.
import { motion } from 'framer-motion'
import { useId } from 'react'
import { AccentGradient, ChartEmpty, ChartTooltip, svgId, useActiveIndex, useChartIds, useElementWidth } from './common'
import { linearScale } from './scale'

export interface HBarDatum {
  key: string
  label: string
  value: number
  /** Extra line in the tooltip, e.g. share of total. */
  sub?: string
}

export interface HBarChartProps {
  data: HBarDatum[]
  title: string
  description?: string
  formatValue: (v: number) => string
  emptyText: string
  rowHeight?: number
  labelWidth?: number
}

export function HBarChart({
  data,
  title,
  description,
  formatValue,
  emptyText,
  rowHeight = 30,
  labelWidth = 92,
}: HBarChartProps) {
  const { ref, width } = useElementWidth<HTMLDivElement>()
  const { titleId, descId } = useChartIds()
  const gradId = svgId(useId()) + '-hbar'
  const { active, setActive, focusProps } = useActiveIndex(data.length)
  const height = Math.max(rowHeight, data.length * rowHeight)
  const isEmpty = data.length === 0 || data.every((d) => !(d.value > 0))
  const valueWidth = 64
  const barW = Math.max(30, width - labelWidth - valueWidth)
  const max = Math.max(1, ...data.map((d) => d.value))
  const x = linearScale([0, max], [0, barW])
  const barH = Math.min(14, rowHeight * 0.5)
  const activeDatum = active !== null ? data[active] : undefined

  if (isEmpty) return <ChartEmpty text={emptyText} height={Math.max(140, height)} />

  return (
    <div ref={ref} className="relative w-full">
      <svg
        width={width}
        height={height}
        role="img"
        aria-labelledby={`${titleId} ${descId}`}
        className="block overflow-visible outline-none focus-visible:outline-2 focus-visible:outline-accent"
        {...focusProps}
        onMouseMove={(e) => {
          const box = e.currentTarget.getBoundingClientRect()
          setActive(Math.max(0, Math.min(data.length - 1, Math.floor((e.clientY - box.top) / rowHeight))))
        }}
      >
        <title id={titleId}>{title}</title>
        <desc id={descId}>{description ?? data.map((d) => `${d.label}: ${formatValue(d.value)}`).join(', ')}</desc>
        <defs>
          <AccentGradient id={gradId} vertical={false} />
        </defs>
        {data.map((d, i) => {
          const cy = i * rowHeight + rowHeight / 2
          const w = d.value > 0 ? Math.max(3, x(d.value)) : 0
          return (
            <g key={d.key} opacity={active !== null && active !== i ? 0.5 : 1}>
              <text x={0} y={cy} dy="0.32em" fontSize={12.5} style={{ fill: 'var(--muted)' }}>
                {d.label}
              </text>
              <rect
                x={labelWidth}
                y={cy - barH / 2}
                width={barW}
                height={barH}
                rx={barH / 2}
                style={{ fill: 'var(--surface-3)' }}
                opacity={0.6}
              />
              <motion.rect
                x={labelWidth}
                y={cy - barH / 2}
                height={barH}
                rx={barH / 2}
                fill={`url(#${gradId})`}
                initial={{ width: 0 }}
                animate={{ width: w }}
                transition={{ duration: 0.6, delay: i * 0.05, ease: 'easeOut' }}
              />
              <text
                x={labelWidth + barW + 10}
                y={cy}
                dy="0.32em"
                fontSize={12.5}
                fontWeight={600}
                style={{ fill: 'var(--text)' }}
              >
                {formatValue(d.value)}
              </text>
            </g>
          )
        })}
      </svg>
      {activeDatum && active !== null && (
        <ChartTooltip x={labelWidth + Math.max(3, x(activeDatum.value))} y={active * rowHeight + 4} width={width}>
          <div className="text-muted">{activeDatum.label}</div>
          <div className="font-semibold text-text">{formatValue(activeDatum.value)}</div>
          {activeDatum.sub && <div className="text-faint">{activeDatum.sub}</div>}
        </ChartTooltip>
      )}
    </div>
  )
}
