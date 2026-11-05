// Module flows through the real UI (simulated AI): grammar drill, interactive film to an ending,
// tutor chat with corrections, writing feedback and listening dictation. Each must award progress.
import { expect, test, type Page } from '@playwright/test'
import { dismissRewards, expectNoSeriousErrors, launchApp, type LaunchedApp } from './fixtures'

let lq: LaunchedApp
test.describe.configure({ mode: 'serial' })

const go = async (page: Page, route: string) => {
  await dismissRewards(page)
  await page.evaluate((r) => (window.location.hash = `#${r}`), route)
}
const totalXp = (page: Page) =>
  page.evaluate(async () => {
    const res = await window.lq.invoke('progress:game')
    return res.ok ? (res.data as { totalXp: number }).totalXp : -1
  })

test.beforeAll(async () => {
  lq = await launchApp()
  await lq.page.evaluate(async () => {
    await window.lq.invoke('learner:updateProfile', {
      displayName: 'Huy',
      interests: ['movies'],
      purposes: ['ielts'],
      onboardingCompleted: true,
    })
    await window.lq.invoke('journey:placementSkip')
  })
  await lq.page.reload()
})

test.afterAll(async () => {
  await lq?.close()
})

test('Grammar Kingdom: complete a drill and earn XP', async () => {
  const { page } = lq
  const before = await totalXp(page)
  await go(page, '/grammar')
  await page.locator('[data-testid^="grammar-topic-"]').first().click()
  await page.getByTestId('grammar-start-drill').click()
  await expect(page.getByTestId('grammar-drill')).toBeVisible()
  // The previous (answered, disabled) item animates out, so wait for a fresh, enabled one.
  const ready = page.locator(
    '[data-testid="grammar-option-0"]:not([disabled]), [data-testid="grammar-gap-input"]:not([disabled]), [data-testid="grammar-summary"]',
  )
  for (let i = 0; i < 30; i++) {
    await expect(ready.first()).toBeVisible()
    if (await page.getByTestId('grammar-summary').isVisible()) break
    const option = page.locator('[data-testid="grammar-option-0"]:not([disabled])')
    if (await option.isVisible()) await option.click()
    else {
      await page.getByTestId('grammar-gap-input').fill('test')
      await page.getByTestId('grammar-check').click()
    }
    await page.getByTestId('grammar-next').click()
  }
  await expect(page.getByTestId('grammar-summary')).toBeVisible()
  await dismissRewards(page)
  expect(await totalXp(page)).toBeGreaterThan(before)
})

test('Cinema Mode: play a film from the first scene to an ending', async () => {
  const { page } = lq
  const before = await totalXp(page)
  await go(page, '/cinema')
  await page.locator('[data-testid^="cinema-story-"]').first().click()
  await expect(page.getByTestId('cinema-stage')).toBeVisible()
  for (let i = 0; i < 400; i++) {
    if (await page.getByTestId('cinema-ending').isVisible()) break
    await dismissRewards(page)
    if (await page.getByTestId('cinema-choice').isVisible()) {
      // Keyboard shortcut 1 picks the first option (the overlay animates, so keys are more reliable than clicks).
      await page.keyboard.press('1')
      await page.waitForTimeout(300)
    } else if (await page.getByTestId('cinema-quiz').isVisible()) {
      const answer = page.getByTestId('cinema-quiz').locator('button:not([disabled])').first()
      if (await answer.isVisible()) await answer.click()
      const cont = page.getByTestId('cinema-quiz-continue')
      if (await cont.isEnabled().catch(() => false)) await cont.click()
    } else {
      await page.keyboard.press('Space')
    }
    await page.waitForTimeout(60)
  }
  await expect(page.getByTestId('cinema-ending')).toBeVisible()
  await dismissRewards(page)
  expect(await totalXp(page)).toBeGreaterThan(before)
  const achievements = await page.evaluate(async () => {
    const res = await window.lq.invoke('progress:achievements')
    return res.ok ? (res.data as { key: string; unlockedAt: string | null }[]) : []
  })
  expect(achievements.find((a) => a.key === 'the-end')?.unlockedAt).toBeTruthy()
})

test('AI Tutor: start a conversation and receive a reply with corrections', async () => {
  const { page } = lq
  await go(page, '/tutor')
  await page.getByTestId('tutor-start').click()
  await page.getByTestId('tutor-input').fill('Yesterday I go to the market with my mother.')
  await page.getByTestId('tutor-send').click()
  await expect(page.getByTestId('tutor-msg-user').first()).toBeVisible()
  await expect(page.getByTestId('tutor-msg-assistant').last()).toBeVisible()
})

test('Writing Workshop: free writing gets AI feedback with scores', async () => {
  const { page } = lq
  await go(page, '/writing?free=1')
  await page
    .getByTestId('writing-editor')
    .fill(
      'Last weekend I visit my grandmother in Hue. We cook together and she tell me many stories about her childhood. I think family is very important because they always support us.',
    )
  await page.getByTestId('writing-submit').click()
  await dismissRewards(page)
  await expect(page.getByTestId('writing-feedback')).toBeVisible()
  await expect(page.getByTestId('writing-scores')).toBeVisible()
})

test('Listening Lab: dictation checks a typed line leniently', async () => {
  const { page } = lq
  await go(page, '/listening')
  await page.locator('[data-testid^="listening-track-"]').first().click()
  await expect(page.getByTestId('listening-player')).toBeVisible()
  await page.getByRole('tab', { name: /Dictation|Chép chính tả/ }).click()
  await expect(page.getByTestId('listening-dictation')).toBeVisible()
  await page.getByTestId('dictation-input').fill('hello')
  await page.getByTestId('dictation-check').click()
  await expect(page.getByTestId('listening-diff')).toBeVisible()
  await expectNoSeriousErrors(lq.consoleErrors)
})
