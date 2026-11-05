// End-to-end learner journey on the real built app (simulated AI, isolated data folder):
// onboarding → placement test → roadmap → reading + saving a word → flashcard review → XP →
// settings / AI key / backup → restart → data still there.
import { expect, test } from '@playwright/test'
import { dismissRewards, expectNoSeriousErrors, launchApp, type LaunchedApp } from './fixtures'

const go = async (lq: LaunchedApp, route: string) => {
  await dismissRewards(lq.page)
  await lq.page.evaluate((r) => (window.location.hash = `#${r}`), route)
}

test.describe.configure({ mode: 'serial' })

let lq: LaunchedApp
let userData = ''

test.afterAll(async () => {
  if (lq) await lq.close().catch(() => undefined)
})

test('onboarding creates a profile and starts the placement test', async () => {
  lq = await launchApp()
  userData = lq.userData
  const { page } = lq
  await expect(page.getByTestId('onboarding-start')).toBeVisible()
  await page.getByTestId('onboarding-start').click()
  await page.getByTestId('onboarding-name').fill('Lan Nguyen')
  await page.getByTestId('onboarding-next').click()
  await page.getByTestId('level-elementary').click()
  await page.getByTestId('onboarding-next').click()
  await page.getByTestId('purpose-communication').click() // IELTS is preselected
  await page.getByTestId('onboarding-next').click()
  await page.getByTestId('interest-travel').click()
  await page.getByTestId('interest-technology').click()
  await page.getByTestId('onboarding-next').click()
  await page.getByTestId('minutes-30').click()
  await page.getByTestId('onboarding-next').click()
  // With simulated AI the step shows "AI is configured" instead of the skip link.
  if (await page.getByTestId('onboarding-skip-ai').isVisible()) await page.getByTestId('onboarding-skip-ai').click()
  else await page.getByTestId('onboarding-next').click()
  await page.getByTestId('onboarding-take-test').click()
  await expect(page.getByTestId('assessment-start')).toBeVisible()
})

test('adaptive placement test produces a CEFR result and a roadmap', async () => {
  const { page } = lq
  await page.getByTestId('assessment-start').click()
  // 4 auto-graded skills × 6 items. Answer every item with the first option.
  for (let i = 0; i < 40; i++) {
    if (await page.getByTestId('assessment-writing').isVisible()) break
    await page.getByTestId('assessment-option-0').click()
    await page.getByTestId('assessment-next').click()
    await page.waitForTimeout(80)
  }
  await expect(page.getByTestId('assessment-writing')).toBeVisible()
  await page
    .getByTestId('assessment-writing-text')
    .fill(
      'I live in Da Nang. I like travelling with my friends. Last summer we visited Hoi An and ate a lot of good food.',
    )
  await page.getByTestId('assessment-grade-writing').click()
  await page.getByTestId('assessment-next-speaking').click()
  await expect(page.getByTestId('assessment-speaking')).toBeVisible()
  // Skipping speaking finishes the test (speaking is estimated from the other skills).
  await page.getByTestId('assessment-skip-speaking').click()
  await expect(page.getByTestId('assessment-result')).toBeVisible()
  await expect(page.getByTestId('assessment-overall')).toContainText(/A1|A2|B1|B2|C1|C2/)
  // Finishing the placement unlocks the "First Steps" achievement.
  await expect(page.getByTestId('reward-continue')).toBeVisible()
  await dismissRewards(page)
  await page.getByTestId('assessment-to-roadmap').click()
  const generate = page.getByTestId('roadmap-generate')
  if (await generate.isVisible().catch(() => false)) await generate.click()
  await expect(page.getByTestId('journey-roadmap')).toBeVisible()
  await expect(page.getByTestId('roadmap-week-1')).toBeVisible()
})

test('dashboard shows today’s plan, quests and the level from placement XP', async () => {
  const { page } = lq
  await go(lq, '/')
  await expect(page.getByTestId('journey-dashboard')).toBeVisible()
  await expect(page.getByTestId('journey-plan')).toBeVisible()
  await expect(page.getByTestId('journey-skills')).toBeVisible()
})

test('reading: open a passage, look up a word and save it to the word bank', async () => {
  const { page } = lq
  await go(lq, '/reading')
  await expect(page.getByTestId('page-reading')).toBeVisible()
  const first = await page.evaluate(async () => {
    const res = await window.lq.invoke('reading:library')
    const data = res.ok ? (res.data as { passages?: { id: string }[]; items?: { id: string }[] }) : null
    return (data?.passages ?? data?.items ?? [])[0]?.id ?? null
  })
  await go(lq, `/reading/${first ?? 'rd-a1-new-neighbour'}`)
  await expect(page.locator('.word-token').nth(3)).toBeVisible()
  await page.locator('.word-token').nth(3).click()
  const save = page.getByRole('button', { name: /Save word|Lưu từ/ }).first()
  await expect(save).toBeVisible()
  await save.click()
  await dismissRewards(page)
  await expect(page.getByRole('button', { name: /Saved|Đã lưu/ }).first()).toBeVisible()
})

test('vocabulary review: flip a due card with Space and rate it Good', async () => {
  const { page } = lq
  await go(lq, '/vocabulary/review')
  await expect(page.getByTestId('page-vocabulary')).toBeVisible()
  await expect(page.getByRole('button', { name: /Show answer|Xem đáp án/ })).toBeVisible()
  await page.keyboard.press('Space')
  await expect(page.getByRole('button', { name: /Good|Tốt/ }).first()).toBeVisible()
  await page.keyboard.press('3')
  await dismissRewards(page)
  await expect(
    page.getByText(/Session complete|Hoàn thành|No cards|Không còn thẻ|Hết thẻ|Tuyệt/i).first(),
  ).toBeVisible()
})

test('XP, level and streak appear in the top bar and on the adventure map', async () => {
  const { page } = lq
  await go(lq, '/game')
  await expect(page.getByTestId('page-game')).toBeVisible()
  const xp = await page.evaluate(async () => {
    const res = await window.lq.invoke('progress:game')
    return res.ok ? (res.data as { totalXp: number; streak: { current: number } }) : null
  })
  expect(xp?.totalXp).toBeGreaterThan(60)
  expect(xp?.streak.current).toBe(1)
})

test('AI settings store a key encrypted, test it, and never show it again', async () => {
  const { page } = lq
  await go(lq, '/settings/ai')
  const key = 'AIzaSyE2E_TEST_KEY_not_real_1234567890'
  await page.getByTestId('key-input-gemini').fill(key)
  await page.getByTestId('key-save-gemini').click()
  await expect(page.getByTestId('key-test-result-gemini')).toBeVisible()
  await expect(page.getByTestId('provider-gemini')).toContainText('••••7890')
  expect(await page.content()).not.toContain(key)
  const cfg = await page.evaluate(async () => JSON.stringify(await window.lq.invoke('ai:config')))
  expect(cfg).not.toContain(key)
})

test('backup can be created from Settings', async () => {
  const { page } = lq
  await go(lq, '/settings/data')
  await page.getByTestId('backup-create').click()
  await expect(page.getByTestId('backup-list')).toBeVisible()
})

test('global search finds content without Vietnamese diacritics', async () => {
  const { page } = lq
  await go(lq, '/')
  await page.keyboard.press('Control+K')
  await page.getByPlaceholder(/Search lessons|Tìm bài học/).fill('cai dat')
  await expect(
    page
      .getByRole('dialog')
      .getByText(/Cài đặt|Settings/)
      .first(),
  ).toBeVisible()
  await page.keyboard.press('Escape')
  await expectNoSeriousErrors(lq.consoleErrors)
})

test('data persists after restarting the app', async () => {
  await lq.close()
  lq = await launchApp(userData)
  const { page } = lq
  await expect(page.getByTestId('journey-dashboard')).toBeVisible()
  const state = await page.evaluate(async () => {
    const profile = await window.lq.invoke('learner:profile')
    const vocab = await window.lq.invoke('vocab:stats')
    const ai = await window.lq.invoke('ai:config')
    return {
      profile: profile.ok ? profile.data : null,
      vocab: vocab.ok ? vocab.data : null,
      ai: ai.ok ? ai.data : null,
    }
  })
  expect((state.profile as { displayName: string }).displayName).toBe('Lan Nguyen')
  expect((state.vocab as { total: number }).total).toBeGreaterThanOrEqual(1)
  expect((state.ai as { providers: { gemini: { hasKey: boolean } } }).providers.gemini.hasKey).toBe(true)
  await expectNoSeriousErrors(lq.consoleErrors)
})
