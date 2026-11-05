import { describe, expect, it } from 'vitest'
import { ACHIEVEMENTS } from '../../src/core/game'
import {
  ACHIEVEMENT_ICONS,
  FALLBACK_ACHIEVEMENT_ICON,
  normalizeIconName,
  resolveAchievementIcon,
} from '../../src/modules/game/renderer/lib/achievementIcons'

describe('game achievement icons', () => {
  it('maps every icon used by core achievements to a real component', () => {
    for (const a of ACHIEVEMENTS) {
      expect(ACHIEVEMENT_ICONS[a.icon], `missing icon ${a.icon} for ${a.key}`).toBeDefined()
      expect(resolveAchievementIcon(a.icon)).toBe(ACHIEVEMENT_ICONS[a.icon])
    }
  })

  it('accepts kebab/snake/camel case names', () => {
    expect(normalizeIconName('book-open')).toBe('BookOpen')
    expect(normalizeIconName('scroll_text')).toBe('ScrollText')
    expect(normalizeIconName('bookOpen')).toBe('BookOpen')
    expect(resolveAchievementIcon('book-open')).toBe(ACHIEVEMENT_ICONS.BookOpen)
  })

  it('falls back safely for unknown, empty or prototype names', () => {
    expect(resolveAchievementIcon('DefinitelyNotAnIcon')).toBe(FALLBACK_ACHIEVEMENT_ICON)
    expect(resolveAchievementIcon('')).toBe(FALLBACK_ACHIEVEMENT_ICON)
    expect(resolveAchievementIcon(null)).toBe(FALLBACK_ACHIEVEMENT_ICON)
    expect(resolveAchievementIcon(undefined)).toBe(FALLBACK_ACHIEVEMENT_ICON)
    expect(resolveAchievementIcon('constructor')).toBe(FALLBACK_ACHIEVEMENT_ICON)
    expect(resolveAchievementIcon('__proto__')).toBe(FALLBACK_ACHIEVEMENT_ICON)
    expect(resolveAchievementIcon('toString')).toBe(FALLBACK_ACHIEVEMENT_ICON)
  })
})
