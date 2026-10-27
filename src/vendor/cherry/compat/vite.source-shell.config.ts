import path from 'node:path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { appDefines, compatAliases, compatRoot, dedupePackages } from './vite.shared.config'

// Opt-in compilation seam only. Never mutate the compat alias list or production entry.
export function sourceShellAliases() {
  return [
    { find: /^@renderer\/routeTree\.gen$/, replacement: path.resolve(compatRoot, 'src/source-shell-generated/routeTree.gen.ts') },
    // prepareWindow calls initSentry; Grimoire has no Sentry main-process/consent backend.
    // Disable only this telemetry boundary, retaining authentic preparation and product logic.
    { find: /^@renderer\/services\/sentry$/, replacement: path.resolve(compatRoot, 'src/source-shell-telemetry.ts') },
    ...compatAliases().filter(({ find }) =>
      find !== '@tanstack/react-router' && find !== '@renderer/hooks/useOpenReleaseNotes'
    )
  ]
}

export default defineConfig({
  root: compatRoot,
  base: './',
  define: appDefines,
  plugins: [react(), tailwindcss()],
  resolve: { dedupe: dedupePackages, alias: sourceShellAliases() },
  build: {
    outDir: path.resolve(compatRoot, 'dist-source-shell'),
    emptyOutDir: true,
    rolldownOptions: { input: path.resolve(compatRoot, 'source-shell.html') }
  }
})
