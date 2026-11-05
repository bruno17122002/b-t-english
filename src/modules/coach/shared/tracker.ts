// Pure habit tracker used by the always-mounted renderer component: counts active seconds per app session and
// per page view (only while the window is visible, focused and the learner gave input in the last 2 minutes),
// and produces idempotent snapshots that main upserts. No DOM or React imports – unit tested.

export const IDLE_MS = 2 * 60_000
/** A new session starts after this long without activity. */
export const SESSION_GAP_MS = 30 * 60_000
export const FLUSH_MS = 60_000

export interface SessionSnapshot {
  id: string
  startedAt: string
  lastActiveAt: string
  activeSeconds: number
  idleSeconds: number
  ended: boolean
}

export interface ViewSnapshot {
  id: string
  sessionId: string
  route: string
  startedAt: string
  endedAt: string
  activeSeconds: number
}

export interface TrackPayload {
  sessions: SessionSnapshot[]
  views: ViewSnapshot[]
}

const KNOWN_MODULES = new Set([
  'journey',
  'listening',
  'speaking',
  'reading',
  'writing',
  'grammar',
  'vocabulary',
  'cinema',
  'tutor',
  'game',
  'coach',
  'settings',
  'library',
])

/** Module (feature area) a hash route belongs to. */
export function moduleForRoute(route: string): string {
  const seg = (route.split('?')[0] ?? '').split('/').filter(Boolean)[0]?.toLowerCase() ?? ''
  if (!seg) return 'dashboard'
  if (seg === 'stats') return 'game'
  if (seg === 'onboarding' || seg === 'assessment') return 'journey'
  return KNOWN_MODULES.has(seg) ? seg : 'other'
}

interface SessionState {
  id: string
  startedAt: number
  lastActiveAt: number
  activeMs: number
  idleMs: number
}

interface ViewState {
  id: string
  route: string
  startedAt: number
  endedAt: number
  activeMs: number
}

const iso = (ms: number) => new Date(ms).toISOString()
const secs = (ms: number) => Math.round(ms / 1000)

export class HabitTracker {
  private session: SessionState | null = null
  private view: ViewState | null = null
  private route = '/'
  private visible = true
  private focused = true
  private lastInputAt = -Infinity
  private lastTickAt: number
  private pendingSessions: SessionSnapshot[] = []
  private pendingViews: ViewSnapshot[] = []
  private seq = 0

  constructor(
    now: number,
    private readonly random: () => number = Math.random,
  ) {
    this.lastTickAt = now
  }

  private newId(now: number): string {
    this.seq++
    return `${now.toString(36)}-${this.seq.toString(36)}-${Math.floor(this.random() * 1e8).toString(36)}`
  }

  /** Accounts the time since the last call as active, idle or away. */
  private advance(now: number): void {
    const from = this.lastTickAt
    this.lastTickAt = Math.max(from, now)
    const s = this.session
    if (!s || now <= from) return
    const engaged = this.visible && this.focused
    const activeUntil = Math.min(now, this.lastInputAt + IDLE_MS)
    const active = engaged ? Math.max(0, activeUntil - from) : 0
    if (active > 0) {
      s.activeMs += active
      s.lastActiveAt = Math.max(s.lastActiveAt, from + active)
      if (this.view) {
        this.view.activeMs += active
        this.view.endedAt = from + active
      }
    }
    if (this.visible) s.idleMs = Math.min(SESSION_GAP_MS * 4, s.idleMs + (now - from - active))
  }

  private expired(now: number): boolean {
    return !!this.session && now - this.session.lastActiveAt > SESSION_GAP_MS
  }

  private closeView(): void {
    const v = this.view
    const s = this.session
    this.view = null
    if (!v || !s || v.activeMs < 1000) return
    this.pendingViews.push(this.viewSnapshot(v, s.id))
  }

  private endSession(): void {
    this.closeView()
    const s = this.session
    this.session = null
    if (s && s.activeMs >= 1000) this.pendingSessions.push(this.sessionSnapshot(s, true))
  }

  private startView(now: number): void {
    if (!this.session) return
    this.view = { id: this.newId(now), route: this.route, startedAt: now, endedAt: now, activeMs: 0 }
  }

  private sessionSnapshot(s: SessionState, ended: boolean): SessionSnapshot {
    return {
      id: s.id,
      startedAt: iso(s.startedAt),
      lastActiveAt: iso(Math.max(s.startedAt, s.lastActiveAt)),
      activeSeconds: secs(s.activeMs),
      idleSeconds: secs(s.idleMs),
      ended,
    }
  }

  private viewSnapshot(v: ViewState, sessionId: string): ViewSnapshot {
    return {
      id: v.id,
      sessionId,
      route: v.route.slice(0, 200),
      startedAt: iso(v.startedAt),
      endedAt: iso(Math.max(v.startedAt, v.endedAt)),
      activeSeconds: secs(v.activeMs),
    }
  }

  /** Keyboard, mouse, wheel or touch input. */
  input(now: number): void {
    this.advance(now)
    if (this.expired(now)) this.endSession()
    this.lastInputAt = now
    if (!this.visible || !this.focused) return
    if (!this.session) {
      this.session = { id: this.newId(now), startedAt: now, lastActiveAt: now, activeMs: 0, idleMs: 0 }
    }
    if (!this.view) this.startView(now)
  }

  navigate(route: string, now: number): void {
    this.advance(now)
    if (route !== this.route || !this.view) {
      this.closeView()
      this.route = route
      this.startView(now)
    }
    // A navigation is a deliberate action of the learner.
    this.input(now)
  }

  setVisible(visible: boolean, now: number): void {
    this.advance(now)
    this.visible = visible
    if (visible) this.input(now)
  }

  setFocused(focused: boolean, now: number): void {
    this.advance(now)
    this.focused = focused
    if (focused) this.input(now)
  }

  tick(now: number): void {
    this.advance(now)
    if (this.expired(now)) this.endSession()
  }

  /** True while the learner counts as active (visible, focused, input within IDLE_MS). */
  isActive(now: number): boolean {
    return !!this.session && this.visible && this.focused && now - this.lastInputAt < IDLE_MS
  }

  /** Cumulative snapshots of finished and current session/view; null when there is nothing to send. */
  flush(now: number): TrackPayload | null {
    this.tick(now)
    const sessions = this.pendingSessions.splice(0)
    const views = this.pendingViews.splice(0)
    if (this.session && this.session.activeMs >= 1000) sessions.push(this.sessionSnapshot(this.session, false))
    if (this.session && this.view && this.view.activeMs >= 1000)
      views.push(this.viewSnapshot(this.view, this.session.id))
    return sessions.length || views.length ? { sessions, views } : null
  }
}
