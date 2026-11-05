// AI Coach page: habit overview, reports, notification schedule and habit Q&A, one tab per sub-route.
import { Compass } from 'lucide-react'
import { useLocation, useNavigate, useParams } from 'react-router-dom'
import { PageHeader, Tabs } from '@/components/ui'
import { useL } from '@/i18n'
import { AskTab } from '../components/AskTab'
import { OverviewTab } from '../components/OverviewTab'
import { ReportDetail } from '../components/ReportDetail'
import { ReportsTab } from '../components/ReportsTab'
import { ScheduleTab } from '../components/ScheduleTab'

type Tab = 'overview' | 'reports' | 'schedule' | 'ask'

const TAB_ROUTES: Record<Tab, string> = {
  overview: '/coach',
  reports: '/coach/reports',
  schedule: '/coach/schedule',
  ask: '/coach/ask',
}

function tabFor(path: string): Tab {
  if (path.startsWith('/coach/reports')) return 'reports'
  if (path.startsWith('/coach/schedule')) return 'schedule'
  if (path.startsWith('/coach/ask')) return 'ask'
  return 'overview'
}

export default function CoachPage() {
  const L = useL()
  const location = useLocation()
  const navigate = useNavigate()
  const { id } = useParams()
  const tab = tabFor(location.pathname)
  const reportId = id && /^\d+$/.test(id) ? Number(id) : null

  return (
    <div data-testid="page-coach" className="mx-auto max-w-6xl">
      <PageHeader
        icon={<Compass />}
        title={L('AI Coach', 'Huấn luyện AI')}
        subtitle={L(
          'Your study habits, analysed by AI – with advice, plans and reminders on Windows and Telegram.',
          'Thói quen học của bạn được AI phân tích – kèm lời khuyên, kế hoạch và nhắc nhở qua Windows và Telegram.',
        )}
      />
      <Tabs<Tab>
        className="mb-6"
        value={tab}
        onChange={(t) => navigate(TAB_ROUTES[t])}
        items={[
          { value: 'overview', label: L('Habit overview', 'Tổng quan thói quen') },
          { value: 'reports', label: L('Reports', 'Báo cáo') },
          { value: 'schedule', label: L('Notification schedule', 'Lịch thông báo') },
          { value: 'ask', label: L('Ask AI', 'Hỏi AI') },
        ]}
      />
      {tab === 'overview' && <OverviewTab />}
      {tab === 'reports' && (reportId ? <ReportDetail id={reportId} /> : <ReportsTab />)}
      {tab === 'schedule' && <ScheduleTab />}
      {tab === 'ask' && <AskTab />}
    </div>
  )
}
