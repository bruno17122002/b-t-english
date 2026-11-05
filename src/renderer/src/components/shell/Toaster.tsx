import { AnimatePresence, motion } from 'framer-motion'
import { AlertCircle, CheckCircle2, Info, Star, X } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { useApp } from '../../lib/store'

const ICON = { success: CheckCircle2, error: AlertCircle, info: Info, xp: Star }
const TONE = { success: 'text-success', error: 'text-danger', info: 'text-info', xp: 'text-warning' }

export function Toaster() {
  const toasts = useApp((s) => s.toasts)
  const dismiss = useApp((s) => s.dismissToast)
  const navigate = useNavigate()
  return (
    <div className="pointer-events-none fixed right-6 bottom-6 z-[60] flex w-80 flex-col gap-2" aria-live="polite">
      <AnimatePresence>
        {toasts.map((t) => {
          const Icon = ICON[t.kind]
          return (
            <motion.div
              key={t.id}
              layout
              initial={{ opacity: 0, x: 40 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 40 }}
              className="pointer-events-auto flex items-start gap-3 rounded-2xl border border-line-strong bg-surface p-3.5 shadow-card"
            >
              <Icon className={`mt-0.5 size-5 shrink-0 ${TONE[t.kind]}`} />
              <div className="min-w-0 flex-1 text-sm">
                <p className="font-medium">{t.title}</p>
                {t.body && <p className="mt-0.5 text-muted">{t.body}</p>}
                {t.action && (
                  <button
                    className="mt-1 text-xs font-semibold text-accent"
                    onClick={() => (navigate(t.action?.route ?? '/'), dismiss(t.id))}
                  >
                    {t.action.label}
                  </button>
                )}
              </div>
              <button onClick={() => dismiss(t.id)} className="text-faint hover:text-text" aria-label="Close">
                <X className="size-4" />
              </button>
            </motion.div>
          )
        })}
      </AnimatePresence>
    </div>
  )
}
