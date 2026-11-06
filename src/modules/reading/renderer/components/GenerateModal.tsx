// Modal for generating a new original passage with AI at a chosen level, category and topic.
import { Sparkles } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useSafeNavigate } from '@/lib/navigation'
import { CEFR_LEVELS, type Cefr, type ReadingPassage } from '@shared/content'
import { AiBadge } from '@/components/learning'
import { Button, ErrorState, Field, Input, Modal, Select } from '@/components/ui'
import { useL, useTx } from '@/i18n'
import { api, useAction } from '@/lib/api'
import { useApp } from '@/lib/store'
import { CATEGORIES, CATEGORY_META } from './shared'

export function GenerateModal({
  open,
  onClose,
  defaultLevel,
}: {
  open: boolean
  onClose: () => void
  defaultLevel: Cefr
}) {
  const L = useL()
  const tx = useTx()
  const navigate = useSafeNavigate()
  const toast = useApp((s) => s.toast)
  const [cefr, setCefr] = useState<Cefr>(defaultLevel)
  const [category, setCategory] = useState<ReadingPassage['category']>('short-story')
  const [topic, setTopic] = useState('')
  const gen = useAction((input: { cefr: Cefr; category: ReadingPassage['category']; topic: string }) =>
    api('reading:generate', input),
  )

  useEffect(() => {
    if (open) setCefr(defaultLevel)
  }, [open, defaultLevel])

  const submit = async () => {
    const res = await gen.run({ cefr, category, topic })
    if (!res) return
    toast({ kind: 'success', title: L(`New passage: ${res.title}`, `Bài đọc mới: ${res.title}`) })
    onClose()
    navigate(`/reading/${res.id}`)
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={
        <span className="flex items-center gap-2">
          {L('Create a passage with AI', 'Tạo bài đọc bằng AI')} <AiBadge estimated={false} />
        </span>
      }
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {L('Cancel', 'Hủy')}
          </Button>
          <Button
            variant="primary"
            loading={gen.pending}
            icon={<Sparkles className="size-4" />}
            onClick={submit}
            data-testid="reading-generate-submit"
          >
            {L('Generate', 'Tạo bài')}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <p className="text-sm text-muted">
          {L(
            'The AI writes an original passage with a quiz and glossary, checked so questions never give away the answer.',
            'AI viết một bài đọc mới kèm câu hỏi và từ vựng; câu hỏi được kiểm tra để không lộ đáp án.',
          )}
        </p>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={L('Level', 'Trình độ')}>
            <Select value={cefr} onChange={(e) => setCefr(e.target.value as Cefr)} data-testid="reading-generate-level">
              {CEFR_LEVELS.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={L('Category', 'Thể loại')}>
            <Select value={category} onChange={(e) => setCategory(e.target.value as ReadingPassage['category'])}>
              {CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {tx(CATEGORY_META[c])}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <Field
          label={L('Topic (optional)', 'Chủ đề (không bắt buộc)')}
          hint={L('e.g. street food in Hanoi, robots at work', 'VD: ẩm thực đường phố Hà Nội, robot trong công việc')}
        >
          <Input
            value={topic}
            maxLength={120}
            onChange={(e) => setTopic(e.target.value)}
            placeholder={L('Leave empty to use your interests', 'Để trống để dùng sở thích của bạn')}
          />
        </Field>
        {gen.error && <ErrorState error={gen.error} compact />}
      </div>
    </Modal>
  )
}
