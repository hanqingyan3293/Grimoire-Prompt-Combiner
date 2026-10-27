# Cherry Studio 2.1.4 compatibility project

This isolated project compiles Cherry source against a controlled alias and shim boundary. It is separate from the Grimoire root manifest because the Cherry snapshot declares a larger dependency and workspace closure.

Run from this directory with Corepack pnpm:

    corepack pnpm install --lockfile=false
    corepack pnpm run typecheck
    corepack pnpm run build

The first entry compiles the real Cherry ChatAppShell source. Grimoire data is connected through CherryHostBridge after the source compatibility surface passes its own entry check and build.

The compatible slice can be verified without running pnpm install scripts:

    node node_modules/typescript/bin/tsc --noEmit --noCheck -p tsconfig.json
    node node_modules/vite/bin/vite.js build

source-package.json and source-pnpm-lock.yaml retain the complete Cherry dependency baseline. The working compatibility manifest intentionally contains only the dependencies needed by the current source slice.
