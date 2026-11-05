// Renderer side of the speaking module: routes and navigation entries.
import { Mic } from 'lucide-react'
import { lazy } from 'react'
import type { ModuleRenderer } from '../../types.renderer'

const SpeakingApp = lazy(() => import('./SpeakingApp'))

export const speakingRenderer: ModuleRenderer = {
  id: 'speaking',
  routes: [{ path: '/speaking/*', Component: SpeakingApp }],
  nav: [
    { path: '/speaking', label: { en: 'Speaking Studio', vi: 'Phòng nói' }, icon: Mic, group: 'skills', order: 11 },
  ],
}
