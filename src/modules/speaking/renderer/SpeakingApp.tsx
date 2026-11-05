// Nested routes of the Speaking Studio (mounted at /speaking/*).
import { lazy, Suspense } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'
import { LoadingBlock } from '@/components/ui'

const HomePage = lazy(() => import('./pages/HomePage'))
const PracticePage = lazy(() => import('./pages/PracticePage'))
const PronPathPage = lazy(() => import('./pages/PronPathPage'))
const PronLessonPage = lazy(() => import('./pages/PronLessonPage'))
const HistoryPage = lazy(() => import('./pages/HistoryPage'))

export default function SpeakingApp() {
  return (
    <Suspense fallback={<LoadingBlock rows={4} />}>
      <Routes>
        <Route index element={<HomePage />} />
        <Route path="practice/:id" element={<PracticePage />} />
        <Route path="pronunciation" element={<PronPathPage />} />
        <Route path="pronunciation/:lessonId" element={<PronLessonPage />} />
        <Route path="history" element={<HistoryPage />} />
        <Route path="*" element={<Navigate to="/speaking" replace />} />
      </Routes>
    </Suspense>
  )
}
