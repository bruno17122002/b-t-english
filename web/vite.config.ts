// Lingua Quest Online (PWA). Build: npm run web:build → web/dist (static files, host anywhere).
import { resolve } from 'node:path'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

const repo = resolve(__dirname, '..')

export default defineConfig({
  root: __dirname,
  base: './',
  publicDir: resolve(__dirname, 'public'),
  envDir: __dirname,
  resolve: {
    alias: {
      '@core': resolve(repo, 'src/core'),
      '@shared': resolve(repo, 'src/shared'),
      '@web': resolve(__dirname, 'src'),
    },
  },
  plugins: [react(), tailwindcss()],
  build: {
    outDir: resolve(__dirname, 'dist'),
    emptyOutDir: true,
    sourcemap: false,
    target: 'es2022',
  },
  server: { host: true, port: 5180 },
  preview: { host: true, port: 5180 },
})
