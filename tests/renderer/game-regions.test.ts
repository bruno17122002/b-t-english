import { describe, expect, it } from 'vitest'
import { computeRegions, REGION_STAGE_XP } from '../../src/core/game'
import { REGION_KEYS, type RegionProgress } from '../../src/shared/types'
import {
  MAP_SIZE,
  MAX_STAGE,
  minRegionDistance,
  normalizeRegions,
  REGION_LAYOUT,
  REGION_RADIUS,
  regionMeta,
  regionRoute,
  regionsBlockingMastery,
  STAGE_NAMES,
  stageColor,
  stageFraction,
  stageName,
  trailPath,
  trailSegments,
  xpToNextStage,
} from '../../src/modules/game/renderer/lib/regions'

const xp = (v: number) => ({ vocabulary: v, grammar: v, reading: v, listening: v, writing: v, speaking: v })

describe('game regions – layout data', () => {
  it('has exactly one entry per region key', () => {
    expect(REGION_LAYOUT.map((r) => r.key).sort()).toEqual([...REGION_KEYS].sort())
  })

  it('keeps landmarks and name plaques inside the map without overlapping', () => {
    for (const r of REGION_LAYOUT) {
      expect(r.x - 86).toBeGreaterThanOrEqual(0) // name plaque is 172 wide
      expect(r.x + 86).toBeLessThanOrEqual(MAP_SIZE.width)
      expect(r.y - REGION_RADIUS - 10).toBeGreaterThanOrEqual(0)
      expect(r.y + REGION_RADIUS + 14 + 42).toBeLessThanOrEqual(MAP_SIZE.height) // plaque below the ring
    }
    expect(minRegionDistance()).toBeGreaterThan(REGION_RADIUS * 2 + 20)
  })

  it('routes each region to its training module', () => {
    expect(regionRoute('vocabulary-forest')).toBe('/vocabulary')
    expect(regionRoute('grammar-kingdom')).toBe('/grammar')
    expect(regionRoute('listening-ocean')).toBe('/listening')
    expect(regionRoute('speaking-arena')).toBe('/speaking')
    expect(regionRoute('reading-library')).toBe('/reading')
    expect(regionRoute('writing-academy')).toBe('/writing')
    expect(regionRoute('mastery-challenge')).toBe('/journey')
    expect(new Set(REGION_LAYOUT.map((r) => r.landmark)).size).toBe(7)
  })

  it('names every stage in both languages', () => {
    expect(STAGE_NAMES).toHaveLength(REGION_STAGE_XP.length)
    expect(MAX_STAGE).toBe(5)
    for (const s of STAGE_NAMES) {
      expect(s.en.length).toBeGreaterThan(0)
      expect(s.vi.length).toBeGreaterThan(0)
    }
    expect(stageName(-3)).toBe(STAGE_NAMES[0])
    expect(stageName(99)).toBe(STAGE_NAMES[5])
    for (const r of REGION_LAYOUT) expect(regionMeta(r.key).name.vi.length).toBeGreaterThan(0)
  })
})

describe('game regions – progress helpers', () => {
  it('computes in-stage progress from core regions', () => {
    const regions = computeRegions(xp(275)) // stage 1: 150..400
    const forest = regions.find((r) => r.key === 'vocabulary-forest')!
    expect(forest.stage).toBe(1)
    expect(stageFraction(forest)).toBeCloseTo(0.5)
    expect(xpToNextStage(forest)).toBe(125)
    const maxed = computeRegions(xp(5000)).find((r) => r.key === 'grammar-kingdom')!
    expect(stageFraction(maxed)).toBe(1)
    expect(xpToNextStage(maxed)).toBe(0)
  })

  it('lists the regions blocking the summit', () => {
    const low = computeRegions({ ...xp(500), speaking: 100 })
    expect(regionsBlockingMastery(low).map((r) => r.key)).toEqual(['speaking-arena'])
    expect(low.find((r) => r.key === 'mastery-challenge')!.unlocked).toBe(false)
    expect(regionsBlockingMastery(computeRegions(xp(500)))).toEqual([])
  })

  it('fills missing regions so the map always has seven', () => {
    expect(normalizeRegions(undefined)).toHaveLength(7)
    const partial: RegionProgress[] = [computeRegions(xp(900))[0]!]
    const full = normalizeRegions(partial)
    expect(full.map((r) => r.key)).toEqual([...REGION_KEYS])
    expect(full[0]!.xp).toBe(900)
    expect(full.find((r) => r.key === 'mastery-challenge')!.unlocked).toBe(false)
    expect(full.find((r) => r.key === 'speaking-arena')!.skill).toBe('speaking')
  })

  it('colours stages with theme variables', () => {
    expect(stageColor(0)).toContain('var(--muted)')
    expect(stageColor(3)).toContain('var(--accent)')
    expect(stageColor(5)).toBe('var(--warning)')
    expect(stageColor(3, false)).toBe('var(--surface-3)')
    expect(new Set([1, 2, 3, 4].map((s) => stageColor(s))).size).toBe(4)
  })

  it('draws the trail through all regions, one segment per hop', () => {
    expect(trailPath().startsWith(`M${REGION_LAYOUT[0]!.x} ${REGION_LAYOUT[0]!.y}`)).toBe(true)
    const segs = trailSegments(computeRegions({ ...xp(0), vocabulary: 200, grammar: 200 }))
    expect(segs).toHaveLength(6)
    expect(segs[0]!.active).toBe(true) // forest → kingdom, both started
    expect(segs[1]!.active).toBe(false)
    const last = REGION_LAYOUT[6]!
    expect(segs[5]!.d.endsWith(`${last.x} ${last.y}`)).toBe(true)
  })
})
