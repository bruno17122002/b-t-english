// Transport controls for a track: play all / stop, previous / next line, replay, loop and speed.
import { Gauge, Pause, Play, Repeat, RotateCcw, SkipBack, SkipForward } from 'lucide-react'
import type { ListeningTrack } from '@shared/content'
import { IconButton, cx } from '@/components/ui'
import { useL } from '@/i18n'
import { SPEED_MAX, SPEED_MIN, type TrackPlayer } from '../lib/usePlayer'

export function PlayerBar({
  track,
  player,
  compact,
}: {
  track: ListeningTrack
  player: TrackPlayer
  compact?: boolean
}) {
  const L = useL()
  const cur = player.current ?? 0
  const total = track.lines.length
  const speaker = track.speakers.find((s) => s.id === track.lines[cur]?.speaker)
  return (
    <div
      className={cx(
        'flex flex-wrap items-center gap-3 rounded-2xl border border-line bg-surface-2 px-4',
        compact ? 'py-2' : 'py-3',
      )}
      data-testid="listening-player"
    >
      <div className="flex items-center gap-1">
        <IconButton
          label={L('Previous line', 'Câu trước')}
          onClick={() => void player.playLine(Math.max(0, cur - 1))}
          disabled={cur === 0}
        >
          <SkipBack className="size-4" />
        </IconButton>
        <button
          onClick={() =>
            player.playing
              ? player.stop()
              : player.playAll(player.current !== null && player.current < total - 1 ? player.current : 0)
          }
          aria-label={player.playing ? L('Stop', 'Dừng') : L('Play all', 'Phát cả bài')}
          className="flex size-11 items-center justify-center rounded-full bg-accent text-accent-ink shadow-card transition hover:brightness-110"
          data-testid="listening-play-all"
        >
          {player.playing ? <Pause className="size-5" /> : <Play className="ml-0.5 size-5" />}
        </button>
        <IconButton
          label={L('Next line', 'Câu sau')}
          onClick={() => void player.playLine(Math.min(total - 1, cur + 1))}
          disabled={cur >= total - 1}
        >
          <SkipForward className="size-4" />
        </IconButton>
        <IconButton label={L('Replay line', 'Nghe lại câu')} onClick={() => void player.playLine(cur)}>
          <RotateCcw className="size-4" />
        </IconButton>
        <IconButton
          label={player.loop ? L('Loop sentence: on', 'Lặp câu: bật') : L('Loop sentence: off', 'Lặp câu: tắt')}
          onClick={() => player.setLoop(!player.loop)}
          className={player.loop ? 'bg-accent/15 text-accent' : undefined}
        >
          <Repeat className="size-4" />
        </IconButton>
      </div>
      <div className="min-w-24 text-sm text-muted tabular-nums">
        {L('Line', 'Câu')} {player.current === null ? '–' : cur + 1}/{total}
        {speaker && player.current !== null && <span className="ml-2 text-faint">· {speaker.name}</span>}
      </div>
      <label className="ml-auto flex items-center gap-2 text-sm text-muted">
        <Gauge className="size-4" />
        <span className="sr-only">{L('Speed', 'Tốc độ')}</span>
        <input
          type="range"
          min={SPEED_MIN}
          max={SPEED_MAX}
          step={0.05}
          value={player.speed}
          onChange={(e) => player.setSpeed(Number(e.target.value))}
          className="w-28 accent-[var(--accent)]"
          aria-label={L('Speed', 'Tốc độ')}
        />
        <span className="w-12 font-mono text-xs tabular-nums">{player.speed.toFixed(2)}×</span>
      </label>
    </div>
  )
}
