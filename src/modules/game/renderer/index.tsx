// Renderer side of the game module: Adventure (game mode) at /game and Statistics at /stats.
import { BarChart3, Swords } from 'lucide-react'
import { lazy } from 'react'
import type { ModuleRenderer } from '../../types.renderer'

const GamePage = lazy(() => import('./pages/GamePage'))
const StatsPage = lazy(() => import('./pages/StatsPage'))

export const gameRenderer: ModuleRenderer = {
  id: 'game',
  routes: [
    { path: '/game', Component: GamePage },
    { path: '/stats', Component: StatsPage },
  ],
  nav: [
    { path: '/game', label: { en: 'Adventure', vi: 'Phiêu lưu' }, icon: Swords, group: 'progress', order: 30 },
    { path: '/stats', label: { en: 'Statistics', vi: 'Thống kê' }, icon: BarChart3, group: 'progress', order: 31 },
  ],
}
