// Makes framer-motion honour both the OS "reduce motion" preference and the in-app setting.
// (The global CSS only shortens CSS animations; framer-motion animates from JS.)
import { MotionConfig } from 'framer-motion'
import type { ReactNode } from 'react'
import { useApp } from '@/lib/store'

export function GameMotion({ children }: { children: ReactNode }) {
  const reduce = useApp((s) => s.settings?.reduceMotion ?? false)
  return <MotionConfig reducedMotion={reduce ? 'always' : 'user'}>{children}</MotionConfig>
}
