// Settings → Telegram, "Bot chạy trên server" mode: the central Lingua Quest bot runs on Supabase (works while the
// PC is off). Needs the online account; shows the link status (telegram_links), creates a 6-digit link code to send
// as /start <code>, unlinks, and keeps the AI Coach schedules in sync with the server scheduler.
import { CalendarClock, CheckCircle2, Copy, ExternalLink, Link2, Link2Off, LogIn, RefreshCw } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import type { TelegramLinkCode } from '@shared/telegram'
import { Badge, Button, Card, ConfirmDialog, ErrorState, Field, Input, LoadingBlock } from '../../components/ui'
import { useL } from '../../i18n'
import { api, toApiError, useApi } from '../../lib/api'
import { copyText } from '../../lib/clipboard'
import { useApp } from '../../lib/store'

const SERVER_COMMANDS: [string, string, string][] = [
  ['today', 'Today’s plan, due cards and streak', 'Kế hoạch hôm nay, thẻ cần ôn, chuỗi ngày'],
  ['review', 'Review due flashcards (FSRS)', 'Ôn thẻ từ đến hạn (FSRS)'],
  ['word', 'Word of the day', 'Từ vựng của ngày'],
  ['quiz', 'Quick question on your weakest point', 'Câu hỏi nhanh về điểm yếu'],
  ['report', 'Habit report: day | week | month', 'Báo cáo: ngay | tuan | thang'],
  ['advice', 'AI analysis of your habits', 'AI phân tích thói quen học'],
  ['habits', 'Quick habit statistics', 'Thống kê thói quen nhanh'],
  ['plan', 'AI plan for tomorrow', 'Kế hoạch ngày mai do AI đề xuất'],
  ['reset', 'Clear the chat memory', 'Xóa lịch sử trò chuyện'],
  ['help', 'All commands', 'Danh sách lệnh'],
]

const fmtTime = (iso: string) =>
  new Date(iso).toLocaleString('vi-VN', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' })

export function TelegramServerPanel() {
  const L = useL()
  const toast = useApp((s) => s.toast)
  const navigate = useNavigate()
  const status = useApi('telegram:serverStatus', undefined)
  const [code, setCode] = useState<TelegramLinkCode | null>(null)
  const [busy, setBusy] = useState<'code' | 'unlink' | 'push' | null>(null)
  const [confirmUnlink, setConfirmUnlink] = useState(false)
  const [bot, setBot] = useState('')

  const st = status.data
  const reload = status.reload
  const waiting = !!code && !st?.linked
  const serverBot = st?.serverBot

  useEffect(() => {
    if (serverBot !== undefined) setBot(serverBot ?? '')
  }, [serverBot])

  // While a code is shown, refresh until the server bot has linked the chat.
  useEffect(() => {
    if (!waiting) return
    const t = setInterval(() => void reload(), 4000)
    return () => clearInterval(t)
  }, [waiting, reload])

  const linked = !!st?.linked
  useEffect(() => {
    if (linked && code) {
      setCode(null)
      toast({ kind: 'success', title: L('Telegram linked to your account', 'Đã liên kết Telegram với tài khoản') })
    }
  }, [linked, code, toast, L])

  if (status.loading && !st) return <LoadingBlock rows={3} />
  if (status.error && !st) return <ErrorState error={status.error} onRetry={status.reload} />
  if (!st) return null

  const open = (url: string) => api('app:openExternal', { url }).catch(() => undefined)

  if (!st.cloud.signedIn)
    return (
      <Card data-testid="tg-server-signin">
        <h3 className="flex items-center gap-2 font-semibold">
          <LogIn className="size-4 text-accent" />
          {L('Sign in to use the server bot', 'Cần đăng nhập để dùng bot trên server')}
        </h3>
        <p className="mt-2 text-sm text-muted">
          {st.cloud.configured
            ? L(
                'The server bot is linked to your online account. Sign in in Settings → Account, then come back here to link Telegram.',
                'Bot trên server gắn với tài khoản online của bạn. Hãy đăng nhập ở Cài đặt → Tài khoản rồi quay lại đây để liên kết Telegram.',
              )
            : L(
                'No server is configured yet. Enter the Supabase project URL and anon key in Settings → Account, then sign in.',
                'Chưa cấu hình máy chủ. Nhập URL dự án Supabase và anon key ở Cài đặt → Tài khoản rồi đăng nhập.',
              )}
        </p>
        <Button
          className="mt-3"
          variant="primary"
          icon={<LogIn className="size-4" />}
          onClick={() => navigate('/settings/account')}
        >
          {L('Open Settings → Account', 'Mở Cài đặt → Tài khoản')}
        </Button>
      </Card>
    )

  const createCode = async () => {
    setBusy('code')
    try {
      setCode(await api('telegram:createLinkCode'))
    } catch (err) {
      toast({ kind: 'error', title: toApiError(err).message })
    } finally {
      setBusy(null)
    }
  }

  const unlink = async () => {
    setConfirmUnlink(false)
    setBusy('unlink')
    try {
      status.setData(await api('telegram:unlinkServer'))
    } catch (err) {
      toast({ kind: 'error', title: toApiError(err).message })
    } finally {
      setBusy(null)
    }
  }

  const push = async () => {
    setBusy('push')
    try {
      const res = await api('telegram:pushSchedules')
      status.setData({ ...st, schedulesPushedAt: res.at })
      toast({ kind: 'success', title: L('Schedules sent to the server', 'Đã đồng bộ lịch lên server') })
    } catch (err) {
      toast({ kind: 'error', title: toApiError(err).message })
    } finally {
      setBusy(null)
    }
  }

  const saveBot = async () => {
    const clean = bot.trim().replace(/^@/, '')
    if (clean === (st.serverBot ?? '')) return
    try {
      status.setData(await api('telegram:setMode', { mode: 'server', serverBot: clean }))
    } catch (err) {
      toast({ kind: 'error', title: toApiError(err).message })
    }
  }

  const copy = async (text: string) =>
    (await copyText(text))
      ? toast({ kind: 'success', title: L('Copied', 'Đã sao chép') })
      : toast({ kind: 'error', title: L('Could not copy to the clipboard', 'Không sao chép được') })

  return (
    <div className="space-y-6" data-testid="tg-server-panel">
      <Card>
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="font-display text-lg font-semibold">{L('Server bot', 'Bot trên server')}</h3>
          {st.linked ? (
            <Badge tone="success">{L('Linked', 'Đã liên kết')}</Badge>
          ) : (
            <Badge tone="warning">{L('Not linked', 'Chưa liên kết')}</Badge>
          )}
        </div>
        <p className="mt-1 text-sm text-muted">
          {L(
            'The central Lingua Quest bot runs on the server: it answers even when this computer is off, uses the server’s AI (daily limit) and reads your synced data. Reviews done on Telegram come back to the app at the next sync.',
            'Bot Lingua Quest trung tâm chạy trên server: trả lời cả khi máy tính tắt, dùng AI của server (có hạn mức mỗi ngày) và đọc dữ liệu đã đồng bộ. Kết quả ôn trên Telegram về app ở lần đồng bộ sau.',
          )}
        </p>
        {st.error && (
          <div className="mt-3">
            <ErrorState error={st.error} compact onRetry={status.reload} />
          </div>
        )}
        <div className="mt-4 max-w-md">
          <Field
            label={L('Server bot username', 'Username của bot server')}
            hint={L(
              'Given by whoever deployed the server, e.g. lingua_quest_bot',
              'Do người cài server cung cấp, ví dụ lingua_quest_bot',
            )}
          >
            <Input
              value={bot}
              onChange={(e) => setBot(e.target.value)}
              onBlur={() => void saveBot()}
              onKeyDown={(e) => e.key === 'Enter' && void saveBot()}
              placeholder="lingua_quest_bot"
              spellCheck={false}
              data-testid="tg-server-bot"
            />
          </Field>
        </div>

        <div className="mt-5 border-t border-line pt-4">
          {st.linked ? (
            <div className="space-y-3" data-testid="tg-server-linked">
              <p className="flex items-center gap-2 text-sm text-success">
                <CheckCircle2 className="size-4" />
                {L('Linked', 'Đã liên kết')}
                {st.link?.username ? ` @${st.link.username}` : ''}
                {st.link?.linkedAt ? ` · ${fmtTime(st.link.linkedAt)}` : ''}
              </p>
              <div className="flex flex-wrap gap-2">
                {st.serverBot && (
                  <Button
                    icon={<ExternalLink className="size-4" />}
                    onClick={() => open(`https://t.me/${st.serverBot}`)}
                  >
                    {L('Open the bot', 'Mở bot')}
                  </Button>
                )}
                <Button
                  variant="ghost"
                  icon={<Link2Off className="size-4" />}
                  loading={busy === 'unlink'}
                  onClick={() => setConfirmUnlink(true)}
                  data-testid="tg-server-unlink"
                >
                  {L('Unlink', 'Hủy liên kết')}
                </Button>
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              <ol className="list-decimal space-y-1 pl-5 text-sm text-muted">
                <li>{L('Press “Create link code”.', 'Bấm “Tạo mã liên kết”.')}</li>
                <li>
                  {L('Open ', 'Mở ')}
                  <b className="text-text">{st.serverBot ? `@${st.serverBot}` : L('the server bot', 'bot server')}</b>
                  {L(' in Telegram and send ', ' trong Telegram và gửi ')}
                  <code className="rounded bg-surface-3 px-1">/start &lt;{L('code', 'mã')}&gt;</code>
                  {L(' (valid for 15 minutes).', ' (mã có hiệu lực 15 phút).')}
                </li>
              </ol>
              <Button
                variant="primary"
                icon={<Link2 className="size-4" />}
                loading={busy === 'code'}
                onClick={createCode}
                data-testid="tg-server-create-code"
              >
                {code ? L('New code', 'Tạo mã mới') : L('Create link code', 'Tạo mã liên kết')}
              </Button>
              {code && (
                <div className="space-y-2" data-testid="tg-server-code">
                  <div className="inline-flex items-center rounded-xl border border-line bg-surface-2 px-6 py-3 font-mono text-4xl font-semibold tracking-[0.3em] text-text">
                    {code.code}
                  </div>
                  <p className="text-sm">
                    {L('Send this to the bot: ', 'Gửi cho bot: ')}
                    <code className="rounded bg-surface-3 px-1">{code.startCommand}</code>{' '}
                    <button
                      className="inline-flex items-center gap-1 text-accent hover:underline"
                      onClick={() => void copy(code.startCommand)}
                    >
                      <Copy className="size-3.5" />
                      {L('copy', 'sao chép')}
                    </button>
                  </p>
                  {code.deepLink && (
                    <Button
                      size="sm"
                      icon={<ExternalLink className="size-4" />}
                      onClick={() => open(code.deepLink as string)}
                    >
                      {L('Open the bot with this code', 'Mở bot kèm mã này')}
                    </Button>
                  )}
                  <p className="text-xs text-faint">
                    {L('Valid until ', 'Hết hạn lúc ')}
                    {fmtTime(code.expiresAt)}
                    {L('. This page updates by itself once linked.', '. Trang này tự cập nhật khi liên kết xong.')}
                  </p>
                </div>
              )}
            </div>
          )}
        </div>
      </Card>

      <Card>
        <h3 className="mb-1 flex items-center gap-2 font-semibold">
          <CalendarClock className="size-4 text-accent" />
          {L('Reminders and reports from the server', 'Nhắc học và báo cáo từ server')}
        </h3>
        <p className="text-sm text-muted">
          {L(
            'The schedules of AI Coach → Schedule (morning brief, evening reminder, daily/weekly/monthly report) are sent to the server, which delivers them on Telegram. This computer keeps showing Windows notifications.',
            'Lịch trong AI Coach → Lịch nhắc (brief sáng, nhắc tối, báo cáo ngày/tuần/tháng) được gửi lên server để server nhắn qua Telegram. Máy tính này vẫn hiện thông báo Windows như cũ.',
          )}
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <Button
            icon={<RefreshCw className="size-4" />}
            loading={busy === 'push'}
            onClick={push}
            data-testid="tg-server-push"
          >
            {L('Sync schedules now', 'Đồng bộ lịch ngay')}
          </Button>
          <span className="text-xs text-faint" data-testid="tg-server-pushed">
            {st.schedulesPushedAt
              ? `${L('Last sync', 'Lần cuối')}: ${fmtTime(st.schedulesPushedAt)}`
              : L('Not synced yet', 'Chưa đồng bộ')}
          </span>
        </div>
      </Card>

      <Card>
        <h3 className="mb-3 font-semibold">{L('Server bot commands', 'Lệnh của bot server')}</h3>
        <ul className="grid gap-x-6 gap-y-1.5 text-sm md:grid-cols-2">
          {SERVER_COMMANDS.map(([name, en, vi]) => (
            <li key={name} className="flex gap-2">
              <code className="shrink-0 text-accent">/{name}</code>
              <span className="text-muted">{L(en, vi)}</span>
            </li>
          ))}
        </ul>
        <p className="mt-3 text-xs text-faint">
          {L(
            'Free text, photos and voice messages go to the AI tutor. Drawing pictures (/anh) is only available with the bot on this computer.',
            'Tin nhắn chữ, ảnh và tin thoại được gửi tới gia sư AI. Tạo ảnh (/anh) chỉ có khi bot chạy trên máy này.',
          )}
        </p>
      </Card>

      <ConfirmDialog
        open={confirmUnlink}
        title={L('Unlink Telegram from your account?', 'Hủy liên kết Telegram với tài khoản?')}
        body={L(
          'The server bot stops answering this Telegram account and stops sending reminders until you link it again.',
          'Bot server ngừng trả lời tài khoản Telegram này và ngừng gửi nhắc học cho tới khi bạn liên kết lại.',
        )}
        confirmLabel={L('Unlink', 'Hủy liên kết')}
        danger
        onConfirm={() => void unlink()}
        onCancel={() => setConfirmUnlink(false)}
      />
    </div>
  )
}
