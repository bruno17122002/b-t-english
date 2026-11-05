// Always-mounted, invisible habit tracker: feeds input, focus, visibility and route changes into the pure
// HabitTracker and flushes cumulative snapshots to main every minute and whenever the window is hidden.
import { useEffect, useRef } from 'react'
import { useLocation } from 'react-router-dom'
import { api } from '@/lib/api'
import { FLUSH_MS, HabitTracker } from '../shared/tracker'

const INPUT_EVENTS = ['pointerdown', 'pointermove', 'keydown', 'wheel', 'touchstart'] as const

export function HabitTrackerMount() {
  const location = useLocation()
  const tracker = useRef<HabitTracker | null>(null)
  if (!tracker.current) tracker.current = new HabitTracker(Date.now())

  useEffect(() => {
    tracker.current?.navigate(`${location.pathname}${location.search}`, Date.now())
  }, [location.pathname, location.search])

  useEffect(() => {
    const t = tracker.current
    if (!t) return
    let lastMove = 0
    const flush = () => {
      const payload = t.flush(Date.now())
      if (payload) api('coach:track', payload).catch(() => undefined)
    }
    const onInput = (e: Event) => {
      const now = Date.now()
      // Mouse moves are frequent – sample them.
      if (e.type === 'pointermove' && now - lastMove < 5000) return
      lastMove = now
      t.input(now)
    }
    const onVisibility = () => {
      const visible = document.visibilityState === 'visible'
      t.setVisible(visible, Date.now())
      if (!visible) flush()
    }
    const onFocus = () => t.setFocused(true, Date.now())
    const onBlur = () => t.setFocused(false, Date.now())
    for (const ev of INPUT_EVENTS) window.addEventListener(ev, onInput, { passive: true, capture: true })
    document.addEventListener('visibilitychange', onVisibility)
    window.addEventListener('focus', onFocus)
    window.addEventListener('blur', onBlur)
    window.addEventListener('pagehide', flush)
    t.setVisible(document.visibilityState === 'visible', Date.now())
    t.setFocused(document.hasFocus(), Date.now())
    const tick = window.setInterval(() => t.tick(Date.now()), 15_000)
    const flusher = window.setInterval(flush, FLUSH_MS)
    return () => {
      for (const ev of INPUT_EVENTS) window.removeEventListener(ev, onInput, { capture: true })
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('focus', onFocus)
      window.removeEventListener('blur', onBlur)
      window.removeEventListener('pagehide', flush)
      window.clearInterval(tick)
      window.clearInterval(flusher)
      flush()
    }
  }, [])

  return null
}
