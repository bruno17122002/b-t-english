// Notification schedule: toggle, time and channels (Windows / Telegram) for each coach message, Telegram
// status and "send test" buttons.
import { Bell, Monitor, Send } from 'lucide-react'
import type { ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { Badge, Button, Card, ErrorState, Input, LoadingBlock, Select, Toggle } from '@/components/ui'
import { useFormat, useL, useTx } from '@/i18n'
import { api, useAction, useApi } from '@/lib/api'
import { useApp } from '@/lib/store'
import type { ScheduleConfig, ScheduleKind } from '../../types'
import { SCHEDULE_META, WEEKDAYS_SUN_FIRST } from '../meta'

const KINDS: ScheduleKind[] = ['morningBrief', 'eveningReminder', 'dailyReport', 'weeklyReport', 'monthlyReport']

export function ScheduleTab() {
  const L = useL()
  const tx = useTx()
  const fmt = useFormat()
  const navigate = useNavigate()
  const q = useApi('coach:schedules', undefined, [])
  const save = useAction((kind: ScheduleKind, patch: Partial<ScheduleConfig>) =>
    api('coach:updateSchedules', { [kind]: patch }),
  )
  const test = useAction((channel: 'app' | 'telegram') => api('coach:sendTest', { channel }))

  const update = async (kind: ScheduleKind, patch: Partial<ScheduleConfig>) => {
    const res = await save.run(kind, patch)
    if (res) q.setData(res)
  }
  const sendTest = async (channel: 'app' | 'telegram') => {
    const res = await test.run(channel)
    if (res) useApp.getState().toast({ kind: res.ok ? 'success' : 'error', title: res.message })
  }

  if (q.error) return <ErrorState error={q.error} onRetry={() => void q.reload()} />
  if (!q.data) return <LoadingBlock rows={5} />
  const st = q.data
  const next = new Map(st.nextRuns.map((n) => [n.kind, n.at]))

  return (
    <div data-testid="coach-schedule">
      <Card className="mb-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3 text-sm">
            <Send className="size-5 text-accent" />
            <span data-testid="coach-telegram-status">
              {st.telegramConnected
                ? L(
                    'Telegram bot is connected – messages go to your linked chat.',
                    'Bot Telegram đã kết nối – tin nhắn sẽ gửi tới chat đã liên kết.',
                  )
                : L('Telegram is not connected yet.', 'Chưa kết nối Telegram.')}
            </span>
            <Button size="sm" variant="ghost" onClick={() => navigate('/settings/telegram')}>
              {L('Telegram settings', 'Cài đặt Telegram')}
            </Button>
          </div>
          <div className="flex gap-2">
            <Button
              size="sm"
              icon={<Monitor className="size-4" />}
              loading={test.pending}
              onClick={() => void sendTest('app')}
              data-testid="coach-test-app"
            >
              {L('Test Windows notification', 'Gửi thử thông báo')}
            </Button>
            <Button
              size="sm"
              icon={<Send className="size-4" />}
              loading={test.pending}
              onClick={() => void sendTest('telegram')}
              data-testid="coach-test-telegram"
            >
              {L('Test Telegram', 'Gửi thử Telegram')}
            </Button>
          </div>
        </div>
        {!st.notificationsEnabled && (
          <p className="mt-3 text-xs text-warning">
            {L(
              'Windows notifications are turned off in General settings – only Telegram messages will be sent.',
              'Thông báo Windows đang tắt trong Cài đặt chung – chỉ gửi tin nhắn Telegram.',
            )}
          </p>
        )}
      </Card>
      {(save.error || test.error) && (
        <div className="mb-4">
          <ErrorState error={(save.error ?? test.error) as Error} compact />
        </div>
      )}
      <div className="space-y-3">
        {KINDS.map((kind) => {
          const cfg = st.schedules[kind]
          const meta = SCHEDULE_META[kind]
          const nextAt = next.get(kind)
          return (
            <Card key={kind} className="!p-4" data-testid={`coach-schedule-${kind}`}>
              <div className="flex flex-wrap items-center gap-4">
                <Toggle
                  checked={cfg.enabled}
                  label={tx(meta.title)}
                  onChange={(v) => void update(kind, { enabled: v })}
                />
                <div className="min-w-48 flex-1">
                  <div className="flex items-center gap-2 font-semibold">
                    <Bell className="size-4 text-faint" />
                    {tx(meta.title)}
                  </div>
                  <p className="text-sm text-muted">{tx(meta.body)}</p>
                  <p className="mt-1 text-xs text-faint">
                    {cfg.enabled && nextAt
                      ? L(
                          `Next: ${fmt.date(nextAt, { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}`,
                          `Lần tới: ${fmt.date(nextAt, { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}`,
                        )
                      : L('Off', 'Đang tắt')}
                    {st.lastSent[kind] && ` · ${L('last sent', 'gửi lần cuối')}: ${st.lastSent[kind]}`}
                  </p>
                </div>
                {kind === 'weeklyReport' && (
                  <Select
                    className="w-36"
                    aria-label={L('Weekday', 'Thứ')}
                    value={cfg.weekday ?? 0}
                    onChange={(e) => void update(kind, { weekday: Number(e.target.value) })}
                  >
                    {WEEKDAYS_SUN_FIRST.map((w, i) => (
                      <option key={w.en} value={i}>
                        {tx(w)}
                      </option>
                    ))}
                  </Select>
                )}
                {kind === 'monthlyReport' && (
                  <Select
                    className="w-36"
                    aria-label={L('Day of month', 'Ngày trong tháng')}
                    value={cfg.dayOfMonth ?? 1}
                    onChange={(e) => void update(kind, { dayOfMonth: Number(e.target.value) })}
                  >
                    {Array.from({ length: 28 }, (_, i) => (
                      <option key={i + 1} value={i + 1}>
                        {L(`Day ${i + 1}`, `Ngày ${i + 1}`)}
                      </option>
                    ))}
                  </Select>
                )}
                <Input
                  type="time"
                  className="w-32"
                  aria-label={L('Time', 'Giờ')}
                  value={cfg.time}
                  data-testid={`coach-time-${kind}`}
                  onChange={(e) => /^\d{2}:\d{2}$/.test(e.target.value) && void update(kind, { time: e.target.value })}
                />
                <div className="flex gap-2">
                  <ChannelChip
                    active={cfg.channels.app}
                    label={L('Windows', 'Windows')}
                    icon={<Monitor className="size-3.5" />}
                    onClick={() => void update(kind, { channels: { ...cfg.channels, app: !cfg.channels.app } })}
                  />
                  <ChannelChip
                    active={cfg.channels.telegram}
                    label="Telegram"
                    icon={<Send className="size-3.5" />}
                    onClick={() =>
                      void update(kind, { channels: { ...cfg.channels, telegram: !cfg.channels.telegram } })
                    }
                  />
                </div>
              </div>
            </Card>
          )
        })}
      </div>
      <p className="mt-4 text-xs text-faint">
        {L(
          'Missed while the app was closed? Each message is caught up once when the app starts again (same day / period) and never sent twice.',
          'Bỏ lỡ khi ứng dụng tắt? Mỗi tin được gửi bù một lần khi mở lại ứng dụng (trong cùng ngày / kỳ) và không bao giờ gửi trùng.',
        )}
      </p>
      {save.pending && (
        <Badge tone="neutral" className="mt-2">
          {L('Saving…', 'Đang lưu…')}
        </Badge>
      )}
    </div>
  )
}

function ChannelChip({
  active,
  label,
  icon,
  onClick,
}: {
  active: boolean
  label: string
  icon: ReactNode
  onClick: () => void
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={
        active
          ? 'inline-flex items-center gap-1.5 rounded-md border border-accent bg-accent/15 px-2.5 py-1 text-xs font-semibold text-accent'
          : 'inline-flex items-center gap-1.5 rounded-md border border-line bg-surface-2 px-2.5 py-1 text-xs text-muted hover:text-text'
      }
    >
      {icon}
      {label}
    </button>
  )
}
