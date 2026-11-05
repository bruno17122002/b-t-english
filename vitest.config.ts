import { resolve } from 'node:path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    alias: {
      '@shared': resolve(__dirname, 'src/shared'),
      '@core': resolve(__dirname, 'src/core'),
      '@content': resolve(__dirname, 'src/content'),
      '@modules': resolve(__dirname, 'src/modules'),
    },
  },
  test: {
    include: ['tests/unit/**/*.test.ts', 'tests/integration/**/*.test.ts'],
    environment: 'node',
    testTimeout: 20000,
    reporters: ['default', 'json'],
    outputFile: { json: 'test-results/vitest.json' },
  },
})
