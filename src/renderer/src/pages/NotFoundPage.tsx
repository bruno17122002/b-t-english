import { Compass } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { Button, EmptyState } from '../components/ui'
import { useL } from '../i18n'

export function NotFoundPage() {
  const L = useL()
  const navigate = useNavigate()
  return (
    <EmptyState
      icon={<Compass />}
      title={L('This path is not on the map yet', 'Con đường này chưa có trên bản đồ')}
      body={L('The page you opened does not exist.', 'Trang bạn mở không tồn tại.')}
      action={
        <Button variant="primary" onClick={() => navigate('/')}>
          {L('Back to dashboard', 'Về trang chủ')}
        </Button>
      }
    />
  )
}
