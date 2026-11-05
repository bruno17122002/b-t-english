import { defineConfig } from '@playwright/test'

// E2E tests drive the built Electron app (run `electron-vite build` first; `npm run test:e2e` does both).
export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 90_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list'], ['json', { outputFile: 'test-results/playwright.json' }]],
  use: { trace: 'retain-on-failure', screenshot: 'only-on-failure' },
  outputDir: 'test-results/e2e-artifacts',
})
