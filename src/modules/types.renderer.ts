// Contract every feature module implements on the renderer side.
import type { LucideIcon } from 'lucide-react'
import type { ComponentType, LazyExoticComponent } from 'react'

export interface ModuleRoute {
  /** Router path, e.g. '/listening' or '/listening/:trackId'. */
  path: string
  Component: LazyExoticComponent<ComponentType> | ComponentType
}

export interface ModuleNavItem {
  path: string
  label: { en: string; vi: string }
  icon: LucideIcon
  group: 'home' | 'skills' | 'play' | 'progress'
  order: number
  /** Optional badge, e.g. number of due cards (read from the global store). */
  badge?: 'dueCards'
}

export interface ModuleRenderer {
  id: string
  routes: ModuleRoute[]
  nav?: ModuleNavItem[]
}
