import path from 'node:path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { appDefines, compatAliases, compatRoot, dedupePackages } from './vite.shared.config'

// Aliases, build globals and the React dedupe list live in `vite.shared.config.ts` so the test
// config cannot drift from what this build ships. See that file for why.
export default defineConfig({
  root: compatRoot,
  base: './',
  define: appDefines,
  plugins: [react(), tailwindcss()],
  resolve: {
    dedupe: dedupePackages,
    alias: compatAliases(),
  },
  build: {
    outDir: path.resolve(compatRoot, 'dist'),
    emptyOutDir: true,
  },
})
