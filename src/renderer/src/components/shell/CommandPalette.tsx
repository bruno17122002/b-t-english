// Ctrl+K palette: global search over pages, content and the word bank.
import { AnimatePresence, motion } from 'framer-motion'
import {
  BookOpen,
  CornerDownLeft,
  FileText,
  Film,
  Headphones,
  LayoutGrid,
  Mic,
  PenLine,
  Search,
  Shield,
  Spline,
} from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import type { SearchResult } from '@shared/types'
import { useL } from '../../i18n'
import { api } from '../../lib/api'
import { cx, Kbd } from '../ui'

const ICONS: Record<SearchResult['kind'], typeof Search> = {
  page: LayoutGrid,
  reading: BookOpen,
  listening: Headphones,
  story: Film,
  grammar: Shield,
  vocab: Spline,
  dictionary: FileText,
  'writing-prompt': PenLine,
  'speaking-prompt': Mic,
}

export function CommandPalette({ open, onClose }: { open: boolean; onClose: () => void }) {
  const L = useL()
  const navigate = useNavigate()
  const [q, setQ] = useState('')
  const [results, setResults] = useState<SearchResult[]>([])
  const [active, setActive] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (open) {
      setQ('')
      setResults([])
      setActive(0)
      setTimeout(() => inputRef.current?.focus(), 30)
    }
  }, [open])

  // Escape closes the palette even before the input has received focus.
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  useEffect(() => {
    if (!q.trim()) {
      setResults([])
      return
    }
    let alive = true
    const t = setTimeout(() => {
      api('search:query', { q })
        .then((r) => {
          if (alive) {
            setResults(r)
            setActive(0)
          }
        })
        .catch(() => undefined)
    }, 120)
    return () => {
      alive = false
      clearTimeout(t)
    }
  }, [q])

  const go = (r: SearchResult | undefined) => {
    if (!r) return
    navigate(r.route)
    onClose()
  }

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-50 flex items-start justify-center bg-black/50 pt-[12vh]"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onMouseDown={(e) => e.target === e.currentTarget && onClose()}
        >
          <motion.div
            role="dialog"
            aria-label={L('Search', 'Tìm kiếm')}
            className="w-full max-w-xl overflow-hidden rounded-2xl border border-line-strong bg-surface shadow-card"
            initial={{ y: -10 }}
            animate={{ y: 0 }}
          >
            <div className="flex items-center gap-3 border-b border-line px-4">
              <Search className="size-5 text-faint" />
              <input
                ref={inputRef}
                value={q}
                onChange={(e) => setQ(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'ArrowDown') {
                    e.preventDefault()
                    setActive((a) => Math.min(results.length - 1, a + 1))
                  } else if (e.key === 'ArrowUp') {
                    e.preventDefault()
                    setActive((a) => Math.max(0, a - 1))
                  } else if (e.key === 'Enter') go(results[active])
                }}
                placeholder={L('Search lessons, stories, words, settings…', 'Tìm bài học, phim, từ vựng, cài đặt…')}
                className="h-14 flex-1 bg-transparent text-base outline-none placeholder:text-faint"
              />
              <Kbd>Esc</Kbd>
            </div>
            <ul className="max-h-[50vh] overflow-y-auto p-2">
              {q.trim() && results.length === 0 && (
                <li className="px-3 py-6 text-center text-sm text-muted">{L('No results', 'Không có kết quả')}</li>
              )}
              {results.map((r, i) => {
                const Icon = ICONS[r.kind]
                return (
                  <li key={`${r.kind}:${r.id}`}>
                    <button
                      onMouseEnter={() => setActive(i)}
                      onClick={() => go(r)}
                      className={cx(
                        'flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left',
                        i === active ? 'bg-surface-3' : 'hover:bg-surface-2',
                      )}
                    >
                      <Icon className="size-4 shrink-0 text-accent" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium">{r.title}</span>
                        <span className="block truncate text-xs text-muted">{r.subtitle}</span>
                      </span>
                      {i === active && <CornerDownLeft className="size-4 text-faint" />}
                    </button>
                  </li>
                )
              })}
            </ul>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
