// Renderer side of the coach module: AI Coach pages under /coach/* and the always-mounted habit tracker.
import { Compass } from 'lucide-react'
import { lazy } from 'react'
import type { ModuleRenderer } from '../../types.renderer'
import { HabitTrackerMount } from './HabitTrackerMount'

const CoachPage = lazy(() => import('./pages/CoachPage'))

export const coachRenderer: ModuleRenderer = {
  id: 'coach',
  routes: [
    { path: '/coach', Component: CoachPage },
    { path: '/coach/reports', Component: CoachPage },
    { path: '/coach/reports/:id', Component: CoachPage },
    { path: '/coach/schedule', Component: CoachPage },
    { path: '/coach/ask', Component: CoachPage },
  ],
  nav: [
    { path: '/coach', label: { en: 'AI Coach', vi: 'Huấn luyện AI' }, icon: Compass, group: 'progress', order: 29 },
  ],
  Background: HabitTrackerMount,
}
