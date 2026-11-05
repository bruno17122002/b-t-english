// Accent colour themes unlocked by level: preview swatch, apply button, required level for locked ones.
import { Check, Lock, Palette } from 'lucide-react'
import type { GameState } from '@shared/types'
import { Button, cx } from '@/components/ui'
import { useL, useTx } from '@/i18n'
import { useApp } from '@/lib/store'
import { accentThemes } from '../lib/meta'

export function RewardsPanel({ game }: { game: GameState }) {
  const L = useL()
  const tx = useTx()
  const current = useApp((s) => s.settings?.accent ?? 'aurora')
  const themes = accentThemes()

  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5" data-testid="rewards">
      {themes.map((t) => {
        const unlocked = game.unlockedAccents.includes(t.key) || game.level >= t.level
        const active = current === t.key
        return (
          <div
            key={t.key}
            className={cx(
              'relative overflow-hidden rounded-2xl border p-4 transition',
              active ? 'border-accent/60 bg-surface-2' : 'border-line bg-surface',
              !unlocked && 'opacity-70',
            )}
          >
            <div
              className={cx('h-16 rounded-xl', !unlocked && 'grayscale')}
              style={{ background: t.swatch[0] }}
              aria-hidden
            >
              {!unlocked && (
                <div className="flex h-full items-center justify-center bg-black/35 text-white">
                  <Lock className="size-5" />
                </div>
              )}
            </div>
            <div className="mt-3 flex items-center justify-between gap-2">
              <div>
                <div className="text-sm font-semibold">{tx(t.name)}</div>
                <div className="text-xs text-faint">
                  {unlocked ? L('Unlocked', 'Đã mở khóa') : L(`Requires level ${t.level}`, `Cần cấp ${t.level}`)}
                </div>
              </div>
              <Palette className="size-4 shrink-0 text-faint" aria-hidden />
            </div>
            <Button
              size="sm"
              variant={active ? 'success' : 'secondary'}
              className="mt-3 w-full"
              disabled={!unlocked || active}
              icon={active ? <Check className="size-3.5" /> : undefined}
              onClick={() => void useApp.getState().updateSettings({ accent: t.key })}
              data-testid={`accent-apply-${t.key}`}
            >
              {active
                ? L('In use', 'Đang dùng')
                : unlocked
                  ? L('Apply', 'Áp dụng')
                  : L(`Level ${t.level}`, `Cấp ${t.level}`)}
            </Button>
          </div>
        )
      })}
    </div>
  )
}
