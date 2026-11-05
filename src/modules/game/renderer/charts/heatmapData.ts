// Pure helpers for the activity calendar heatmap: date range, week bucketing (Monday-first) and intensity levels.
import { addDays, weekStart } from '@core/dates'

export interface HeatDay {
  date: string
  minutes: number
  xp: number
}

export interface HeatCell extends HeatDay {
  /** 0 = nothing, 1..4 = increasing effort. */
  level: number
  /** Day after `today` – drawn as an empty slot. */
  future: boolean
  /** 0 = Monday … 6 = Sunday. */
  weekday: number
}

/** Inclusive date range covering `weeks` full weeks (Monday-first) ending with the week that contains `today`. */
export function heatmapRange(today: string, weeks: number): { from: string; to: string } {
  const start = addDays(weekStart(today), -7 * (Math.max(1, Math.floor(weeks)) - 1))
  return { from: start, to: today }
}

/**
 * Intensity 0..4 relative to the learner's daily goal: under a quarter of the goal is level 1,
 * half → 2, the full goal → 3 and 1.5× the goal → 4. Any activity at all is at least level 1.
 */
export function intensityLevel(minutes: number, goalMinutes = 20): number {
  if (!(minutes > 0)) return 0
  const goal = Math.max(5, goalMinutes)
  if (minutes >= goal * 1.5) return 4
  if (minutes >= goal) return 3
  if (minutes >= goal * 0.5) return 2
  return 1
}

/** Buckets daily values into columns of 7 days (Mon..Sun). Missing days count as zero. */
export function buildHeatmapWeeks(today: string, weeks: number, data: HeatDay[], goalMinutes = 20): HeatCell[][] {
  const byDate = new Map<string, HeatDay>()
  for (const d of data) {
    const prev = byDate.get(d.date)
    byDate.set(d.date, prev ? { date: d.date, minutes: prev.minutes + d.minutes, xp: prev.xp + d.xp } : d)
  }
  const { from } = heatmapRange(today, weeks)
  const cols: HeatCell[][] = []
  for (let w = 0; w < Math.max(1, Math.floor(weeks)); w++) {
    const col: HeatCell[] = []
    for (let d = 0; d < 7; d++) {
      const date = addDays(from, w * 7 + d)
      const hit = byDate.get(date)
      const future = date > today
      const minutes = future ? 0 : (hit?.minutes ?? 0)
      col.push({
        date,
        minutes,
        xp: future ? 0 : (hit?.xp ?? 0),
        level: future ? 0 : Math.max(intensityLevel(minutes, goalMinutes), hit && hit.xp > 0 ? 1 : 0),
        future,
        weekday: d,
      })
    }
    cols.push(col)
  }
  return cols
}

/** Column indexes where a new month starts (for labels above the grid). */
export function monthStarts(cols: HeatCell[][]): { index: number; date: string }[] {
  const out: { index: number; date: string }[] = []
  let lastMonth = ''
  cols.forEach((col, index) => {
    const first = col[0]
    if (!first) return
    // Label the column that contains the 1st of a month (or the very first column).
    const firstOfMonth = col.find((c) => c.date.endsWith('-01'))
    const labelDate = firstOfMonth?.date ?? first.date
    if ((index === 0 || firstOfMonth) && labelDate.slice(0, 7) !== lastMonth) {
      out.push({ index, date: labelDate })
      lastMonth = labelDate.slice(0, 7)
    }
  })
  // Drop the first label when the next one is too close to fit.
  if (out.length > 1 && (out[1] as { index: number }).index - (out[0] as { index: number }).index < 3) out.shift()
  return out
}

/** Summary used under the heatmap. */
export function heatmapSummary(cols: HeatCell[][]): { activeDays: number; minutes: number; bestDay: HeatCell | null } {
  let activeDays = 0
  let minutes = 0
  let bestDay: HeatCell | null = null
  for (const col of cols)
    for (const c of col) {
      if (c.future) continue
      if (c.minutes > 0 || c.xp > 0) activeDays++
      minutes += c.minutes
      if (c.minutes > 0 && (!bestDay || c.minutes > bestDay.minutes)) bestDay = c
    }
  return { activeDays, minutes, bestDay }
}
