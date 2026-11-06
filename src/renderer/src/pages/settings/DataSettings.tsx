// Backups, restore and import/export of learning data.
import { Archive, Download, FolderOpen, History, Trash2, Upload } from 'lucide-react'
import { useState } from 'react'
import type { BackupInfo } from '@shared/types'
import { Button, Card, ConfirmDialog, EmptyState, ErrorState, LoadingBlock } from '../../components/ui'
import { useFormat, useL } from '../../i18n'
import { api, toApiError, useApi } from '../../lib/api'
import { useApp } from '../../lib/store'

const size = (b: number) =>
  b > 1_048_576 ? `${(b / 1_048_576).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`

export function DataSettings() {
  const L = useL()
  const f = useFormat()
  const toast = useApp((s) => s.toast)
  const { data: backups, error, loading, reload, setData } = useApi('data:backups', undefined)
  const [busy, setBusy] = useState<string | null>(null)
  const [restore, setRestore] = useState<BackupInfo | 'file' | null>(null)
  const [remove, setRemove] = useState<BackupInfo | null>(null)

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
    <div className="space-y-6">
      <Card>
        <h3 className="flex items-center gap-2 font-semibold">
          <Archive className="size-4 text-accent" />
          {L('Backups', 'Sao lưu')}
        </h3>
        <p className="mt-1 text-sm text-muted">
          {L(
            'B&T English saves an automatic backup once a day (last 10 kept). API keys are never included.',
            'B&T English tự sao lưu mỗi ngày một lần (giữ 10 bản gần nhất). API key không bao giờ nằm trong bản sao lưu.',
          )}
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          <Button
            variant="primary"
            loading={busy === 'backup'}
            data-testid="backup-create"
            onClick={() =>
              run('backup', async () => {
                await api('data:createBackup')
                toast({ kind: 'success', title: L('Backup created', 'Đã tạo bản sao lưu') })
                await reload()
              })
            }
          >
            {L('Back up now', 'Sao lưu ngay')}
          </Button>
          <Button icon={<Upload className="size-4" />} onClick={() => setRestore('file')}>
            {L('Restore from file…', 'Khôi phục từ file…')}
          </Button>
          <Button
            variant="ghost"
            icon={<FolderOpen className="size-4" />}
            onClick={() => api('app:openFolder', { which: 'backups' }).catch(() => undefined)}
          >
            {L('Open folder', 'Mở thư mục')}
          </Button>
        </div>
        <div className="mt-5">
          {loading && !backups ? (
            <LoadingBlock rows={2} />
          ) : error ? (
            <ErrorState error={error} onRetry={reload} />
          ) : !backups?.length ? (
            <EmptyState icon={<History />} title={L('No backups yet', 'Chưa có bản sao lưu')} />
          ) : (
            <ul className="divide-y divide-line rounded-xl border border-line" data-testid="backup-list">
              {backups.map((b) => (
                <li key={b.file} className="flex items-center gap-3 px-4 py-3 text-sm">
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-medium">{b.name}</div>
                    <div className="text-xs text-muted">
                      {f.date(b.createdAt, {
                        day: 'numeric',
                        month: 'short',
                        year: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit',
                      })}{' '}
                      · {size(b.sizeBytes)}
                    </div>
                  </div>
                  <Button size="sm" onClick={() => setRestore(b)}>
                    {L('Restore', 'Khôi phục')}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    aria-label={L('Delete backup', 'Xóa bản sao lưu')}
                    onClick={() => setRemove(b)}
                  >
                    <Trash2 className="size-4" />
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </Card>

      <Card>
        <h3 className="flex items-center gap-2 font-semibold">
          <Download className="size-4 text-accent" />
          {L('Import & export', 'Nhập & xuất dữ liệu')}
        </h3>
        <div className="mt-4 grid gap-3 md:grid-cols-3">
          <Button
            loading={busy === 'json'}
            onClick={() =>
              run('json', async () => {
                const res = await api('data:exportJson')
                if (res) toast({ kind: 'success', title: L('Exported', 'Đã xuất dữ liệu'), body: res.file })
              })
            }
          >
            {L('Export all data (JSON)', 'Xuất toàn bộ dữ liệu (JSON)')}
          </Button>
          <Button
            loading={busy === 'csv'}
            onClick={() =>
              run('csv', async () => {
                const res = await api('data:exportVocabCsv')
                if (res) toast({ kind: 'success', title: L('Vocabulary exported', 'Đã xuất từ vựng'), body: res.file })
              })
            }
          >
            {L('Export vocabulary (CSV)', 'Xuất từ vựng (CSV)')}
          </Button>
          <Button
            loading={busy === 'import'}
            onClick={() =>
              run('import', async () => {
                const res = await api('data:importVocab')
                if (res) {
                  toast({
                    kind: 'success',
                    title: L(`Imported ${res.added} new words`, `Đã nhập ${res.added} từ mới`),
                    body: L(
                      `${res.merged} merged, ${res.skipped} skipped`,
                      `${res.merged} từ gộp, ${res.skipped} dòng bỏ qua`,
                    ),
                  })
                  void useApp.getState().refreshGame()
                }
              })
            }
          >
            {L('Import words (CSV / JSON)', 'Nhập từ vựng (CSV / JSON)')}
          </Button>
        </div>
        <p className="mt-3 text-xs text-faint">
          {L(
            'CSV columns: word, meaning_vi, meaning_en, example (header row optional). Existing words are merged, never duplicated.',
            'Cột CSV: word, meaning_vi, meaning_en, example (dòng tiêu đề không bắt buộc). Từ đã có sẽ được gộp, không bị trùng.',
          )}
        </p>
      </Card>

      <ConfirmDialog
        open={restore !== null}
        title={L('Restore this backup?', 'Khôi phục bản sao lưu này?')}
        body={L(
          'Your current data will be replaced by the backup. A safety copy of the current data is created first, then the app restarts.',
          'Dữ liệu hiện tại sẽ được thay bằng bản sao lưu. Ứng dụng tạo một bản an toàn của dữ liệu hiện tại trước, sau đó khởi động lại.',
        )}
        confirmLabel={L('Restore and restart', 'Khôi phục và khởi động lại')}
        danger
        onCancel={() => setRestore(null)}
        onConfirm={() => {
          const target = restore
          setRestore(null)
          void run('restore', async () => {
            await api('data:restoreBackup', target === 'file' || !target ? {} : { file: target.file })
          })
        }}
      />
      <ConfirmDialog
        open={remove !== null}
        title={L('Delete this backup?', 'Xóa bản sao lưu này?')}
        body={remove?.name ?? ''}
        confirmLabel={L('Delete', 'Xóa')}
        danger
        onCancel={() => setRemove(null)}
        onConfirm={() => {
          const target = remove
          setRemove(null)
          if (target) void run('delete', async () => setData(await api('data:deleteBackup', { file: target.file })))
        }}
      />
    </div>
  )
}
