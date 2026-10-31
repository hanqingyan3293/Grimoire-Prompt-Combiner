import { defineConfig } from 'vitest/config'
import { appDefines, compatAliases, compatRoot, dedupePackages } from './vite.shared.config'

// Shares aliases, build globals and the React dedupe list with `vite.config.ts`. Before this,
// the two were hand-maintained and had already diverged: this config lacked the
// `useOpenReleaseNotes`/`MermaidPreview` shims and all four `__APP_*__` defines, so pages that
// work in the shipped window threw `__APP_EDITION__ is not defined` here and any file routing
// through an unshimmed hook was tested against a module the app never loads.
export default defineConfig({
  root: compatRoot,
  define: appDefines,
  resolve: {
    dedupe: dedupePackages,
    alias: compatAliases(),
  },
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    setupFiles: ['./src/test-setup.ts'],
    // G4 runs alongside G3 (the whole root suite) on the same machine. Under that load the default 1s
    // `findBy*` budget expires and a passing test goes red — the panel test passes alone but failed inside
    // the gate. These are jsdom UI tests; a few seconds of slack removes the flake without hiding a hang.
    testTimeout: 30000,
    hookTimeout: 30000,
  }
})
