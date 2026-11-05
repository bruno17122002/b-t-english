// Maps the lucide icon names stored on achievements (see ACHIEVEMENTS in core/game) to components,
// with a safe fallback so a new or misspelled name never breaks the grid.
import {
  Award,
  BookOpen,
  Castle,
  Clapperboard,
  Compass,
  Feather,
  Film,
  Flame,
  Headphones,
  Heart,
  Leaf,
  Library,
  type LucideIcon,
  Medal,
  MessagesSquare,
  Mic,
  PenLine,
  ScrollText,
  Shield,
  Sparkles,
  Star,
  Sunrise,
  Swords,
  Target,
  Trees,
  Trophy,
  Waves,
  Zap,
} from 'lucide-react'

export const ACHIEVEMENT_ICONS: Record<string, LucideIcon> = {
  Award,
  BookOpen,
  Castle,
  Clapperboard,
  Compass,
  Feather,
  Film,
  Flame,
  Headphones,
  Heart,
  Leaf,
  Library,
  Medal,
  MessagesSquare,
  Mic,
  PenLine,
  ScrollText,
  Shield,
  Sparkles,
  Star,
  Sunrise,
  Swords,
  Target,
  Trees,
  Trophy,
  Waves,
  Zap,
}

export const FALLBACK_ACHIEVEMENT_ICON: LucideIcon = Award

/** Normalises "book-open", "book_open" or "bookOpen" to the PascalCase lucide export name. */
export function normalizeIconName(name: string): string {
  return name
    .trim()
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
    .join('')
}

export function resolveAchievementIcon(name: string | null | undefined): LucideIcon {
  if (!name) return FALLBACK_ACHIEVEMENT_ICON
  // Own-property check so names like "constructor" never resolve to Object.prototype members.
  const pick = (k: string) => (Object.hasOwn(ACHIEVEMENT_ICONS, k) ? ACHIEVEMENT_ICONS[k] : undefined)
  return pick(name) ?? pick(normalizeIconName(name)) ?? FALLBACK_ACHIEVEMENT_ICON
}
