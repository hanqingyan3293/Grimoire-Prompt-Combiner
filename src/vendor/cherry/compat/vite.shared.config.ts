import path from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * Resolution and build-global settings shared by the BUILD config and the TEST config.
 *
 * WHY THIS FILE EXISTS: the two configs were maintained by hand and had already diverged. The
 * build config carried `resolve.dedupe` plus the `useOpenReleaseNotes` and `MermaidPreview`
 * shims; the test config did not, so tests resolved DIFFERENT MODULES than the window ships.
 * The build config also declared the four `__APP_*__` globals and the test config declared none,
 * which made every page that reads one throw `__APP_EDITION__ is not defined` in the harness
 * while working in the app — a green suite that says nothing about the artifact.
 *
 * Both configs now import from here, so a shim or global added for the build is present in tests
 * by construction rather than by remembering.
 */

export const compatRoot = path.dirname(fileURLToPath(import.meta.url))
export const sourceRoot = path.resolve(compatRoot, '../source')

/**
 * The source reads FOUR BUILD-TIME globals, declared in its `env.d.ts` and injected by the
 * source's build config — which is NOT part of the vendored closure. Undefined, they throw at
 * MODULE SCOPE, and because they are referenced from a shared chunk the crash took down EVERY
 * route in the compat window, not just the page that reads them. Verified: registering the
 * release-notes route made 16 of 16 routes fail.
 *
 * Enumerated by searching the closure for `__APP_*__` rather than fixing them one at a time.
 * The first attempt defined only the two the failing page names, which moved the failure to
 * `__APP_EDITION__` (used by the renderer's sentry service, in the shared chunk) instead of
 * resolving it.
 *
 * Values, by the TYPE each global must satisfy (`mergeReleaseNotes(current, history)`):
 *  - `__APP_RELEASE_NOTES__` is a STRING of markdown (the page splits it per language).
 *  - `__APP_RELEASE_HISTORY__` must be an ARRAY of `{ version, notes }`. An empty string made
 *    the page throw `t.filter is not a function` — the second failure in this sequence, after
 *    the undefined-global one. Array, not `''`.
 *  - `__APP_RELEASE_VERSION__` must be a semver string: `expandedVersions` seeds from it and
 *    the history validator compares it against a stable-version pattern.
 *  - `__APP_EDITION__` is `global` — Grimoire has one edition, and the source's other value
 *    (`cn`) selects a China-specific provider registry with no counterpart here.
 */
export const appDefines: Record<string, string> = {
  __APP_EDITION__: JSON.stringify('global'),
  __APP_RELEASE_NOTES__: JSON.stringify(''),
  __APP_RELEASE_HISTORY__: JSON.stringify([]),
  __APP_RELEASE_VERSION__: JSON.stringify(process.env.npm_package_version || '0.0.0')
}

/**
 * The source tree and the compat project can resolve React (and its runtime peers) through two
 * paths, which emitted two separate React chunks with identical content. A lazily-loaded source
 * subtree then received a different React instance than the entry, and every hook in it died
 * with "Cannot read properties of null (reading 'useState')". Deduping pins one instance per
 * package.
 */
export const dedupePackages = [
  'react',
  'react-dom',
  'react/jsx-runtime',
  'react/jsx-dev-runtime',
  'scheduler'
]

/** Alias list, in order. Order matters: the absolute-path entries must precede the bare ones. */
export function compatAliases(root: string = compatRoot, source: string = sourceRoot) {
  return [
    { find: '@shared/cherry-host-types', replacement: path.resolve(root, '../../../shared/cherry-host-types.ts') },
    { find: '@cherrystudio/ui/icons/providers', replacement: path.resolve(source, 'packages/ui/src/components/icons/providers/index.ts') },
    { find: '@cherrystudio/ui/icons', replacement: path.resolve(source, 'packages/ui/src/components/icons/index.ts') },
    { find: 'og-crd/style.css', replacement: path.resolve(root, 'node_modules/og-crd/dist/style.css') },
    { find: '@renderer/components/chat/messages/MessageListProvider', replacement: path.resolve(source, 'src/renderer/components/chat/messages/MessageListProvider.tsx') },
    // Vite aliases match the import specifier BEFORE relative resolution. The source
    // ModelSelector and its barrel import this exact relative name; absolute aliases
    // alone never intercept them, leaving the real picker on the source DataApi hook.
    // Vite aliases match the import specifier BEFORE relative resolution. The source
    // ModelSelector and its barrel import this exact relative name; absolute aliases
    // alone never intercept them, leaving the real picker on the source DataApi hook.
    { find: /^\.\/useModelSelectorData$/, replacement: path.resolve(root, 'src/shims/model-selector-data.ts') },
    { find: path.resolve(source, 'src/renderer/components/ModelSelector/useModelSelectorData'), replacement: path.resolve(root, 'src/shims/model-selector-data.ts') },
    { find: path.resolve(source, 'src/renderer/components/ModelSelector/useModelSelectorData.ts'), replacement: path.resolve(root, 'src/shims/model-selector-data.ts') },
    { find: '@renderer/components/Preview/MermaidPreview', replacement: path.resolve(root, 'src/shims/mermaid-preview.tsx') },
    { find: '@renderer/components/ModelSelector/useModelSelectorData', replacement: path.resolve(root, 'src/shims/model-selector-data.ts') },
    // `useOpenReleaseNotes` reads `useTabs()` (source tab shell). The compat window has a
    // hash route registry instead of tabs, so the hook is replaced with a route
    // navigation — see the shim for why `TabsProvider` itself is not mounted.
    { find: '@renderer/hooks/useOpenReleaseNotes', replacement: path.resolve(root, 'src/shims/use-open-release-notes.ts') },
    { find: '@data/PreferenceService', replacement: path.resolve(root, 'src/shims/preference-service.ts') },
    { find: '@tanstack/react-router', replacement: path.resolve(root, 'src/shims/tanstack-router.ts') },
    { find: '@renderer/data/PreferenceService', replacement: path.resolve(root, 'src/shims/preference-service.ts') },
    { find: '@renderer', replacement: path.resolve(source, 'src/renderer') },
    { find: '@shared', replacement: path.resolve(source, 'src/shared') },
    { find: '@main', replacement: path.resolve(source, 'src/main') },
    { find: '@data', replacement: path.resolve(source, 'src/renderer/data') },
    { find: '@logger', replacement: path.resolve(root, 'src/shims/logger.ts') },
    // `@cherrystudio/extension-table-plus@3.0.13` (Cherry Studio's own tiptap table fork) ships a
    // BROKEN `exports` map: it declares `"import": "./dist/index.js"` but the published tarball
    // contains `dist/index.mjs` — `dist/index.js` does not exist, so every bundler resolution of
    // the bare specifier fails while plain Node resolution of the CJS `require` branch succeeds.
    // Verified against the installed package, and present in all four published versions
    // (3.0.10-3.0.13). This points at the file that IS shipped.
    //
    // An alias rather than a patch of the installed file: `node_modules` is regenerated by
    // `pnpm install`, so a hand-edit would silently vanish on the next install and the build
    // would fail again with no record of why. The package's own code is NOT modified.
    { find: '@cherrystudio/extension-table-plus', replacement: path.resolve(root, 'node_modules/@cherrystudio/extension-table-plus/dist/index.mjs') },
    { find: '@cherrystudio/ui', replacement: path.resolve(source, 'packages/ui/src') },
    { find: '@cherrystudio/provider-registry', replacement: path.resolve(source, 'packages/provider-registry/src') },
    { find: '@cherrystudio/ai-core', replacement: path.resolve(source, 'packages/aiCore/src') }
  ]
}
