// Radar (hexagon for six skills) chart: concentric level rings, a highlighted target ring and the learner's shape.
import { motion } from 'framer-motion'
import { ChartTooltip, useActiveIndex, useChartIds, useElementWidth } from './common'
import { polarPoint, radarPolygon } from './scale'

export interface RadarAxis {
  key: string
  label: string
  /** 0..1 along the axis. */
  value: number
  /** Tooltip text, e.g. "B1 · 40%". */
  detail: string
}

export interface RadarChartProps {
  axes: RadarAxis[]
  /** Labelled reference rings, `value` 0..1 from the centre (e.g. the start of each CEFR level). */
  rings: { label: string; value: number }[]
  /** Highlighted ring index (e.g. B2 target). */
  targetRing?: number
  targetLabel?: string
  title: string
  size?: number
}

export function RadarChart({ axes, rings, targetRing, targetLabel, title, size = 300 }: RadarChartProps) {
  const { titleId, descId } = useChartIds()
  const { ref, width } = useElementWidth<HTMLDivElement>(size)
  const k = width / size
  const { active, setActive, focusProps } = useActiveIndex(axes.length)
  const pad = 46
  const cx = size / 2
  const cy = size / 2
  const r = size / 2 - pad
  const n = axes.length
  const ringPolygon = (f: number) =>
    radarPolygon(
      Array.from({ length: n }, () => f),
      cx,
      cy,
      r,
    )
  const shape = radarPolygon(
    axes.map((a) => a.value),
    cx,
    cy,
    r,
  )
  const activeAxis = active !== null ? axes[active] : undefined
  const activePoint =
    active !== null && activeAxis ? polarPoint(cx, cy, r * Math.max(0.02, activeAxis.value), active, n) : null

  return (
    <div ref={ref} className="relative mx-auto w-full" style={{ maxWidth: size }}>
      <svg
        viewBox={`0 0 ${size} ${size}`}
        className="block h-auto w-full overflow-visible outline-none focus-visible:outline-2 focus-visible:outline-accent"
        role="img"
        aria-labelledby={`${titleId} ${descId}`}
        {...focusProps}
      >
        <title id={titleId}>{title}</title>
        <desc id={descId}>{axes.map((a) => `${a.label}: ${a.detail}`).join(', ')}</desc>
        {rings.map(({ label, value: f }, i) => {
          const isTarget = i === targetRing
          return (
            <g key={label}>
              <polygon
                points={ringPolygon(f)}
                fill="none"
                strokeWidth={isTarget ? 1.5 : 1}
                strokeDasharray={isTarget ? '5 4' : undefined}
                style={{ stroke: isTarget ? 'var(--warning)' : 'var(--line)' }}
              />
              <text
                x={cx + 4}
                y={cy - r * f + 3}
                fontSize={9.5}
                style={{ fill: isTarget ? 'var(--warning)' : 'var(--faint)' }}
              >
                {label}
                {isTarget && targetLabel ? ` · ${targetLabel}` : ''}
              </text>
            </g>
          )
        })}
        {axes.map((a, i) => {
          const end = polarPoint(cx, cy, r, i, n)
          const lab = polarPoint(cx, cy, r + 22, i, n)
          const anchor = Math.abs(lab.x - cx) < 4 ? 'middle' : lab.x > cx ? 'start' : 'end'
          return (
            <g key={a.key} onMouseEnter={() => setActive(i)}>
              <line x1={cx} y1={cy} x2={end.x} y2={end.y} style={{ stroke: 'var(--line)' }} />
              <text
                x={lab.x}
                y={lab.y}
                dy="0.32em"
                textAnchor={anchor}
                fontSize={12}
                fontWeight={600}
                style={{ fill: active === i ? 'var(--text)' : 'var(--muted)', cursor: 'default' }}
              >
                {a.label}
              </text>
            </g>
          )
        })}
        <motion.polygon
          points={shape}
          strokeWidth={2}
          strokeLinejoin="round"
          style={{ stroke: 'var(--accent)', fill: 'color-mix(in srgb, var(--accent) 28%, transparent)' }}
          initial={{ scale: 0, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ duration: 0.7, ease: 'easeOut' }}
        />
        {axes.map((a, i) => {
          const p = polarPoint(cx, cy, r * Math.max(0.02, a.value), i, n)
          return (
            <circle
              key={a.key}
              cx={p.x}
              cy={p.y}
              r={active === i ? 6 : 4}
              strokeWidth={2}
              style={{ fill: 'var(--surface)', stroke: 'var(--accent)' }}
              onMouseEnter={() => setActive(i)}
              onMouseLeave={() => setActive(null)}
            />
          )
        })}
      </svg>
      {activeAxis && activePoint && (
        <ChartTooltip x={activePoint.x * k} y={activePoint.y * k} width={width}>
          <div className="text-muted">{activeAxis.label}</div>
          <div className="font-semibold text-text">{activeAxis.detail}</div>
        </ChartTooltip>
      )}
    </div>
  )
}
