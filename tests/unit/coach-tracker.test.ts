import { describe, expect, it } from 'vitest'
import { HabitTracker, IDLE_MS, moduleForRoute, SESSION_GAP_MS } from '../../src/modules/coach/shared/tracker'

const T0 = new Date(2026, 10, 5, 20, 0).getTime()
const sec = 1000
const min = 60 * sec

describe('HabitTracker', () => {
  it('counts active time per session and per page view', () => {
    const tr = new HabitTracker(T0, () => 0.5)
    tr.navigate('/listening', T0)
    tr.input(T0 + 30 * sec)
    tr.navigate('/vocabulary/review', T0 + 60 * sec)
    tr.input(T0 + 90 * sec)
    const p = tr.flush(T0 + 120 * sec)
    expect(p?.sessions).toHaveLength(1)
    expect(p?.sessions[0]).toMatchObject({ activeSeconds: 120, ended: false })
    expect(p?.views.map((v) => [v.route, v.activeSeconds])).toEqual([
      ['/listening', 60],
      ['/vocabulary/review', 60],
    ])
    // Snapshots are cumulative and repeat the current view only.
    const p2 = tr.flush(T0 + 150 * sec)
    expect(p2?.sessions[0]?.activeSeconds).toBe(150)
    expect(p2?.views).toHaveLength(1)
    expect(p2?.views[0]).toMatchObject({ route: '/vocabulary/review', activeSeconds: 90 })
  })

  it('stops counting after 2 minutes without input (idle)', () => {
    const tr = new HabitTracker(T0)
    tr.navigate('/reading', T0)
    tr.tick(T0 + 10 * min)
    expect(tr.isActive(T0 + 10 * min)).toBe(false)
    const p = tr.flush(T0 + 10 * min)
    expect(p?.sessions[0]?.activeSeconds).toBe(IDLE_MS / 1000)
    expect(p?.sessions[0]?.idleSeconds).toBe(8 * 60)
  })

  it('does not count time while hidden or unfocused', () => {
    const tr = new HabitTracker(T0)
    tr.navigate('/writing', T0)
    tr.setFocused(false, T0 + 30 * sec)
    tr.input(T0 + 60 * sec) // input while another window is focused is ignored
    tr.setFocused(true, T0 + 5 * min)
    tr.setVisible(false, T0 + 5 * min + 20 * sec)
    const p = tr.flush(T0 + 20 * min)
    expect(p?.sessions[0]?.activeSeconds).toBe(50)
  })

  it('starts a new session after a long break and ends the old one', () => {
    const tr = new HabitTracker(T0, () => 0.25)
    tr.navigate('/', T0)
    tr.input(T0 + 60 * sec)
    const first = tr.flush(T0 + 60 * sec)?.sessions[0]?.id
    tr.input(T0 + 60 * sec + SESSION_GAP_MS + 5 * min)
    const p = tr.flush(T0 + 60 * sec + SESSION_GAP_MS + 6 * min)
    expect(p?.sessions).toHaveLength(2)
    expect(p?.sessions[0]).toMatchObject({ id: first, ended: true })
    expect(p?.sessions[1]?.id).not.toBe(first)
    expect(p?.sessions[1]?.ended).toBe(false)
  })

  it('returns null when nothing happened', () => {
    expect(new HabitTracker(T0).flush(T0 + min)).toBeNull()
  })

  it('maps routes to modules', () => {
    expect(moduleForRoute('/')).toBe('dashboard')
    expect(moduleForRoute('/listening/abc')).toBe('listening')
    expect(moduleForRoute('/stats')).toBe('game')
    expect(moduleForRoute('/assessment')).toBe('journey')
    expect(moduleForRoute('/writing?prompt=x')).toBe('writing')
    expect(moduleForRoute('/unknown')).toBe('other')
  })
})
