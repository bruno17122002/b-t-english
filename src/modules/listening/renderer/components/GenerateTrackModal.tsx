// Modal to generate a new, original listening track with AI for a chosen level, topic and accent.
import { Wand2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { CEFR_LEVELS, type Cefr, type ListeningTrack } from '@shared/content'
import { AiBadge } from '@/components/learning'
import { Button, ErrorState, Field, Input, Modal, Select, cx } from '@/components/ui'
import { useL, useTx } from '@/i18n'
import { api, ApiError, useAction, useApi } from '@/lib/api'
import type { TrackSummary } from '../../contract'
import { ACCENT_LABEL, KIND_META } from '../lib/meta'

const TOPIC_IDEAS = [
  'daily routine',
  'shopping',
  'travel plans',
  'job interview',
  'technology',
  'environment',
  'health',
  'university life',
  'food & cooking',
  'city life',
]

export function GenerateTrackModal({
  open,
  onClose,
  onCreated,
  defaultLevel,
}: {
  open: boolean
  onClose: () => void
  onCreated: (t: TrackSummary) => void
  defaultLevel: Cefr
}) {
  const L = useL()
  const tx = useTx()
  const ai = useApi('ai:config', open ? undefined : null, [open])
  const [cefr, setCefr] = useState<Cefr>(defaultLevel)
  const [topic, setTopic] = useState('')
  const [accent, setAccent] = useState<ListeningTrack['accent']>('en-US')
  const [kind, setKind] = useState<ListeningTrack['kind']>('dialogue')
  const gen = useAction(() => api('listening:generate', { cefr, topic: topic.trim(), accent, kind }))

  useEffect(() => {
    if (open) setCefr(defaultLevel)
  }, [open, defaultLevel])

  const noAi = ai.data ? ai.data.activeProvider === null : false
  const submit = async () => {
    const t = await gen.run()
    if (t) onCreated(t)
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={
        <span className="flex items-center gap-2">
          {L('Create a listening track', 'Tạo bài nghe mới')} <AiBadge estimated={false} />
        </span>
      }
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {L('Cancel', 'Hủy')}
          </Button>
          <Button
            variant="primary"
            icon={<Wand2 className="size-4" />}
            loading={gen.pending}
            disabled={topic.trim().length < 2 || noAi}
            onClick={submit}
            data-testid="listening-generate-submit"
          >
            {gen.pending ? L('Writing…', 'Đang soạn…') : L('Create', 'Tạo bài')}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <p className="text-sm text-muted">
          {L(
            'AI writes an original script with translation, questions and key vocabulary. It is checked automatically before it is saved.',
            'AI soạn một kịch bản mới kèm bản dịch, câu hỏi và từ vựng chính. Bài được kiểm tra tự động trước khi lưu.',
          )}
        </p>
        {noAi && (
          <ErrorState
            error={
              new ApiError({
                code: 'ai_no_key',
                message: L(
                  'Creating tracks needs an AI key. All built-in tracks work offline.',
                  'Tạo bài cần API key. Các bài có sẵn vẫn dùng được offline.',
                ),
                hint: 'ai-settings',
              })
            }
            compact
          />
        )}
        <Field label={L('Topic', 'Chủ đề')}>
          <Input
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
            maxLength={60}
            placeholder={L('e.g. renting a flat', 'vd: thuê nhà')}
          />
        </Field>
        <div className="flex flex-wrap gap-1.5">
          {TOPIC_IDEAS.map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setTopic(t)}
              className={cx(
                'rounded-full border px-2.5 py-1 text-xs transition',
                topic === t ? 'border-accent bg-accent/15 text-accent' : 'border-line text-muted hover:text-text',
              )}
            >
              {t}
            </button>
          ))}
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label={L('Level', 'Trình độ')}>
            <Select value={cefr} onChange={(e) => setCefr(e.target.value as Cefr)}>
              {CEFR_LEVELS.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={L('Accent', 'Giọng')}>
            <Select value={accent} onChange={(e) => setAccent(e.target.value as ListeningTrack['accent'])}>
              {Object.entries(ACCENT_LABEL).map(([k, v]) => (
                <option key={k} value={k}>
                  {tx(v)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={L('Type', 'Dạng bài')}>
            <Select value={kind} onChange={(e) => setKind(e.target.value as ListeningTrack['kind'])}>
              {Object.entries(KIND_META).map(([k, v]) => (
                <option key={k} value={k}>
                  {tx(v)}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        {gen.error && <ErrorState error={gen.error} compact />}
      </div>
    </Modal>
  )
}
