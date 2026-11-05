// Floating menu shown over selected passage text: highlight (with colour), add a note, explain with AI, listen.
import { motion } from 'framer-motion'
import { Check, Highlighter, Sparkles, StickyNote, Volume2 } from 'lucide-react'
import { useState } from 'react'
import { Button, cx, IconButton, Input } from '@/components/ui'
import { useL } from '@/i18n'
import { speak } from '@/lib/audio'
import type { HighlightColor } from '../../contract'

export const HIGHLIGHT_CLASS: Record<HighlightColor, string> = {
  amber: 'bg-amber-400/30',
  green: 'bg-emerald-400/30',
  blue: 'bg-sky-400/30',
  pink: 'bg-pink-400/30',
}
export const HIGHLIGHT_DOT: Record<HighlightColor, string> = {
  amber: 'bg-amber-400',
  green: 'bg-emerald-400',
  blue: 'bg-sky-400',
  pink: 'bg-pink-400',
}
const COLORS: HighlightColor[] = ['amber', 'green', 'blue', 'pink']

export interface TextSelection {
  text: string
  context: string
  x: number
  y: number
}

export function SelectionMenu({
  sel,
  onHighlight,
  onExplain,
  busy,
}: {
  sel: TextSelection
  onHighlight: (color: HighlightColor, note: string) => void
  onExplain: () => void
  busy: boolean
}) {
  const L = useL()
  const [noteMode, setNoteMode] = useState(false)
  const [note, setNote] = useState('')
  const [color, setColor] = useState<HighlightColor>('amber')
  return (
    <motion.div
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      data-selection-menu
      className="absolute z-50 -translate-x-1/2 -translate-y-full rounded-xl border border-line-strong bg-surface p-1.5 shadow-card"
      style={{ left: sel.x, top: sel.y - 8 }}
      onMouseDown={(e) => e.stopPropagation()}
      onMouseUp={(e) => e.stopPropagation()}
    >
      {noteMode ? (
        <form
          className="flex w-72 items-center gap-1.5"
          onSubmit={(e) => {
            e.preventDefault()
            onHighlight(color, note)
          }}
        >
          <Input
            autoFocus
            value={note}
            maxLength={2000}
            onChange={(e) => setNote(e.target.value)}
            placeholder={L('Your note…', 'Ghi chú của bạn…')}
            className="h-8"
          />
          <Button type="submit" size="sm" variant="primary" loading={busy} icon={<Check className="size-4" />}>
            {L('Save', 'Lưu')}
          </Button>
        </form>
      ) : (
        <div className="flex items-center gap-1">
          <span className="flex items-center gap-1 px-1" aria-label={L('Highlight colour', 'Màu đánh dấu')}>
            {COLORS.map((c) => (
              <button
                key={c}
                title={c}
                aria-label={c}
                onClick={() => setColor(c)}
                className={cx(
                  'size-4 rounded-full ring-offset-2 ring-offset-surface transition',
                  HIGHLIGHT_DOT[c],
                  color === c && 'ring-2 ring-text',
                )}
              />
            ))}
          </span>
          <Button
            size="sm"
            variant="ghost"
            disabled={busy}
            icon={<Highlighter className="size-4" />}
            onClick={() => onHighlight(color, '')}
            data-testid="reading-highlight"
          >
            {L('Highlight', 'Đánh dấu')}
          </Button>
          <Button size="sm" variant="ghost" icon={<StickyNote className="size-4" />} onClick={() => setNoteMode(true)}>
            {L('Note', 'Ghi chú')}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            icon={<Sparkles className="size-4" />}
            onClick={onExplain}
            data-testid="reading-explain"
          >
            {L('Explain', 'Giải thích')}
          </Button>
          <IconButton label={L('Listen', 'Nghe')} onClick={() => void speak(sel.text)}>
            <Volume2 className="size-4" />
          </IconButton>
        </div>
      )}
    </motion.div>
  )
}
