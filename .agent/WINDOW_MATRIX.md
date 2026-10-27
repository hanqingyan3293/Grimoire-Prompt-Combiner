# Cherry source window capability matrix

The compatibility window implements the `main` window's chat and settings surfaces. The
source ships **eight** `WindowType`s (`source/src/main/core/window/types.ts`), each with
its own HTML entry, provider root, main-process lifecycle and init-data contract. This
file records, per window, what it would take to connect it — so "not connected" is a
decision with named blockers rather than an oversight.

A window may only be connected when its **lifecycle**, **preload/Host surface** and
**required services** all exist. Until then it stays an explicit BLOCKED diagnostic; the
plan's rule is that an unavailable window is reported honestly, never rendered in a state
that looks working.

Statuses: `CONNECTED` · `BLOCKED` (with the blocking pieces named) · `NOT_APPLICABLE`.

| Window | L2 root | Main-process lifecycle | Required Host/services | Status | Blocker |
|---|---|---|---|---|---|
| `main` | `MainApp` | singleton, full chrome | i18n, preferences, providers, MCP, sessions | **CONNECTED (partial)** | The compat window mounts this window's chat + settings surfaces through the Grimoire Host Bridge. It does NOT mount `MainApp` itself (the source route tree is not in the vendored closure), so the layout/tab-router shell is Grimoire-owned. Tracked in MIGRATION_MATRIX as VENDOR + ADAPTER, PARTIALLY_MIGRATED. |
| `subWindow` | `SubWindowApp` | singleton, full chrome, own title bar | window-manager create/restore, topic data, full runtime leaf (`useWindowRuntime`) | **BLOCKED** | Needs a real multi-window lifecycle in Grimoire: create/reuse/restore, per-window init data delivery, and a topic-scoped data feed. Grimoire has workspace pop-outs (`WORKSPACE_OPEN_POPOUT`) for panels, which is a different concept — a subWindow is a detached *conversation*. Connecting it would first require deciding whether Grimoire adopts Cherry's window model or maps it onto the pop-out system. |
| `quickAssistant` | `QuickAssistantApp` | singleton, global shortcut, light | global hotkey registration, always-on-top window, quick chat + translate surfaces | **BLOCKED** | Needs global shortcut registration and a global-hotkey-triggered always-on-top window. Grimoire registers no global shortcuts. The surface itself is small; the lifecycle is the work. |
| `screenshot` | `ScreenshotApp` | **pooled**, one window per display | per-display enumeration, screen-capture permission, region capture, canvas overlay, save-to-clipboard/file | **BLOCKED** | Needs multi-display window pooling, an OS screenshot permission flow, and the capture pipeline. Grimoire has no screenshot capture path; `desktopCapturer` is not wired. |
| `selection/toolbar` | `SelectionToolbarApp` | singleton, no `index.css` (deliberately minimal) | OS selection hook (global mouse-up listener), text selection capture, toolbar positioning | **BLOCKED** | Needs a native selection hook: `main/services/selection/SelectionService.ts` loads `selection-hook` with a runtime `require()` and feature-detects it. The package is **not in the compat install** (verified), so the service's own graceful-degradation path is what would run. Absent unless the native module is deliberately added — and it is a native binding, not pure JS. |
| `selection/action` | `SelectionActionApp` | singleton, light | selection payload from the toolbar, action execution against the selection text | **BLOCKED** | Depends on `selection/toolbar` producing a selection; connecting it alone would render an action window with nothing to act on. |
| `mcpBrowser` | (no renderer window in the closure) | — | — | **NOT_APPLICABLE** | Present in the `WindowType` enum but has no `renderer/windows/` entry in the vendored closure — there is no source UI to migrate. |
| `print` | (no renderer window) | — | — | **NOT_APPLICABLE** | Same: an enum member used for `webContents.printToPDF`, not a window with its own UI. |
| `migrationV2` | `MigrationApp` | preboot special case — own i18n, **no preferences**, runs before normal boot | Cherry v1 data present on disk | **NOT_APPLICABLE** | This window migrates an existing Cherry v1 profile. A Grimoire install has no Cherry v1 data, so the window has nothing to operate on; `app.migration_v2.rerun` is refused for the same reason. |
| `userDataRelocation` | `RelocationApp` | preboot special case — own i18n, no preferences, started before `IpcApiService` | boot-time user-data relocation protocol with its own IPC channels | **BLOCKED (deliberately not implemented)** | Moving the user-data directory must relocate the live database and re-point every store, from a boot phase that runs before normal services. Grimoire has no such flow, and a half-implementation leaves the app unable to find its own data. `app.user_data_relocation.*` is refused at the IPC layer rather than faked. |

## Notes on the connected window

The compat window loads the SAME two stylesheets in the same order as the source `main`
window entry (`renderer/assets/styles/index.css` then `tailwind.css`), and mounts the
same provider order (`ThemeProvider` → `CodeStyleProvider` → `CommandContextKeyProvider` →
`CommandProvider`, with `PopupHost`/`ToastHost` as leaves). That is the source contract it
shares with `subWindow`; the light windows deliberately omit parts of it (for example
`selection/toolbar` omits `index.css` entirely to stay minimal), which is why connecting a
light window is not just "point it at the same providers".

## What would unblock the rest

1. **A Grimoire window lifecycle service.** `subWindow`, `quickAssistant` and `screenshot`
   all need create/reuse/pool semantics plus per-window init data. This is one piece of
   infrastructure serving three windows, and it is the largest single blocker.
2. **Global input hooks.** `quickAssistant` (hotkey) and the two `selection` windows
   (pointer/selection capture) need OS-level global input. The vendored closure references
   `selection-hook` but does not bundle it.
3. **A capture pipeline.** `screenshot` additionally needs display enumeration, a
   permission flow and a region-capture canvas.
4. **A relocation protocol.** `userDataRelocation` is blocked by choice, not by missing
   pieces: implementing it would put an irreversible data-move behind a compatibility
   window, and Grimoire has no flow to check it against.

None of these is a UI task; each is main-process infrastructure. That is the honest reason
the remaining windows stay BLOCKED rather than being mounted with stubbed lifecycles.

## Route coverage in the CONNECTED window (2026-10-10)

This file covers `WindowType`s. A separate and much larger gap sits inside the window that
IS connected: the source ships **56 route files** (41 under `routes/settings`, 15 under
`routes/app`) backed by 33 settings page components, while the compat registry implements
**10** route ids: 9 fixed paths in `COMPAT_ROUTE_PATHS` plus the parameterized
`/settings/mcp/settings/$serverId` detail, which has no entry in that map. The count was 8
when this section was first written and moves as pages are mounted, so treat the registry
itself as the source of truth rather than this figure. That is the real distance from "the
chat vertical works" to the migrated product — and it is a route-registry backlog, not a
window-lifecycle problem.

Correcting one thing this investigation initially got wrong: a scan that matched page
imports by filename reported `AppearanceSettings`, `ProviderSettings`, `GeneralSettings`,
`UsageSettings`, `AboutSettings`, `NotificationSettings` and `DeviceConnectionsSettings` as
MISSING. They are not — most exist as **directories** with the component inside
(`ProviderSettings/`, `AboutSettings/AboutSettings.tsx`, …). Only a couple are genuinely
absent. The registry gap is real; that particular measurement was not.

Per-page reachability (what each settings route needs beyond the registry entry):

| Page | Extra requirement | Status |
|---|---|---|
| `AboutSettings` | `app.get_info` (done), `system.toggle_dev_tools` (done), `app.updater.check_for_update` (refused); one shim for `useOpenReleaseNotes` (its `useTabs()` needs the tab shell the compat window replaces) | **CONNECTED** — full page renders; 检查更新 surfaces the source `更新出错` toast; doctor checks still unimplemented |
| `ArchiveSettings` | DataApi `/archives` (**present** — `main/data/api/handlers/archives.ts` + `data/services/archive.ts`) + 7 domain sections + `/files/entries/ref-counts` + `trash.purge_now`, plus restore/delete routes per domain (`POST /<domain>/:id/restore`, `DELETE /<domain>/:id`) | **BLOCKED — and the reason is a semantic mismatch, not a missing route.** An earlier version of this table claimed `/archives` was "not in the vendored closure"; that was **my measurement being wrong** (a too-narrow grep missed `handlers/archives.ts`). The route exists and is 47 lines. The real blocker: `listArchives` filters `deleted_at IS NOT NULL` — it is a **soft-delete recycle bin**, while all three Grimoire deletes (`deleteAiSession`, `deleteAiAssistant`, `deleteAiTopic`) are **physical `DELETE FROM`**. Mounting the page over that mismatch would render a permanently-empty recycle bin and let 永久删除 report success for rows already gone — a fake-success surface. `cherry_resource_state.archived` (a different column from `deleted_at`) IS backed and IS what the session/topic/assistant archive lifecycle already uses |
| `PromptSettings` | nothing detected (`window.api` clean) | **MOUNTABLE** — verify at runtime |
| `NotificationSettings` | nothing (91 lines, preferences only) | **CONNECTED** — mounted, nav button live, heading renders; toggles persist but no dispatcher consumes them yet |
| `ShortcutSettings` | `window.api.shortcut.onRegistrationConflict` | needs that preload surface |
| `UsageSettings` | an AI usage-record store | **BLOCKED** — no such store in Grimoire |
| `GeneralSettings` | **Nothing is missing at the transport layer** — verified: its only bridge call is `window.api.application.relaunch`, already implemented, and everything else is `usePreference`. The blocker is that **no Grimoire main-process service consumes those keys**: `app.launch_on_boot`, `app.power.prevent_sleep_when_busy`, `app.fetch.allow_private_network`, `app.developer_mode.enabled`, `app.proxy.*`, `chat.retry.*` and `chat.context_settings.*` each have **0 references in `src/main/`** | **BLOCKED (deliberate)** — mounting it would render ~20 toggles that persist and do nothing, which is the fake-success shape this project forbids. The reason recorded here was previously wrong ("needs seven services"); the services are not *needed* for the page to render, they are needed for the page to be *true*. The route currently renders an honest BLOCKED diagnostic listing exactly this. Unblocking condition: main-process consumers for those keys — launch-on-boot via `app.setLoginItemSettings`, proxy via `session.setProxy`, prevent-sleep via `powerSaveBlocker`, retry/context-compression in the agent runtime. Preference persistence already works through the compat shim, so each service is independently lands-able |
| `ApiGatewaySettings` | not a directory in the closure | **NOT_APPLICABLE** |

`cherry_resource_state` already carries `archived` + `deleted_at` per entity, so the archive
surface has real storage behind it; what is missing is the DataApi projection and the
trash/purge semantics, not the schema.

The next action this suggests, in order: (1) mount the pages whose only requirement is a
registry entry, verifying each at runtime rather than by import scan, and (2) build the
`/archives` projection over `cherry_resource_state` to unblock `ArchiveSettings`, which is
the page the archive lifecycle work already points at.
