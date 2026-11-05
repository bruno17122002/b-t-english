// Telegram bot settings: connect a bot made with @BotFather, pair the learner's chat with a 6-digit code,
// choose how pictures are drawn and keep the app running in the background. The token is typed once and
// sent to the main process, which encrypts it; the page only ever sees a masked hint.
import {
  AlertTriangle,
  CheckCircle2,
  ExternalLink,
  ImageIcon,
  KeyRound,
  Link2Off,
  Power,
  Send,
  ShieldCheck,
  Trash2,
} from 'lucide-react'
import { useEffect, useState, type ReactNode } from 'react'
import type { AppSettings } from '@shared/types'
import type { ImageProvider, TelegramStatus } from '@shared/telegram'
import {
  Badge,
  Button,
  Card,
  ConfirmDialog,
  cx,
  ErrorState,
  Field,
  Input,
  LoadingBlock,
  Toggle,
} from '../../components/ui'
import { useL } from '../../i18n'
import { api, toApiError, useApi } from '../../lib/api'
import { useApp } from '../../lib/store'

function Step({ n, title, done, children }: { n: number; title: ReactNode; done?: boolean; children: ReactNode }) {
  return (
    <div className="flex gap-4 border-b border-line py-4 first:pt-0 last:border-0 last:pb-0">
      <div
        className={cx(
          'flex size-7 shrink-0 items-center justify-center rounded-full text-sm font-semibold',
          done ? 'bg-success/15 text-success' : 'bg-accent/15 text-accent',
        )}
      >
        {done ? <CheckCircle2 className="size-4" /> : n}
      </div>
      <div className="min-w-0 flex-1">
        <h4 className="text-sm font-semibold">{title}</h4>
        <div className="mt-1.5 text-sm text-muted">{children}</div>
      </div>
    </div>
  )
}

const POLLING_LABEL: Record<
  TelegramStatus['polling'],
  { en: string; vi: string; tone: 'success' | 'neutral' | 'warning' | 'danger' }
> = {
  running: { en: 'Listening for messages', vi: 'Đang nhận tin nhắn', tone: 'success' },
  idle: { en: 'Waiting for a token', vi: 'Chờ token', tone: 'neutral' },
  stopped: { en: 'Stopped', vi: 'Đã dừng', tone: 'neutral' },
  error: { en: 'Connection problem', vi: 'Lỗi kết nối', tone: 'danger' },
  conflict: { en: 'Another bot instance is running', vi: 'Có chương trình khác đang chạy bot', tone: 'warning' },
}

export function TelegramSettings() {
  const L = useL()
  const toast = useApp((s) => s.toast)
  const settings = useApp((s) => s.settings)
  const updateSettings = useApp((s) => s.updateSettings)
  const status = useApi('telegram:status', undefined)
  const [token, setToken] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [testing, setTesting] = useState(false)
  const [confirm, setConfirm] = useState<'remove' | 'unlink' | null>(null)
  const [model, setModel] = useState('')

  const st = status.data
  const reload = status.reload
  const waitingForPairing = !!st?.hasToken && !st.chatLinked
  const imageModel = st?.imageModel

  // While the pairing code is shown, refresh until the learner has sent it to the bot.
  useEffect(() => {
    if (!waitingForPairing) return
    const t = setInterval(() => void reload(), 3000)
    return () => clearInterval(t)
  }, [waitingForPairing, reload])

  useEffect(() => {
    if (imageModel !== undefined) setModel(imageModel)
  }, [imageModel])

  if (status.loading && !st) return <LoadingBlock rows={4} />
  if (status.error && !st) return <ErrorState error={status.error} onRetry={status.reload} />
  if (!st) return null

  const open = (url: string) => api('app:openExternal', { url }).catch(() => undefined)

  const saveToken = async () => {
    setSaving(true)
    setError(null)
    try {
      status.setData(await api('telegram:setToken', { token }))
      setToken('')
      toast({ kind: 'success', title: L('Bot verified and saved', 'Đã xác minh và lưu bot') })
    } catch (err) {
      setError(toApiError(err).message)
    } finally {
      setSaving(false)
    }
  }

  const runTest = async () => {
    setTesting(true)
    try {
      const res = await api('telegram:test')
      toast(
        res.ok
          ? { kind: 'success', title: L('Test message sent – check Telegram', 'Đã gửi tin thử – mở Telegram để xem') }
          : { kind: 'error', title: res.error ?? L('Sending failed', 'Gửi thất bại') },
      )
    } catch (err) {
      toast({ kind: 'error', title: toApiError(err).message })
    } finally {
      setTesting(false)
    }
  }

  const confirmAction = async () => {
    const which = confirm
    setConfirm(null)
    try {
      status.setData(await api(which === 'remove' ? 'telegram:removeToken' : 'telegram:unlink'))
    } catch (err) {
      toast({ kind: 'error', title: toApiError(err).message })
    }
  }

  const setProvider = async (imageProvider: ImageProvider) => {
    try {
      status.setData(await api('telegram:updateSettings', { imageProvider }))
    } catch (err) {
      toast({ kind: 'error', title: toApiError(err).message })
    }
  }

  const saveModel = async () => {
    if (model.trim() === st.imageModel) return
    try {
      status.setData(await api('telegram:updateSettings', { imageModel: model.trim() }))
    } catch (err) {
      toast({ kind: 'error', title: toApiError(err).message })
    }
  }

  const setApp = <K extends keyof AppSettings>(key: K, value: AppSettings[K]) =>
    void updateSettings({ [key]: value } as Partial<AppSettings>)

  const polling = POLLING_LABEL[st.polling]
  const providers: { id: ImageProvider; title: string; desc: string }[] = [
    {
      id: 'pollinations',
      title: L('Pollinations (free)', 'Pollinations (miễn phí)'),
      desc: L(
        'AI writes an English description; the free service image.pollinations.ai draws a picture without text. Vocabulary goes in the caption.',
        'AI viết mô tả tiếng Anh; dịch vụ miễn phí image.pollinations.ai vẽ ảnh không có chữ. Từ vựng nằm ở chú thích dưới ảnh.',
      ),
    },
    {
      id: 'gemini',
      title: L('Gemini image model', 'Model ảnh Gemini'),
      desc: L(
        'Nicer pictures that can contain text. Needs a Gemini key with billing enabled (no free tier).',
        'Ảnh đẹp hơn, có thể có chữ. Cần key Gemini đã bật thanh toán (không có hạn mức miễn phí).',
      ),
    },
    {
      id: 'off',
      title: L('Off', 'Tắt'),
      desc: L('The bot does not draw pictures.', 'Bot không tạo ảnh.'),
    },
  ]

  return (
    <div className="space-y-6" data-testid="telegram-settings">
      {/* ---------- status ---------- */}
      <Card data-testid="tg-status">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="font-display text-lg font-semibold">{L('Telegram bot', 'Bot Telegram')}</h3>
              {st.connected ? (
                <Badge tone="success">{L('Connected', 'Đã kết nối')}</Badge>
              ) : st.hasToken ? (
                <Badge tone="warning">{L('Waiting for pairing', 'Chờ liên kết')}</Badge>
              ) : (
                <Badge>{L('Not set up', 'Chưa thiết lập')}</Badge>
              )}
              {st.hasToken && <Badge tone={polling.tone}>{L(polling.en, polling.vi)}</Badge>}
            </div>
            <p className="mt-1 text-sm text-muted">
              {L(
                'Chat with your IELTS tutor, review flashcards, get the word of the day and quizzes right in Telegram. Everything you do there counts in your stats.',
                'Trò chuyện với gia sư IELTS, ôn thẻ từ, nhận từ của ngày và quiz ngay trong Telegram. Mọi hoạt động đều được tính vào thống kê.',
              )}
            </p>
            {st.hasToken && (
              <p className="mt-2 text-sm" data-testid="tg-bot-info">
                {st.botUsername ? (
                  <button
                    className="font-medium text-accent hover:underline"
                    onClick={() => open(`https://t.me/${st.botUsername}`)}
                  >
                    @{st.botUsername}
                  </button>
                ) : (
                  L('Bot', 'Bot')
                )}{' '}
                <span className="text-faint">
                  · {L('token', 'token')} {st.tokenHint}
                </span>
              </p>
            )}
          </div>
        </div>
        {st.lastError && (
          <div className="mt-4" data-testid="tg-last-error">
            <ErrorState error={st.lastError} compact onRetry={status.reload} />
          </div>
        )}
        {!st.encryptionAvailable && (
          <p className="mt-3 flex items-center gap-2 text-xs text-warning">
            <AlertTriangle className="size-3.5" />
            {L(
              'Windows encryption is unavailable: the token is kept for this session only.',
              'Mã hóa Windows không khả dụng: token chỉ được giữ trong phiên này.',
            )}
          </p>
        )}
      </Card>

      {/* ---------- setup steps ---------- */}
      <Card>
        <h3 className="mb-4 font-semibold">{L('Connect in three steps', 'Kết nối trong 3 bước')}</h3>
        <Step n={1} title={L('Create a bot with @BotFather', 'Tạo bot với @BotFather')} done={st.hasToken}>
          <ol className="list-decimal space-y-1 pl-5">
            <li>
              {L('Open Telegram, search for ', 'Mở Telegram, tìm ')}
              <b className="text-text">@BotFather</b>
              {L(' and press Start.', ' và bấm Start.')}
            </li>
            <li>
              {L('Send ', 'Gửi ')}
              <code className="rounded bg-surface-3 px-1">/newbot</code>
              {L(
                ', choose a display name, then a username ending in "bot" (e.g. garen_ielts_bot).',
                ', đặt tên hiển thị, rồi đặt username kết thúc bằng "bot" (ví dụ garen_ielts_bot).',
              )}
            </li>
            <li>
              {L(
                'BotFather replies with a token like 123456789:AAH… – copy it.',
                'BotFather trả về một token dạng 123456789:AAH… – copy lại.',
              )}
            </li>
          </ol>
          <Button
            className="mt-2"
            size="sm"
            variant="ghost"
            icon={<ExternalLink className="size-4" />}
            onClick={() => open('https://t.me/BotFather')}
          >
            {L('Open @BotFather', 'Mở @BotFather')}
          </Button>
        </Step>

        <Step n={2} title={L('Paste the token', 'Dán token')} done={st.hasToken}>
          <div className="flex gap-2">
            <div className="relative flex-1">
              <KeyRound className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-faint" />
              <Input
                type="password"
                autoComplete="off"
                spellCheck={false}
                value={token}
                onChange={(e) => setToken(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && token.trim() && void saveToken()}
                placeholder={
                  st.hasToken
                    ? L('Paste a new token to replace the current bot', 'Dán token mới để thay bot hiện tại')
                    : L('Paste the bot token', 'Dán token của bot')
                }
                className="pl-9"
                aria-label={L('Bot token', 'Token bot')}
                data-testid="tg-token-input"
              />
            </div>
            <Button
              variant="primary"
              disabled={!token.trim()}
              loading={saving}
              onClick={saveToken}
              data-testid="tg-token-save"
            >
              {L('Verify & save', 'Xác minh & lưu')}
            </Button>
          </div>
          <p className="mt-2 flex items-center gap-1.5 text-xs text-faint">
            <ShieldCheck className="size-3.5" />
            {L(
              'The token is checked with Telegram, then encrypted with Windows. Never share it – it controls your bot.',
              'Token được kiểm tra với Telegram rồi mã hóa bằng Windows. Đừng chia sẻ token – ai có token đều điều khiển được bot.',
            )}
          </p>
          {error && (
            <div className="mt-2" data-testid="tg-token-error">
              <ErrorState error={error} compact />
            </div>
          )}
          {st.hasToken && (
            <Button
              className="mt-3"
              size="sm"
              variant="danger"
              icon={<Trash2 className="size-4" />}
              onClick={() => setConfirm('remove')}
              data-testid="tg-remove-token"
            >
              {L('Remove bot token', 'Xóa token bot')}
            </Button>
          )}
        </Step>

        <Step n={3} title={L('Link your Telegram account', 'Liên kết tài khoản Telegram')} done={st.chatLinked}>
          {!st.hasToken ? (
            <p>{L('Available after step 2.', 'Làm được sau bước 2.')}</p>
          ) : st.chatLinked ? (
            <div className="space-y-3" data-testid="tg-linked">
              <p className="flex items-center gap-2 text-success">
                <CheckCircle2 className="size-4" />
                {L('Linked. The bot answers only your account.', 'Đã liên kết. Bot chỉ trả lời tài khoản của bạn.')}
              </p>
              <div className="flex flex-wrap gap-2">
                <Button icon={<Send className="size-4" />} loading={testing} onClick={runTest} data-testid="tg-test">
                  {L('Send a test message', 'Gửi tin nhắn thử')}
                </Button>
                <Button
                  variant="ghost"
                  icon={<Link2Off className="size-4" />}
                  onClick={() => setConfirm('unlink')}
                  data-testid="tg-unlink"
                >
                  {L('Unlink account', 'Hủy liên kết')}
                </Button>
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              <p>
                {L('Open ', 'Mở ')}
                {st.botUsername ? (
                  <button
                    className="font-medium text-accent hover:underline"
                    onClick={() => open(`https://t.me/${st.botUsername}`)}
                  >
                    @{st.botUsername}
                  </button>
                ) : (
                  L('your bot', 'bot của bạn')
                )}
                {L(', press Start and send this code:', ', bấm Start rồi gửi mã này:')}
              </p>
              <div
                className="inline-flex items-center rounded-xl border border-line bg-surface-2 px-6 py-3 font-mono text-4xl font-semibold tracking-[0.3em] text-text"
                data-testid="tg-pairing-code"
              >
                {st.pairingCode}
              </div>
              <p className="text-xs text-faint">
                {L('Or send ', 'Hoặc gửi ')}
                <code className="rounded bg-surface-3 px-1">/start {st.pairingCode}</code>
                {L(
                  '. This page updates by itself once the bot receives the code. Lingua Quest must be running.',
                  '. Trang này tự cập nhật khi bot nhận được mã. Lingua Quest phải đang chạy.',
                )}
              </p>
            </div>
          )}
        </Step>
      </Card>

      {/* ---------- pictures ---------- */}
      <Card>
        <h3 className="mb-1 flex items-center gap-2 font-semibold">
          <ImageIcon className="size-4 text-accent" />
          {L('Pictures (/anh)', 'Tạo ảnh (/anh)')}
        </h3>
        <p className="mb-4 text-sm text-muted">
          {L(
            'Send /anh <description> or write "vẽ …" to get an illustration for your vocabulary.',
            'Gõ /anh <mô tả> hoặc nhắn "vẽ …" để nhận ảnh minh họa cho từ vựng.',
          )}
        </p>
        <div role="radiogroup" aria-label={L('Image provider', 'Cách tạo ảnh')} className="grid gap-2 md:grid-cols-3">
          {providers.map((p) => {
            const active = st.imageProvider === p.id
            return (
              <button
                key={p.id}
                role="radio"
                aria-checked={active}
                onClick={() => void setProvider(p.id)}
                data-testid={`tg-image-${p.id}`}
                className={cx(
                  'rounded-md border p-3 text-left transition-colors',
                  active ? 'border-accent bg-accent/10' : 'border-line bg-surface-2 hover:border-line-strong',
                )}
              >
                <div className="flex items-center gap-2 text-sm font-semibold">
                  <span
                    className={cx(
                      'inline-block size-3.5 rounded-full border-2',
                      active ? 'border-accent bg-accent' : 'border-line-strong',
                    )}
                  />
                  {p.title}
                </div>
                <p className="mt-1 text-xs text-muted">{p.desc}</p>
              </button>
            )
          })}
        </div>
        {st.imageProvider === 'pollinations' && (
          <p className="mt-3 flex items-start gap-1.5 text-xs text-faint" data-testid="tg-privacy-note">
            <ShieldCheck className="mt-0.5 size-3.5 shrink-0" />
            {L(
              'Privacy: only the English picture description is sent to pollinations.ai – never your messages or personal data. Do not put personal information in drawing requests.',
              'Riêng tư: chỉ mô tả ảnh bằng tiếng Anh được gửi tới pollinations.ai – không gửi tin nhắn hay dữ liệu cá nhân. Đừng đưa thông tin cá nhân vào yêu cầu vẽ.',
            )}
          </p>
        )}
        {st.imageProvider === 'gemini' && (
          <div className="mt-4 max-w-md">
            <Field
              label={L('Gemini image model', 'Model ảnh Gemini')}
              hint={L('Default: gemini-2.5-flash-image', 'Mặc định: gemini-2.5-flash-image')}
            >
              <Input
                value={model}
                onChange={(e) => setModel(e.target.value)}
                onBlur={() => void saveModel()}
                onKeyDown={(e) => e.key === 'Enter' && void saveModel()}
                spellCheck={false}
                data-testid="tg-image-model"
              />
            </Field>
          </div>
        )}
      </Card>

      {/* ---------- background ---------- */}
      {settings && (
        <Card>
          <h3 className="mb-1 flex items-center gap-2 font-semibold">
            <Power className="size-4 text-accent" />
            {L('Keep the bot available', 'Giữ bot luôn sẵn sàng')}
          </h3>
          <p className="text-sm text-muted">
            {L(
              'The bot only works while Lingua Quest is running. Messages sent while the computer is off are answered when the app starts again.',
              'Bot chỉ hoạt động khi Lingua Quest đang chạy. Tin nhắn gửi lúc máy tắt sẽ được trả lời khi app mở lại.',
            )}
          </p>
          <div className="mt-2 flex items-center justify-between gap-6 border-b border-line py-4">
            <div>
              <div className="text-sm font-medium">
                {L('Keep running when the window is closed', 'Chạy ngầm khi đóng cửa sổ')}
              </div>
              <div className="mt-0.5 text-xs text-muted">
                {L('Lingua Quest stays in the system tray.', 'Lingua Quest nằm ở khay hệ thống.')}
              </div>
            </div>
            <div data-testid="tg-run-in-background">
              <Toggle
                checked={settings.runInBackground}
                onChange={(v) => setApp('runInBackground', v)}
                label={L('Keep running when the window is closed', 'Chạy ngầm khi đóng cửa sổ')}
              />
            </div>
          </div>
          <div className="flex items-center justify-between gap-6 pt-4">
            <div>
              <div className="text-sm font-medium">{L('Start with Windows', 'Khởi động cùng Windows')}</div>
              <div className="mt-0.5 text-xs text-muted">
                {L('Starts hidden in the tray when you sign in.', 'Tự chạy ẩn trong khay khi bạn đăng nhập Windows.')}
              </div>
            </div>
            <div data-testid="tg-launch-at-login">
              <Toggle
                checked={settings.launchAtLogin}
                onChange={(v) => setApp('launchAtLogin', v)}
                label={L('Start with Windows', 'Khởi động cùng Windows')}
              />
            </div>
          </div>
          {st.lastErrorCode === 'conflict' && (
            <p className="mt-3 text-xs text-warning">
              {L(
                'If the old Python bot still runs from Task Scheduler ("IELTS Telegram chatbot"), disable that task – only one program can use a bot at a time.',
                'Nếu bot Python cũ vẫn chạy bằng Task Scheduler ("IELTS Telegram chatbot"), hãy tắt tác vụ đó – mỗi bot chỉ một chương trình dùng được.',
              )}
            </p>
          )}
        </Card>
      )}

      {/* ---------- commands ---------- */}
      <Card>
        <h3 className="mb-3 font-semibold">{L('Bot commands', 'Lệnh của bot')}</h3>
        <ul className="grid gap-x-6 gap-y-1.5 text-sm md:grid-cols-2" data-testid="tg-commands">
          {st.commands.map((c) => (
            <li key={c.name} className="flex gap-2">
              <code className="shrink-0 text-accent">/{c.name}</code>
              <span className="text-muted">{L(c.description.en, c.description.vi)}</span>
            </li>
          ))}
        </ul>
      </Card>

      <ConfirmDialog
        open={confirm !== null}
        title={
          confirm === 'remove'
            ? L('Remove the bot token?', 'Xóa token bot?')
            : L('Unlink your Telegram account?', 'Hủy liên kết tài khoản Telegram?')
        }
        body={
          confirm === 'remove'
            ? L(
                'The encrypted token is deleted from this computer and the bot stops answering.',
                'Token đã mã hóa bị xóa khỏi máy này và bot ngừng trả lời.',
              )
            : L(
                'The bot stops answering this account until you pair it again with a new code.',
                'Bot ngừng trả lời tài khoản này cho tới khi bạn liên kết lại bằng mã mới.',
              )
        }
        confirmLabel={confirm === 'remove' ? L('Remove token', 'Xóa token') : L('Unlink', 'Hủy liên kết')}
        danger
        onConfirm={() => void confirmAction()}
        onCancel={() => setConfirm(null)}
      />
    </div>
  )
}
