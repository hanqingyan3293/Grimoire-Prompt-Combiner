# Third-Party Notices

## Infinite Canvas

- Project: `basketikun/infinite-canvas`
- Source: https://github.com/basketikun/infinite-canvas
- License: MIT
- Copyright: Copyright (c) 2026 basketikun
- Usage: The Grimoire canvas grouping, selection-state separation, geometry helpers, and node-registry architecture were adapted from the upstream design. The upstream application, routes, IndexedDB storage, remote APIs, Agent integration, and remote plugin loader are not bundled.

MIT License

Copyright (c) 2026 basketikun

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

## Cherry Studio Provider Catalog and AI UI References

- Project: Cherry Studio
- Source: local reference snapshot under 项目参考/cherry-studio-main
- License: AGPL-3.0
- Usage: The provider and model catalog data is imported into Grimoire's AI catalog layer. Selected UI and interaction patterns are reimplemented or adapted; the Cherry application is not embedded as a separate application.
- Notice: The original AGPL-3.0 license and copyright notices are retained in the reference source and apply to copied or adapted portions.

### Vendored/Adapted Cherry UI Modules

- Source version: Cherry Studio 2.1.4
- Local source: 项目参考/cherry-studio-main
- Adapted area: src/renderer/vendor/cherry/
- Adapted modules: Message Parts, Markdown/message rendering, Composer surface, attachment chips and related AI interaction patterns.
- Modification: Grimoire theme variables, IPC/ViewModel adapters, local Session persistence, Runtime events, permissions and asset references were added or changed for Grimoire.
- The Cherry Studio AGPL-3.0 license and copyright notice apply to copied or adapted portions.

### Cherry Studio Source Vendor

- Source version: Cherry Studio 2.1.4
- Local source snapshot: 项目参考/cherry-studio-main
- Vendored path: src/vendor/cherry/source/
- Vendored areas: renderer components, pages, routes, locales, windows, shared data, main references, chat shell, messages, Markdown, chat primitives, resource lists, Composer, ModelSelector, UI, aiCore, Provider Registry, SDK source, and source tests; 8,084 files in the current closure.
- Grimoire changes are kept outside the vendored source under src/integrations/cherry and the existing Grimoire renderer adapters.
- The adjacent src/vendor/cherry/source/LICENSE is retained. The source vendor remains subject to AGPL-3.0 obligations.
- The full Cherry source closure has 357 package-level dependencies that are not present in Grimoire's package manifest. These files remain an auditable vendor snapshot until the dedicated compatibility build and package-level license audit are complete.

## Cherry Directory Tree Partial Extraction

- Source: Cherry Studio 2.1.4 `shared/utils/file/tree.ts` and `main/services/file/tree/*`.
- Destination: `src/integrations/cherry/file-tree/`; original source hashes and boundary changes are recorded in the extracted headers. Source snapshot remains unchanged.
- License: Cherry portions remain AGPL-3.0; the source LICENSE is retained and distributed as noted above.
- Runtime dependencies: `chokidar@4.0.3`, `ignore@7.0.6`, `zod@4.3.4`; actual installed license texts were inspected, all MIT. Their respective copyright notices are:
  - Copyright (c) 2012 Paul Miller (https://paulmillr.com), Elan Shanker
  - Copyright (c) 2013 Kael Zhang <i@kael.me>, contributors (http://kael.me/)
  - Copyright (c) 2025 Colin McDonnell

MIT permission and disclaimer applying to these dependency portions:

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

## OpenCode Runtime References

- Project: opencode
- Source: local reference snapshot under 项目参考/opencode-dev
- License: MIT
- Usage: The MIT OpenCode v1.18.34 headless CLI is locally prepared under resources/agent-runtimes/opencode/ and launched only as a hidden loopback service when selected. The OpenCode Desktop installer is not embedded. Runtime, session, event, tool, MCP, and permission concepts are adapted through Grimoire interfaces.

## Pi Runtime References

- Project: pi
- Source: local reference snapshot under 项目参考/pi-main
- License: MIT
- Usage: The MIT Pi coding-agent v1.0.1 Windows runtime is locally prepared under resources/agent-runtimes/pi/ and launched only as a hidden RPC subprocess when selected. Agent loop, JSONL runtime, dynamic tool, MCP, branching, and compaction concepts are adapted through Grimoire interfaces.

## OpenCode Source Vendor

- Source snapshot: 项目参考/opencode-dev
- Vendored path: src/vendor/opencode/source/
- Vendored areas: Session, Agent, Permission, core Tool definitions, and server event definitions.
- License: MIT; source LICENSE is retained in the vendor directory.
- Production integration remains behind the Grimoire OpenCode adapter and is not declared complete until the migration matrix parity row passes.

## Pi Source Vendor

- Source snapshot: 项目参考/pi-main
- Vendored path: src/vendor/pi/source/
- Vendored areas: coding-agent core, session/event handling, compaction, tools, Tool Search, Codemode, extensions, and RPC-relevant CLI definitions.
- License: MIT; source LICENSE is retained in the vendor directory.
- Production integration remains behind the Grimoire Pi adapter and is not declared complete until the migration matrix parity row passes.

## Dockview Source Vendor

- Source snapshot: 项目参考/dockview-master
- Core version: 8.4.0
- Vendored path: src/vendor/dockview/source/
- Vendored areas: Dockview core and React adapter, including DND, grid/split/pane, floating groups, popouts, serialization, themes, and tests.
- License: MIT; package LICENCE.md files are retained under the vendored package directories.
- Enterprise-only code is not included by this vendor operation.

## Infinite Canvas Source Vendor

- Source snapshots: 无限参考/infinite-canvas-main and 无限参考/infinite-canvas-0.18.0
- Vendored path: src/vendor/infinite-canvas/source/
- Vendored areas: web/src, canvas-agent/src, and plugins/canvas/sdk/src from both snapshots.
- License: MIT; each snapshot retains its LICENSE and VERSION files.
- The existing Grimoire Canvas production adapter remains separate and must pass the migration matrix parity audit before being declared complete.

## BooruDatasetTagManager References

- Project: `starik222/BooruDatasetTagManager`
- Source: local reference snapshot under 项目参考/BooruDatasetTagManager-master
- License: MIT (root LICENSE, Copyright (c) 2024 starik222)
- Usage: The prompt weight algorithm (round brackets ×1.1, square brackets ÷1.1, explicit `(tag:1.3)` weights, BREAK separators, duplicate merge) was ported to TypeScript in `src/shared/tag-prompt-core.ts`; the batch operation set (add/remove/replace over a filtered asset set with dry-run preview) informed `src/main/services/tag-batch.service.ts`. The AiApiServer tagger files carrying third-party provenance (SmilingWolf HF space, AUTOMATIC1111 TorchDeepDanbooru) were not used.

## SD Image Sorter References

- Project: `Rinne414/sd-image-sorter`
- Source: local reference snapshot under 项目参考/sd-image-sorter-main
- License: MIT (LICENSE, Copyright (c) 2026 Rinne414)
- Usage: Metadata parsing rules (A1111/Forge parameters text, NovelAI caption JSON, ComfyUI graph tracing), gallery filter/query shapes, the batch dry-run safety flow and the derivative/thumbnail load pipeline were studied and reimplemented in TypeScript under `src/main/services/media-metadata.core.ts`, `media-metadata.service.ts`, `gallery-query.service.ts`, `tag-batch.service.ts` and `thumbnail.service.ts`. No Python or JavaScript source files were copied; the MIT notice applies to the adapted portions.

## Hydrus Tag-Search Semantics

- Project: `hydrusnetwork/hydrus`
- Source: local reference snapshot under 项目参考/hydrus-master
- License: WTFPL v3 (root LICENSE)
- Usage: Tag-centric search predicate semantics (any/all/none over tag sets, numeric reference joins, stable pagination for large libraries) informed the clean-room SQL in `tag-asset-query.service.ts` and `gallery-query.service.ts`. No Python source was copied.

## Cherry Studio Tiptap Patch Contributions

- Origin: local Cherry Studio 2.1.4 reference snapshot; source commit metadata is unavailable.
- The unchanged patch artifacts are retained under `src/vendor/cherry/compat/patches/` and applied through compat `patchedDependencies`, targeting Tiptap 3.26.1.
- `@tiptap__extension-drag-handle@3.26.1.patch`: SHA-256 `2f5c32153f059725f94906803079b90be2a4cf602befe45cd4f2e96652099096`.
- `@tiptap__extension-list@3.26.1.patch`: SHA-256 `584483147536f57383bef48109cf67a7798ae4c965a97009c61003a9c509898f`.
- `@tiptap__markdown@3.26.1.patch`: SHA-256 `9ba2ca0537cedf2c97ebd75072889c258da2d3d96fbd0b9b09cfdc6092e6afb9`.
- Base packages carry the MIT license, copyright 2025 Tiptap GmbH; their original permission/copyright texts remain in the installed packages. Cherry patch contributions are conservatively covered by the snapshot's AGPL-3.0 license. The combined patched code is not represented as MIT-only.
- Behavior: editor-DOM scroll handle cleanup, non-list tokenizer early guards, Markdown lexer exposure and whitespace/emphasis fidelity. These are not claimed as general XSS protection or a comprehensive Markdown resource-exhaustion defense.

## Cherry Studio Workspace Packages: AGPL-3.0 vs `"license": "MIT"` — resolved

The contradiction recorded in `.agent/STATUS.md` since the dependency audit is **resolved
conservatively**, and the reading is written here so it stops being re-opened as an unknown.

**The facts, from reading the files rather than the READMEs:**

- `src/vendor/cherry/source/LICENSE` is **AGPL-3.0**, and it is the ONLY license file in the
  vendored closure (`find . -name 'LICENSE*' -not -path '*/node_modules/*'` returns exactly one
  path).
- Four workspace packages declare a different license in `package.json` **with no license text
  of their own**: `packages/{ui,aiCore,provider-registry,ai-sdk-provider}` → `"license": "MIT"`.
  There is no `packages/*/LICENSE` file for any of them.
- Those packages are **compiled into the compat bundle**, not consumed as external
  dependencies: `vite.config.ts` aliases `@cherrystudio/ui` to `packages/ui/src`, and the built
  assets contain no `@cherrystudio` specifier — the code is inlined.
- The root `package.json` of the source closure is AGPL-3.0, and every workspace package
  depends on that same root regardless of its own declared field.

**Determination: AGPL-3.0 governs.** An SPDX identifier in a workspace `package.json` is a
declaration by the author, not a grant of additional permissions, and it cannot override the
only actual license text in the tree. Where a package's declared license and the repository's
own license disagree, the repository license is what a redistributor must satisfy — the
alternative reading would let any contributor relicense the whole repository by editing one
field with no license text behind it.

**Where MIT matters, and why it is not lost:** MIT is *compatible* with AGPL-3.0 in the
direction that applies here. MIT code may be included in an AGPL-3.0 work; the combined work
is distributed under AGPL-3.0, and the MIT portions keep their MIT attribution. The practical
obligation is therefore a **notice**, not a permission problem: MIT requires the copyright
notice and permission text to travel with the code, and AGPL-3.0 requires the combined work's
source to be available. Both are already satisfied structurally — the vendored closure retains
its `LICENSE`, this file records the attribution, and the source is present in the repository.

**What is NOT claimed:** that the packages' declared MIT field is meaningless. If their authors
intended MIT, that intent is honoured by recording the attribution here and preserving the
declared field in the vendored `package.json` files (both done). What is rejected is treating
that field as license to disregard the AGPL-3.0 text that actually ships with the tree.

**Residual, named honestly:** the per-file authorship of the four packages is not traced —
this determination is about which license governs, not about which lines came from where. That
distinction only matters if a downstream user wants to extract those packages as standalone MIT
code, which is not how Grimoire consumes them (they are inlined into an AGPL-3.0 bundle).

## Isolated Cherry Source-Shell Compilation Dependencies (2026-10-12)

Exact versions are taken from the preserved Cherry 2.1.4 source lockfile, not upgrades selected to clear the full application. Existing default build/config/entry remains unchanged; the opt-in artifact is `compat/dist-source-shell`.

Actual installed license files were read (not inferred from manifest fields):

| Package | Version | Actual license / copyright |
|---|---|---|
| `@xyflow/react` | 12.10.0 | MIT; Copyright (c) 2019–2025 webkid GmbH |
| `@dagrejs/dagre` | 3.0.0 | MIT; Copyright (c) 2012–2014 Chris Pettitt |
| `croner` | 10.0.1 | MIT; Copyright (c) 2015–2021 Hexagon |
| `qrcode.react` | 4.2.0 | ISC; Copyright (c) 2015 Paul O’Shannessy. Its installed LICENSE also identifies the bundled QR Code Generator as MIT; the installed `lib/esm/index.js` preserves Copyright (c) Project Nayuki and SPDX-License-Identifier: MIT |
| `@ai-sdk/react` | 3.0.187 | Apache-2.0; Copyright 2023 Vercel, Inc. |
| `ai` (existing dependency, now source-patched) | 6.0.185 | Apache-2.0; Copyright 2023 Vercel, Inc. |
| `@e965/xlsx` | 0.20.3 | Apache-2.0 (full text in installed LICENSE); Copyright (C) 2012-present SheetJS LLC |

The exact installed license texts are additionally retained under `artifacts/source-shell/licenses/`; package originals remain intact. The MIT and ISC portions retain their copyright and permission notices. The Nayuki attribution above is the actual header shipped in this package, not a claim that its tarball contains a separate full third-party MIT LICENSE file.

### Authentic Cherry AI SDK Patch Contributions

Unchanged original artifacts from the granted Cherry reference snapshot are retained under `src/vendor/cherry/compat/patches/` and explicitly applied through `pnpm-workspace.yaml` patchedDependencies:

- `@ai-sdk__react@3.0.187.patch`: SHA-256 `8182f09c37c2d080e4794d30401712c0605e986e985380ea76699758f2ed7230`.
- `ai@6.0.185.patch`: SHA-256 `61fc175c652267f39ec01df738fc61d1639faa19b980441005f7e9cd645d1711`.

Both hashes match the authentic source lockfile. The React hook patch uses structural-sharing message snapshots. The AI core patch also uses structural sharing and preserves Cherry's generated-image download/type contract, including data URLs, HTTP(S) downloads, and warnings when malformed/unavailable images are dropped. No backend/native implementation is added by these patches. Their contributions are conservatively covered by Cherry's AGPL-3.0 source license; original Vercel Apache-2.0 notices are retained. The combined patched code is not represented as unmodified Apache-only upstream code. The patch of the existing `ai` dependency also affects the default compat dependency resolution, so the unchanged default compat build and full tests are regression gates.
