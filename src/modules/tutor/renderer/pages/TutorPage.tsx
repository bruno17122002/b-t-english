// AI Tutor page: conversation list (search / rename / delete) + chat, or the mode picker when no chat is open.
import { MessagesSquare, Pencil, Plus, Search, Trash } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import type { TutorStyle } from '@shared/types'
import { Badge, Button, ConfirmDialog, cx, ErrorState, Field, IconButton, Input, Modal, Section, Skeleton } from '@/components/ui'
import { useFormat, useL, useTx } from '@/i18n'
import { api, ApiError, toApiError, useApi } from '@/lib/api'
import { useApp } from '@/lib/store'
import type { TutorConversationView } from '../../contract'
import { ChatView } from '../components/ChatView'
import { MistakesPanel } from '../components/MistakesPanel'
import { MODE_ICONS } from '../components/modeIcons'
import { MODE_LIST, MODES } from '../lib/modes'

export default function TutorPage() {
  const L = useL()
  const params = useParams()
  const navigate = useNavigate()
  const id = params.id && /^\d+$/.test(params.id) ? Number(params.id) : null
  const [query, setQuery] = useState('')
  const [debounced, setDebounced] = useState('')
  useEffect(() => {
    const t = setTimeout(() => setDebounced(query.trim()), 250)
    return () => clearTimeout(t)
  }, [query])
  const list = useApi('tutor:list', debounced ? { query: debounced } : undefined, [debounced])
  const config = useApi('ai:config', undefined)
  const noKey = !!config.data && !config.data.activeProvider

  const [renaming, setRenaming] = useState<TutorConversationView | null>(null)
  const [deleting, setDeleting] = useState<TutorConversationView | null>(null)

  const doDelete = async () => {
    if (!deleting) return
    const target = deleting
    setDeleting(null)
    try {
      await api('tutor:delete', { id: target.id })
      list.setData((prev) => (prev ?? []).filter((c) => c.id !== target.id))
      if (id === target.id) navigate('/tutor')
    } catch (err) {
      useApp.getState().toast({ kind: 'error', title: toApiError(err).message })
    }
  }

  return (
    <div data-testid="page-tutor" className="flex h-[calc(100vh-8rem)] min-h-[540px] gap-4">
      <aside className="flex w-72 shrink-0 flex-col rounded-2xl border border-line bg-surface">
        <div className="flex items-center justify-between gap-2 border-b border-line px-4 py-3">
          <div className="flex items-center gap-2 font-display font-semibold">
            <MessagesSquare className="size-5 text-accent" />
            {L('AI Tutor', 'Gia sư AI')}
          </div>
          <Button size="sm" variant="primary" icon={<Plus className="size-4" />} onClick={() => navigate('/tutor')} data-testid="tutor-new">
            {L('New', 'Mới')}
          </Button>
        </div>
        <div className="relative px-3 pt-3">
          <Search className="pointer-events-none absolute top-1/2 left-6 mt-1.5 size-4 -translate-y-1/2 text-faint" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={L('Search conversations…', 'Tìm cuộc hội thoại…')}
            className="h-9 pl-9"
            aria-label={L('Search conversations', 'Tìm cuộc hội thoại')}
          />
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-2">
          {list.loading && !list.data ? (
            <div className="space-y-2 p-1">
              {[0, 1, 2].map((i) => (
                <Skeleton key={i} className="h-14" />
              ))}
            </div>
          ) : list.error ? (
            <ErrorState compact error={list.error} onRetry={list.reload} />
          ) : !list.data?.length ? (
            <p className="px-3 py-6 text-center text-sm text-muted">
              {debounced ? L('No conversation matches.', 'Không có cuộc hội thoại phù hợp.') : L('No conversations yet.', 'Chưa có cuộc hội thoại nào.')}
            </p>
          ) : (
            <ul className="space-y-1">
              {list.data.map((c) => (
                <ConversationItem key={c.id} c={c} active={c.id === id} onOpen={() => navigate(`/tutor/${c.id}`)} onRename={() => setRenaming(c)} onDelete={() => setDeleting(c)} />
              ))}
            </ul>
          )}
        </div>
      </aside>

      <section className="flex min-w-0 flex-1 flex-col">
        {id ? (
          <ChatView key={id} id={id} noKey={noKey} onChanged={() => void list.reload()} />
        ) : (
          <TutorHome noKey={noKey} defaultMode={config.data?.tutorStyle ?? 'friendly'} onCreated={() => void list.reload()} />
        )}
      </section>

      <RenameDialog
        conv={renaming}
        onClose={() => setRenaming(null)}
        onSaved={(title) => {
          const target = renaming
          setRenaming(null)
          if (target) list.setData((prev) => (prev ?? []).map((c) => (c.id === target.id ? { ...c, title } : c)))
        }}
      />
      <ConfirmDialog
        open={!!deleting}
        danger
        title={L('Delete conversation?', 'Xóa cuộc hội thoại?')}
        body={L(
          `“${deleting?.title ?? ''}” and all its messages will be deleted. Saved words and your mistake memory are kept.`,
          `“${deleting?.title ?? ''}” và toàn bộ tin nhắn sẽ bị xóa. Từ đã lưu và lỗi đã ghi nhớ vẫn được giữ.`,
        )}
        confirmLabel={L('Delete', 'Xóa')}
        onConfirm={() => void doDelete()}
        onCancel={() => setDeleting(null)}
      />
    </div>
  )
}

function ConversationItem({ c, active, onOpen, onRename, onDelete }: { c: TutorConversationView; active: boolean; onOpen: () => void; onRename: () => void; onDelete: () => void }) {
  const L = useL()
  const fmt = useFormat()
  const Icon = MODE_ICONS[c.mode]
  return (
    <li>
      <div
        role="button"
        tabIndex={0}
        onClick={onOpen}
        onKeyDown={(e) => e.key === 'Enter' && onOpen()}
        className={cx('group flex cursor-pointer items-start gap-2.5 rounded-xl px-2.5 py-2 transition', active ? 'bg-surface-3' : 'hover:bg-surface-2')}
        data-testid="tutor-conversation"
      >
        <Icon className="mt-0.5 size-4 shrink-0 text-accent" />
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium">{c.title}</div>
          <div className="truncate text-xs text-faint">{c.match || c.lastMessage || L('No messages yet', 'Chưa có tin nhắn')}</div>
          <div className="text-[11px] text-faint">{fmt.relative(c.updatedAt)}</div>
        </div>
        <div className="flex opacity-0 transition group-hover:opacity-100 group-focus-within:opacity-100">
          <IconButton
            label={L('Rename', 'Đổi tên')}
            className="size-7"
            onClick={(e) => {
              e.stopPropagation()
              onRename()
            }}
          >
            <Pencil className="size-3.5" />
          </IconButton>
          <IconButton
            label={L('Delete', 'Xóa')}
            className="size-7 hover:text-danger"
            onClick={(e) => {
              e.stopPropagation()
              onDelete()
            }}
          >
            <Trash className="size-3.5" />
          </IconButton>
        </div>
      </div>
    </li>
  )
}

function RenameDialog({ conv, onClose, onSaved }: { conv: TutorConversationView | null; onClose: () => void; onSaved: (title: string) => void }) {
  const L = useL()
  const [title, setTitle] = useState('')
  const [saving, setSaving] = useState(false)
  useEffect(() => setTitle(conv?.title ?? ''), [conv])
  const save = async () => {
    if (!conv || !title.trim()) return
    setSaving(true)
    try {
      const res = await api('tutor:rename', { id: conv.id, title: title.trim() })
      onSaved(res.title)
    } catch (err) {
      useApp.getState().toast({ kind: 'error', title: toApiError(err).message })
    } finally {
      setSaving(false)
    }
  }
  return (
    <Modal
      open={!!conv}
      onClose={onClose}
      title={L('Rename conversation', 'Đổi tên cuộc hội thoại')}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {L('Cancel', 'Hủy')}
          </Button>
          <Button variant="primary" loading={saving} disabled={!title.trim()} onClick={() => void save()}>
            {L('Save', 'Lưu')}
          </Button>
        </>
      }
    >
      <Field label={L('Title', 'Tiêu đề')}>
        <Input value={title} maxLength={80} autoFocus onChange={(e) => setTitle(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && void save()} />
      </Field>
    </Modal>
  )
}

function TutorHome({ noKey, defaultMode, onCreated }: { noKey: boolean; defaultMode: TutorStyle; onCreated: () => void }) {
  const L = useL()
  const tx = useTx()
  const navigate = useNavigate()
  const [mode, setMode] = useState<TutorStyle>(defaultMode)
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState<ApiError | null>(null)
  useEffect(() => setMode(defaultMode), [defaultMode])

  const start = async (draft?: string) => {
    setCreating(true)
    setError(null)
    try {
      const conv = await api('tutor:create', { mode })
      onCreated()
      navigate(`/tutor/${conv.id}`, { state: draft ? { draft } : undefined })
    } catch (err) {
      setError(toApiError(err))
    } finally {
      setCreating(false)
    }
  }

  const info = MODES[mode]
  return (
    <div className="min-h-0 flex-1 overflow-y-auto pr-1">
      <div className="mb-6">
        <h1 className="font-display text-3xl font-semibold tracking-tight">{L('Chat with your AI tutor', 'Trò chuyện với gia sư AI')}</h1>
        <p className="mt-1 text-sm text-muted">
          {L(
            'Choose a tutor style. Every message gets a natural reply, corrections with Vietnamese explanations and useful new words.',
            'Chọn phong cách gia sư. Mỗi tin nhắn đều được trả lời tự nhiên, sửa lỗi kèm giải thích tiếng Việt và gợi ý từ mới.',
          )}
        </p>
      </div>
      {noKey && (
        <div className="mb-6">
          <ErrorState
            error={
              new ApiError({
                code: 'ai_no_key',
                hint: 'ai-settings',
                message: L(
                  'The AI tutor needs a Gemini or OpenAI API key. Add one in AI Settings – you can still read your past conversations.',
                  'Gia sư AI cần API key Gemini hoặc OpenAI. Thêm key trong Cài đặt AI – bạn vẫn xem lại được các cuộc hội thoại cũ.',
                ),
              })
            }
          />
        </div>
      )}
      {error && (
        <div className="mb-4">
          <ErrorState error={error} compact />
        </div>
      )}
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3" role="radiogroup" aria-label={L('Tutor mode', 'Chế độ gia sư')}>
        {MODE_LIST.map((m) => {
          const Icon = MODE_ICONS[m]
          const mi = MODES[m]
          const selected = m === mode
          return (
            <button
              key={m}
              role="radio"
              aria-checked={selected}
              onClick={() => setMode(m)}
              data-testid={`tutor-mode-${m}`}
              className={cx(
                'rounded-2xl border bg-surface p-4 text-left transition hover:-translate-y-0.5',
                selected ? 'border-accent shadow-[0_0_0_1px_var(--accent)]' : 'border-line hover:border-line-strong',
              )}
            >
              <div className="flex items-center gap-3">
                <div className={cx('flex size-10 items-center justify-center rounded-xl', selected ? 'bg-accent-gradient text-accent-ink' : 'bg-accent/15 text-accent')}>
                  <Icon className="size-5" />
                </div>
                <div className="min-w-0">
                  <div className="font-semibold">{tx({ en: mi.en, vi: mi.vi })}</div>
                  <div className="text-xs text-faint">{tx(mi.bestFor)}</div>
                </div>
                {m === defaultMode && (
                  <Badge tone="accent" className="ml-auto">
                    {L('Default', 'Mặc định')}
                  </Badge>
                )}
              </div>
              <p className="mt-3 text-sm text-muted">{tx({ en: mi.descEn, vi: mi.descVi })}</p>
            </button>
          )
        })}
      </div>

      <div className="mt-5 flex flex-wrap items-center gap-3">
        <Button variant="primary" size="lg" loading={creating} icon={<Plus className="size-5" />} onClick={() => void start()} data-testid="tutor-start">
          {L('Start a conversation', 'Bắt đầu trò chuyện')}
        </Button>
        <span className="text-sm text-muted">{L('or try a starter:', 'hoặc thử câu mở đầu:')}</span>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        {info.starters.map((s) => (
          <button
            key={s.text}
            title={s.vi}
            onClick={() => void start(s.text)}
            disabled={creating}
            className="rounded-full border border-line bg-surface-2 px-3 py-1.5 text-sm transition hover:border-accent disabled:opacity-50"
          >
            {s.text}
          </button>
        ))}
      </div>

      <Section title={L('My recurring mistakes', 'Lỗi hay lặp lại của tôi')} className="mt-10">
        <MistakesPanel limit={20} compact />
      </Section>
      <p className="text-xs text-faint">
        {L(
          'Tip: click any word in a tutor reply to look it up and save it to your word bank.',
          'Mẹo: bấm vào bất kỳ từ nào trong câu trả lời của gia sư để tra nghĩa và lưu vào kho từ.',
        )}
      </p>
    </div>
  )
}
