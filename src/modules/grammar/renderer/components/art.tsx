// Original illustrations for Grammar Kingdom: a castle per CEFR level and star ratings for mastery.
import { Star } from 'lucide-react'
import type { Cefr } from '@shared/content'
import { cx } from '@/components/ui'

const PALETTE: Record<Cefr, { wall: string; roof: string; glow: string }> = {
  A1: { wall: '#3f7f6b', roof: '#6ee7b7', glow: '#34d399' },
  A2: { wall: '#2f6f7a', roof: '#5eead4', glow: '#2dd4bf' },
  B1: { wall: '#2f5f8f', roof: '#7dd3fc', glow: '#38bdf8' },
  B2: { wall: '#43458f', roof: '#a5b4fc', glow: '#818cf8' },
  C1: { wall: '#5b3f8f', roof: '#c4b5fd', glow: '#a78bfa' },
  C2: { wall: '#7a3a7a', roof: '#f0abfc', glow: '#e879f9' },
}

const LEVEL_INDEX: Record<Cefr, number> = { A1: 0, A2: 1, B1: 2, B2: 3, C1: 4, C2: 5 }

/** A small castle; more towers for higher levels, golden banners when every topic is mastered. */
export function CastleArt({ cefr, progress, className }: { cefr: Cefr; progress: number; className?: string }) {
  const c = PALETTE[cefr]
  const towers = 2 + Math.min(3, LEVEL_INDEX[cefr])
  const width = 160
  const spacing = width / (towers + 1)
  const conquered = progress >= 1
  const flag = conquered ? '#fbbf24' : c.roof
  return (
    <svg viewBox="0 0 160 110" className={className} aria-hidden="true">
      <defs>
        <radialGradient id={`glow-${cefr}`} cx="50%" cy="70%" r="60%">
          <stop offset="0%" stopColor={c.glow} stopOpacity={0.35 + 0.4 * progress} />
          <stop offset="100%" stopColor={c.glow} stopOpacity="0" />
        </radialGradient>
        <linearGradient id={`wall-${cefr}`} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor={c.wall} />
          <stop offset="100%" stopColor="#151a2e" />
        </linearGradient>
      </defs>
      <ellipse cx="80" cy="92" rx="78" ry="26" fill={`url(#glow-${cefr})`} />
      {/* hill */}
      <path d="M0 104 Q40 84 80 88 T160 100 L160 110 L0 110 Z" fill="#1f2a3a" />
      {/* curtain wall */}
      <rect x="22" y="58" width="116" height="34" fill={`url(#wall-${cefr})`} />
      {Array.from({ length: 12 }, (_, i) => (
        <rect key={i} x={22 + i * 10} y="52" width="6" height="7" fill={c.wall} />
      ))}
      {/* gate */}
      <path d="M70 92 L70 74 Q80 62 90 74 L90 92 Z" fill="#0b0d14" />
      <path d="M70 92 L70 74 Q80 62 90 74 L90 92" fill="none" stroke={c.roof} strokeOpacity="0.5" strokeWidth="1.2" />
      {/* towers */}
      {Array.from({ length: towers }, (_, i) => {
        const x = spacing * (i + 1)
        const tall = i === Math.floor(towers / 2)
        const top = tall ? 18 : 32
        return (
          <g key={i}>
            <rect x={x - 9} y={top + 12} width="18" height={92 - top - 12} fill={`url(#wall-${cefr})`} />
            <path d={`M${x - 12} ${top + 13} L${x} ${top - 6} L${x + 12} ${top + 13} Z`} fill={c.roof} />
            <rect
              x={x - 2}
              y={top + 22}
              width="4"
              height="7"
              rx="2"
              fill={progress > i / towers ? '#fde68a' : '#0b0d14'}
            />
            <line x1={x} y1={top - 6} x2={x} y2={top - 18} stroke="#cbd5e1" strokeWidth="1" />
            <path d={`M${x} ${top - 18} L${x + 10} ${top - 15} L${x} ${top - 12} Z`} fill={flag} />
          </g>
        )
      })}
    </svg>
  )
}

export const starsFor = (mastery: number) => (mastery >= 0.95 ? 3 : mastery >= 0.8 ? 2 : mastery >= 0.5 ? 1 : 0)

export function Stars({ mastery, className }: { mastery: number; className?: string }) {
  const n = starsFor(mastery)
  return (
    <span className={cx('inline-flex gap-0.5', className)} aria-label={`${n}/3`}>
      {[0, 1, 2].map((i) => (
        <Star key={i} className={cx('size-3.5', i < n ? 'fill-warning text-warning' : 'text-faint')} />
      ))}
    </span>
  )
}
