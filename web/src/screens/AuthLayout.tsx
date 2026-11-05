import type { ReactNode } from 'react'
import { useApp } from '../store'

/** Centered card layout for the setup and sign-in screens, with the language toggle. */
export function AuthLayout({ title, desc, children }: { title: string; desc: string; children: ReactNode }) {
  const lang = useApp((s) => s.lang)
  const setLang = useApp((s) => s.setLang)
  return (
    <div className="pt-safe pb-safe mx-auto flex min-h-full max-w-md flex-col justify-center overflow-y-auto px-5 py-8">
      <div className="mb-6 flex items-center gap-3">
        <img src="./icons/icon-192.png" alt="" className="size-12 rounded-xl" />
        <div className="flex-1">
          <div className="text-lg font-semibold">Lingua Quest</div>
          <div className="text-xs text-faint">Online · IELTS 6.5</div>
        </div>
        <button
          onClick={() => setLang(lang === 'vi' ? 'en' : 'vi')}
          className="rounded-md border border-line px-2.5 py-1 text-xs text-muted active:bg-surface-2"
        >
          {lang === 'vi' ? 'EN' : 'VI'}
        </button>
      </div>
      <div className="rounded-2xl border border-line bg-surface p-5 shadow-card">
        <h1 className="text-xl font-semibold">{title}</h1>
        <p className="mt-1 mb-5 text-sm text-muted">{desc}</p>
        {children}
      </div>
    </div>
  )
}
