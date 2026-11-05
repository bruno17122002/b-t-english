// Icon per tutor mode.
import { AudioLines, Briefcase, Coffee, Gavel, GraduationCap, Heart, SpellCheck, type LucideIcon } from 'lucide-react'
import type { TutorStyle } from '@shared/types'

export const MODE_ICONS: Record<TutorStyle, LucideIcon> = {
  friendly: Heart,
  strict: Gavel,
  grammar: SpellCheck,
  pronunciation: AudioLines,
  professional: Briefcase,
  ielts: GraduationCap,
  casual: Coffee,
}
