// Targeted abuse tests: what a careless or mischievous learner does to the UI. Double/triple clicks and
// Enter spam on every primary action (exactly one effect, controls disabled while pending), leaving a
// page mid-request, shortcuts on the wrong page, stacked dialogs, very long and exotic text, empty data,
// no microphone, offline AI, reloads, rapid theme/language switching, zoom and a burst of rewards.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { expect, test, type Locator, type Page } from '@playwright/test'
import { dismissRewards, expectNoSeriousErrors, launchApp, seriousErrors, type LaunchedApp } from './fixtures'
import {
  OFFLINE_ERROR,
  assertHealthy,
  completeOnboarding,
  goto,
  instrumentIpc,
  ipcCalls,
  setIpcDelay,
  setIpcFailure,
  setWindowSize,
  stubLeavingActions,
} from './helpers'

let lq: LaunchedApp
// Not serial: after a failure Playwright starts a fresh worker (and app) and carries on with the next test.

test.beforeAll(async () => {
  lq = await launchApp()
  await stubLeavingActions(lq.app)
  await instrumentIpc(lq.app)
  await completeOnboarding(lq.page, 'Lan')
})

test.afterAll(async () => {
  await lq?.close()
})

test.afterEach(async () => {
  // Every test leaves the shared app with normal latency and no injected failures.
  await lq.app.evaluate(() => {
    const s = (globalThis as unknown as { __lqIpc: { delay: object; fail: object } }).__lqIpc
    s.delay = {}
    s.fail = {}
  })
})

const go = async (page: Page, route: string) => {
  await dismissRewards(page)
  await goto(page, route)
}

/** Clicks the centre of a control `n` times as fast as a mouse can (no waiting between clicks). */
async function hammer(page: Page, target: Locator, n = 3) {
  const box = await target.boundingBox()
  if (!box) throw new Error('target not visible')
  for (let i = 0; i < n; i++) await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2)
}

/** Runs `act` with `channel` slowed down and checks it reached the main process exactly once. */
async function exactlyOnce(channel: string, act: () => Promise<void>, delayMs = 700) {
  const before = await ipcCalls(lq.app, channel)
  await setIpcDelay(lq.app, channel, delayMs)
  await act()
  await lq.page.waitForTimeout(delayMs + 400)
  expect(await ipcCalls(lq.app, channel), `${channel} calls`).toBe(before + 1)
}

async function saveWords(page: Page, words: string[]) {
  await page.evaluate(async (list) => {
    for (const word of list)
      await window.lq.invoke('vocab:save', { word, meaningVi: `nghĩa của ${word}`, sourceModule: 'manual' })
  }, words)
}

// ---------------------------------------------------------------- double submits

test.describe('double / triple clicks cause exactly one effect', () => {
  test('save word from the reader', async () => {
    const { page } = lq
    const id = await page.evaluate(async () => {
      const res = await window.lq.invoke('reading:library')
      const data = res.ok ? (res.data as { passages?: { id: string }[]; items?: { id: string }[] }) : null
      return (data?.passages ?? data?.items ?? [])[0]?.id ?? 'rd-a1-new-neighbour'
    })
    await go(page, `/reading/${id}`)
    await page.locator('.word-token').nth(5).click()
    const save = page.getByRole('button', { name: /Save word|Lưu từ/ }).first()
    await expect(save).toBeVisible()
    await exactlyOnce('vocab:save', async () => {
      await hammer(page, save, 3)
    })
    await dismissRewards(page)
    await expect(page.getByRole('button', { name: /Saved|Đã lưu/ }).first()).toBeVisible()
  })

  test('flashcard rating (buttons and 1–4 keys), next card starts face down', async () => {
    const { page } = lq
    await saveWords(page, ['harbour', 'lantern', 'meadow', 'orchard'])
    await go(page, '/vocabulary/review')
    await expect(page.getByRole('button', { name: /Show answer|Xem đáp án/ })).toBeVisible()
    await page.keyboard.press('Space')
    await exactlyOnce('vocab:review', async () => {
      for (let i = 0; i < 4; i++) await page.keyboard.press('3')
    })
    await dismissRewards(page)
    // The next card must not reveal its answer before the learner flips it.
    await expect(page.getByRole('button', { name: /Show answer|Xem đáp án/ })).toBeVisible()
    await page.keyboard.press('Space')
    const good = page.getByRole('button', { name: /Good|Tốt/ }).first()
    await exactlyOnce('vocab:review', async () => {
      await hammer(page, good, 3)
    })
    await dismissRewards(page)
    await assertHealthy(lq, 0)
  })

  test('writing submit', async () => {
    const { page } = lq
    await go(page, '/writing?free=1')
    await page
      .getByTestId('writing-editor')
      .fill('Last weekend I visit my grandmother in Hue. We cook together and she tell me many stories.')
    const submit = page.getByTestId('writing-submit')
    await exactlyOnce(
      'writing:submit',
      async () => {
        await hammer(page, submit, 3)
        await expect(submit).toBeDisabled()
      },
      900,
    )
    await dismissRewards(page)
    await expect(page.getByTestId('writing-feedback')).toBeVisible()
  })

  test('grammar drill: Enter spam on every item submits the drill once', async () => {
    const { page } = lq
    const before = await ipcCalls(lq.app, 'grammar:submit')
    await go(page, '/grammar')
    await page.locator('[data-testid^="grammar-topic-"]').first().click()
    await page.getByTestId('grammar-start-drill').click()
    await expect(page.getByTestId('grammar-drill')).toBeVisible()
    const ready = page.locator(
      '[data-testid="grammar-option-0"]:not([disabled]), [data-testid="grammar-gap-input"]:not([disabled]), [data-testid="grammar-summary"]',
    )
    for (let i = 0; i < 30; i++) {
      await expect(ready.first()).toBeVisible()
      if (await page.getByTestId('grammar-summary').isVisible()) break
      const option = page.locator('[data-testid="grammar-option-0"]:not([disabled])')
      if (await option.isVisible()) await hammer(page, option, 2)
      else {
        await page.getByTestId('grammar-gap-input').fill('test')
        await hammer(page, page.getByTestId('grammar-check'), 3)
      }
      await expect(page.getByTestId('grammar-next')).toBeVisible()
      await page.getByTestId('grammar-next').focus()
      for (let k = 0; k < 4; k++) await page.keyboard.press('Enter')
    }
    await expect(page.getByTestId('grammar-summary')).toBeVisible()
    await page.waitForTimeout(500)
    expect(await ipcCalls(lq.app, 'grammar:submit')).toBe(before + 1)
    await dismissRewards(page)
    await assertHealthy(lq, 0)
  })

  test('cinema choices: spamming 1 and clicking options never double-advances a scene', async () => {
    const { page } = lq
    await go(page, '/cinema')
    await page.locator('[data-testid^="cinema-story-"]').first().click()
    await expect(page.getByTestId('cinema-stage')).toBeVisible()
    let choices = 0
    for (let i = 0; i < 400 && choices < 3; i++) {
      if (await page.getByTestId('cinema-ending').isVisible()) break
      await dismissRewards(page)
      if (await page.getByTestId('cinema-choice').isVisible()) {
        choices++
        await page.waitForTimeout(400)
        const opt = page.getByTestId('cinema-option-0')
        await hammer(page, opt, 3).catch(() => undefined)
        for (let k = 0; k < 3; k++) await page.keyboard.press('1')
        await page.waitForTimeout(300)
      } else if (await page.getByTestId('cinema-quiz').isVisible()) {
        const answer = page.getByTestId('cinema-quiz').locator('button:not([disabled])').first()
        if (await answer.isVisible()) await answer.click()
        const cont = page.getByTestId('cinema-quiz-continue')
        if (await cont.isEnabled().catch(() => false)) await cont.click()
      } else await page.keyboard.press('Space')
      await page.waitForTimeout(40)
    }
    const progress = await page.evaluate(async () => {
      const id = location.hash.split('/').pop() ?? ''
      const res = await window.lq.invoke('cinema:start', { id })
      return res.ok ? (res.data as { path: string[] }) : null
    })
    // One advance per scene left: never more calls than scenes on the path.
    expect(await ipcCalls(lq.app, 'cinema:advance')).toBeLessThanOrEqual(progress?.path.length ?? 0)
    await assertHealthy(lq, 0)
  })

  test('tutor: Enter spam and Send spam send one message', async () => {
    const { page } = lq
    await go(page, '/tutor')
    await page.getByTestId('tutor-start').click()
    const input = page.getByTestId('tutor-input')
    await input.fill('I goes to school every days.')
    await exactlyOnce('tutor:send', async () => {
      for (let i = 0; i < 5; i++) await page.keyboard.press('Enter')
      await hammer(page, page.getByTestId('tutor-send'), 3).catch(() => undefined)
    })
    await expect(page.getByTestId('tutor-msg-user')).toHaveCount(1)
    await expect(page.getByTestId('tutor-msg-assistant').last()).toBeVisible()
  })

  test('placement test: Confirm + Enter spam answers one question', async () => {
    const { page } = lq
    await go(page, '/assessment')
    const startBtn = page.getByTestId('assessment-start')
    await expect(startBtn).toBeVisible()
    await hammer(page, startBtn, 3)
    await expect(page.getByTestId('assessment-option-0')).toBeVisible()
    await page.getByTestId('assessment-option-0').click()
    const next = page.getByTestId('assessment-next')
    await exactlyOnce('journey:assessmentAnswer', async () => {
      await hammer(page, next, 3)
      for (let i = 0; i < 3; i++) await page.keyboard.press('Enter')
    })
    expect(await ipcCalls(lq.app, 'journey:assessmentStart')).toBe(1)
    await assertHealthy(lq, 0)
  })

  test('roadmap generate', async () => {
    const { page } = lq
    await go(page, '/journey')
    const btn = page.getByTestId('roadmap-generate').or(page.getByTestId('roadmap-regenerate')).first()
    await expect(btn).toBeVisible()
    await exactlyOnce('journey:roadmapGenerate', async () => {
      await hammer(page, btn, 3)
      // Regenerating asks for confirmation first.
      const confirm = page.getByRole('dialog').getByRole('button', { name: /Regenerate|Tạo lại|Tạo/ })
      if (await confirm.isVisible().catch(() => false)) await hammer(page, confirm, 3)
    })
    await expect(page.getByTestId('journey-roadmap')).toBeVisible()
  })

  test('backup create', async () => {
    const { page } = lq
    await go(page, '/settings/data')
    const btn = page.getByTestId('backup-create')
    await exactlyOnce('data:createBackup', async () => {
      await hammer(page, btn, 3)
      await expect(btn).toBeDisabled()
    })
    await expect(page.getByTestId('backup-list')).toBeVisible()
  })

  test('settings: saving an AI key (click + Enter spam)', async () => {
    const { page } = lq
    await go(page, '/settings/ai')
    await page.getByTestId('key-input-gemini').fill('AIzaSyE2E_TEST_KEY_not_real_0000000000')
    await exactlyOnce('ai:setKey', async () => {
      await page.getByTestId('key-input-gemini').press('Enter')
      await page.keyboard.press('Enter')
      await hammer(page, page.getByTestId('key-save-gemini'), 3).catch(() => undefined)
    })
    await expect(page.getByTestId('key-test-result-gemini')).toBeVisible()
  })
})

test('reviewing a card that was deleted meanwhile skips it with a note instead of an error', async () => {
  const { page } = lq
  await saveWords(page, ['quarry', 'thicket'])
  await go(page, '/vocabulary/review')
  await expect(page.getByTestId('review-flip')).toBeVisible()
  const word = (await page.getByTestId('review-word').innerText()).trim()
  await page.evaluate(async (w) => {
    const res = await window.lq.invoke('vocab:list', { query: w })
    const item = res.ok ? (res.data as { items: { id: number; word: string }[] }).items.find((i) => i.word === w) : null
    if (item) await window.lq.invoke('vocab:delete', { id: item.id })
  }, word)
  await page.keyboard.press('Space')
  await page.keyboard.press('3')
  await expect(page.getByText(/was deleted – skipped|đã bị xóa – bỏ qua/).first()).toBeVisible()
  await expect(page.locator('main [role="alert"]')).toHaveCount(0)
  await dismissRewards(page)
  await assertHealthy(lq, 0)
})

// ---------------------------------------------------------------- leaving mid-request

test('leaving a page while its request is pending does not hijack navigation or leave spinners', async () => {
  const { page, app } = lq
  const seen = lq.consoleErrors.length
  // Writing: the learner submits, then leaves before feedback arrives.
  await go(page, '/writing?free=1')
  await page.getByTestId('writing-editor').fill('My favourite place is the beach near my house in Nha Trang.')
  await setIpcDelay(app, 'writing:submit', 1500)
  await page.getByTestId('writing-submit').click()
  await go(page, '/vocabulary')
  await page.waitForTimeout(2200)
  expect(await page.evaluate(() => location.hash)).toBe('#/vocabulary')
  // Tutor: send and leave.
  await go(page, '/tutor')
  await page.getByTestId('tutor-new').click()
  await page.getByTestId('tutor-start').click()
  await setIpcDelay(app, 'tutor:send', 1500)
  await page.getByTestId('tutor-input').fill('Hello teacher')
  await page.keyboard.press('Enter')
  await go(page, '/stats')
  await page.waitForTimeout(2000)
  expect(await page.evaluate(() => location.hash)).toBe('#/stats')
  // Roadmap: generate and leave.
  await go(page, '/journey')
  await setIpcDelay(app, 'journey:roadmapGenerate', 1500)
  await page.getByTestId('roadmap-regenerate').or(page.getByTestId('roadmap-generate')).first().click()
  const confirm = page.getByRole('dialog').getByRole('button', { name: /Regenerate|Tạo lại|Tạo/ })
  if (await confirm.isVisible().catch(() => false)) await confirm.click()
  await go(page, '/')
  await page.waitForTimeout(2000)
  await dismissRewards(page)
  await expect(page.getByTestId('journey-dashboard')).toBeVisible()
  await expect(page.locator('main [aria-busy="true"]')).toHaveCount(0)
  await assertHealthy(lq, seen)
})

// ---------------------------------------------------------------- shortcuts and dialogs

test('Space, Enter and 1–4 on pages where they do nothing keep the app on the same page', async () => {
  const { page } = lq
  const seen = lq.consoleErrors.length
  for (const route of [
    '/',
    '/journey',
    '/listening',
    '/reading',
    '/writing',
    '/grammar',
    '/vocabulary',
    '/game',
    '/stats',
    '/coach',
    '/library',
    '/settings/general',
  ]) {
    await go(page, route)
    await page.waitForTimeout(250)
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur())
    for (const key of ['Space', '1', '2', '3', '4', 'Enter', 'ArrowDown', 'Backspace']) await page.keyboard.press(key)
    await page.waitForTimeout(150)
    expect(await page.evaluate(() => location.hash.split('?')[0]), `stayed on ${route}`).toBe(`#${route}`)
    await assertHealthy(lq, seen)
  }
})

test('Ctrl+K and F1 never stack: one dialog at a time, Esc closes only the top one', async () => {
  const { page } = lq
  await go(page, '/')
  for (let i = 0; i < 6; i++) {
    await page.keyboard.press('Control+K')
    await page.keyboard.press('F1')
  }
  await expect(page.getByRole('dialog')).toHaveCount(1)
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog')).toHaveCount(0)
  // A palette opened over a page dialog closes first; the page dialog stays.
  await go(page, '/vocabulary')
  await page.getByTestId('vocab-add').click()
  await expect(page.getByTestId('vocab-editor')).toBeVisible()
  await page.keyboard.press('Control+K')
  await expect(page.getByPlaceholder(/Search lessons|Tìm bài học/)).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByPlaceholder(/Search lessons|Tìm bài học/)).toHaveCount(0)
  await expect(page.getByTestId('vocab-editor')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByTestId('vocab-editor')).toHaveCount(0)
  // The palette caps its query to what search accepts.
  await page.keyboard.press('Control+K')
  await page.getByPlaceholder(/Search lessons|Tìm bài học/).fill('x'.repeat(500))
  expect((await page.getByPlaceholder(/Search lessons|Tìm bài học/).inputValue()).length).toBeLessThanOrEqual(100)
  await page.keyboard.press('Escape')
  await assertHealthy(lq, 0)
})

// ---------------------------------------------------------------- long and exotic text

test('very long input is capped with a visible counter and never breaks the layout', async () => {
  const { page } = lq
  const seen = lq.consoleErrors.length
  // Tutor: 2 500 characters → capped at 2 000 with a counter.
  await go(page, '/tutor')
  await page.getByTestId('tutor-new').click()
  await page.getByTestId('tutor-start').click()
  await page.getByTestId('tutor-input').fill('a'.repeat(2500))
  expect((await page.getByTestId('tutor-input').inputValue()).length).toBe(2000)
  await expect(page.getByTestId('tutor-char-count')).toContainText('2000')
  await assertHealthy(lq, seen)
  // Writing: 10 000 words → capped, the counter says the limit is reached.
  await go(page, '/writing?free=1')
  await page.getByTestId('writing-editor').fill('word '.repeat(10_000))
  await expect(page.getByTestId('writing-char-limit')).toBeVisible()
  await assertHealthy(lq, seen)
  // Vocabulary editor: 5 000-character notes are capped with a counter.
  await go(page, '/vocabulary')
  await page.getByTestId('vocab-add').click()
  const editor = page.getByTestId('vocab-editor')
  await editor.getByPlaceholder('e.g. resilient').fill('Supercalifragilisticexpialidocious'.repeat(5))
  await editor.getByLabel(/Notes|Ghi chú/).fill('n'.repeat(5000))
  expect((await editor.getByLabel(/Notes|Ghi chú/).inputValue()).length).toBe(1000)
  await expect(editor.getByText('1000/1000')).toBeVisible()
  await editor.getByLabel(/Examples|Ví dụ/).fill(Array.from({ length: 20 }, (_, i) => `Example ${i}`).join('\n'))
  await expect(editor.getByText(/8/).first()).toBeVisible()
  await page.getByTestId('vocab-editor-save').click()
  await expect(page.getByTestId('vocab-editor')).toHaveCount(0)
  await dismissRewards(page)
  await assertHealthy(lq, seen)
})

test('emoji, RTL and zero-width text render without breaking the layout', async () => {
  const { page } = lq
  const seen = lq.consoleErrors.length
  const nasty = '😀🎉👨‍👩‍👧‍👦🇻🇳 ‮RTL مرحبا שלום‬ zero​width​ ' + 'ẮẰẲẴẶ'.repeat(30)
  await page.evaluate(async (text) => {
    await window.lq.invoke('vocab:save', {
      word: 'Pneumonoultramicroscopicsilicovolcanoconiosis' + 'x'.repeat(30),
      meaningVi: text.slice(0, 300),
      notes: text,
      examples: [text.slice(0, 400)],
      sourceModule: 'manual',
    })
    await window.lq.invoke('learner:updateProfile', { displayName: '😀‮RTL​' + 'Ữ'.repeat(40) })
  }, nasty)
  await page.reload()
  for (const route of ['/', '/vocabulary', '/game', '/stats']) {
    await go(page, route)
    await page.waitForTimeout(400)
    await assertHealthy(lq, seen)
  }
  // Every due flashcard (including the 75-letter word) fits on both sides of the card.
  await go(page, '/vocabulary/review')
  for (let i = 0; i < 30; i++) {
    await dismissRewards(page)
    const flip = page.getByTestId('review-flip')
    if (!(await flip.isVisible().catch(() => false))) break
    await assertHealthy(lq, seen, { ping: false })
    await page.keyboard.press('Space')
    await expect(page.getByTestId('review-back')).toBeVisible()
    await assertHealthy(lq, seen, { ping: false })
    await page.keyboard.press('4')
    await page.waitForTimeout(150)
  }
  await go(page, '/tutor')
  await page.getByTestId('tutor-new').click()
  await page.getByTestId('tutor-start').click()
  await page.getByTestId('tutor-input').fill(nasty)
  await page.keyboard.press('Enter')
  await expect(page.getByTestId('tutor-msg-assistant').last()).toBeVisible()
  await assertHealthy(lq, seen)
  await page.evaluate(() => window.lq.invoke('learner:updateProfile', { displayName: 'Lan' }))
})

test('a drill left open for five hours still saves, and over-long answers are capped', async () => {
  const { page } = lq
  await go(page, '/grammar')
  await page.locator('[data-testid^="grammar-topic-"]').first().click()
  await page.getByTestId('grammar-start-drill').click()
  await expect(page.getByTestId('grammar-drill')).toBeVisible()
  // The learner went to lunch (and dinner): the clock jumps five hours.
  await page.evaluate(() => {
    const real = Date.now.bind(Date)
    Date.now = () => real() + 5 * 3600 * 1000
  })
  const ready = page.locator(
    '[data-testid="grammar-option-0"]:not([disabled]), [data-testid="grammar-gap-input"]:not([disabled]), [data-testid="grammar-summary"]',
  )
  for (let i = 0; i < 30; i++) {
    await expect(ready.first()).toBeVisible()
    if (await page.getByTestId('grammar-summary').isVisible()) break
    const option = page.locator('[data-testid="grammar-option-0"]:not([disabled])')
    if (await option.isVisible()) await option.click()
    else {
      await page.getByTestId('grammar-gap-input').fill('z'.repeat(2000))
      expect((await page.getByTestId('grammar-gap-input').inputValue()).length).toBeLessThanOrEqual(400)
      await page.getByTestId('grammar-check').click()
    }
    await page.getByTestId('grammar-next').click()
  }
  await expect(page.getByTestId('grammar-summary')).toBeVisible()
  await expect(page.getByRole('alert')).toHaveCount(0)
  await dismissRewards(page)
  await page.reload()
  await assertHealthy(lq, 0)
})

// ---------------------------------------------------------------- failures

test('offline AI: a clear error with Retry, and Retry works once back online', async () => {
  const { page, app } = lq
  await go(page, '/tutor')
  await page.getByTestId('tutor-new').click()
  await page.getByTestId('tutor-start').click()
  await setIpcFailure(app, 'tutor:send', OFFLINE_ERROR)
  await page.getByTestId('tutor-input').fill('Can you help me with the present perfect?')
  await page.keyboard.press('Enter')
  const alert = page.getByRole('alert').filter({ hasText: /Internet/ })
  await expect(alert).toBeVisible()
  // The draft is kept so nothing is lost.
  await expect(page.getByTestId('tutor-input')).toHaveValue('Can you help me with the present perfect?')
  await setIpcFailure(app, 'tutor:send', null)
  await alert.getByRole('button', { name: /Try again|Thử lại/ }).click()
  await expect(page.getByTestId('tutor-msg-assistant').last()).toBeVisible()
  await expect(alert).toHaveCount(0)
  // Writing feedback offline: the submission is kept and the error is explained.
  await go(page, '/writing?free=1')
  await page
    .getByTestId('writing-editor')
    .fill('I want to improve my English writing skills for the IELTS test next year.')
  await setIpcFailure(app, 'writing:submit', OFFLINE_ERROR)
  await page.getByTestId('writing-submit').click()
  await expect(page.getByRole('alert').filter({ hasText: /Internet/ })).toBeVisible()
  await expect(page.getByTestId('writing-editor')).not.toHaveValue('')
  await setIpcFailure(app, 'writing:submit', null)
  await page.getByTestId('writing-submit').click()
  await dismissRewards(page)
  await expect(page.getByTestId('writing-feedback')).toBeVisible()
  // Roadmap with AI offline.
  await go(page, '/journey')
  await setIpcFailure(app, 'journey:roadmapGenerate', OFFLINE_ERROR)
  await page.getByTestId('roadmap-regenerate').or(page.getByTestId('roadmap-generate')).first().click()
  const confirm = page.getByRole('dialog').getByRole('button', { name: /Regenerate|Tạo lại|Tạo/ })
  if (await confirm.isVisible().catch(() => false)) await confirm.click()
  await expect(page.getByRole('alert').filter({ hasText: /Internet/ })).toBeVisible()
  await assertHealthy(lq, 0)
})

test('copy buttons never throw: the diagnostics report is copied or a clear message is shown', async () => {
  const { page } = lq
  const seen = lq.consoleErrors.length
  await go(page, '/settings/about')
  const copy = page.getByRole('button', { name: /Copy report|Sao chép báo cáo/ })
  await expect(copy).toBeVisible()
  await hammer(page, copy, 3)
  await expect(
    page.getByText(/^(Copied|Đã sao chép|Could not copy to the clipboard|Không sao chép được)$/).first(),
  ).toBeVisible()
  await assertHealthy(lq, seen)
})

test('reload on every route keeps the app working', async () => {
  const { page } = lq
  const seen = lq.consoleErrors.length
  const routes: [string, string][] = [
    ['/', 'page-journey'],
    ['/journey', 'page-journey'],
    ['/assessment', 'page-journey'],
    ['/listening', 'page-listening'],
    ['/speaking', 'page-speaking'],
    ['/reading', 'page-reading'],
    ['/writing', 'page-writing'],
    ['/writing?free=1', 'page-writing'],
    ['/grammar', 'page-grammar'],
    ['/vocabulary', 'page-vocabulary'],
    ['/vocabulary/review', 'page-vocabulary'],
    ['/cinema', 'page-cinema'],
    ['/tutor', 'page-tutor'],
    ['/game', 'page-game'],
    ['/stats', 'page-stats'],
    ['/coach', 'page-coach'],
    ['/library', 'page-library'],
    ['/settings/general', 'page-settings'],
    ['/settings/data', 'page-settings'],
  ]
  for (const [route, id] of routes) {
    await go(page, route)
    await expect(page.getByTestId(id).first()).toBeVisible()
    await page.reload()
    await expect(page.getByTestId(id).first(), `${route} after reload`).toBeVisible()
    await assertHealthy(lq, seen)
  }
})

test('rapid theme and language switching settles on the last choice', async () => {
  const { page } = lq
  await go(page, '/settings/general')
  const selects = page.locator('select')
  const lang = selects.filter({ has: page.locator('option[value="en"]') }).first()
  const theme = selects.filter({ has: page.locator('option[value="dark"]') }).first()
  for (let i = 0; i < 12; i++) {
    await theme.selectOption(i % 2 ? 'light' : 'dark')
    await lang.selectOption(i % 2 ? 'vi' : 'en')
  }
  await theme.selectOption('light')
  await lang.selectOption('en')
  await page.waitForTimeout(800)
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light')
  await expect(page.locator('html')).toHaveAttribute('lang', 'en')
  const saved = await page.evaluate(async () => {
    const res = await window.lq.invoke('settings:get')
    return res.ok ? (res.data as { theme: string; uiLanguage: string }) : null
  })
  expect(saved).toMatchObject({ theme: 'light', uiLanguage: 'en' })
  await page.reload()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light')
  await page.evaluate(() => window.lq.invoke('settings:update', { theme: 'dark', uiLanguage: 'vi' }))
  await page.reload()
  await assertHealthy(lq, 0)
})

test('zoom 50%–200%: sidebar, top bar and content never overlap', async () => {
  const { page, app } = lq
  await setWindowSize(app, 1280, 800)
  for (const route of ['/', '/vocabulary', '/tutor', '/settings/general']) {
    await go(page, route)
    for (const factor of [0.5, 0.75, 1.25, 1.5, 2]) {
      await app.evaluate(
        ({ BrowserWindow }, f) => BrowserWindow.getAllWindows()[0]?.webContents.setZoomFactor(f),
        factor,
      )
      await page.waitForTimeout(250)
      const overlap = await page.evaluate(() => {
        const r = (el: Element | null) => el?.getBoundingClientRect() ?? null
        const nav = r(document.querySelector('aside'))
        const main = r(document.getElementById('main-scroll'))
        const header = r(document.querySelector('header'))
        const docOverflow = document.documentElement.scrollWidth - document.documentElement.clientWidth
        const problems: string[] = []
        if (!main || main.width < 200) problems.push(`content too narrow (${main?.width ?? 0}px)`)
        if (nav && main && nav.right > main.left + 1) problems.push('sidebar overlaps content')
        if (header && main && header.bottom > main.top + 1) problems.push('top bar overlaps content')
        if (docOverflow > 1) problems.push(`window scrolls horizontally by ${docOverflow}px`)
        // Top-bar controls must not overlap each other.
        const ctrls = [...(document.querySelector('header')?.children ?? [])].map((c) => c.getBoundingClientRect())
        for (let i = 1; i < ctrls.length; i++)
          if (ctrls[i]!.width && ctrls[i - 1]!.width && ctrls[i]!.left < ctrls[i - 1]!.right - 1)
            problems.push('top-bar controls overlap')
        return problems
      })
      expect(overlap, `${route} at ${factor * 100}%`).toEqual([])
    }
  }
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.webContents.setZoomFactor(1))
  await assertHealthy(lq, 0)
})

test('a burst of rewards shows one celebration at a time and can be skipped at once', async () => {
  const { page, app } = lq
  await go(page, '/')
  await app.evaluate(({ BrowserWindow }) => {
    const wc = BrowserWindow.getAllWindows()[0]?.webContents
    for (let i = 0; i < 8; i++)
      wc?.send('lq:push', 'reward', {
        xpGained: 10 + i,
        levelUp: i === 0 ? 3 : null,
        questsCompleted: [],
        achievementsUnlocked: [
          {
            key: `burst-${i}`,
            title: `Burst ${i}`,
            titleVi: `Liên tiếp ${i}`,
            description: 'Test achievement',
            descriptionVi: 'Thành tích thử',
            icon: 'star',
            unlockedAt: new Date().toISOString(),
          },
        ],
      })
    for (let i = 0; i < 10; i++)
      wc?.send('lq:push', 'reward', { xpGained: 5, levelUp: null, questsCompleted: [], achievementsUnlocked: [] })
  })
  await expect(page.getByTestId('reward-continue')).toHaveCount(1)
  await expect(page.getByTestId('reward-remaining')).toBeVisible()
  const left = async () => Number((await page.getByTestId('reward-remaining').innerText()).match(/\d+/)?.[0])
  await page.waitForTimeout(500)
  const before = await left()
  // A double click on "Keep going" moves on by exactly one card.
  await page.getByTestId('reward-continue').dblclick()
  await page.waitForTimeout(600)
  expect(await left()).toBe(before - 1)
  await expect(page.getByTestId('reward-continue')).toHaveCount(1)
  await page.getByTestId('reward-skip-all').click()
  await expect(page.getByTestId('reward-continue')).toHaveCount(0)
  // XP toasts are capped, so the corner never fills the screen.
  expect(await page.locator('[aria-live="polite"] > *').count()).toBeLessThanOrEqual(4)
  await assertHealthy(lq, 0)
})

// ---------------------------------------------------------------- fresh-app scenarios

test.describe('fresh profile', () => {
  let fresh: LaunchedApp
  test.beforeAll(async () => {
    fresh = await launchApp()
    await stubLeavingActions(fresh.app)
  })
  test.afterAll(async () => {
    await fresh?.close()
  })

  test('onboarding: a 5 000-character name is capped with a counter', async () => {
    const { page } = fresh
    await page.getByTestId('onboarding-start').click()
    await page.getByTestId('onboarding-name').fill('N'.repeat(5000))
    const value = await page.getByTestId('onboarding-name').inputValue()
    expect(value.length).toBeLessThanOrEqual(60)
    await expect(page.getByTestId('onboarding-name-count')).toBeVisible()
    await assertHealthy(fresh, 0, { ping: true })
  })

  test('a damaged data file at start-up: the app opens and explains what happened', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lq-e2e-broken-'))
    fs.mkdirSync(path.join(dir, 'data'), { recursive: true })
    fs.writeFileSync(path.join(dir, 'data', 'lingua-quest.sqlite'), 'this is not a database '.repeat(200))
    const broken = await launchApp(dir)
    try {
      await expect(broken.page.getByTestId('data-recovery')).toBeVisible()
      await broken.page.keyboard.press('Escape')
      await expect(broken.page.getByTestId('data-recovery')).toHaveCount(0)
      await expect(broken.page.getByTestId('onboarding-start')).toBeVisible()
      expect(seriousErrors(broken.consoleErrors)).toEqual([])
    } finally {
      await broken.close()
    }
  })

  test('every page has a sensible empty state with zero data', async () => {
    const { page } = fresh
    await page.evaluate(() =>
      window.lq.invoke('learner:updateProfile', {
        displayName: 'Empty',
        interests: [],
        purposes: ['ielts'],
        onboardingCompleted: true,
      }),
    )
    await page.reload()
    await page.waitForSelector('#main-scroll')
    const routes = [
      '/',
      '/journey',
      '/journey/course',
      '/listening',
      '/speaking',
      '/speaking/history',
      '/reading',
      '/writing',
      '/writing/history',
      '/grammar',
      '/vocabulary',
      '/vocabulary/review',
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
      '/settings/data',
    ]
    for (const route of routes) {
      await goto(page, route)
      await page.waitForTimeout(500)
      await dismissRewards(page)
      await assertHealthy(fresh, 0)
      // Nothing stays in a loading state forever.
      await expect(page.locator('main [aria-busy="true"]'), `${route} still loading`).toHaveCount(0, { timeout: 5000 })
    }
    await goto(page, '/vocabulary/review')
    await expect(page.getByText(/No cards|Không còn thẻ|Hết thẻ|chưa có thẻ|Chưa có/i).first()).toBeVisible()
    await goto(page, '/library')
    await expect(page.getByText(/No favorites|Chưa có/i).first()).toBeVisible()
  })

  test('microphone denied or missing: a clear message, no crash', async () => {
    const { page } = fresh
    for (const [name, pattern] of [
      ['NotAllowedError', /Microphone|micro/i],
      ['NotFoundError', /micro/i],
    ] as const) {
      await goto(page, '/tutor')
      await page.evaluate(
        (errName) =>
          Object.defineProperty(navigator.mediaDevices, 'getUserMedia', {
            configurable: true,
            value: () => Promise.reject(new DOMException('mic test', errName)),
          }),
        name,
      )
      const start = page.getByTestId('tutor-start')
      if (await start.isVisible().catch(() => false)) await start.click()
      await page.getByRole('button', { name: /Voice input|Nhập bằng giọng nói/ }).click()
      await page
        .getByRole('button', { name: /Speak your message|Nói tin nhắn|Start recording|Bắt đầu ghi âm/ })
        .first()
        .click()
      await expect(page.getByText(pattern).last()).toBeVisible()
      await assertHealthy(fresh, 0)
      expect(seriousErrors(fresh.consoleErrors)).toEqual([])
    }
  })
})

test('no serious console errors over the whole abuse run', async () => {
  await expectNoSeriousErrors(lq.consoleErrors.filter((e) => !/Unhandled rejection: mic test/.test(e)))
})
