import { describe, expect, it } from 'vitest'
import { diffDays, parseDateKey, weekStart } from '../../src/core/dates'
import {
  buildHeatmapWeeks,
  heatmapRange,
  heatmapSummary,
  intensityLevel,
  monthStarts,
} from '../../src/modules/game/renderer/charts/heatmapData'

const TODAY = '2026-11-05' // a Thursday

describe('game heatmap – range and bucketing', () => {
  it('covers whole Monday-first weeks ending today', () => {
    const r = heatmapRange(TODAY, 20)
    expect(r.to).toBe(TODAY)
    expect(parseDateKey(r.from).getDay()).toBe(1)
    expect(diffDays(weekStart(TODAY), r.from)).toBe(19 * 7)
    expect(heatmapRange(TODAY, 1).from).toBe('2026-11-02')
  })

  it('builds 7-day columns with future days marked', () => {
    const cols = buildHeatmapWeeks(TODAY, 20, [])
    expect(cols).toHaveLength(20)
    expect(cols.every((c) => c.length === 7)).toBe(true)
    const last = cols[19]!
    expect(last.map((c) => c.date)).toEqual([
      '2026-11-02',
      '2026-11-03',
      '2026-11-04',
      '2026-11-05',
      '2026-11-06',
      '2026-11-07',
      '2026-11-08',
    ])
    expect(last.filter((c) => c.future).map((c) => c.date)).toEqual(['2026-11-06', '2026-11-07', '2026-11-08'])
    expect(last[0]!.weekday).toBe(0)
    expect(last[6]!.weekday).toBe(6)
    // consecutive days across columns
    expect(diffDays(cols[1]![0]!.date, cols[0]![6]!.date)).toBe(1)
  })

  it('places values on the right day and merges duplicates', () => {
    const cols = buildHeatmapWeeks(
      TODAY,
      2,
      [
        { date: '2026-11-03', minutes: 30, xp: 50 },
        { date: '2026-11-03', minutes: 5, xp: 5 },
        { date: '2026-10-27', minutes: 4, xp: 10 },
        { date: '2026-11-07', minutes: 99, xp: 99 }, // future – ignored
        { date: '2025-01-01', minutes: 99, xp: 99 }, // outside range – ignored
      ],
      20,
    )
    const flat = cols.flat()
    const day = flat.find((c) => c.date === '2026-11-03')!
    expect(day.minutes).toBe(35)
    expect(day.xp).toBe(55)
    expect(day.level).toBe(4)
    expect(flat.find((c) => c.date === '2026-10-27')!.level).toBe(1)
    expect(flat.find((c) => c.date === '2026-11-07')!.minutes).toBe(0)
    const sum = heatmapSummary(cols)
    expect(sum.activeDays).toBe(2)
    expect(sum.minutes).toBe(39)
    expect(sum.bestDay?.date).toBe('2026-11-03')
  })

  it('gives XP-only days (e.g. saved words) at least level 1', () => {
    const cols = buildHeatmapWeeks(TODAY, 1, [{ date: '2026-11-04', minutes: 0, xp: 6 }])
    expect(cols[0]![2]!.level).toBe(1)
  })
})

describe('game heatmap – intensity', () => {
  it('scales with the daily goal', () => {
    expect(intensityLevel(0, 20)).toBe(0)
    expect(intensityLevel(Number.NaN, 20)).toBe(0)
    expect(intensityLevel(1, 20)).toBe(1)
    expect(intensityLevel(10, 20)).toBe(2)
    expect(intensityLevel(20, 20)).toBe(3)
    expect(intensityLevel(30, 20)).toBe(4)
    expect(intensityLevel(30, 60)).toBe(2)
  })
})

describe('game heatmap – month labels', () => {
  it('labels the first column and each column containing the 1st', () => {
    const cols = buildHeatmapWeeks(TODAY, 20, [])
    const labels = monthStarts(cols)
    const months = labels.map((l) => l.date.slice(0, 7))
    expect(new Set(months).size).toBe(months.length)
    expect(months).toContain('2026-11')
    expect(months).toContain('2026-08')
    for (const l of labels.slice(1)) expect(l.date.endsWith('-01')).toBe(true)
    for (let i = 1; i < labels.length; i++) expect(labels[i]!.index).toBeGreaterThan(labels[i - 1]!.index)
  })
})
