// Small presentational pieces shared by the reading pages.
import {
  Brain,
  Briefcase,
  BookOpen,
  Cpu,
  FlaskConical,
  Lightbulb,
  Newspaper,
  Radio,
  WandSparkles,
  type LucideIcon,
} from 'lucide-react'
import type { ReadingPassage } from '@shared/content'

type Category = ReadingPassage['category']

export const CATEGORY_META: Record<Category, { icon: LucideIcon; en: string; vi: string }> = {
  'short-story': { icon: BookOpen, en: 'Short story', vi: 'Truyện ngắn' },
  article: { icon: Newspaper, en: 'Article', vi: 'Bài viết' },
  news: { icon: Radio, en: 'News', vi: 'Tin tức' },
  science: { icon: FlaskConical, en: 'Science', vi: 'Khoa học' },
  technology: { icon: Cpu, en: 'Technology', vi: 'Công nghệ' },
  business: { icon: Briefcase, en: 'Business', vi: 'Kinh doanh' },
  psychology: { icon: Brain, en: 'Psychology', vi: 'Tâm lý học' },
  philosophy: { icon: Lightbulb, en: 'Philosophy', vi: 'Triết học' },
  fiction: { icon: WandSparkles, en: 'Fiction', vi: 'Hư cấu' },
}

export const CATEGORIES = Object.keys(CATEGORY_META) as Category[]

/** Decorative cover: a soft accent gradient with the category icon (illustration only). */
export function CategoryCover({ category, className }: { category: Category; className?: string }) {
  const Icon = CATEGORY_META[category].icon
  return (
    <div
      aria-hidden
      className={`relative flex items-center justify-center overflow-hidden rounded-xl bg-accent/10 text-accent ${className ?? ''}`}
    >
      <svg className="absolute inset-0 size-full opacity-40" viewBox="0 0 100 60" preserveAspectRatio="none">
        <defs>
          <linearGradient id={`rg-${category}`} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="var(--accent)" stopOpacity="0.35" />
            <stop offset="100%" stopColor="var(--accent-2)" stopOpacity="0.15" />
          </linearGradient>
        </defs>
        <rect width="100" height="60" fill={`url(#rg-${category})`} />
        <path d="M0 45 Q 25 30 50 42 T 100 36 V60 H0 Z" fill="var(--accent-2)" opacity="0.18" />
        <path d="M0 52 Q 30 40 60 50 T 100 46 V60 H0 Z" fill="var(--accent)" opacity="0.18" />
      </svg>
      <Icon className="relative size-7" />
    </div>
  )
}

export function formatClock(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds))
  const m = Math.floor(s / 60)
  return `${m}:${String(s % 60).padStart(2, '0')}`
}

export function splitParagraphs(body: string): string[] {
  return body
    .split(/\n\s*\n|\r?\n/)
    .map((p) => p.trim())
    .filter(Boolean)
}

/** Tiny SVG sparkline for a numeric series. */
export function Sparkline({
  values,
  width = 160,
  height = 40,
  label,
}: {
  values: number[]
  width?: number
  height?: number
  label: string
}) {
  if (values.length < 2) return null
  const max = Math.max(...values)
  const min = Math.min(...values)
  const span = max - min || 1
  const step = width / (values.length - 1)
  const pts = values.map(
    (v, i) => `${(i * step).toFixed(1)},${(height - 4 - ((v - min) / span) * (height - 8)).toFixed(1)}`,
  )
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-label={label}>
      <polyline
        points={pts.join(' ')}
        fill="none"
        stroke="var(--accent)"
        strokeWidth="2"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      {pts.map((p, i) => {
        const [x, y] = p.split(',')
        return <circle key={i} cx={x} cy={y} r={i === pts.length - 1 ? 3 : 1.6} fill="var(--accent)" />
      })}
    </svg>
  )
}
