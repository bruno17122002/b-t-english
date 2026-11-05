// Optional online account (Supabase): server config, sign-in with an e-mailed 6-digit code, multi-device sync,
// cloud backups and "delete all my cloud data". The app works fully offline without any of this.
import {
  Cloud,
  CloudOff,
  CloudUpload,
  History,
  LogOut,
  Mail,
  MonitorSmartphone,
  RefreshCw,
  Server,
  ShieldAlert,
  Trash2,
} from 'lucide-react'
import { useState, type ReactNode } from 'react'
import type { CloudBackupView, CloudStatusView, SyncStatusView } from '@shared/kernelContract'
import {
  Badge,
  Button,
  Card,
  ConfirmDialog,
  EmptyState,
  ErrorState,
  Field,
  Input,
  LoadingBlock,
  Toggle,
} from '../../components/ui'
import { useFormat, useL } from '../../i18n'
import { api, toApiError, useApi } from '../../lib/api'
import { useApp } from '../../lib/store'

const size = (b: number) =>
  b > 1_048_576 ? `${(b / 1_048_576).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`

function SectionTitle({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return (
    <h3 className="flex items-center gap-2 font-semibold">
      <span className="text-accent [&>svg]:size-4">{icon}</span>
      {children}
    </h3>
  )
}

export function AccountSettings() {
  const L = useL()
  const status = useApi('cloud:status', undefined)
  const st = status.data

  if (status.loading && !st) return <LoadingBlock rows={4} />
  if (status.error && !st) return <ErrorState error={status.error} onRetry={status.reload} />
  if (!st) return null

  return (
    <div className="space-y-6" data-testid="account-settings">
      <Card>
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="font-display text-lg font-semibold">{L('Online account', 'Tài khoản online')}</h3>
          {st.signedIn ? (
            <Badge tone="success">{L('Signed in', 'Đã đăng nhập')}</Badge>
          ) : st.configured ? (
            <Badge>{L('Not signed in', 'Chưa đăng nhập')}</Badge>
          ) : (
            <Badge>{L('Not set up', 'Chưa thiết lập')}</Badge>
          )}
        </div>
        <p className="mt-1 text-sm text-muted">
          {L(
            'Optional. Lingua Quest keeps working offline without an account. Signed in, your words, reviews and progress sync between your PCs, the Telegram bot and the phone app, and you can keep backups in the cloud. Your AI API keys never leave this PC.',
            'Không bắt buộc. Không có tài khoản, Lingua Quest vẫn chạy offline đầy đủ. Khi đăng nhập, từ vựng, lượt ôn và tiến độ được đồng bộ giữa các máy, bot Telegram và app điện thoại, và bạn có thể sao lưu lên cloud. API key AI không bao giờ rời khỏi máy này.',
          )}
        </p>
      </Card>

      <ServerCard status={st} onChange={status.setData} />
      {st.configured && <SignInCard status={st} onChange={status.setData} />}
      {st.signedIn && (
        <>
          <SyncCard />
          <BackupsCard />
          <DevicesCard />
          <DangerCard onChange={status.setData} />
        </>
      )}
    </div>
  )
}

// ---------- server ----------
function ServerCard({ status, onChange }: { status: CloudStatusView; onChange: (s: CloudStatusView) => void }) {
  const L = useL()
  const toast = useApp((s) => s.toast)
  const [editing, setEditing] = useState(!status.configured)
  const [url, setUrl] = useState(status.url ?? '')
  const [key, setKey] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const save = async () => {
    setBusy(true)
    setError(null)
    try {
      onChange(await api('cloud:configure', { url: url.trim(), anonKey: key.trim() }))
      setKey('')
      setEditing(false)
      toast({ kind: 'success', title: L('Server saved', 'Đã lưu máy chủ') })
    } catch (err) {
      setError(toApiError(err).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card data-testid="account-server">
      <SectionTitle icon={<Server />}>{L('Server (Supabase)', 'Máy chủ (Supabase)')}</SectionTitle>
      {!editing ? (
        <div className="mt-3 flex flex-wrap items-center gap-3 text-sm">
          <span className="min-w-0 flex-1 truncate font-medium" data-testid="account-server-url">
            {status.url}
          </span>
          <Button size="sm" variant="ghost" onClick={() => setEditing(true)} data-testid="account-server-edit">
            {L('Change server', 'Đổi máy chủ')}
          </Button>
        </div>
      ) : (
        <div className="mt-3 space-y-4">
          <div className="rounded-md border border-line bg-surface-2 p-3 text-sm text-muted">
            <p>
              {L(
                'Create a free project at supabase.com (region Singapore), run the SQL in supabase/migrations, then open Project Settings → API and copy:',
                'Tạo project miễn phí tại supabase.com (chọn region Singapore), chạy SQL trong supabase/migrations, rồi mở Project Settings → API và sao chép:',
              )}
            </p>
            <ul className="mt-1.5 list-disc space-y-0.5 pl-5">
              <li>
                <b className="text-text">Project URL</b> – {L('e.g. ', 'ví dụ ')}
                <code className="rounded bg-surface-3 px-1">https://abcd1234.supabase.co</code>
              </li>
              <li>
                <b className="text-text">anon public key</b> –{' '}
                {L(
                  'this is a public key: it is safe to paste here. Your data is protected by Row Level Security and your sign-in.',
                  'đây là khóa công khai, dán vào app là an toàn. Dữ liệu của bạn được bảo vệ bằng Row Level Security và việc đăng nhập.',
                )}
              </li>
            </ul>
            <p className="mt-1.5 text-xs text-faint">
              {L(
                'Never paste the service_role key – it is secret and only belongs in the server functions.',
                'Đừng bao giờ dán khóa service_role – đó là khóa bí mật, chỉ dùng trong các function trên server.',
              )}
            </p>
          </div>
          <Field label="Project URL">
            <Input
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://xxxx.supabase.co"
              spellCheck={false}
              data-testid="account-config-url"
            />
          </Field>
          <Field
            label={L('Anon key (public)', 'Anon key (khóa công khai)')}
            hint={
              status.configured
                ? L('Enter the key again to change the server.', 'Nhập lại key để đổi máy chủ.')
                : undefined
            }
          >
            <Input
              value={key}
              onChange={(e) => setKey(e.target.value)}
              placeholder="eyJhbGciOi…"
              spellCheck={false}
              autoComplete="off"
              data-testid="account-config-key"
            />
          </Field>
          {error && <ErrorState error={error} compact />}
          <div className="flex gap-2">
            <Button
              variant="primary"
              loading={busy}
              disabled={!url.trim() || key.trim().length < 20}
              onClick={() => void save()}
              data-testid="account-config-save"
            >
              {L('Save server', 'Lưu máy chủ')}
            </Button>
            {status.configured && (
              <Button variant="ghost" onClick={() => setEditing(false)}>
                {L('Cancel', 'Hủy')}
              </Button>
            )}
          </div>
        </div>
      )}
    </Card>
  )
}

// ---------- sign-in ----------
function SignInCard({ status, onChange }: { status: CloudStatusView; onChange: (s: CloudStatusView) => void }) {
  const L = useL()
  const toast = useApp((s) => s.toast)
  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [sent, setSent] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const run = async (id: string, fn: () => Promise<void>) => {
    setBusy(id)
    setError(null)
    try {
      await fn()
    } catch (err) {
      setError(toApiError(err).message)
    } finally {
      setBusy(null)
    }
  }

  if (status.signedIn)
    return (
      <Card data-testid="account-signed-in">
        <SectionTitle icon={<Cloud />}>{L('Account', 'Tài khoản')}</SectionTitle>
        <div className="mt-3 flex flex-wrap items-center gap-3 text-sm">
          <div className="min-w-0 flex-1">
            <div className="truncate font-medium" data-testid="account-email">
              {status.email}
            </div>
            <div className="text-xs text-faint">
              {L('This PC is registered as a sync device.', 'Máy này đã được đăng ký là thiết bị đồng bộ.')}
            </div>
          </div>
          <Button
            icon={<LogOut className="size-4" />}
            loading={busy === 'out'}
            data-testid="account-signout"
            onClick={() =>
              void run('out', async () => {
                onChange(await api('cloud:signOut'))
                toast({ kind: 'success', title: L('Signed out', 'Đã đăng xuất') })
              })
            }
          >
            {L('Sign out', 'Đăng xuất')}
          </Button>
        </div>
        {error && (
          <div className="mt-3">
            <ErrorState error={error} compact />
          </div>
        )}
      </Card>
    )

  return (
    <Card data-testid="account-signin">
      <SectionTitle icon={<Mail />}>{L('Sign in with your e-mail', 'Đăng nhập bằng email')}</SectionTitle>
      <p className="mt-1 text-sm text-muted">
        {L(
          'We e-mail you a 6-digit code – no password needed. The same e-mail signs you in on the phone app.',
          'Bạn sẽ nhận một mã 6 số qua email, không cần mật khẩu. Dùng cùng email này để đăng nhập trên app điện thoại.',
        )}
      </p>
      <div className="mt-4 space-y-3">
        <div className="flex flex-wrap items-end gap-2">
          <div className="min-w-60 flex-1">
            <Field label="Email">
              <Input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="ban@example.com"
                data-testid="account-email-input"
              />
            </Field>
          </div>
          <Button
            variant={sent ? 'secondary' : 'primary'}
            loading={busy === 'send'}
            disabled={!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim())}
            data-testid="account-send-code"
            onClick={() =>
              void run('send', async () => {
                await api('cloud:sendCode', { email: email.trim() })
                setSent(true)
                toast({ kind: 'success', title: L('Code sent – check your inbox', 'Đã gửi mã – kiểm tra hộp thư') })
              })
            }
          >
            {sent ? L('Send again', 'Gửi lại mã') : L('Send code', 'Gửi mã')}
          </Button>
        </div>
        {sent && (
          <div className="flex flex-wrap items-end gap-2">
            <div className="w-48">
              <Field label={L('6-digit code', 'Mã 6 số')}>
                <Input
                  className="w-48 text-center font-mono tracking-[0.3em]"
                  inputMode="numeric"
                  maxLength={8}
                  value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
                  placeholder="000000"
                  data-testid="account-code-input"
                />
              </Field>
            </div>
            <Button
              variant="primary"
              loading={busy === 'verify'}
              disabled={code.length < 6}
              data-testid="account-verify"
              onClick={() =>
                void run('verify', async () => {
                  const next = await api('cloud:verifyCode', { email: email.trim(), code })
                  onChange(next)
                  setCode('')
                  toast({ kind: 'success', title: L('Signed in', 'Đã đăng nhập') })
                  // First sync uploads this PC's data and pulls what other devices saved.
                  void api('sync:now').catch(() => undefined)
                })
              }
            >
              {L('Sign in', 'Đăng nhập')}
            </Button>
          </div>
        )}
        {error && <ErrorState error={error} compact />}
      </div>
    </Card>
  )
}

// ---------- sync ----------
function SyncCard() {
  const L = useL()
  const f = useFormat()
  const toast = useApp((s) => s.toast)
  const sync = useApi('sync:status', undefined)
  const [busy, setBusy] = useState(false)
  const s = sync.data

  const syncNow = async () => {
    setBusy(true)
    try {
      sync.setData(await api('sync:now'))
      toast({ kind: 'success', title: L('Synced', 'Đã đồng bộ') })
      void useApp.getState().refreshGame()
    } catch (err) {
      toast({ kind: 'error', title: toApiError(err).message })
      await sync.reload()
    } finally {
      setBusy(false)
    }
  }

  const setSetting = async (patch: { autoSync?: boolean; dailyCloudBackup?: boolean }) => {
    try {
      const next = await api('sync:settings', patch)
      sync.setData((prev) => ({ ...(prev as SyncStatusView), ...next }))
    } catch (err) {
      toast({ kind: 'error', title: toApiError(err).message })
    }
  }

  return (
    <Card data-testid="sync-panel">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <SectionTitle icon={<RefreshCw />}>{L('Sync between devices', 'Đồng bộ giữa các thiết bị')}</SectionTitle>
        <Button
          variant="primary"
          size="sm"
          icon={<RefreshCw className="size-4" />}
          loading={busy || s?.running}
          onClick={() => void syncNow()}
          data-testid="sync-now"
        >
          {L('Sync now', 'Đồng bộ ngay')}
        </Button>
      </div>
      {!s ? (
        sync.error ? (
          <div className="mt-3">
            <ErrorState error={sync.error} compact onRetry={sync.reload} />
          </div>
        ) : (
          <LoadingBlock rows={2} />
        )
      ) : (
        <>
          <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-3" data-testid="sync-status">
            <div className="rounded-md border border-line bg-surface-2 p-3">
              <dt className="text-xs text-faint">{L('Status', 'Trạng thái')}</dt>
              <dd className="mt-0.5 font-medium">
                {s.running
                  ? L('Syncing…', 'Đang đồng bộ…')
                  : s.lastError
                    ? L('Error', 'Lỗi')
                    : s.lastSyncAt
                      ? L('Up to date', 'Đã cập nhật')
                      : L('Not synced yet', 'Chưa đồng bộ lần nào')}
              </dd>
            </div>
            <div className="rounded-md border border-line bg-surface-2 p-3">
              <dt className="text-xs text-faint">{L('Last sync', 'Lần đồng bộ cuối')}</dt>
              <dd className="mt-0.5 font-medium" data-testid="sync-last">
                {s.lastSyncAt ? `${f.relative(s.lastSyncAt)} · ${f.time(s.lastSyncAt)}` : '—'}
              </dd>
            </div>
            <div className="rounded-md border border-line bg-surface-2 p-3">
              <dt className="text-xs text-faint">{L('Waiting to upload', 'Thay đổi chờ gửi')}</dt>
              <dd className="mt-0.5 font-medium" data-testid="sync-pending">
                {f.number(s.pending)}
              </dd>
            </div>
          </dl>
          {s.lastError && (
            <div className="mt-3" data-testid="sync-error">
              <ErrorState error={s.lastError} compact />
            </div>
          )}
          <div className="mt-4 space-y-3">
            <label className="flex items-center justify-between gap-4 text-sm">
              <span>
                <span className="font-medium">{L('Sync automatically', 'Tự động đồng bộ')}</span>
                <span className="block text-xs text-faint">
                  {L(
                    'When the app starts, every 5 minutes and when it closes.',
                    'Khi mở app, mỗi 5 phút và khi đóng app.',
                  )}
                </span>
              </span>
              <span data-testid="sync-auto-toggle">
                <Toggle
                  checked={s.autoSync}
                  onChange={(v) => void setSetting({ autoSync: v })}
                  label={L('Sync automatically', 'Tự động đồng bộ')}
                />
              </span>
            </label>
            <label className="flex items-center justify-between gap-4 text-sm">
              <span>
                <span className="font-medium">{L('Daily cloud backup', 'Sao lưu cloud hằng ngày')}</span>
                <span className="block text-xs text-faint">
                  {L('Keeps the last 20 backups in your account.', 'Giữ 20 bản sao lưu gần nhất trong tài khoản.')}
                </span>
              </span>
              <span data-testid="sync-backup-toggle">
                <Toggle
                  checked={s.dailyCloudBackup}
                  onChange={(v) => void setSetting({ dailyCloudBackup: v })}
                  label={L('Daily cloud backup', 'Sao lưu cloud hằng ngày')}
                />
              </span>
            </label>
          </div>
        </>
      )}
    </Card>
  )
}

// ---------- cloud backups ----------
function BackupsCard() {
  const L = useL()
  const f = useFormat()
  const toast = useApp((s) => s.toast)
  const backups = useApi('cloud:backups', undefined)
  const [busy, setBusy] = useState<string | null>(null)
  const [restore, setRestore] = useState<CloudBackupView | null>(null)
  const [remove, setRemove] = useState<CloudBackupView | null>(null)

  const run = async (id: string, fn: () => Promise<void>) => {
    setBusy(id)
    try {
      await fn()
    } catch (err) {
      toast({ kind: 'error', title: toApiError(err).message })
    } finally {
      setBusy(null)
    }
  }

  return (
    <Card data-testid="cloud-backups">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <SectionTitle icon={<CloudUpload />}>{L('Cloud backups', 'Sao lưu cloud')}</SectionTitle>
        <Button
          size="sm"
          variant="primary"
          loading={busy === 'create'}
          data-testid="cloud-backup-create"
          onClick={() =>
            void run('create', async () => {
              await api('cloud:createBackup')
              toast({ kind: 'success', title: L('Backup uploaded', 'Đã tải bản sao lưu lên cloud') })
              await backups.reload()
            })
          }
        >
          {L('Back up to cloud', 'Sao lưu lên cloud')}
        </Button>
      </div>
      <p className="mt-1 text-sm text-muted">
        {L(
          'The same file as a local backup, stored privately in your account. API keys are never included.',
          'Cùng loại file với bản sao lưu trên máy, lưu riêng tư trong tài khoản của bạn. API key không bao giờ nằm trong đó.',
        )}
      </p>
      <div className="mt-4">
        {backups.loading && !backups.data ? (
          <LoadingBlock rows={2} />
        ) : backups.error ? (
          <ErrorState error={backups.error} compact onRetry={backups.reload} />
        ) : !backups.data?.length ? (
          <EmptyState icon={<History />} title={L('No cloud backups yet', 'Chưa có bản sao lưu cloud')} />
        ) : (
          <ul className="divide-y divide-line rounded-md border border-line" data-testid="cloud-backup-list">
            {backups.data.map((b) => (
              <li key={b.name} className="flex items-center gap-3 px-4 py-3 text-sm">
                <div className="min-w-0 flex-1">
                  <div className="truncate font-medium">{b.name}</div>
                  <div className="text-xs text-muted">
                    {b.createdAt
                      ? f.date(b.createdAt, {
                          day: 'numeric',
                          month: 'short',
                          year: 'numeric',
                          hour: '2-digit',
                          minute: '2-digit',
                        })
                      : ''}{' '}
                    · {size(b.sizeBytes)}
                  </div>
                </div>
                <Button size="sm" onClick={() => setRestore(b)} disabled={busy !== null}>
                  {L('Restore', 'Khôi phục')}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  aria-label={L('Delete backup', 'Xóa bản sao lưu')}
                  onClick={() => setRemove(b)}
                  disabled={busy !== null}
                >
                  <Trash2 className="size-4" />
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>
      <ConfirmDialog
        open={restore !== null}
        title={L('Restore this cloud backup?', 'Khôi phục bản sao lưu cloud này?')}
        body={L(
          'Your current data will be replaced by the backup. A safety copy of the current data is saved on this PC first, then the app restarts. Newer changes from your other devices sync back afterwards.',
          'Dữ liệu hiện tại sẽ được thay bằng bản sao lưu. Ứng dụng lưu một bản an toàn của dữ liệu hiện tại trên máy trước, sau đó khởi động lại. Các thay đổi mới hơn từ thiết bị khác sẽ được đồng bộ lại sau đó.',
        )}
        confirmLabel={L('Restore and restart', 'Khôi phục và khởi động lại')}
        danger
        onCancel={() => setRestore(null)}
        onConfirm={() => {
          const target = restore
          setRestore(null)
          if (target) void run('restore', async () => void (await api('cloud:restoreBackup', { name: target.name })))
        }}
      />
      <ConfirmDialog
        open={remove !== null}
        title={L('Delete this cloud backup?', 'Xóa bản sao lưu cloud này?')}
        body={remove?.name ?? ''}
        confirmLabel={L('Delete', 'Xóa')}
        danger
        onCancel={() => setRemove(null)}
        onConfirm={() => {
          const target = remove
          setRemove(null)
          if (target)
            void run('delete', async () => backups.setData(await api('cloud:deleteBackup', { name: target.name })))
        }}
      />
    </Card>
  )
}

// ---------- devices ----------
function DevicesCard() {
  const L = useL()
  const f = useFormat()
  const devices = useApi('cloud:devices', undefined)
  return (
    <Card data-testid="account-devices">
      <SectionTitle icon={<MonitorSmartphone />}>{L('Devices', 'Thiết bị')}</SectionTitle>
      <div className="mt-3">
        {devices.loading && !devices.data ? (
          <LoadingBlock rows={1} />
        ) : devices.error ? (
          <ErrorState error={devices.error} compact onRetry={devices.reload} />
        ) : !devices.data?.length ? (
          <p className="text-sm text-muted">
            {L('No device registered yet – press "Sync now".', 'Chưa có thiết bị nào – bấm "Đồng bộ ngay".')}
          </p>
        ) : (
          <ul className="divide-y divide-line rounded-md border border-line">
            {devices.data.map((d) => (
              <li key={d.id} className="flex items-center gap-3 px-4 py-2.5 text-sm">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 truncate font-medium">
                    {d.name}
                    {d.current && <Badge tone="success">{L('This PC', 'Máy này')}</Badge>}
                  </div>
                  <div className="text-xs text-faint">
                    {d.platform}
                    {d.appVersion ? ` · v${d.appVersion}` : ''}
                    {d.lastSeenAt ? ` · ${f.relative(d.lastSeenAt)}` : ''}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Card>
  )
}

// ---------- danger zone ----------
function DangerCard({ onChange }: { onChange: (s: CloudStatusView) => void }) {
  const L = useL()
  const toast = useApp((s) => s.toast)
  const [confirm, setConfirm] = useState(false)
  const [busy, setBusy] = useState(false)
  return (
    <Card data-testid="account-danger">
      <SectionTitle icon={<ShieldAlert />}>{L('Privacy', 'Quyền riêng tư')}</SectionTitle>
      <p className="mt-1 text-sm text-muted">
        {L(
          'Deletes everything stored for your account on the server: synced data, devices, cloud backups, Telegram link and bot history. The data on this PC is kept.',
          'Xóa mọi thứ lưu cho tài khoản của bạn trên server: dữ liệu đồng bộ, thiết bị, bản sao lưu cloud, liên kết Telegram và lịch sử bot. Dữ liệu trên máy này vẫn được giữ.',
        )}
      </p>
      <Button
        className="mt-4"
        variant="danger"
        icon={<CloudOff className="size-4" />}
        loading={busy}
        onClick={() => setConfirm(true)}
        data-testid="cloud-delete-data"
      >
        {L('Delete all cloud data', 'Xóa toàn bộ dữ liệu cloud')}
      </Button>
      <ConfirmDialog
        open={confirm}
        title={L('Delete all cloud data?', 'Xóa toàn bộ dữ liệu cloud?')}
        body={L(
          'This cannot be undone. You will be signed out on every device.',
          'Không thể hoàn tác. Bạn sẽ bị đăng xuất trên mọi thiết bị.',
        )}
        confirmLabel={L('Delete everything', 'Xóa tất cả')}
        danger
        onCancel={() => setConfirm(false)}
        onConfirm={() => {
          setConfirm(false)
          setBusy(true)
          void api('cloud:deleteMyData')
            .then((s) => {
              onChange(s)
              toast({ kind: 'success', title: L('Cloud data deleted', 'Đã xóa dữ liệu cloud') })
            })
            .catch((err: unknown) => toast({ kind: 'error', title: toApiError(err).message }))
            .finally(() => setBusy(false))
        }}
      />
    </Card>
  )
}
