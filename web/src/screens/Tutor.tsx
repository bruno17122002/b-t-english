import { Send, Trash2 } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { Button, cx, Notice } from '../components/ui'
import { useT, type MsgKey } from '../i18n'
import { askTutor, loadChat, saveChat, tutorErrorKind, type ChatMessage, type TutorErrorKind } from '../lib/tutor'
import { client, kv, useApp } from '../store'

const ERROR_KEY: Record<TutorErrorKind, MsgKey> = {
  not_deployed: 'tutor.notDeployed',
  no_ai: 'tutor.noAi',
  quota: 'tutor.quota',
  offline: 'tutor.offline',
  signed_out: 'err.not_signed_in',
  other: 'tutor.failed',
}

function Bubble({ m }: { m: ChatMessage }) {
  const t = useT()
  const mine = m.role === 'user'
  return (
    <div className={cx('flex', mine ? 'justify-end' : 'justify-start')}>
      <div
        className={cx(
          'max-w-[85%] rounded-2xl px-3.5 py-2.5 text-[15px] whitespace-pre-wrap',
          mine ? 'bg-accent text-accent-ink' : 'border border-line bg-surface',
        )}
      >
        {m.content}
        {!!m.corrections?.length && (
          <div className="mt-2 border-t border-line pt-2">
            <div className="mb-1 text-xs font-semibold text-muted">{t('tutor.corrections')}</div>
            <ul className="space-y-1.5 text-sm">
              {m.corrections.map((c, i) => (
                <li key={i}>
                  {c.original && <span className="text-danger line-through">{c.original}</span>}
                  {c.original && ' → '}
                  <span className="text-success">{c.corrected}</span>
                  {c.explanation && <div className="text-xs text-faint">{c.explanation}</div>}
                </li>
              ))}
            </ul>
          </div>
        )}
        {!!m.newWords?.length && (
          <div className="mt-2 border-t border-line pt-2">
            <div className="mb-1 text-xs font-semibold text-muted">{t('tutor.newWords')}</div>
            <div className="flex flex-wrap gap-1.5">
              {m.newWords.map((w) => (
                <span
                  key={w.word}
                  className="rounded-md bg-surface-3 px-2 py-0.5 text-sm"
                  title={w.example || undefined}
                >
                  <b>{w.word}</b>
                  {w.ipa && <span className="text-faint"> /{w.ipa.replace(/^\/|\/$/g, '')}/</span>}
                  {w.meaning && <span className="text-muted"> – {w.meaning}</span>}
                </span>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

export function Tutor() {
  const t = useT()
  const userId = useApp((s) => s.userId) ?? ''
  const online = useApp((s) => s.online)
  const [messages, setMessages] = useState<ChatMessage[]>(() => loadChat(kv, userId))
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<TutorErrorKind | null>(null)
  const [detail, setDetail] = useState('')
  const endRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end' })
  }, [messages, busy])

  const update = (next: ChatMessage[]) => {
    setMessages(next)
    saveChat(kv, userId, next)
  }

  const send = async () => {
    const message = text.trim()
    if (!message || busy) return
    const history = messages
    const withMine = [...history, { role: 'user' as const, content: message, at: new Date().toISOString() }]
    update(withMine)
    setText('')
    setBusy(true)
    setError(null)
    try {
      const res = await askTutor(client, message, history)
      update([
        ...withMine,
        {
          role: 'assistant',
          content: res.reply,
          corrections: res.corrections,
          newWords: res.newWords,
          at: new Date().toISOString(),
        },
      ])
    } catch (e) {
      setError(tutorErrorKind(e))
      setDetail(e instanceof Error ? e.message : '')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex min-h-full flex-col">
      <div className="flex-1 space-y-3">
        <Bubble m={{ role: 'assistant', content: t('tutor.hello'), at: '' }} />
        {messages.map((m, i) => (
          <Bubble key={`${m.at}-${i}`} m={m} />
        ))}
        {busy && (
          <div className="flex gap-1 px-2 py-1" aria-label="…">
            <span className="size-2 animate-bounce rounded-full bg-faint" />
            <span className="size-2 animate-bounce rounded-full bg-faint [animation-delay:120ms]" />
            <span className="size-2 animate-bounce rounded-full bg-faint [animation-delay:240ms]" />
          </div>
        )}
        {error && (
          <Notice tone={error === 'not_deployed' || error === 'no_ai' ? 'info' : 'warning'}>
            {t(ERROR_KEY[error])}
            {(error === 'quota' || error === 'other') && detail && (
              <div className="mt-1 text-xs text-muted">{detail}</div>
            )}
          </Notice>
        )}
        {!online && !error && <Notice tone="warning">{t('tutor.offline')}</Notice>}
        <div ref={endRef} />
      </div>

      <form
        className="sticky bottom-0 mt-3 flex items-end gap-2 bg-bg pt-1"
        onSubmit={(e) => {
          e.preventDefault()
          void send()
        }}
      >
        {messages.length > 0 && (
          <button
            type="button"
            onClick={() => update([])}
            aria-label={t('tutor.clear')}
            className="inline-flex size-11 shrink-0 items-center justify-center rounded-md text-muted active:bg-surface-2"
          >
            <Trash2 className="size-5" />
          </button>
        )}
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault()
              void send()
            }
          }}
          rows={1}
          maxLength={2000}
          placeholder={t('tutor.placeholder')}
          className="max-h-32 min-h-11 flex-1 resize-none rounded-md border border-line border-b-line-strong bg-surface-2 px-3 py-2.5 text-[15px] outline-none placeholder:text-faint focus:border-b-2 focus:border-b-accent"
        />
        <Button
          type="submit"
          variant="primary"
          className="w-11 shrink-0 px-0"
          loading={busy}
          disabled={!text.trim() || !online}
          aria-label={t('tutor.send')}
        >
          {!busy && <Send className="size-4" />}
        </Button>
      </form>
    </div>
  )
}
