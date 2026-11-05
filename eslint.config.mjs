// ESLint flat config: TypeScript strict-ish rules + React hooks. Formatting is Prettier's job.
import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import tseslint from 'typescript-eslint'

export default tseslint.config(
  {
    ignores: [
      'out/**',
      'release/**',
      'dist/**',
      'node_modules/**',
      'test-results/**',
      'playwright-report/**',
      'coverage/**',
      'scripts/**',
      'web/dist/**',
      // Deno entrypoints of the Edge Functions (Deno globals); their logic in supabase/functions/_shared is linted.
      'supabase/functions/*/index.ts',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      '@typescript-eslint/consistent-type-imports': ['error', { fixStyle: 'inline-type-imports' }],
      'no-console': ['warn', { allow: ['warn', 'error'] }],
      eqeqeq: ['error', 'smart'],
    },
  },
  {
    files: ['src/renderer/**/*.{ts,tsx}', 'src/modules/**/renderer/**/*.{ts,tsx}', 'web/src/**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
    },
  },
  {
    // Hand-written PWA service worker (plain JS, service worker globals).
    files: ['web/public/sw.js'],
    languageOptions: { globals: { ...globals.serviceworker }, sourceType: 'script' },
  },
)
