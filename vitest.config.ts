import { defineConfig } from 'vitest/config'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const rootDir = path.dirname(fileURLToPath(import.meta.url))

export default defineConfig({
  resolve: {
    alias: {
      '@shared': path.resolve(rootDir, 'src/shared'),
      '@renderer': path.resolve(rootDir, 'src/renderer'),
      '@canvas': path.resolve(rootDir, 'src/renderer/canvas-vendor')
    }
  },
  test: {
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    exclude: [
      'node_modules/**',
      'dist/**',
      'src/vendor/cherry/compat/**',
      'src/vendor/cherry/source/**',
      'src/vendor/dockview/source/**',
      'src/vendor/infinite-canvas/source/**'
    ],
    passWithNoTests: false
  }
})
