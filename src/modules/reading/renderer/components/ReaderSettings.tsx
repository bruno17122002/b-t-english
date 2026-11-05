// Reader display preferences (font size, line height, font family, page theme), persisted per device.
import { AArrowDown, AArrowUp, Moon, Sun, Coffee, Monitor, Type, Rows3 } from 'lucide-react'
import { useCallback, useState, type CSSProperties } from 'react'
import { cx, IconButton } from '@/components/ui'
import { useL } from '@/i18n'

export type ReaderTheme = 'app' | 'paper' | 'sepia' | 'night'

export interface ReaderPrefs {
  fontSize: number
  lineHeight: number
  serif: boolean
  theme: ReaderTheme
  showSummary: boolean
}

const DEFAULTS: ReaderPrefs = { fontSize: 19, lineHeight: 1.8, serif: true, theme: 'app', showSummary: false }
const KEY = 'lq.reading.prefs'

/**
 * Page palettes for the reading surface only. They override the design tokens locally so every nested
 * component (word popovers, buttons) follows the chosen reading mode. Colours here are the "paper"
 * illustration of each mode.
 */
export const READER_THEMES: Record<ReaderTheme, CSSProperties> = {
  app: {},
  paper: {
    ['--surface' as string]: '#fdfcf8',
    ['--surface-2' as string]: '#f3f1ea',
    ['--surface-3' as string]: '#e9e6dc',
    ['--text' as string]: '#1d1f29',
    ['--muted' as string]: '#585d70',
    ['--faint' as string]: '#878b9c',
    ['--line' as string]: 'rgb(20 22 40 / 0.09)',
    ['--line-strong' as string]: 'rgb(20 22 40 / 0.18)',
    colorScheme: 'light',
  },
  sepia: {
    ['--surface' as string]: '#f5ecd7',
    ['--surface-2' as string]: '#ede1c6',
    ['--surface-3' as string]: '#e3d4b4',
    ['--text' as string]: '#3d2f20',
    ['--muted' as string]: '#6b5841',
    ['--faint' as string]: '#937e64',
    ['--line' as string]: 'rgb(61 47 32 / 0.13)',
    ['--line-strong' as string]: 'rgb(61 47 32 / 0.24)',
    colorScheme: 'light',
  },
  night: {
    ['--surface' as string]: '#0c0d12',
    ['--surface-2' as string]: '#14161d',
    ['--surface-3' as string]: '#1c1f28',
    ['--text' as string]: '#cfd2db',
    ['--muted' as string]: '#8a8fa0',
    ['--faint' as string]: '#626777',
    ['--line' as string]: 'rgb(255 255 255 / 0.07)',
    ['--line-strong' as string]: 'rgb(255 255 255 / 0.14)',
    colorScheme: 'dark',
  },
}

function load(): ReaderPrefs {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return DEFAULTS
    const v = JSON.parse(raw) as Partial<ReaderPrefs>
    return {
      fontSize: typeof v.fontSize === 'number' ? Math.min(28, Math.max(14, v.fontSize)) : DEFAULTS.fontSize,
      lineHeight: typeof v.lineHeight === 'number' ? Math.min(2.4, Math.max(1.4, v.lineHeight)) : DEFAULTS.lineHeight,
      serif: typeof v.serif === 'boolean' ? v.serif : DEFAULTS.serif,
      theme: v.theme && v.theme in READER_THEMES ? v.theme : DEFAULTS.theme,
      showSummary: typeof v.showSummary === 'boolean' ? v.showSummary : DEFAULTS.showSummary,
    }
  } catch {
    return DEFAULTS
  }
}

export function useReaderPrefs() {
  const [prefs, setPrefs] = useState<ReaderPrefs>(load)
  const update = useCallback((patch: Partial<ReaderPrefs>) => {
    setPrefs((prev) => {
      const next = { ...prev, ...patch }
      try {
        localStorage.setItem(KEY, JSON.stringify(next))
      } catch {
        /* storage unavailable – keep in memory */
      }
      return next
    })
  }, [])
  return [prefs, update] as const
}

export function ReaderSettingsBar({
  prefs,
  update,
}: {
  prefs: ReaderPrefs
  update: (p: Partial<ReaderPrefs>) => void
}) {
  const L = useL()
  const themes: { value: ReaderTheme; icon: typeof Sun; label: string }[] = [
    { value: 'app', icon: Monitor, label: L('App theme', 'Theo ứng dụng') },
    { value: 'paper', icon: Sun, label: L('Paper', 'Giấy trắng') },
    { value: 'sepia', icon: Coffee, label: L('Sepia', 'Sepia') },
    { value: 'night', icon: Moon, label: L('Night', 'Ban đêm') },
  ]
  return (
    <div
      className="flex flex-wrap items-center gap-1 rounded-xl border border-line bg-surface-2 p-1"
      data-testid="reader-settings"
    >
      <IconButton
        label={L('Smaller text', 'Chữ nhỏ hơn')}
        onClick={() => update({ fontSize: Math.max(14, prefs.fontSize - 1) })}
      >
        <AArrowDown className="size-4" />
      </IconButton>
      <span className="w-8 text-center text-xs text-muted tabular-nums">{prefs.fontSize}</span>
      <IconButton
        label={L('Larger text', 'Chữ lớn hơn')}
        onClick={() => update({ fontSize: Math.min(28, prefs.fontSize + 1) })}
      >
        <AArrowUp className="size-4" />
      </IconButton>
      <span className="mx-1 h-5 w-px bg-line" />
      <IconButton
        label={L(`Line spacing ${prefs.lineHeight.toFixed(1)}`, `Giãn dòng ${prefs.lineHeight.toFixed(1)}`)}
        onClick={() =>
          update({ lineHeight: prefs.lineHeight >= 2.2 ? 1.5 : Math.round((prefs.lineHeight + 0.2) * 10) / 10 })
        }
      >
        <Rows3 className="size-4" />
      </IconButton>
      <IconButton
        label={prefs.serif ? L('Sans-serif font', 'Phông không chân') : L('Serif font', 'Phông có chân')}
        onClick={() => update({ serif: !prefs.serif })}
        className={prefs.serif ? 'text-accent' : undefined}
      >
        <Type className="size-4" />
      </IconButton>
      <span className="mx-1 h-5 w-px bg-line" />
      {themes.map((t) => (
        <IconButton
          key={t.value}
          label={t.label}
          onClick={() => update({ theme: t.value })}
          className={cx(prefs.theme === t.value && 'bg-surface-3 text-accent')}
        >
          <t.icon className="size-4" />
        </IconButton>
      ))}
    </div>
  )
}
