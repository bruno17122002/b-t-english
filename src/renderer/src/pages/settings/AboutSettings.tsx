// Diagnostics (versions, paths, database, providers, logs) and credits.
import { Copy, FileText, FolderOpen, RefreshCw, Stethoscope } from 'lucide-react'
import { useState } from 'react'
import { Badge, Button, Card, ErrorState, LoadingBlock, Modal } from '../../components/ui'
import { useL } from '../../i18n'
import { api, useApi } from '../../lib/api'
import { useApp } from '../../lib/store'

export function AboutSettings() {
  const L = useL()
  const toast = useApp((s) => s.toast)
  const { data, error, loading, reload } = useApi('app:diagnostics', undefined)
  const [logs, setLogs] = useState<string | null>(null)

  if (loading && !data) return <LoadingBlock rows={4} />
  if (error || !data) return <ErrorState error={error ?? 'Error'} onRetry={reload} />

  const rows: [string, string][] = [
    [L('Version', 'Phiên bản'), data.appVersion],
    ['Electron / Chromium / Node', `${data.electron} / ${data.chrome} / ${data.node}`],
    [L('Platform', 'Nền tảng'), data.platform],
    [L('Data folder', 'Thư mục dữ liệu'), data.userDataPath],
    [
      L('Database', 'Cơ sở dữ liệu'),
      `${data.dbPath} (${Math.round(data.dbSizeBytes / 1024)} KB, schema v${data.schemaVersion})`,
    ],
    [
      L('Key encryption', 'Mã hóa key'),
      data.encryptionAvailable ? 'Windows DPAPI ✓' : L('Unavailable', 'Không khả dụng'),
    ],
    [
      'Gemini',
      `${data.aiProviders.gemini.hasKey ? L('key set', 'đã có key') : L('no key', 'chưa có key')} · ${data.aiProviders.gemini.model}`,
    ],
    [
      'OpenAI',
      `${data.aiProviders.openai.hasKey ? L('key set', 'đã có key') : L('no key', 'chưa có key')} · ${data.aiProviders.openai.model}`,
    ],
    [
      L('Internet', 'Internet'),
      data.online === null ? '?' : data.online ? L('online', 'đang kết nối') : L('offline', 'ngoại tuyến'),
    ],
    [L('Log file', 'File nhật ký'), data.logPath],
  ]
  const report = [
    ...rows.map(([k, v]) => `${k}: ${v}`),
    ...Object.entries(data.tableCounts).map(([k, v]) => `${k}: ${v}`),
  ].join('\n')

  return (
    <div className="space-y-6" data-testid="diagnostics">
      <Card>
        <div className="flex items-center justify-between">
          <h3 className="flex items-center gap-2 font-semibold">
            <Stethoscope className="size-4 text-accent" />
            {L('Diagnostics', 'Chẩn đoán')}
          </h3>
          <div className="flex gap-2">
            <Button size="sm" variant="ghost" icon={<RefreshCw className="size-4" />} onClick={reload}>
              {L('Refresh', 'Làm mới')}
            </Button>
            <Button
              size="sm"
              icon={<Copy className="size-4" />}
              onClick={() =>
                navigator.clipboard
                  .writeText(report)
                  .then(() => toast({ kind: 'success', title: L('Copied', 'Đã sao chép') }))
              }
            >
              {L('Copy report', 'Sao chép báo cáo')}
            </Button>
          </div>
        </div>
        <dl className="mt-4 grid grid-cols-[180px_1fr] gap-x-4 gap-y-2 text-sm">
          {rows.map(([k, v]) => (
            <div key={k} className="contents">
              <dt className="text-muted">{k}</dt>
              <dd className="font-mono text-xs break-all">{v}</dd>
            </div>
          ))}
        </dl>
        <div className="mt-4 flex flex-wrap gap-2">
          {Object.entries(data.tableCounts).map(([k, v]) => (
            <Badge key={k}>
              {k}: {v}
            </Badge>
          ))}
        </div>
        <div className="mt-4 flex gap-2">
          <Button size="sm" icon={<FileText className="size-4" />} onClick={async () => setLogs(await api('app:logs'))}>
            {L('View log', 'Xem nhật ký')}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            icon={<FolderOpen className="size-4" />}
            onClick={() => api('app:openFolder', { which: 'data' }).catch(() => undefined)}
          >
            {L('Open data folder', 'Mở thư mục dữ liệu')}
          </Button>
        </div>
      </Card>

      <Card>
        <h3 className="font-display text-lg font-semibold">Lingua Quest {data.appVersion}</h3>
        <p className="mt-2 text-sm text-muted">
          {L(
            'All lessons, stories, dialogues and the dictionary are original content written for Lingua Quest. Open-source parts are credited below.',
            'Toàn bộ bài học, phim tương tác, hội thoại và từ điển là nội dung gốc viết riêng cho Lingua Quest. Các phần mã nguồn mở được ghi công bên dưới.',
          )}
        </p>
        <ul className="mt-3 space-y-1 text-sm text-muted">
          <li>• Sprigo (MIT) — {L('course outline A1→C2', 'khung giáo trình A1→C2')}</li>
          <li>
            • Cadence (MIT) — {L('pronunciation path and phoneme alignment', 'lộ trình phát âm và căn chỉnh âm vị')}
          </li>
          <li>• ts-fsrs (MIT) — {L('spaced-repetition scheduling', 'thuật toán ôn tập ngắt quãng')}</li>
          <li>
            • VocabReader (MIT) — {L('ideas for contextual review prompts', 'ý tưởng prompt ôn từ theo ngữ cảnh')}
          </li>
        </ul>
        <p className="mt-2 text-xs text-faint">
          {L(
            'Full license texts: THIRD_PARTY_NOTICES.md in the installation folder.',
            'Toàn văn giấy phép: THIRD_PARTY_NOTICES.md trong thư mục cài đặt.',
          )}
        </p>
      </Card>

      <Modal open={logs !== null} onClose={() => setLogs(null)} title={L('Application log', 'Nhật ký ứng dụng')} wide>
        <pre className="max-h-[60vh] overflow-auto rounded-xl bg-surface-2 p-3 font-mono text-[11px] leading-relaxed whitespace-pre-wrap text-muted">
          {logs || L('(empty)', '(trống)')}
        </pre>
      </Modal>
    </div>
  )
}
