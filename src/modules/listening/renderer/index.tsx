// Renderer side of the listening module: routes and navigation entries.
import { Headphones } from 'lucide-react'
import { lazy } from 'react'
import type { ModuleRenderer } from '../../types.renderer'

const LibraryPage = lazy(() => import('./pages/LibraryPage'))
const PlayerPage = lazy(() => import('./pages/PlayerPage'))

export const listeningRenderer: ModuleRenderer = {
  id: 'listening',
  routes: [
    { path: '/listening', Component: LibraryPage },
    { path: '/listening/:id', Component: PlayerPage },
  ],
  nav: [
    {
      path: '/listening',
      label: { en: 'Listening Lab', vi: 'Phòng nghe' },
      icon: Headphones,
      group: 'skills',
      order: 10,
    },
  ],
}
