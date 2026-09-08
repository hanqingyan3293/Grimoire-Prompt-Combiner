import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'path'
import { fileURLToPath } from 'url'
import { readFileSync } from 'fs'

const rootDir = path.dirname(fileURLToPath(import.meta.url))
const vendorRoot = path.resolve(rootDir, 'src/renderer/canvas-vendor')
const vendorVersion = readFileSync(path.resolve(rootDir, 'src/renderer/canvas-vendor/VERSION'), 'utf8').trim().replace(/^v/, '') || 'dev'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  base: './',
  root: '.',
  resolve: {
    alias: {
      '@shared': path.resolve(__dirname, 'src/shared'),
      '@renderer': path.resolve(__dirname, 'src/renderer'),
      '@canvas': vendorRoot,
      '@infinite-canvas/plugin-sdk': path.resolve(rootDir, 'src/renderer/canvas-plugin-sdk/index.ts'),
    },
  },
  define: {
    __APP_VERSION__: JSON.stringify(vendorVersion),
    __APP_RELEASES__: JSON.stringify([]),
  },
  build: {
    outDir: 'dist/renderer',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        index: path.resolve(rootDir, 'index.html'),
        canvas: path.resolve(rootDir, 'canvas.html'),
      },
    },
  },
  server: {
    port: 5173,
    strictPort: true,
  },
})
