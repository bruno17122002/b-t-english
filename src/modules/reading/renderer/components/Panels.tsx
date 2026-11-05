// Side panels and AI panels of the reader: glossary, highlights & notes, sentence explanation, retelling.
import { CheckCircle2, Circle, Pencil, RotateCcw, Send, Trash2 } from 'lucide-react'
import { useState } from 'react'
import type { GlossaryEntry } from '@shared/content'
import { AiBadge, InteractiveText, SaveWordButton, SpeakButton } from '@/components/learning'
import {
  Badge,
  Button,
  Card,
  cx,
  EmptyState,
  ErrorState,
  IconButton,
  Modal,
  ProgressBar,
  Spinner,
  Textarea,
} from '@/components/ui'
import { useL } from '@/i18n'
import { api, useAction, type ApiError } from '@/lib/api'
import type { HighlightColor, ReadingHighlight, RetellFeedback, SentenceExplanation } from '../../contract'
import { HIGHLIGHT_CLASS, HIGHLIGHT_DOT } from './SelectionMenu'

// ---------- glossary ----------
export function GlossaryPanel({ glossary, passageId }: { glossary: GlossaryEntry[]; passageId: string }) {
  const L = useL()
  return (
    <ul className="space-y-2" data-testid="reading-glossary">
      {glossary.map((g) => (
        <li key={g.word} className="rounded-xl border border-line bg-surface-2 p-3">
          <div className="flex items-start justify-between gap-2">
            <div>
              <div className="font-display text-base font-semibold">{g.word}</div>
              <div className="font-mono text-xs text-muted">
                {g.ipa} · <span className="italic">{g.pos}</span>
              </div>
            </div>
            <div className="flex">
              <SpeakButton text={g.word} label={L('Listen', 'Nghe')} />
              <SaveWordButton
                compact
                sourceModule="reading"
                sourceRef={passageId}
                seed={{
                  word: g.word,
                  ipa: g.ipa,
                  pos: g.pos,
                  meaningVi: g.meaningVi,
                  meaningEn: g.meaningEn,
                  example: g.example,
                  cefr: g.cefr,
                }}
              />
            </div>
          </div>
          <p className="mt-1 text-sm font-medium">{g.meaningVi}</p>
          <p className="text-xs text-muted italic">{g.example}</p>
        </li>
      ))}
    </ul>
  )
}

// ---------- highlights & notes ----------
export function NotesPanel({
  highlights,
  onUpdate,
  onDelete,
  onJump,
}: {
  highlights: ReadingHighlight[]
  onUpdate: (id: number, patch: { note?: string; color?: HighlightColor }) => Promise<void>
  onDelete: (id: number) => Promise<void>
  onJump: (h: ReadingHighlight) => void
}) {
  const L = useL()
  const [editing, setEditing] = useState<number | null>(null)
  const [draft, setDraft] = useState('')
  if (!highlights.length)
    return (
      <EmptyState
        title={L('No highlights yet', 'Chưa có đánh dấu')}
        body={L(
          'Select any text in the passage to highlight it or add a note.',
          'Bôi đen đoạn bất kỳ trong bài để đánh dấu hoặc ghi chú.',
        )}
      />
    )
  return (
    <ul className="space-y-2" data-testid="reading-notes">
      {highlights.map((h) => (
        <li key={h.id} className="rounded-xl border border-line bg-surface-2 p-3 text-sm">
          <button className="block w-full text-left" onClick={() => onJump(h)}>
            <span className={cx('rounded px-0.5 box-decoration-clone', HIGHLIGHT_CLASS[h.color])}>“{h.text}”</span>
          </button>
          {editing === h.id ? (
            <div className="mt-2 space-y-2">
              <Textarea
                className="min-h-16"
                value={draft}
                maxLength={2000}
                onChange={(e) => setDraft(e.target.value)}
                autoFocus
              />
              <div className="flex justify-end gap-2">
                <Button size="sm" variant="ghost" onClick={() => setEditing(null)}>
                  {L('Cancel', 'Hủy')}
                </Button>
                <Button
                  size="sm"
                  variant="primary"
                  onClick={async () => {
                    await onUpdate(h.id, { note: draft })
                    setEditing(null)
                  }}
                >
                  {L('Save', 'Lưu')}
                </Button>
              </div>
            </div>
          ) : (
            h.note && <p className="mt-1.5 text-muted">{h.note}</p>
          )}
          <div className="mt-2 flex items-center justify-between">
            <span className="flex gap-1.5">
              {(Object.keys(HIGHLIGHT_DOT) as HighlightColor[]).map((c) => (
                <button
                  key={c}
                  aria-label={c}
                  onClick={() => void onUpdate(h.id, { color: c })}
                  className={cx(
                    'size-3.5 rounded-full ring-offset-2 ring-offset-surface-2',
                    HIGHLIGHT_DOT[c],
                    h.color === c && 'ring-2 ring-text',
                  )}
                />
              ))}
            </span>
            <span className="flex">
              <IconButton
                label={L('Edit note', 'Sửa ghi chú')}
                onClick={() => {
                  setDraft(h.note)
                  setEditing(h.id)
                }}
              >
                <Pencil className="size-4" />
              </IconButton>
              <IconButton label={L('Delete', 'Xóa')} onClick={() => void onDelete(h.id)}>
                <Trash2 className="size-4" />
              </IconButton>
            </span>
          </div>
        </li>
      ))}
    </ul>
  )
}

// ---------- explain a sentence ----------
export function ExplainModal({
  open,
  onClose,
  loading,
  result,
  error,
}: {
  open: boolean
  onClose: () => void
  loading: boolean
  result: SentenceExplanation | null
  error: ApiError | null
}) {
  const L = useL()
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={
        <span className="flex items-center gap-2">
          {L('Sentence explained', 'Giải thích câu')} <AiBadge estimated={false} />
        </span>
      }
    >
      {loading ? (
        <div className="flex justify-center py-8">
          <Spinner className="size-7" />
        </div>
      ) : error ? (
        <ErrorState error={error} />
      ) : result ? (
        <div className="space-y-4 text-sm" data-testid="reading-explanation">
          <blockquote className="border-l-2 border-accent pl-3 font-display text-base italic">
            {result.sentence}
          </blockquote>
          <div>
            <div className="mb-1 text-xs font-semibold tracking-wide text-muted uppercase">
              {L('Vietnamese', 'Tiếng Việt')}
            </div>
            <p>{result.translationVi}</p>
          </div>
          {result.simplified && result.simplified !== result.sentence && (
            <div>
              <div className="mb-1 text-xs font-semibold tracking-wide text-muted uppercase">
                {L('In simpler English', 'Tiếng Anh đơn giản hơn')}
              </div>
              <p>{result.simplified}</p>
            </div>
          )}
          {result.grammarPoints.length > 0 && (
            <div>
              <div className="mb-1 text-xs font-semibold tracking-wide text-muted uppercase">
                {L('Grammar', 'Ngữ pháp')}
              </div>
              <ul className="space-y-1.5">
                {result.grammarPoints.map((g, i) => (
                  <li key={i}>
                    <Badge tone="accent">{g.point}</Badge> <span className="text-muted">{g.explanationVi}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {result.keyPhrases.length > 0 && (
            <div>
              <div className="mb-1 text-xs font-semibold tracking-wide text-muted uppercase">
                {L('Useful phrases', 'Cụm từ hữu ích')}
              </div>
              <ul className="flex flex-wrap gap-2">
                {result.keyPhrases.map((k, i) => (
                  <li key={i} className="rounded-lg border border-line bg-surface-2 px-2 py-1">
                    <span className="font-medium">{k.phrase}</span> <span className="text-muted">– {k.meaningVi}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      ) : null}
    </Modal>
  )
}

// ---------- retelling ----------
export function RetellPanel({ passageId }: { passageId: string }) {
  const L = useL()
  const [text, setText] = useState('')
  const [result, setResult] = useState<RetellFeedback | null>(null)
  const retell = useAction((t: string) => api('reading:retell', { id: passageId, text: t }))
  const words = text.trim() ? text.trim().split(/\s+/).length : 0
  const submit = async () => {
    const res = await retell.run(text)
    if (res) setResult(res)
  }
  return (
    <Card className="space-y-4" data-testid="reading-retell">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="font-display text-xl font-semibold">{L('Retell the passage', 'Kể lại bài đọc')}</h3>
          <p className="text-sm text-muted">
            {L(
              'Close the text in your mind and retell it in English, in your own words.',
              'Hãy kể lại nội dung bằng tiếng Anh theo cách của bạn.',
            )}
          </p>
        </div>
        <AiBadge />
      </div>
      {!result ? (
        <>
          <Textarea
            value={text}
            maxLength={4000}
            onChange={(e) => setText(e.target.value)}
            placeholder={L('This passage is about…', 'This passage is about…')}
            className="min-h-32"
          />
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs text-faint tabular-nums">
              {words} {L('words', 'từ')}
            </span>
            <Button
              variant="primary"
              icon={<Send className="size-4" />}
              loading={retell.pending}
              disabled={text.trim().length < 10}
              onClick={submit}
            >
              {L('Get feedback', 'Nhận nhận xét')}
            </Button>
          </div>
          {retell.error && <ErrorState error={retell.error} compact />}
        </>
      ) : (
        <div className="space-y-4 text-sm">
          <div className="flex flex-wrap items-center gap-6">
            <div>
              <div className="text-xs text-muted uppercase">{L('Score', 'Điểm')}</div>
              <div className="font-display text-3xl font-semibold">
                {result.score}
                <span className="text-base text-muted">/10</span>
              </div>
            </div>
            <div className="min-w-48 flex-1">
              <div className="mb-1 text-xs text-muted uppercase">
                {L('Main points covered', 'Ý chính đã nêu')} · {Math.round(result.coverage * 100)}%
              </div>
              <ProgressBar value={result.coverage} tone="success" />
            </div>
          </div>
          <ul className="space-y-1">
            {result.mainPoints.map((p, i) => (
              <li key={i} className="flex items-start gap-2">
                {p.covered ? (
                  <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success" />
                ) : (
                  <Circle className="mt-0.5 size-4 shrink-0 text-faint" />
                )}
                <span className={p.covered ? '' : 'text-muted'}>{p.point}</span>
              </li>
            ))}
          </ul>
          {result.strengths.length > 0 && (
            <p>
              <span className="font-semibold text-success">{L('Well done: ', 'Làm tốt: ')}</span>
              {result.strengths.join(' · ')}
            </p>
          )}
          {result.inaccuracies.length > 0 && (
            <p>
              <span className="font-semibold text-warning">{L('Not in the passage: ', 'Không có trong bài: ')}</span>
              {result.inaccuracies.join(' · ')}
            </p>
          )}
          {result.languageCorrections.length > 0 && (
            <ul className="space-y-1.5">
              {result.languageCorrections.map((c, i) => (
                <li key={i} className="rounded-lg bg-surface-2 p-2">
                  <span className="text-danger line-through">{c.original}</span> →{' '}
                  <span className="font-medium text-success">{c.better}</span>
                  <div className="text-xs text-muted">{c.explanationVi}</div>
                </li>
              ))}
            </ul>
          )}
          <div>
            <div className="mb-1 text-xs font-semibold tracking-wide text-muted uppercase">
              {L('Model retelling', 'Bài kể mẫu')}
            </div>
            <p className="rounded-xl border border-line bg-surface-2 p-3 leading-relaxed">
              <InteractiveText text={result.improvedVersion} sourceModule="reading" sourceRef={passageId} />
            </p>
          </div>
          <p className="text-accent">{result.encouragementVi}</p>
          <Button variant="secondary" icon={<RotateCcw className="size-4" />} onClick={() => setResult(null)}>
            {L('Try again', 'Kể lại lần nữa')}
          </Button>
        </div>
      )}
    </Card>
  )
}
