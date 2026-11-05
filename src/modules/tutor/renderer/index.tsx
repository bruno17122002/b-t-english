// Renderer side of the tutor module: routes and navigation entries.
import { MessagesSquare } from 'lucide-react'
import { lazy } from 'react'
import type { ModuleRenderer } from '../../types.renderer'

const TutorPage = lazy(() => import('./pages/TutorPage'))

export const tutorRenderer: ModuleRenderer = {
  id: 'tutor',
  routes: [
    { path: '/tutor', Component: TutorPage },
    { path: '/tutor/:id', Component: TutorPage },
  ],
  nav: [{ path: '/tutor', label: { en: 'AI Tutor', vi: 'Gia sư AI' }, icon: MessagesSquare, group: 'play', order: 22 }],
}
