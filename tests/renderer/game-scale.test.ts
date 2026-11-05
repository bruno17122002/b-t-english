import { describe, expect, it } from 'vitest'
import {
  arcPath,
  areaPath,
  bandScale,
  curveSegment,
  linearScale,
  linePath,
  niceDomain,
  niceStep,
  niceTicks,
  polarPoint,
  radarPolygon,
  shouldShowLabel,
  smoothPath,
  toPercentSeries,
} from '../../src/modules/game/renderer/charts/scale'

describe('game chart scale – ticks', () => {
  it('picks nice steps', () => {
    expect(niceStep(100, 4)).toBe(25)
    expect(niceStep(10, 5)).toBe(2)
    expect(niceStep(7, 4)).toBe(2)
    expect(niceStep(0.9, 3)).toBeCloseTo(0.5)
    expect(niceStep(0)).toBe(1)
    expect(niceStep(Number.NaN)).toBe(1)
  })

  it('covers the data range on nice boundaries', () => {
    expect(niceTicks(0, 87, 4)).toEqual([0, 25, 50, 75, 100])
    expect(niceTicks(0, 10, 5)).toEqual([0, 2, 4, 6, 8, 10])
    const t = niceTicks(3.2, 9.7, 4)
    expect(t[0]).toBeLessThanOrEqual(3.2)
    expect(t[t.length - 1]).toBeGreaterThanOrEqual(9.7)
  })

  it('never returns a degenerate axis', () => {
    expect(niceTicks(0, 0).length).toBeGreaterThanOrEqual(2)
    expect(niceTicks(0, 0)[0]).toBe(0)
    expect(niceTicks(5, 5)[0]).toBe(0)
    expect(niceTicks(Number.NaN, Number.NaN).length).toBeGreaterThanOrEqual(2)
    expect(niceTicks(10, 0)).toEqual(niceTicks(0, 10))
  })

  it('has no floating point noise', () => {
    for (const v of niceTicks(0, 0.7, 7)) expect(String(v).length).toBeLessThan(6)
  })

  it('domain matches first and last tick', () => {
    expect(niceDomain(0, 87)).toEqual([0, 100])
  })
})

describe('game chart scale – scales', () => {
  it('maps linearly and handles flat domains', () => {
    const y = linearScale([0, 100], [200, 0])
    expect(y(0)).toBe(200)
    expect(y(100)).toBe(0)
    expect(y(25)).toBe(150)
    expect(linearScale([5, 5], [0, 10])(123)).toBe(5)
  })

  it('splits bands evenly and finds the band under a pointer', () => {
    const b = bandScale(7, 700, 0.4)
    expect(b.step).toBe(100)
    expect(b.bandwidth).toBe(60)
    expect(b.x(0)).toBe(20)
    expect(b.center(3)).toBe(350)
    expect(b.indexAt(-5)).toBe(0)
    expect(b.indexAt(250)).toBe(2)
    expect(b.indexAt(9999)).toBe(6)
    expect(bandScale(0, 100).step).toBe(100)
  })

  it('thins labels but always keeps the newest one', () => {
    const shown = Array.from({ length: 30 }, (_, i) => shouldShowLabel(i, 30, 6)).filter(Boolean).length
    expect(shown).toBeLessThanOrEqual(6)
    expect(shouldShowLabel(29, 30, 6)).toBe(true)
    expect(Array.from({ length: 7 }, (_, i) => shouldShowLabel(i, 7, 10)).every(Boolean)).toBe(true)
  })
})

describe('game chart scale – paths', () => {
  const pts = [
    { x: 0, y: 10 },
    { x: 10, y: 0 },
    { x: 20, y: 5 },
  ]
  it('builds line and area paths', () => {
    expect(linePath(pts)).toBe('M0 10 L10 0 L20 5')
    expect(areaPath(pts, 20)).toBe('M0 10 L10 0 L20 5 L20 20 L0 20 Z')
    expect(areaPath([], 20)).toBe('')
  })

  it('builds a smooth curve through every point', () => {
    const d = smoothPath(pts)
    expect(d.startsWith('M0 10')).toBe(true)
    expect(d.match(/C/g)?.length).toBe(2)
    expect(d.endsWith('20 5')).toBe(true)
    expect(smoothPath(pts.slice(0, 2))).toBe('M0 10 L10 0')
    expect(curveSegment(pts, 0).endsWith('10 0')).toBe(true)
  })

  it('places radar points clockwise from the top', () => {
    expect(polarPoint(50, 50, 10, 0, 4)).toEqual({ x: 50, y: 40 })
    expect(polarPoint(50, 50, 10, 1, 4)).toEqual({ x: 60, y: 50 })
    expect(radarPolygon([1, 1, 1, 1], 50, 50, 10)).toBe('50,40 60,50 50,60 40,50')
    // values are clamped to 0..1
    expect(radarPolygon([2, -1, 0, 0], 50, 50, 10).split(' ')[0]).toBe('50,40')
  })

  it('draws progress arcs', () => {
    expect(arcPath(0, 0, 10, 0)).toBe('')
    expect(arcPath(0, 0, 10, 0.25)).toBe('M0 -10 A10 10 0 0 1 10 0')
    expect(arcPath(0, 0, 10, 0.75)).toContain(' 0 1 1 ')
    expect(arcPath(0, 0, 10, 1)).not.toBe('')
  })

  it('normalises fraction series to percentages', () => {
    expect(toPercentSeries([0.5, 0.75, 1])).toEqual([50, 75, 100])
    expect(toPercentSeries([50, 80])).toEqual([50, 80])
    expect(toPercentSeries([])).toEqual([])
  })
})
