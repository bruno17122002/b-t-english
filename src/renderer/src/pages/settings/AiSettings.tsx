// AI provider settings. Keys are typed here once and sent to the main process, which encrypts them
// with Windows DPAPI; the renderer only ever receives a masked hint afterwards.
import { CheckCircle2, ExternalLink, KeyRound, Loader2, PlugZap, ShieldCheck, Trash2, XCircle } from 'lucide-react'
import { useState } from 'react'
import type { In } from '@modules/contract'
import type { AiConfigView, ConnectionTestResult, ModelInfo, UserProviderId } from '@shared/types'
import { TUTOR_STYLES } from '@shared/types'
import { Badge, Button, Card, ConfirmDialog, ErrorState, Field, Input, LoadingBlock, Select } from '../../components/ui'
import { useL } from '../../i18n'
import { api, toApiError, useApi } from '../../lib/api'
import { useApp } from '../../lib/store'

const PROVIDERS: { id: UserProviderId; name: string; keyUrl: string; blurb: { en: string; vi: string } }[] = [
  {
    id: 'gemini',
    name: 'Google Gemini',
    keyUrl: 'https://aistudio.google.com/apikey',
    blurb: {
      en: 'Recommended. Fast, generous free tier, understands audio directly.',
      vi: 'Khuyến nghị. Nhanh, có hạn mức miễn phí, hiểu trực tiếp âm thanh.',
    },
  },
  {
    id: 'openai',
    name: 'OpenAI',
    keyUrl: 'https://platform.openai.com/api-keys',
    blurb: {
      en: 'Excellent speech recognition (transcription) and natural voices.',
      vi: 'Nhận dạng giọng nói (chuyển giọng thành chữ) rất tốt, giọng đọc tự nhiên.',
    },
  },
]

const STYLE_LABEL: Record<string, { en: string; vi: string }> = {
  friendly: { en: 'Friendly', vi: 'Thân thiện' },
  strict: { en: 'Strict', vi: 'Nghiêm khắc' },
  grammar: { en: 'Grammar coach', vi: 'Huấn luyện ngữ pháp' },
  pronunciation: { en: 'Pronunciation coach', vi: 'Huấn luyện phát âm' },
  professional: { en: 'Business English', vi: 'Tiếng Anh công việc' },
  ielts: { en: 'IELTS coach', vi: 'Huấn luyện IELTS' },
  casual: { en: 'Casual chat', vi: 'Trò chuyện thoải mái' },
}

function ProviderCard({
  meta,
  config,
  onChange,
}: {
  meta: (typeof PROVIDERS)[number]
  config: AiConfigView
  onChange: (c: AiConfigView) => void
}) {
  const L = useL()
  const toast = useApp((s) => s.toast)
  const status = config.providers[meta.id]
  const [key, setKey] = useState('')
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  const [test, setTest] = useState<ConnectionTestResult | null>(null)
  const [models, setModels] = useState<ModelInfo[] | null>(null)
  const [loadingModels, setLoadingModels] = useState(false)
  const [confirmRemove, setConfirmRemove] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const save = async () => {
    setSaving(true)
    setError(null)
    try {
      const res = await api('ai:setKey', { provider: meta.id, key })
      setKey('')
      onChange(res.config)
      toast({
        kind: 'success',
        title: res.persisted
          ? L('Key saved and encrypted', 'Đã lưu key (đã mã hóa)')
          : L('Key kept for this session only', 'Key chỉ được giữ trong phiên này'),
        body: res.persisted
          ? undefined
          : L(
              'Windows encryption is unavailable, so the key was not written to disk.',
              'Mã hóa Windows không khả dụng nên key không được ghi xuống đĩa.',
            ),
      })
      void runTest()
    } catch (err) {
      setError(toApiError(err).message)
    } finally {
      setSaving(false)
    }
  }

  const runTest = async () => {
    setTesting(true)
    setTest(null)
    try {
      setTest(await api('ai:test', { provider: meta.id }))
    } catch (err) {
      setTest({ ok: false, latencyMs: 0, model: status.model, message: toApiError(err).message })
    } finally {
      setTesting(false)
    }
  }

  const loadModels = async () => {
    setLoadingModels(true)
    try {
      setModels(await api('ai:models', { provider: meta.id }))
    } catch (err) {
      toast({ kind: 'error', title: toApiError(err).message })
    } finally {
      setLoadingModels(false)
    }
  }

  const remove = async () => {
    setConfirmRemove(false)
    onChange(await api('ai:removeKey', { provider: meta.id }))
    setTest(null)
    setModels(null)
  }

  return (
    <Card data-testid={`provider-${meta.id}`}>
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h3 className="font-display text-lg font-semibold">{meta.name}</h3>
            {status.hasKey ? (
              <Badge tone="success">
                {L('Connected', 'Đã kết nối')} · {status.keyHint}
              </Badge>
            ) : (
              <Badge>{L('No key', 'Chưa có key')}</Badge>
            )}
            {config.activeProvider === meta.id && <Badge tone="accent">{L('Active', 'Đang dùng')}</Badge>}
          </div>
          <p className="mt-1 text-sm text-muted">{L(meta.blurb.en, meta.blurb.vi)}</p>
        </div>
        <Button
          size="sm"
          variant="ghost"
          icon={<ExternalLink className="size-4" />}
          onClick={() => api('app:openExternal', { url: meta.keyUrl }).catch(() => undefined)}
        >
          {L('Get a key', 'Lấy key')}
        </Button>
      </div>

      <div className="mt-4 flex gap-2">
        <div className="relative flex-1">
          <KeyRound className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-faint" />
          <Input
            type="password"
            autoComplete="off"
            spellCheck={false}
            value={key}
            onChange={(e) => setKey(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && key.trim() && void save()}
            placeholder={
              status.hasKey
                ? L('Paste a new key to replace the current one', 'Dán key mới để thay key hiện tại')
                : L('Paste your API key', 'Dán API key của bạn')
            }
            className="pl-9"
            aria-label={`${meta.name} API key`}
            data-testid={`key-input-${meta.id}`}
          />
        </div>
        <Button
          variant="primary"
          disabled={!key.trim()}
          loading={saving}
          onClick={save}
          data-testid={`key-save-${meta.id}`}
        >
          {L('Save', 'Lưu')}
        </Button>
      </div>
      {error && (
        <div className="mt-2">
          <ErrorState error={error} compact />
        </div>
      )}

      {status.hasKey && (
        <div className="mt-4 grid gap-4 md:grid-cols-[1fr_auto]">
          <Field
            label={L('Model', 'Model')}
            hint={L(
              'Load the list to see models your key can use.',
              'Tải danh sách để xem các model key của bạn dùng được.',
            )}
          >
            <div className="flex gap-2">
              <Select
                value={status.model}
                onChange={async (e) =>
                  onChange(
                    await api(
                      'ai:updateConfig',
                      meta.id === 'gemini' ? { geminiModel: e.target.value } : { openaiModel: e.target.value },
                    ),
                  )
                }
                aria-label={L('Model', 'Model')}
              >
                {!(models ?? []).some((m) => m.id === status.model) && (
                  <option value={status.model}>{status.model}</option>
                )}
                {(models ?? []).map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.label === m.id ? m.id : `${m.label} (${m.id})`}
                  </option>
                ))}
              </Select>
              <Button onClick={loadModels} loading={loadingModels}>
                {L('Load list', 'Tải danh sách')}
              </Button>
            </div>
          </Field>
          <div className="flex items-end gap-2">
            <Button
              icon={<PlugZap className="size-4" />}
              loading={testing}
              onClick={runTest}
              data-testid={`key-test-${meta.id}`}
            >
              {L('Test connection', 'Kiểm tra kết nối')}
            </Button>
            <Button variant="danger" icon={<Trash2 className="size-4" />} onClick={() => setConfirmRemove(true)}>
              {L('Remove', 'Xóa')}
            </Button>
          </div>
        </div>
      )}
      {testing && (
        <p className="mt-3 flex items-center gap-2 text-sm text-muted">
          <Loader2 className="size-4 animate-spin" />
          {L('Contacting the provider…', 'Đang liên hệ nhà cung cấp…')}
        </p>
      )}
      {test && (
        <p
          className={`mt-3 flex items-center gap-2 text-sm ${test.ok ? 'text-success' : 'text-danger'}`}
          data-testid={`key-test-result-${meta.id}`}
        >
          {test.ok ? <CheckCircle2 className="size-4" /> : <XCircle className="size-4" />}
          {test.ok
            ? L(`Working · ${test.model} · ${test.latencyMs} ms`, `Hoạt động · ${test.model} · ${test.latencyMs} ms`)
            : test.message}
        </p>
      )}
      <ConfirmDialog
        open={confirmRemove}
        title={L(`Remove ${meta.name} key?`, `Xóa key ${meta.name}?`)}
        body={L(
          'The encrypted key is deleted from this computer. Your learning data is not affected.',
          'Key đã mã hóa sẽ bị xóa khỏi máy này. Dữ liệu học tập không bị ảnh hưởng.',
        )}
        confirmLabel={L('Remove key', 'Xóa key')}
        danger
        onConfirm={remove}
        onCancel={() => setConfirmRemove(false)}
      />
    </Card>
  )
}

export function AiSettings() {
  const L = useL()
  const { data: config, error, loading, setData, reload } = useApi('ai:config', undefined)
  const setBootAi = (c: AiConfigView) => {
    setData(c)
    const boot = useApp.getState().boot
    if (boot) useApp.setState({ boot: { ...boot, ai: c } })
  }
  if (loading && !config) return <LoadingBlock rows={3} />
  if (error || !config) return <ErrorState error={error ?? 'Error'} onRetry={reload} />
  const update = async (patch: In<'ai:updateConfig'>) => setBootAi(await api('ai:updateConfig', patch))

  return (
    <div className="space-y-6" data-testid="ai-settings">
      <Card className="flex items-start gap-3 border-success/25 bg-success/5">
        <ShieldCheck className="mt-0.5 size-5 shrink-0 text-success" />
        <div className="text-sm">
          <p className="font-medium">{L('Your keys stay on this computer', 'Key của bạn chỉ nằm trên máy này')}</p>
          <p className="mt-1 text-muted">
            {config.encryptionAvailable
              ? L(
                  'Keys are encrypted with Windows (DPAPI) and only used by the app’s background process to call the provider you choose. They are never shown again, logged, backed up or exported.',
                  'Key được mã hóa bằng Windows (DPAPI) và chỉ tiến trình nền của ứng dụng dùng để gọi nhà cung cấp bạn chọn. Key không bao giờ được hiển thị lại, ghi log, sao lưu hay xuất ra file.',
                )
              : L(
                  'Windows encryption is unavailable: keys are kept in memory for this session only.',
                  'Mã hóa Windows không khả dụng: key chỉ được giữ trong bộ nhớ cho phiên này.',
                )}
          </p>
          {config.mockMode && (
            <p className="mt-1 text-warning">
              {L('Test mode: AI answers are simulated.', 'Chế độ kiểm thử: câu trả lời AI là giả lập.')}
            </p>
          )}
        </div>
      </Card>

      {PROVIDERS.map((p) => (
        <ProviderCard key={p.id} meta={p} config={config} onChange={setBootAi} />
      ))}

      <Card>
        <h3 className="mb-4 font-semibold">{L('How the AI teaches you', 'Cách AI dạy bạn')}</h3>
        <div className="grid gap-4 md:grid-cols-2">
          <Field label={L('Default provider', 'Nhà cung cấp mặc định')}>
            <Select
              value={config.defaultProvider ?? ''}
              onChange={(e) => update({ defaultProvider: (e.target.value || null) as UserProviderId | null })}
            >
              <option value="">{L('Automatic', 'Tự động')}</option>
              <option value="gemini" disabled={!config.providers.gemini.hasKey}>
                Gemini
              </option>
              <option value="openai" disabled={!config.providers.openai.hasKey}>
                OpenAI
              </option>
            </Select>
          </Field>
          <Field label={L('Explanation language', 'Ngôn ngữ giải thích')}>
            <Select
              value={config.responseLanguage}
              onChange={(e) => update({ responseLanguage: e.target.value as AiConfigView['responseLanguage'] })}
            >
              <option value="mixed">{L('Mixed (adapts to my level)', 'Kết hợp (theo trình độ)')}</option>
              <option value="vi">Tiếng Việt</option>
              <option value="en">English</option>
            </Select>
          </Field>
          <Field label={L('Default tutor style', 'Phong cách gia sư mặc định')}>
            <Select
              value={config.tutorStyle}
              onChange={(e) => update({ tutorStyle: e.target.value as AiConfigView['tutorStyle'] })}
            >
              {TUTOR_STYLES.map((s) => (
                <option key={s} value={s}>
                  {L(STYLE_LABEL[s]?.en ?? s, STYLE_LABEL[s]?.vi ?? s)}
                </option>
              ))}
            </Select>
          </Field>
          <Field
            label={L('Speech recognition', 'Nhận dạng giọng nói')}
            hint={L('Automatic prefers OpenAI when both keys exist.', 'Tự động sẽ ưu tiên OpenAI khi có cả hai key.')}
          >
            <Select
              value={config.sttProvider}
              onChange={(e) => update({ sttProvider: e.target.value as AiConfigView['sttProvider'] })}
            >
              <option value="auto">{L('Automatic', 'Tự động')}</option>
              <option value="openai" disabled={!config.providers.openai.hasKey}>
                OpenAI
              </option>
              <option value="gemini" disabled={!config.providers.gemini.hasKey}>
                Gemini
              </option>
            </Select>
          </Field>
        </div>
      </Card>
    </div>
  )
}
