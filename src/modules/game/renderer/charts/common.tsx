// Shared building blocks for the hand-drawn SVG charts: responsive width, tooltip, empty state, keyboard focus.
import { BarChart3 } from 'lucide-react'
import { useCallback, useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'

/** Measures an element's width with ResizeObserver so charts draw at real pixel size (crisp text). */
export function useElementWidth<T extends HTMLElement>(fallback = 560) {
  const ref = useRef<T | null>(null)
  const [width, setWidth] = useState(fallback)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const update = () => {
      const w = Math.round(el.getBoundingClientRect().width)
      if (w > 0) setWidth(w)
    }
    update()
    if (typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(update)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  return { ref, width }
}

/** Index-based hover/focus state with arrow-key navigation for charts. */
export function useActiveIndex(count: number) {
  const [active, setActive] = useState<number | null>(null)
  const onKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (!count) return
      if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
        e.preventDefault()
        setActive((a) => (a === null ? 0 : Math.min(count - 1, a + 1)))
      } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
        e.preventDefault()
        setActive((a) => (a === null ? count - 1 : Math.max(0, a - 1)))
      } else if (e.key === 'Home') setActive(0)
      else if (e.key === 'End') setActive(count - 1)
      else if (e.key === 'Escape') setActive(null)
    },
    [count],
  )
  return {
    active,
    setActive,
    focusProps: {
      tabIndex: count ? 0 : -1,
      onKeyDown,
      onBlur: () => setActive(null),
      onMouseLeave: () => setActive(null),
    },
  }
}

/** Ids for <title>/<desc> so screen readers announce the chart. */
export function useChartIds() {
  const id = useId()
  return { titleId: `${id}-t`, descId: `${id}-d` }
}

/** Tooltip positioned over the chart; `x` in px from the left of the wrapper, `y` in px from the top. */
export function ChartTooltip({ x, y, width, children }: { x: number; y: number; width: number; children: ReactNode }) {
  // Keep the tooltip inside the chart horizontally.
  const left = Math.max(70, Math.min(width - 70, x))
  return (
    <div
      role="status"
      className="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-full rounded-lg border border-line-strong bg-surface-2/95 px-2.5 py-1.5 text-xs whitespace-nowrap shadow-card backdrop-blur"
      style={{ left, top: Math.max(0, y - 8) }}
    >
      {children}
    </div>
  )
}

export function ChartEmpty({ text, height }: { text: ReactNode; height: number }) {
  return (
    <div
      className="flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-line text-center text-sm text-muted"
      style={{ height }}
    >
      <BarChart3 className="size-6 text-faint" aria-hidden />
      <span className="max-w-xs px-4">{text}</span>
    </div>
  )
}

/** Gradient definitions used by several charts (accent → accent-2). */
export function AccentGradient({
  id,
  vertical = true,
  opacity = [1, 1],
}: {
  id: string
  vertical?: boolean
  opacity?: [number, number]
}) {
  return (
    <linearGradient id={id} x1="0" y1={vertical ? '1' : '0'} x2={vertical ? '0' : '1'} y2="0">
      <stop offset="0" style={{ stopColor: 'var(--accent)', stopOpacity: opacity[0] }} />
      <stop offset="1" style={{ stopColor: 'var(--accent-2)', stopOpacity: opacity[1] }} />
    </linearGradient>
  )
}

/** Valid SVG id from React's useId output (which contains colons). */
export const svgId = (id: string) => id.replace(/[^a-zA-Z0-9_-]/g, '')
