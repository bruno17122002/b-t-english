// App chrome: sidebar navigation built from module manifests, top bar with search, streak and XP,
// toasts, reward celebrations and global keyboard shortcuts.
import { AnimatePresence, motion } from 'framer-motion'
import { Flame, Heart, Keyboard, Search, Settings, Star } from 'lucide-react'
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { NavLink, useNavigate } from 'react-router-dom'
import { MODULES_RENDERER } from '@modules/registry.renderer'
import type { ModuleNavItem } from '@modules/types.renderer'
import { useL, useTx } from '../../i18n'
import { useApp } from '../../lib/store'
import { cx, Kbd, Modal, ProgressBar } from '../ui'
import { BrandMark } from './BrandMark'
import { CommandPalette } from './CommandPalette'
import { RewardCelebration } from './RewardCelebration'
import { Toaster } from './Toaster'

const GROUP_LABEL = {
  home: { en: '', vi: '' },
  skills: { en: 'Skills', vi: 'Kỹ năng' },
  play: { en: 'Play & practice', vi: 'Luyện tập' },
  progress: { en: 'Progress', vi: 'Tiến độ' },
}

export const SHORTCUTS: { keys: string[]; en: string; vi: string }[] = [
  { keys: ['Ctrl', 'K'], en: 'Search everything', vi: 'Tìm kiếm mọi thứ' },
  { keys: ['Ctrl', '1…9'], en: 'Jump to a section', vi: 'Chuyển nhanh giữa các mục' },
  { keys: ['Ctrl', ','], en: 'Settings', vi: 'Cài đặt' },
  { keys: ['Ctrl', 'R'], en: 'Review due flashcards', vi: 'Ôn thẻ đến hạn' },
  { keys: ['F1'], en: 'Keyboard shortcuts', vi: 'Phím tắt' },
  { keys: ['Space'], en: 'Flip flashcard (in review)', vi: 'Lật thẻ (khi ôn)' },
  { keys: ['1', '2', '3', '4'], en: 'Rate card: Again / Hard / Good / Easy', vi: 'Chấm thẻ: Lại / Khó / Tốt / Dễ' },
  { keys: ['Esc'], en: 'Close dialogs', vi: 'Đóng hộp thoại' },
]

function useNav(): ModuleNavItem[] {
  return useMemo(() => MODULES_RENDERER.flatMap((m) => m.nav ?? []).sort((a, b) => a.order - b.order), [])
}

function Sidebar() {
  const tx = useTx()
  const L = useL()
  const nav = useNav()
  const dueCards = useApp((s) => s.dueCards)
  const groups = (['home', 'skills', 'play', 'progress'] as const).map((g) => ({
    g,
    items: nav.filter((n) => n.group === g),
  }))
  const linkCls = ({ isActive }: { isActive: boolean }) =>
    cx(
      // Windows 11 NavigationView: subtle fill on the selected item plus a short accent pill on the left.
      'group relative flex items-center gap-3 rounded-md px-3 py-[7px] text-sm text-text transition-colors max-[900px]:justify-center max-[900px]:px-0',
      isActive
        ? 'bg-surface-2 font-semibold before:absolute before:top-1/2 before:left-0 before:h-4 before:w-[3px] before:-translate-y-1/2 before:rounded-full before:bg-accent'
        : 'hover:bg-surface-2',
    )
  return (
    // Below 900 CSS px (window zoomed in) the sidebar becomes an icon rail so the content keeps its room.
    <aside className="flex w-60 shrink-0 flex-col px-3 py-4 max-[900px]:w-16 max-[900px]:px-2">
      <div className="mb-6 flex items-center gap-2.5 px-2 max-[900px]:justify-center max-[900px]:px-0">
        <BrandMark className="size-8 shrink-0" />
        <div className="font-display text-lg leading-none font-semibold max-[900px]:hidden">
          B&amp;T <span className="text-accent">English</span>
        </div>
      </div>
      <nav className="flex-1 space-y-5 overflow-y-auto" aria-label="Main">
        {groups.map(({ g, items }) =>
          items.length ? (
            <div key={g}>
              {GROUP_LABEL[g].en && (
                <div className="mb-1 px-3 text-[11px] font-semibold text-faint max-[900px]:sr-only">
                  {tx(GROUP_LABEL[g])}
                </div>
              )}
              <div className="space-y-0.5">
                {items.map((n) => (
                  <NavLink key={n.path} to={n.path} end={n.path === '/'} className={linkCls} title={tx(n.label)}>
                    <n.icon className="size-[18px] shrink-0" />
                    <span className="flex-1 truncate max-[900px]:sr-only">{tx(n.label)}</span>
                    {n.badge === 'dueCards' && dueCards > 0 && (
                      <span className="rounded-full bg-accent px-1.5 text-[11px] font-bold text-accent-ink max-[900px]:absolute max-[900px]:top-0 max-[900px]:right-0">
                        {dueCards > 99 ? '99+' : dueCards}
                      </span>
                    )}
                  </NavLink>
                ))}
              </div>
            </div>
          ) : null,
        )}
      </nav>
      <div className="mt-4 space-y-0.5 border-t border-line pt-3">
        <NavLink to="/library" className={linkCls} title={L('Favorites', 'Yêu thích')}>
          <Heart className="size-[18px] shrink-0" />
          <span className="truncate max-[900px]:sr-only">{L('Favorites', 'Yêu thích')}</span>
        </NavLink>
        <NavLink to="/settings" className={linkCls} title={L('Settings', 'Cài đặt')}>
          <Settings className="size-[18px] shrink-0" />
          <span className="truncate max-[900px]:sr-only">{L('Settings', 'Cài đặt')}</span>
        </NavLink>
      </div>
    </aside>
  )
}

function TopBar({ onSearch, onShortcuts }: { onSearch: () => void; onShortcuts: () => void }) {
  const L = useL()
  const game = useApp((s) => s.game)
  const navigate = useNavigate()
  return (
    <header className="flex h-14 shrink-0 items-center gap-4 px-6 max-[900px]:gap-2 max-[900px]:px-3">
      <button
        onClick={onSearch}
        aria-label={L('Search', 'Tìm kiếm')}
        className="flex h-10 w-full max-w-md min-w-10 items-center gap-2 rounded-xl border border-line bg-surface-2 px-3 text-sm text-faint transition hover:border-line-strong"
      >
        <Search className="size-4 shrink-0" />
        <span className="min-w-0 flex-1 truncate text-left">
          {L('Search lessons, words, pages…', 'Tìm bài học, từ vựng, trang…')}
        </span>
        <span className="max-[700px]:hidden">
          <Kbd>Ctrl K</Kbd>
        </span>
      </button>
      <div className="flex-1" />
      <button
        onClick={onShortcuts}
        className="text-faint hover:text-text"
        aria-label={L('Keyboard shortcuts', 'Phím tắt')}
        title={L('Keyboard shortcuts (F1)', 'Phím tắt (F1)')}
      >
        <Keyboard className="size-5" />
      </button>
      {game && (
        <>
          <button
            onClick={() => navigate('/game')}
            title={L(`${game.streak.current}-day streak`, `Chuỗi ${game.streak.current} ngày`)}
            className={cx(
              'flex items-center gap-1.5 rounded-xl px-2.5 py-1.5 text-sm font-bold',
              game.streak.activeToday ? 'text-warning' : 'text-faint',
            )}
          >
            <Flame className={cx('size-5', game.streak.activeToday && 'fill-warning/30')} />
            {game.streak.current}
          </button>
          <button
            onClick={() => navigate('/game')}
            className="flex w-44 shrink-0 items-center gap-2.5 text-left max-[700px]:w-auto"
            title={`${game.xpIntoLevel}/${game.xpForNextLevel} XP`}
          >
            <div className="flex size-9 items-center justify-center rounded-xl bg-accent/15 text-sm font-bold text-accent">
              {game.level}
            </div>
            <div className="min-w-0 flex-1 max-[700px]:hidden">
              <div className="flex items-center justify-between text-xs">
                <span className="truncate font-semibold">{game.levelTitle}</span>
                <span className="flex items-center gap-0.5 text-muted">
                  <Star className="size-3" />
                  {game.todayXp}
                </span>
              </div>
              <ProgressBar value={game.xpIntoLevel} max={game.xpForNextLevel} className="mt-1 h-1.5" />
            </div>
          </button>
        </>
      )}
    </header>
  )
}

export function Shell({ children, bare }: { children: ReactNode; bare?: boolean }) {
  const L = useL()
  const navigate = useNavigate()
  const nav = useNav()
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [shortcutsOpen, setShortcutsOpen] = useState(false)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement
      const typing = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable
      // The palette and the shortcut sheet replace each other instead of stacking.
      if (e.ctrlKey && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setShortcutsOpen(false)
        setPaletteOpen(true)
      } else if (e.key === 'F1') {
        e.preventDefault()
        setPaletteOpen(false)
        setShortcutsOpen(true)
      } else if (e.ctrlKey && e.key === ',') {
        e.preventDefault()
        navigate('/settings')
      } else if (e.ctrlKey && e.key.toLowerCase() === 'r' && !typing) {
        e.preventDefault()
        navigate('/vocabulary/review')
      } else if (e.ctrlKey && /^[1-9]$/.test(e.key) && !bare) {
        const item = nav[Number(e.key) - 1]
        if (item) {
          e.preventDefault()
          navigate(item.path)
        }
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [navigate, nav, bare])

  return (
    <div className="flex h-full">
      {!bare && <Sidebar />}
      <div className="flex min-w-0 flex-1 flex-col">
        {!bare && <TopBar onSearch={() => setPaletteOpen(true)} onShortcuts={() => setShortcutsOpen(true)} />}
        {/* Content sits on a layer above the Mica-coloured window background, like Windows 11 Settings. */}
        <main
          className={cx('flex-1 overflow-y-auto', !bare && 'rounded-tl-lg border-t border-l border-line bg-layer')}
          id="main-scroll"
        >
          <AnimatePresence mode="wait">
            <motion.div
              key={bare ? 'bare' : 'app'}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className={bare ? 'h-full' : 'mx-auto max-w-6xl px-8 py-8 max-[900px]:px-4 max-[900px]:py-5'}
            >
              {children}
            </motion.div>
          </AnimatePresence>
        </main>
      </div>
      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} />
      <Modal open={shortcutsOpen} onClose={() => setShortcutsOpen(false)} title={L('Keyboard shortcuts', 'Phím tắt')}>
        <ul className="space-y-2">
          {SHORTCUTS.map((s) => (
            <li key={s.en} className="flex items-center justify-between gap-4 text-sm">
              <span className="text-muted">{L(s.en, s.vi)}</span>
              <span className="flex gap-1">
                {s.keys.map((k) => (
                  <Kbd key={k}>{k}</Kbd>
                ))}
              </span>
            </li>
          ))}
        </ul>
      </Modal>
      <Toaster />
      <RewardCelebration />
    </div>
  )
}
