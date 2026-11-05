// Renderer side of the cinema module: routes and navigation entries.
import { Clapperboard } from 'lucide-react'
import { lazy } from 'react'
import type { ModuleRenderer } from '../../types.renderer'

const CinemaLibraryPage = lazy(() => import('./pages/LibraryPage'))
const PlayerPage = lazy(() => import('./pages/PlayerPage'))

export const cinemaRenderer: ModuleRenderer = {
  id: 'cinema',
  routes: [
    { path: '/cinema', Component: CinemaLibraryPage },
    { path: '/cinema/:id', Component: PlayerPage },
  ],
  nav: [
    { path: '/cinema', label: { en: 'Cinema Mode', vi: 'Rạp phim' }, icon: Clapperboard, group: 'play', order: 21 },
  ],
}
