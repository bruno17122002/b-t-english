// Pure chart maths shared by the SVG chart components: nice ticks, linear/band scales and path builders.
// No React or DOM here so it can be unit-tested in Node.

export interface Point {
  x: number
  y: number
}

/** A "nice" step (1, 2, 2.5, 5 × 10^n) that splits `range` into roughly `targetTicks` intervals. */
export function niceStep(range: number, targetTicks = 4): number {
  if (!Number.isFinite(range) || range <= 0) return 1
  const raw = range / Math.max(1, targetTicks)
  const mag = Math.pow(10, Math.floor(Math.log10(raw)))
  const norm = raw / mag
  const nice = norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 2.5 ? 2.5 : norm <= 5 ? 5 : 10
  return nice * mag
}

/** Rounds floating point noise (0.30000000000000004 → 0.3). */
const clean = (n: number) => Math.round(n * 1e9) / 1e9

/**
 * Ticks covering [min, max] on nice boundaries. The domain always includes `min`/`max`;
 * an empty or flat domain still yields at least two ticks so axes render.
 */
export function niceTicks(min: number, max: number, targetTicks = 4): number[] {
  let lo = Number.isFinite(min) ? min : 0
  let hi = Number.isFinite(max) ? max : 0
  if (lo > hi) [lo, hi] = [hi, lo]
  if (lo === hi) {
    if (hi === 0) hi = 1
    else if (lo > 0) lo = 0
    else hi = 0
  }
  const step = niceStep(hi - lo, targetTicks)
  const start = Math.floor(clean(lo / step)) * step
  const end = Math.ceil(clean(hi / step)) * step
  const ticks: number[] = []
  for (let v = start; v <= end + step / 2; v += step) ticks.push(clean(v))
  return ticks
}

/** Domain [first tick, last tick] for the given data. */
export function niceDomain(min: number, max: number, targetTicks = 4): [number, number] {
  const t = niceTicks(min, max, targetTicks)
  return [t[0] ?? 0, t[t.length - 1] ?? 1]
}

/** Linear scale mapping a domain to a range. A zero-width domain maps everything to the range midpoint. */
export function linearScale(domain: [number, number], range: [number, number]): (v: number) => number {
  const [d0, d1] = domain
  const [r0, r1] = range
  if (d1 === d0) return () => (r0 + r1) / 2
  const k = (r1 - r0) / (d1 - d0)
  return (v: number) => r0 + (v - d0) * k
}

/** Evenly spaced bands (bar charts). `padding` is the fraction of each step left empty (0..0.9). */
export function bandScale(count: number, width: number, padding = 0.25) {
  const n = Math.max(1, count)
  const step = width / n
  const pad = Math.min(0.9, Math.max(0, padding))
  const bandwidth = step * (1 - pad)
  return {
    step,
    bandwidth,
    /** Left edge of band i. */
    x: (i: number) => i * step + (step - bandwidth) / 2,
    /** Centre of band i. */
    center: (i: number) => i * step + step / 2,
    /** Index under a horizontal coordinate (clamped). */
    indexAt: (px: number) => Math.max(0, Math.min(n - 1, Math.floor(px / step))),
  }
}

/** Show at most `maxLabels` evenly spread labels; returns true when label i should be drawn. */
export function shouldShowLabel(i: number, count: number, maxLabels: number): boolean {
  if (count <= maxLabels) return true
  const every = Math.ceil(count / Math.max(1, maxLabels))
  // Always label the last point (today) and step backwards from it so the newest data is labelled.
  return (count - 1 - i) % every === 0
}

/** Straight polyline path. */
export function linePath(points: Point[]): string {
  return points.map((p, i) => `${i === 0 ? 'M' : 'L'}${round(p.x)} ${round(p.y)}`).join(' ')
}

/** Closed area under a polyline down to `baseline`. */
export function areaPath(points: Point[], baseline: number): string {
  return closeArea(linePath(points), points, baseline)
}

/** Closes any line path (straight or smooth) through `points` down to `baseline`. */
export function closeArea(line: string, points: Point[], baseline: number): string {
  if (!points.length) return ''
  const first = points[0] as Point
  const last = points[points.length - 1] as Point
  return `${line} L${round(last.x)} ${round(baseline)} L${round(first.x)} ${round(baseline)} Z`
}

/**
 * Smooth curve through all points (Catmull-Rom converted to cubic Béziers).
 * `tension` 0 = straight lines, 0.5 ≈ natural curve.
 */
export function smoothPath(points: Point[], tension = 0.5): string {
  if (points.length < 3) return linePath(points)
  let d = `M${round((points[0] as Point).x)} ${round((points[0] as Point).y)}`
  for (let i = 0; i < points.length - 1; i++) d += ' ' + curveSegment(points, i, tension)
  return d
}

/** Cubic Bézier command ("C…") for the segment points[i] → points[i + 1] of a Catmull-Rom curve. */
export function curveSegment(points: Point[], i: number, tension = 0.5): string {
  const t = tension / 3
  const p1 = points[i] as Point
  const p2 = (points[i + 1] ?? p1) as Point
  const p0 = points[i - 1] ?? p1
  const p3 = points[i + 2] ?? p2
  const c1 = { x: p1.x + (p2.x - p0.x) * t, y: p1.y + (p2.y - p0.y) * t }
  const c2 = { x: p2.x - (p3.x - p1.x) * t, y: p2.y - (p3.y - p1.y) * t }
  return `C${round(c1.x)} ${round(c1.y)} ${round(c2.x)} ${round(c2.y)} ${round(p2.x)} ${round(p2.y)}`
}

/** Point on a circle for radar charts; index 0 points straight up, going clockwise. */
export function polarPoint(cx: number, cy: number, r: number, index: number, total: number): Point {
  const angle = -Math.PI / 2 + (2 * Math.PI * index) / Math.max(1, total)
  return { x: round(cx + r * Math.cos(angle)), y: round(cy + r * Math.sin(angle)) }
}

/** Polygon points attribute for values in 0..1 around a centre. */
export function radarPolygon(values: number[], cx: number, cy: number, r: number): string {
  return values
    .map((v, i) => {
      const p = polarPoint(cx, cy, r * Math.max(0, Math.min(1, v)), i, values.length)
      return `${p.x},${p.y}`
    })
    .join(' ')
}

/** SVG arc path (used for progress rings drawn inside a larger SVG). Fraction 0..1, starts at 12 o'clock. */
export function arcPath(cx: number, cy: number, r: number, fraction: number): string {
  const f = Math.max(0, Math.min(0.9999, fraction))
  if (f <= 0) return ''
  const start = { x: cx, y: cy - r }
  const angle = -Math.PI / 2 + 2 * Math.PI * f
  const end = { x: cx + r * Math.cos(angle), y: cy + r * Math.sin(angle) }
  const large = f > 0.5 ? 1 : 0
  return `M${round(start.x)} ${round(start.y)} A${r} ${r} 0 ${large} 1 ${round(end.x)} ${round(end.y)}`
}

/** Values stored as 0..1 fractions are shown as percentages; values already in 0..100 are kept. */
export function toPercentSeries(values: number[]): number[] {
  const max = values.reduce((m, v) => Math.max(m, v), 0)
  return max <= 1 ? values.map((v) => Math.round(v * 1000) / 10) : values
}

const round = (n: number) => Math.round(n * 100) / 100
