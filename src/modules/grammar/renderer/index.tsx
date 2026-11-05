// Renderer side of the grammar module: routes and navigation entries.
import { Shield } from 'lucide-react'
import { lazy } from 'react'
import type { ModuleRenderer } from '../../types.renderer'

const KingdomPage = lazy(() => import('./pages/KingdomPage'))
const TopicPage = lazy(() => import('./pages/TopicPage'))

export const grammarRenderer: ModuleRenderer = {
  id: 'grammar',
  routes: [
    { path: '/grammar', Component: KingdomPage },
    { path: '/grammar/:id', Component: TopicPage },
  ],
  nav: [
    {
      path: '/grammar',
      label: { en: 'Grammar Kingdom', vi: 'Vương quốc ngữ pháp' },
      icon: Shield,
      group: 'skills',
      order: 14,
    },
  ],
}
