// Seeded random walker ("monkey test") over the whole UI. Each step clicks a random reachable control,
// types nasty text, presses shortcuts, jumps to a random route, goes back/forward or resizes the window;
// after every step the app must stay healthy (see helpers.assertHealthy). Failures carry seed + step
// + the last actions so they can be replayed:  LQ_MONKEY_SEEDS=1234 LQ_MONKEY_STEPS=400 npx playwright test monkey
import { expect, test, type Page } from '@playwright/test'
import { launchApp, type LaunchedApp } from './fixtures'
import {
  NASTY_TEXT,
  assertHealthy,
  completeOnboarding,
  goto,
  rng,
  setWindowSize,
  stubLeavingActions,
  type Rng,
} from './helpers'

/** Progress lines (seed, slow steps, failures) go to the test log. */
const say = (msg: string) => console.warn(msg)

const SEEDS = (process.env.LQ_MONKEY_SEEDS ?? '101,202,303,404,505').split(',').map((s) => Number(s.trim()))
const STEPS = Number(process.env.LQ_MONKEY_STEPS ?? 400)

const ROUTES = [
  '/',
  '/journey',
  '/journey/course',
  '/assessment',
  '/listening',
  '/speaking',
  '/speaking/pronunciation',
  '/reading',
  '/writing',
  '/writing?free=1',
  '/writing/history',
  '/grammar',
  '/vocabulary',
  '/vocabulary/review',
  '/vocabulary/bank',
  '/cinema',
  '/tutor',
  '/game',
  '/stats',
  '/coach',
  '/coach/reports',
  '/coach/schedule',
  '/coach/ask',
  '/library',
  '/settings/general',
  '/settings/ai',
  '/settings/telegram',
  '/settings/account',
  '/settings/data',
  '/settings/about',
  '/does-not-exist',
  '/reading/not-a-real-id',
  '/cinema/not-a-real-id',
  '/grammar/not-a-real-id',
  '/listening/not-a-real-id',
  '/writing/result/not-a-real-id',
  '/journey/course/not-a-real-id',
  '/tutor/not-a-real-id',
  '/coach/reports/not-a-real-id',
]

const KEYS = [
  'Space',
  'Enter',
  'Escape',
  '1',
  '2',
  '3',
  '4',
  'Control+K',
  'F1',
  'Tab',
  'Shift+Tab',
  'ArrowLeft',
  'ArrowRight',
  'ArrowUp',
  'ArrowDown',
  'Backspace',
  'Control+R',
  'Control+,',
  'Control+3',
  'Control+7',
  'Alt+ArrowLeft',
  'Home',
  'End',
  'PageDown',
]

/**
 * Controls whose effect leaves the scope of a UI test: restoring a backup or wiping data restarts the
 * app, signing out / deleting the cloud account talks to the server. Native dialogs, external links
 * and relaunch are stubbed in the main process anyway (helpers.stubLeavingActions).
 */
const SKIP =
  /restore|khôi phục|xóa dữ liệu|delete my|xóa tài khoản|delete account|reset all|đặt lại toàn bộ|sign out|đăng xuất|quit|thoát hẳn/i

interface Target {
  x: number
  y: number
  label: string
  kind: 'click' | 'field' | 'select'
}

/** Lists controls the learner could actually hit right now (visible, enabled, topmost at their centre). */
function listTargets(page: Page): Promise<Target[]> {
  return page.evaluate((skipSrc) => {
    const skip = new RegExp(skipSrc, 'i')
    const out: Target[] = []
    const sel =
      'button, a[href], [role="tab"], [role="button"], [role="switch"], [role="option"], input, textarea, select, summary, label, .word-token'
    for (const el of Array.from(document.querySelectorAll<HTMLElement>(sel))) {
      if ((el as HTMLButtonElement).disabled) continue
      if (el instanceof HTMLInputElement && (el.type === 'file' || el.type === 'hidden')) continue
      const r = el.getBoundingClientRect()
      if (r.width < 2 || r.height < 2) continue
      const x = r.left + r.width / 2
      const y = r.top + r.height / 2
      if (x < 0 || y < 0 || x > window.innerWidth || y > window.innerHeight) continue
      const top = document.elementFromPoint(x, y)
      if (!top || !(top === el || el.contains(top))) continue
      const label = (el.getAttribute('aria-label') || el.getAttribute('data-testid') || el.textContent || el.tagName)
        .trim()
        .replace(/\s+/g, ' ')
        .slice(0, 60)
      if (skip.test(label)) continue
      const field =
        el instanceof HTMLTextAreaElement ||
        (el instanceof HTMLInputElement && !['checkbox', 'radio', 'range', 'button', 'submit'].includes(el.type)) ||
        el.isContentEditable
      out.push({
        x,
        y,
        label: `${el.tagName.toLowerCase()}:${label}`,
        kind: field ? 'field' : el instanceof HTMLSelectElement ? 'select' : 'click',
      })
    }
    return out
  }, SKIP.source)
}

async function step(lq: LaunchedApp, r: Rng): Promise<string> {
  const { page, app } = lq
  const roll = r.next()
  if (roll < 0.5) {
    const targets = await listTargets(page)
    if (!targets.length) return 'no targets'
    const t = r.pick(targets)
    if (t.kind === 'field') {
      await page.mouse.click(t.x, t.y)
      const text = r.pick(NASTY_TEXT)
      // Long strings are pasted (fill), short ones typed key by key like a real learner.
      if (text.length > 60 || r.chance(0.3)) {
        await page
          .locator(':focus')
          .fill(text, { timeout: 1500 })
          .catch(() => undefined)
      } else await page.keyboard.type(text, { delay: 2 })
      if (r.chance(0.4)) await page.keyboard.press('Enter')
      return `type "${text.slice(0, 24)}"(${text.length}) into ${t.label}`
    }
    if (t.kind === 'select') {
      await page.mouse.click(t.x, t.y)
      await page.keyboard.press(r.pick(['ArrowDown', 'ArrowUp', 'End']))
      await page.keyboard.press('Enter')
      return `select ${t.label}`
    }
    if (r.chance(0.08)) {
      await page.mouse.dblclick(t.x, t.y)
      return `dblclick ${t.label}`
    }
    await page.mouse.click(t.x, t.y)
    return `click ${t.label}`
  }
  if (roll < 0.72) {
    const key = r.pick(KEYS)
    await page.keyboard.press(key)
    return `key ${key}`
  }
  if (roll < 0.85) {
    const route = r.pick(ROUTES)
    await goto(page, route)
    return `goto ${route}`
  }
  if (roll < 0.91) {
    const back = r.chance(0.6)
    await page.evaluate((b) => (b ? history.back() : history.forward()), back)
    return back ? 'history back' : 'history forward'
  }
  if (roll < 0.96) {
    const w = 1024 + r.int(897)
    const h = 680 + r.int(401)
    await setWindowSize(app, w, h)
    return `resize ${w}×${h}`
  }
  if (roll < 0.98) {
    await page.mouse.wheel(0, r.int(2000) - 500)
    return 'scroll'
  }
  const ms = r.int(800)
  await page.waitForTimeout(ms)
  return `wait ${ms}ms`
}

for (const seed of SEEDS) {
  test(`monkey walk seed=${seed} (${STEPS} actions)`, async () => {
    test.setTimeout(Math.max(120_000, STEPS * 2500))
    const lq = await launchApp()
    const failures: string[] = []
    try {
      await stubLeavingActions(lq.app)
      await completeOnboarding(lq.page)
      const r = rng(seed)
      const log: string[] = []
      let seen = lq.consoleErrors.length
      say(`[monkey] seed=${seed} steps=${STEPS}`)
      for (let i = 0; i < STEPS; i++) {
        let action = '?'
        const t0 = Date.now()
        try {
          action = await step(lq, r)
        } catch (err) {
          action = `action threw: ${(err as Error).message.split('\n')[0]}`
        }
        const t1 = Date.now()
        log.push(`${i}: ${action}`)
        await lq.page.waitForTimeout(60)
        try {
          await assertHealthy(lq, seen, { ping: i % 3 === 0 })
          if (Date.now() - t0 > 1500)
            say(`[monkey] slow step ${i} ${action} act=${t1 - t0}ms total=${Date.now() - t0}ms`)
        } catch (err) {
          failures.push(
            `seed=${seed} step=${i} ${(err as Error).message}\n    last actions: ${log.slice(-6).join(' ▸ ')}`,
          )
          say(`[monkey] FAIL ${failures.at(-1)}`)
          if (failures.length >= 8) break
          // Recover so one bug does not hide the next: close overlays and return to the dashboard.
          await lq.page.keyboard.press('Escape').catch(() => undefined)
          await lq.page.reload().catch(() => undefined)
          await lq.page.waitForSelector('#main-scroll', { timeout: 10_000 }).catch(() => undefined)
          await goto(lq.page, '/').catch(() => undefined)
        }
        seen = lq.consoleErrors.length
      }
      say(`[monkey] seed=${seed} done: ${failures.length} failure(s)`)
    } finally {
      await lq.close().catch(() => undefined)
    }
    expect(failures, failures.join('\n')).toEqual([])
  })
}
