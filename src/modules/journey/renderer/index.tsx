// Renderer side of the journey module: routes and navigation entries.
import { LayoutDashboard, Map } from 'lucide-react'
import { lazy } from 'react'
import type { ModuleRenderer } from '../../types.renderer'

const DashboardPage = lazy(() => import('./pages/DashboardPage'))
const OnboardingPage = lazy(() => import('./pages/OnboardingPage'))
const AssessmentPage = lazy(() => import('./pages/AssessmentPage'))
const JourneyPage = lazy(() => import('./pages/JourneyPage'))
const CoursePage = lazy(() => import('./pages/CoursePage'))
const CourseLessonPage = lazy(() => import('./pages/CourseLessonPage'))

export const journeyRenderer: ModuleRenderer = {
  id: 'journey',
  routes: [
    { path: '/', Component: DashboardPage },
    { path: '/onboarding', Component: OnboardingPage },
    { path: '/assessment', Component: AssessmentPage },
    { path: '/journey', Component: JourneyPage },
    { path: '/journey/course', Component: CoursePage },
    { path: '/journey/course/:lessonId', Component: CourseLessonPage },
  ],
  nav: [
    { path: '/', label: { en: 'Dashboard', vi: 'Tổng quan' }, icon: LayoutDashboard, group: 'home', order: 0 },
    { path: '/journey', label: { en: 'Journey', vi: 'Hành trình' }, icon: Map, group: 'home', order: 1 },
  ],
}
