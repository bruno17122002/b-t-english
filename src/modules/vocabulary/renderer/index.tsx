// Renderer side of the vocabulary module: routes and navigation entries. Renderer-only: all data comes
// from the kernel 'vocab:*' channels.
import { Library } from 'lucide-react'
import { lazy } from 'react'
import type { ModuleRenderer } from '../../types.renderer'

const VocabularyPage = lazy(() => import('./pages/VocabularyPage'))
const ReviewPage = lazy(() => import('./pages/ReviewPage'))

export const vocabularyRenderer: ModuleRenderer = {
  id: 'vocabulary',
  routes: [
    { path: '/vocabulary', Component: VocabularyPage },
    { path: '/vocabulary/review', Component: ReviewPage },
    { path: '/vocabulary/*', Component: VocabularyPage },
  ],
  nav: [
    {
      path: '/vocabulary',
      label: { en: 'Vocabulary', vi: 'Từ vựng' },
      icon: Library,
      group: 'play',
      order: 20,
      badge: 'dueCards',
    },
  ],
}
