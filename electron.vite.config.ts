import { resolve } from 'node:path'
import { bytecodePlugin, defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

const alias = {
  '@shared': resolve(__dirname, 'src/shared'),
  '@core': resolve(__dirname, 'src/core'),
  '@content': resolve(__dirname, 'src/content'),
  '@modules': resolve(__dirname, 'src/modules'),
}

export default defineConfig({
  // Source protection: the main process ships as V8 bytecode (no readable JavaScript); preload and renderer are
  // minified without source maps. The sandboxed preload cannot load bytecode, so it is only minified.
  main: {
    plugins: [externalizeDepsPlugin(), bytecodePlugin({ transformArrowFunctions: false, removeBundleJS: true })],
    resolve: { alias },
    build: { sourcemap: false, minify: true },
  },
  preload: {
    plugins: [externalizeDepsPlugin({ exclude: ['zod'] })],
    resolve: { alias },
    build: { sourcemap: false, minify: true, rollupOptions: { output: { format: 'cjs' } } },
  },
  renderer: {
    root: resolve(__dirname, 'src/renderer'),
    resolve: { alias: { ...alias, '@': resolve(__dirname, 'src/renderer/src') } },
    plugins: [react(), tailwindcss()],
    build: { sourcemap: false, minify: true, rollupOptions: { input: resolve(__dirname, 'src/renderer/index.html') } },
  },
})
