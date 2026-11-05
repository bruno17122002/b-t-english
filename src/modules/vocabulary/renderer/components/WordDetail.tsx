// Full view of one saved word: meanings, examples, collocations, memory state; edit / favorite / delete.
import { Heart, Pencil, Trash } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import type { VocabItem } from '@shared/types'
import { SpeakButton } from '@/components/learning'
import { Badge, Button, CefrBadge, ConfirmDialog, cx, Modal } from '@/components/ui'
import { useFormat, useL, useTx } from '@/i18n'
import { api, toApiError } from '@/lib/api'
import { useApp } from '@/lib/store'
import { REVIEW_STATE_LABEL, SOURCE_LABEL } from '../lib/labels'
import { Highlight, StrengthMeter } from './bits'

export function WordDetail({
  item,
  onClose,
  onEdit,
  onChanged,
  onDeleted,
}: {
  item: VocabItem | null
  onClose: () => void
  onEdit: (v: VocabItem) => void
  onChanged: (v: VocabItem) => void
  onDeleted: (id: number) => void
}) {
  const L = useL()
  const tx = useTx()
  const fmt = useFormat()
  const [confirm, setConfirm] = useState(false)
  if (!item)
    return (
      <Modal open={false} onClose={onClose} title="">
        {null}
      </Modal>
    )

  const toggleFav = async () => {
    try {
      onChanged(await api('vocab:update', { id: item.id, patch: { isFavorite: !item.isFavorite } }))
    } catch (err) {
      useApp.getState().toast({ kind: 'error', title: toApiError(err).message })
    }
  }
  const remove = async () => {
    setConfirm(false)
    try {
      await api('vocab:delete', { id: item.id })
      onDeleted(item.id)
      void useApp.getState().refreshGame()
    } catch (err) {
      useApp.getState().toast({ kind: 'error', title: toApiError(err).message })
    }
  }
  const r = item.review
  const due = new Date(r.dueAt)
  return (
    <>
      <Modal
        open={!!item && !confirm}
        onClose={onClose}
        wide
        title={
          <span className="flex flex-wrap items-center gap-2">
            {item.word}
            {item.cefr && <CefrBadge level={item.cefr} />}
          </span>
        }
        footer={
          <>
            <Button
              variant="danger"
              icon={<Trash className="size-4" />}
              onClick={() => setConfirm(true)}
              data-testid="vocab-delete"
            >
              {L('Delete', 'Xóa')}
            </Button>
            <div className="flex-1" />
            <Button
              icon={<Heart className={cx('size-4', item.isFavorite && 'fill-danger text-danger')} />}
              onClick={() => void toggleFav()}
            >
              {item.isFavorite ? L('Unfavorite', 'Bỏ yêu thích') : L('Favorite', 'Yêu thích')}
            </Button>
            <Button variant="primary" icon={<Pencil className="size-4" />} onClick={() => onEdit(item)}>
              {L('Edit', 'Sửa')}
            </Button>
          </>
        }
      >
        <div className="space-y-5 text-sm" data-testid="vocab-detail">
          <div className="flex flex-wrap items-center gap-3">
            <SpeakButton text={item.word} size="sm" />
            {item.ipa && <span className="font-mono text-muted">{item.ipa}</span>}
            {item.pos && <span className="text-muted italic">{item.pos}</span>}
            <Badge tone="neutral">
              {tx(SOURCE_LABEL[item.sourceModule] ?? { en: item.sourceModule, vi: item.sourceModule })}
            </Badge>
            {item.topic && <Badge tone="accent">{item.topic}</Badge>}
          </div>
          <div>
            {item.meaningVi && <p className="text-base font-medium">{item.meaningVi}</p>}
            {item.meaningEn && <p className="mt-1 text-muted">{item.meaningEn}</p>}
          </div>
          {item.examples.length > 0 && (
            <div>
              <h3 className="mb-1.5 text-xs font-semibold text-muted">{L('Examples', 'Ví dụ')}</h3>
              <ul className="space-y-1.5">
                {item.examples.map((e) => (
                  <li key={e} className="flex items-start gap-2">
                    <SpeakButton text={e} />
                    <Highlight text={e} word={item.word} className="pt-2" />
                  </li>
                ))}
              </ul>
            </div>
          )}
          {item.context && (
            <div>
              <h3 className="mb-1.5 text-xs font-semibold text-muted">{L('Where you met it', 'Ngữ cảnh gặp từ')}</h3>
              <p className="border-l-2 border-accent/50 pl-3 text-muted italic">
                <Highlight text={item.context} word={item.word} />
              </p>
            </div>
          )}
          {(item.collocations.length > 0 || item.idioms.length > 0 || item.phrasalVerbs.length > 0) && (
            <div className="flex flex-wrap gap-1.5">
              {[...item.collocations, ...item.phrasalVerbs, ...item.idioms].map((c) => (
                <span key={c} className="rounded-lg border border-line bg-surface-2 px-2 py-1 text-xs">
                  {c}
                </span>
              ))}
            </div>
          )}
          {item.notes && <p className="rounded-xl bg-surface-2 p-3 text-muted">{item.notes}</p>}
          <div className="grid grid-cols-2 gap-3 rounded-xl border border-line p-3 sm:grid-cols-4">
            <Info label={L('Memory', 'Trí nhớ')} value={<StrengthMeter review={r} showLabel />} />
            <Info
              label={L('State', 'Trạng thái')}
              value={tx(REVIEW_STATE_LABEL[r.state] ?? { en: r.state, vi: r.state })}
            />
            <Info
              label={L('Next review', 'Lần ôn tới')}
              value={
                due.getTime() <= Date.now()
                  ? L('Due now', 'Đến hạn')
                  : fmt.date(r.dueAt, { day: 'numeric', month: 'short', year: 'numeric' })
              }
            />
            <Info label={L('Reviews / lapses', 'Lượt ôn / quên')} value={`${r.reps} / ${r.lapses}`} />
          </div>
          <p className="text-xs text-faint">
            {L(`Saved ${fmt.relative(item.createdAt)}`, `Đã lưu ${fmt.relative(item.createdAt)}`)}
          </p>
        </div>
      </Modal>
      <ConfirmDialog
        open={confirm}
        danger
        title={L('Delete this word?', 'Xóa từ này?')}
        body={L(
          `“${item.word}” and its review history will be removed.`,
          `“${item.word}” và lịch sử ôn tập sẽ bị xóa.`,
        )}
        confirmLabel={L('Delete', 'Xóa')}
        onConfirm={() => void remove()}
        onCancel={() => setConfirm(false)}
      />
    </>
  )
}

function Info({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div>
      <div className="text-[11px] font-semibold text-faint">{label}</div>
      <div className="mt-1">{value}</div>
    </div>
  )
}
