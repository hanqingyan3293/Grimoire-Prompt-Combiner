# Grimoire migration status

Date: 2026-10-10
Current phase: PHASE_3_SETTINGS_SURFACES (Phase 1/2 largely wired; Phase 3 wired for Provider/MCP/appearance with the remaining settings pages and Agent/Tool state blocks open; Phase 4 partially wired; Phase 5 capture infrastructure runs — baselines recorded to artifacts/visual/, enforcement order still pending)

## Baseline

- The working tree contains user-owned uncommitted changes across AI, Runtime, Workspace, Canvas, media, tags, settings, preload, and startup code.
- No destructive reset or checkout is allowed.
- Existing runtime, attachment, MCP, media, tag, Canvas, Workspace, and Cherry-adapter tests are retained.
- Current verification: 83 host test files / 410 tests passed; Cherry adapter tests are 4 files / 10 tests; compat tests are 10 files / 55 tests; `npm run build:main`, `npm run typecheck:cherry-compat`, `npm run build:cherry-compat`, and the full `npm run build` (exit 0) pass. This batch mounts the real source Appearance settings page at `/settings/appearance` (all sections rendering, verified in capture) with real persistence through the preference shim, a source-faithful `app.adjust_zoom` (same `handleZoomFactor` bounds/reset semantics against `app.zoom_factor`) and a `window.api.application.relaunch` that reloads windows instead of restarting the process; `system.get_fonts` answers the empty list the source handles, so the font pickers show only defaults (recorded gap). The two shared shell routes (`system.shell.open_path`, `system.shell.open_website`) delegate to the same validation Grimoire's own system IPC uses. `/settings/general` resolves to a BLOCKED diagnostic that names each missing service (tray/launch-on-boot/hardware-acceleration/proxy/prevent-sleep/retry/context-compression) instead of mounting a page whose switches would have no effect. The batch also mounts the real source MCP settings surface: `cherry-data-api.ipc.ts` serves `/mcp-servers*` in the source response shape honoring the source list query filters (22 transport tests total, both provider and MCP, incl. the full-object detail-page save payload), the source `McpServersList` renders at `/settings/mcp` with a seeded fixture card (`Fixture 文档服务`, `streamableHttp` type) verified in the captures, the real source MCP detail page (`McpSettings` — full form incl. the v24 description/headers/timeout fields, tools/prompts/resources/logs tabs, delete/save/back) mounts at the parameterized `/settings/mcp/settings/$serverId` route and was verified in capture, schema v24 additively stores the detail-form `description`/`headers`/`timeout`/`disabled_auto_approve_tools` columns with the HTTP transport consuming headers and timeout and both permission paths consuming auto-approve as force-prompt (2 migration tests), MCP runtime commands (`mcp.server.refresh_tools`/`stop`/`remove`/`restart`/`check_connectivity`/`get_version`/`list_prompts`/`list_resources`/`get_logs`) route through the main-process `ipcApi` handler with the source `IpcResult` failure semantics (a failed connect rejects instead of resolving; `connectMcpServer` is now idempotent for a live stdio process), a `cache:get-all-shared`/`cache:sync` bridge serves the `mcp.status.<id>`/`mcp.tools.<id>` shared-cache entries the detail page's status badge and tools tab read (4 projection tests, wire-id digest byte-identical to the source), env/headers values are masked to the renderer with placeholder-echo restoration so a form round trip cannot wipe stored secrets, and the router shim gained reactive `useLocation`/`useSearch`/`useParams` (`useSyncExternalStore` on `hashchange`), `$param` template substitution, `getRouteApi` and `Outlet`. `@hookform/resolvers` and `npx-scope-finder` added as declared compat dependencies (resolution gaps, same class as `lru-cache`). Electron smoke (`npm run dev:cherry`): no Cherry runtime errors; Electron stopped afterwards. Earlier in this batch: source Provider Settings page at `/settings/provider`, route registry, recycle-bin undo, runtime language sync, streaming overlay, file bridge, menu allowlist.
- The 8,084-file Cherry source closure is preserved under src/vendor/cherry/source and the isolated compatibility project now builds the real ChatShell, MessageList, Markdown, CodeBlock, ModelSelector, ComposerSurface, EmojiPicker and file preview paths.
- Current OpenCode/Pi/Codex implementations are adapters; full source migration audit is not complete.
- Current Workspace uses a Grimoire engine; Dockview source parity is not complete.

## DONE in this phase

- Migration discipline defined.
- Working-tree protection defined.
- Source project scope defined.
- Status vocabulary defined.
- Three-gate milestone rule defined.
- Seed migration matrix created.
- Initial license scan completed for the local reference snapshots.
- High-priority source entrypoints were located for Cherry 2.1.4, OpenCode, Pi, and Dockview core.
- Cherry AI source closure was vendored under src/vendor/cherry/source without replacing the current production entry.
- OpenCode source closure was vendored under src/vendor/opencode/source (71 files).
- Pi source closure was vendored under src/vendor/pi/source (108 files).
- Dockview core and React source closure was vendored under src/vendor/dockview/source (272 files).
- Infinite Canvas source closures were vendored under src/vendor/infinite-canvas/source (424 files from main and v0.18.0).
- Cherry ModelSelector selection invariants are now consumed through src/integrations/cherry/model-selection.ts and covered by adapter tests.
- OpenCode adapter now maps source reasoning, permission reply, and compaction events into the unified RuntimeEvent stream, with protocol tests.
- Pi adapter now maps source thinking deltas, tool-call completion, and tool execution update events while retaining agent_settled as the terminal event.
- Cherry standalone HTML artifact detection is now connected through src/integrations/cherry/markdown-artifacts.ts and used by the Grimoire message renderer.
- The isolated Cherry compatibility project is under src/vendor/cherry/compat with its own manifest, lockfile, aliases, Vite build and source entry.
- Cherry compatibility output is copied to dist/cherry-compat and opened through a dedicated Electron BrowserWindow using the existing preload boundary.
- npm run dev:cherry now builds the compatibility bundle and launches the Grimoire renderer plus Electron with the Cherry window opened automatically.
- Blank-window smoke fix: the compatibility entry now uses the same React instance for Host Bridge context, mounts Cherry QuickPanelProvider and ComposerToolRuntimeProvider, defines the source app edition, supplies the full logger shim, and aliases the source ModelSelector data hook to the Grimoire catalog adapter.
- Clean Electron restart evidence: Cherry logs reach cache, Composer, session and model initialization without React hook, QuickPanel, ComposerToolProvider, __APP_EDITION__, or source provider/model request failures.
- The source ChatShell entry now reads unified sessions, messages, events and model catalog data through the Host Bridge; send, stop, model selection, session creation and live event refresh are connected.
- The compat Session pane now uses source `SessionResourceList`/`ResourceList` with time grouping, search, loading/empty/error/retry, keyboard selection, IME-safe rename, branch, pin, archive/restore controls, and an isolated jsdom test slice.
- Schema version 20 adds an additive `cherry_resource_state` projection for session, assistant and topic archived/pinned/order/group/owner/activity state; lifecycle mutations repair missing rows transactionally, preserve legacy AI rows and metadata, and keep permanent delete separate from archive.
- Schema version 24 adds the source MCP detail-form columns (`mcp_servers.description`, `headers_json`, `timeout_seconds`, `disabled_auto_approve_tools_json`), additively and under the pre-migration backup. All four are consumed: headers and timeout by the HTTP transport, and `disabled_auto_approve_tools` by both permission paths through `isMcpToolForcePrompt` — a tool the user forced to prompt bypasses every auto-allow branch and always raises a request (it can only force a prompt, never grant). `database.v24.test.ts` covers the upgrade, the legacy-row defaults and idempotence on reopen.
- Compat now exposes explicit source-backed Assistant / Topic and Provider / MCP panel toggles using `ResourceEntityRail`, `TopicResourceList`, Cherry `McpDetailList`, and Host-backed status adapters; MCP tools support source-shaped search, enablement and input-schema detail without implicit calls. Topic display is session-scoped and explicitly does not claim independent Cherry topic message ownership. Provider secrets remain main-process-only.
- Cherry provider connection slice: new main-process `provider-connection.service.ts` (URL/key/model resolution, `/models` normalization, connection probe) with 6 unit tests; new IPC `providers:fetchModelsFor` / `providers:testFor` read the stored key by provider id so "leave empty to use the saved key" is real and the renderer never sees the secret; compat panel pull/test now use these APIs; the model preview is the real source `ModelListSyncContent` (select mode) driven by source `useModelListSyncView` (search, capability tabs, group select-all) instead of the hand-written list; stale pull results from a previous provider are dropped via request-id guard; apply failures surface as an error line. The compat entry now awaits source `initI18n()` before render, so source component labels resolve from real Cherry locale packs (lazy, en-US fallback).
- Electron smoke this slice: `npm run dev:cherry` started cleanly after the i18n entry change; the Cherry surface rendered with the source-locale labels (group headers/placeholders in Chinese) and the 会话 / 助手 / 主题 / Provider / MCP tabs. Also fixed a missing `parseMediaMetadata` import in `images.ipc.ts` (a parallel-session build break) so the full build is green; this is a build unblock, not part of the Cherry slice.
- Cherry compat stylesheet contract: the window now imports the source's own two stylesheets in the source's order (`renderer/assets/styles/index.css` then `tailwind.css`) instead of a hand-rolled `tailwindcss`+tokens+theme+product subset — DIRECT_REUSE of the source styling contract. This fixed a measured utility-coverage collapse: Tailwind v4 detects content relative to the project base (the Vite root, `compat/`), so the sibling `../source` tree the surface actually renders was never scanned and only **112/1494 (7.5%)** of the source tree's utility tokens existed in the built CSS. Explicit `@source` roots for `source/src` and `source/packages/ui/src` bring it to **1401/1421 (98.6%)**. The visible symptom was the source `Dialog` painting in normal flow instead of centred (`.fixed`/`.top-[50%]`/`.left-[50%]`/`.translate-x-[-50%]`/`.rounded-3xl`/`.p-6`/`.animate-in` all absent), so an open `opacity:1` confirm dialog measured `rect {x:0,y:763,w:1266,h:268}` — invisible; it now measures `rect {x:409,y:218,w:448,h:328}` over a dimmed overlay. Two source-declared dependencies added with pnpm: `tw-animate-css@1.4.0` (`@tailwindcss/vite` exposes no `exports` entry for it, so the animate-in family was silently missing) and `@fontsource/ubuntu@5.2.8`. The two stylesheets must stay separate modules — concatenating them puts `@import` after rules and fails the build. New `npm run check:cherry-css` (`scripts/check-compat-css.mjs`) gates coverage at 90%, excluding non-generatable shapes (`group/*` markers, SVGR-prefixed names, `layer(app)` hook classes) and ten HeroUI-era leftovers no closure stylesheet defines (upstream defects, left untouched because `source` is read-only).
- Obsidian export target discovery implemented (data settings cloud-sync group). New `obsidian-vault.service.ts` mirrors the source `ObsidianVaultService`: it reads **Obsidian's own vault registry** (`%APPDATA%/obsidian/obsidian.json`, `~/Library/Application Support/obsidian/obsidian.json`, or `$XDG_CONFIG_HOME/obsidian/obsidian.json` with the source's case tolerance) rather than asking the user for a folder — so the export dialog offers exactly the vaults Obsidian knows, not a folder picker's larger set. `export.obsidian.get_vaults` and `export.obsidian.get_files` are now served; the walker collects folders and `.md` files and skips dot-entries, matching the source (offering `.obsidian` as a target would let a user write into its config). **Verified live against the real machine**: this host has Obsidian installed with three registered vaults, and the routes return all three with their real paths, with `get_files` walking vault `001` and returning its actual structure (folder 未命名, markdown 2026-07-07.md / 欢迎.md). Missing config, unreadable vault and malformed JSON all answer empty rather than throwing — the dialog then says "no vaults", which is true about the machine. 4 tests (a fifth is skipped on Windows: it covers the macOS config path, which ignores env vars and so cannot be redirected to a fixture). The remaining cloud-sync panels (WebDAV/S3/Nutstore/Siyuan/Joplin/Notion) configure third-party network destinations and stay unmounted pending adapters.
- Conversation import wired (data settings). The source `ImportService` (ChatGPT/Claude conversation import) writes through the **DataApi**, not the Host Bridge — `POST /assistants` and `POST /topics` — and neither route was bridged, so an import would have failed at its first write. Both now back onto the real Grimoire services (`saveAiAssistant`, `saveAiTopic`) with the SOURCE field names on the wire (`prompt`/`emoji`/`modelId`/`groupId` for assistants; `name`/`orderKey`/`lastActivityAt` for topics), because the consumer is a source module. `orderKey` is read from the topic's real resource-state projection rather than invented; `activeNodeId` is omitted rather than faked, since Grimoire has no per-topic message tree — the same gap the matrix records for topic thread parity. `name` (required by the source assistant schema) and a missing owning session (Grimoire topics are always session-scoped) are rejected as caller errors instead of guessed. Live-verified: the data-settings sidebar shows 导入外部应用数据 / 导出菜单设置 / Markdown 导出, clicking the first renders the panel with ChatGPT and Claude options, and `POST /assistants` answers 201 with the created record. 2 new transport tests. The **export** menu settings and Markdown export needed no route work at all — they read `data.export.*` preferences through the compat preference shim and pick a folder via the `selectFolder` bridge added earlier, so they render from the existing plumbing.
- Window capability matrix written (`.agent/WINDOW_MATRIX.md`) — the plan requires one before any source window is connected. It covers all eight source `WindowType`s with, per window, its L2 root, the main-process lifecycle it needs, its required Host/services, a status, and the named blocker. Two are `NOT_APPLICABLE` (`mcpBrowser` and `print` have no renderer entry in the vendored closure — verified, not assumed; `migrationV2` operates on Cherry v1 data a Grimoire install does not have). The rest are BLOCKED on genuinely missing infrastructure: a multi-window lifecycle service (serving `subWindow`/`quickAssistant`/`screenshot`), global input hooks (`quickAssistant` hotkey, both `selection` windows — `selection-hook` is referenced by `SelectionService.ts` via runtime `require()` but is absent from the install, verified), a capture pipeline (`screenshot`), and a boot-phase relocation protocol (`userDataRelocation`, refused by choice). None is a UI task, which is the honest reason they stay unmounted rather than wired with stubbed lifecycles.
- Domain capability panel added to the compat window's `settings/general` surface. The Host Bridge has always exposed a per-domain `domains` map reporting `available` or `blocked` with the missing service named — but **nothing rendered it**, so the map was accurate and invisible: a user could not tell whether Cherry Browser/Knowledge/Code/Notes/Translate/Selection were absent by design or simply broken. The new `CompatDomainCapabilities` reads that map rather than restating it, so it cannot drift from the bridge. Live-verified rendering "共 10 个产品域，其中 7 个尚未接入" with available domains (文件/绘画/定时任务) in green and blocked ones (浏览器/知识库/代码/…) in amber, each naming its missing service. 4 new tests, including that a domain whose `status()` throws is reported as its own entry rather than blanking the panel. Fixing the test surfaced a real bug in `CherryHostProvider`: it built the `getBridge()` fallback **unconditionally**, reading `window.api` even when a bridge was injected — so an injected bridge was unusable anywhere the preload had not run. The fallback is now built lazily.
- Baseline enforcement order wired (Phase 5): new `scripts/visual-compare.mjs` with `npm run visual:record` / `npm run visual:check`. Two layers, deliberately different in strictness: **structured signals** from `route-diagnostic.json` (pathname, rendered text length within ±10%, fatal-fallback presence) compared strictly — that is the layer that actually guards behaviour — and **pixels** compared with a 2% per-frame tolerance, decoded by a built-in 8-bit PNG decoder (colour types 2/6, filter types 0-4) because the project has no image dependency and adding one for this would be unwarranted. Verified: clean compare exits 0; a frame swapped for a different one is caught at 99.99% difference; a frame the decoder cannot read is reported as a failure rather than skipped. That last one was a real defect I introduced and then fixed — the first version printed "对比通过" while one of fifteen frames had failed to compare, which is the same "reported clean while broken" shape this whole gate exists to eliminate. `--allow-uncomparable` exists for a machine whose PNGs the decoder genuinely cannot parse, and it says so in the output.
- Non-happy-path capture states (Phase 5): the fixture now also seeds a **failed** session (status `failed`, with a failed assistant message carrying an error block) and a **running** session (status `running`, user message only — no persisted assistant message, which is exactly what the loading affordance exists for). Both are seeded through the same services the app uses, never by writing a status the runtime could not produce; live capture shows the amber 运行中 and red 失败 badges rendering in the rail. This closes the plan's loading/error/retry baseline requirement that the populated fixture alone did not cover.
- Visual-gate hardening (Phase 5): a blank or crashed window can no longer be reported as a clean capture. The route diagnostic now detects the source `WindowFatalFallback` (the full-viewport container carrying the 打开调试面板/重新加载 button pair) and the capture **throws** on it — or on an empty content region — instead of writing a screenshot and reporting success. `runVisualCapture` failures now **exit the process non-zero**; they previously logged and quit with code 0, so a blank page reached the driver as a successful run. Verified in both directions: reintroducing the `ipcApi.on` crash makes the run fail with a message naming the route and the rendered error text, and removing it makes the run pass. Detection keys on the fallback's own structure rather than "any `role="alert"`", because the legitimate BLOCKED diagnostics page also uses `role="alert"` — the first version false-positived on it, which the route sweep caught. Full sweep with the new gate: all seven mounted routes (chat, provider, mcp, mcp detail, appearance, general, data, dependencies) pass. This closes the gap that let a crashed page report "0 problems" in an earlier slice.
- Cherry dependencies surface (`/settings/dependencies`) mounted, un-blocking the last BLOCKED settings page. The read half is real: new `binary-tools.service.ts` resolves each of the nine preset tools through the mechanism Grimoire has — bundled runtime root, then system PATH — mirroring the existing `agent-runtime-manager` resolver rather than adding a second one. Live-verified: `uv` and `gh` resolve to their real PATH locations and render the 系统 badge; the other seven report `none` and show the install affordance. The managed-recipe fact is always `unknown`/`backend_unavailable` because Grimoire runs no mise backend — the source models that state explicitly, and `absent` would assert something Grimoire cannot know. The write half is refused: install/add/remove and the registry version queries all answer `NOT_IMPLEMENTED`, because the source installs via mise downloads while Grimoire's recorded policy is `local-only-no-silent-download`. 5 new tests. **Two real bugs found and fixed while doing this**, both mine: (1) the blanket "throw on unbridged `ipcApi.on` event" from an earlier slice crashed the ENTIRE page into an error boundary when this page subscribed `binary.availability_changed` — a missing push event must degrade to an inert subscription, not a broken page, so it now returns a working no-op unsubscribe and reports the gap through the diagnostic log (the capture had shown "0 problems" because the error boundary swallowed it; only the screenshot revealed it). (2) Extracting the event map to its own module broke the preload outright — a SANDBOXED preload cannot `require` a sibling file, so the compiled `require("./cherry-event-channels")` failed with "Unable to load preload script" and every `window.api.*` surface vanished. The map is inlined back with a comment recording why it must stay that way. Both were caught by live capture, not by tests.
- Cherry data-settings surface (`/settings/data`) mounted, un-blocking part of the last BLOCKED settings page. New `cache-cleanup.service.ts` implements `app.cache_cleanup.inspect`/`run` for the two groups with genuine Grimoire targets and answers the rest as `skipped`/`unavailable` — never a fabricated `cleared`. `normal_cache` owns the OS temp dirs Grimoire creates for image import, package extraction, ComfyUI and OpenCode work: **verified by grep that none was ever removed anywhere in the tree**, so they accumulate unreclaimed. `logs` removes rotated log files only, excluding the active one via the logger's own `getActiveLogPath()` (exported for exactly this) so a cleanup cannot break logging mid-session. `app.get_info` returns the real version/arch/paths, which the page renders as its 应用数据/应用日志 rows with working open-directory actions. **`app.data_reset.request` is refused permanently**: the source stages a marker that deletes the ENTIRE user-data directory on next boot (sessions, assets, tags, canvas projects, provider configs and keys) behind a single in-app confirm — acceptable in an app that owns its data outright, unacceptable to expose from a compatibility window running beside Grimoire's own workspace. It answers `NOT_IMPLEMENTED` rather than `void`, so the UI cannot report a reset that never happened; `app.user_data_relocation.*` is refused for the same reason (it needs a boot-time move of the live database). `system.file.select_folder` becomes a real native directory picker answering the source's `string | null` contract. The page's build was silently broken by a missing source-declared peer dep (`dexie@^4.0.8`, required by the Cherry-v1 browser-data reader); installed via pnpm. 6 new tests (group normalization, exact measurement, unavailable-not-zero, temp clearing + `not_found`, rotated-logs-only with the active file proven to survive, and the three no-target groups answering `skipped`). Live-verified through the real IPC path: `logs` → `cleared` with both rotated files gone and the active file intact; `normal_cache` → `cleared` then `not_found`; `data_reset` → `ok:false NOT_IMPLEMENTED`. The cloud-sync panels (WebDAV/S3/Nutstore/Siyuan/Joplin/Notion/Obsidian) and the import/export menu settings stay unmounted.
- Cherry `isToolAutoApproved` capability wired, closing the gap the previous slice recorded. New `CompatMessageListProvider` mounts the source `MessageListProvider` directly (the narrow `MessageContentProvider` wrapper can build the list's state but has no way to carry a UI-selector capability), composing the same state plus `isToolAutoApproved` — the composition the source's own `agentMessageListAdapter`/`homeMessageListAdapter` use. The entry loads MCP servers on mount and reloads after an "always allow" write so the badge actually flips. **Testing this surfaced a real persistence bug**: the `MCP_SERVER_SAVE` agent-IPC handler forwarded `description`/`headers`/`timeout` but silently dropped `disabled_auto_approve_tools`, `long_running`, `registry_url` and `tags` — so the per-tool "always allow" action and the MCP detail form's switches persisted NOTHING through that path while reporting success (the DataApi path used by the settings pages was unaffected, which is why the transport tests passed). The mapping is now the pure exported `toMcpSaveInput` with 4 tests covering the v24/v25 forwarding, absent-vs-falsy distinction, masked-secret restoration and wrong-typed rejection; mutation-checked (removing the forwarding fails 2 of them). Verified live: the denylist write now flips the capability `true` → `false` and leaves other tools alone. 3 new compat tests assert through the source's own `useMessageListUiSelectors` reader — not by inspecting props — so they would have passed while consumers saw nothing had the capability still been unreachable; mutation-checked the same way.
- Cherry tool-approval identity and the per-tool "always allow" action. `AgentToolContext` gained `toolCallId` (from `call.callId` at both execute sites, `ai-sessions.ipc.ts` and `agent.ipc.ts`), the registry threads it into the permission detail, and `permissionToApprovalPart` now uses it as the approval part's `toolCallId` — previously the request id stood in, so the source approval card could not correlate a decision to its call or resolve the owning tool. `respondToolApproval` is wired (answer `allowOnce`/`deny` for that call only) together with a new `setToolAutoApprove` implementing the source `useToolApproval.autoApprove` → `persistAutoApprove` chain: resolve the owning MCP server from the `mcp:<serverId>:<toolName>` registry key, drop the tool from its force-prompt denylist, save it back, with the source's early return when the tool is already auto-approved. **`allowForSession` is deliberately not used**: Grimoire's session grant is keyed by permission KIND, so it would authorise every future tool of that kind — far broader than the action the user chose; it stays reachable only from the legacy Grimoire panels, unchanged. New `permission-actions.ts` holds the pure rules (tool-name → server/tool, denylist transform, approval-id read, decision mapping, the `isToolAutoApproved` rule) with 5 tests, so the entry component only wires them. Also fixed two theme-path gaps the newly-throwing `ipcApi.on` surfaced: `system.get_native_theme` had been failing on every resolve and is now answered from `nativeTheme.shouldUseDarkColors`, and `ThemeProvider`'s `system.native_theme_updated` subscription is served by a new `nativeTheme.updated` broadcast. `isMcpToolForcePrompt` — now load-bearing for the auto-approve round trip and previously untested — gained 2 tests covering the denylist round trip, the source wire-id form and the server-wide wildcard. Live check: the appearance route renders with **zero** renderer errors (previously `get_native_theme` failed on every resolve and `ipcApi.on` threw). Known gap recorded rather than papered over: `isToolAutoApproved` (the tool card's auto-approved badge) stays unsupplied because the mounted `MessageContentProvider` cannot carry it; the gap over-prompts and never fakes an approval.
- Cherry MCP tool-progress ring wired end-to-end (the source `subscribeToolProgress` capability). The stdio transport now consumes `notifications/progress` for TWO purposes (they were separate, unrelated gaps): the Long Running deadline reset above, and forwarding a renderer-facing event. Each notification is attributed to its tool call by `callId` — notifications carry only the JSON-RPC `requestId`, so the pending request records the callId — normalized with the source formula `progress / (total || 1)` and clamped to 0–1 (the source renders the value directly as `progress * 100`, so an unclamped ratio would overflow its ring). New `onMcpToolProgress` mirrors the existing `onMcpServersChanged` listener pattern (the service owns no window); `cherry-data-api.ipc.ts` broadcasts it as `cherry:mcp:toolProgress` in the source `McpProgressEvent` shape `{ callId, progress }`, matching the source `McpRuntimeService.broadcastToType(WindowType.Main, 'mcp.tool.call_progress', …)`. **`preload.ipcApi.on` was a hard-coded no-op** (`on: () => () => undefined`) — the last missing link, and the reason the capability would otherwise have looked "supported but idle"; it now subscribes `mcp.tool.call_progress` and **throws** on any other event name rather than returning a silent no-op unsubscribe, because the source treats a missing unsubscribe as an absent capability and would hide the control. The compat entry supplies `MessageListActions.subscribeToolProgress` to `MessageContentProvider`, so the real source `MessageMcpTool` drives its `CircularProgress`. `AgentToolContext` gained `toolCallId`, populated from `call.callId` at both execute sites (`ai-sessions.ipc.ts` and `agent.ipc.ts`) — the same id persisted on `tool-finished` and on the tool message, i.e. the renderer's join key. Tests: 2 new (attribution incl. a notification for a different request id being rejected, the no-total fallback, the clamp, and the no-callId case emitting nothing). Live-verified in the running app: `window.api.ipcApi.on` is a real function, `subscribeToolProgress` returns a working unsubscribe, and an unbridged event name THROWS (`cherry ipcApi.on 未桥接事件：…`) instead of silently accepting. Delivery itself is covered by the service/IPC tests rather than a live end-to-end run, which would need a real progress-reporting MCP server fixture.
- Cherry MCP detail-form fields completed (schema v25, additive + backed by a pre-migration backup): the three fields that were previously rejected as "no Grimoire column" now have both a column and a real runtime consumer. **`longRunning`** drives the tool-call timeout policy mirroring the source `resolveMcpRequestOptions` (`source/src/main/ai/mcp/mcpRequestOptions.ts`): the per-request deadline is extended on each `notifications/progress` notification, bounded by a 10-minute absolute ceiling, and the stdio read loop now arms/clears deadlines per pending request (it previously had **no timeout at all**). **`registryUrl`** is injected into the stdio launch env by the runner table (source `RUNNERS`): `NPM_CONFIG_REGISTRY` for `npx`/`bunx`, `UV_DEFAULT_INDEX`+`PIP_INDEX_URL` for `uv`/`uvx`, any other command gets nothing — and the user's own `env` map always wins over the derived value. **`tags`** flow into the source list's own search target (`${name} ${description} ${tags.join(' ')} ${provider}`), which needed no renderer change once the projection emitted them. `MCP_FIELD_UNSUPPORTED` now covers only identity/timestamps (`id`/`createdAt`/`updatedAt`); every other config field the source schema declares is stored or echoed-only. Tests: 5 new (long_running round-trip incl. explicit `false`, blank-tag filtering, the runner mapping incl. non-runner commands, registry env precedence, and the Long Running progress-reset with a **control case** — the same slow server without the flag still times out at 1s), plus 2 schema-v25 migration tests. Verified live: flipping 长时间运行模式 in the mounted source form and saving reads back `longRunning: true` through the real DataApi transport.
- Cherry system font enumeration (DIRECT_REUSE + ADAPTER): `system.get_fonts` previously answered `[]` as a placeholder, which left the appearance page's 全局字体/代码字体 pickers showing only their own defaults. It now uses the **same `font-list` package at the source's declared version `2.0.0`** with the source handler's exact normalization (`replace(/^"(.*)"$/,'$1')`, `filter(length > 0)`) and its `[]`-on-failure contract, so names, ordering and the Windows PowerShell path match upstream. New `src/main/services/system-fonts.service.ts` memoizes (the Windows path spawns PowerShell and the page requests fonts per mount), shares one in-flight enumeration between concurrent callers, logs-and-degrades on failure, and never caches a failure so the next call retries. `font-list@2.0.0` (MIT) added to the root manifest with npm — `npm install` surfaced a **pre-existing, unrelated** peer conflict (`@ant-design/pro-components` wants `antd@^5`, root has `antd@6.6.3`), so the install used `--legacy-peer-deps` and was verified to add exactly one package with no other manifest churn. Live-app evidence (not just unit tests): the route returns `{ok:true, count:218}` through the real IPC path and the 全局字体 picker opens with 219 options (`默认` + 218 real families), each previewed in its own typeface — `artifacts/visual/populated/appearance-font-picker.png`. 6 new unit tests; root suite now 84 files / 417 tests.
- Cherry provider deep-link import verified end-to-end: the capture route `settings/provider?addProviderData={…}` renders the source `UrlSchemaInfoPopup` confirm dialog with the imported name/provider-ID/base-URL/API key over the dimmed settings page (`artifacts/visual/populated/route-diagnostic-dialog.png`). The import is confirm-gated by the source (`useProviderDeepLinkImport` awaits the popup before `createProvider`/`updateProviderById` + `POST /providers/:providerId/api-keys`), so a run ending before confirmation is correct behaviour rather than a dropped payload. `endpointConfigs` is now protocol-keyed instead of hard-coded to `openai`, which had stranded a `responses`-protocol provider's base URL; `POST /providers/:id/api-keys` writes through `encryptKey` and returns the parent provider with 201. Visual capture gained route diagnostics (`route-diagnostic.json`, `route-diagnostic-matrix.json`, `route-diagnostic-dialog.png`) because screenshots alone cannot separate "never opened" from "opened but invisible" — exactly how the stylesheet bug hid. Gates this slice: root `npm test` 83 files / 411 tests passed; compat `vitest run` 10 files / 55 tests passed; compat typecheck clean; `npm run build` exit 0 with zero TS errors; `npm run check:cherry-css` 98.6% (threshold 90%).
- Compat suite flake, second sighting (2026-10-10): a single compat test failed once when the suite ran immediately after a full `npm run build`; 8 subsequent runs — including 3 with builds running concurrently — passed, and the recorded output did not name the failing test. Not reproducible, and NOT attributed to a specific cause. The most likely candidate is the same class of problem as the earlier flake (a `findBy*`/`waitFor` with the default 1s timeout inside a long sequential chain, in `CompatProviderMcpPanel.test.tsx` "pulls models with the saved key…"), but that is a hypothesis, not a finding — I am not editing a test I have not seen fail with a diagnosis. Recorded so a future sighting has this one to compare against.
- Compat test flake fixed (observed once in six runs, then 13 consecutive passes): `CompatProviderMcpPanel.test.tsx` "keeps stale pull results from the previous provider out of the current selection" resolved its deferred pull and flushed with a single `setTimeout(0)` before a **negative** assertion. One macrotask turn is not a proof that a stale update will not arrive — under load the update this test exists to catch can land after the assertion, so the run passes or fails by timing. The test now re-settles on the observable state (`combobox` value `p2`) before draining two turns. Mutation-checked: inverting the assertion to `not.toBeNull()` fails the test, so it still catches the stale-result bug it guards and is not passing vacuously.
- Cherry native message-part projection: `src/vendor/cherry/compat/src/part-projection.ts` replaces the Markdown-lowering `toMarkdownPart` — Grimoire parts now project onto the AI SDK v6 shapes the source renderer drives its real blocks from: `text`/`reasoning`/`file`, `data-code` (source CodeBlock), `data-error` (source ErrorPartView), and tool call/result/MCP parts as `dynamic-tool` with `toolName`/`toolCallId`/`state`/`input`/`output`/`errorText` so source `buildToolResponseFromPart` and `MessageTools` render them instead of a code fence. 4 projection tests; compat suite now 4 files / 16 tests.
- Cherry preference projection: `src/vendor/cherry/compat/src/shims/preference-service.ts` replaces the source `@data/PreferenceService` (aliased for both `@data/PreferenceService` and `@renderer/data/PreferenceService` import paths) because the Grimoire preload has no `preference` bridge. It keeps the source singleton surface (`get/getMultipleRaw/getMultiple/set/setMultiple/subscribeChange/subscribeAllChanges/getCachedValue/isCached/preloadAll/preload/isFullyCached/clearCache`), loads Grimoire settings once, re-reads on the existing `db.onRefresh` broadcast, maps `app.language` ↔ Grimoire `language` (`zh`↔`zh-CN`, `en`↔`en-US`), persists Cherry-only keys as JSON in the existing settings table under `cherry_pref.` (additive, no schema change), and falls back to the real source `getDefaultValue` for unknown keys. Unknown-language values still fall through with a default (`en-US`) as before. 6 shim tests; compat suite now 5 files / 22 tests. Pre-existing sessions logged `Preference API not available` 12 times; after this slice the current session logs 0 preference errors and 0 error/warn records.
- Cherry session manual reorder: new pure module `src/main/services/resource-order.ts` (fractional base-36 order keys, midpoint insertion, `evenlySpacedKeys` rebalance, `hasRoomBetween`) with 6 tests. `ai-session.service.ts` gains `reorderAiSession({ id, overId, position: 'before'|'after'|'last' })` matching the source item drop payload, a `manualOrder` list mode, and one-shot scope rebalance when two anchors have no room; only the moved row is written on the normal path. IPC `ai:session:reorder` + preload `sessions.reorder` + Host contract + `list({ manualOrder })` are wired. The compat session list keeps source grouping by default and switches to a single-group draggable list only in the explicit manual mode (source rejects drops in time mode), with the header toggle and the `onReorder` payload forwarded from the real source `VirtualDraggableItems`. Host suite 69 files / 292 tests; compat 5 files / 24 tests.
- Cherry tool-approval bridge: `part-projection.ts` gains `permissionToApprovalPart` (Grimoire pending permission → AI SDK v6 `dynamic-tool` with `state:'approval-requested'`, `approval:{id}`, `toolCallId = requestId`), and the compat entry subscribes `host.permissions.onRequest`, injects the synthetic part into the newest assistant message, renders the source `PermissionRequestComposer` (found via source `findNextPendingPermissionRequest`), and answers through the existing `host.permissions.decide` (`allowOnce`/`deny`); terminal turn events and resolution clear the card.

## Cherry implementation update

- Cherry Studio 2.1.4 source closure was expanded from the initial chat subset to 8,084 vendored files under src/vendor/cherry/source, including renderer components, pages, routes, windows, locales, shared data, main references, UI, aiCore, Provider Registry, and SDK source.
- CherryHostBridge now provides typed renderer access for Chat, Session, Assistant, Topic, Provider, Model, MCP, Settings, Attachments, Context, Media, Permission, Runtime, Window, and domain capability status.
- Message parts and runtime events now include code, attachment, agent-status, MCP, tool progress, recovery, compaction, permission, reasoning, and streaming states.
- AI persistence tables remain the schema-19 assistant/topic baseline; schema version 20 adds the additive Cherry resource-state projection, lifecycle IPC, preload methods, and service tests; schema version 21 adds the tag-data repairs (prompt asset keys, tag usage backfill, relation direction normalization).
- The existing Agent workspace now consumes the Host Bridge for sessions, models, runtime status, permissions, attachments, media, and message sending while preserving the legacy UI switch.
- Cherry source files remain isolated from the Grimoire root manifest. The compatibility manifest records the resolved source slice dependencies and pins the Mux transitive versions required by the available registry mirror.

## Architecture update

- The layered Grimoire Core boundary is now recorded in SPEC.md and DECISIONS.md.
- UI/runtime independence is an explicit rule: renderer code consumes ChatEngine and normalized events rather than concrete Pi/OpenCode/Codex implementations.
- Pi kernel behavior, OpenCode advanced policy, Dockview Workspace infrastructure, domain services, and the unified Tool Registry now have explicit ownership boundaries.
- This documentation update does not advance any migration row to a completion status; implementation parity still requires source evidence and the three milestone gates.

## PARTIAL / BLOCKED

- Function-level source inventory is not complete for the expanded full-product closure.
- Actual license audit is not complete for every source project.
- Cherry compat dependency audit (2026-10-10): all 132 direct dependencies resolved; 96 MIT, 15 Apache-2.0, 3 ISC, 2 BSD-3-Clause, 3 dual-license (`jszip` MIT OR GPL-3.0-or-later, `dompurify` MPL-2.0 OR Apache-2.0, `pako` MIT AND Zlib) — all chooseable/permissive, no copyleft-only package. The vendored `source/LICENSE` is AGPL-3.0 while `source/packages/{ui,aiCore,provider-registry,ai-sdk-provider}/package.json` each declare `"license": "MIT"`; **resolved 2026-10-10** — see THIRD_PARTY_NOTICES.md. AGPL-3.0 governs (it is the only license TEXT in the tree; the MIT fields have no license file behind them, and those packages are source-aliased and inlined into the AGPL bundle rather than consumed as external dependencies). MIT is compatible in that direction, so the obligation is a NOTICE — which now also ships (`extraResources`).
- Cherry full-closure dependency audit (2026-10-10, completes the previous 132-direct-dependency audit): the compat project install is the single shared closure — `source/node_modules` is a filesystem junction to `compat/node_modules`, so one virtual store serves both the compat build and the vendored source tree. Transitive sweep of that store: 1,047 distinct packages — 892 MIT, 60 ISC, 44 Apache-2.0 (incl. `@ai-sdk/{gateway,provider,provider-utils}`, `@vercel/oidc`, `@aiden0z/pptx-renderer`, `echarts`), 18 BSD-3-Clause, 10 BSD-2-Clause, 4 MPL-2.0 (`lightningcss` family, build-time only), 3 Apache-2.0 (case variant, `@pierre/*`), 3 Unlicense, 3 undeclared, 2 0BSD, 2 MIT/X11, 1 each MIT-0, Python-2.0, `AFL-2.1 OR BSD-3-Clause` (`json-schema`, chooseable permissive), `MIT OR GPL-3.0-or-later` (`jszip`, MIT branch), `MPL-2.0 OR Apache-2.0` (`dompurify`, Apache branch), `MIT AND Zlib` (`pako`, both permissive). No copyleft-only package. The three undeclared ones: `jstat@1.9.6` ships an MIT `LICENSE` file but no `license` field; `khroma@2.1.0` ships an MIT license file (`The MIT License (MIT)`), no field; `buffers@0.1.1` has neither field nor file, but `npm view buffers` also reports no license and the package is legacy `substack` code — it resolves only through the `exceljs → unzipper → binary → buffers` node-support chain and its distinctive code is absent from the built bundle. 
- Which outside-closure packages actually ship in the compat dist (bundle-verified, not inferred): `mermaid@11.17.2` (MIT) — 18+ chunks, genuinely bundled via `streamdown`/`@streamdown/mermaid`; `exceljs@4.4.0` (MIT) and `jstat@1.9.6` (MIT) — the xlsxParser worker; `monaco`-adjacent previews. Confirmed NOT bundled: `drizzle-orm`, `elysia`, `better-sqlite3`, `sharp`, `@ai-sdk/*`, `@hookform/resolvers`, `quick-lru`, `khroma`, `buffers` (matches: they resolve only from the install for main-process/native paths that the compat renderer bundle never reaches). The remaining 357-dependency note in `CLOSURE_MANIFEST.md` predates this sweep and is superseded by it as a size figure; the AGPL-vs-package-MIT contradiction that used to be listed here is resolved (see the determination above and THIRD_PARTY_NOTICES.md).
- A repeatable audit script lives at `scripts/audit-cherry-imports.mjs` (read-only): it walks the vendored closure, extracts bare specifiers with line-scoped import matching, and reports resolvable vs unresolved packages plus alias-internal specifier counts. Last run: 8,037 files, 1,988 distinct bare specifiers, 1,521 alias-internal, 328 external packages (163 resolvable from the compat install, 165 unresolved — the unresolved set is dominated by main-process-only dependencies such as `drizzle-orm`/`better-sqlite3`/`winston`/`sharp` and workspace aliases like `@test-helpers/*`).
- Dockview package-level MIT licenses are now present in the vendor; production adapter parity remains incomplete.
- TagMaster license provenance is unresolved because no root LICENSE was found.
- The Cherry chat vertical slice is now production-loadable through a dedicated window, but full product integration and parity verification remain incomplete.
- Cherry source test suite is retained but remains BLOCKED as a standalone suite until its original workspace aliases, jsdom setup, and dependency closure are restored.
- Vendored Cherry source tests are intentionally excluded from the host Vitest suite until their original workspace dependencies, jsdom setup, and aliases are restored in a dedicated test project.
- Dockview source tests are intentionally excluded from the host Vitest suite until the Dockview monorepo tsconfig and package test setup are restored in a dedicated test project.
- Infinite Canvas source tests are intentionally excluded from the host Vitest suite until snapshot fixtures, agent-instructions files, and the source dependency closure are restored in a dedicated test project.
- Full OpenCode/Pi source parity is not audited.
- OpenCode/Pi source closures are vendored, but runtime integration parity is still incomplete. Milestones 0/1/3 now have a main-only pending-safe runtime lease pool, explicit capability ledger IPC, fail-closed unknown native-action mapping, turn admission, sender-bound permission broker, and validated main-owned runtime provenance/branch isolation; Pi SDK has a feature-gated adapter but RPC remains the default. These are infrastructure evidence, not full parity. Production OpenCode 1.18.34 adapter smoke now passes provider-backed text over three turns (same native session twice, reopened reference once) using `/api/session` identity plus legacy `/event`/`/session/:id/message`; the v2 `/api/session/:id/wait` route returns 503 for HTTP-created sessions and remains explicitly unavailable. Separate production approval smokes now pass native bash allow-once and deny; the broker has exact sender/session/action/input grants and clears idle session grants without trusting native process-global `always`. Pi RPC, Pi SDK gated runtime, packaged ESM surface loading and full host regression/build/pack gates pass. OpenCode durable cursor/reconnect remains BLOCKED because the v2 route filters to `SessionEvent.Durable` while the working legacy loop emits V1 live events; recovery remains NOT_IMPLEMENTED because no runtime emits a source-backed recovery event. Full source parity remains open.
- Electron visual E2E remains environment-dependent; the current host smoke check reached the Grimoire window and fixed an existing Agent Workspace missing-import runtime error, but screenshot baselines are not yet recorded.
- Infinite Canvas snapshot roots still need enumeration because neither snapshot uses a top-level src directory.
- Infinite Canvas roots are now enumerated; production parity audit against both snapshots is still pending.

## Next actions

1. Visual baseline infrastructure is now wired (`scripts/visual-baseline.mjs` + `src/main/visual-capture.ts`, env-gated, real-service fixture, 1280×800/1920×1080 × zoom 1/1.25/1.5 × light/dark, populated + empty = 24 screenshots in `artifacts/visual/`); remaining: commit the baselines as regression references once the final gate order permits, and add per-state runs (loading/error) only if a non-breaking injection path appears. The first run surfaced and fixed three real product bugs (missing `CodeStyleProvider`/`ThemeProvider`/`CommandContextKeyProvider` composition, undeclared `lru-cache` dependency, incompletely stubbed logger shim).
2. Continue replacing the compatibility resource pane with remaining source Session/Assistant/Topic/ResourceList actions; session/assistant/topic anchored reorder, source-parity pin optimism (`useResourceListPinnedState`), source-parity resume (`/latest` endpoints), source-parity active replacement (`pickNeighbourAfterRemoval`), the source context-menu registry (filtered to the Grimoire-backed allowlist) and source-parity recycle-bin undo on archive are now wired, while global Topic ownership (cross-assistant topics), import/export, the source-only menu actions and batch undo remain pending or blocked.
3. The source Provider Settings page is mounted at `/settings/provider`, the source MCP list at `/settings/mcp`, the source MCP detail (`McpSettings`) at `/settings/mcp/settings/$serverId` and the source Appearance page at `/settings/appearance`, all full-page with schema v24 backing the MCP form's description/headers/timeout/auto-approve fields (auto-approve consumed by both permission paths as force-prompt) and the `settingsRoute` predicate keeping the surface switch to one place; next: provider deep-link import, a real font-enumeration service for `system.get_fonts`, the blocked settings pages (`general` needs the tray/launch-on-boot/hardware-acceleration/proxy/prevent-sleep/retry/context-compression services; `data` needs app info, cache cleanup, data reset and user-data relocation; `dependencies` needs the binary tool registry; `usage` needs an AI usage-record store), the MCP form fields still without a consumer (`longRunning`, `registryUrl`, `tags` reject loudly instead of silently dropping), and Agent/Tool state blocks. Locale initialization, runtime language switching and the hash route registry are wired.
4. ~~Resolve the AGPL-3.0 LICENSE vs per-package MIT declaration in writing~~ **DONE 2026-10-10** — written determination in THIRD_PARTY_NOTICES.md (AGPL-3.0 governs; the MIT fields are declarations with no license text behind them). The practical MIT obligation — that the notice travels with the code — is now met by shipping `THIRD_PARTY_NOTICES.md` and the Cherry LICENSE via `electron-builder.yml` `extraResources`.
5. Add the remaining Cherry windows and product routes while preserving blocked states for unsupported backends.
6. Keep full-product completion blocked until source parity, multi-window entrypoints, locale loading, visual baselines and the three migration gates pass.

## Tag/Gallery migration wave A (2026-10-09)

- This session paused its Cherry-related work (the agent direction is owned by a parallel session) and started the six-reference tag/gallery migration: BooruDatasetTagManager (MIT), TagMaster (UNLICENSED behavior-only), TagStudio (GPL-3.0 data-model reference), SD Image Sorter (MIT), Hydrus (WTFPL), Allusion (license conflict -> conservative GPL, UX reference only).
- Schema v21 (additive, marker-guarded): prompt asset key repair, tag_usage backfill, child->parent direction normalization, idx_tag_relations_type; startup count guards for the tag/media projection migrations replace steady-state full scans.
- New services: tag-query.service.ts (no-amplification search, relation closure, descendant expansion), tag-asset-query.service.ts (tag->asset any/all/none query + batch link reads), tag-group-copy.ts (metadata/aliases/relations roundtrip with fresh id map and skip counters).
- IPC/preload additions: tags:searchAdvanced / tags:expandRelations / tags:assets:query / tags:assetLinks:listBatch; suggestions.batchResolve exposed; prompt-asset-browser writer fixed to 'prompt:'+id.
- Verification this wave: npm test 58 files / 202 tests passed (12 new tests across database.v21, tag-query.service, tag-asset-query.service, tag-group-copy); npm run build:main passed; npm run build passed (cherry-compat + renderer + main); touched files clean under tsc --noEmit for both configs. Interactive Electron smoke for wave A data flows is deferred to the wave B UI pass so no Electron instance is launched while the parallel session is active.
- Next waves: B tag editing/weights/batch/autocomplete UX (BDTM ports + TagMaster behavior), C gallery data layer (SDIS metadata parsing/query/thumbnails, schema v22), D gallery UX + deep search (Allusion UX + Hydrus predicates, schema v23), E search-syntax formalization and full regression.

## Tag/Gallery migration wave B (2026-10-10)

- Prompt weight core ported from BooruDatasetTagManager PromptParser (MIT): `src/shared/tag-prompt-core.ts` implements bracket multipliers (×1.1 / ÷1.1), explicit weights, BREAK separators, duplicate delta-sum merge and byte-compatible serialization; prompts.store delegates parsing/serialization to it and gains `stepWeight` + `impliedExcluded`; PanelTag gained an optional `breakBefore` field (additive).
- TagMaster-behavior UX (clean-room, zero code copied): two-stage tag autocomplete (`useTagAutocomplete` + `TagAutocomplete`, 250ms debounce, race dropping, IME-safe Enter, alias/usage badges); three-state implied display in TagCards (dashed indeterminate, click-to-promote) and the `ImpliedTagStrip` with per-tag exclusion backed by `expandRelations`.
- Batch tag suite (BDTM operation set + SDIS dry-run safety): `tag-batch.service.ts` preview/apply for add/remove/replace with any/all/none filter, onlyEmpty registry scope, chunked writes and over-count confirmation; new workspace panel type `tag-batch` (TagBatchToolsPanel) registered in panelTypes/PanelRegistry/popout allowlist.
- WD14 pending-candidate batch actions (accept ≥70% / reject all) and ImagesPanel bulk-tag picker upgraded from raw tagId input to TagAutocomplete; `suggestions.batchResolve` is now exposed through preload.
- Verification this wave: npm test 62 files / 224 tests passed (22 new tests across tag-prompt-core, prompts.store, autocomplete hook/component, tag-batch service); npm run build:main passed; npm run build passed; wave-B files clean under tsc --noEmit for both configs (remaining renderer errors belong to the parallel session's canvas/agent WIP).
- Interactive Electron smoke for waves A+B UI still to be run together with wave C so no Electron instance clashes with the parallel session; wave C (gallery data layer, schema v22) is next.

## Tag/Gallery migration wave C (2026-10-10)

- Schema v22 (additive, marker-guarded): image_refs width/height/file_mtime, image_generation_metadata.origin, asset_tag_links.asset_ref_id + idx_asset_tag_links_ref; one-time backfills for numeric image keys and ComfyUI provenance; new link writes maintain the projection via upsertAssetTagLink.
- New modules (three parallel subagents + main-session schema/wiring): media-metadata.core.ts / media-metadata.service.ts (A1111/NAI/ComfyUI/PNG-chunk/EXIF parsing, COALESCE persist, scan with progress; 29 tests); thumbnail.service.ts (serial dedupe queue + chunked batch dataURL reads; 12 tests); gallery-query.service.ts (search/source/favorite/rating/tag any-all-none/includeImplied, whitelist sorts, parameterized LIKE; 8 tests) + scripts/bench-gallery.mjs.
- Wiring: media:query / media:thumbs:list / media:metadata:parse / media:metadata:scan / media:scan:progress / media:batchPreview handlers and preload/global.d.ts surface; import-time dimension probe in registerManagedImage/images.ipc plus fire-and-forget metadata parse on managed/external/pasted imports.
- Performance evidence: bench-gallery 10k assets p95 9.4ms; 100k assets p95 42.0ms (gate <500ms); EXPLAIN shows no SCAN of asset_tag_links.
- Verification this wave: npm test 68 files / 283 tests passed; npm run build:main passed; npm run build passed; wave-C files clean under tsc --noEmit for both configs. Interactive Electron smoke for waves A-C UI (metadata auto-parse on import, WD14 batch, batch tools) is still outstanding and is scheduled together with wave D.
- Next: wave D (gallery UX: VirtualGrid/FilterRail/Inspector/SavedSearches, WD14 upgrades, HoverPreview extraction, schema v23 saved searches) then wave E (search-syntax formalization + full regression).

## Tag/Gallery migration wave D (2026-10-10)

- Schema v23 (additive): tag_saved_searches (pinned-first index) plus saved-search service (tags:savedSearches:list|save|delete IPC, preload + global.d.ts) and the SavedSearches UI.
- New gallery experience as additive panel type gallery-search: GallerySearchPanel host composing FilterRail (source/favorite/rating/tags), GalleryToolbar (debounced search, sort, selection, save search), VirtualGrid + GalleryCard (200px base width, overscan windowing, selection ring, badges, keyboard), InspectorPanel (parsed generation parameters, tag editing via TagAutocomplete, copy prompt / reveal file / retag actions). Legacy ImagesPanel intentionally untouched.
- Shared support: gallery.store.ts (query state, explicit/allFiltered selection tokens, saved-search bridge; 4 tests), lib/virtual-grid.ts (pure layout math; 9 tests), 4 jsdom VirtualGrid tests, 9 toolbar/rail/saved-search tests, saved-search service 2 tests.
- WD14 upgrades: status filter chips, per-history multi-select with batch retag through the existing task API (skip reporting), open-original via new system:showItemInFolder IPC, success/failure + model badges, history detail FloatingPreview with tag buckets; inline 500ms hover replaced by the shared HoverPreview (6 tests, 499/500/hide-delay/scroll-resize/cleanup).
- Verification this wave: npm test 75 files / 329 tests passed; npm run build:main passed; npm run build passed; wave-D files clean under tsc --noEmit for both configs.
- Outstanding: interactive Electron smoke for waves A-D (metadata auto-parse, batch tools, gallery panel, WD14 batch) still pending; wave E (search-syntax formalization + full regression + matrix closeout) is next.

## Tag/Gallery migration wave E (2026-10-10)

- Search syntax delivered as a clean-room subset: shared pure parser (tag-search-syntax.ts, 22 tests) + gallery compiler with injected resolvers (gallery-query-builder.ts, 11 tests) + SyntaxQueryBar with predicate chips and per-construct diagnostics; tag:/parent:/namespace:/name:/source:/favorite:/rating ranges/sort/order/limit, quoted strings, -/NOT, AND/OR, parentheses, [key=value].
- Backend: gallery tagFilter gains excludeTagIds (parameterized NOT IN, independent of includes; include∧exclude, exclude-only and none-coexistence covered by a new service test); tags:expandRelations gains direction 'descendants' for parent substitution; store toBackendQuery passes excludeTagIds; pageSize (limit:) applied at the store root.
- Saved search import/export through the existing dialog save/open IPC (versioned JSON envelope, tolerant array import, skip reporting; +4 tests).
- Six-project seed rows updated with wave A-E evidence only: hydrus and Allusion moved to ADAPTED (search semantics; conservative-GPL UX adaptation), BDTM/TagMaster/TagStudio/SDIS stay PARTIALLY_MIGRATED with named remaining items; no row reaches completion before the Electron functional/visual pass.
- Verification this wave: npm test 78 files / 376 tests passed; npm run build:main passed; npm run build passed; wave-E files clean under tsc --noEmit.
- Outstanding gate: interactive Electron smoke for the whole tag/gallery series (new gallery-search panel, syntax bar, batch tools, WD14 batch retag, import-time parsing). This is the next session's first item; the wave plan itself is complete through E.

## Tag/Gallery functional gate evidence (2026-10-10, post-wave-E)

- Composed functional smoke added: GallerySearchPanel mount test (rail/toolbar/syntax bar/virtual grid/inspector compose, thumbs requested, empty fallback) and a handler-level IPC integration test exercising media:query (tag filters + exclusions), tags:assets:query/batchPreview, savedSearches CRUD, metadata parse and thumbs reads through the real registered handler stack.
- Bounded Electron boot smoke executed (built main + --enable-logging, no dev server of its own): main process boots, single window opens, renderer connects; no boot exceptions from this series. Caveat recorded: unpackaged `electron .` loads http://localhost:5173, so with the parallel session's dev server running the smoke renders their working tree; the run surfaced an in-flight canvas-vendor LocalAgentPanel `useLocation() outside <Router>` error owned by the agent-direction session, not by this series.
- Real user database observation (read-only probe): schema_version 23 at probe time (migrations v21-v23 executed against the real library by an actual app run); the parallel session has since bumped to v24 (MCP server columns).
- Schema test hardening: CURRENT_SCHEMA_VERSION is now exported and the lifecycle/v21/v22 tests pin to the constant instead of literals, so version bumps from either workstream no longer break the other's assertions.
- Final merged-tree verification: npm test 83 files / 407 tests passed (both sessions combined); npm run build:main passed; npm run build passed.

## Tag/Gallery runtime acceptance (2026-10-10, real-app CDP smoke)

- Launched the real Electron app against the built renderer (VITE_DEV_SERVER_URL overridden to the dist index.html file URL) with --remote-debugging-port and drove the live renderer via CDP Runtime.evaluate: 9/9 checks passed — renderer origin is the built dist, window.api surface (media.query / savedSearches / system.showItemInFolder) present, saved-search save→list→delete round trip against the real database, media.query returned the real library (9 images), empty tag filter returned empty, metadata scan processed the 9 real images (0 parsed / 9 skipped — PixPin screenshots carry no generation metadata, correct behavior), thumbs batch returned null-safe keys, assets query and media batch preview responded.
- Window screenshot captured as visual evidence; the only renderer console error during boot belongs to the parallel session's canvas-vendor LocalAgentPanel (`useLocation() outside <Router>`, in-flight agent-direction work), none from this series. The canvas editor's "10s load timeout" note is a harness artifact of the file:// override (canvas.html exists in dist and loads from the dev server in the normal loop).
- Remaining human step: a visual pass of the gallery-search panel opened from the workspace picker; backend chain, panel composition (jsdom) and boot visuals are all covered above.

## Tag/Gallery runtime visual verification (2026-10-10, popout walkthrough + integration fix)

- Real-window walkthrough executed: electron launched against a vite preview server of the built renderer (HTTP override; the file:// override is incompatible with getRendererURL's "/#hash" concatenation, documented as a harness constraint), then the gallery-search panel was opened as a workspace popout via the app's own workspace.openPopout API (layout document untouched) and driven through CDP.
- Result: the panel fully rendered in a real window with live data — syntax query bar (with placeholder), filter rail (reset button), virtual grid with 9 real asset cards, footer "共 9 个 · 第 1/1 页" with pagination/selection/batch controls, empty inspector state, empty saved-search state; popout closed cleanly afterwards.
- Integration defect found and fixed by this walkthrough: new panel types require a FOURTH registration point — VALID_PANEL_TYPES in workspace.store.ts (used by isPersistablePanelType for workspace-document hydration and popout routing); tag-batch/gallery-search were missing there, so saved layouts silently normalized them to the utility-sidebar fallback. Both types are now registered and the workspace-store test asserts them.
- Full gates after the fix: npm test 417 tests passed (both sessions); npm run build:main passed; npm run build passed.

## Cherry data-settings panel audit + path helpers (2026-10-10)

- Audited the whole `/settings/data` surface by walking all THIRTEEN source panels in ONE live window (`#/settings/data?panel=<key>` deep links, `scripts/_probe-panels.mjs`), rather than sampling one panel per launch. Every panel renders its real source component with real labels — no error boundary, no blank column.
- Corrected a false claim in MIGRATION_MATRIX row 72: the cloud-sync panels were recorded as "stay unmounted". They are mounted and render; what is missing is their transport, not their UI. Recorded the distinction and moved the detail into a notes section below the table (the first attempt inserted paragraph breaks INSIDE a table cell, which terminated the table and orphaned eleven rows — caught by the row validator, repaired, re-validated).
- **Joplin / Siyuan / Yuque export are functional end-to-end with NO main-process adapter**: the source writes them as renderer-side `fetch` to a user-supplied URL, the configs persist through the compat preference shim into `cherry_pref.*`, and the renderer fetch reaches localhost (verified with a temporary local server: `REACHED status=200`, consistent with `configureWindowSecurity` setting no CSP `connect-src`). The settings panel, the 检测 button and the exporter are one working chain.
- **Found and fixed a real crash, not a dead button**: `window.api.resolvePath` / `isPathInside` / `hasWritePermission` were `undefined` at runtime. `LocalBackupSettings` calls `resolvePath` from a `useEffect` whenever a backup directory is configured, so the panel rendered on a fresh profile and threw for every user who actually used the feature — the "reported clean while broken" shape again. New `src/main/services/cherry-path.service.ts` implements all three with the source's exact semantics, served over `system.path.{resolve,is_inside,has_write_permission}` and exposed through the preload; 10 tests + a mutation check (inverting equality-fails-containment fails the suite).
- Equality semantics were the subtle part: the closure holds TWO disagreeing `isPathInside` implementations (`utils/file/path.ts` documents equality-false, `utils/legacyFile.ts` returns equality-true) and `ipc.ts` imports the legacyFile one, so equality-true is what the renderer observes — and an equality-false helper would let a user point a backup directory AT the app-data directory the check exists to exclude.
- Live round-trip verified in a real window (existence is not behaviour): `~`→`C:\Users\Administrator`, `C:/a/../b`→`C:\b`, equality→`true`, sibling-share-prefix→`false`, `..`-escape→`false`, writable→`true`.
- Remaining BLOCKED, with the unblocking condition named: 本地备份/WebDAV/坚果云/S3 primary actions need a Grimoire backup-adapters layer. The source's `LegacyBackupManager` (2,276 lines) IS in the closure but archives Cherry's own userData layout (`IndexedDB/`, `Local Storage/`, `cherrystudio.sqlite`) plus a drizzle restore journal, so it cannot be pointed at Grimoire's SQLite; its `webdav` / `@aws-sdk/client-s3` / `@aws-sdk/lib-storage` deps are absent from both manifests. 坚果云 additionally needs `window.api.nutstore.*` over the source's `.mjs` WASM SSO closure; Notion pulls `@notionhq/client` in the renderer.
- Verification: `npm run build` passed; `npm run build:main` passed; cherry-path suite 9 passed / 1 platform-skipped; matrix validator reports no malformed rows (87 checked); `tsc --noEmit` reports 39 errors, ALL pre-existing in unrelated files (`canvas-vendor/*`, `AgentWorkspacePanel`, `cherry-host-bridge`, `workspace-engine`) — none in a file this work touched.
- Two ad-hoc probes from this audit were promoted into permanent, reusable gates rather than deleted: `npm run check:migration-matrix` (`scripts/check-migration-matrix.mjs`, per-table width check + `--dump LINE` to print a row's cells with every pipe marked ESCAPED/BARE, mutation-checked against a deliberately corrupted row) and `npm run audit:cherry-panels` (`scripts/audit-cherry-panels.mjs`, one-launch walk of all thirteen panels + runtime API surface + path-helper round trip, exiting non-zero when a panel fails to render). The panel audit needs a prior `npm run build` — the window loads the compiled `dist/preload/index.js`, so a preload edit reports `undefined` here until the build runs; that is a harness property worth knowing before trusting a stale result.

## Cherry route-registry gap + /settings/notifications mount (2026-10-10)

- Challenged the BLOCKED records for the remaining source windows and found the framing was incomplete rather than wrong: the source ships **56 route files** (41 under `routes/settings`, 15 under `routes/app`) but the compat registry implements **8** route ids. Most of that distance is a **route-registry backlog inside the window that IS connected**, not a window-lifecycle problem — and WINDOW_MATRIX only covered `WindowType`s, so it was silent about it. New section in `.agent/WINDOW_MATRIX.md` records the per-page reachability and the correction below.
- Corrected one of my own measurements: a scan matching page imports by filename reported seven settings pages as MISSING. Most exist as **directories** (`ProviderSettings/`, `AboutSettings/AboutSettings.tsx`, …). The registry gap is real; that particular measurement was not, and the corrected table says so.
- **Mounted `/settings/notifications`** as the cheapest genuine page (91 lines, sole dependency `useMultiplePreferences`) to validate the route-mounting path end to end before larger pages: registry entry, lazy import, dispatch branch, sidebar button, `settingsRoute` predicate and title all wired; `route-registry.test.ts` extended to cover the data-settings family (those routes shipped unasserted, so a registry edit dropping one would have failed nothing).
- Verified live, not by import scan: all ten registered routes render with the "路由未实现" fallback absent and no error boundary (`npm run audit:cherry-routes`, new permanent gate). The 通知 nav button is present and clickable (36×24), click navigates the hash and the 通知设置 heading renders. It had merely wrapped below the screenshot's visible fold — checked by clicking it rather than by looking at the image.
- Honest status for the page is PARTIALLY_MIGRATED, not ADAPTED: the five `app.notification.*` toggles persist through the compat preference shim, but **nothing consumes them** — Grimoire has no notification dispatcher, so 备份/知识库/应用更新/对话完成 notifications are stored preferences with no effect. Unblocking condition: a notification source registry reading the same keys, with the source's `NotificationSource` union as the contract.
- Next mountable in the backlog, in order: `AboutSettings` (one real route plus an updater refusal), `PromptSettings` (no detected API use — needs runtime verification, not an import scan). `ArchiveSettings` is the highest-value target but needs the DataApi `/archives` route, which is **not in the vendored closure**; `cherry_resource_state` already carries `archived`/`deleted_at`, so the storage exists and the projection is what is missing.
- Verification: `npm run build` passed; `npm run audit:cherry-routes` 10/10 routes rendered; compat `vitest` route-registry 10 tests passed; `npm run check:migration-matrix` 88 rows, no malformed.

## /settings/about mount + two audit-gate defects (2026-10-10)

- **Mounted `/settings/about`** (second-cheapest page: renders the real Cherry branding, `app.get_info` version `v7.2.0`, 自动更新/测试计划 toggles, and the 帮助文档/更新日志/官方网站/意见反馈/企业版/邮件联系/加入我们/调试面板 rows — verified in a screenshot).
- Mounting it surfaced a **real hard blocker, found by running it rather than reading it**: `AboutSettings` crashed the whole page with `useTabsContext must be used within a TabsProvider`. Cause traced to exactly one file three levels down — `useOpenReleaseNotes` calls `useTabs()`, which reads the source tab shell's context. `TabsProvider` itself was deliberately NOT mounted: it owns the tab bar (tab LRU/dormancy, drag reorder, detach/attach, `AgentBrowserRuntimeHost`, conversation-navigation ownership), which is app-shell infrastructure the compat window replaces with its hash route registry — mounting it to satisfy one navigation call would have introduced more unmigrated state than it removed. Added a narrow shim (`shims/use-open-release-notes.ts`) that navigates to `#/app/release-notes`, the route the tab would have opened. Two new routes: `system.toggle_dev_tools` (toggles the CALLING window's devtools, matching upstream's sender-scoped behaviour — this is the 调试面板 row) and `app.updater.check_for_update`, **refused** with `NOT_IMPLEMENTED` because the source route returns `void` and is driven by `app.updater.*` push events; returning `ok` would leave the update row spinning forever. Verified the refusal surfaces honestly: clicking 检查更新 raises the source's own `更新出错` toast.
- **Two defects in my OWN audit gates, both reported as product failures.** (1) The route audit hung instead of failing when a page crashed: it awaited `setTimeout` INSIDE the page, and an error-boundary crash left that promise permanently unsettled. Waits now happen on the Node side, with a hard timeout on every CDP call. (2) The real cause of the persistent `/settings/about` FAIL was the audit's own environment: it launched with `GRIMOIRE_VISUAL_CAPTURE=1`, which makes the app run its viewport/theme matrix and then `app.quit()` on a timer — so the audit raced the app's self-termination and whichever route was in flight when it quit got no response. **The signature that gave it away was that the failure followed the LAST POSITION, not the route**: About failed last, and after moving About to position 2, notifications failed last instead. No page was ever broken. Both audits now launch with `GRIMOIRE_OPEN_CHERRY=1` (opens the window, leaves it open) and both pass: 11/11 routes, 13/13 panels, exit 0.
- Also fixed a latent defect in the shared CDP helper while diagnosing: per-call listeners with `Math.random()` ids. Over a run's ~40 round trips the ids collide, and any call that timed out never removed its listener. Replaced with one dispatcher over a pending-request map plus a monotonic id counter. This was a real bug in the gate even though it was not the cause of the About failure.
- Verification: `npm run build` passed; `npm run audit:cherry-routes` 11/11 exit 0; `npm run audit:cherry-panels` 13/13 exit 0; compat route-registry 11 tests passed; `npm run check:migration-matrix` no malformed.

## /settings/prompts mount + leaked-Electron root cause (2026-10-10)

- **Mounted `/settings/prompts`** — the highest-value page in the settings backlog for this app, since Grimoire's core domain IS prompt management. The source page reads `/prompts` + `/prompt-bindings` through the DataApi; Grimoire's real library is `prompt_assets` (**1,742 rows on this machine**, 512 categories), read through the same `queryPromptAssets` service its own panels use. Verified live against the real library: the page renders actual user prompts with names, content previews, 全局 visibility badges, drag handles and per-row menus — not the empty state.
- Three fields in the source `Prompt` schema have **no Grimoire column**, and each is mapped rather than invented (recorded in code and DECISIONS): `visibility` → always `'global'` (Grimoire shares all assets, so `'restricted'` would hide prompts that are usable); `orderKey` → synthesised zero-padded position, because inventing a *meaningful* order would silently reorder the list relative to Grimoire's own panels; `id` → passed through **unchanged** even though Grimoire ids are `builtin_<hex>`, not UUIDs, because the id is the only handle back to the real asset and a synthesised UUID would break every mutation while looking correct.
- Reads are real; writes are **refused** with `NOT_IMPLEMENTED`: Grimoire's prompt-asset service has no update operation at all, so create/patch/delete would have to invent storage and desync from the library the user's own panels read. Bindings answer an empty list rather than refusing — an empty list is TRUE (Grimoire binds no prompt to any target) and the page renders its unbound state from it.
- **Root cause of a bug that looked like a product failure**: `/settings/prompts` reported `路由未实现` in full-suite runs while passing in isolation. The audit was connecting to a **stale app instance** — `child.kill()` signals only the `npx` launcher, so every run leaked a whole Electron tree (parent + renderer/gpu/utility) still holding the DevTools port. The next run's CDP lookup then attached to the OLD instance running the OLD bundle. **70 orphaned Electron processes had accumulated** from this session's probes. Fixed with a scoped teardown that kills the tree by this run's `--user-data-dir`, so a parallel session's Electron is never touched. Verified: two back-to-back runs both 12/12, zero processes left after each.
- The same pattern had caused the earlier "About fails, always last" bug — that one was the app self-quitting under `GRIMOIRE_VISUAL_CAPTURE`, and I had attributed it to that alone. Both were real; this one would have kept producing phantom failures on any newly added route.
- Also corrected in this pass: the blocked-route message is now **derived** from `COMPAT_ROUTE_PATHS` (`COMPAT_SUPPORTED_PATHS`) instead of a hand-written literal that had gone stale three times. The first test written for it was a **tautology** — it compared the derived list to the object it was derived from, and a mutation check proved it could not fail. It was deleted and replaced with assertions derivation does not guarantee (no duplicates; every listed path actually resolves; the list length matches the map). The length check was then mutation-verified by filtering a real path out of the derivation, which fails it.
- Verification: `npm test` 458 passed; compat 71 passed (route-registry 13, up from 10); `npm run build` passed; `npm run audit:cherry-routes` **12/12 exit 0** (twice, back to back); `npm run audit:cherry-panels` 13/13 exit 0; `npm run check:migration-matrix` no malformed.

## Archive + GeneralSettings blocked-verdict audit (2026-10-10) — two of my own claims were wrong

- Went back over the BLOCKED rows in `WINDOW_MATRIX.md` the way the data-settings row needed it, and **two of my own recorded reasons were wrong**. Both had the right outcome for the wrong reason, which is the failure mode that misleads the next session into building the wrong thing.
- **`/archives` IS in the vendored closure.** I had written "the `/archives` route is not in the vendored closure" and used that as the blocker. It exists — `main/data/api/handlers/archives.ts` (thin, 6 lines) over `data/services/archive.ts` (47 lines, a 6-domain `UNION ALL`). My grep was too narrow: I searched `src/main/data/api/*.ts` and `src/shared/data/api/*.ts` rather than the handler directory. Corrected in WINDOW_MATRIX with the correction itself recorded, not silently fixed.
- **The real `ArchiveSettings` blocker is a semantic mismatch, not a missing route.** `listArchives` filters `deleted_at IS NOT NULL` — it is a **soft-delete recycle bin**. All three Grimoire deletes are **physical `DELETE FROM`** (`deleteAiSession`, `deleteAiAssistant`, `deleteAiTopic` all run `DELETE FROM …` and drop the `cherry_resource_state` row). Mounting the page over that mismatch would render a permanently-empty recycle bin whose 永久删除 button reports success for rows that are already gone. `cherry_resource_state.archived` — a *different column* from `deleted_at` — IS backed and is what the session/topic/assistant archive lifecycle already uses; that is why "archive" appears to work elsewhere while this page would not.
- **`GeneralSettings` needs no missing services.** Its only bridge call is `window.api.application.relaunch` (already implemented) and everything else is `usePreference`; `ModelSelector` is already shimmed. The page could mount today. It stays **BLOCKED deliberately**, and the accurate reason is that **no Grimoire main-process service consumes those keys** — `app.launch_on_boot`, `app.power.prevent_sleep_when_busy`, `app.fetch.allow_private_network`, `app.developer_mode.enabled`, `app.proxy.*`, `chat.retry.*`, `chat.context_settings.*` each have **0 references in `src/main/`**. Mounting would render ~20 toggles that persist and do nothing. The route already renders an honest BLOCKED diagnostic which lists this correctly; only the matrix row's *reason* was wrong.
- Re-verified the two adjacent BLOCKED rows and found them **correct**: `UsageSettings` reads `/ai-usage-records{,/stats,/timeline}` and Grimoire has no usage-record store; `ShortcutSettings` calls `window.api.shortcut.onRegistrationConflict`, which is not bridged.
- No production behaviour changed in this pass — it is a record correction. The value is that both wrong reasons pointed at *building infrastructure that already exists* (`/archives`) or at *a blocker that is not real* (GeneralSettings' "seven services"), either of which would have wasted the next session.
- Verification: `npm run check:migration-matrix` 90 rows clean; `npm run audit:cherry-routes` 12/12; `npm run audit:cherry-panels` 13/13; no leaked Electron processes.

## Prompt writes + a real id-mapping bug, and two corrected blocked verdicts (2026-10-10)

- **Corrected my own over-broad refusal.** I had recorded "prompts writes are refused" citing "create/delete/query but no update". Half wrong: `createPromptAsset` and `deletePromptAsset` **do** exist and back real storage, so `POST /prompts` and `DELETE /prompts/:id` are now implemented. Only `PATCH` stays refused — that is the operation the service genuinely does not export. Restricted prompts are refused too, not downgraded: the source permits an initial binding only for `restricted`, and with no binding table the row would be created globally visible while the client believed it was restricted. Built-in/imported rows refuse DELETE with 403 because `deletePromptAsset` scopes to `source='asset'`.
- **A real id-mapping bug, found by round-tripping rather than by reading.** A created prompt did not appear in its own list, and delete 404'd on a row that plainly existed. Two id spaces collide: `UNIFIED_QUERY` aliases the column as `'asset:' || id`, while `createPromptAsset` stores an id that **already begins with `asset:`** — so a created row surfaced as `asset:asset:<uuid>`, matching neither the list projection nor the DELETE lookup. Fixed by making the projection take an explicit stored id, stripping exactly ONE union prefix (an earlier attempt stripped greedily, which destroyed the real id for user-created rows), and resolving client ids against up to three candidate forms with a real database lookup. Round trip verified: POST 201 → found in list → DELETE 200 → **0 rows on disk after restart** → repeat DELETE 404. The disk check matters because `deletePromptAsset` does not persist on its own; its IPC handler calls `saveDatabase()`, and omitting that would have made the delete look successful until the next launch.
- **Locked the bug in with tests, mutation-verified.** The id helpers were extracted to pure functions exported through `__test` and covered by 4 tests (30 in that file now, up from 26). Mutation check: replacing the single-prefix strip with a greedy one fails the suite, so the test can actually catch the regression it exists for.
- **Two of my own BLOCKED verdicts in WINDOW_MATRIX were wrong**, both with the right outcome for the wrong reason — the failure mode that sends the next session building something that already exists:
  - **`/archives` IS in the closure.** I wrote "not in the vendored closure" and used that as `ArchiveSettings`' blocker. It exists: `main/data/api/handlers/archives.ts` over `data/services/archive.ts` (47 lines). My grep searched the wrong directories. The **real** blocker is a semantic mismatch — `listArchives` filters `deleted_at IS NOT NULL` (a soft-delete recycle bin) while all three Grimoire deletes are physical `DELETE FROM`, so mounting it would render a permanently-empty bin whose 永久删除 button reports success for rows already gone. `cherry_resource_state.archived` is a *different* column and IS backed.
  - **`GeneralSettings` needs no missing services.** Its only bridge call is `window.api.application.relaunch` (already implemented); everything else is `usePreference` and the page could mount today. It stays BLOCKED **deliberately** because **no Grimoire main-process service consumes those keys** — `app.launch_on_boot`, `app.power.prevent_sleep_when_busy`, `app.fetch.allow_private_network`, `app.developer_mode.enabled`, `app.proxy.*`, `chat.retry.*`, `chat.context_settings.*` each have **0 references in `src/main/`**. Mounting would render ~20 toggles that persist and do nothing. The route already renders an honest diagnostic listing this; only the matrix *reason* was wrong.
  - Re-verified two adjacent BLOCKED rows and found them correct: `UsageSettings` reads `/ai-usage-records{,/stats,/timeline}` and Grimoire has no usage store; `ShortcutSettings` needs `window.api.shortcut.onRegistrationConflict`, unbridged.
- Verification: `npm test` 462 passed (up from 458); compat 71; `npm run build` passed; `audit:cherry-routes` 12/12; `check:cherry-css` 98.6%; `visual:check` passed; `check:migration-matrix` 90 rows clean; `tsc` 39 pre-existing errors, none in touched files.

## 提示词写入 + 用量采集第一步（2026-10-10）

- 建立 `.agent/REMAINING_WORK.md`：把剩余工作按「可立即做完 / 需设计决策 / 需新基础设施 / 打磨」四组列出，每项写清缺什么、解除条件、验证方式。这是执行清单，完成的项从中删除。
- **提示词 update/reorder/delete 保护**（A1）完成。真机往返验证：create 201 → 列表可见 → update 200（单字段更新保留另一字段）→ 可见性改受限被拒 501 → reorder 200 且**列表顺序真的变了** → 未知锚点 409 → 畸形锚点 400 → batch 200 → 重复删除 404。
- **修掉三个真实缺陷**（都是探针发现，不是读代码发现）：
  1. **batch 路由被遮蔽** —— `/prompts/order:batch` 先被通用 `/prompts/:id` PATCH 分支匹配走，返回 404。调整分支顺序后修复。
  2. **reorder 对无键行算错位置** —— 无键行按 `compareOrderKeysEmptyLast` 排在最后，所以「把 B 放到 A 前面」在 A 无键时算出错误的前驱，列表回来顺序不对或反转。修法是在解析锚点前先给整个集合播撒分片键。
  3. **delete/update 不拒绝导入行** —— 用 `source='asset'` 判断无效（**全部 1742 条导入行都带这个值**）。改为按 `builtin_` id 前缀识别。这里我犯过一次方向性错误：先写成「`asset:` 前缀 = 用户创建」，结果把**画布创建的行**误判为非用户行、破坏了它们的删除，被既有测试抓住 —— 导入行才是异常值，所以要检测的是它。
- **删除的持久化**：`deletePromptAsset`/`updatePromptAsset` 自身不落盘（`db.run` 只写句柄），其 IPC handler 自己调 `saveDatabase()`。漏掉会让删除在进程内看起来成功、重启后回来。已补，并用**进程退出后读文件**验证。
- **用量采集第一步**（A4 的一半）：先查证了范围 —— Grimoire 之前**完全没有用量采集点**（`src/main/ai/` 零引用），源的 `ai_usage_record` 是 40+ 列 + kind/modality 分类 + 三个端点。所以拆成两步，只做第一步：给 `RuntimeEvent` 加归一化的 `usage` 事件（顺带推进 C2）、v26 建表、在 runtime 与 IPC 事件循环接入。
- **两个映射器抓到的真实缺陷**：`Number(null)` 和 `Number('')` 都等于 0，盲转会把「提供方没报」变成「报了 0」——一个会被 UI 当真实读数渲染的假值。加了 `readTokenCount` 只接受有限数字。同理 `cached_tokens` 缺失时存 NULL 而非 0。
- **schema v26 在真实数据库副本上验证**：v25→v26、表与 2 个索引建成、**自动备份生成**、用户数据无损（4 sessions / 1742 prompt assets 不变）。绝不在实时库上跑。
- 仍未做：A4 第二步（三个读端点 + `/settings/usage` 页面），已在清单标注。
- Verification：`npm test` **484 passed**（91 files，+14）；`npm run build` 通过；`prompt-asset-browser.test.ts` 14 项、`usage.test.ts` 7 项、`usage.service.test.ts` 7 项全部通过。

## 用量面板完成（A4 第二步，2026-10-10）

- **`/settings/usage` 挂载完成**（route id 13 → 14）。三个源端点 `/ai-usage-records{,/stats,/timeline}` 全部实现，接到第一步的 `ai_usage_records` 表。
- 空状态语义正确：截图确认页面渲染真实源组件（概览、时间范围切换、四个指标卡、空状态），**总成本显示 `N/A`、缓存命中率显示「发送新请求后开始统计」** —— 这是 `null` 被如实呈现，而不是伪造成 0。若当初把缺失值写成 0，这里会显示「总成本 0」和「缓存命中率 0%」，两者都是关于用户数据的假陈述。
- **字段取舍**：源 `AiUsageRecordEntry` 有 40+ 字段。Grimoire **能答的填真实值**（token 数、模型、时间戳、session），**不能答的填 `null`**（成本/定价快照——无价格表；API key 归属——密钥不出 safeStorage；图片模态；缓存写入）。源 schema 每个字段本就 nullable，`null` 是诚实答案。
- `stats` 的 `buckets` 返回空数组而非伪造分组：Grimoire 记录里没有足够细的 provider/model 归属来分组，编造分组会被 UI 当真实统计渲染。
- `nextCursor` 省略（响应里不出现），这是「没有下一页」的诚实信号 —— 而不是给一个指向虚无的游标。
- Verification：`npm test` 484 passed；compat 71 passed；`npm run audit:cherry-routes` **13/13 全部渲染**；`npm run build` 通过；route-registry 13 项；`check:migration-matrix` 无畸形行；`check:cherry-css` 98.6%；`visual:check` 通过。

## 清单核查：A6 记为"未接"但实际已实现（2026-10-10）

- 按清单推进 A6（Composer 附件）前先核查接口，发现**它已经实现**：`cherry-chat-shell-entry.tsx:365-386`
  的发送路径把每个附件 path 经 `host.attachments.import({sessionId, filePath, sourceType})` 导入，
  拿到 id 后随 `host.chat.send({..., attachments})` 发送；`ComposerSurface` 通过 `setFiles` 接收 source
  的 drop/paste 结果（`ComposerSurface.tsx:296` onPaste、`:387` onDrop）；`file.get` 的
  `getBridgeFileInfo` 已返回 composer 需要的完整形状（id/name/path/size/ext/type/mime），且
  `getPathForFile`/`createTempFile`/`write` 都在 preload 里。renderer 从不直接读文件。
- **这是本会话第三次"我记录的缺失其实存在"**（前两次：`/archives` 不在 closure、`GeneralSettings` 缺七个服务）。
  三次的共同点：判据来自**读代码或窄范围 grep**，而不是运行或全量搜索。
  - 第一次：grep 搜错了目录。
  - 第二次：把"页面需要这些服务才能渲染"与"需要这些服务才能真实"混为一谈。
  - 第三次：按计划文件里的旧描述记账，没有核对实现。
- 因此给清单加了一条纪律：**任何"未完成"条目在动手前先核查一遍**，核查方式必须是运行或全量搜索，
  不能只看计划描述。清单已按此更正 A6 条目并说明原因。
- A6 剩下的只是**运行时验证**（拖入/粘贴后附件是否真的落库并进入请求），归类到 Functional 门（D2），
  不再作为独立待办。
- **A6 运行时链路已真机验证**（不只是纠正记录）：`file.get` 返回完整描述符（`sample-attachment.txt` / 24 bytes / `.txt` / `text`）→ 创建会话 → `ai.sessions.attachments.import` 返回真实 id → `ai.sessions.attachments.list` 列回 1 条。第一次探针返回空对象，因为**我用错了 preload 方法名**（写成 `ai.attachmentImport`，真实是 `ai.sessions.attachments.import`）—— 又一次"按记忆记账"的错误，被运行结果立刻暴露。

## `/settings/shortcut` 挂载 + 路由审计的盲区（2026-10-10）

- **`/settings/shortcut` 挂载完成**（route id 14 → 15）。页面渲染真实源组件：11 个快捷键条目（退出全屏 / 搜索消息 / 打印 / 切换左侧边栏 / 打开设置 / 显示隐藏应用 / 关闭窗口 / 放大缩小界面 / 重置缩放 / 聚焦输入框）、真实键位、开关、分组下拉与搜索。
- **发现并修掉一个路由审计盲区 —— 这是本节最重要的一条**。第一次审计 `/settings/shortcut` 报 `OK`，而截图显示页面**崩在错误边界**：`Cannot read properties of undefined (reading 'onRegistrationConflict')`。
  - 原因：审计的边界正则写的是 `出错了|Something went wrong|...`，**源错误边界的实际文案是「似乎出现了一些问题…」**，两者不匹配，于是崩溃页被算作正常渲染。
  - 这正是本项目反复出现的"报干净但实际坏了"形状，而且是我自己的门禁犯的。
  - 修法：检测改为**同时**匹配中英文标题**和**边界自身的结构签名（`打开调试面板` + `重新加载` 按钮对），并在结果里带上抛出的错误文本。修好后同一路由立刻报 `FAIL` 且指出 `onRegistrationConflict`，退出码 1 —— 门禁被证明能失败。
  - 教训与之前一致：门禁自身的正确性也要被验证，不能因为它"跑通了"就相信它。
- **修掉页面崩溃**：源页面只需要 `window.api.shortcut.onRegistrationConflict` 一个方法。Grimoire **不注册任何全局快捷键**（`globalShortcut` 零引用），所以该事件**不可能有发射源** —— 空实现是诚实的，不是"尚未接线"。按 `ipcApi.on` 已确立的策略走诊断日志而非抛错（源在 `useEffect` 返回里调用，抛错会拖垮整页）。
- Verification：`npm test` 484 passed；compat 71 passed；`npm run audit:cherry-routes` **14/14 全部渲染**（含新增两条）；`npm run build` 通过；`check:migration-matrix` 无畸形行；`check:cherry-css` 98.6%；`visual:check` 通过。

## `/settings/general` 偏好消费者第一批（A3，2026-10-10）

- 新建 `src/main/services/app-preferences.service.ts`，实现三个通用设置键的**真实主进程行为**（此前这些键只被持久化、零消费者，是"开关动了但什么都不发生"的假成功）：
  - `app.launch_on_boot` → `app.setLoginItemSettings`，**按源 `AppService.setAppLaunchOnBoot` 的语义**，含 electron-builder 便携版处理（`PORTABLE_EXECUTABLE_FILE`；便携版的 `process.execPath` 指向解压的临时目录，注册它下次启动就失效）。Linux 需要写 `.desktop` 文件，**明确返回 `{applied:false, reason:'linux_autostart_not_implemented'}`** 而不是假装成功。
  - `app.proxy.*` → `resolveProxyConfig`，与源 `ProxyService` 同样的 mode→`ProxyConfig` 映射（`custom` 无 URL 回退 `direct`，不形成空 `proxyRules`）。三个键任一变化都会重新应用——否则只改「地址」不会生效。
  - `app.power.prevent_sleep_when_busy` → `powerSaveBlocker`，用 `prevent-app-suspension`（让任务在锁屏后继续跑）而非 `prevent-display-sleep`（那会一直亮屏，不是该偏好要的）。
- 接入点选在 `settings:set` 处理器：compat shim 用 `cherry_pref.<源键>` 命名空间存偏好，这里正是"开关变成行为"的地方。值经 shim 是 **JSON 编码**的（`"custom"` 而非 `custom`），所以逐键解析——按原始字符串读会把 `'"custom"'` 当模式、落到 default 分支应用错误配置还报成功。
- **新增 `app.preferences.read` 路由**读回**操作系统真实状态**，而非读存储的偏好：偏好可以是 `true` 而 OS 登录项并不存在（注册失败或被外部移除）。页面需要真实状态才能避免显示一个看起来生效的开关。
- **真机验证的是实际 OS 状态而不是返回值**：设置后读回 `openAtLogin` true→false、`prevent_sleep` active true→false。若 handler 只 `return true` 而不做事，这两次读回都会是 false/不变。
- 8 项新单测（`resolveProxyConfig` 的四种映射含空 URL 回退、便携版路径、平台不支持时的诚实返回、防休眠开关）。
- 仍未做（清单已记）：`app.developer_mode.enabled`、`chat.retry.*`、`chat.context_settings.*` —— 因此 `/settings/general` **仍不挂载**，直到那些键也有真实消费者。
- Verification：`npm test` **492 passed**（92 files，+8）；compat 71；`npm run build` 通过；`audit:cherry-routes` 14/14 exit 0；`check:migration-matrix` 无畸形行；`visual:check` 通过；无泄漏进程。

## 重试策略 + 上下文压缩策略（A3 第二批，2026-10-10）

- **Grimoire 此前完全没有重试**：runtime 出错就 yield `failed`，回合结束。新建 `src/main/ai/runtime/retry-policy.ts`，按源 `aiSdk/retry/retryPolicy.ts` 的同一组 `chat.retry.*` 键与同样的 [1,10] 夹取实现。
- **写错一版并推翻**：第一版把整回合事件缓冲到结束再统一吐出，用来判断"能否安全重试"。这**摧毁了流式**——UI 要等回合结束才看到任何内容。改成边到边 yield，用 `emitted` 标志回答同一个问题：一旦 yield 过一个事件，重试即被禁用（重放会使用户看到重复内容）。测试里专门有一条断言"消费者在第二个事件产出前就收到第一个"。
- 错误分类**先看状态码后看文字**：401/403/404/400/422 与 invalid_api_key/unauthorized/forbidden 判为不可重试（重试只会烧配额并推迟用户需要看到的错误），429/5xx/timeout/ECONNRESET/fetch failed/rate limit 判为可重试。有一条测试专门锁定这个顺序——「401 Unauthorized: request timed out」必须判不可重试。
- 退避 500ms 起指数增长、**上限 8s**：不设上限时 `maxAttempts=10` 的最后一次要睡 4 分多钟，看起来像卡死而不是重试。
- `withRetry` 接到 `ai-sessions.ipc.ts` 的 `runtime.send` 调用点（不接线就等于没有）。偏好读取用 `cherry_pref.chat.retry.*` 并逐值 JSON 解析——按原始字符串读会把 `"true"` 当假值，开关显示开启而重试永远关闭。缺省值由 `readRetryPolicy` 单点持有，读取函数不重复默认，避免两处漂移。
- **仍未做**：`app.developer_mode.enabled`（它门控的是源的可观测/追踪子系统，Grimoire 没有——实现它等于新建追踪基础设施，不是翻开关）、`chat.context_settings.*`（上下文压缩/截断策略）。因此 `/settings/general` **仍不挂载**。
- Verification：`npm test` **509 passed**（93 files，+17）；compat 71；`npm run build` 通过；`audit:cherry-routes` 14/14；`check:migration-matrix` 无畸形行；`visual:check` 通过。

## 上下文消息截断（A3 第三批，2026-10-10）

- **Grimoire 此前把整段历史原样发给模型**：模型目录里有 `contextWindow` 但没人读，「最大消息数」这类设置也没有任何消费者。新建 `src/main/ai/runtime/context-settings.ts` 实现 `chat.context_settings.*` 中**能用现有数据诚实实现的那一半**：`enabled` + `maxMessages`。
- **明确拒绝实现另一半，并写明理由**：
  - `truncate_threshold` —— 源按模型的 context window 以 **token** 计量。Grimoire 没有 tokenizer，用字符数估算会**砍错量却看起来很精确**。消息条数上限能达到同样的用户可见效果，且是本文能真实保证的界。
  - `compress.*` —— 源的压缩是叫另一个模型总结被丢弃的历史并持久化摘要，是一整套子系统（压缩模型解析、compaction 事件、摘要持久化）。半成品要么静默丢失对话内容，要么声称生成了从未存在的摘要。
- **两个容易写错、已用测试锁死的点**：
  - `maxMessages: null` 是源自己的默认值，意思是**无限制**，**不等于 0**。把 null 强制转成 0 会为每个没动过该设置的用户**静默丢弃全部历史**。非正数一律按无限制处理。
  - 无需截断时**返回同一引用**（调用方靠引用判断"未变化"），且**永不返回空列表**——发送零条消息不是"截断对话"，是另一个请求。
- 截断点在 `runtime.createSession` 调用处而非启动时：每个工具回合都会 append 到 `currentMessages`，只在初始列表上应用限制会被第一次工具调用绕过。
- 偏好读取同样走 `cherry_pref.chat.context_settings.*` 并逐值解析；默认值只由 `readContextSettings` 单点持有。
- **因此 `/settings/general` 现在只差一个键**：`app.developer_mode.enabled`（门控源的可观测/追踪子系统，Grimoire 无此基础设施——属新建而非接线）。该页仍不挂载，但缺项已从 7 类收敛到 1 类。
- Verification：`npm test` **517 passed**（94 files，+8）；compat 71；`npm run build` 通过；`audit:cherry-routes` 14/14；`check:migration-matrix` 无畸形行；`check:cherry-css` 98.6%；`visual:check` 通过；typecheck 39 个既有错误不变。

## Phase 1 核查：实际完成度远高于我的记录 + 话题导出接线（2026-10-10）

- **核查 Phase 1 的"自建行组件"结论，发现我把它写得太悲观了。** 计划第 1 项要求复用源 `resourceList/base/*`；我此前记为"仍是自建 adapter row"。实际读代码后：
  - `CompatSessionResourceList.tsx` 已经导入**源**的 `SessionResourceList`（那是个 28 行的薄包装，只依赖 `base`），以及**源的** `useResourceListActions`、**`useResourceListPinnedState`**、`useResourceListRowState`、`ResourceListActionContextMenu`。
  - `menu-actions.ts` 也已经导入**源的** `sessionItemActions`。
  - 自建部分只有 `CompatSessionRow`（85 行的行视觉），它本身还是用源的 `ResourceList.Item` / `ItemLeadingSlot` / `RenameField` / `ResourceListActionContextMenu` 搭的。
  - 计划里点名的 `SessionItem.tsx`（在 `resourceList/` 下）**不存在**——计划那个路径是错的；`sessionItemActions.tsx` 存在且已在用。
  - 结论修正：Phase 1 第 1、2 项实质已满足，"不再扩写自制 row"的约束也一直遵守。
- **真空白是话题菜单的导出项**：`buildCompatTopicMenuContext` 里 6 个导出回调全是 `noop`，且 `exportMenuOptions` 全部硬编码 `false` —— 后者会**隐藏**所有导出菜单项。已接线，复用**源自己的** `messagesToMarkdown` 与 `exportMarkdownToJoplin`/`Siyuan`/`Yuque`（本会话已端到端验证过该链路）+ `window.api.file.save` 走 Markdown。
- **`exportMenuOptions` 改为派生自"回调是否真的提供"**，不再硬编码。硬编码 `false` 会在有处理器时隐藏条目；硬编码 `true` 会显示无处理器的条目。派生让两者不可能不一致。
- **测试暴露了一个真实的设计问题**：允许列表是**静态**的，但导出可用性是**按上下文**的。既有测试断言 `topic.export` 不存在（写于它还没有处理器时），改后失败。修法不是改断言而是改实现——`resolveCompatTopicMenuActions` 现在按"回调是否为 `noop`"逐项裁剪，并在**所有子项都被裁掉时连父项一起移除**（空子菜单比隐藏更糟）。测试随之重写：新增"部分提供导出回调"与"父项随子项消失"两条，5 → 7 项。
- Verification：`npm test` 517 passed；**compat 71 → 73 passed**；`npm run build` 通过；`audit:cherry-routes` 14/14；`check:migration-matrix` 无畸形行；`visual:check` 通过；typecheck 39 个既有错误不变。
- 导出菜单的**可用性改为按上下文派生**后，`resolveCompatTopicMenuActions` 会按"回调是否为 noop"逐项裁剪，并在所有子项被裁掉时连父项一起移除（空子菜单比隐藏更糟）。既有测试断言 `topic.export` 不存在——那是写在它还没有处理器时的**过期断言**，已按新语义重写并新增两条（部分提供回调、父项随子项消失），compat 5 → 7 项。
- 验证方式说明：导出接线的验证靠 compat 单测（7/7，含按上下文的两条），**不是**靠真机点击。为此写过一个 CDP 探针，但它反复在模板字符串转义上出错，且路由审计用的临时 profile 没有会话（界面如实显示「暂无会话」），无法在其中点到菜单。探针已删除；**真机点击导出属于 Functional 门（D2）未完成项**，不声称已验证。

## 导出验证收尾：测试抓到一个真实的导出内容 bug（2026-10-10）

- 上一轮我如实记下「导出接线只由 compat 单测验证，没有真机验证」。这一轮**把验证做扎实了**——用注入 mock 的 `fetch` 直接驱动源 `messagesToMarkdown` / `exportMarkdownToJoplin` / `exportMarkdownToSiyuan`，断言**到达目的地的载荷**。这比点击更强：点击只能证明菜单项存在，这能证明导出的正文就是对话内容。6 项测试，无网络。
- **测试立刻抓到我生产代码里的一个真实 bug**：`exportTopic` 把消息交给导出器时没有 `parts` 字段。导出器读的是 `message.parts`（`utils/message/find.ts: getParts`），**不是 `content` 字符串**；`toSourceMessage` 只产出信封，所以导出结果会是**有角色标题、正文全空**。测试断言 `messagesToMarkdown` 应包含对话文本，第一次运行即失败并打印出 `'## 🧑💻 User\n\n\n\n---\n## 🤖 …'`——正是空正文。已用渲染器同一套 `readParts`/`toSourcePart` 投影修复，导出的正文与屏幕所见一致。
- 这条 bug 说明**为什么不能只靠"接线了"就报完成**：菜单项会出现、函数会被调用、返回 true，但用户拿到的文件是空的。如果按计划只做菜单接线而不验证载荷，它会一直隐藏到有人真的导出。
- 附带修掉两个自身问题：测试里 toast 未挂载导致的渲染期抛错（发生在网络请求**之后**，与断言无关，已 stub）；以及我写在注释里的 `\n` 被解析成真实换行，**打断了注释并让构建失败**——构建立刻报错，属于"门禁正常工作"。
- Verification：`npm test` 517 passed；**compat 73 → 79 passed**；`npm run build` 通过；`audit:cherry-routes` 14/14；`check:migration-matrix` 无畸形行；`visual:check` 通过；typecheck 39 个既有错误不变。

## 消息级导出 + C2 核查（2026-10-10）

- **核查 C2（归一化运行状态块），记录的又是过于悲观**：源 `MessageListActions` 只声明**一个**订阅（`subscribeToolProgress`），而它早已实现；`part-projection.ts` 也已覆盖 text/reasoning/file/code/error/compaction/tool 七种 part 类型，渲染走的是**源的** `MessageListProvider`。C2 剩余的不是"状态块没接"，而是**消息级动作缺 4 个导出处理器**。
- 已补 `exportMessageAsMarkdown` / `exportToJoplin` / `exportToSiyuan` / `exportToYuque`，复用与话题导出同一条已验证链路。`exportMessageAsMarkdown` 走**源**的 `messageToMarkdown`（含 reasoning 变体）+ 保存对话框。
- 新增 3 项测试（单条消息正文渲染、单条消息发往 Joplin 的载荷、未配置时不发送）。测试用**单条消息包成数组**这一形状，因为 `parts` bug 证明了"调用点看不出的输入形状"是真实风险。
- Verification：`npm test` 517 passed；**compat 79 → 82 passed**；`npm run build` 通过；`audit:cherry-routes` 14/14；`check:migration-matrix` 无畸形行；`check:cherry-css` 98.6%；`visual:check` 通过；typecheck 39 个既有错误不变。

## Functional 门（D2）第一批 + 抓到用量采集的致命盲区（2026-10-10）

- 用现成的 mock provider harness（真实 HTTP + SSE 服务器）为本次会话新增的三个运行时行为补上**功能验证**。**它立刻抓到一个 unit test 结构上不可能发现的生产 bug**：
  - **用量采集在无工具的普通对话上完全失效。** `openai-compatible.runtime.ts` 有两分支：带 tools 走 `client.chat.completions.create(...)`（我给它加了 `stream_options`），**不带 tools 走 `chatStream()`，而 `chatStream` 只 yield 字符串、把 usage 整个丢掉**。普通聊天（最常见路径）因此**从不记录任何用量** —— 面板会一直显示 0，而单测全绿，因为它们只测映射器。
  - 修法：`chatStream` 的产出类型从 `string` 改为 `ChatStreamChunk`（`{ text, usage? }`），并请求 `stream_options.include_usage`；调用方同时消费文本与 usage。**只有走一遍真实 HTTP 才能发现**：断言 `stream_options` 是否真的到达 wire。
- 新增 4 项功能测试：真实 SSE 上 usage 事件（含 cached tokens 穿过 wire）、无 usage 时不发事件（不伪造 0）、503 重试成功（断言**服务器实际收到 2 次请求**）、401 不重试（断言只收到 1 次）。后者是单测无法做的断言——stub 生成器不会计数真实请求。
- 写测试时我自己踩了一个坑并修正：`withRetry` 需要一个**每次尝试新建生成器**的工厂函数；我先传了 `() => drain(runtime)`，其中 `drain` 是 async 且返回**数组**，于是生成器从未按尝试重建，`attempts` 恒为 0。这个错误的表现（"重试没发生"）与产品 bug 的表现一模一样，值得记下。
- Verification：`npm test` **517 → 521 passed**；compat 82；`npm run build` 通过；`audit:cherry-routes` 14/14；`check:migration-matrix` 无畸形行；`visual:check` 通过；typecheck 39 个既有错误不变。

## 取消（interrupt）实现 + 两个真实缺陷（D2 第二批，2026-10-10）

- **`OpenAICompatibleRuntime` 此前完全没有 `interrupt`** —— 而它是普通聊天的默认 runtime。`AgentRuntime.interrupt` 是可选成员，调用方 `if (!runtime?.interrupt) return false`，所以**停止按钮对日常对话直接返回 false、流继续跑到结束**。用户按了停止却要等回复讲完。
- 已实现：per-session `AbortController`，在 `send` 创建、`finally` 清理，信号贯穿 `chatStream` 与两条 wire 调用；`cancelled` 加入 `RuntimeEvent` 联合类型（与 `failed` 分开——把用户主动取消报成错误是在为自己的操作责怪用户）；IPC 循环把 `cancelled` 记为事件并结束回合。
- **真机 HTTP 测试又抓到一个缺陷**：给 SDK 传了 signal 之后，abort **确实中断了流**（后续 token 不再到达，实测确认），但**不抛异常**——SDK 静默停止 yield，于是 `send` 正常落到调用方的 `completed` 分支，**被取消的调用被记成"完成"**。第一次修法只加了 `catch` 里的 `isAbortError` 分支，测试仍然失败，因为根本没有异常。正确做法是在流主体结束后**再检查 `controller.signal.aborted`**。
- 诊断过程本身也值得记：我用「服务器是否还在发后续 token」来区分"abort 没生效"与"abort 生效但报告错误"。第一次的 harness 写了一个 token 就 return，HTTP 响应随即结束，SDK 视作 EOF —— 测试测的是空气。改成持续发 token 后才看出 abort 生效但报告错误。**harness 缺陷与产品缺陷的表现可以完全一样**，区分它们要靠观察实际到达客户端的数据。
- Verification：`npm test` **521 → 523 passed**；compat 82；`npm run build` 通过；`audit:cherry-routes` 14/14；`check:migration-matrix` 无畸形行；`visual:check` 通过；typecheck 39 个既有错误不变。

## 权限往返验证 + recovery 是空声明（D2 第三批，2026-10-10）

- **权限往返真机验证通过**（两种传输）：`HttpAgentRuntime` 发出 `permission-requested` → 宿主 `approve`/`reject` → **断言 agent 真的收到了决定**（`approvalBodies` 检查请求体，而不只是本地 promise resolve）。JSON 与 SSE 两条路径都覆盖——agent 用哪种传输不是宿主能选的。
- **发现 `recovery` 是"声明了但从未发出"的事件**：搜索确认没有任何 runtime、adapter 或 integration 构造它，所以 IPC 里的 `recovery` 分支当前**不可达**。已在类型定义处写明这一点（保留变体是因为 Pi/OpenCode 适配器预期会报告恢复阶段，删掉会让它变成接口变更而非新增），矩阵按 `NOT_IMPLEMENTED` 记账——**今天任何渲染恢复提示的 UI 都在等一个永不到来的事件**。
- 写权限测试时又一次踩到**harness 与产品缺陷同形**：JSON 分支最初只发出 `session-started, completed`，我一度以为是运行时读不到 `response.events`。加诊断后发现是我把字段**多套了一层** `response` —— `requestPrompt` 对 JSON 分支**已经解过一层信封**（`{ response: JSON.parse(raw) }`），所以字段应在 body 顶层。诊断打印出的 `responseKeys=response` 一眼看出双层包裹。
- 一个值得记的观察：`HttpAgentRuntime` 的 wire 契约**没有任何真实 integration 配置它**（`src/integrations/` 里搜不到），所以这个形状目前只由测试钉住。已把契约写进测试注释，避免下一个人再猜。
- Verification：`npm test` **523 → 525 passed**；compat 82；`npm run build` 通过；`audit:cherry-routes` 14/14；`check:migration-matrix` 无畸形行；`visual:check` 通过；typecheck 39 个既有错误不变；无遗留诊断代码。

## Phase 2 核查：采用源的 useResourceEntityRail（2026-10-10）

- **Phase 2 的源组件也基本已接**：`CompatAssistantTopicRail.tsx` 已导入源 `ResourceEntityRail`、`TopicResourceList`、base hooks（`useResourceListActions`/`useResourceListPinnedState`/`useResourceListRowState`）与源 `ResourceListActionContextMenu`；话题行用源 `ResourceList.Item`/`ItemActions`/`RenameField` 搭成。**记录再次低估**。
- **但发现一处真实缺口**：源 `useResourceEntityRail`（136 行，驱动 rail 的排序/激活语义）的**整个依赖闭包只有 React 加两个同目录模块**——可直接采用，而 compat 当时是手工调 `onSelect`/`onReorder`。采用后补上了三件此前没有的行为：
  1. **乐观排序 + 失败回滚 + 重取同步**（此前直接调 `onReorder`，拖拽失败无回滚）；
  2. **置顶项浮到顶部**并保持相对顺序；
  3. **陈旧激活守卫**（`useOwnerResourceActivation` 的代际计数），避免较慢的旧请求覆盖较新的选择；`selectedId` 在活动助手已不在列表时返回 null，而非保留一个高亮不存在的行。
- 采用过程中我自己写错并修正两处，都被测试逼出来：
  - `onPickResource` 收到的是**资源（话题）**而非实体，我最初把 `item.id` 直传，会把**话题 id 当成助手 id**。改为从话题的 `owner_id` 解析助手。
  - 字段名是 `owner_id` 不是 `assistant_id`（Cherry API 侧叫 `assistantId`，Grimoire 行里是 `owner_id`）。
- **既有一条测试的断言本身是错的**：它点击话题后断言 `onSelectAssistant` 被调用。话题 rail 只选话题——设置活动助手是助手 rail 的职责，两者是不同源组件（`Topics.tsx` vs `AssistantResourceList`）。已按每 rail 各自语义改正断言，并加 `expect(onSelectAssistant).not.toHaveBeenCalled()` 锁住边界。
- 真机验证：`audit:cherry-routes` 14/14 通过，`/app/agents` 截图确认两条 rail 正常渲染（助手 rail 的 新建助手/时间/显示归档，话题 rail 的 搜索主题 与「主题消息仍归属于其会话」提示——后者正是 topic-message-tree 限制被如实写在界面上）。
- Verification：`npm test` 525 passed；compat 82 passed；`npm run build` 通过；`audit:cherry-routes` 14/14；`check:migration-matrix` 无畸形行；`visual:check` 通过；typecheck 39 个既有错误不变。

## `/pins` 路由 + 一个影响整个 DataApi 的查询串缺陷（2026-10-10）

- **实现 `/pins` GET/POST/DELETE**（`src/main/services/cherry-pin.service.ts`），底层就是**已存在的** `cherry_resource_state.pinned`——pin 状态从 schema v20 起就在存，缺的只是源的 DataApi 形状。这一步是解锁源 `usePins` 消费者的前提（例如 `AssistantResourceList`），避免每个 compat wrapper 各写一份 pin 列表。
- **真机验证的行为**：pin → 列表 1 条 → 重复 pin 仍 1 条（源的 `pin()` 幂等）→ unpin → 0 条；`entityType=model`（Grimoire 不投影的类型）返回空数组而非报错；未知 pin id 返回真实 404。id 是**从 (entityType, entityId) 确定性派生**的 uuid 形状值——Grimoire 没有 pin 表，随机 id 会让下一次 `DELETE /pins/:id` 无法回解。
- **探针抓到一个影响面更大的真实缺陷：DataApi 处理器从不剥离查询串。** 匹配器拿 `path` 精确比较，所以 `GET /pins?entityType=session` 永远不等于 `/pins`，一律 404 `DataApi 路由未桥接`。修复前**任何带查询参数的 DataApi 路由都会 404**——此前没被发现，是因为已接的路由恰好都不用查询串（`POST /pins` 成功而它的 GET 404，正是这个不对称让我注意到）。
- 已修：把查询串从 path 拆出并解析为 `search`，`/pins` GET 从 query 读取 `entityType`（兼容 body/params）。
- 8 项新单测覆盖：形状完整、幂等、id 往返、unpin 幂等、**无投影行时返回 null 而非虚构 pin**（虚构的 pin 永远不会出现在任何 rail 里）、未投影类型空列表、orderKey 排序、持久化（直接读原始列，不靠服务自己的返回值）。
- Verification：`npm test` **525 → 533 passed**；compat 82；`npm run build` 通过；`audit:cherry-routes` 14/14；`check:migration-matrix` 无畸形行；`visual:check` 通过；typecheck 39 个既有错误不变。

## `/groups` 路由 + schema v27（2026-10-10）

- **实现 `/groups` CRUD + 排序**（`src/main/services/cherry-group.service.ts`），新增 **schema v27** 表 `cherry_resource_groups`。这是解锁源 `useGroups` / `AssistantResourceList` 的最后一块拼图：`cherry_resource_state.group_id` 早已存在并为 session/assistant 写入，缺的是**分组实体本身**（名称 + 排序键）无处存放。
- **刻意不复用 `chat_groups`**：源 `Group` 是**按 entityType 分域**的容器（`listByEntityType` 是唯一读路径，`entityType` 必填），而 `chat_groups` 命名的是**对话历史分组**。`AiAssistantRecord.group_id` 指向的是前者，把两者接起来会把助手归属到用户给聊天历史起的名字上。已在代码注释与本节写明这个区分。
- **删除分组时在同一事务里解除所有指向它的实体**：留下指向已删行的 `group_id` 会让 rail 把实体渲染在一个名字再也解析不出来的标题下。
- 测试里我自己写了个**多余且错误的守卫**：在 `orderKeyBetween` 之后又加了一道"是否真的在两者之间"的检查，结果**拒绝了合法的 `position: first`**（测试立刻返回 false）。`orderKeyBetween` 的契约本身就是那个保证，用略有差异的比较重复它反而引入 bug。已删。
- **真机验证（真实数据库副本）**：v26 → **v27**、表与索引建成、**自动备份生成**、用户数据无损（1742 prompt assets / 4 sessions）。路由往返：create → list → rename → **reorder 真的改变顺序** → delete → 缺失返回 404 → **陈旧锚点返回 409**（而非静默追加）。绝不在实时库上跑。
- 9 项新单测：形状、空/超长名称拒绝（无名分组会渲染成无法区分的空白标题）、按 entityType 分域、未跟踪类型空列表、重命名缺失、**删除时解绑**、三种锚点排序、**未知锚点返回 false**、持久化（读原始列）。
- Verification：`npm test` **533 → 542 passed**；compat 82；`npm run build` 通过；`audit:cherry-routes` 14/14；`check:migration-matrix` 无畸形行；`visual:check` 通过；typecheck 39 个既有错误不变。

## 助手读/改/归档路由 + 一个字段投影错误（2026-10-10）

- **补上 `/assistants` 的 GET / GET :id / PATCH / DELETE / restore**。此前只有 POST（对话导入用），所以源的 `useAssistantsApi` / `useAssistant` 拉到的是空列表。服务层操作本来就齐全，缺的只是 DataApi 形状。
- **`DELETE /assistants/:id` 走归档而非物理删除**。源的 `deleteAssistant` 经由 `TrashService` 进回收站，而 Grimoire 的 `deleteAiAssistant` 是**物理 DELETE**。若照字面接过去，用户以为可恢复的助手会被真的销毁。真机验证了完整语义：删除后 `GET :id` 仍返回 200、离开活动列表、`includeArchived=true` 时出现、`restore` 后回到活动列表。
- **修正一个既有字段投影错误**：`sourceAssistantFromRecord` 原先把 `groupId: record.provider_id` —— 那是分组概念存在之前的占位写法，把「提供商」映射到了「分组」。`AiAssistantRecord` 本身**同时有** `provider_id` 和 `group_id`，且 `cherry_resource_state.group_id` 一直在写。现在 `/groups` 变真之后，这个映射会让 rail 把助手挂到一个「id 是提供商 id」的分组下，任何分组查询都解析不出来。已改为读 `record.group_id`。
- 真机往返全部通过：create 201 → list 含新项 → GET 200（名称/提示词正确）→ PATCH 200（两项都改到）→ DELETE 200 → 仍可 GET、离开活动列表、在归档列表 → restore 200 → 回到活动列表 → 缺失 id 返回 404。
- Verification：`npm test` 542 passed；compat 82；`npm run build` 通过；`audit:cherry-routes` 14/14；`check:migration-matrix` 无畸形行；`visual:check` 通过；typecheck 39 个既有错误不变；无遗留探针文件。

## 主题读/改/归档路由 + 主题消息树明确拒绝（2026-10-10）

- **补上 `/topics` 的 GET / GET :id / PATCH / DELETE / restore / move**。此前只有 POST（导入用），源的 `useTopic` 拉不到列表。
- **`DELETE /topics/:id` 同样走归档而非物理删除** —— 与助手同理：源的 topic 删除经 `TrashService` 进回收站，Grimoire 的 `deleteAiTopic` 是物理 DELETE。真机验证：删除后仍可 GET、离开活动列表、`includeArchived=true` 时出现、`restore` 后回活动列表。
- **`/topics/:id/messages` 以 501 明确拒绝，并写明理由** —— 这是本迁移里最容易被"顺手实现"的地方：Grimoire 的消息按**会话**存储（`ai_messages.session_id`），没有按主题划分的历史。返回空列表会渲染成「该主题没有消息」（假），返回会话消息会把**共享历史当成主题私有**（更假）。拒绝并在错误里说明这两点，与 MIGRATION_MATRIX 里 topic-thread parity 记 BLOCKED 一致。
- **再修一个字段投影占位错误**：`sourceTopicFromRecord` 原先把 `assistantId` 硬编码为 `undefined`（写在主题归属被跟踪之前）。源的 `Topic.assistantId` 是主题与助手的关联，Grimoire 存在 `cherry_resource_state.owner_id`。改为读 `record.owner_id`——否则任何按助手分组的消费者都会得到空分组。
- **一条既有测试的断言已过期**：它用 `/topics` 作为"未桥接路由返回 404"的例子，而 `/topics` 现在实现了，于是断言变成"实现的路由返回 404"。改用真正未桥接的 `/knowledges`，测试重新测它名字所说的事。
- 真机往返：create 201 → list 1 → GET 200 → rename 生效 → DELETE 后仍可 GET/离开活动/在归档 → restore 回活动 → messages 501 NOT_IMPLEMENTED → 缺失 404。
- Verification：`npm test` 542 passed；compat 82；`npm run build` 通过；`audit:cherry-routes` 14/14；`check:migration-matrix` 无畸形行；`visual:check` 通过；typecheck 39 个既有错误不变；无遗留探针文件。

## 源 AssistantResourceList 可采用性实证 + reusable-placeholder 路由（2026-10-10）

- **用实证取代评估**：此前我把源 `AssistantResourceList`（500 行）记为「未采用，因为它依赖 compat 无对应的 hook」。这次不再靠读依赖列表判断，而是**实际跑**：
  - 在 compat 工程里 `import` 它 —— **成功**（首次 5s 超时只是转换耗时，提高超时后通过）；
  - 在 jsdom 里 **render** 它，传入最小 props —— **成功，零 console 错误**。
  - 结论：它在 compat 环境里是可用的，此前那条判断是错的（与本会话前面几次同类错误一致：**判据来自读代码而不是运行**）。
- **它的 hook 依赖正好落在本轮刚补的 DataApi 路由上**：`useAssistantsApi` → `/assistants`，`useTopic` → `/topics`、`/topics/:id`、`/topics/:id/restore`、`/topics/latest`，`usePins` → `/pins`，`useGroups` → `/groups`。也就是说这一串 DataApi 补齐是**采用该组件的前置条件**，顺序是对的。
- **补上 `/topics/reusable-placeholder`**（源 `TopicService.reuseOrCreatePlaceholder`）。这个路由的**全部意义在复用谓词**，接错会变成「点一次建一个主题」。逐条实现并真机验证：
  - 首次调用 `created: true`；
  - 第二次调用**返回同一个 topic**（`reusedSameTopic: true`）——没有产生重复；
  - `excludeTopicId` 强制新建（用户正在切走，复用会把他送回原地）；
  - **被用户改过名的主题不会被复用**（源要求 `trim(name) = ''` 且 `isNameManuallyEdited = false`；Grimoire 的等价物是标题仍为默认 `'新主题'`）；
  - 归档主题不参与复用。
- 说明一处刻意的语义映射：源还要求 `activeNodeId IS NULL`，而 Grimoire **没有** per-topic active node（见 `/topics/:id/messages` 的 501 拒绝），其「未被触碰」的等价物就是默认标题，这也正是上面那条谓词。
- Verification：`npm test` 542 passed；compat 82；`npm run build` 通过；`audit:cherry-routes` 14/14；`check:migration-matrix` 无畸形行；`visual:check` 通过；typecheck 39 个既有错误不变；探针文件已全部删除。
- **两个剩余依赖也实证可用**：`recycleBinFeedback`（5 个导出）与 `SidebarShortcutService`（service 单例）在 compat 工程里 **import 并求值均成功**；它们只依赖已就位的偏好 shim / logger shim / i18n resolver / toast / shared errors。**因此采用源 `AssistantResourceList` 的所有前置条件已全部满足**——`/assistants`、`/topics`、`/pins`、`/groups`、`/topics/reusable-placeholder` 五条 DataApi 路由本轮补齐，两个剩余依赖实证可加载，组件本身 import + render 均通过。清单已改为「下一步就是接入 shell」。

## `/topics` 列表改成源的真实契约 + 一个游标缺陷（2026-10-10）

- **发现我此前把 `/topics` GET 的契约写错了**：我要求 `sessionId`，但源的 `/topics` 列表**根本不按会话分域**——它的 query 是 `ids` / `cursor` / `limit` / `q` / `inTrash`，返回**全局、游标分页、置顶优先**的列表。源的 `useTopics` 是 `useInfiniteQuery('/topics')`，用我那个契约只会拿到一个它无法翻页的子集。
- 改为真实契约：新建 `src/main/services/cherry-topic-list.service.ts`，实现 keyset 分页、置顶优先排序（复用 `cherry_resource_state.order_key`，即拖拽写入的那一列）、`q` 大小写不敏感子串、`ids` 过滤、`inTrash` 走归档、limit 夹取到 [1,200]。
- **游标设计里我自己先犯了一个错并当场被测试抓到**：`encodeCursor` 写 `[orderKey, id]`，而比较条件用的是 `(pinned, orderKey, id)` —— **两侧不一致**。我在写注释时刚说过"两侧不一致会让分页静默重启"，然后自己写出了这个不一致。已统一为三个分量。
- **第二个更隐蔽的缺陷**：keyset 比较的第一项方向写反了。`pinned` 按 **DESC** 排序，所以"在游标之后"意味着 pinned **更小**；我写的却是 `pinned > ?`——而 pinned 是布尔值（0/1），**没有任何值大于 1**，于是"跨过置顶/非置顶边界的那一页"永远返回空。**所有不翻页的测试仍然通过**，只有那条专门跨边界的测试失败。
- 8 项新单测：置顶优先排序、归档互斥、名称过滤、ids 过滤、**连续翻页不重复不遗漏**、**跨置顶边界翻页**、畸形游标从容处理、limit 夹取。跨边界那条正是抓到方向错误的那条——如果只测"能分页"，这个 bug 会一路带到线上。
- Verification：`npm test` **542 → 550 passed**；compat 82；`npm run build` 通过；`audit:cherry-routes` 14/14；`check:migration-matrix` 无畸形行；`visual:check` 通过；typecheck 39 个既有错误不变。

## 主题列表契约收尾 + 两个契约错误（2026-10-10）

- **`/topics` GET 已改为源的真实契约**（全局、游标分页、置顶优先）并真机验证：5 个主题翻页为 2+2+1，**total 5 / unique 5 / `pagedCleanly: true`** —— 全程翻页不重复、不遗漏。
- **修掉两处我自己的契约错误**：
  1. `GET /topics/latest` 返回的是 `{ topic: Topic | null }`，我原先返回**裸 topic**。按源的声明类型读 `.topic` 的调用方会拿到 `undefined`。已包上信封并真机确认 `hasTopicKey: true`。
  2. 同一路由的 query 键是 **`assistantId`** 而非 `sessionId`，且源用字面量 `'unlinked'` 表示「没有助手的主题」。已按此翻译，而不是当成一个匹配不到任何东西的 id 透传。
  3. `POST /topics` 只读 body 里的 `sessionId`，但**源把所属会话放在 query 上**——注释里我自己都写了这一点，代码却没读。已同时接受 body 与 query。
- **一个探针自身的缺陷值得记**：`const call = (method, p) => api.request({...})` 只声明了两个参数，第三处调用传的 body 被**静默丢弃**，于是 POST 一直 400。我一度以为是路由的取参问题并去改路由（改对了，但那不是这次的病因）。**harness 缺陷与产品缺陷同样表现为"接口报错"**，这次是靠打印服务端返回的错误消息才分开的。
- 游标设计里我犯的另一个错（已在上一条记录）：keyset 比较的第一分量方向写反 —— `pinned` 是 DESC 序，"游标之后"应是 pinned **更小**，而我写成 `pinned > ?`，在布尔列上永远不成立。**所有不翻页的测试都通过**，只有跨置顶边界那条失败。
- Verification：`npm test` **550 passed**；compat 82；`npm run build` 通过；`audit:cherry-routes` 14/14；`check:migration-matrix` 无畸形行；`visual:check` 通过；typecheck 39 个既有错误不变；探针已删除。

## Phase 5：视觉门禁从「单运行」扩到「双运行」，并修掉一个结构性缺陷（2026-10-10）

- **计划的 Phase 5 要求 populated 与 empty 两种 fixture 都验证，但门禁只能查一个。** `visual-compare.mjs` 用单一 `runRoot`（`--run`，默认 `populated`）然后 `process.exit`，所以**空状态从未被任何门禁检查过**——而空状态正是计划点名要求的状态之一。
- **修法**：把比较体包成 `compareRun(name)` 并按运行返回判定，默认检查 `['populated','empty']`；`--run` 仍可聚焦单个。
- **过程中暴露两个真实缺陷**：
  1. **基线目录按文件名平铺**，两次运行会撞名——录制 `empty` 会 `rmSync` 整个 `baseline/` 从而**销毁 populated 基线**（反之亦然）。这正是"只能强制一个运行"的根因。已改为**每个运行一个子目录**。
  2. **变量遮蔽**：像素循环的 `for (const name of runPngs)` 与新增的运行名参数同名，导致所有失败信息报的是**运行名而不是帧名**。已把循环变量改名 `frame`。
- **空状态基线已录制并纳入门禁**：`artifacts/visual/baseline/empty/`（12 帧），与 `populated/` 并列。真机确认空状态渲染正确（会话 0 / 暂无会话 / 可用输入框，无错误边界），而不是空白页。
- **门禁被证明能失败**：把 populated 的 `route-diagnostic.json` 里 `contentTextLength` 从 1018 改成 50 → `populated 对比失败：正文长度变化超出容差（允许 ±102）`，**exit 1**，同时 `empty` 仍独立报通过。恢复后 exit 0。
- **一处已知限制（诚实记录）**：结构化信号层依赖 `route-diagnostic.json`，而该文件只在带 `GRIMOIRE_CAPTURE_ROUTE` 的运行里产生。`populated` 有（`/settings/data`，1018 字符），`empty` **没有**，因此空状态目前只有像素层保护。使其也具备结构化信号需要让空运行带一个捕获路由，属下一步。
- Verification：`npm run visual:check` **双运行均通过、exit 0**；`npm test` 550 passed；`check:migration-matrix` 无畸形行。

## Phase 5 收尾：空状态也具备结构化信号（2026-10-10）

- 承上：把门禁扩到双运行后，我诚实记下「`empty` 没有 `route-diagnostic.json`，只有像素层保护」。这一条**当场修掉了**，而不是留着。
- 根因：`visual-baseline.mjs` 的 capture 不设 `GRIMOIRE_CAPTURE_ROUTE`，而 `route-diagnostic.json` **只在该变量存在时写出**。因此两个 fixture 都缺结构化信号——`populated` 之所以有，是上一轮我用探针单独跑过带路由的捕获。
- 修法：两个运行**都带捕获路由**（`/settings/data`，因它在有/无数据两种库上都有确定性面板文本，长度是有意义的信号）。已重录，现在：
  - `populated`: `{pathname:'/settings/data', contentTextLength:1035, fatalFallback:null}`
  - `empty`: `{pathname:'/settings/data', contentTextLength:919, fatalFallback:null}`
- **门禁被证明能失败，且逐运行独立**：把 `empty` 的诊断改成 12 → `empty 对比失败：正文长度变化超出容差（允许 ±92）`，**exit 1**，同时 `populated` 仍报通过。恢复后 exit 0。
- 这一层的价值在于**像素容差看不出的变化**：页面从「3 条结果」变成「0 条结果」而布局不变时，像素对比会通过，结构化信号会失败。
- Verification：`npm run visual:check` 双运行通过 exit 0（且已 mutation 验证可失败）；`npm test` 550 passed；`npm run build` 通过；`audit:cherry-routes` 14/14；`check:migration-matrix` 无畸形行；typecheck 39 个既有错误不变。

## Phase 5：状态帧（failed / running / message-blocks）纳入门禁（2026-10-10）

- 计划要求 loading/error/retry/分组/tool/permission 等**状态**覆盖。此前 fixture 已经 seed 了 failed / running / 工具块三种会话，但**没有任何一帧专门捕获它们**——它们只会"碰巧"出现在某帧里，若状态本身回归，12 帧仍会全部通过。
- 新增状态帧阶段：fixture 现在返回状态会话的 **id 与标题**，capture 在矩阵之后导航到 `/app/chat`、**按真实渲染的标题点击对应行**（走用户的同一条路径，而不是注入 renderer 状态），再截图。产出 `populated-state-{failed,running,tool}.png`。
- **两次"截了图但证明不了任何事"的失败，都被截图本身揭穿**：
  1. 第一次：capture 跑在 `/settings/data`（基线脚本的捕获路由），**聊天 rail 根本不在屏幕上**，点击全落空，三帧一个都没写——而 12 个矩阵帧全部成功，所以失败是**静默**的。
  2. 第二次：行查找用了我臆造的 `data-item-id`（行上并不存在），回退又按帧名猜中文串，于是**永远匹配不到**，`failed` 那帧里坐着的其实是**运行中的会话**。这是最典型的"门禁看起来通过"。
  修法：改为按 fixture 自己声明的标题匹配真实行文本。
- **已核对截图内容而非只看文件存在**：`failed` 帧现在是「基线·失败的会话 + 该行高亮 + 错误块『请求失败：上游返回 429（速率限制）。可重试。』」；`tool` 帧是「基线·长列表与消息块基线 + 时间戳 + 可折叠错误行 + 语法高亮的 TypeScript 代码块」。
- **门禁被证明能抓到状态帧被调换**：把 `populated-state-failed.png` 换成 `populated-state-tool.png` → `像素差异 6.19% 超过 2.00%`，**exit 1**，并指名具体帧。恢复后 exit 0。
- 现在基线为 **populated 15 帧**（12 矩阵 + 3 状态）与 **empty 12 帧**，两者都强制。
- Verification：`npm run visual:check` 双运行通过 exit 0（已 mutation 验证）；`npm test` 550 passed；`npm run build` 通过；`audit:cherry-routes` 14/14；`check:migration-matrix` 无畸形行；typecheck 39 个既有错误不变。

## Phase 2：源 AssistantResourceList 的 context 已就位（2026-10-10）

- 上一轮实证了源 `AssistantResourceList` 在 compat 工程里 **import + render 都通过**，前提是它的 hook 依赖（`/assistants`、`/topics`、`/pins`、`/groups`、`/topics/reusable-placeholder`）都已补齐。这一轮补上它真正读取数据的**通道**：context。
- **为什么不挂源 `ResourceViewSourceProvider`**：它计算同一个值，但它读 `useTabs()` 来决定「源视图是否该加载」（`shouldLoadResourceViewSource(tabs, activeTabId, 'assistants')`）。那是**标签页外壳**的问题，而 compat 窗口没有标签页外壳——与 About 页 `useOpenReleaseNotes` 的拒绝理由同源。为一个加载门控去挂整套标签生命周期，得不偿失。
- **复用的是真正要紧的部分**：新建 `CompatResourceViewSources.tsx`，用**源自己的** `useRawAssistantTopicsSource`（它经 DataApi 取数）与**源自己的** `deriveAssistantTopicsView` 投影，只把「加载门控」在 compat 侧决定（compat 始终加载——聊天面是唯一消费者且渲染时一定在屏幕上）。
- **验证的是 context 的值，不是「渲染没报错」**：`CompatResourceViewSources.test.tsx` 用一个**通过源 hook** 读取的 Consumer 断言 `topics.length:rendererTopics.length === 1:1`。只断言"渲染成功"会让一个提供空值的 provider 也通过。
- 过程中确认了一条重要事实：源的 `useInfiniteQuery('/topics')` 消费的是**分页信封**（读每页的 `items`），不是裸数组。测试最初返回裸数组，`useInfiniteFlatItems` 产出 `[undefined]` 并在 `topic.id` 处抛错——**这反过来印证了我上一轮把 `/topics` 改成 `{items,nextCursor}` 是对的**。
- Verification：compat **82 → 83 passed**；`npm test` 550 passed；`npm run build` 通过；`audit:cherry-routes` 14/14；`check:migration-matrix` 无畸形行；`visual:check` 双运行通过；typecheck 39 个既有错误不变。
- **仍未做**：把这个 provider 与源 `AssistantResourceList` **真正接进 shell 替换 compat 的 assistant 投影 rail**——context 与组件本身都已验证可用，剩下的是外壳接线本身。

## 源 AssistantResourceList 集成验证 → 抓到一个真实契约错误（2026-10-10）

- **把源组件与源数据 hook 串起来做集成测试**（`CompatAssistantListIntegration.test.tsx`），断言的是**渲染出助手名**（`写作助手`），而不是"渲染没报错"。这条链是：DataApi → 源 `useRawAssistantTopicsSource`/`useAssistantsApi` → 源投影 → 源组件。
- **它抓到一个真实生产缺陷**：`GET /assistants` 返回的是**裸数组**，而源声明的响应是 **`OffsetPaginationResponse<Assistant>`**（`{items,total,page}`）。源的 `useAssistantsApi` 读 `data?.items`，所以拿到裸数组时会**静默回退到 `EMPTY_ASSISTANTS`**——请求 200、有响应体、页面却一个助手都不显示。已改为正确的信封。
- **过程中推翻了自己一个假设**：我先写了个 context provider（`CompatResourceViewSources`）以为组件从 context 取数，集成测试立刻报 `Cannot destructure property 'topics' of 'assistantTopicsSource'`——该组件是**通过 prop** 接收 `assistantTopicsSource` 的。provider 已删除；正确的接入方式是调用方用源的 `useRawAssistantTopicsSource` + `deriveAssistantTopicsView` 构造 prop。
- **还有一个测试自身的竞态被修掉**：最初用固定 `sleep(400)` 等数据，而首次渲染发生在 fetch 之前（日志显示 `RAW=0` 然后 `RAW=1`），于是测试是"看运气"。改为 `waitFor(渲染出助手名)`，等行为而不是等时间。
- 与上一轮 `/topics` 的发现合并看，规律很清楚：**源的每个集合端点都有自己的信封类型**（`/topics` 游标分页、`/assistants` 偏移分页），返回裸数组会让 hook 静默降级为空列表——这是最难发现的一类错误，因为 HTTP 层一切正常。
- Verification：compat 83 passed（含新集成测试）；`npm test` 550 passed；`npm run build` 通过；`audit:cherry-routes` 14/14；`check:migration-matrix` 无畸形行；`visual:check` 双运行通过；typecheck 39 个既有错误不变。

## Phase 2 完成：源 AssistantResourceList 接入 shell（2026-10-10）

- **compat 的 assistant 投影 rail 已被源 `AssistantResourceList` 替换**，`/app/agents` 真机截图确认：源组件渲染出自己的头部（添加助手 + 筛选菜单），此前 compat 自建的「时间 / 显示归档」按钮组随之消失；话题 rail 保持不变。
- **接入契约**：`assistantTopicsSource` 是 **prop**（不是 context——early 的 provider 方案被集成测试推翻），在 rail 内用源的 `useRawAssistantTopicsSource` + `deriveAssistantTopicsView` 构造。
- **删掉了真正变成死代码的部分**：`projectAssistant`、`CompatAssistantItem`、`assistantItems`、`assistantStatus`、以及喂给它们的 `useResourceEntityRail` 调用。
- **四条 compat 测试按新语义重写**（它们断言的是被替换掉的 compat 半边的接线）：话题选择、话题错误重试、话题 rail 的排序开关、以及手动排序开关——最后一条从「两个 rail 各一个」改为「**恰好一个**」，这样 compat 半边若被误恢复会立刻失败。助手侧的行为覆盖由 `CompatAssistantListIntegration.test.tsx` 承担。
- **我自己在清理时犯了错，且被测试立刻抓住**：用一条正则删除死代码时匹配过宽，**连带删掉了 `resourceStatus`、`topicGroup`、`projectTopic`、`topicItems`、`assistantTopicsSource`** 定义。测试报错依次暴露（`resourceStatus is not defined` → `topicItems is not defined` → `assistantTopicsSource is not defined`），全部按调用点契约重建（`resourceStatus` 的优先级：error > loading > empty > idle；`topicGroup` 沿用 session rail 的今天/昨天/本周/更早分桶）。
  教训：**在 400 行的组件里用多行正则删代码，等于用散弹枪做手术**——应该按明确的起止标记逐段删除并每步编译。
- Verification：compat **83 passed**；`npm test` 550 passed；`npm run build` 通过；`audit:cherry-routes` 14/14（`/app/agents` 截图已核对）；`check:migration-matrix` 无畸形行；`visual:check` 双运行通过；typecheck 39 个既有错误不变。

## 许可证矛盾结案 + 一个真实的合规缺口（2026-10-10）

- **长期挂着「AGPL-3.0 LICENSE vs 各包 MIT 声明」的矛盾这次结案了**，方法是从文件本身读事实而不是继续记"未解决"：
  - `src/vendor/cherry/source/LICENSE` 是 **AGPL-3.0**，且它是整棵树里**唯一**的许可证文件（`find -name 'LICENSE*'` 只返回一条）。
  - 四个 workspace 包声明 `"license": "MIT"`，但**背后没有任何许可证文本**（无 `packages/*/LICENSE`）。
  - 这些包是**源码别名后内联进产物**的（`vite.config.ts` 把 `@cherrystudio/ui` 指向 `packages/ui/src`；构建产物里已无 `@cherrystudio` 说明符），不是作为外部依赖被消费。
- **结论：以 AGPL-3.0 为准**。`package.json` 里的 SPDX 字段是作者的声明，不是额外授权，也不能覆盖树内唯一真实的许可证文本——否则任何贡献者改一个字段就能给整个仓库换证而无文本支撑。MIT 在这个方向上与 AGPL 兼容，所以实际义务是**署名通知**，不是权限问题；且 MIT 的署名要求与 AGPL 的源码可得要求**都已在结构上满足**（vendored 闭包保留 LICENSE、通知文件记录署名、源码在仓库内）。
- **同时发现并修掉一个真实合规缺口**：`THIRD_PARTY_NOTICES.md` **没有进 `extraResources`**，所以打包出的应用**完全不带任何署名**。已把通知文件与 Cherry 的 AGPL LICENSE 加入 `extraResources`（YAML 已解析校验，两个源路径都已确认存在）。这类缺口任何测试都抓不到——文件在源码树里，而测试看的就是源码树。
- 诚实记录的残余：本次结论回答的是**哪份许可证管辖**，不是**哪几行代码出自哪里**；逐文件归属未追溯。只有当下游想把那四个包单独作为 MIT 代码取用时才需要，而 Grimoire 的消费方式是内联进 AGPL 产物。
- Verification：`npm test` 550 passed；compat 83 passed；`npm run build` 通过；`audit:cherry-routes` 14/14；`check:migration-matrix` 无畸形行；`visual:check` 双运行通过；typecheck 39 个既有错误不变。

## 一个静默失效的构建配置 + 署名现已随发行版分发（2026-10-10）

- 承上：我判断"通知文件必须随发行版一起走"是对的，但**第一次的修法无效**——把条目写进 `electron-builder.yml` 后打包，产物里**什么都没有**，而打包**退出码是 0**。
- **顺着这条线查出真因：`electron-builder.yml` 整个文件从未被使用。** `package.json` 里有 `build` 键，electron-builder **优先读它并忽略同名 YAML**。证据是决定性的：一次干净的 `--dir` 打包产出了 `resources/python/`（只在 package.json 里声明），却**没有** `agent-runtimes/`（只在 YAML 里声明，同一个 `extraResources` 键）——包括 `python` 那条在内的所有 YAML 条目一直静默失效。
- **我差点把它当成"我的条目写错了"**：三次重打包、换 `--config` 显式传路径、删掉 `release/` 重建，全都是同样的空白结果。真正让我转向的是**对照一条与我改动无关的既有条目**（`agent-runtimes`）——它也缺席，说明问题不在我的写法，而在配置根本没被读。
- **修法与验证**：
  - 真正生效的 `package.json` → `build.extraResources` 加上 Cherry 的 AGPL LICENSE（`python` 那条本来就在这里，所以它是唯一真在生效的）。
  - 重新打包并在产物中**确认文件存在**：`release/win-unpacked/CHERRY_STUDIO_LICENSE (AGPL-3.0).txt`（松散文件，接收方可直接阅读，无需解包）；`THIRD_PARTY_NOTICES.md` 在 `app.asar` 内（`files` 列表已含它，用 `asar list` 确认）。
  - `electron-builder.yml` 改成一份**说明为何不可用的指针文件**并保留原文备份，而不是直接删除——它在用户的工作树里，且"改了有效果"的错觉正是它危险的地方。
- 这一条值得单独记：**配置层面的静默失效比代码缺陷更难发现**，因为没有测试会失败、没有错误会打印、退出码还是 0。判断方式必须落到"产物里到底有没有那个文件"，而不是"配置里写了没有"。
- Verification：`npm test` 550 passed；`npm run build` 通过；打包 `--dir` 退出 0 且产物内已确认署名文件；`audit:cherry-routes` 14/14；`check:migration-matrix` 无畸形行；`visual:check` 双运行通过；typecheck 39 个既有错误不变。

## 回收站 `/archives` 实现 —— 又是一条被我错误记成 BLOCKED 的项（2026-10-10）

- **`/archives` 记了好几轮的 BLOCKED，理由是「源要求 `deleted_at IS NOT NULL`，而 Grimoire 的删除是物理删除、没有 `deleted_at`」。这个判断是错的。** 实际读代码发现：**三条归档路径本来就在写 `deleted_at`，恢复时清空**——`archiveAiTopic` 与 `archiveAiAssistant` 显式写，`archiveAiSession` 经由 `updateAiSessionResource` 的 `archived ? now : null`。回收站的存储在**归档功能落地那天就已经在填充了**，缺的只是投影。
- 已实现 `GET /archives`（`src/main/services/cherry-archive.service.ts`）：联合 topics/assistants/sessions 三个域、`deletedAt DESC` 排序、游标分页、源形状的合成 id（`sessions:<uuid>`，UI 靠冒号前缀路由恢复）。
- **真机验证**：空仓 → 0；归档 → 1 条（id `sessions:ai_session_…`、域/名正确、`deletedAt` 是**数字**）；恢复 → 回到 0。数字类型是刻意的——源的 UI 按日期格式化它，字符串会渲染成 `Invalid Date` 而不是报错。
- 6 项单测，其中三项针对容易写错的地方：**恢复后条目必须离开回收站**（否则实体同时出现在两个列表里，且恢复永远不生效）、**跨页游标**不重复不遗漏、**游标指向的行已被恢复时从中断处继续**而不是从头重来（另一个窗口里恢复是真实竞态）。
- 写测试时我自己的一个假设也错了并被纠正：断言「最新删除的在前」时给助手手写了固定日期，而 `archiveAiSession` 打的是 **NOW**，于是"现在"赢了固定日期、顺序与我预期相反。**排序是对的，是我的测试数据不确定**；已把所有时间戳显式固定。
- 这条与之前几次同形：**BLOCKED 的理由来自读代码/推断，而不是运行或读实现**。`/archives`、`GeneralSettings`、`A6 Composer 附件`、`C1 行组件`、`C2 状态块`、`AssistantResourceList` 全部如此。
- Verification：`npm test` **550 → 556 passed**；compat 83；`npm run build` 通过；`audit:cherry-routes` 14/14；`check:migration-matrix` 无畸形行；`visual:check` 双运行通过；typecheck 39 个既有错误不变。

## 回收站生命周期完整验证 + 一个既有测试 flake（2026-10-10）

- 补上回收站页面需要的两条会话路由：**`POST /sessions/:id/restore`**（此前只有 topics/assistants 有，恢复会话会 404，而页面按行报错——是"部分失败"而非全坏，更难发现）与 **`DELETE /sessions/:id`** 的**永久删除**语义。
- **永久删除带 409 守卫**：只有**已在回收站**的会话才能永久删除；对活动会话调用返回 409「请先归档」。真机完整验证：活动会话 DELETE → **409**；归档 → 回收站 1 条；`POST …/restore` → **200**、回收站归 0；再归档 → DELETE → **200**、回收站 0、`GET /sessions/:id` → **404**（确实销毁）。
- **发现一个既有的间歇性测试 flake，并如实记录而非忽略**：`CompatProviderMcpPanel > loads provider and MCP status through the Host Bridge` 在**整套** compat 运行下约 7 次里失败 1 次；**单独运行 8/8 全过**，且该文件**不在本轮改动范围内**（`git status` 为空）。
  - 成因判断（读代码得出，未逐帧验证）：该测试用 `await findByText(...)` 等 DOM，随后直接 `expect(host.providers.list).toHaveBeenCalledOnce()`——DOM 出现与回调计数之间没有同步点，整套运行时的调度差异会让这条断言偶发地跑在计数之前。
  - **不把它记成"我的改动的副作用"**：改动范围对不上，且单独运行稳定。也不记成"无关紧要"：间歇性红灯会训练人忽略红灯。
  - 下一步（已记入清单）：把该断言改为 `await waitFor(() => expect(...).toHaveBeenCalledOnce())`，让等待对象与断言对象一致。
- Verification：`npm test` 556 passed；compat 连续运行 3 次 83/83（第 4 次复现上述既有 flake）；`npm run build` 通过；`audit:cherry-routes` 14/14；`check:migration-matrix` 无畸形行；探针已删除。

## `/models` DataApi 路由桥接 + provider PATCH models 字段（2026-10-11）

`GET /models` 已桥接：从 `providers.models` JSON 数组投影出源 `Model[]` 形状（`providerId::modelId` 复合 id、`capabilities: []`、`supportsStreaming: true`、`isEnabled: true`）。同时修复了 `applyProviderUpdate` **漏掉 `models` 字段**的问题——PATCH 写了模型列表但从不存它，所以一次成功的模型同步在下次读取时就消失了。

**未伪造**：capabilities、pricing、imageGeneration、contextWindow、maxTokens 等——Grimoire 不存这些。一个没有 image-generation capability 的模型就不出现在绘画页的模型选择器里，这是**真话**而不是遗漏。

**真机验证**（用户的真实数据库）：`/models` 返回 6 个模型（5 个来自 `openai.com` provider + 1 个来自 `gpt6luna`），id 格式正确（`pvd_xxx::model-name`）。`/app/code` 页不再报「`/models` 路由未桥接」，CLI 工具列表完整渲染。

Verification：`npm test` 690 passed；compat 83 passed；`npm run build` 通过；`audit:cherry-routes` 26/26；`visual:check` 双运行通过。

## `file.*` IPC 桥接 + 三个只有真机才能挖出来的缺陷（2026-10-10）

Files 页除数据读取外还调 12 条 `file.*` IPC 路由，此前**一条都没有**。现已桥接：`batch_get_metadata`、`batch_get_physical_paths`、`batch_get_dangling_states`、`batch_create_internal_entries`、`batch_remove_from_library`、`rename`、`show_in_folder`。

类型 `type` 用的是**生成的源表**（`cherryFileTypeForExtension`），不是 main 里那张小表——否则 `.rb` 在这里报 `other`、在页面的 文本 分组里却是文本，两处自相矛盾。

### 缺陷一：FK 失败 —— 只有真机上传才暴露

第一次真机跑上传，两条都返回 **`FOREIGN KEY constraint failed`**。原因：`ai_attachments.session_id` 是 **`NOT NULL` + `FOREIGN KEY REFERENCES ai_sessions(id) ON DELETE CASCADE`**——这张表是**按会话建模**的，而库里的一份文件**根本没有会话**。我原先用的哨兵 `'__library__'` 不在 `ai_sessions` 里，被 FK 直接拒绝。

**CASCADE 比 NOT NULL 更危险**：如果哨兵恰好撞上一个真实会话 id，那份库文件会在该会话被删除时**静默消失**——用户从未请求的数据丢失。

- 修法：**schema v31** 把 `session_id` 改为可空（表重建，因为 SQLite 无法原地去掉 NOT NULL），FK 保留（会话附件仍然级联），库文件用**真正的 NULL**。
- `importAiAttachment` 的 `sessionId` 改为 `string | null`；去重查询从 `=` 改为 **`IS`**——SQL 里 `= NULL` 永远不匹配，否则每次上传都会重复插入一份。
- 迁移已 mutation 验证：把迁移调用去掉，2 个用例失败。

**单测不可能抓到它**（数据库被 mock 掉），这正是「真机门禁不可替代」的又一例。

### 缺陷二：类型过滤器与页面分组不一致

见上一节：main 已有的扩展名表把约 30 个当文本，源有 1436 个。改用生成表后一致。

### 缺陷三：`fs.promises.unlink` 未 await —— 真实文件泄漏

`batchRemoveFromLibrary` 删掉最后一份引用后用 `fs.promises.unlink(...).catch(...)` **即发即忘**。函数返回时文件往往还在：调用方（或测试）立刻检查会看到文件仍存在；进程在这段窗口退出就**永久泄漏**。

- 这是**全量套件**先报出来的（单独跑 16/16 全过），一开始看起来像 flake——但它在两次运行里都出现，于是去查断言而不是重跑。
- 改为同步 `fs.unlinkSync`：「已从库中移除」必须在函数返回时**字节已经消失**。锁定文件失败不影响库更新，所以用 try/catch 而不是让它失败整个批次。
- 修后连跑 3 次全绿。

### 数据安全属性已单独验证

「上传是 COPY 不是 MOVE」「从库中移除不动用户原文件」是**数据丢失级**的性质，因此用真实构建产物单独验证：上传后源文件仍在且内容不变；移除后源文件仍在。二者都通过。

### 真机端到端

上传 2 个文件 → `total: 2` 且能按名列出 → 路径解析、dangling（`present`）、重命名、在文件夹中显示、移除（`total: 1`）全部返回真实结果。`file.batch_trash/restore/permanent_delete` 三者**一起拒绝**（NOT_IMPLEMENTED）——Grimoire 没有文件回收站，半实现会让文件进入应用无法列出也无法恢复的状态，而源 UI 会在上面显示「恢复」和「永久删除」。

Verification：`npm test` **690 passed**；compat 83 passed；`npm run build` 通过；`audit:cherry-routes` **26/26**；`check:migration-matrix` 92 行无畸形；`check:cherry-file-type-map` 一致；`visual:check` 双运行通过；`tsc --noEmit` 0 错误；探针已删除。

## `/files/entries` 桥接 + 一个会被自己蒙蔽的类型过滤器（2026-10-10）

### 决定真相来源：不新建表

源的 `/files/entries` 是一张扁平文件库表。Grimoire **已经有两种文件**，分在两处，且互不重复：

- **`ai_attachments`** —— 导入时被 Grimoire **复制进自己的目录**的文件。对应源的 `origin:'internal'`：内容归自己所有，`size` 权威、有 sha256。
- **`image_refs`** —— 只**引用**用户自己路径的文件（`storage_mode='external'`）。对应源的 `origin:'external'`：文件可能在应用外被改动或消失，因此**不存 size 快照**。

新建第三张表会给同一批文件制造第二份真相和一个没人要求的同步问题，所以库是**读时求并集**。

### 明确「不伪造」的字段

源的库是这两个 store 的超集，它还带 `cleanupPolicy`（GC 意图）、external 的 `contentHash`、internal 的 per-entry 回收站、持久 ref count。Grimoire 都没有，因此：

- `cleanupPolicy` 一律报 `'manual'`——这个值的含义是「不要自动回收」，而对 Grimoire 持有的每个附件**这恰好是真的**（应用中没有任何路径会回收附件，删除永远是显式的）。
- external 的 `contentHash` 报 `null`（源文档定义为「未知」，而 Grimoire 确实不知道）；internal 报 `sha256:<hex>`，无摘要则同样 `null`。
- **`deletedAt` 整个不出现**。`ai_attachments.status='deleted'` 是软删除，但那是 Grimoire 自己的列、自己的语义；映射到源的回收站等于**承诺一个源 UI 会显示、而 Grimoire 无法兑现的「恢复」流程**。改为**排除**它们，与活动列表一致。
- `trashTotal` 恒为 `0`，理由同上（无文件恢复流程），并且 `inTrash=true` 的查询**返回 400** 而不是静默回一份错误集合。

### 类型过滤器：一个会用「看起来能用」骗过自己的实现

Files 页的 类型 列由源 `getFileTypeByExt` 渲染，而后端 `fileType` 过滤我最初接了 main 里**已有的** `file-bridge.service` 表（遵循「优先复用」原则）。**这个复用是错的**，通过对比两张表发现：

| | 源表 | main 表 |
|---|---|---|
| image | 6 | 9（多 `svg/ico/avif`） |
| video | 6 | 7（多 `webm`） |
| audio | 5 | 7（多 `m4a/wma`） |
| document | 9 | 10（多 `ppt/rtf`，缺 `odp`） |
| **text** | **1436** | **约 30** |

源的 `textExts` 来自 **linguist 数据库**（`codeLanguages.ts`，3,678 行生成代码）。后果：选「文本」会**隐藏** `.rb`/`.swift`/`.kt` 等数百个文件，而列里明明把它们显示为 文本——**过滤器看起来是坏的**。

- **改法：从源生成，而不是近似。** 新增 `scripts/generate-cherry-file-type-map.mjs`，读 vendored 源的两个文件，产出 `cherry-file-type-map.generated.ts`（带源摘要），并配 `check:cherry-file-type-map` 门禁。源文件**未被修改**。
- 生成器对形状变化**拒绝输出**：解析到的 text 扩展少于 100 条就报错退出，否则一个「看起来合理」的小表会静默误分类代码文件。
- 语义与源一致：`other` = 无扩展名 **或** 不在任何已知集合中（对应源主进程的 `notInArray` 条件）。

### 端到端验证（不是只跑单测）

单测把数据库 mock 掉了，而**线上库是空的**——空库渲染成「暂无文件」什么也证明不了。因此额外对**构建产物**做了种子数据验证：4 条记录从两个 store 求并集，`text` 只返回 `.rb`、`image` 只返回 `.png`、`other` 只返回未知扩展名，stats 正确，不存在的 id 返回 `null`。另外真机确认类型侧栏 6 个分组全部渲染且可点击、点击不报错。

### 顺带修掉审计的第三个盲区：冷启动假失败

全量重建后**第一次**跑审计，26 条里挂了 8 条——**正好是列表末尾那 8 条**。再跑就全过。这是本会话第四次遇到「失败跟随位置而非身份」。

- 成因：审计开机后固定 `sleep(6000)`。**重建后的第一次运行**所有懒加载 chunk 都还是冷的，6 秒不够。
- 改成**等就绪信号**（shell 已挂载且 hash 已确定）而非等固定时长，并保留 45 秒上限。
- **就绪守卫本身已 mutation 验证**：把条件改成永不成立，脚本报「未在 45000ms 内就绪，拒绝基于未挂载窗口给出逐路由结论」并退出，**而不是**输出一堆假 FAIL。
- 用同一次「重建后立刻跑」的复现场景验证：现在通过。

Verification：`npm test` **669 passed**；compat 83 passed；`npm run build` 通过；`audit:cherry-routes` **26/26**；`check:migration-matrix` 91 行无畸形；`check:cherry-file-type-map` 一致；`visual:check` 双运行通过；`tsc --noEmit` 仅剩 2 个既有 media.ipc 错误；探针脚本已删除、遗留的 5 个 Electron 进程已清理。

## 点击验证 launchpad 磁贴：发现并修掉三条「看似可用实则未实现」的导航（2026-10-10）

上一轮挂载了 7 条 app 路由。这一轮去验证**它们能不能被点到**——因为「页面在深链接下能渲染」和「用户点得到」是两件事，而 `useOpenReleaseNotes` 的教训正是这个（一个能用的页面挂在一个悬空导航后面）。

### 第一次误判（我的探针，不是产品）

用 `element.click()` 点磁贴，hash 完全不变、控制台零错误，`window.location.hash` 的 setter instrumentation 记录到**零次写入**——看起来 `navigate` 从未被调用。我一度判定「所有磁贴都是死的」。

**错了。** dnd-kit 在拖拽包装 DIV 上设了 `role="button"`，我的 `querySelectorAll('button,[role="button"],a')` **先匹配到外层 DIV**。点父元素不会向下触发子 `<button>` 的 onClick。改用 CDP `Input.dispatchMouseEvent` 发**真实指针序列**（mouseMoved → mousePressed → mouseReleased）后，磁贴全部正常跳转。

教训与之前几次同形：**合成事件测不出 dnd-kit 包装过的控件**。`el.click()` 不产生 pointerdown，而 dnd-kit 挂在 pointerdown 上。

### 第二次是真实缺陷：三条磁贴跳到「路由未实现」

改用真实点击后逐个验证 10 个磁贴，发现三条落在**未注册**的路径上：

| 磁贴 | 跳到 | 原因 | 处理 |
|---|---|---|---|
| 绘画 | `/app/paintings/zhipu` | 源的 `getSidebarMenuPath` 走 `resolveUrl` → `/app/paintings/<默认provider>`，而源的 `routes/app/paintings/$.tsx` 是**catch-all**，任意子路径都渲染同一个 `PaintingPage`（源文件明确写了 splat **不是**深度链接） | 加 `paintings-splat` 模式；现渲染真实页面 |
| 文件 | `/app/files` | 只是没注册 | 注册并挂载源 `FilesPage` |
| 小程序 | `/app/mini-app` | **真实 BLOCKED**：该域在源架构里是标签页承载 | 加专门的 BLOCKED 诊断页，写明原因与解除条件 |

**这三个只有靠点击才会暴露**——读注册表、读路由清单、跑哈希审计都看不见，因为审计从来不走磁贴。

### 顺带修掉一个「门禁只报通过的地方」

`/app/mini-app` 原本落到通用「路由未实现」页，那对用户是**无信息**的（列了一堆支持的路径，却不说这条为什么不行）。现在它渲染专门的诊断，并像其他路由一样纳入审计的**内容断言**（断言它必须继续写明「标签页承载」这个依赖，否则徽章式的空壳也会通过）。

### 又一次「失败跟着位置走」

批量点 10 个磁贴时，**正序的最后两个失败**。我把同一个批次**倒序**再跑一遍：全部通过，包括正序失败的那两个。同一个名字在不同位置结果不同 ⇒ 探针在多次迭代后退化，不是磁贴本身有 bug。加长 settle 后正序也全过。这是本会话第四次遇到「失败跟随位置而非身份」，也第四次靠这个特征避免误判产品。

**10/10 磁贴实测可点且落到诚实目的地**（其中 1 条落到明确标注的 BLOCKED 诊断）。

Verification：`npm test` **571 passed**；compat 83 passed；`npm run build` 通过；`audit:cherry-routes` **26/26**（含内容断言）；`check:migration-matrix` 91 行无畸形；`visual:check` 双运行通过；探针脚本已删除。

## 挂载 7 条 app 路由 + 修掉路由审计的两个盲区（2026-10-10）

### 挂载（23 条路由，registry 16 → 23 个 id）

`/app/launchpad`、`/app/browser`、`/app/knowledge`、`/app/notes`、`/app/code`、`/app/translate`、`/app/paintings` 已挂载源页面。路径全部取自源自己的路由文件（`createFileRoute('/app/launchpad')` 等），不是拼出来的。

挂载过程中撞到三类真实依赖问题，都按「装依赖 / 用源文件已存在的等价物」解决，**没有改写源文件**：

- **`@tiptap/extension-drag-handle-react` / `-table-of-contents` / `@tiptap/markdown` 缺失**（`NotesPage` → `RichEditor`）。按已有 tiptap 的精确版本 `3.26.1` 装上。
- **`@cherrystudio/extension-table-plus@3.0.13` 的 `exports` map 是坏的**：声明 `"import": "./dist/index.js"`，但发布包里**只有 `index.mjs`**，`index.js` 根本不存在（四个已发布版本 3.0.10–3.0.13 全都如此）。普通 Node 解析走 CJS 分支能过，打包器解析 ESM 分支必挂。已在 `vite.shared.config.ts` 里 alias 到**实际存在的那个文件**，并写明这是上游打包缺陷。选择 alias 而不是手改 `node_modules`：后者会被下一次 `pnpm install` 抹掉、且不留任何记录。
- **`BrowserPage` 是具名导出**（源路由文件写的是 `import { BrowserPage }`），且 `initialUrl` 必传——不传就 `Cannot read properties of undefined (reading 'startsWith')`。已按源路由 `validateSearch` 的**兜底分支**传 `about:blank`。

### 修掉的两个审计盲区（这一轮最重要的部分）

**盲区一：路由清单是硬编码的，注释却在说它是派生的。** `audit-cherry-routes.mjs` 里那段写着「Every id in `COMPAT_ROUTE_PATHS`」的注释，下面躺着 16 个手写字面量。我新注册 7 条路由后，脚本**照旧打印 "all 16 routes rendered"** —— 一个在加路由的瞬间就停止审计新路由、却用通过的语气汇报的门禁。已改成**从 registry 文本解析**路径，解析结果为空时**直接报错退出**（否则会变成「all 0 routes rendered」并静默通过）。

**盲区二（更严重）：门禁分不出「路由通了」和「渲染了正确的页面」。** 判据原本是 `!unimplemented && !boundary && body.length > 40`。我做了 mutation 验证：把 registry 的**键**改名（`launchpad` → `launchpadX`），**路径不动**——hash 照常解析、shell 落回 chat 主槽、launchpad 路由渲染出的是**聊天输入框**。审计报 **OK**：207 字符的聊天外壳，超过 40，无边界、无「路由未实现」。这正是脚本自己开头写的「the interesting failure」，而它完全看不见。

- 修法：加 `ROUTE_SIGNALS` 逐路由**内容断言**（该页真实渲染出的字符串）。一个**字面量** `>` 40 字符的判据挡不住任何东西，因为每个页面都套着同一层外壳。
- **信号串全部来自实际 dump，不是猜的**：我第一版猜的三处（`辅助智能体`、`大师之作`、`依赖设置`）**全错**，是检查把我纠正过来的——它先失败、我再去读真实渲染文本。这本身就是这个检查值得存在的证据。
- **同时避免了一类会自我欺骗的信号**：侧栏在所有路由上都渲染 会话/助手/主题/Provider/MCP/外观/常规/数据/依赖/通知/关于/提示词/用量/快捷键/回收站。如果信号取自这些词，**一个什么都没渲染的路由也会通过**。因此每个信号都换成了页面独有的串（`添加提示词`、`最近 30 天`、`批量管理`、`退出全屏`、`暂无知识库`、`导入浏览器数据`…）。
- **用同一次 mutation 复验**：现在报 `FAIL`、`missingSignals: ["应用"]`、**exit 1**。恢复后 23/23、exit 0。

Verification：`npm test` 566 passed；compat 83 passed；`npm run build` 通过；`audit:cherry-routes` **23/23**（含内容断言，且已 mutation 验证可失败）；`check:migration-matrix` 无畸形行；探针脚本已删除。

## 构建/测试配置合流 + 依赖全量枚举（2026-10-10）

这一轮没有新增页面，但修掉了两个**会让后续每一轮都失真**的结构问题，并把「剩余 app 路由」的阻塞面从猜测变成清单。

### 1. `vite.config.ts` 与 `vitest.config.ts` 已经发散（真实缺陷）

两个配置各写一份 alias 列表。测试配置**缺少** `useOpenReleaseNotes`、`MermaidPreview` 两个 shim、`resolve.dedupe`，以及**全部四个 `__APP_*__` 全局**。后果分两类：

- **测试解析到生产根本不加载的模块**：任何走 `useOpenReleaseNotes` 的文件在测试里拿到源实现（读 `TabsProvider`），而窗口里拿到 shim。测试绿不代表产物对。
- **页面在测试里抛 `__APP_EDITION__ is not defined`**：这正是上一轮在真机上抓到的同一类缺陷，只是换了环境。四个页面（launchpad/paintings/miniApps）在测试里全挂，在窗口里正常——**一个对产物什么都没说的红灯**。

修法：抽出 `vite.shared.config.ts`（`appDefines` / `compatAliases` / `dedupePackages`），两个配置都从它取。**这不是重构偏好，是因为手抄两份已经出错了**：合流后 shim 与全局按构造同时存在于两侧，而不是靠记得。

### 2. 测试 scaffold 与真机 preload 面不一致（同类问题）

`test-setup.ts` 的 `window.api` 只有 `preference.onChanged`。于是任何经源 `useIpcOn` 订阅的页面在测试里报 `Cannot read properties of undefined (reading 'on')`——**与产品缺陷同形**，我据此把两个页面误记为 blocked。现已补齐 `ipcApi`/`dataApi`/`cache` 三个面，且**故意用失败分支**（`request` 返回 404 式错误信封而非 `{ok:true,data:[]}`）：空数据会被测试读成「能用」，那是伪造成功。

同时 `test-setup.ts` 现补充 `await initI18n()`。此前所有页面在测试里渲染的是**原始 i18n key**（`files.title`、`paintings.select_model`）。对本项目尤其危险：审计读可见文本时，会拿 key 去和 Cherry 真实文案比对。

### 3. 剩余 app 路由：阻塞面已量化为清单

源 closure **不含自己的 `package.json`**（也没有 tsconfig / electron.vite.config），所以缺什么依赖只能靠逐页撞。已写 `.agent/evidence/scan-source-deps.mjs`（strip 注释 + 语句锚定 + 走完整 node_modules 上溯链 + 目录存在性判断）**一次性枚举**：

- **renderer: 22 个包 / 46 个导入点**
- **main: 111 个包 / 516 个导入点**

（首版扫描把 `dayjs`/`axios`/`yaml` 报成缺失——只查了 compat 自己的 `node_modules`；第二版把 `streamdown` 报成缺失——`require.resolve(pkg+'/package.json')` 会被 `exports` map 挡住。两次都是**我的工具错，不是依赖缺**。）

### 4. 逐页实证结论（import → render → 带真实 provider/window.api）

| 页面 | 结论 |
|---|---|
| `files` | 渲染真实结构（文件类型导航 + 上传），需 `/files/entries` + `/files/entries/stats`，**未桥接**（现返回 404 错误信封，页面显示自身错误态） |
| `launchpad` | 渲染真实标签（应用/工作/聊天/绘图…）；依赖已满足 |
| `paintings` | 渲染真实文案（大师之作/选择模板/选择模型）；依赖已满足 |
| `browser` | **不是 blocked**——早先的 `startsWith` 报错是我没传 `initialUrl` prop。带 prop 渲染成功 |
| `notes` | **不是 blocked**——早先缺的是 `CodeStyleProvider`，而 shell **本来就已经挂了** |
| `code` | **不是 blocked**——早先 `.on` 报错是 scaffold 缺 `window.api.ipcApi`。补齐后渲染成功 |
| `translate` | 同上，补齐 scaffold 后渲染成功 |
| `knowledge` | 装 `strict-url-sanitise` 后渲染真实结构（新建知识库 + 加载态） |
| `miniApps` | **真 blocked**：`MiniAppsPage` 唯一使用 `useTabs().openTab('/app/mini-app/<id>')`。**且 `MiniAppPage` 依赖 `currentTab.url` 定位自身**——mini-app 在源架构里就是 tab-hosted |
| `miniApp` | 渲染 6 节点、0 文本：同样因为它从 `currentTab.url` 推导 appId，无 tab 就无实体 |

本轮新增 4 个依赖（均为叶子工具包，许可证已经核对：`strict-url-sanitise` MIT / `smol-toml` BSD-3-Clause / `jsonc-parser` MIT / `franc-min` MIT）。**没有为了绕过缺失依赖去改写源文件**。

Verification：`npm test` 565 passed；compat **83 passed**；`npm run build` 通过；`audit:cherry-routes` **16/16**；`check:migration-matrix` 90 行无畸形；`visual:check` 双运行通过（17 + 12 帧）；探针已删除。

## 回收站页面挂载完成（B1 关闭，2026-10-10）

- `/settings/archive` 已挂载（route id 15 → 16）。真机截图确认渲染的是**源组件**：归档区块 + 完整标签页（全部/助手/智能体/话题/任务/绘图/文件）、批量管理、空状态、自动清理周期（30 天）。
- **页面调用面与我刚建的三个路由完全吻合**（读源码确认）：`GET /archives`、`POST /:domain/:id/restore`、`DELETE /:domain/:id`。所以上一轮补的会话 restore 与永久删除正好是这一步的前置条件，顺序是对的。
- **验证的是"页面显示真实数据"，不是"页面渲染了"**：归档一个会话后导航到该页，断言 **`showsOurItem: true` 且 `stillSaysEmpty: false`** —— 条目真的出现了，空状态也确实消失了。只断言"页面非空"会让一个永远显示空状态的页面也通过。
- **未伪造的域**：源有 7 个分类，Grimoire 只支撑 3 个（assistants/topics/sessions）；智能体/任务/绘图/文件没有对应的回收站实体，因此 `/archives` 不返回它们——那些标签页如实为空，而不是被塞进占位行。
- Verification：`audit:cherry-routes` **15/15 全部渲染**（含新页）；`npm test` 556 passed；compat 83 passed；`npm run build` 通过；`check:migration-matrix` 无畸形行；`visual:check` 双运行通过；typecheck 39 个既有错误不变；探针已删除。

## 提示词绑定实现 + 可见性存储（A2 关闭，2026-10-10）

- **A2 的前提被推翻**：不再需要"决定绑定映射到 tag 还是新建表"——**新建表是唯一诚实的选择**。源建模的是**关系**（一条提示词共享给多个助手；一个助手挂多条提示词），而 Grimoire 的助手只有一个自由文本 `system_prompt` 字符串。把绑定写进那个字段等于**复制文本**：改提示词不会影响助手，解绑也无法恢复原内容。已加 **schema v28** `cherry_prompt_bindings`（`prompt_id, target_type, target_id`）。
- **同时发现并修掉一个"少报暴露面"的缺陷**：`prompt_assets` **没有可见性列**，投影里 `visibility` 是**硬编码 `'global'`**。也就是说用户设为受限的提示词会被报成全局可见。已加 **schema v29** 可见性列（放在受保护的 `try/catch` ALTER 块里，不是 schema SQL —— 后者每次启动都会跑，未保护的 ALTER 会在第二次启动时抛错）。
- **改造过程中连出两个我自己的错误，都被真机探针抓住**：
  1. `UNIFIED_QUERY` 的 asset 分支**根本没 select `visibility`**，于是读始终回落到 `'global'` —— 写侧正确、读侧丢失，探针显示 `restrictedVisibility: "global"`。已补齐四个分支（另三个来源没有可见性概念，显式给 `'global'`）。
  2. 我的探针在重命名提示词后仍按**旧标题**查找，`created` 为 undefined，后续 `.id` 抛错——**表现得和产品缺陷一模一样**。这是本会话第三次遇到"harness 缺陷与产品缺陷同形"。
- **源的 refine 也已实现**：`visibility: 'global'` 同时带 `bindingTarget` 返回 **400**（源 schema 明确拒绝这个组合，我第一版接受了）。
- 真机验证（真实数据库副本）：迁移到 **v29**、表与列建成、**1744 条提示词无损**、备份生成；`globalWithBinding: 400`、`restrictedCreate: 201` 且 **`restrictedVisibility: "restricted"`**、绑定/解绑/列出正常、`badTarget: 400`。9 项新单测。
- **代价坦白：我在测试脚手架上花了过多轮次。** 给 fixture 的 `prompt_assets` 加第 14 列时，我用正则连续补了三次都错（列数对但值错位），真正解决是把行**按列名显式插入**而不是继续按位置打补丁。教训：**位置参数的表插入在加列时必然错位**，改列名列表是一次性成本，比对正则做外科手术便宜得多。
- Verification：`npm test` **556 → 565 passed**；compat 83；`npm run build` 通过；`audit:cherry-routes` **15/15**；`check:migration-matrix` 无畸形行；`visual:check` 双运行通过；typecheck 39 个既有错误不变。

## 状态帧扩展 + 视觉门禁的一个真实盲区（2026-10-10）

- 新增 **`populated-state-menu-open.png`**：源的会话右键菜单（编辑任务名 / 固定任务 / 归档），在截图里已核对确实展开，不是空条。菜单是**状态而非页面**——它只在右键按住期间存在，所以任何矩阵帧都不可能有它；没有这一帧，源菜单**整个坏掉也不会有任何帧失败**。
- 截图前先断言 `[role="menu"]` 等选择器数量 > 0 才写帧，否则"拍到关闭状态的菜单"正是这一阶段要防的"截了图但证明不了任何事"。截图后按 Escape 关闭，让窗口回到原状。
- 基线现为 **populated 16 帧**（12 矩阵 + 4 状态：failed/running/tool/menu-open）与 **empty 12 帧**，两者都强制。
- **发现并修掉门禁自身的一个真实盲区**：把 `populated-state-menu-open.png` 换成 `populated-state-tool.png`，**门禁通过了**。原因是统一 2% 像素容差是按视口×缩放×主题矩阵校准的（那些帧大部分是同一页面的不同尺寸），而**状态的像素足迹可能小于画布的 2%**——实测差异只有 **0.58%**。一个分不出"菜单开着"与"菜单关着"的门禁，守不住它被加进来的理由。
  - 修法：状态帧用独立且严格得多的容差（0.05%），并在失败信息里注明"（状态帧容差）"。
  - **用同一次替换复验**：现在报 `0.58% 超过 0.05%`、**exit 1**、指名具体帧。恢复后 exit 0。
- 过程中的一个小插曲值得记：第一次做这个 mutation 时，我的 shell 链把恢复命令排在了对比之前，于是门禁比较的是**和自身一模一样的文件**、当然通过——我差点据此得出"容差没问题"的错误结论。重做时先单独确认"替换后的文件与基线不同"，再跑门禁。
- Verification：`npm test` 565 passed；compat 83；`npm run build` 通过；`audit:cherry-routes` 15/15；`check:migration-matrix` 无畸形行；`visual:check` 双运行通过（且已 mutation 验证状态帧容差可失败）；typecheck 39 个既有错误不变。

## 分组折叠状态帧 + 一个"几乎空转"的帧（2026-10-10）

- 新增 **`populated-state-group-collapsed.png`**：点击分组标题（今天/昨天/更早）折叠该组。截图确认——「今天」只剩标题、其 4 条会话消失，末尾出现「显示更多」。基线现为 **populated 17 帧**（12 矩阵 + 5 状态：failed/running/tool/menu-open/group-collapsed）与 **empty 12 帧**。
- **第一版这个帧是空转的，靠字节数发现**：我用「标签含 收起/显示更多」匹配控件，而 **显示更多 是展开**——点击效果与意图相反；判据又只比较 `innerText.length`，仅标签从「收起」变成「显示更多」就足以让长度变化、通过守卫。结果那个帧与展开态**只差 1 个字节**：换了文件名的重复帧。
  - 修法两步：先用探针**列出页面上真实存在的控件**（发现 今天/昨天/更早 才是分组标题），再改用**行数**作判据（14 → 9 行才写真）。修好后该帧与展开态相差 **2065 字节**。
  - 教训：**"状态确实发生了"必须用一个只可能因该状态而改变的指标来断言**。文本长度会被无关的标签变化触发；行数不会。
- **新帧已 mutation 验证**：换成 tool 帧 → `像素差异 2.12% 超过 0.05%（状态帧容差）`、**exit 1**、指名帧。恢复后 exit 0。
- Verification：`npm test` 565 passed；`npm run build` 通过；`check:migration-matrix` 无畸形行；`visual:check` 双运行通过；typecheck 39 个既有错误不变；探针与临时目录已清理。

## 加载态帧：实测不可捕获，记录原因（2026-10-10）

- 计划要求 loading 状态覆盖。我**先实测再下结论**：写探针从窗口出现的最早时刻起，以 400ms 间隔连续采样 40 次 `[data-resource-list-loading-group]`（源 `LoadingState` 渲染的骨架标记），**40 次全为 0**。
- 读代码确认了原因：`sessionsLoading` 初值为 `true`，但 `loadSessions` 是在**effect 里**调用的，而 Host 的 `sessions.list` 在同一次事件循环里就 resolve；`loading=true` 的渲染存在时间短于一帧，**从未被合成**。`CompatSessionResourceList` 的 `status` 计算也要求 `loading && visibleItems.length === 0` —— 数据到达后即使 loading 仍为 true 也不再显示加载态。
- **结论：该帧在当前实现下不可捕获，不是"还没做"。** 要捕获它需要人为拖慢 Host 响应（在 8 个 IPC 之上加延迟）或改生产代码路径——前者给测量工具加制造延迟的能力，后者让产品为了截图而变形，两者都比缺一帧更糟。
- 因此我把这一项按**事实**记录而非 TODO：**loading 态无独立帧；其可达性已验证为否，原因是同步 resolve**。风险是有限的——加载态的骨架是源组件自身的渲染，不依赖 compat 逻辑；真正需要门禁保护的是"数据到达后渲染正确"，而那由已覆盖的 17 帧承担。
- 若将来 Host 列表变为**异步/分页**（真会等待），该帧就变得可达且**应当**加入——解除条件写明在此。
- Verification：`npm test` 565 passed；`visual:check` 双运行通过（17 + 12 帧）；探针已删除。

## 修掉一个悬空导航，并发现缺失的构建期全局（2026-10-10）

- **先抓到一个我自己引入的悬空导航**：About 页的 更新日志 按钮经 `useOpenReleaseNotes` shim 跳到 `#/app/release-notes`，但那条路由**从未注册**——点下去会落到「路由未实现」回退页。已注册该路由并挂上源 `ReleaseNotesPage`。
- **接入该页暴露出四个缺失的构建期全局**，这是本轮真正的发现：
  - 源用 `__APP_EDITION__` / `__APP_RELEASE_NOTES__` / `__APP_RELEASE_HISTORY__` / `__APP_RELEASE_VERSION__`，它们在源的 `env.d.ts` 声明、由**源仓库的构建配置注入**——而那份配置**不在 vendored closure 里**。compat 的 Vite 没定义它们。
  - **未定义时它们在模块作用域抛错**，而这些符号被**共享 chunk** 引用，于是崩溃波及**全部路由**：刚注册 release-notes 时 **16 条路由全挂**。这解释了为什么一个"新增一页"的改动会打垮整个窗口。
  - **我第一轮只定义了失败页当场报出的那两个**（notes/version），结果失败点只是**位移**到 `__APP_EDITION__`（渲染进程 sentry 服务在用，在共享 chunk 里）。改成**搜索整个 closure 的 `__APP_*__` 枚举全部四个**才真正解决——这是"逐个修报错"与"枚举全集"的差别。
  - **第二轮又错在类型**：给 history 传了 `''`，而 `mergeReleaseNotes(current, history)` 需要**数组**，于是报 `t.filter is not a function`。四个全局的正确形态是：notes=字符串、history=**数组**、version=**semver 字符串**（history 校验器会用稳定版本正则比对）、edition=`global`。
- 真机核对：页面渲染出 更新日志 头部与真实版本 **v7.2.0**（来自定义的 global），无捏造内容——Grimoire 没有发布通道，所以没有更新日志可显示，这是**真话**而非占位。
- `app.updater.release_notes.get` 与 `check_for_update` 同样**拒绝**（`NOT_IMPLEMENTED`）：返回空列表会显示成「该版本没有更新日志」，那是对发布内容的主张，不是对本应用能力的陈述。
- Verification：`npm test` 565 passed；compat 83；`npm run build` 通过；`audit:cherry-routes` **16/16 全部渲染**（新增 release-notes，且被我一度打垮的 14 条已恢复）；`check:migration-matrix` 无畸形行；`visual:check` 双运行通过；typecheck 39 个既有错误不变。

## 三个面板真机取证 + 三个真实缺陷（2026-10-10）

- **三个剩余面板全部完成真机取证**（tag-batch / wd14 / prompt-workbench），走的是同一套已固化的流程：`npm run build` → `npx vite preview --port 4173` → `VITE_DEV_SERVER_URL=http://localhost:4173 npx electron . --remote-debugging-port=9222` → `node scripts/electron-runtime-smoke.mjs --panel <类型> --shot <路径>`。CDP 冒烟升级为永久脚本（`--panel/--shot/--port/--keep` 参数化，标记表在脚本里维护），popout 通过应用自身的 `workspace.openPopout` 打开，不触碰布局文档。
- **缺陷 1：unlayered `*` reset 静默杀死全应用所有间距工具类。** 截图显示 tag-batch 各区块**零内边距、行行相贴**。CDP 逐级测量显示 `p-3`/`space-y-2`/`px-2` 全部计算为 0。根因：`index.css` 顶部的 `* { margin: 0; padding: 0; box-sizing: border-box }` 是**未分层**规则，而 Tailwind v4 把工具类放进 `@layer utilities` —— 未分层规则在层叠中**胜过一切分层规则**，于是全应用的 `p-*`/`m-*`/`space-*` 从 v4 迁移那一刻起就没生效过（v3 时代工具类未分层，特异性 0,1,0 压过 `*` 的 0,0,0，所以该写法当时是对的）。v4 自带的 preflight 已在 `@layer base` 声明了同样的重置，把这段移回 `@layer base` 即恢复正确层级（theme < base < components < utilities）。**这是只有真机截图才能发现的缺陷** —— 单测与构建全都通过。
- **缺陷 2：`.ui-field { width: 100% }` 同样未分层，压过调用方的 `w-32`/`w-28`/`w-52` 等宽度工具类**（SettingsWindow 等处同样受影响）。已把 `.ui-field` 三条规则包进 `@layer components`，恢复「工具类可覆盖组件基类」的层级。修复后面板内的下拉框实测 136px/119px（此前各约 530px），标签不再逐字竖排。
- **缺陷 3：图库缩略图从未生成 —— 派生队列在生产路径上没有任何调用方。** `media:thumbs:list` 只读 `image_derivatives`，而写入派生的 `requestDerivatives`/`ensureThumbnails` 只有测试引用。结果：图库卡片永远显示占位图（空字符串 dataURL），wd14 等面板却因走全尺寸 `images.readData` 而正常 —— 这正是"看起来像缺功能、实际是断线"的形状。修复：handler 在读取前对每个 id `await ensureThumbnails(id)`（串行队列自带去重与已有行跳过，重复读取不产生额外成本）。真机验证：9/9 缩略图 320px JPEG 全部加载。
- **冒烟脚本新增 `popout-thumbnails` 验收步**（仅 gallery-search）：等待至少一张真实图片 `naturalWidth > 0` 才截图，45 秒超时即失败 —— 没有这一步，"截图里的占位图"永远不会让任何门禁失败。
- **两个"疑似缺陷"经实测否定，如实记录**：(a) wd14 后台窗口图片 `naturalWidth` 为 0 是**探针假象** —— 非活动窗口不合成帧，`loading="lazy"` 的图片根本不加载；强制截图取帧后 9/9 全部解码成功（naturalWidth 698–2550），无解码错误。(b) prompt-workbench 弹窗中没有左侧标签栏是**正确行为** —— 左栏是独立面板 `tag-sidebar`，真实布局中与主工作区并排，弹窗只承载主区。
- 证据截图存于 `.agent/evidence/`（smoke-tag-batch-reset-fix.png / smoke-gallery-thumbs.png / main-window-after-reset-fix.png / smoke-wd14-final.png / smoke-prompt-workbench-final.png）；主窗口在新层叠下重载核验无回归。
- Verification：`npm test` **565 passed / 99 files**（含并行会话全部用例）；`npm run build` 通过；CDP 冒烟 gallery-search 10 步全绿（含缩略图步）；tag-batch / wd14 / prompt-workbench 各 9 步全绿；探针脚本仅保留 `scripts/electron-runtime-smoke.mjs` 一个永久件，临时探针已删；自有 Electron 与 preview 进程按端口精确清理（并行会话的进程未动）。

## 计划收口补遗：三项验收真机补齐 + 两个读取侧缺陷（2026-10-10）

- **发现计划有一项交付物未执行**：Wave D 交付物 3「ImagesPanel 重组（接入 gallery.store + 用 listBatch/thumbs 消灭 N+1）」当时以「保留旧面板最稳妥、统一留待 Wave E 后决策」偏离（DECISIONS 有记录），但 Wave E 收口时没有回头执行。本轮补齐 N+1 消除：加载从 **每图一次 readData + 每图一次 assetLinks.list**（N+N 次 IPC）改为 **一次 `media.thumbs`(thumbnail) + 一次 `assetLinks.listBatch`**；预览保留按需 full-size 读取（缩放需要原图细节，且 assets 面板的旧有缩放/拖拽行为不变）。
- **补齐 Wave C 缺失的验收「导入三张真元数据参考图自动解析」**：程序化构造三张**真实合法 PNG**（IHDR+tEXt+IDAT+IEND，CRC 正确），分别内嵌 A1111 `parameters` 文本、NovelAI `Comment` JSON、ComfyUI `prompt`+`workflow` 图；通过应用自身的 `images.importData` IPC 真实导入 → 自动解析落库。三张全部正确：`webui`(seed 1234567890/checkpoint dreamshaper_8/steps 28)、`novelai`(seed 987654321/cfg 6.5)、`comfyui-embedded`(seed 424242/832×1216/sd_xl_base_1.0)。导入的测试图已在验收后删除，真实库恢复 9 条。
- **该验收当场抓出一个真实缺陷（写入正确、读回丢失）**：`persistParsedMetadata` 正确写入 v22 的 `origin` 列，但 `getImageGenerationMetadata` 的 SELECT **没有包含 origin**，且其后所有列下标未随列数变化调整——读回的 origin 恒为空。这解释了为什么单元测试全绿（解析测试直接断言解析结果，不经过读回路径）。已修 SELECT 与返回对象，并新增**变异验证过**的回归测试（去掉 origin 后两条测试转红）。
- **补齐 Wave B 缺失的验收「组合器全交互冒烟」**：在**临时 profile**（`--user-data-dir` 指向临时目录，不触碰用户真实布局文档与数据）启动真实应用，驱动真实点击：点击侧栏子类「性别」→ 43 张标签卡渲染 → 点击「单人」→ 输出变 `单人` → 点「提高权重一层括号」→ `(单人:1.1)` → 点「降低」→ 回到 `单人` → 点「移除」→ 输出清空。7/7 步全绿。
- **过程中两次「探针缺陷伪装成产品缺陷」，如实记录**：(a) 首次全局冒烟报「侧栏标签卡 0 张」——实际是侧栏初始只显示子类列表，需先点子类才渲染标签卡（面板空状态原文就是「点击左侧子类查看标签」），是探针没按真实交互顺序操作；(b) 变异验证首次「通过」——因为 store 版 python3 是占位程序、变异根本没写入文件，改用 node 后变异立刻让两条断言转红。两次都靠「先怀疑探针」定位。
- Verification：`npm test` **566 passed / 99 files**（+1 回归测试）；`npm run build` exit 0；真机导入验收 3/3；组合器交互 7/7；证据截图 `.agent/evidence/smoke-images-batched-thumbs.png` 与 `composer-interaction.png`；临时 profile、fixture、探针全部删除，自有进程按端口清理。

## 接线审计：3 个孤岛全部接入 UI + 1 个计划漏项（2026-10-10）

- **用户关切（「不要有做了但没有接口」）触发的系统性审计**：逐个检查 16 个新 API 面（服务导出 → IPC handler → preload → 渲染器调用方 → 用户可点入口），发现 **3 个真实孤岛**——能力建好、preload 暴露、但零 UI 入口：
  1. `media.metadata.scan`（存量图片元数据扫描）：preload 有、`onScanProgress` 通道有、**无任何 UI 触发点与监听方**。计划原文要求「存量为用户触发扫描时补齐」。已接入 ImagesPanel：标题栏「扫描生成元数据」按钮 + 进度行（`onScanProgress` 实时显示 done/total）+ 完成 toast（解析 N / 跳过 M）。
  2. `tags.queryAssets`（标签→资产反查，Hydrus 核心语义）：服务被 tag-batch 内部使用，但公开 IPC 零渲染器调用。已接入标签与资产面板「资产标注」页签：标签选择器（TagAutocomplete）+ any/all/none + 包含隐含子标签 + 结果列表（assetKey + 命中标签数）。
  3. `media.batchPreview`（组合查询计数）：零调用方。已接入图库工具栏：处于「全部筛选结果」模式时向后台要真实总数，状态显示「全部筛选结果（N 个资产）」——页面只显示一页，批量写入前的真实计数必须来自后台。
- **同时补上一个计划漏项**：ImagesPanel 标签徽章原为纯文本，计划要求「标签徽章点击筛选」。已改为可点击按钮（点击筛选、再点取消、显示「清除标签筛选」），真机验证：临时给图片 1 打「全景」标签 → 弹窗内点击徽章 → 网格收敛到 1 张 + 清除按钮出现 → 验收后移除临时标签（库恢复原状）。
- **真机验证 4/4**：扫描按钮存在且执行（scanned 9 / parsed 0 / skipped 9，与真实库一致——PixPin 截图无生成元数据）；徽章筛选可用（上述）；反查区渲染（标签选择器 + 逻辑选择 + 反查按钮）；全部筛选计数接线（单测断言 backend 被调用 + 显示「42 个资产」）。
- **最终接线审计结果：16/16 API 面全部有渲染器调用方，0 孤岛。** 审计脚本对每个面统计非测试、非 canvas-vendor（并行会话领土）的渲染器引用数。
- Verification：`npm test` **567 passed / 99 files**（+1 新计数测试）；`npm run build` exit 0；真机 4/4；临时标签/探针/进程全部清理。**新增缺口：无。**

## Wave F 进行中：9 项剩余功能并行开发（2026-10-10）

- 用户批准「把一-本系列的前九个功能先做完」，CLIP 相似图选择**双路方案**（CLIP sidecar + 感知哈希兜底，用户明确选择）。
- **共享面（主会话先建，避免并行冲突）**：schema **v30** — `image_perceptual_hashes`（dhash+颜色直方图）与 `image_embeddings`（Float32 BLOB，模型/维度随行）+ `idx_image_embeddings_model`；9 条新通道（MEDIA_SIMILARITY/INDEX/PROGRESS、MEDIA_DUPLICATES、MEDIA_FOLDER_SCAN/IMPORT、TAG_METADATA_GET/SAVE/LIST）+ DIALOG_OPEN_DIRECTORY；preload 本地副本与 API、global.d.ts、IPC handler 骨架全部先行冻结（契约见 `.agent/WAVE_F_CONTRACTS.md`）。
- **三个并行 agent**（互不冲突的文件边界）：F1 感知哈希+相似图服务（34 测试，含完整 PNG 过滤/交错解码）；F2 重复检测+文件夹扫描（进行中）；F4/F5 标签元数据服务+CLIP sidecar（29 测试，Python 预处理逐像素对拍 torchvision）。
- **主会话完成的集成层**：WD14 多模型 union 合并（`wd14-union.core.ts` 纯函数 + 7 测试，并集取最大置信度/交集取最小，跨 namespace 独立）；`clip-index.service.ts`（image_embeddings 的唯一写入方，4 测试，小端 float32 BLOB 往返验证）；启动期 CLIP 配置加载；similarity-index handler 组合 hash+CLIP 双通道（CLIP 不可用静默降级）；9 项 UI 入口全部接线（相似图区+重复组+相似索引按钮、文件夹扫描导入+按目录名写入标签、标签元数据编辑器、命名空间分组浏览、智能文件夹固定+真实计数、同名标签消歧义显示）。
- Verification（进行中）：`wd14-union` 7/7、`clip-index` 4/4、`database.v30` 3/3、`similarity` 9/9、`clip-worker`+`tag-metadata` 29/29、gallery 组件 16/16；全量测试等待 F2 服务落地后复跑。

## Wave F 完成：9 项剩余功能全部落地并真机验证（2026-10-10）

- 用户指令「把一-本系列的前九个功能先做完」+ CLIP 双路方案（用户明确选择 CLIP sidecar + 感知哈希兜底）。**9/9 全部完成**：
  1. **CLIP 相似图搜索（双路）** — `python/clip_worker.py`（照搬 wd14 worker 架构，CLIP 标准预处理与 torchvision 逐像素对拍 max delta 0）+ `clip-worker.ts` + `clip-index.service.ts`（image_embeddings 唯一写入方，小端 float32 BLOB）；无模型时如实降级 hash-only。UI：图库工具栏「建立相似索引」+ 检查器「相似图」区（标注「感知哈希」或「CLIP 语义」）。
  2. **重复图片检测** — `duplicate.service.ts`，dhash 汉明距离 + 前缀分桶预筛 + 并查集；UI：「查找重复」按钮 → 重复组面板（组大小 + 代表哈希 + 成员 id）。真机：0 组（9 张截图各不相同，如实）。
  3. **文件夹扫描导入** — `folder-scan.service.ts`；UI：ImagesPanel「扫描文件夹」→ 勾选预览（已导入标记）→ 导入副本/链接原文件。真机：真实目录 217 文件正确列出。
  4. **智能文件夹** — 置顶保存搜索即固定视图，显示**后端真实计数**（batchPreview），Pin 图标切换；新增测试覆盖计数显示与取消固定。
  5. **BDTM 多模型 AutoTagger** — `wd14-union.core.ts` 纯函数（并集取最大置信度/交集取最小，跨 namespace 独立）+ WD14 面板多模型勾选与合并方式选择；7 测试。
  6. **TagMaster 分组标签浏览** — TagCards 分组浏览开关 + 命名空间过滤下拉（按 tag_metadata.namespace）。
  7. **TagStudio 元数据字段编辑器** — `tag-metadata.service.ts` + 标签详情「元数据」区（命名空间/颜色/描述/启用）+ IPC 三通道；真机往返验证（写入→读回→批量列表一致，验收后恢复原状）。真机 UI 验证：四个字段与保存按钮全部渲染。
  8. **TagStudio folders→tags 生成器** — 文件夹导入时「按目录名写入标签」选项：相对路径的目录段作标签名，复用已有同名标签或创建，批量标注到导入的图片。
  9. **TagStudio 歧义显示** — `searchTagsAdvanced` 返回子类/分类上下文；同名结果显示分类归属徽标并高亮。
- **共享面**：schema **v30**（v30 测试 3/3：建表/级联删除/幂等）+ 9 通道 + preload/global.d.ts/IPC 骨架（契约 `.agent/WAVE_F_CONTRACTS.md`）。
- **三个 agent + 主会话分工**：agent 1（感知哈希+相似图，34 测试，完整 PNG 过滤/交错解码）与 agent 3（CLIP sidecar + 标签元数据，29 测试）完成；agent 2 在 recon 阶段停滞 25 分钟无产出，**停止后由主会话亲自实现** duplicate + folder-scan 两个服务（10 测试）。主会话另完成全部集成层（WD14 union、clip-index、启动配置、similarity-index 双通道组合、9 项 UI 接线）。
- **真机验证 7/7 服务 + 4/4 UI**：相似索引 9/9、相似查询真实距离（0.31/69%）、重复 0 组、目录扫描 217 文件、元数据往返、外部导入 1/0 并**清理**、CLIP 如实降级；UI：工具栏双按钮、重复点击渲染、检查器相似图流程（双击→按钮→区域）、反查区/元数据编辑器渲染。截图 `.agent/evidence/wave-f-similarity.png`。
- Verification：`npm test` **669 passed / 110 files**（567 → 669，+102）；`npm run build` exit 0；`check:migration-matrix` 91 行无畸形；自有进程按端口清理，临时探针全删，真机验收数据（临时标签元数据、导入的 external 记录）全部还原。

## 接线审计第二轮：补上 CLIP 配置缺口（2026-10-10）

- **用户再次追问「不要有做了但没有接口」，审计发现 1 个真实缺口**：CLIP settings（`clip_model_directory`/`clip_python_path`）在启动时被**读取**（main/index.ts），但没有任何 UI 能**写入**——用户即使自备 CLIP ONNX 模型，也无法在界面里指向它，只能手改数据库。这正是「做了但用不了」的形状，且 WD14 有完整的「选择模型目录/选择 Python」对照面（写 settings + 重启 worker）。
- **修复**：照搬 WD14 的模式补齐 3 条通道（`media:clip:diagnostics` / `selectModelDirectory` / `selectPythonPath`）+ preload/global.d.ts + settings 默认值 + 图库工具栏「CLIP」配置面板（诊断徽标、目录/解释器路径、选择按钮、升级提示）。相似索引按钮的降级说明现在指向这个面板，闭环完成。
- **真机验证**：诊断 IPC 真实返回（Python 可用 / onnxruntime 1.29.0 / 模型目录默认路径 / 0 模型 + 如实阻塞原因「模型目录中没有 .onnx 文件」）；UI 面板展开渲染诊断 + 两个选择按钮 + 升级提示。截图 `.agent/evidence/wave-f-clip-config.png`。
- **精确接线审计**：Wave A–F 全部 30 个 API 面（含刚补的 3 个 CLIP 面）逐一核对渲染器调用方，**0 缺失**。审计脚本按方法名精确匹配（第一版按值后缀匹配产生假阳性，已弃用重写——**审计工具本身也要先证伪**）。
- Verification：`npm test` **669 passed / 110 files**；`npm run build` exit 0；进程与探针清理完毕。

## 功能使用手册（2026-10-10）

- 新增 **`.agent/FEATURES.md`**：标签/图库系列全部功能与使用入口的完整文档（10 章节：工作区预设、标签侧栏、提示词工作区、标签与资产、批量工具、图库搜索、图片资源库、WD14、面板管理、参考项目对照）。
- **每条入口在写入文档前都回到代码核对过**：面板定义（PanelRegistry 30 项 title）、工作区预设（workspace.store 6 个）、侧栏右键菜单 4 项、提示词工具栏 5 按钮、批量工具 12 控件、图库工具栏/筛选轨/检查器/保存搜索全部控件、图片面板 12 控件、WD14 面板控件与历史区。
- **核对中修正了两处初稿错误**：(a) GalleryCard 没有标签徽章（标签徽章点击筛选是 ImagesPanel 的能力），已改为收藏星标/评分点击；(b) WD14 的多选批量反推在**历史区**而非待反推网格（网格是逐张反推），已改写。这两处正是「凭印象写文档」会错的形状。

## A 组闭环补遗：四个「功能建好但用不到底」的缺口（2026-10-10）

- **A1 重复组处置**：此前「查找重复」只**显示**分组，无法操作。现在每组有「保留首张，删除其余」按钮 → 确认对话框（列出将删/保留的 id）→ 逐张走 images.delete。**同时修复一个真实缺陷**：删除图片只清 DB 行、**托管文件永久残留**（孤儿累积）。新增 `deleteImageArtifacts`：删托管副本（含内容去重共享检测——有别的行引用同一文件就不删）与派生图目录，**绝不触碰外链原文件**（路径校验限定在 resources/images 内）。images.delete 与 media:batchDelete 两条路径都已接入。
- **A2 相似图连续探索**（Hydrus 式）：相似图区新增「连续探索」开关与来路后退按钮。开启时点击相似缩略图自动以新图为起点重查；结果带归属 id（forId）渲染，换图不再显示旧结果（消除了「effect 清理 vs 异步返回」的竞态——改成按归属渲染，不依赖时序）。
- **A3 isActive 消费者**：元数据编辑器的「启用该标签」此前是半空转。现在 `searchTagsAdvanced` 默认过滤 `is_active=0`（搜索/补全不再出现禁用标签），标签字典显式传 `includeDisabled: true` 并给禁用行加「已禁用」徽标（管理视图仍可见、可再启用）。
- **A4 ImagesPanel 分页**：此前 `images.list` 全表加载且 `media.list` 硬限 500（大库静默截断）。新增 `images:listPaged`（limit/offset/总数），面板切到分页（60/页）+ 页脚（共 N 张/页码/上下页 + 「筛选只作用当前页，跨页精确筛选用图库搜索」的如实说明）。
- **真机验证全过**：A3 禁用→默认搜索消失→管理搜索可见→恢复（往返）；A4 分页无重叠且总数一致；A2 连续探索开关与结果渲染；**A1 完整真重复流程**（复制真实文件→external 导入→索引→UI 点「查找重复」→点「保留首张删除其余」→确认→「已删除 1/1」→组清零→原图保留）+ **托管文件删除后磁盘确认为空**（导入托管副本→确认存在→删除→确认消失）。截图 `.agent/evidence/a-group-verify.png`、`a1-duplicate-delete.png`。
- Verification：`npm test` **690 passed / 112 files**；`npm run build` exit 0；验收产生的临时图片/文件全部清理，进程按端口精确回收。
