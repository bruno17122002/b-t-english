// Renderer side of the reading module: routes and navigation entries.
import { BookOpen } from 'lucide-react'
import { lazy } from 'react'
import type { ModuleRenderer } from '../../types.renderer'

const LibraryPage = lazy(() => import('./pages/LibraryPage'))
const ReaderPage = lazy(() => import('./pages/ReaderPage'))

export const readingRenderer: ModuleRenderer = {
  id: 'reading',
  routes: [
    { path: '/reading', Component: LibraryPage },
    { path: '/reading/:id', Component: ReaderPage },
  ],
  nav: [
    {
      path: '/reading',
      label: { en: 'Reading Adventure', vi: 'Phiêu lưu đọc' },
      icon: BookOpen,
      group: 'skills',
      order: 12,
    },
  ],
}
