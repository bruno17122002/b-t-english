// Renderer side of the writing module: routes and navigation entries.
import { PenLine } from 'lucide-react'
import { lazy } from 'react'
import type { ModuleRenderer } from '../../types.renderer'

const WritingPage = lazy(() => import('./pages/WritingPage'))
const ResultPage = lazy(() => import('./pages/ResultPage'))
const HistoryPage = lazy(() => import('./pages/HistoryPage'))

export const writingRenderer: ModuleRenderer = {
  id: 'writing',
  routes: [
    { path: '/writing', Component: WritingPage },
    { path: '/writing/history', Component: HistoryPage },
    { path: '/writing/result/:id', Component: ResultPage },
  ],
  nav: [
    {
      path: '/writing',
      label: { en: 'Writing Workshop', vi: 'Xưởng viết' },
      icon: PenLine,
      group: 'skills',
      order: 13,
    },
  ],
}
