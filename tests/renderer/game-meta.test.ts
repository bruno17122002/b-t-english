import { describe, expect, it } from 'vitest'
import { ACCENT_UNLOCKS, levelTitle } from '../../src/core/game'
import type { Achievement } from '../../src/shared/types'
import {
  accentThemes,
  actionLabel,
  cefrFraction,
  cefrRingFraction,
  filterAchievements,
  groupByDay,
  levelTitleBi,
  nextAccentUnlock,
  questDisplay,
  questFraction,
  restDayRechargeDate,
  sortAchievements,
} from '../../src/modules/game/renderer/lib/meta'

const ach = (key: string, unlockedAt: string | null, progress: number): Achievement => ({
  key,
  title: key,
  titleVi: key,
  description: '',
  descriptionVi: '',
  icon: 'Star',
  tier: 'bronze',
  progress,
  current: 0,
  target: 1,
  unlockedAt,
})

describe('game meta helpers', () => {
  it('translates every level title', () => {
    for (const lvl of [1, 3, 6, 10, 15, 20, 30, 40]) {
      const t = levelTitleBi(levelTitle(lvl))
      expect(t.vi).not.toBe(t.en)
    }
    expect(levelTitleBi('Unknown').vi).toBe('Unknown')
  })

  it('describes accent themes in unlock order', () => {
    expect(accentThemes().map((a) => a.key)).toEqual(ACCENT_UNLOCKS.map((a) => a.key))
    expect(nextAccentUnlock(1)?.key).toBe('ember')
    expect(nextAccentUnlock(10)?.key).toBe('sunset')
    expect(nextAccentUnlock(99)).toBeNull()
  })

  it('reports quest progress, showing speaking seconds as minutes', () => {
    expect(questFraction({ progress: 5, target: 10, completedAt: null })).toBe(0.5)
    expect(questFraction({ progress: 50, target: 10, completedAt: null })).toBe(1)
    expect(questFraction({ progress: 0, target: 10, completedAt: '2026-11-05T10:00:00Z' })).toBe(1)
    expect(questFraction({ progress: 3, target: 0, completedAt: null })).toBe(0)
    const d = questDisplay({ metric: 'speaking_seconds', progress: 150, target: 300 })
    expect(d).toMatchObject({ value: 2, target: 5 })
    expect(d.unit?.en).toBe('min')
    expect(questDisplay({ metric: 'words_saved', progress: 14, target: 10 })).toMatchObject({
      value: 10,
      target: 10,
      unit: null,
    })
  })

  it('sorts and filters achievements', () => {
    const list = [ach('a', null, 0.2), ach('b', '2026-10-01', 1), ach('c', null, 0.9), ach('d', '2026-11-01', 1)]
    expect(sortAchievements(list).map((a) => a.key)).toEqual(['d', 'b', 'c', 'a'])
    expect(filterAchievements(list, 'unlocked').map((a) => a.key)).toEqual(['b', 'd'])
    expect(filterAchievements(list, 'locked').map((a) => a.key)).toEqual(['a', 'c'])
    expect(filterAchievements(list, 'all')).toHaveLength(4)
  })

  it('computes when the rest-day shield recharges', () => {
    expect(restDayRechargeDate([])).toBeNull()
    expect(restDayRechargeDate(['2026-11-01', '2026-11-03'])).toBe('2026-11-10')
  })

  it('labels activity actions with a safe fallback', () => {
    expect(actionLabel('reading_done').vi).toBe('Luyện đọc')
    expect(actionLabel('something_new')).toEqual({ en: 'something_new', vi: 'something_new' })
    expect(actionLabel('constructor')).toEqual({ en: 'constructor', vi: 'constructor' })
  })

  it('groups activity by day preserving order', () => {
    const items = [
      { id: 3, createdAt: '2026-11-05T09:00:00' },
      { id: 2, createdAt: '2026-11-05T08:00:00' },
      { id: 1, createdAt: '2026-11-04T20:00:00' },
    ]
    const g = groupByDay(items, (iso) => iso.slice(0, 10))
    expect(g.map((x) => [x.day, x.items.map((i) => i.id)])).toEqual([
      ['2026-11-05', [3, 2]],
      ['2026-11-04', [1]],
    ])
  })

  it('places CEFR levels on the radar', () => {
    expect(cefrFraction('A1', 0)).toBeCloseTo(cefrRingFraction(0))
    expect(cefrFraction('B2', 0)).toBeCloseTo(cefrRingFraction(3))
    expect(cefrFraction('B1', 50)).toBeGreaterThan(cefrRingFraction(2))
    expect(cefrFraction('B1', 50)).toBeLessThan(cefrRingFraction(3))
    expect(cefrFraction('C2', 100)).toBe(1)
    expect(cefrFraction('C2', 500)).toBe(1)
    expect(cefrFraction('A1', Number.NaN)).toBeCloseTo(cefrRingFraction(0))
  })
})
