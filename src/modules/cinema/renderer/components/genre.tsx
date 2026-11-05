// Genre metadata (labels, icons, colours) and the original poster art used on library cards.
import {
  Briefcase,
  Building,
  ChartLine,
  Handshake,
  House,
  Plane,
  Rocket,
  Search,
  Users,
  type LucideIcon,
} from 'lucide-react'
import type { ReactNode } from 'react'
import type { CinemaStory } from '@shared/content'
import { cx } from '@/components/ui'
import { Backdrop, type BackdropId, type Mood } from './Backdrop'

export type Genre = CinemaStory['genre']

export const GENRES: Record<Genre, { en: string; vi: string; icon: LucideIcon; from: string; to: string }> = {
  'new-york-life': {
    en: 'Big-city life',
    vi: 'Cuộc sống thành phố lớn',
    icon: Building,
    from: '#f59e0b',
    to: '#be123c',
  },
  travel: { en: 'Travel', vi: 'Du lịch', icon: Plane, from: '#06b6d4', to: '#2563eb' },
  detective: { en: 'Detective', vi: 'Trinh thám', icon: Search, from: '#64748b', to: '#1e1b4b' },
  'sci-fi': { en: 'Sci-fi', vi: 'Khoa học viễn tưởng', icon: Rocket, from: '#a855f7', to: '#0f172a' },
  'job-interview': { en: 'Job interview', vi: 'Phỏng vấn xin việc', icon: Briefcase, from: '#10b981', to: '#155e75' },
  office: { en: 'Office', vi: 'Văn phòng', icon: Users, from: '#38bdf8', to: '#334155' },
  business: { en: 'Business', vi: 'Kinh doanh', icon: ChartLine, from: '#eab308', to: '#14532d' },
  social: { en: 'Social life', vi: 'Giao tiếp xã hội', icon: Handshake, from: '#f472b6', to: '#7c2d12' },
  'real-life': { en: 'Real life', vi: 'Đời thường', icon: House, from: '#84cc16', to: '#1e3a8a' },
}

export const genreMeta = (g: string) => GENRES[g as Genre] ?? GENRES['real-life']

/** Poster: the opening scene's backdrop with a flat title bar and the genre icon. */
export function Poster({
  title,
  genre,
  backdrop,
  mood,
  className,
  children,
}: {
  title: string
  genre: string
  backdrop: BackdropId
  mood?: Mood
  className?: string
  children?: ReactNode
}) {
  const g = genreMeta(genre)
  const Icon = g.icon
  return (
    <div className={cx('relative isolate overflow-hidden bg-black', className)}>
      <Backdrop backdrop={backdrop} mood={mood} still />
      <div
        className="absolute top-3 left-3 flex size-9 items-center justify-center rounded-xl text-white"
        style={{ background: g.from }}
      >
        <Icon className="size-5" />
      </div>
      {/* Flat title bar keeps the title legible over the scene without a gradient scrim. */}
      <div className="absolute inset-x-0 bottom-0 bg-black/65 px-4 py-3">
        <div className="font-display text-xl leading-tight font-semibold text-white">{title}</div>
      </div>
      {children}
    </div>
  )
}
