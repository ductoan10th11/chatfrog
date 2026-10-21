/// <reference types="vitest/config" />
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { rmSync } from 'node:fs'
import path from 'node:path'
import { defineConfig, type Plugin, type ResolvedConfig } from 'vite'

/** public/mockServiceWorker.js is only needed for `VITE_MOCK=1` builds; keep it out of production. */
function stripMockServiceWorker(): Plugin {
  let config: ResolvedConfig
  return {
    name: 'chatfrog:strip-mock-sw',
    apply: 'build',
    configResolved(c) {
      config = c
    },
    closeBundle() {
      if (config.env.VITE_MOCK === '1') return
      rmSync(path.resolve(config.root, config.build.outDir, 'mockServiceWorker.js'), {
        force: true,
      })
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss(), stripMockServiceWorker()],
  resolve: {
    alias: { '@': path.resolve(import.meta.dirname, 'src') },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    css: false,
  },
})
