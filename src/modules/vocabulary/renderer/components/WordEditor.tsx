// Add a word manually (with dictionary lookup, AI on demand) or edit an existing word.
import { BookOpen, Sparkles } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { Cefr } from '@shared/content'
import type { DictionaryResult, VocabItem } from '@shared/types'
import { AiBadge } from '@/components/learning'
import { Button, ErrorState, Field, Input, Modal, Select, Textarea } from '@/components/ui'
import { useL } from '@/i18n'
import { api, toApiError, useApi, type ApiError } from '@/lib/api'
import { useApp } from '@/lib/store'
import { CEFR_OPTIONS } from '../lib/labels'
import { splitList } from '../lib/practice'

interface Draft {
  word: string
  ipa: string
  pos: string
  meaningVi: string
  meaningEn: string
  examples: string
  collocations: string
  topic: string
  notes: string
  cefr: Cefr | ''
}

const EMPTY: Draft = {
  word: '',
  ipa: '',
  pos: '',
  meaningVi: '',
  meaningEn: '',
  examples: '',
  collocations: '',
  topic: '',
  notes: '',
  cefr: '',
}

const fromItem = (v: VocabItem): Draft => ({
  word: v.word,
  ipa: v.ipa,
  pos: v.pos,
  meaningVi: v.meaningVi,
  meaningEn: v.meaningEn,
  examples: v.examples.join('\n'),
  collocations: v.collocations.join('\n'),
  topic: v.topic,
  notes: v.notes,
  cefr: v.cefr ?? '',
})

export function WordEditor({
  open,
  item,
  initialWord,
  onClose,
  onSaved,
}: {
  open: boolean
  item?: VocabItem | null
  initialWord?: string
  onClose: () => void
  onSaved: (item: VocabItem) => void
}) {
  const L = useL()
  const editing = !!item
  const [d, setD] = useState<Draft>(EMPTY)
  const [saving, setSaving] = useState(false)
  const [lookup, setLookup] = useState<{
    loading: 'offline' | 'ai' | null
    result: DictionaryResult | null | undefined
    error: ApiError | null
  }>({ loading: null, result: undefined, error: null })
  const topics = useApi('vocab:topics', open ? undefined : null, [open])

  useEffect(() => {
    if (!open) return
    setD(item ? fromItem(item) : { ...EMPTY, word: initialWord ?? '' })
    setLookup({ loading: null, result: undefined, error: null })
  }, [open, item, initialWord])

  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setD((prev) => ({ ...prev, [k]: v }))

  const doLookup = async (useAi: boolean) => {
    const word = d.word.trim()
    if (!word) return
    setLookup((s) => ({ ...s, loading: useAi ? 'ai' : 'offline', error: null }))
    try {
      const res = await api('vocab:lookup', { word, useAi })
      setLookup({ loading: null, result: res, error: null })
      if (res) {
        const e = res.entry
        setD((prev) => ({
          ...prev,
          word: prev.word.trim() || e.word,
          ipa: e.ipa && e.ipa !== '-' ? e.ipa : prev.ipa,
          pos: e.pos && e.pos !== '-' ? e.pos : prev.pos,
          meaningVi: e.meaningVi || prev.meaningVi,
          meaningEn: e.meaningEn || prev.meaningEn,
          examples: prev.examples.trim() ? prev.examples : e.example,
          collocations: prev.collocations.trim() ? prev.collocations : (e.collocations ?? []).join('\n'),
          topic: prev.topic || e.topic || '',
          cefr: e.cefr ?? prev.cefr,
        }))
      }
    } catch (err) {
      setLookup({ loading: null, result: undefined, error: toApiError(err) })
    }
  }

  const save = async () => {
    if (!d.word.trim()) return
    setSaving(true)
    const common = {
      ipa: d.ipa.trim().slice(0, 80),
      pos: d.pos.trim().slice(0, 40),
      meaningVi: d.meaningVi.trim().slice(0, 300),
      meaningEn: d.meaningEn.trim().slice(0, 300),
      examples: splitList(d.examples)
        .slice(0, 8)
        .map((s) => s.slice(0, 400)),
      collocations: splitList(d.collocations, true)
        .slice(0, 10)
        .map((s) => s.slice(0, 80)),
      topic: d.topic.trim().slice(0, 60),
      notes: d.notes.trim().slice(0, 1000),
      cefr: d.cefr || null,
    }
    try {
      if (item) {
        onSaved(await api('vocab:update', { id: item.id, patch: common }))
      } else {
        const res = await api('vocab:save', { word: d.word.trim(), sourceModule: 'manual', ...common })
        useApp.getState().toast({
          kind: 'success',
          title: res.created
            ? L(`Added “${res.item.word}”`, `Đã thêm “${res.item.word}”`)
            : L(`“${res.item.word}” was already saved – details merged`, `“${res.item.word}” đã có – đã gộp thông tin`),
        })
        void useApp.getState().refreshGame()
        onSaved(res.item)
      }
    } catch (err) {
      useApp.getState().toast({ kind: 'error', title: toApiError(err).message })
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      wide
      title={editing ? L(`Edit “${item?.word ?? ''}”`, `Sửa “${item?.word ?? ''}”`) : L('Add a word', 'Thêm từ mới')}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {L('Cancel', 'Hủy')}
          </Button>
          <Button
            variant="primary"
            loading={saving}
            disabled={!d.word.trim()}
            onClick={() => void save()}
            data-testid="vocab-editor-save"
          >
            {editing ? L('Save changes', 'Lưu thay đổi') : L('Add to word bank', 'Thêm vào kho từ')}
          </Button>
        </>
      }
    >
      <div className="space-y-4" data-testid="vocab-editor">
        {!editing && (
          <div>
            <Field label={L('Word or phrase', 'Từ hoặc cụm từ')}>
              <div className="flex gap-2">
                <Input
                  autoFocus
                  value={d.word}
                  maxLength={80}
                  onChange={(e) => set('word', e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && void doLookup(false)}
                  placeholder="e.g. resilient"
                />
                <Button
                  icon={<BookOpen className="size-4" />}
                  loading={lookup.loading === 'offline'}
                  disabled={!d.word.trim()}
                  onClick={() => void doLookup(false)}
                >
                  {L('Look up', 'Tra từ')}
                </Button>
                <Button
                  variant="ghost"
                  icon={<Sparkles className="size-4" />}
                  loading={lookup.loading === 'ai'}
                  disabled={!d.word.trim()}
                  onClick={() => void doLookup(true)}
                >
                  {L('Ask AI', 'Hỏi AI')}
                </Button>
              </div>
            </Field>
            <div className="mt-2 text-xs text-faint">
              {lookup.result === null &&
                L(
                  'Not in the offline dictionary – fill in the details yourself or ask AI.',
                  'Không có trong từ điển offline – tự điền hoặc hỏi AI.',
                )}
              {lookup.result && (
                <span className="flex items-center gap-2">
                  {lookup.result.source === 'ai' ? (
                    <AiBadge estimated={false} />
                  ) : (
                    L('Filled from the offline dictionary.', 'Đã điền từ từ điển offline.')
                  )}
                  {lookup.result.saved && (
                    <span className="text-warning">{L('Already in your word bank.', 'Đã có trong kho từ.')}</span>
                  )}
                </span>
              )}
            </div>
            {lookup.error && (
              <div className="mt-2">
                <ErrorState compact error={lookup.error} />
              </div>
            )}
          </div>
        )}
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="IPA">
            <Input value={d.ipa} onChange={(e) => set('ipa', e.target.value)} placeholder="/rɪˈzɪliənt/" />
          </Field>
          <Field label={L('Part of speech', 'Từ loại')}>
            <Input value={d.pos} onChange={(e) => set('pos', e.target.value)} placeholder="adjective" />
          </Field>
          <Field label="CEFR">
            <Select value={d.cefr} onChange={(e) => set('cefr', e.target.value as Cefr | '')}>
              <option value="">–</option>
              {CEFR_OPTIONS.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={L('Vietnamese meaning', 'Nghĩa tiếng Việt')}>
            <Input value={d.meaningVi} maxLength={300} onChange={(e) => set('meaningVi', e.target.value)} />
          </Field>
          <Field label={L('English definition', 'Định nghĩa tiếng Anh')}>
            <Input value={d.meaningEn} maxLength={300} onChange={(e) => set('meaningEn', e.target.value)} />
          </Field>
        </div>
        <Field label={L('Examples (one per line)', 'Ví dụ (mỗi dòng một câu)')}>
          <Textarea value={d.examples} onChange={(e) => set('examples', e.target.value)} className="min-h-20" />
        </Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field
            label={L(
              'Collocations (one per line or comma separated)',
              'Cụm từ đi kèm (mỗi dòng hoặc cách nhau dấu phẩy)',
            )}
          >
            <Textarea
              value={d.collocations}
              onChange={(e) => set('collocations', e.target.value)}
              className="min-h-20"
            />
          </Field>
          <div className="space-y-3">
            <Field label={L('Topic', 'Chủ đề')}>
              <Input
                value={d.topic}
                maxLength={60}
                list="vocab-topics"
                onChange={(e) => set('topic', e.target.value)}
                placeholder={L('e.g. travel', 'vd. du lịch')}
              />
              <datalist id="vocab-topics">
                {(topics.data ?? []).map((t) => (
                  <option key={t} value={t} />
                ))}
              </datalist>
            </Field>
            <Field label={L('Notes', 'Ghi chú')}>
              <Input value={d.notes} maxLength={1000} onChange={(e) => set('notes', e.target.value)} />
            </Field>
          </div>
        </div>
      </div>
    </Modal>
  )
}
