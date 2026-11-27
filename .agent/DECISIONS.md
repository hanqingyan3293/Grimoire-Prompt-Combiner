# Grimoire migration decisions

## 2026-11-07 C1 execution ownership, result truth and selected source closure

- C1继续现task_jobs，schema40→41只新增nullable execution_json；六字段v1和原始JSON CAS唯一所有者，不建任务副库/第二业务真相。输入/endpoint/requested UUID在网络前冻结，真实responseID在任何后续DB访问前抓为ACK owner；POST结果未知不从HTTP/timeout/retryable推断“未发送”。
- 所有读取使用本attempt READ controller，POST不接本地READ abort；暂停/退出只park原ID或显式requested-ID核实，业务counter不因local stop增加。原Cherry waitWithSignal/targeted cancellation经CJS原函数直接复用，取消证明/版本/前缀与Queue观察只读边界保持。
- ACK、read partial与普通business failure result都有settlement-only存活/force drain。关闭前仍未落库分别以coded TASK_ACK_PERSIST_PENDING/TASK_READ_RESUME_PERSIST_PENDING/TASK_RESULT_PERSIST_PENDING保留原库/owner，不把一次SELECT失败当not-found。取消结算消费正确attempt的retained partial，不允许普通scan先写没有输出的终态。
- 来源采用现task_image_refs.source_filename的versioned tuple/alias ledger，legacy无歧义filename在升级后仍复用，不新增schema42。逐图输出以实际task/image/关系提交为依据，中断/cleanup携带当轮结果；manual known-ID read重试保留partial/progress/input/identity，与重新生成区分。
- [shared retry policy](../src/shared/task-policy.ts)从原main admission提取，renderer与repo同用；unknown/legacy/corrupt/cap不展示合法可用retry。UI仅凭真实queued+deadline的显式标志描述自动重试，坏结构不被status字符串转换伪装成功；异步latest显示和每task RPC fence与refresh lifecycle分开。
- 选定Comfy source bundle的完整resolved图由真实rolldown moduleParsed记录，130file/130module输入及nearest package metadata、locks/generator/builder/runtime都入收据。Zod沿当前compat4.6.5 ESM入口，不偷换root4.3.4；原AGPL/Zod MIT全文旁置，vendor源码不改。缺失vendor根package manifest按实际缺失处理，不补假文件；不是全Cherry依赖审计完成。
- [Lead修订记录](records/2026-11-06-sol-execution/C1-r6-lead-review.md)、[R8](records/2026-11-06-sol-execution/C1-R8.md)、[R10](records/2026-11-06-sol-execution/C1-R10.md)存定序RED/GREEN与原始日志。C1全组/完整gates/真实Electron及manual与这些分段分别核实；C2完整DNS/IP/redirect/stream、C3转换、C5seed/批次/归因仍后续，未扩大外部生成API或安装政策。

## 2026-11-06 P1 末端复核与 P2 生成重试边界

- P1首轮124focused/G1-G14过后逐条合同复核补出Canvas末端void/假success；先RED4/5，改async store及两处等待/busy/error。最新129focused、完整G1-G14均过，snapshot21-02-06-412Z绑定27c37ff2…（3823files/88640266bytes），root1716/2skip；RPC-only原政策噪声留存。旧8826021b…只保留为首轮历史，不跨构建混算ROOT-3X。
- P2先修合法原子失败/重试、取消、调度；进入Comfy submit后任何失败均不整段auto重发。当前retryable/429/5xx不证明远端未接受生成，普通manual retry也防提交未知/已提交失败的复发；明确重生走新task。
- 真实网络恢复positiveAuto测试仍必须做，归C1持久promptId/阶段后；不是减少验收要求。P2-next.md是批准PLAN的执行细化，未建第二总计划/第二DB，P2生产代码和新test文件尚未改写。
- 原接手基线/branch/HEAD、vendor9639只读源、schema40保留；live删除交互、最终ROOT-3X、package/人工仍待后续，不宣告整份计划完成。

## 2026-11-06 P1 真实删除边界与复用副本

- 复用既有NovelAI引用guard，物理图库ID显式String(realImageRefId)，不把旧任意img_*当作真实文件。整个批次在首个变化前验证；Media逻辑projection语义保留，物理batch统一删除canonical image_refs。
- 图片/派生/附件/WD14快照/缓存各物理所有者都按live image_ref路径保留共享字节。固定子域以canonical资源根作锚，不信任被重定向的images/derivatives/ai-attachments/wd14-history根；目录保护同时检查真实和逻辑路径。
- Files rename检查source共享/target覆盖，exclusive link或COPYFILE_EXCL避免替换目标；失败保留或恢复可追踪路径。清理失败先保留索引，无法回滚的物理变化准确partial，不冒充DB+FS事务。
- 图库新deleteBatch回普通DTO；legacybool/count保持形状，copy cleanup/DB失败通过message携带code/phase counts，因为Electron不会序列化Error自定义属性。
- 素材前台预览必须带exact expectedImageIds；事务内不符ASSET_CHANGED零写入。全入口revision/lease/token仍在后续W1/N4/T1。
- cache tests原先会扫描/清除全OS-temp前缀，本轮隔离为本测试专有root。没有扩大cache产品范围，仍只现有临时目录/日志。
- 本轮最终focused 11files/124tests、双端typecheck通过；vendor9639 files未改、silent catches150/原baseline154。完整阶段build/gates、真实Electron与人工仍分开验收，不能凭这些数字宣布全迁移完成。

## 2026-11-06 完整后续计划批准与 P0 接手

- 本会话用户批准完整后续开发与验收计划，并启动持续执行目标；执行模型已切换为 GPT-6.1 Sol。唯一计划整合至 `.agent/PLAN.md`；原 PLAN/STATE/GATES/MATRIX/DECISIONS 完整归档，未删除历史。
- 首个执行动作保存10,890个工作树文件（含168个untracked）及完整binary diff；恢复manifest见 `.agent/records/2026-11-06-sol-execution/baseline.json`。保留原feature分支，不commit/push。
- 范围来源为原Cherry79逐项表和NovelAI94逐项表；新增 `.agent/feature-scope.json` 稳定195项，67采纳、18reserve、9排除。生成的 `src/shared/cherry-product-scope.ts` 与manifest由回归测试保持一致；UI消费归S1，生成表不冒充已收口曝光。
- 四个原待定设置页（归档/通知/联网搜索/本地备份）默认hidden、深链说明；现后端保留，会话归档不受裁撤。A默认，B独立验证；主题昼夜+色轮+a855f7。数据只完善原数据库导出/导入，依赖只本地检测，无云备份/自动下载安装扩张。
- Native recovery/replay/prewarm缺实现继续显式blocked；没有用户逐项接受之前不写完整交付。MOSS保持120+120，测试样本与场景耦合按N7标注，不改成118。
- STATE累计旧结论已归档并以当前摘要替代：当前门禁证据b696b39b…不等于旧M5接受245647e5…；聚合目前8项因旧证据失效，仍未全验收。
- 新增功能按TDD推进，P1先图片/素材删除保护，P2再Comfy重试。P0自动验证4tests/双端typecheck/矩阵/证据路径通过；记录不代表P1-P2已修。

## User layered-delivery acceptance (2026-11-05)

用户明确选择“接受当前分层交付”。该选择单独记录在 `artifacts/m5/layered-delivery-acceptance.json`，并绑定当前 build SHA-256 与 `.agent/MIGRATION_MATRIX.md` SHA-256；最终 aggregate、acceptance index 与截图清单根节点保持 `manualAcceptance=pending`、`blockedAcceptance=pending`，只增加 `layeredDeliveryAcceptance={accepted:true, record, recordSha256, buildBound:true}`、`gapDispositionAcceptance=inventory-acknowledged` 与状态 `automated-passed-layered-accepted-manual-pending`。接受范围仅限：自动门禁结果、65 条已捕获表面截图、已披露的 blocker 清单。14 条待验截图行仍逐项 `manualAcceptance=pending`；53 条未完成 matrix 行与 BLOCKED/NOT_IMPLEMENTED 能力仍未被声明为已实现、仍逐项 `blockedAcceptance=pending`，每位 blocker 自身状态保持原值。该选择不等于逐截图人工验收，也不等于全部迁移完成。

## M5 evidence and packaging decisions (2026-11-04)

- 默认入口继续使用 A compat hash shell；B authentic MainApp 只能通过显式 `build:cherry-source-shell` + isolated source-shell smoke 验证，不以隔离成功为默认切换依据。
- G1–G14 轻量门禁保持与 `scripts/gates.mjs` 对齐；pack 与 secrets 是 M5 mandatory gates，但不把重型 pack 偷塞进每轮轻量 gate。`verify:full` 负责编排二者。
- `m5-pack.mjs --pack --require-pack` 必须运行新鲜 `npm run pack`，读取新生成的 `release/win-unpacked/resources/app.asar`，检查 app.asar hash 与实际条目；旧 app.asar 的存在/大小不能证明本轮打包。
- 许可证以实际 LICENSE/LICENCE 原文为准：root LICENSE 进入 package files；Cherry/OpenCode/Pi/Dockview 原文通过 extraResources 随包；Dockview 当前为 source-only，不声称实际 engine 已加载。Infinite Canvas notice 只描述真实 host adapter/SQLite 边界。
- Capture 证据统一要求 entry、observedRoute、action、可见非零 bounds、PNG SHA-256、assertion；普通 route 也不再 blind preserve。旧 captured 条目缺新合同即 pending，必须新拍。
- `manualAcceptance` 与 BLOCKED 接受始终由用户决定，本轮不自动转为 accepted。

## Cherry 分层验收决策（2026-10-12）

用户在阶段门禁选择中明确选择“分层验收推进”。P0 按准确清单、基线和已实现契约验收；完整 compat strict gate 继续保留失败，并逐诊断关联 P1–P9 的真实依赖，最终必须通过。分层检查补充而不替换完整检查；不使用 noCheck、排除源码或虚构 API。阶段功能与源码审计继续执行，未实现能力仍显示 BLOCKED。该选择不授权最终完成声明、默认入口切换、commit/push 或自动远程操作。

## P1 Agent 存储与 source DTO 边界（2026-10-12）

- Agent blueprint 与 execution session 独立保存；历史标题/模型不用于身份推断。Grimoire runtime 与 Cherry source AgentType 是不同维度，OpenCode 不伪装成 pi/claude-code。
- `data.agentSession` 是 Grimoire adapter metadata；其中 config snapshot 不等价于 Cherry per-message MessageSnapshot，attachment descriptors 不等价于源 FileUIPart 引用关系。
- namespace 必须由 main 明确的 attach/snapshot 操作写入；普通 legacy data replacement 保持旧顶层语义，但不得擦除/任意覆盖 main-owned namespace。新增关联检查真实 active blueprint，历史 snapshot 不随 blueprint 编辑重算。
- source-shaped API 无法表达的 source type 必须返回 capability 错误；不静默过滤用户实体，也不虚构支持。

## P1 Topic tree persistence adapter (2026-10-12)

- Approved scope: explicit initialization of an existing real topic, append/select/branch read only; no legacy history adoption, source edits, UI, transport, runtime, siblings, duplicate or attachment ownership claims.
- DIRECT_REUSE evaluated: source shared message module has runtime provider-registry/aiSdk/model dependencies and requires zod (absent from host manifest); full MessageService binds Drizzle/application/usage/file stores. Importing that singleton would access Cherry's DbService rather than Grimoire SQLite. VENDOR already preserves the entire source closure; creating a second source DB is forbidden. WRAPPER alone cannot redirect those private ORM queries. ADAPTER accepted: translate the source scoped recursive CTE, root/content constraints, create parent resolution and active-node transaction to existing LegacyDatabase. PARTIAL_EXTRACTION accepted for the exact pure pagination block and shared role/status/response subset, with provenance in code. This is not a replacement MessageService; unadapted operations remain unsupported.
- Live schema is v32; additive v33 creates topic-owned content/topology and opt-in state. ai_messages, ai_attachments and session readers remain untouched. Root and active links are same-topic constrained; one root is unique. Initialization creates no content and never infers assistant from session owner.
- Source MessageData parts are runtime-opaque; this narrower foundation accepts JSON plain data but refuses file parts and persisted tool-output/file references until a genuine dedicated relation exists. Nonzero siblings groups and includeSiblings=true are unsupported. IDs generated as UUIDv4 satisfy source MessageIdSchema (any UUID). Existing topic IDs remain unchanged.
- Source getBranchMessages pagination is reused (latest ordered path, exclusive cursor); querying a node returns persisted active selection without changing it. Source append defaults to pending and setAsActive=true, explicit null attaches to root, internal active stays exact. Raw ancestor SQL adds explicit distance ordering and visited-cycle protection; this is a storage-channel adaptation, not a new navigation algorithm. Model selection enum validated; runtime-owned turnOptions explicitly unsupported in this slice.
- Verification: 11 focused real-SQLite cases pass; final full host suite 117 files / 912 passed / 2 skipped, main compilation and full bundle build exit 0, matrix validation 103 rows passes. Full unsuppressed Cherry compat strict gate still exits 2 on source-shell/router/composer contracts outside this backend slice. No lint script exists. Electron/manual acceptance not executed for these unexposed service methods. Three gates remain required; P1 stays PARTIAL.

## P2 source shell 导航边界（2026-10-12）

隔离 source shell 保留真实 MainApp/TabsProvider/AppShell/TabRouter 与原始路由拓扑；当前 hash compat/default 入口不替换。registered shell WebContents 是 navigation ready/open-route 唯一目标，不向其他窗口广播 route payload。preload 映射源 event 到 Grimoire channel，保持 sandbox 自包含。

源 live open-route 是 ephemeral；本 adapter 在 listener ready 前采用 bounded FIFO（32 条、15 秒 TTL）作为明确偏差，Promise 只在真实 send 后成功，overflow/expire/crash/close 显式错误。未提供 OS protocol ingress、tab attach 或 cold-init producer，不将 ready 当作它们完成。窗口 min/reset 是 sender-scoped source layout boundary，reset 960×600 与 legacy Grimoire 初始 960×640 的差异明确记录。

## Locked decisions

| Decision | Choice | Reason |
|---|---|---|
| Project mode | Source-level migration and integration | Mature source implementations are the primary engineering asset |
| Migration priority | Direct reuse, then Vendor, Wrapper, Adapter, minimal modification, partial extraction, reimplementation | Prevents convenience rewrites and feature shrinkage |
| Audit scope | All listed reference projects | Avoids missing mature capabilities |
| Vendor boundary | Preserve source structure under src/vendor/project | Keeps source behavior and future auditability |
| Grimoire bridge | src/integrations/project | Separates source code from local data and security adapters |
| UI fidelity | Preserve source UI and interaction; only theme, host, and data adaptation by default | A visual imitation is not migration |
| External features | Enter the matrix; adapt locally or retain as BLOCKED with diagnostics | No silent removal; user may hide later explicitly |
| Core integration model | Grimoire Core plus explicit application contracts, adapters, domain services, and a unified Tool Registry | Prevents mature projects from becoming directly coupled islands |
| UI/runtime boundary | UI consumes ChatEngine and normalized runtime events; it does not branch on Pi/OpenCode/Codex names | Allows runtime replacement and composition without UI rewrites |
| Agent composition | Pi is the kernel-level lifecycle foundation; OpenCode contributes advanced policy and engineering-agent behavior; other runtimes enter as adapters | Uses each source project at the boundary where it is strongest |
| Workspace boundary | Dockview is a docking implementation behind WorkspaceEngine; Grimoire owns editor semantics and persistence | Preserves source docking behavior without letting infrastructure own product state |
| Domain capability boundary | Prompt, Tag, Image, WD14, Canvas, and asset operations are services with explicit repositories and tool contracts | Keeps business rules reusable by panels and agents |
| Unified tool access | Agent-facing operations pass through ToolRegistry and Permission Policy | Gives UI, agents, MCP, approval, cancellation, and errors one contract |
| Persistence boundary | Grimoire SQLite, asset storage, settings, and project state remain the source of truth | Avoids parallel business databases and migration drift |
| Cherry source closure | Vendor the full local Cherry 2.1.4 source closure without overwriting the existing 597-file baseline; integrate through a compatibility build and Host Bridge | Preserves auditability while avoiding an unverified 357-package dependency injection into Grimoire |
| Cherry session domain | Store assistants and topics in the Grimoire AI tables with additive schema-20 resource projection and expose them through typed IPC | Keeps Cherry session UX compatible with one business data source without destructive schema replacement |
| Cherry runtime status | Keep unavailable source features visible as capability states with diagnostics | Prevents blocked Browser, Code, Knowledge, Selection, and Skills paths from becoming fake success flows |
| Milestone gate | Automated, functional, and migration audit | Tests alone do not prove source parity |
| Working tree | Preserve current uncommitted baseline | Existing user changes are in scope |
| Recovery | Local archives only; no intermediate completion commits | Avoids treating half-finished work as final |
| Remote actions | No GitHub push or remote release | Local-only development |

## Cherry Session resource-state extension (2026-10-09)

- Additive schema version 20 introduces `cherry_resource_state` as a Grimoire-owned projection for Cherry list lifecycle fields. Existing `ai_*` rows and legacy metadata remain authoritative for their original domains; migration backfills only missing projection rows.
- Cherry archive/restore/pin operations are explicit typed IPC/Host methods. They must not call the existing permanent-delete operation. Running sessions are rejected for archive with a diagnostic conflict.
- Topic message-tree parity remains blocked until `ai_messages` has an explicit topic ownership contract; a Topic list projection must not pretend one session's messages are separate Cherry topics.
- The compat Session ResourceList and Assistant/Topic resource rail remain behind the explicit Cherry window entry and use source ResourceList components through adapters. They do not become the default Grimoire workspace or bypass Host Bridge.
- Assistant archive is a sidecar-only projection because `ai_assistants` has no canonical archived column. Topic archive/pin update canonical `ai_topics` fields and mirror the sidecar transactionally because existing topic reads are session-scoped and filter canonical state.
- The current Topic ResourceList is intentionally session-scoped. Independent Cherry topic message ownership, active-node trees, branch/clear/export parity remain BLOCKED until `ai_messages` receives an explicit additive topic ownership contract.
- Provider/MCP compat status uses existing Grimoire Host APIs and source ResourceList/settings semantics, but does not import the full Cherry settings route tree. Provider sync is explicit pull → preview/filter → apply and preserves existing model IDs; it does not claim Cherry model metadata, multi-key health, endpoint types, or model CRUD. Provider secrets remain write-only through main-process safeStorage.
- Provider connection operations (`providers:fetchModelsFor` / `providers:testFor`) resolve the stored key by provider id inside the main process so the compat UI can honor "leave empty to use the saved key" without the renderer ever holding the secret; a key typed in the panel is passed per-call only, never persisted. Login-mode providers without a stored key call these endpoints keyless and rely on main-process auth material.
- The compat entry awaits source `initI18n()` before render (source contract) so source component labels come from real Cherry locale packs. Instead of adding a `preference` member to the shared contextBridge object, the source `PreferenceService` module is aliased to a compat shim (both `@data/PreferenceService` and `@renderer/data/PreferenceService` import paths) — the same module-alias pattern already used for `useModelSelectorData`. The shim keeps Grimoire SQLite/settings as the single store: it loads once from `settings.getAll`, re-reads on the existing `data:refresh` broadcast, maps `app.language` ↔ Grimoire `language` (`zh`↔`zh-CN`, `en`↔`en-US`), and persists Cherry-only keys as JSON under `cherry_pref.` in the existing settings table (additive; no schema change, no second store). Unknown keys fall back to the real source `getDefaultValue`, so unknown-language behavior still resolves to the source default (`en-US`). Live in-window language switching and the reverse projection of the full Cherry preference schema into Grimoire remain pending.
- Message parts project onto the source renderer's native AI SDK v6 shapes instead of Markdown lowering: code → `data-code`, errors → `data-error`, tool call/result/MCP → `dynamic-tool` with the fields `buildToolResponseFromPart` reads. This is an adapter projection (Grimoire stays the data truth); no Cherry renderer file is modified. Grimoire `tool-call`/`tool-result` intentionally both map to `dynamic-tool` and group by `toolCallId` in the source tool group.
- Session manual reorder follows the source's own constraint: item drag exists only outside time grouping, so the compat list defaults to source time buckets and switches to a single-group draggable list behind an explicit manual toggle. Order is stored as fractional order keys in `cherry_resource_state.order_key` (Grimoire-owned), the drop payload translates source `overId` + `before/after/last` into anchor neighbors, and a scope rebalance runs only when the two anchors leave no room. Array index is never the persisted order.
- Assistant and Topic reorder reuse the same fractional-key mechanism and the same explicit manual mode, with the source rail's own gates: `reorderEnabled` is false while archived rows are mixed in, `canDragItem`/`canDropItem` reject pinned rows (`item.pinned` is a source-level exclusion; `reorderable === false` covers the assistant equivalent), and topics keep `itemCrossGroup: false` because Grimoire topics are session-scoped and a cross-owner drag would be an ownership move, not a reorder. Topic ownership moves accept an optional `ownerId`, validate the target session, and commit canonical `ai_topics.session_id` plus the sidecar `owner_id`/`order_key` in one transaction — the source `moveTopic` shape — while same-owner drags stay a pure order write. The compat rail keeps separate manual-order state for sessions vs assistants/topics, matching the source's separate `SessionListOptionsMenu`/`TopicListOptionsMenu` preferences.
- The full-closure dependency audit resolves the CLOSURE_MANIFEST "357 packages not in the manifest" note: `source/node_modules` is a junction to `compat/node_modules`, so the compat install *is* the source tree's dependency closure. All 1,047 packages in that store carry licenses — no copyleft-only package; the only three without a `license` field ship MIT license files (`khroma`, `jstat`) or resolve solely through a node-support chain (`buffers`) whose code is absent from the shipped bundle. Nothing outside the compat install is required by the built renderer bundle, which is why the vendored closure remains an auditable snapshot rather than a second package manifest. The AGPL-3.0 LICENSE vs per-package MIT declarations stays recorded as a contradiction with the conservative reading applied.
- A pending Grimoire permission is projected as a synthetic `approval-requested` tool part owned by the newest assistant message, with `toolCallId` = `requestId` because Grimoire's permission broadcast is session-scoped and has no tool call of its own. The real source `PermissionRequestComposer` renders approval, and the answer maps to the existing `decidePermission` (`allowOnce`/`deny`); `allowForSession` stays reachable only through the Grimoire API until the source approval flow supports it.
- Pin toggling in the compat lists reuses the real source `useResourceListPinnedState` hook instead of a hand-rolled optimistic variant: it owns the per-id concurrency gate (`togglingIds`, surfaced to rows as a disabled state), the optimistic overlay, rollback by deleting the optimistic key on failure, and convergence-based reconciliation once the Host list catches up. The hook is exported from the source `resourceList/base` barrel, so no source change was needed.
- Resume and replacement follow the source `resourceEntity` semantics instead of list-head heuristics. `getLatestAiSession` / `getLatestAiTopic` implement the source `/agent-sessions/latest` and `/topics/latest` contracts as dedicated `lastActivityAt DESC LIMIT 1` queries (with kind scoping for sessions and `sessionId`/`unlinked`/global scoping for topics) because the source explicitly notes resume must not depend on the pinned-first list order. The `unlinked` scope is reachable only from legacy/imported rows whose owner session is gone — the FK cascade deletes topics with their session in the normal path — and the scoped query requires the owner row to exist so an orphan never answers as a live owner's topic. Archive-while-active picks the next display neighbour, else the previous one, else the most recently active remaining row, via the source `pickNeighbourAfterRemoval`/`findLatestActive` re-exported in compat `resource-replacement.ts`.
- Cursor paging was audited and deliberately not added: Grimoire lists and the source panels both load the full list (`loadAll: true` in the source; limit 100 here) and all remaining "load more" behavior is client-side group slicing on top of a full list. The source cursor transport (`CursorPaginationResponse.nextCursor`) is a DataApi concern that a Host-backed list without cursor endpoints would only fake, so the matrix records cursor paging as pending rather than simulating it.
- There are two host-bridge surfaces that must stay in sync: the typed bridge in `src/shared/cherry-host-types.ts` (with the renderer-side implementation in `cherry-host-bridge.ts`) and the compat-local fallback in `shims/cherry-host-provider.tsx`, which is what actually renders in the Cherry window because `main.tsx` mounts `CherryChatShellEntry` without passing an explicit bridge. Adding `latest` only to the typed bridge produced an uncaught `Cannot read properties of undefined` in the smoke run even though every unit test passed, so `getBridge` is now exported and covered by a contract test asserting every member of `CherryHostBridge` exists on the fallback.
- Live assistant output is projected through a local overlay (`live-turn.ts`) instead of reloading the session snapshot per stream chunk. The Host persists the assistant message only on completion, so the compat window would otherwise show nothing until the whole answer lands; the overlay accumulates text/reasoning/tool/compaction events into a synthetic `pending` message whose parts carry `state: 'streaming'`, matching the source's live shape (`isMessageListItemProcessing` keys off `status === 'pending'`, `MainTextBlock`/`ThinkingBlock` smooth-stream from there). Terminal events drop the overlay after the persisted snapshot refresh, mirroring the source `createOverlayRefreshHandoffOnTerminal` contract (refresh first, then drop). Text deltas are consumed by the overlay and never trigger a snapshot reload; other events still do.
- The composer drop/paste path is served by a real main-process File bridge rather than a compat shim. The source composer calls `window.api.file.get/getPathForFile/createTempFile/write`, `window.api.fs.readText`, and `ipcApi.request('file.get_metadata')` directly, so the Grimoire preload now exposes a `file`/`fs`/`ipcApi` surface backed by `file-bridge.service.ts`: paths resolve only inside main, `webUtils.getPathForFile` runs in the preload (Electron 42 requires it there), the temp area is a dedicated directory whose writes are path-confined, and the `ipcApi` dispatcher serves only the routes the compat window needs and rejects the rest loudly instead of returning undefined. The extension→type table is a bounded reimplementation of the source extension groups (those live in renderer-alias space); the authoritative gate for what may attach stays the Host attachment service's mime/size checks. `supportedExts` now offers the union of the source extension groups because an empty list rejected every drop/paste.
- Rail context menus resolve through the real source action registries (`resolveSessionMenuActions` / `resolveTopicMenuActions`) so labels, icons, ordering, groups, confirm dialogs and enabled-state stay source-owned, but the resolved tree is then filtered to an explicit allowlist of actions whose handler performs a real Grimoire write (session/topic rename, pin, archive). The source registries do not uniformly gate on handler presence, so passing a partial context would render items that throw when picked; the allowlist is the gating mechanism and everything unbacked (auto-rename, sidebar, open-in-tab/window, pane position, notes/knowledge, export/copy submenus, clear-messages, move-to-assistant) stays hidden until a Host service exists. `runCompat*MenuAction` re-checks the allowlist so a forged action id cannot reach the executor. `CommandProvider`, `PopupHost` and `ToastHost` are mounted as siblings of the window content (the source window composition) so `ResourceListActionContextMenu`'s confirm dialogs and the shared toast store have their hosts; the command hooks all have documented no-op fallbacks when the runtime is absent.
- The compat window navigates through a Grimoire-owned hash route registry (`route-registry.ts`) instead of local panel state, because the full Cherry route tree (`routeTree.gen`) is not part of the vendored closure and mounting the real router would fake a route surface it cannot render. The registry mirrors exactly the four implemented source paths — `/app/chat`, `/app/agents`, `/settings/provider`, `/settings/mcp` — and an unmatched path resolves to an explicit `unknown` route with a blocked view and a way back, never a silent fallback to a default panel. `hashchange` gives back/forward for free; an empty hash is replaced (not pushed) with the default route so refresh preserves the location without planting a history entry.
- Archive actions raise the real source `showRecycleBinUndo` toast — title from `recycle_bin.moved` with the item name, an Undo action that restores through the Host and then refreshes the list — rather than a hand-rolled notification. This is why `ToastHost` had to be mounted first; without a host the source popup service deliberately resolves the dismiss result instead of rendering into nothing.
- The compat window now adopts the source `windows/main/MainApp.tsx` provider order — `ThemeProvider → CodeStyleProvider → CommandContextKeyProvider → CommandProvider` with `PopupHost`/`ToastHost` as leaf hosts. The first visual-baseline run proved the previous composition was a real bug: `useCodeStyle` threw inside `ChatMarkdown` whenever a message rendered a code block because `CodeStyleProvider` was never mounted. Provider composition is treated as a fidelity contract, not a convenience.
- Visual baseline infrastructure lives in `src/main/visual-capture.ts` (env-gated by `GRIMOIRE_VISUAL_CAPTURE=1`, refuses to run in normal use) and `scripts/visual-baseline.mjs` (isolated `--user-data-dir` per run, populated + empty). The fixture is seeded through the real services so the captured UI is the real UI; loading/error states are deliberately not captured because forcing them requires breaking a live service or racing startup IPC. Theme capture writes the source's own `body`/`documentElement` classes and re-asserts them across two animation frames, because `ThemeProvider`'s effects otherwise revert an externally-set class on the next React commit. Scale is emulated with `webContents.setZoomFactor` — documented as zoom emulation, not true per-monitor DPI switching.
- The source Provider Settings page runs on a Grimoire-backed DataApi transport (`cherry-data-api.ipc.ts`, `window.api.dataApi.request`): the implemented `/providers*` routes map onto the existing providers table and answer in the source `DataResponse` envelope with the source `Provider` shape, while unimplemented routes return an explicit error envelope so a missing route surfaces as the source page's error state instead of undefined flowing into a component. Secrets stay write-only: list/detail/api-keys reads return a masked placeholder, and key replacement from the source editor encrypts through the same `encryptKey` the Grimoire save path uses.
- A `@tanstack/react-router` shim (aliased in both vite and vitest configs) serves exactly the hooks the mounted source settings subtree uses — `useNavigate({to, search?, replace?})`, `useSearch({strict:false})`, plus `useLocation` (the MCP settings view reads `pathname`), `useParams` (positional `serverId` derivation), `getRouteApi(...)`, and a null `Outlet`. Unsupported surface (`useRouter`, `<Link>`, path params on navigate) throws loudly rather than pretending the full router exists.
- The compat project sets `resolve.dedupe` for react/react-dom/jsx runtimes/scheduler. The vendored source tree and the compat entry could resolve React through two paths, emitting two React chunks; once the settings page was lazily split, its chunk received a different React instance and every hook in it failed with "Cannot read properties of null (reading 'useState')". Deduping pins one instance per package — a build-level fix, not a shim.
- The visual-capture fixture seeds two providers (one configured+active, one bare, no key material) so the `/settings/provider` route has real rows, and `GRIMOIRE_CAPTURE_ROUTE` navigates the window before capture. The route env value is normalized with a leading `#/` because a slash-less form passed through `location.hash` resolved relative to the file URL and produced `/C:/…`.
- The source Provider Settings page is a full-page surface, so the settings route renders it in the chat shell's main slot rather than the narrow resource pane where it was first mounted and cramped; the top bar swaps the chat title and hides the model selector on that route, since neither belongs to settings.
- `lru-cache` is now a declared direct compat dependency (`^10.4.3`). The source renderer imports it directly (`ShikiStreamService`, `InfiniteQueryCacheManager`, the shiki worker) but it was only ever transitive, so Node resolution escaped past the compat install to the repo root's `lru-cache@6`, where `LRUCache` does not exist — `ou.LRUCache is not a constructor` broke renderer startup the moment `CodeStyleProvider` made the codemirror path load. This is the resolution-gap class the import audit tool exists to find; the manifest is the fix, not a shim.
- MCP marketplace/prompts/resources/trust/log/restart/auto-approve capabilities remain partial or blocked unless a matching Grimoire service exists. Tool enablement only persists `enabled_tools`; the panel never calls tools implicitly.
- The source MCP settings page (`McpServersList`) mounts at `/settings/mcp` on the same `cherry-data-api.ipc.ts` transport as the provider page: `/mcp-servers` (list/detail/create/update/delete) and `/mcp-servers/:id/tools` answer in the source response shape with `total`/`items`, mapping between the source `type` (http/stdio) and the Grimoire `transport` column. The list query filters (`id`/`isActive`/`type`) are honored because `useMcpServer(id)` reads the detail through the list route with `params.id` and takes `items[0]` — ignoring the filter would render a different server's detail. A name-less create answers the source's own error path (500 + `MCP_NAME_REQUIRED`), and the collection `PATCH /mcp-servers` reorder route answers an explicit error because Grimoire has no MCP order column (the source hook then reverts its optimistic order, which is the honest outcome). The source `ipcApi.request(route, input)` routes the MCP runtime commands the page issues (`mcp.server.refresh_tools`/`stop`/`remove`/`restart`/`check_connectivity`/`get_version`/`list_prompts`/`list_resources`/`get_logs`) to a main-process handler; connections stay on the existing Grimoire MCP service, so the UI never opens a transport of its own.
- The `IpcResult` envelope is the source's error channel — the renderer facade THROWS on `{ok:false}` — so a failed MCP connect must reject the `refresh_tools` route, never resolve. `connectMcpServer` reports failure as a `failed` status record rather than throwing, so the transport checks the status and answers `{ok:false, code:'MCP_CONNECT_FAILED'}`; otherwise the source card's try/catch would never fire and a dead server would render as a live connection. Similarly the `z.void()` routes resolve `null` (not the disconnected record), `get_version` answers the contract's `null` (Grimoire has no server version to report), and prompts/resources/logs answer the empty protocol arrays the source consumes untyped instead of inventing content. `handleIpcApiRoute` existence-checks before calling connect/stop/remove/restart so an unknown id answers `NOT_FOUND` rather than the generic `INTERNAL` its throw would otherwise produce.
- The source MCP detail page mounts at the parameterized `/settings/mcp/settings/$serverId` route. The route registry gains the pattern (with `decodeURIComponent` on the id), the router shim's `useNavigate` substitutes `$param` templates from the call's `params` (a missing param throws rather than producing an empty segment), and `useLocation`/`useSearch`/`useParams` now subscribe to `hashchange` through `useSyncExternalStore` — the previous `useMemo(…, [])` snapshot kept serving first-mount params, which would render the detail page for the wrong server after a navigation. `/settings/mcp/servers` is registered as an alias of the list route because the source layout uses it as the list's canonical path.
- The source `McpServer` projection maps the single Grimoire HTTP transport onto the source `streamableHttp` type (the source form validates `serverType` against `stdio|sse|streamableHttp|inMemory`, so emitting the raw Grimoire `'http'` made every save fail validation), and inverts the Grimoire `enabled_tools` allowlist into the source `disabledTools` denylist — an empty allowlist means every tool is disabled, because that is exactly what `registerMcpTools` registers.
- The MCP update route applies a three-way field policy instead of either strict rejection or silent drops: storable fields are written; fields the source form merely echoes back (trust/install/package metadata it cannot set) are ignored; and editable fields with no Grimoire column (`description`, `headers`, `timeout`, `longRunning`, `registryUrl`, `tags`, `disabledAutoApproveTools`) are rejected with `MCP_FIELD_UNSUPPORTED` when they carry a real value. The source detail page saves the WHOLE server object, so the value test — not key presence — is what separates an untouched default from a change the user would expect to persist.
- The mounted source MCP pages read runtime status and tools from the renderer shared cache, which Cherry's main `CacheService` fills. That service is bound to Cherry's application core and is not mountable here, so `mcp-cache-bridge.service.ts` serves the same two channel names (`cache:get-all-shared`, `cache:sync`) over the Grimoire MCP tables as the single writer, projecting `mcp.status.<id>` and `mcp.tools.<id>` in the source value shapes. The tool wire id reproduces the source `buildMcpToolWireId` digest byte-for-byte (`sha256(serverId + '\0' + toolName)[0,20)`); only the source's CJK romanization step is not reproduced, and `matchesMcpSourceToolRule` also matches the raw tool name, so rule matching stays intact. Entries are derived on read and re-derived after each mutation — a projection, never a second store. `connectMcpServer` is now idempotent for a live stdio process (re-lists instead of respawning) because the tools tab refreshes on activation for an already-connected server.
- Additive schema v24 stores the source MCP detail-form fields that previously errored on save: `mcp_servers.description` (free-form note), `headers_json` (custom HTTP request headers), `timeout_seconds` (per-request timeout), and `disabled_auto_approve_tools_json` (the tools tab's per-tool auto-approve suppression). Headers and timeout are consumed, not just stored: the HTTP transport sends the user headers before the protocol-controlled accept/content-type/session headers (so a user header can never break the transport) and uses `timeout_seconds` for its `AbortSignal` when set. `disabled_auto_approve_tools` is consumed by both permission paths (`ai-sessions.ipc.ts` and `agent.ipc.ts`) through `isMcpToolForcePrompt(registeredName)`: a tool the user forced to prompt bypasses every auto-allow branch (full mode, automatic+read, session grant) and always raises a request. It can only force a prompt, never grant — the same asymmetry the source's `isMcpToolForcePromptBySource`/`resolveMcpSourceToolAccess` has. Rule matching accepts the raw tool name, the wire id and the `mcp__<server>__*` wildcard, mirroring `matchesMcpSourceToolRule`. The migration is the same additive ALTER-with-try/catch pattern as v20–v23, is idempotent, and runs under the existing pre-migration backup (verified by `database.v24.test.ts`). `listMcpServers()` keeps its renderer-safe default (env/headers values masked); main-process callers that must know the stored keys pass `includeSecrets: true`.
- The MCP transport masks secret-bearing `env`/`headers` VALUES with the same placeholder the provider routes use while keeping the KEYS visible, so the source detail form renders one row per stored entry without the renderer ever holding a secret. A save that echoes the placeholder back restores the stored value (`restoreMaskedMap`) instead of persisting the mask — without this, a form load/save round trip would silently wipe stored credentials.
- The source Appearance settings page mounts at `/settings/appearance`. Its whole data surface is already backed: the preference hooks go through the compat preference shim (which persists every key under `cherry_pref.` and maps `app.language`), and the two runtime routes are served for real — `app.adjust_zoom` reproduces the source `handleZoomFactor` semantics (reset → 1, `delta: 0` is a pure read, a delta only applies inside [0.5, 2.0]) against the same `app.zoom_factor` key the shim stores, and `window.api.application.relaunch` (called after a menu-style/title-bar change) reloads the windows rather than restarting the process, because a process restart would also terminate unrelated windows and in-flight work. `system.get_fonts` answers the empty list the source already handles for a failed enumeration instead of inventing font names — the page renders its own fallback options; a real font-enumeration service is the recorded gap.
- `settingsRoute` in the compat entry is a single predicate covering every settings surface (provider, MCP list, MCP detail, appearance) instead of the growing chain of `route.id === …` disjunctions at each call site, so adding a settings page is a one-line change in exactly two places (the predicate and the surface switch).
- The two shell routes the source settings pages share (`system.shell.open_path`, `system.shell.open_website`/`open_external_website`) are served on the DataApi transport by delegating to the SAME validation Grimoire's own `system:showItemInFolder`/`system:openExternal` handlers use — an http/https-only URL gate and a path that must resolve to an existing file — rather than a second, laxer implementation. A rejected scheme or missing path answers a typed error envelope, so the source page shows a real failure instead of a silent no-op.
- The source `GeneralSettings` page is deliberately NOT mounted, even though its preference keys would persist through the shim without any new transport work. Every control on that page promises a main-process behaviour — tray visibility and close/launch-to-tray, launch-on-boot, the hardware-acceleration Chromium flag, the system/custom/none proxy, prevent-sleep-while-busy, the chat retry/fallback policy, and the context-compression thresholds — and an audit found no consumer for any of them in Grimoire's main process. Mounting it would render switches that look functional and change nothing, which is the mock-success state the migration rules forbid. `/settings/general` therefore resolves to a dedicated blocked diagnostic that names each missing service; the page becomes mountable as soon as those services exist, with no further compat work needed.
- `@hookform/resolvers` is now a declared direct compat dependency (`^5.2.2`): the source MCP server form imports `@hookform/resolvers/zod`, which was installed only transitively through the source tree and was not resolvable from the compat manifest — the same resolution-gap class as `lru-cache`, fixed at the manifest rather than with another alias.

## Tag/Gallery migration decisions (2026-10-09, wave A)

- Additive schema v21 repairs tag data before new query surfaces build on it: prompt asset keys are unified to `prompt:`+asset id (writer fixed in `prompt-asset-browser.ts`; existing rows backfilled with marker `asset_key_prompt_prefix_migrated`, would-be UNIQUE duplicates collapsed first), `tag_usage` is backfilled from accepted links (marker `tag_usage_backfilled`) and maintained by assign/remove/batch hooks, and legacy `child` relation rows are reversed into canonical `parent` rows (marker `tag_relation_direction_normalized`). Existing rows, tables and permanent deletes are untouched; all three steps are transactional and idempotent.
- Canonical tag relation direction: for `implication` and `parent`, `source` is the more specific tag and `target` is the more general one. Forward closure (`expandTagRelations`) walks source→target for "implied/general" expansion; descendant expansion (`expandTagDescendants`, used by asset filtering `includeImplied`) walks the reverse direction so filtering by a general tag includes items tagged with specific descendants. Depth is capped (default 8) and `UNION` plus disabled-edge filtering bound cycles. `child` remains only a historical input alias and UI writes must use `parent`.
- Tag search is rewritten clean-room in `tag-query.service.ts` (the previous `searchTags` OR-JOIN multiplied rows and its relation-match branch was unreachable). `TagSearchResult.matchedBy` gains `'fuzzy'` additively; ordering and 0.65/0.9/1.0 scoring keep the previous contract.
- Tag group copy/import/export now carry metadata, aliases and relations with a fresh id map; relation edges whose endpoints are not both inside the copied scope are skipped and counted, never silently invented. Import remains compatible with legacy payloads that lack the extended arrays.
- License boundaries for this series: BooruDatasetTagManager (MIT) algorithms may be ported with notices and the two third-party-provenance AiApiServer tagger files are never used; TagMaster is UNLICENSED → behavior specifications only, zero code copying; TagStudio (GPL-3.0) → data-model/search-semantics reference with clean-room SQL/TS; SD Image Sorter (MIT) rules may be ported with notices; Hydrus (WTFPL) semantics are reimplemented with attribution. Allusion has a three-way license conflict (root LICENSE = GPL-3.0 full text vs package.json "ISC" vs the 2026-10-03 audit sheet) and is therefore treated conservatively as GPL-3.0: UX/information-architecture reference only, no code extraction, until the conflict is resolved in writing.
- Parallel-session minimal-invasion protocol: `database.ts` changes append only at four anchor tails (SCHEMA_SQL, ALTER try/catch list, migration functions + call lines, INDEX_SQL); `preload/index.ts`, `shared/types.ts` and `global.d.ts` append members at section tails; schema version arbitration is `max(current, other-session)+1` recorded here if the number shifts. The preload keeps its self-contained local `IPC_CHANNELS` copy and must be extended in both places. Agent/AI-side files (`ai*.ipc.ts`, `agent*.ipc.ts`, `chat.ipc.ts`, `src/main/ai/**`, `task-runner.ts`) are not touched by this series.
- Startup migration cost: `migrateTagIntelligence` and `migrateMediaAssets` gain self-healing count guards (skip the full-table loop when projections are complete) instead of hard markers, preserving the previous healing behavior for drift while removing steady-state rescans.

## Tag/Gallery migration decisions (2026-10-10, wave B)

- Prompt weight semantics (ported from BooruDatasetTagManager PromptParser, MIT): round brackets scale ×1.1 per level, square brackets ÷1.1; an explicit `(tag:1.3)` replaces the inner value while outer brackets still scale it; `BREAK` emits a literal separator token; duplicate names in one polarity merge by summing deltas (`1 + Σ(w − 1)`) before clamping to the Grimoire [0.1, 2.0] range. `serializePrompt` keeps the historical `getFullPrompt` byte contract (bare name at weight 1, `(name:w)` otherwise, `", "` joins, `--neg ` prefix, `\n` between segments) and is now the single serializer behind the store, copy actions and the magnifier preview.
- `PanelTag` gains an optional `breakBefore?: boolean` (additive) so a parsed BREAK survives state, undo/redo and serialization; chips render the marker only through serialization, not as a separate UI element.
- TagMaster-derived interactions are behavior-only (UNLICENSED): the two-stage autocomplete, three-state implied display and promote/exclude gestures are clean-room implementations consuming Grimoire IPC (`searchAdvanced`, `expandRelations`); no TagMaster code, data structures or naming were copied.
- `impliedExcluded` in the prompts store tracks tags whose implied state the user suppressed; promoting a tag clears its exclusion; exclusions are filtered at render time so toggling is instant while the relation closure is fetched once per selection change (debounced 120ms, race-guarded).
- The asset tag batch suite targets orderless `asset_tag_links`; BDTM's position options (top/bottom/custom) are intentionally not offered because the link model stores no order — the matrix row documents this instead of faking it. `onlyEmpty` scopes to the asset registry (image_refs / prompt_assets) because a tag filter can never match an asset without accepted tags; an optional tag filter intersects with that scope. Over-count confirmation threshold: 200 assets; execution is chunked at 500 keys per batch call and refreshes tag usage through the existing hooks.
- WD14 candidate batch actions reuse the pre-existing `TAGS_SUGGESTIONS_BATCH_RESOLVE` handler (now exposed through preload) instead of orchestrating per-id accepts from the renderer.
- The new `tag-batch` workspace panel type is registered additively in `panelTypes.ts`, `PanelRegistry.tsx` (definition + material group + renderer case) and the `WORKSPACE_POPOUT_TYPES` allowlist; the `EDITOR_DEFINITIONS` cast was hardened to a double assertion (type-level only, no runtime behavior change) because the widened PanelType union tripped the overlap check.
- Parallel-session protocol continues: preload's self-contained `IPC_CHANNELS` copy and the shared `IPC_CHANNELS` const are extended together for every new channel; renderer files owned by the agent-direction session were not touched.

## Tag/Gallery migration decisions (2026-10-10, wave C)

- Schema v22 (additive, marker-guarded): `image_refs.width/height/file_mtime`, `image_generation_metadata.origin`, `asset_tag_links.asset_ref_id` + `idx_asset_tag_links_ref`. Backfills: numeric `image:<int>` keys (exact all-digit, >0) project into `asset_ref_id` once (marker `asset_ref_backfilled`); historical generation rows are marked `comfyui-grimoire` once (marker `generation_metadata_origin_backfilled`). New `asset_tag_links` writes maintain the projection through `upsertAssetTagLink`; new generation rows written after the marker keep `origin=''` (unknown) rather than being guessed.
- Embedded-metadata persist policy: parsing never clobbers explicit generation records — the upsert uses COALESCE semantics per field, `origin` is only written when currently empty, and `loras_json='[]'`/`raw_json='{}'` count as empty. The `model` column carries the checkpoint name (matching what ImagesPanel displays); `provider` stays empty and the model hash is preserved in `raw`. Import paths (managed copy, external link, pasted base64) fire `parseMediaMetadata` after registration; failures never block the import.
- Zero-dependency parsing policy: PNG chunks (tEXt/zTXt/iTXt via node:zlib), ComfyUI graphs and A1111/NAI text are handled natively; JPEG EXIF UserComment got an inline minimal reader instead of adding `exifr`, so no new runtime dependency enters the root manifest (the plan's optional exifr path was rejected in favor of zero-dep).
- `onlyEmpty` batch semantics and the gallery query shapes follow the wave B/A contracts: asset registry scope, asset_ref_id join subquery, whitelist sort compilation with a stable `m.id` tiebreaker, parameterized search. The EXPLAIN regression asserts no `SCAN asset_tag_links`; the planner currently picks `idx_asset_tag_links_tag` for tag IN-lists, with `idx_asset_tag_links_ref` available for ref-first patterns.
- Performance gate recorded: bench-gallery.mjs (deterministic synthetic seeds) shows 10k assets p95 9.4ms and 100k assets p95 42.0ms, far under the 500ms task-book gate; the script is opt-in (not part of CI) with `--rows=10000` as the default quick mode.
- Import-time probe: `probeImageDimensions` (PNG/JPEG/WebP/BMP) plus file mtime are written at import for managed/external/pasted images; legacy rows are backfilled by the metadata scan rather than a startup migration, keeping startup cheap.
- Wave C was developed with three parallel subagents delivering self-contained modules (`media-metadata.*`, `thumbnail.service`, `gallery-query.service` + bench) while schema v22, probes, and all shared-file wiring were done in the main session under the anchor-tail protocol; every module self-tested before integration and the integrated suite ran green.

## Tag/Gallery migration decisions (2026-10-10, wave D)

- The new gallery experience ships as the additive panel type `gallery-search` (filter rail + toolbar + virtual grid + inspector + saved searches) while the legacy `ImagesPanel` stays untouched — the parallel agent-direction session actively edits `ImagesPanel.tsx`, and preserving it verbatim is the strongest guarantee that existing behavior survives. The matrix rows note both surfaces; unifying them is a wave E / post-regression decision.
- SDIS selection tokens are modeled as `explicit` vs `allFiltered` in `gallery.store.ts`, with range selection anchored to the visible window. Footer batch operations apply to explicit selections only; when `allFiltered` is active the UI routes users to the tag-batch panel instead of faking a cross-filter batch over an unconverted query shape.
- Saved searches store opaque JSON payloads (query + sort) produced by the renderer store; the main-process service validates name/shape/size and never interprets the query. Schema v23 adds `tag_saved_searches` with pinned-first ordering.
- Allusion remains a strict conservative-GPL reference: the three-pane information architecture (outliner / content / inspector) inspired the panel composition, but no Allusion code, DOM structure or styling assets were copied; the license conflict is still recorded as pending resolution.
- `HoverPreview` extracts the WD14 inline 500ms behavior into a shared component with explicit delay/hide timers, scroll/resize dismissal and timer-leak-free unmount; WD14Panel keeps the exact 500ms and preview content. The canvas-vendor hover preview is untouched (separate adapter surface).
- WD14 history rows now expose `image_snapshot_path` (additive field in `WD14HistoryRecord`) so the reveal action can call `system:showItemInFolder`; this follows the existing precedent of exposing managed file paths to the renderer (images.list already does), while the actual path validation stays in the main process.
- Wave D again used parallel subagents per module (virtual grid, WD14+HoverPreview, filter/toolbar/saved-searches) with frozen interfaces (`gallery.store.ts`, `lib/virtual-grid.ts` written first by the main session); schema v23, backend service, all IPC/preload/global wiring, panel registration and the host panel were done in the main session.

## Tag/Gallery migration decisions (2026-10-10, wave E)

- The search syntax is a documented clean-room subset: `key:value` and `[key=value]`, `tag:`/`parent:`/`namespace:`/`name:`, quoted strings, `-`/`NOT`, `AND`/`OR`, parentheses, and the attr keys source/favorite/rating(range)/sort/order/limit. Constructs the flat tagFilter model cannot express honestly — text OR, parent+tag group mixes, mixed any/all groups, nested negation — are surfaced as per-construct diagnostics and skipped rather than approximated. The parser resolves nothing itself; all tag/namespace lookups happen in the compiler through injected resolvers, keeping both layers unit-testable.
- `excludeTagIds` becomes a first-class gallery filter (parameterized NOT IN subquery, independent of the include set); `-tag:x` compiles into it. This closes the Hydrus negation semantics row for the asset query path.
- Saved searches gain versioned JSON import/export through the existing dialog save/open IPC; imports are tolerant (bare arrays accepted), per-entry failures counted, and payload validity is enforced both in the dialog flow and in the saved-search service.
- `tags:expandRelations` gains a `direction` parameter ('forward' default, 'descendants' for parent substitution) instead of introducing a second channel; time is not duplicated across new IPC surfaces for the same relation closure.
- Six-project seed rows moved only with the wave A–E evidence: hydrus (NOT_IMPLEMENTED → ADAPTED for the search-semantics surface) and Allusion (NOT_IMPLEMENTED → ADAPTED for the conservative-GPL information-architecture adaptation); BDTM/TagMaster/TagStudio/SDIS stay PARTIALLY_MIGRATED with named remaining behaviors (AutoTagger model decision, grouped browse, metadata field editor, CLIP/dup/smart-folders respectively). No row reaches a completion state without the Electron visual/functional pass, which remains the outstanding functional gate for waves A–E.

## Cherry compat stylesheet contract (2026-10-10)

- **The compat window now loads the source's own two stylesheets instead of a hand-rolled subset.** The source renderer entry (`source/src/renderer/windows/main/entryPoint.tsx`) imports `@renderer/assets/styles/index.css` then `@renderer/assets/styles/tailwind.css`; the compat project had been importing a partial `tailwindcss` + tokens + theme + product set. Per the required implementation order this is DIRECT_REUSE (level 1) of the source stylesheet contract, replacing what was effectively a REIMPLEMENT.
- **Root cause of a measured utility-coverage collapse.** Tailwind v4 detects content relative to the project base — for the Vite plugin, the Vite root, which for this project is `compat/`. The sibling `../source` tree this surface actually renders was therefore never scanned: **112 / 1494 (7.5%)** of the utility tokens the source tree uses existed in the built CSS. Restoring the source stylesheets plus explicit `@source` roots for `source/src` and `source/packages/ui/src` (the latter upstream already declares in its own `tailwind.css`) brings it to **1401 / 1421 (98.6%)**.
- **First visible symptom, now fixed:** the source `Dialog` painted in normal flow at the bottom of the page instead of centred over an overlay. `.fixed`, `.top-[50%]`, `.left-[50%]`, `.translate-x-[-50%]`, `.rounded-3xl`, `.p-6` and `.animate-in` were all absent. An *open*, `opacity: 1`, `visibility: visible` confirm dialog measured `rect {x:0, y:763, w:1266, h:268}` in a 1280×770 window — i.e. invisible. It now measures `rect {x:409, y:218, w:448, h:328}` (centred, transform applied) and paints over a dimmed overlay.
- **The two stylesheets stay separate modules.** Concatenating them into one compat stylesheet puts `@import` after rule blocks, which is invalid CSS — the build fails with `CssSyntaxError: Missed semicolon` at the seam. `@source` is likewise only honoured in a sheet that also carries `@import 'tailwindcss'`, which is why the roots live in the compat `tailwind.css` sibling rather than the application stylesheet.
- **Two dependencies added to the compat project** (both already declared by the source's own manifest, `compat/source-package.json`): `tw-animate-css@^1.3.8` (imported by the source `tailwind.css`; `@tailwindcss/vite` had no `exports` entry for it, so the earlier hand-rolled entry silently omitted it — the `animate-in`/`fade-in-0`/`zoom-in-99` families) and `@fontsource/ubuntu@5.2.8` (the source `ubuntu.css` `@font-face` sources). Both installed with pnpm, which the project requires.
- **`scripts/check-compat-css.mjs` is the regression guard.** It scans the source trees for utility-shaped className tokens, measures how many exist in the built CSS, and fails below 90%. It excludes three shapes Tailwind never generates a rule for, so the number measures a real gap: `group/x`/`peer/x` variant *markers* (the compiled CSS only carries the consuming `group-hover/x:` variant), SVGR-prefixed names (`wrap_svg__size-4`, AST identifiers only), source hook classes targeted by descendant selectors in `layer(app)` stylesheets (`.table-wrapper`, `.latex-preview`, …), and ten HeroUI-era leftovers no stylesheet in the closure defines (`text-default-700`, `border-default-200`, `text-danger`, …). The last group is a pre-existing upstream defect, named here rather than fixed: editing read-only `source` is forbidden.
- **Capture diagnostics added** (`src/main/visual-capture.ts`), because screenshots alone cannot distinguish "never opened" from "opened but invisible" — the exact ambiguity that hid this bug. A `GRIMOIRE_CAPTURE_ROUTE` run now writes `route-diagnostic.json` (hash, decoded search record, dialog count/text/computed style/rect, a 6-sample dialog timeline) and `route-diagnostic-matrix.json` (dialog count per matrix frame), and saves `route-diagnostic-dialog.png` — a real `capturePage` frame proving the dialog *paints*, not merely mounts.

## Obsidian export: read the app's own registry, don't ask for a folder (2026-10-10)

- **The panel is a config surface for an exporter, so the honest slice was the exporter's data source, not the form.** `ObsidianSettings` stores a default-vault preference; the thing that actually needs real data is `ObsidianExportDialog`, which lists vaults and their file trees. The source reads Obsidian's own vault registry file rather than prompting for a directory, and this implementation does the same — a `selectFolder` picker would offer a *different and larger* set than the vaults Obsidian itself manages, so "pick your vault" would be a materially different feature wearing the same label.
- **Verified against a real install rather than a fixture alone.** The machine has Obsidian with three registered vaults; the live routes return all three with correct paths and walk one vault's actual structure. A unit test with a synthetic config proves the parser; only a real run proves the platform path resolution, which is the part most likely to be wrong (three different config locations, plus the source's Linux case tolerance).
- **Empty is a valid answer, and it must not be confused with failure.** Missing config (Obsidian not installed), a vault path that is not a directory, and malformed JSON all answer `[]` — matching the source's own catch-and-return-empty. The dialog then renders "no vaults found", which is a true statement about the machine. Throwing would surface as an error toast implying the feature is broken rather than absent.
- **Hidden entries are excluded deliberately.** `.obsidian` holds Obsidian's own configuration, so offering it as an export target would let a user write markdown into the app's config directory. The source skips dot-entries and this follows it.
- **The macOS config path cannot be redirected for testing**, because it derives from `os.homedir()` and ignores env vars. Rather than write into a real home directory, that branch's test is skipped on Windows with the reason recorded in the test file. This is a coverage gap stated plainly, not a silent one.

## Conversation import: two missing write routes (2026-10-10)

- **The import panels were already mounted; what was missing was their write path.** `DataSettings` composes the import/export panels itself, so they render as soon as their sidebar item is selected. The gap was underneath: `ImportService` posts to `/assistants` and `/topics` through the DataApi — NOT through the Host Bridge the rest of the compat entry uses — and neither route was bridged. An import would have rendered its dialog, accepted a file, parsed it, and failed at the first write. A UI that renders is not evidence its backend exists, which is why the routes were checked rather than assumed from the panel appearing.
- **Two transports, one window.** The compat entry reaches Grimoire through the Host Bridge (`hostTopics.save(...)`), while source services like `ImportService` reach it through the DataApi (`dataApiService.post('/topics', ...)`). Both are legitimate source contracts and both must be served; a feature is only migrated when the path THAT FEATURE uses is implemented. This is the second time a source-side transport needed a route the Host Bridge already had an equivalent for.
- **Wire shapes follow the consumer.** The new routes emit SOURCE field names (`prompt`/`emoji`/`modelId`/`groupId`, `name`/`orderKey`/`lastActivityAt`) rather than Grimoire column names, because the reader is a source module. Where Grimoire stores a non-null `''` that the source models as optional, the empty value is omitted rather than sent as `''`, so an unset field does not arrive looking set.
- **`orderKey` is real; `activeNodeId` is honestly absent.** `orderKey` reads the topic's fractional order from the resource-state projection. `activeNodeId` is omitted, not defaulted: Grimoire has no per-topic message tree, so there is no active node to name — the same gap recorded for topic thread parity. Emitting a plausible value would misrepresent a tree that does not exist.
- **Invalid input is a caller error, not something to guess.** `name` is required by the source assistant schema, and a Grimoire topic always belongs to a session; both are rejected with `INVALID_INPUT` rather than supplied with a default that would silently create a record nobody asked for.

## Source windows: a capability matrix, not a mounting spree (2026-10-10)

- **The plan requires a window capability matrix before any window is connected, and the matrix is the deliverable.** `.agent/WINDOW_MATRIX.md` records, per source `WindowType`, its lifecycle, required services, status and blocker. Writing it first is what makes "not connected" a decision rather than an oversight — and it surfaced that two enum members have no renderer window at all (`mcpBrowser`, `print`), which is a fact worth having recorded rather than rediscovered.
- **Two windows are `NOT_APPLICABLE` rather than BLOCKED, and the distinction is load-bearing.** `mcpBrowser` and `print` have no entry in `renderer/windows/` — verified by listing, not inferred from the enum — so there is no UI to migrate. `migrationV2` is different again: the window exists and is migratable in principle, but it operates on a Cherry v1 profile, and a Grimoire install has none. Calling these "blocked" would imply pending work; they are not pending, they are not applicable.
- **The remaining blockers are all main-process infrastructure, and none is a UI task.** A multi-window lifecycle service serves three windows; global input hooks serve three more; a capture pipeline serves one; the relocation protocol is refused by choice. Mounting any of these windows with a stubbed lifecycle would render something that looks like a working detached conversation or selection toolbar and behaves like nothing — the exact fake-success state the plan forbids. The matrix names the infrastructure instead.
- **The domain capability map was accurate and invisible — rendering it was the fix, not rewriting it.** `cherry-host-provider.tsx` already reported each product domain's state with the missing service named. Nothing consumed it, so the information existed only in source. `CompatDomainCapabilities` reads the map rather than restating it, so adding or unblocking a domain changes the display with no edit to the component.
- **A real bug in `CherryHostProvider` surfaced while testing the panel.** It constructed the `getBridge()` fallback with `useMemo(() => getBridge(), [])` — unconditionally, even when a bridge was passed. `getBridge()` reads `window.api` at call time, so an injected bridge was unusable in any context where the preload had not run. The fallback is now built lazily. This was found because the test could not render at all, which is the useful kind of test failure.
- **A self-correction worth recording:** while investigating a residual "Missing initializer in const declaration" line, I nearly reported a probe syntax bug. The line was from an OLDER run in an accumulated log file — the capture log appends across runs, so a fresh run's tail can still contain earlier failures. Verified by deleting the log and re-running (0 errors), and by locating the run boundary markers. The probe parses valid at the correct offsets; my ad-hoc validation script had an off-by-one that manufactured the error. Two wrong signals, one real conclusion: check whether a log is fresh before treating a line in it as live.

## Visual baseline enforcement (2026-10-10)

- **Two comparison layers, strict where it is deterministic and tolerant where it is not.** Structured signals from `route-diagnostic.json` (pathname, rendered-text length, fatal-fallback presence) are enforced exactly; pixels are compared with a 2% per-frame tolerance. Pixels alone would be noise — anti-aliasing, font hinting and scrollbar rendering differ between machines — while the structured layer is what actually guards behaviour: a route that stops rendering or crashes into the fatal fallback changes a structured value and fails immediately. Keeping both means a layout regression the structured layer cannot see is still caught.
- **No image dependency was added for this.** The captures are Chromium PNGs (8-bit, non-interlaced, colour type 2 or 6), so `visual-compare.mjs` carries a small decoder for exactly that subset rather than pulling in a general image library for a build-time check. Anything outside the subset is reported, not guessed.
- **A frame that cannot be compared is a FAILURE, not a footnote — this was a real defect in the first version.** It printed "对比通过" while 1 of 15 frames had failed to decode, which is precisely the "reported clean while broken" shape this whole gate exists to eliminate; the same mistake had already been made and fixed in the capture path, and it recurred here. Comparison is now mandatory for every frame present in both baseline and run, with `--allow-uncomparable` as an explicit, self-announcing escape hatch for a machine whose PNGs the decoder genuinely cannot parse.
- **Both layers were mutation-verified, not just observed passing.** A clean compare exits 0; a frame swapped for a different one is caught at 99.99% pixel difference; an undecodable frame exits 1. A gate that has never been seen to fail is not evidence of anything.
- **The non-happy-path fixture is seeded through real services.** The failed and running sessions are created with `createAiSession` and marked with `updateAiSession` — the same call the runtime uses — rather than by writing a status directly into the table. A fixture that fabricates a state the runtime cannot produce would baseline a screen that never occurs.

## Visual gate: a blank window fails the capture (2026-10-10)

- **A capture that cannot render its route must FAIL, not report success with a screenshot.** An earlier slice shipped a blank page — the renderer crashed into the source `WindowFatalFallback` — and the run still reported "0 problems" and 16 written screenshots. Nothing was logged as an error, because the crash produced no exception on any channel the main process observes. A gate that cannot fail on a broken page is not a gate.
- **The detection keys on the fallback's own structure, not on a generic signal.** The first version treated any visible `role="alert"` as a failure. That false-positived immediately on the BLOCKED diagnostics page (`settings/general`), which legitimately uses `role="alert"` to announce that a surface is not implemented. The check now looks for the `WindowFatalFallback` signature — a full-viewport container carrying BOTH 打开调试面板 and 重新加载 — since either phrase alone could occur in ordinary content but the pair only occurs in that fallback. Verified in both directions after the change: the BLOCKED page passes, and reintroducing the crash fails the run.
- **An empty content region is also a failure.** `contentTextLength === 0` on the main column means nothing rendered at all, which is the same user-visible outcome by a different route. It is checked independently of the fallback signature so a future crash mode that does not use the source fallback is still caught.
- **The failure has to reach the caller, which meant fixing the exit path.** `runVisualCapture` caught its own error, logged it, and quit with code 0 — so even a correct in-process detection would have been invisible to the driver script and to CI. A failed capture now calls `app.exit(1)`. The log line stays (it is the detailed record); the exit code is what the surrounding tooling actually observes.
- **These were real, not hypothetical.** Both halves were verified by reintroducing the exact regression that motivated them and observing the run fail, then removing it and observing the run pass — the same mutation-check discipline applied to the test suites.
- Related constraint discovered while wiring this: the route probe is a TypeScript template literal, so a backtick in a COMMENT inside it terminates the string, and a single-escaped `\s` becomes a literal `s` in the emitted regex. Both mistakes produced compile errors that the build caught; noted so the next edit to that probe does not repeat them.

## Dependencies surface: detection implemented, installation refused (2026-10-10)

- **The split is read vs. write, not "some of it works".** `binary.get_tool_snapshots` is answered from the mechanism Grimoire actually has, so the page can show which tools are present; every route that would DOWNLOAD or UNINSTALL a tool is refused. The source implements those through its `mise` backend, and Grimoire's recorded policy is `local-only-no-silent-download` (`resources/agent-runtimes/runtime-manifest.json`) — runtimes and tools are prepared locally and checksum-recorded, never fetched by the app. An installer here would contradict a written policy and put an unreviewed network install behind a compatibility window.
- **The registry queries are refused, not answered with empty data.** `binary.search_registry` and `binary.get_latest_versions` exist only to feed installation. Returning an empty version map would render as "no versions available" — a different, unverified claim — and would still invite install actions that cannot work. Refusing keeps the page honest about what it can do.
- **`application` is `unknown`/`backend_unavailable`, never `absent`.** Grimoire runs no mise backend, so the managed-recipe question is genuinely unanswerable here. The source's own type models exactly this state and says so in a comment ("a backend that cannot answer yields `unknown` rather than a misleading `absent`"). Reporting `absent` would assert that no recipe is installed, which Grimoire cannot know.
- **Detection reuses the existing resolver's shape rather than inventing a second one.** `agent-runtime-manager.inspectAgentRuntime` already answers "is this executable present, and where from" for Grimoire's own runtimes; `binary-tools.service.ts` follows the same order (bundled root → system PATH) and the same executable-ranking rule, so the two cannot disagree about how a tool is found. It never reports `mise`, because naming a backend that is not running would point the page's "open containing folder" action at a nonexistent path.
- **An unbridged `ipcApi.on` event must NOT throw — this was a regression I introduced and then had to undo.** An earlier slice made `on` throw on an unknown event name to stop the old `on: () => () => undefined` stub from making a missing capability look present. That was too blunt: the source subscribes from inside `useEffect` (`useIpcOn`), so mounting the dependencies page — which subscribes `binary.availability_changed` — crashed the whole page into an error boundary ("似乎出现了一些问题…") for a feature that is simply absent. The honesty is preserved in the two ways that do not crash: the subscription is genuinely inert (no view can believe it is receiving live updates) and the gap is written to the diagnostic log. **The screenshot caught this, not the tests, and not the log scan — the error boundary meant the capture reported "0 problems".** A green log scan is not evidence that a page rendered.
- **A sandboxed Electron preload cannot `require` a sibling module.** Extracting the event map to `cherry-event-channels.ts` compiled fine and passed its own unit test, but the built preload emitted `require("./cherry-event-channels")`, which the sandboxed loader rejected — "Unable to load preload script" — taking out every `window.api.*` surface at once (the page then died on `Cannot read properties of undefined (reading 'ai')`). The map is inlined back with a comment recording the constraint. The test that motivated the extraction was removed rather than kept: it asserted a constant's contents, and the property actually worth guarding (a miss is representable without throwing) is enforced by the code path, not by the map.

## Data-settings surface: cache cleanup implemented, data reset refused (2026-10-10)

- **`app.data_reset.request` is REFUSED, and this is a permanent boundary rather than a pending gap.** The source implementation (`main/services/dataReset.ts` → `stageDataReset('full_reset')`) writes a marker that deletes the ENTIRE user-data directory on the next boot: every session, message, asset, tag, canvas project, provider config and stored credential. The source guards it with one in-app confirm dialog, which is reasonable in an app that owns its data outright — and is not a sufficient guard for a control reachable from a compatibility window running beside Grimoire's own workspace, where a user could reasonably read "数据设置" as scoped to the Cherry surface. It answers `NOT_IMPLEMENTED` rather than resolving `void`, because a silent no-op would let the UI report a completed reset that never happened. A real reset belongs behind Grimoire's own destructive-action flow.
- **A group is only implemented when Grimoire has a target for it; the rest say `skipped`, never `cleared`.** The source exposes five cleanup groups. Two map onto real Grimoire storage (`normal_cache` → Grimoire's own OS temp dirs; `logs` → rotated log files); the other three (`site_data`, `orphaned_data`, `legacy_v1`) have no target here — Grimoire has no webview storage, deliberately does not attempt an orphan audit (deleting a mis-classified row destroys user media, so it is left alone), and has no Cherry-v1 data to migrate. The source UI renders a distinct state per status, so reporting `cleared` for a group that did nothing would be a fabricated success.
- **`unavailable` is not `0 bytes`.** A group with nothing to measure reports `bytes: null, accuracy: 'unavailable'`. Reporting `0 / exact` would assert the sweep ran and found an empty cache — a different and unverified claim.
- **The `logs` group must never delete the file in use.** `getActiveLogPath()` was exported from the logger specifically so the cleanup excludes the active file using the LOGGER's own resolution rather than a second derivation that could drift and delete the log being appended to. Verified live: both rotated files removed, active file intact.
- **The temp-dir target is evidence-based, not assumed.** "`normal_cache` can clean Grimoire temp dirs" is only true if those dirs are unreclaimed — so this was checked: `grimoire-api-image-`, `grimoire-image-import-`, `grimoire-package-`, `grimoire-comfy-` and `grimoire-opencode-` are created by `mkdtemp` and referenced nowhere else, i.e. never removed. Had they been cleaned up elsewhere, the group would have had no honest target and would have answered `skipped` like the others.
- **A missing source-declared peer dependency had silently broken this page's build.** `dexie@^4.0.8` is declared in the source manifest and required by `legacyV1BrowserData.ts`, but was absent from the install — the same class of gap as `tw-animate-css` earlier. It was installed rather than stubbed, because the source's own dependency list is the contract. (The v1 browser-data reader it powers finds nothing in a Grimoire install, which is correct: there is no Cherry v1 data here.)
- **`window.api.file.selectFolder` answers the source's `string | null` contract, not an envelope.** The source call sites (`BasicDataSettings`, `WorkspaceSelector`) treat `null` as "user cancelled" and would surface a rejection as an error toast, so a failed or cancelled picker resolves `null`. It routes through the existing Cherry IPC handler rather than adding a second dialog implementation that would drift.

## `isToolAutoApproved` wiring and a silent MCP-save drop (2026-10-10)

- **The compat layer now composes the provider itself rather than using the source's narrow wrapper.** `MessageContentProvider` builds a `MessageListState` from a handful of fields and forwards `actions`, which is enough to render the list but structurally cannot carry a UI-selector capability — `isToolAutoApproved` reads through `MessageListUiSelectorsContext`, and the wrapper neither accepts it as a prop nor puts it in the state it constructs. `CompatMessageListProvider` therefore mounts `MessageListProvider` directly with the same state plus the capability, which is what the source's own page adapters do. This is ADAPTER-level work at the composition boundary, not a reimplementation: the list, its parts, its geometry and the activity store are all the source's.
- **Testing the capability exposed a persistence bug the transport tests could not.** `MCP_SERVER_SAVE` in `agent.ipc.ts` forwarded `description`/`headers`/`timeout` but silently dropped `disabled_auto_approve_tools`, `long_running`, `registry_url` and `tags`. This handler is the path the COMPAT window writes through; the settings pages use the DataApi transport, which was correct — which is exactly why the existing transport tests stayed green while the compat UI wrote nothing. The per-tool "always allow" action added in the previous slice was therefore a **silent no-op end to end**: it read the server, computed the new denylist, called save, and reported success while nothing persisted.
- **A handler's field forwarding needs its own test, because the failure mode is silent.** The mapping is now the pure exported `toMcpSaveInput`, tested for: forwarding every v24/v25 column, preserving "absent" vs "explicitly falsy" (an absent field must keep the stored value; a present `false`/`[]`/`''` is a real edit), restoring masked secrets instead of persisting the mask, and ignoring wrong-typed values rather than coercing them. It was mutation-checked by removing the forwarding — 2 of the 4 tests fail without it.
- **The capability reads LIVE server state, so the write must reload it.** The entry loads MCP servers on mount and reloads after an "always allow" write; without the reload the badge would not flip until a restart, which would look exactly like a broken action.
- **The compat tests assert through the source's own reader** (`useMessageListUiSelectors`) rather than by inspecting props. A prop-level assertion would have passed while the source consumers still saw `undefined` — the precise failure this slice exists to fix. Mutation-checked the same way: removing the capability from the provider value fails the test.

## Cherry tool-approval identity and per-tool auto-approve (2026-10-10)

- **`allowForSession` is NOT the source's "always allow", and using it as one would be a security widening.** Grimoire's session grant is keyed by PERMISSION KIND (`execute`/`network`/…): answering an approval with it auto-allows every future tool of that class. The source's `useToolApproval.autoApprove` does something far narrower — it approves the current call and removes ONE tool from its server's `disabledAutoApproveTools` denylist. The two are not interchangeable, so this slice never routes a "always allow" through the session grant; that grant stays reachable only from the legacy Grimoire panels, whose behaviour is unchanged.
- **Per-tool-call identity was the prerequisite, and it was missing.** `permissionToApprovalPart` used the permission's `requestId` as the part's `toolCallId`, which meant the source approval card could match neither the call it belonged to nor the tool behind it — and without a known tool, `autoApprove` has nothing to persist. `AgentToolContext.toolCallId` now carries `call.callId` from both tool-execution sites into the permission detail, and the projection prefers it. It is the same id already persisted on `tool-finished` and on the tool message, so the renderer's existing join key works unchanged. An absent OR empty call id falls back to the request id rather than emitting an empty join key that would match unrelated parts.
- **The deny-list transform is a pure function with its own tests**, in `compat/src/permission-actions.ts` alongside the entry that uses it. It encodes two source behaviours worth stating: "always allow" REMOVES from the denylist (the list is force-prompt, not auto-approve), and an already-absent tool returns `null` so the caller takes the source's early return instead of writing an unchanged value and reporting a success. The compat entry resolves the owning server from the `mcp:<serverId>:<toolName>` registry key — the same key shape `isMcpToolForcePrompt` parses — so name parsing is consistent across both directions.
- **A `toolCallId`-carrying detail also changes what the approval card IS.** The part is still synthetic (appended to the newest assistant message rather than mutating the real tool part in the transcript). That remains the known limitation of this bridge; carrying the real call id makes the correlation correct without pretending the part is the real one.
- **`isToolAutoApproved` is implemented and tested but NOT wired — deliberately left unwired rather than wired wrongly.** It belongs to `MessageListState` and is read through `MessageListUiSelectorsContext`; `MessageContentProvider` (the wrapper the compat entry mounts) constructs a narrow `state` slice and accepts no prop for it, so passing the value through the `actions` prop would compile and silently do nothing. Supplying it means composing `MessageListProvider` with a full `MessageListState`, as the source's own `agentMessageListAdapter` does — a larger change than this slice, recorded in the matrix as the next step. The unwired state over-prompts (safe) and never shows a false "auto-approved" badge.
- **Making `ipcApi.on` throw on unbridged events immediately found a second real gap.** `system.native_theme_updated` (the source `ThemeService` broadcast that the source `ThemeProvider` subscribes to) had no bridge, and `system.get_native_theme` had been failing on every resolve. Both are now served — the route from `nativeTheme.shouldUseDarkColors`, the push from Electron's own `nativeTheme.updated`. The appearance route renders with zero renderer errors. This is the payoff of failing loudly: a silent no-op stub would have hidden both indefinitely, exactly as it had hidden the progress-ring subscription.

## Cherry MCP tool-progress bridge (2026-10-10)

- **The source `subscribeToolProgress` capability is now real, not stubbed.** `preload.ipcApi.on` had been `on: () => () => undefined` — a no-op that returns a working-looking unsubscribe. That is the worst shape for a missing capability: the source's `useMessageLeafCapabilities` treats a returned unsubscribe as "the capability exists and is active", so the UI would render a progress ring that could never move. It now subscribes the one push event the mounted subtree reads, and **throws on any other event name**, so an unbridged event fails loudly instead of silently degrading.
- **Progress carries two independent meanings on the same notification, and they are not one feature.** A `notifications/progress` message (a) resets a Long Running call's deadline and (b) reports a 0–1 ratio for the UI. The first is a timeout policy, the second is presentation; they were implemented and are tested separately, and neither implies the other.
- **Attribution needs the model's tool-call id, which the transport does not have.** JSON-RPC notifications carry only the numeric `requestId`, so the pending request records the tool-call id passed down from the runtime, and events without one are **dropped rather than broadcast with an empty/guessed id** — an unattributable progress event would move an arbitrary ring. That required `AgentToolContext.toolCallId`, populated from `call.callId` at both tool-execution sites; it is the same id already persisted on `tool-finished` and on the tool message, so the renderer's existing join key works unchanged.
- **The ratio is clamped to 0–1, deliberately diverging from the source expression.** The source computes `progress / (total || 1)` and does not clamp, but it immediately renders the result as `progress * 100` in `MessageMcpTool`. A server reporting `progress: 3` with no `total` therefore yields 3 in the source — a 300% ring. The clamp keeps the value in the domain the renderer expects without changing any well-formed case (every ratio the source would show as ≤100% is unchanged).
- **The wire shape and channel mirror the source exactly** (`McpProgressEvent` = `{ callId, progress }`; broadcast on main-window scope like the source `McpRuntimeService`), and the service exposes `onMcpToolProgress` following the existing `onMcpServersChanged` listener pattern rather than reaching for a `BrowserWindow` — the service stays window-agnostic and the IPC layer owns the broadcast.

## Cherry MCP detail-form timeout policy (2026-10-10, schema v25)

- **`longRunning`/`registryUrl`/`tags` move from "rejected loudly" to "stored AND consumed".** These three were previously in the reject list with the honest note that Grimoire had no column *and* no runtime consumer. Adding columns alone would have been a display-only write, so each landed together with the consumer that makes it real.
- **`longRunning` mirrors the source `resolveMcpRequestOptions` contract** (`source/src/main/ai/mcp/mcpRequestOptions.ts`): a progress notification resets the per-request deadline up to an absolute 10-minute ceiling. Implementing it surfaced a larger gap — **the stdio transport had no request timeout at all** (a `pending` promise was only ever settled by a response or process exit, so a server that went silent hung the call forever). Pending requests now carry a deadline, a timer, and the budget needed to re-arm on progress; the read loop recognizes `notifications/progress` (which carries a `requestId`, not the notification's own id) and extends only Long Running calls. Verified with a control: the same deliberately-slow server succeeds at ~2.4s with the flag on and times out at 1s with it off — the flag is what changes the outcome, not a loosened default.
- **`registryUrl` maps onto the runner's own env var, following the source `RUNNERS` table**: `NPM_CONFIG_REGISTRY` for `npx`/`bunx`, `UV_DEFAULT_INDEX`+`PIP_INDEX_URL` for `uv`/`uvx`, nothing for any other command. The lookup keys on the command's leading token, so a plain `node` server can never be silently redirected to a third-party registry. The derived map is layered UNDER the user's explicit `env` map — a hand-set variable in the detail form always wins. The mapping is exported as a pure function because the spawn env also inherits the parent process environment (this machine already had a registry variable set), so a child-reported value cannot distinguish "injected here" from "inherited".
- **`tags` needed no renderer change.** The source list already builds its search target as `${name} ${description} ${tags.join(' ')} ${provider}` (`McpServersList.tsx`); once the projection emitted the array, tag search worked. Recorded because it is the one field where the honest complete fix was projection-only.
- **The reject surface is now identity-only.** After v25, every config field the source `McpServer` schema declares is either storable or in the echoed-only set; `MCP_FIELD_UNSUPPORTED` fires for `id`/`createdAt`/`updatedAt` — values the renderer must not be able to set. The round-trip test was updated to assert that boundary rather than the old one, so it still proves something.
- **A visible "更新服务器失败 / fetch failed" during live verification is correct behaviour, not a regression.** The source detail form restarts an *active* server after a successful update; the seeded fixture endpoint is `https://mcp.example.invalid/sse`, so the restart honestly fails and the form reports it. The update itself persisted (the read-back showed `longRunning: true`). Recording this explicitly because the dialog looks like a failed save and would otherwise be misread as one — the alternative (suppressing the error) would be a fake success state.

## Cherry system font enumeration (2026-10-10)

- **DIRECT_REUSE of the source's own package, not a reimplementation.** The source main process answers `system.get_fonts` from the `font-list` package and normalizes the result (`replace(/^"(.*)"$/,'$1')`, then `filter(font => font.length > 0)`, degrading to `[]` on failure). Grimoire now depends on the **same package at the same declared version** — `font-list` `2.0.0`, per the source manifest (`compat/source-package.json`) — so family names, ordering and the Windows PowerShell/`PresentationCore` enumeration path stay byte-identical to upstream. Reimplementing enumeration (e.g. a registry read or a direct `System.Drawing` probe) was rejected: it would have produced a different name set and ordering than the source page expects.
- **Memoization is a deliberate deviation in timing, not in result.** The Windows path shells out to PowerShell (~1s), and the source appearance page requests fonts on every mount (`useEffect` → `loadSystemFonts`). The service caches the first non-empty result for the process lifetime — the installed-font set does not change while the app runs — shares one in-flight promise between concurrent callers, and **never caches a failure**, so a transient failure still leaves the next call able to retry. Failure is logged and answered as `[]` exactly like upstream, because the source page renders a degraded picker for an empty list rather than erroring.
- **Root-manifest install, with a pre-existing conflict noted.** `font-list` is a main-process runtime dependency, so it belongs in the root `package.json`, not the compat sub-project. `npm install` failed with `ERESOLVE` for an **unrelated, pre-existing** conflict (`@ant-design/pro-components@3.0.0-beta.3` declares `peer antd@"^5.11.2"` while the root already has `antd@6.6.3`); the install used `--legacy-peer-deps` and was verified to add exactly one package with no other manifest churn. This conflict predates this work and is not caused by `font-list`.
- **Verified in the live app, not only in unit tests.** Screenshots and unit tests cannot show that a *dependency resolves at runtime under Electron*, so the route was exercised through the real IPC path: `system.get_fonts` returns `{ok:true, count:218}` and the 全局字体 combobox opens with 219 options (`默认` + 218 real families), each option previewed in its own typeface (`artifacts/visual/populated/appearance-font-picker.png`). The six unit tests mock `font-list` deliberately — the real module spawns PowerShell, which is neither deterministic nor appropriate in a unit test — and cover the service's own contract: normalization, memoization, single-flight, degrade-and-log, no-cache-on-failure and malformed results.

## Cherry provider deep-link import (2026-10-10)

- **`?addProviderData=<json>` import is verified end-to-end**, not only at the transport layer. The capture route `settings/provider?addProviderData={…}` renders the source `UrlSchemaInfoPopup` confirm dialog with the imported name / provider ID / base URL / API key, over the dimmed settings page. Evidence: `artifacts/visual/populated/route-diagnostic-dialog.png` and `route-diagnostic.json`.
- **The import is confirm-gated by the source**, which the first capture run misread as a no-op. `useProviderDeepLinkImport` never writes silently: it `await`s `UrlSchemaInfoPopup.show(...)` and only then calls `createProvider` / `updateProviderById` + `POST /providers/:providerId/api-keys`. A capture that ends before the user confirms is *correct* behaviour, not a failed import — hence the paint probe above.
- **`endpointConfigs` is protocol-keyed, not hard-coded to `openai`.** `sourceProviderFromRow` and `projectGrimoireProvider` previously always wrote the `openai` key regardless of the row's protocol, which silently stranded the base URL of a `responses`-protocol provider. Both now key by the actual protocol (`openai-response` for `responses`), and `POST /providers/:id/api-keys` writes through `encryptKey` and returns the parent provider with 201.
- **Masked secrets round-trip.** Provider/MCP reads travel with keys visible and values masked (`MASKED_SECRET_VALUE`); writes restore the masked entries via `restoreMaskedMap`, so a full-object save from a source detail page cannot erase a stored secret by echoing the mask back.

## Cherry data-settings panels and path helpers (2026-10-10)

- **Panels render is not panels work — the audit walked all thirteen, not one.** A single deep-link walk in one live window (`#/settings/data?panel=<key>`) showed every source panel mounting with real labels. That is the *weaker* half of the finding; the stronger half is the runtime API probe in the same walk, which is what caught the dead surfaces below. Recording the method because "it renders" had already been mistaken for "it works" in this surface: the matrix row claimed the cloud-sync panels "stay unmounted" when they were mounted and rendering the whole time.
- **Three export targets need NO adapter — recorded so nobody builds one.** Joplin, Siyuan and Yuque are written by the source as renderer-side `fetch` to a user-supplied URL (`ExportService.ts`), their configs persist through the compat preference shim into `cherry_pref.*`, and the renderer fetch reaches localhost (verified with a temporary local server; `configureWindowSecurity` sets no CSP `connect-src`). The correct migration action here was **verification, not implementation** — adding main-process routes would have been net-negative work.
- **`cherry-path.service.ts` implements `resolvePath`/`isPathInside`/`hasWritePermission` with the source's exact semantics.** Not a convenience: `LocalBackupSettings` resolves a configured directory from a `useEffect`, so these being `undefined` was a crash for precisely the users who configured a backup directory — the panel looked fine on a fresh profile. A dead button fails loudly; this failed for the wrong population.
- **`isPathInside` is equality-TRUE, and that is deliberate.** The closure contains TWO disagreeing implementations: `main/utils/file/path.ts` documents "equality returns false (a directory is not inside itself)", while `main/utils/legacyFile.ts` returns `true`. `main/ipc.ts` imports the **legacyFile** one, so equality-true is the semantics the renderer actually observes. The distinction is load-bearing in one direction: `checkLocalBackupDirValid` uses this to reject a backup directory inside app data or the install path, so an equality-false helper would let a user aim a backup at the directory the check exists to protect. The test asserts equality-true explicitly and a mutation check confirms inverting it fails the suite — because picking the wrong one of two same-named functions would otherwise look identical at the call site.
- **`untildify` is intentionally NOT exported.** Splicing the home directory into a string verbatim leaves a mixed-separator path on Windows (`~/a` becomes `C:\Users\x/a`), which the source does too; only `path.resolve` normalizes it. Exposing the half-normalized form invites a caller to compare it against a resolved path and get a wrong answer, so only `resolveUserPath` is public. Found because the first test asserted a joined path and failed against the raw substitution.
- **Preload failure fallbacks are fail-CLOSED and loud.** A failed round trip returns `null` from `resolvePath` and `false` from both predicates, and writes a `console.warn` (which reaches the main-process diagnostic log). `false` for `isPathInside` is the safe direction for a containment check that guards app-data writes; returning `true` would make a failed probe authorize the risky case. Returning the input path unchanged was rejected as a fake success.
- **The backup TRANSPORT half stays BLOCKED, with the reason named.** The source's `LegacyBackupManager` is in the closure but archives Cherry's own userData layout (`IndexedDB/`, `Local Storage/`, `cherrystudio.sqlite`) plus a drizzle restore journal, so pointing it at Grimoire's SQLite would restore a foreign schema. Its `webdav` / `@aws-sdk/client-s3` / `@aws-sdk/lib-storage` deps are absent from both manifests. Unblocking condition: a Grimoire adapters layer reusing the source's remote **transports** (`WebDav.ts`, `S3Storage.ts` are pure third-party-API clients) against Grimoire's own DB file, with the zip/journal restore protocol replaced by `exportDatabase`/`replaceDatabase`.
- **A table row was corrupted while editing it, and the validator caught it.** Inserting paragraph breaks inside a markdown table cell terminated the table and orphaned eleven following rows. Two pre-existing bare pipes in prose (`'forward' | 'descendants'`, and `\||` in the progress-ratio text) were found by the same validator. All 87 rows now check clean. Recorded because editing a wide table cell in a 3,000-character row is exactly where this recurs.

## Cherry route mounting, the About page, and two audit-gate defects (2026-10-10)

- **The remaining distance to the migrated product is mostly a route-registry backlog, not a window-lifecycle problem.** Challenging the BLOCKED records for the remaining source windows produced a larger finding than the windows themselves: the source ships 56 route files (41 settings, 15 app) backed by 33 settings page components, while the compat registry implemented 8 ids. WINDOW_MATRIX covered `WindowType`s and was silent about this, so the gap was invisible. It is now recorded there with per-page reachability.
- **A measurement of mine was wrong and the correction is recorded with it.** A scan matching page imports by filename reported seven settings pages as MISSING; most exist as **directories** (`ProviderSettings/`, `AboutSettings/AboutSettings.tsx`). "The registry gap is real; that particular measurement was not" is written into the matrix rather than quietly fixed, because the same scan shape will be reached for again.
- **Two pages mounted as proof the path works**: `/settings/notifications` (91 lines, sole dependency `useMultiplePreferences` — cheapest possible) and `/settings/about`. Both were then verified live rather than by import scan. The About page's blocker was found only by running it: `useTabsContext must be used within a TabsProvider`, traced to exactly one file (`useOpenReleaseNotes` → `useTabs()`), fixed with one narrow shim.
- **`TabsProvider` is deliberately NOT mounted, and this is a considered rejection rather than a shortcut.** It would satisfy one navigation call, but it owns tab LRU/dormancy, drag reorder, detach/attach, `AgentBrowserRuntimeHost` and conversation-navigation ownership — app-shell state the compat window replaces with a hash route registry. Mounting it would introduce more unmigrated state than the single hook it fixes. The shim navigates to the route the tab would have opened, so the observable behaviour matches.
- **Refusals stay refusals, including the ones that look like they could be faked.** `app.updater.check_for_update` returns `NOT_IMPLEMENTED` rather than `ok`. The source route returns `void` and the page is driven entirely by `app.updater.*` push events, so a success envelope with nothing behind it would leave the update row spinning forever — the fake-success shape. Verified the refusal surfaces: clicking 检查更新 raises the source's own `更新出错` toast. `system.toggle_dev_tools`, by contrast, is genuinely implementable and is implemented against the calling window's webContents, matching upstream's sender-scoped handler.
- **Two defects in my own audit gates were reporting product failures that did not exist.** Worth recording at length because the failure mode is asymmetric: a gate that reports a false PASS is caught eventually, but a gate that reports a false FAIL sends the next session hunting a bug in working code.
  - The route audit awaited `setTimeout` INSIDE the page, so an error-boundary crash left that promise permanently unsettled and the audit hung instead of failing the route. Waits moved to the Node side and every CDP call now has a hard timeout.
  - The persistent `/settings/about` FAIL was the audit's own environment: it launched with `GRIMOIRE_VISUAL_CAPTURE=1`, which makes the app run its viewport/theme matrix and then `app.quit()` on a timer, so the audit raced the app's self-termination and whichever route was in flight when it quit got no response. **The decisive evidence was that the failure followed the last POSITION, not the route** — moving About to position 2 made notifications fail last instead. No page was ever broken. Both audits now use `GRIMOIRE_OPEN_CHERRY=1` (opens the window, leaves it open).
  - While diagnosing, a genuine latent bug in the shared CDP helper: per-call listeners with `Math.random()` ids. Over a run's ~40 round trips the ids collide, and a call that timed out never removed its listener. Replaced with one dispatcher over a pending-request map plus a monotonic counter. It was not the cause here, but it was a real defect in the gate.
- Recorded because the general lesson recurred four times in this session: **verify by running, and when a check fails, first ask whether the check is right.** The invisible dialog, the sandboxed-preload break, the silent MCP save drop, and now a gate that failed the last route every time were all invisible to reading code and to any test that did not actually exercise the path.

## Cherry prompts surface and the leaked-Electron root cause (2026-10-10)

> **Superseded on 2026-11-05:** the storage claims below (visibility always global, no
> update operation, no binding table) describe the 2026-10-10 snapshot. v28/v29 added
> `cherry_prompt_bindings` and `prompt_assets.visibility`, and the 2026-11-05 update path is
> recorded in "M3 retained prompt visibility update" below.

- **The prompt page is the one page whose backend this app actually owns.** Grimoire's core domain is prompt management, so `/settings/prompts` maps onto `prompt_assets` (1,742 real rows) rather than onto an empty store. The source reads `/prompts` + `/prompt-bindings` over the DataApi; the adapter serves the former from `queryPromptAssets` and the latter as an empty list. This is the honest case where "the panel renders" and "the feature works" coincide for the read path, and it was verified against the real library rather than a fixture.
- **Three schema fields with no Grimoire column, each mapped for a stated reason** (the mappings live in `sourcePromptFromAsset` with the reasoning in the doc comment):
  - `visibility` → always `'global'`. Grimoire shares every asset with every session, so `'restricted'` would make the UI hide prompts that are in fact available. `'global'` is the only true answer.
  - `orderKey` → synthesised zero-padded row position, NOT a meaningful order. A real ordering (by name, by category) would silently reorder the user's list relative to what Grimoire's own panels show; the adapter instead preserves the service's `created_at DESC, id ASC` order and makes the key agree with it.
  - `id` → passed through **unchanged**, even though Grimoire ids (`builtin_<hex>`) are not the source's `z.uuid()`. The renderer never runtime-validates the response (`PromptSchemas` is a TypeScript type map, not zod), so this is accepted — and synthesising a UUID would have been the dangerous choice: the id is the only handle back to the real asset, so every mutation and binding would break while looking correct.
- **Writes refused, not stubbed.** Grimoire's prompt-asset service exports create/delete/query/category operations but **no update**. A create/patch/delete adapter would have to invent storage and would immediately desync from the library the user's own panels read. Bindings are the opposite case and get an empty list rather than a refusal: the empty list is TRUE (no binding table exists), and the page renders its unbound state from it, whereas a refusal would show an error banner for a feature that is simply unused.
- **The real bug behind a phantom product failure.** `/settings/prompts` reported `路由未实现` in full-suite runs while passing in an isolated probe. Cause: `child.kill()` signals only the `npx` launcher, never the Electron process it spawned, so **every audit run leaked a whole Electron tree** — 70 orphaned processes had accumulated across this session's probes, all still holding their DevTools ports. The next run's CDP lookup attached to the OLD instance, which was serving the OLD bundle, so a newly added route looked unimplemented. Fixed with a teardown scoped to this run's `--user-data-dir` (never a parallel session's Electron). Verified by running the audit twice back-to-back: both 12/12, zero processes remaining after each.
  - **This is the second phantom failure from leaked state, and the two had different causes.** The first ("About fails, always last") was the app self-quitting under `GRIMOIRE_VISUAL_CAPTURE`; I recorded that as the whole story and it was not — the leaked-instance problem was independent and would have kept producing phantom failures on every newly mounted route. Both fixes are in.
  - The general lesson, now the fourth instance this session: **when a check fails, ask whether the check is right before hunting the product.** The signature that gave it away both times was that the failure followed position/staleness rather than the input.
- **A test of mine that could not fail.** The derived `COMPAT_SUPPORTED_PATHS` list (which replaced a hand-written message that had gone stale three times) was initially covered by a test asserting it equalled the object it was derived from — a tautology. A mutation check proved it passed even when the derivation was altered. Deleted, and replaced with three assertions derivation does not guarantee: no duplicates, every listed path actually resolves through the parser, and the list length matches the map. The length check was then mutation-verified by filtering a real path out of the derivation, which does fail it.
- **A correction to an earlier measurement in this file.** The scan that reported seven settings pages MISSING was matching imports by filename; most exist as directories. Recorded in WINDOW_MATRIX with the correction rather than silently fixed, because the same scan shape will be reached for again.

## Prompt writes, a two-id-space bug, and corrected blocked verdicts (2026-10-10)

- **A refusal I recorded too broadly.** Having refused all prompt writes, I re-read the service and found `createPromptAsset` / `deletePromptAsset` do exist and write real `prompt_assets` rows. `POST /prompts` and `DELETE /prompts/:id` are now implemented; only `PATCH` stays refused, because that is the operation the service genuinely does not export. The lesson is narrower than "verify by running": **a refusal is a claim about the source too**, and it needs the same evidence as an implementation.
- **`restricted` prompts are refused rather than downgraded.** The source schema permits an initial `bindingTarget` only when `visibility === 'restricted'`. Grimoire has no binding table, so creating one would store a globally-visible prompt while the client believed it was restricted — a row that misrepresents the request. Refusing keeps the client honest; silently creating it would have produced a working-looking button and a wrong security state.
- **The two-id-space bug.** `UNIFIED_QUERY` aliases `prompt_assets.id` as `'asset:' || id`, but `createPromptAsset` stores an id that **already begins with `asset:`**. A created prompt therefore surfaced as `asset:asset:<uuid>` — matching neither its own list projection nor the DELETE lookup, so it appeared not to exist and could not be deleted. Found by round-tripping the route (`foundInList: false`, delete 404), not by reading: both paths look self-consistent in isolation, and the collision only exists where they meet.
  - The first fix was also wrong in an instructive way: stripping the prefix greedily / to the first unprefixed form destroyed the real stored id for user-created rows. The correct rule is **strip exactly one occurrence**, and the DELETE path must try the candidate forms against the database rather than guess.
  - `deletePromptAsset` does not persist on its own — its IPC handler calls `saveDatabase()`. Omitting that would have made deletes look successful in-session and reappear after restart, so the round trip was checked **against the file on disk after the process exited**, not just against the in-process response.
- **The bug is now locked in by tests, and the tests are mutation-verified.** Id handling was extracted to pure functions (`assetIdFromUnionAlias`, `assetIdCandidates`, `sourcePromptFromAsset` with an explicit stored id) exported through `__test`; 4 new tests. Replacing the single-prefix strip with a greedy one fails them, so they can catch the regression they exist for — which is the check I failed to do earlier this session on a test that turned out to be a tautology.
- **Two more of my own BLOCKED verdicts were wrong**, both right-outcome-wrong-reason:
  - `/archives` **is** in the vendored closure (`handlers/archives.ts`, `services/archive.ts`); my grep searched the wrong directories. The genuine `ArchiveSettings` blocker is semantic: the source route is a soft-delete recycle bin (`deleted_at IS NOT NULL`) while every Grimoire delete is a physical `DELETE FROM`. Mounting it would render a permanently empty bin whose 永久删除 reports success for rows already gone. `cherry_resource_state.archived` is a different column and is backed.
  - `GeneralSettings` needs **no missing services** — its only bridge call is the already-implemented `application.relaunch`. It stays blocked because no main-process service consumes its preference keys (0 references in `src/main/`), so mounting would render ~20 inert toggles. The outcome was right; the reason I wrote was not, and a wrong reason is what sends the next session building infrastructure that already exists.
- **A recurring shape worth naming**: every one of these errors — the broad refusal, the greedy strip, the two blocked verdicts — came from reasoning about the code instead of exercising it, and each was caught by running something (a round trip, a grep over the right directory, a count of consumers). The gates that caught them were written earlier in this session for exactly this reason.
## M3 retained prompt visibility update (2026-11-05)

- **The update path now ports the source guard instead of hiding it.** `PromptService.update` (336-393) requires `expectedBindings` only when a `restricted` prompt is becoming `global` and currently has bindings; a missing or mismatched snapshot is a concurrent modification. This adapter applies the same rule to `cherry_prompt_bindings`, using the same `type:id` keys, and clears bindings only after the snapshot matches. The visibility write, binding clear, and re-read run in one `BEGIN IMMEDIATE` transaction; a forced binding-delete failure rolls the visibility change back (covered by a trigger test).
- **Restricted updates preserve the selected targets and never invent one.** A global→restricted update writes only the visibility flag; a restricted→restricted update leaves every edge alone. This matches the source, which does not auto-bind on update. Create is the different case: this adapter still requires an explicit `bindingTarget` for a restricted prompt so it cannot be created invisible.
- **The returned DTO reads stored visibility.** `updatePromptAsset` previously returned a projection without `visibility`, so `sourcePromptFromAsset` fell back to `global` even after the column stored `restricted`. Create and update now both return the stored value; the list projection already did.
- **Status mapping follows the source contract.** Invalid visibility and `expectedBindings` outside a global update are 400; a bindings snapshot conflict is 409 `CONCURRENT_MODIFICATION`; built-in/imported rows remain 403. The service keeps a descriptive internal `PROMPT_BINDINGS_CONFLICT` code and the DataApi maps it to the source code.
- **Remaining gap is verification breadth, not a missing operation.** The mounted prompt page's full edit/visibility/bind round trip has not been live-verified in this round, so the matrix row stays PARTIALLY_MIGRATED. Focused evidence: `prompt-asset-browser.test.ts` 25/25 and `cherry-data-api.ipc.test.ts` 191/191, main typecheck exit 0 (2026-11-05).

## M2 stream smoke readiness stable (2026-11-06)

- **修复**：stream smoke 选用与 source-shell audit 相同的 Cherry page target predicate，增加 non-about:blank 与 preload API readiness wait。
- **证据**：fresh build + `npm run smoke:stream` exit 0；独立报告 `artifacts/stream-readiness-round25.json` `ok=true`，chat persistence、Agent、allow/deny approval、vision 全部通过；script syntax、matrix、diff check 通过。


- **根因**：CDP `/json/list` 的 page target 在 Electron 启动期间会短暂出现 about:blank，脚本过早执行 pageScript，误判 provider bridge 缺失。
- **修复**：目标选择限定真实 Cherry page，并在执行 pageScript 前等待非-about:blank URL 与 `window.api.ipcApi`、`window.api.ai.sessions.create` 就绪。
- **证据**：fresh build-bound `npm run smoke:stream` exit 0；独立复跑报告 `artifacts/stream-readiness-round25.json` `ok=true`，chat/持久化、Agent、allow/deny approval、vision 全部通过。


- **修复**：`chat-stream-smoke.mjs` provider setup now uses `window.api.providers` when available and falls back to current `window.api.dataApi` `/providers` routes when the legacy facade is absent.
- **证据**：`npm run smoke:stream` exit 0；chat text/persistence、Agent stream、allow approval (`工具已完成`)、deny typed permission error、vision (`看到图片`) all pass。
- **边界**：keep provider bridge compatibility branch because source-shell and legacy compat surfaces may expose different preload projections.


- **事实**：`npm run smoke:stream` reaches a real Cherry page but its page script assumes `window.api.providers.save/list/setActive`; current source-shell runtime exposes the provider capability through the compat host/catalog bridge differently, so the script throws before streaming (`window.api.providers` undefined).
- **决定**：保留该 smoke 的真实失败，不修改结果生成器或基线来制造通过；source-shell audit remains the current passing functional evidence.
- **下一步**：rewrite the smoke setup against the current `CherryHostBridge`/`ipcApi` contract, then rerun chat/Agent/approval/vision assertions.


- **流程**：先运行 `npm run build` 同步当前 source 与 dist，再运行完整 `npm run gates`，避免 BUILD-STABLE 比较旧 dist 与当前构建。
- **证据**：G1–G14、G3 root tests、G4 compat、G6 build 与 BUILD-STABLE 全部 PASS；snapshot `artifacts/gates-2026-11-05T23-06-31-008Z.json`。


- **事实**：完整 G3 首轮暴露 legacy `categories` 表没有 `group_id`，而 INDEX_SQL 在升级阶段创建 `idx_cat_group`，导致 lifecycle/v21/v22 migration suites 失败。
- **修复**：在既有 pre-index additive migration 中补 `ALTER TABLE categories ADD COLUMN group_id TEXT DEFAULT 'default'`，与 subcategories/tags 的迁移保持同一顺序与幂等策略。
- **证据**：受影响 3 suites 共 `8 passed`；随后完整 `npm run gates` G1–G14 全部 PASS、BUILD-STABLE，snapshot `artifacts/gates-2026-11-05T22-42-22-701Z.json`。


- **决定**：对本轮门禁指出的新增 renderer promise catch 使用 `console.debug` 保留可观测失败路径；不通过抬高 baseline 掩盖增长。
- **证据**：silent catches 从 154 基线降至 153；`npm run gates:fast` 的 G1/G2/G5/G7/G8/G9/G10/G11/G12/G13/G14 全部 PASS，snapshot `artifacts/gates-2026-11-05T22-18-37-489Z.json`。


- **决定**：TasksPanel 直接展示持久化 `error_code` 与 `error_message`；Comfy timeout/transport/429/5xx 显示自动重试提示，其他错误只显示稳定 code + message。
- **依据**：错误码已在 main boundary 分类并持久化；renderer 不按具体 runtime 分支，仅按 task kind 与 typed code 选择用户反馈。
- **证据**：新增 TasksPanel formatter test 1/1；renderer typecheck、full build、matrix check、diff check exit 0。


- **决定**：在 `task_jobs` 增加 nullable `next_attempt_at`，通过现有 additive legacy migration 补列；TaskRecord、repository、state machine 与 runner 共同使用该字段。
- **行为**：retryTask 根据 next retry count 写入 deadline；runner 只领取 deadline 已到的 queued task，因此应用重启后不会丢失退避窗口。
- **依据**：仅依赖既有 Grimoire SQLite 任务真相，不引入第二个调度存储；旧数据库通过 `ALTER TABLE ... ADD COLUMN` 兼容。
- **证据**：task-state 4 tests、main typecheck、full build、matrix check、diff check exit 0。
- **边界**：UI retry affordance 与完整错误文案映射仍待后续切片。


- **决定**：可重试的 typed ComfyUI transport/5xx/429 failure 在 `max_retries` 内重新进入 queued；重试间隔按 next retry count 指数增长 `1s, 2s, 4s...`，上限 `30s`。
- **实现边界**：任务记录中的 retry_count/max_retries 持久化；当前 retry-not-before 时间窗只驻留 main-process 内存，应用重启后 queued task 会按队列继续执行，完整 schedule persistence 留待后续 schema 切片。
- **证据**：task-state + Comfy client 共 16 tests；main typecheck、full build、matrix check、diff check exit 0。


- **决定**：在 `ComfyUIClient` transport boundary 引入 `ComfyUIError`，保留稳定 `code`、`retryable` 与可选 HTTP `status`；HTTP 5xx/429 可重试，4xx 默认不可重试，timeout/transport 单独编码。
- **任务持久化**：`task-runner` 对 `comfyui` 任务保留 typed Comfy code，WD14 与其他执行器继续使用 `TASK_EXECUTION_ERROR`，避免跨域错误码混用。
- **证据**：Comfy client 12 tests、task state 3 tests、main typecheck、full build、matrix check 均 exit 0。
- **边界**：队列 retry/backoff、错误码到 UI 文案的完整映射、人工重试策略仍待后续切片。


- **决定**：复用已有 `BrowserPanel` 与 main-owned `WebContentsView` host，通过 Comfy 工作台 tabs 接入网页视图；不在 renderer 用 iframe 或静态 HTML 仿制 ComfyUI。
- **降级**：网页 tab 只在 status online 时可用；刷新发现断连时自动切回控制台并禁用网页 tab。控制台地址、队列、工作流和快捷生成继续可用。
- **依据**：浏览器宿主已有 URL 清洗、bounds clamp、独立 partition、导航历史和 close 生命周期；复用它能保留窗口隔离和主进程导航边界，避免新增第二套嵌入宿主。
- **证据**：`ComfyUIPanel.test.tsx` 6/6，通过 `browser.host.open` URL 断言、offline disabled、active-web disconnect fallback；renderer typecheck、panel-layout、full build、matrix check、`git diff --check` 均 exit 0。
- **剩余边界**：真实 Electron 中的 WebContentsView 导航、resize/drag bounds、Comfy 服务错误页反馈和多实例隔离仍需手工验收，因此矩阵状态保持 `PARTIALLY_MIGRATED`。


## Pending decisions

- Exact source-file mapping for every matrix row.
- Actual license result for each source snapshot.
- Any future REIMPLEMENTED row and its required user approval.

## `app.developer_mode.enabled` 不实现（2026-10-10）

- **决定**：`/settings/general` 的这个开关**保持无消费者**，该页面继续显示 BLOCKED 诊断页而不是挂载源页面。
- **依据**（逐个消费者核查，不是印象）：源 main 进程共 15 处引用，其中 14 处位于 `ai/observability/**`（OpenTelemetry 追踪：`NodeTraceService`、`TraceStorageService`、`httpTraceFetch`、`ClaudeCodeTraceBridgeService` 等），第 15 处是 MCP 的一个**设置读取工具**（`assistant.ts:956` 把值原样 JSON 返回）。最后这一处不需要任何实现——偏好 shim 已经把值持久化了，工具只是把它读出来。
- **为什么不建**：实现它等于新建一整套追踪管线（OTel SDK、trace 存储、启动期激活、Claude Code trace 桥）。这是**新基础设施**，不是"接线"，且与 UI 迁移无关——按项目规则，这类工作不能因为"页面需要一个开关"而顺手展开。
- **对用户的实际影响**：无功能损失。该开关在源里影响的是追踪数据采集，不影响任何可见行为或对话功能。
- **与 B1/B2 的区别**：B1（回收站）与 B2（备份传输）是**功能缺口**——用户会期待回收站能恢复、备份能上传。这一条不是；它是一个诊断开关，其消费者是面向开发者的可观测性设施。
- **若将来实现**：需要先决定 Grimoire 是否要追踪能力；届时该键的语义是启动期读取（源自己也注明"运行时切换需要重启"）。

## CSS 层叠归属：组件基类进 @layer components，重置进 @layer base（2026-10-10）

- **背景**：真机取证发现 tag-batch 面板零内边距，顺链查出 `index.css` 有两段**未分层**规则压过了 Tailwind v4 的全部工具类：
  1. 顶部 `* { margin:0; padding:0; box-sizing:border-box }` —— 未分层，胜过 `@layer utilities` 里的每一个 `p-*`/`m-*`/`space-*`。后果：自 v4 迁移起，全应用**所有**间距工具类是死的。v3 时代这段写法是对的（工具类当时未分层，0,1,0 特异性压过 `*` 的 0,0,0），迁移到 v4 时它变成了静默杀手，且单测/构建/类型全绿。
  2. `.ui-field { width:100%; … }` —— 同样未分层，压过调用方的 `w-32`/`w-52` 等宽度工具类。
- **决定**：`*` 重置移入 `@layer base`（v4 preflight 本就在 base 里声明同样的重置，这段是语义重复的遗留）；`.ui-field` 三条规则包入 `@layer components`。层序恢复为 theme < base < components < utilities，即**工具类总能覆盖组件基类**。
- **为什么不是在调用点回避**：改用内联 style 或 `!important` 会把缺陷固化进每个调用点，而根因只有两处；且 SettingsWindow 等既有文件里 `ui-field w-52` 的写法证明"工具类可覆盖"正是原作者意图，修层级是恢复意图，不是改变设计。
- **给后续工作的规则**：`index.css` 中新增任何组件类，要么放进 `@layer components`，要么确认它不需要被工具类覆盖。未分层规则在 v4 下是"全局最高优先"，这一条值得写进模板而非靠记忆。
- **发现的同类第三例（主进程，非 CSS）**：`media:thumbs:list` handler 只读派生表从不请求生成，`requestDerivatives`/`ensureThumbnails` 在生产代码中零调用方 —— 图库缩略图因此从未生成过。已在 handler 读取前接入 `ensureThumbnails`（串行队列去重 + 已有派生行跳过，幂等）。判据：**一个能力"存在"不等于"接线"**；服务有测试、导出、文档，仍可能没有任何生产路径触发它。

## ImagesPanel 统一方式：保留旧交互、只换数据通路（2026-10-10）

- **背景**：Wave D 计划要求把 ImagesPanel 接入虚拟网格与 gallery.store。执行时因并行会话正在编辑该文件而改为「旧面板原样保留、新增 gallery-search 面板」，统一延后。收口时重新决策。
- **决定**：**不把 ImagesPanel 换成 VirtualGrid**，只做计划中真正解决性能问题的部分——N+1 消除。理由：
  1. VirtualGrid 的键是 `imageRefId:number`，而 ImagesPanel 的既有交互（多选删除、批量标注、托管/外链徽标、FloatingPreview 缩放拖拽、按文件可用性排序）全部围绕 `ImageRef` 对象构建，换网格等于重写面板——那会破坏「原有功能一个不能少」的硬约束，收益只是渲染窗口化（当前库 9~500 张量级不需要）。
  2. gallery-search 面板已经承担虚拟网格 + 过滤 + 检查器的角色，两个面板共用同一套批量 IPC 即可，无需合并。
- **同时删掉了一个真实的性能缺陷**：原实现每张图一次 `images.readData`（整文件 base64 进渲染进程）+ 每张一次 `assetLinks.list`。网格改为一次 `media.thumbs`(thumbnail, 320px JPEG) + 一次 `assetLinks.listBatch`；预览页保留按需 full-size 读取（缩放需要细节）。
- **边界**：`ImagesPanel` 仍是图片参考工作区的默认面板，`gallery-search` 是需要时打开的增强视图。两者的筛选/评分/收藏数据同源（media_assets），不会出现两套真相。

## 读回路径必须与写入路径同时审计（2026-10-10）

- **事实**：v22 迁移给 `image_generation_metadata` 加了 `origin` 列；`persistParsedMetadata` 写入正确，但 `getImageGenerationMetadata` 的 SELECT 漏列该字段、后续列下标也未同步——所有读回的 origin 恒为空。**29 个解析单测全绿也发现不了**，因为它们断言的是解析函数的返回值，不经过数据库读回。
- **规则**：新增/迁移一列时，审计范围是「所有写该表的地方 + 所有读该表的地方」，不只是写路径。读侧列下标错误是静默的（`row[1]` 永远存在，只是含义错了）。
- **这次的捕获方式是端到端验收**：真实导入 → 真实读回 → 与期望值比较。这正是「三门槛」里功能门存在的理由——单测全绿 ≠ 数据链路正确。

## Wave F 双路相似图：CLIP 与感知哈希的分工（2026-10-10）

- **决定**（用户明确选择双路方案）：相似图搜索同时有两条通道。`image_perceptual_hashes`（dhash + 颜色直方图，纯 TS 零依赖）**永远可用**；`image_embeddings`（CLIP ONNX via Python sidecar）**在安装了模型时**自动启用。`similarity.service` 的 `method: 'auto'` 优先 CLIP，无可用嵌入时如实回落 hash 并在返回值里标注实际使用的通道——UI 上写「感知哈希」还是「CLIP 语义」取决于**数据**而不是承诺。
- **为什么不是 CLIP-only**：本机 0 个 .onnx 模型，CLIP-only 会让整个相似图功能不可验证也不可用（与 WD14 端到端反推同样的困境）。感知哈希让功能**今天就能用**，CLIP 装上模型即自动升级。
- **JPEG 限制如实记录**：`decodeImagePixels` 只做完整 PNG 解码（含 5 种 filter、1/2/4/8/16 位深、调色板、Adam7 交错）；JPEG 返回 null 且文件头已注明——完整基线 JPEG 解码（霍夫曼+反 DCT）超出「纯 JS 零依赖」预算，JPEG 的覆盖走 CLIP 通道。这不是遗漏，是通道分工。
- **重复检测复用同一套哈希**：dhash 汉明距离 ≤6（约 90% 相似）分组；前缀分桶把 O(n²) 限制在同/邻桶。与相似图共用索引，不做第二套。

## 中止停滞的 agent 并亲自接手（2026-10-10）

- **事实**：Wave F 的 agent 2（重复检测+文件夹扫描）运行 25 分钟后磁盘上零文件，其最后一条输出停在 recon 阶段（「checking remaining details before writing」），且它 import 的两个模块缺失导致**整个主构建被阻断**。我先发消息催促，等待后仍无产出，遂停止该 agent 并自己实现两个服务。
- **规则**：agent 的**产出在磁盘上**是唯一可信的进度信号。持续 20+ 分钟无文件落地且阻塞构建的 agent，停止并接手比继续等待更便宜——契约已在 `.agent/WAVE_F_CONTRACTS.md` 冻结，主会话有全部上下文。
- **接手成本**：两个服务约 200 行 + 10 个测试，30 分钟内完成（含一次测试 mock 修正：mock 的 registerManagedImage 没有写 image_refs 行，而 ensureMediaAsset 依赖它——mock 要模拟真实函数的**副作用**，不只返回值）。

## P3 OpenCode / Pi runtime 接入决策（2026-10-13）

### P3 execution updates (2026-10-20)

- Added `RuntimeLeasePool`-backed OpenCode process ownership, admission guard, exact sender/session permission broker, capability ledger, and main-owned runtime provenance. Generic metadata updates cannot inject the runtime reference; branches strip it. Native deny is accepted as a tool error/idle terminal, while session-wide grants remain blocked until exact scope persistence is tested.
- Added `prepareNativeRuntime`: renderer endpoint/command/args overrides are rejected for managed Pi/OpenCode, provider/workspace/config are main-resolved, binary versions are checked, and native references are resumed only through a validated identity.
- Pi SDK remains a read-only ESM surface gate only; no SDK session is enabled in registry. The Pi SDK's installed 1.0.1 type authority excludes `ultra`, so the existing provider injection map was narrowed accordingly.

### P3 execution updates (2026-10-18)

- Managed OpenCode ownership now uses a main-only `RuntimeLeasePool`: pending startup reserves owner/config before awaiting, shutdown aborts and drains pending starts, release is idempotent, child exit invalidates leases, and confirmed process exit precedes temporary config removal. AI/Agent callers use session-scoped owners; the prewarm service remains fail-closed.
- Runtime capability status is explicit and read-only through `getAgentRuntimeCapabilities` / preload `runtimes.capabilities`; unsupported replay, recovery, fork, compaction, Pi native approval and absent process leases are returned as `blocked`/`unavailable`/`not-implemented` rather than inferred from runtime availability.
- Pi SDK DIRECT_REUSE has only passed an ESM/export-surface gate (`scripts/pi-sdk-surface-smoke.mjs`); no session, credential, tool, resource-loader or approval lifecycle is enabled. RPC remains the production fallback.

- **共享 loop 放在 main service，不放在 IPC 文件**：`ai-sessions.ipc.ts` 与 `agent.ipc.ts` 保留各自输入校验、权限展示、事件持久化和广播，但 turn 迭代、终态、EOF、取消和 host-tool ownership 统一由 `agent-runtime-turn.service.ts` 负责；不存在以 `runtime-turn.ipc.ts` 命名的伪共享生产入口。
- **OpenCode 继续 wrapper/adapter**：vendored closure 缺少完整 schema/service 依赖，不能直接拼接内部 Effect graph；保留 managed loopback HTTP/SSE。真实 1.18.34 对照发现 `/api/session/:id/prompt` 只完成 v2 durable admission，HTTP-created session 的 `/api/session/:id/wait` 返回 503 `Session wait is not available yet`，所以生产 adapter 保留 `/api/session` create/reference，但执行改走同一 binary 实际工作的 legacy `/event` + `/session/:id/message`；生产 smoke 已通过三次 turn（同一 session 两次 + reopen reference 一次）并过滤 user message part，避免把 admission 或用户回显误判成 assistant 文本。新的 production approval smoke 也通过：native `permission.asked` 在 prompt HTTP response 尚未 settle 时先送达，main adapter 回传 legacy `/permission/:requestID/reply` 的 `once`，bash 工具继续执行并完成第二次 model request。未知 native action 的 Grimoire 映射现在 fail-closed 为 `execute`，不会在 automatic mode 伪装成 read；`bash`/`permission.asked` 回归测试覆盖这一边界。global process lease、cursor/reconnect 和 fork/recovery parity 仍未完成。
- **Pi 先保持 RPC wrapper，使用 source 协议而非重写**：Pi 1.0.1 真机 fake-provider prompt/stream 和 native session-file persistence 已通过。每次运行的 provider/model 配置写入临时 `PI_CODING_AGENT_DIR`（关闭/退出清理），API key 不出 renderer/log；没有已证明的 Grimoire approval handoff 时，native tools/extensions 默认关闭。SDK DIRECT_REUSE 仍需单独验证 ESM、resource loader、custom tools 和 approval 边界。
- **runtime native session 不是第二业务数据库**：只有稳定 runtime reference 进入 `data_json.agentSession.runtimeSessionId`（Agent）或 session metadata（AI）；Grimoire SQLite 的 session/messages/events 仍是真相。普通 renderer data replacement 不能注入/覆盖该 namespace。
- **打包是 package.json 的实际 build block**：runtime binaries 通过 `extraResources` 明确加入发行包；未完成实际 packaged artifact 检查前，矩阵状态保持 `PARTIALLY_MIGRATED`。
- **2026-10-23 runtime boundary correction**：首次 native turn 必须先写入 `__runtimeExecution.state = running`，只有 settled checkpoint 才能 resume；session grants 在 archive/delete 时按 session scope 清除，且 idle grants 也必须被 `clearScope` 撤销。Pi RPC 子进程使用 OS-only environment allowlist，不继承 provider/OAuth/profile variables。OpenCode 1.18.34 的 durable event route 继续记为 BLOCKED for this adapter: its `after` cursor streams `SessionEvent.Durable`, while the working legacy execution emits filtered V1 live events; no fabricated replay bridge is allowed.

## 2026-10-27 接手：文档重建与门禁拆分（P-01…P-06）

新一轮接手（第三任）完成只读盘点后做的决定。证据：`.agent/STATE.md` 第 2、4 节。

### P-01 compat 类型门禁拆分（G5a / G5b）

- **事实**：`npm run typecheck:cherry-compat` 实测 272 条错误，其中 **270 条落在只读的 `src/vendor/cherry/source`**，只有 2 条在我们自己的文件里。原因是 compat 的 tsconfig 只 include 自己的 `src/**`，但 import 会把源文件拉进同一个编译程序；而源闭包里**没有任何 tsconfig**（原工程构建配置未被 vendor），源又只读，所以这 270 条无法靠改代码清零。
- **否决的两个选项**：要求"真 0"＝永久红灯；用 `noCheck` / 排除源码 / 宽泛 ambient 清零＝自欺，且 AGENTS.md 明令禁止。
- **决定**：拆成 **G5a（`compat/src` 与 `src/shared` 必须 0 错）** 与 **G5b（只读源码诊断冻结基线 270 条、棘轮不得增长）**。两半都打印，不静默过滤。
- **立即收益**：拆分后那 2 条自有错误里，第 1 条就是真 bug——`cherry-chat-shell-entry.tsx:1097` 的 `route.id === 'settings-general'` 永不成立（TS2367），导致整块 BLOCKED 面板与 `CompatDomainCapabilities` 不可达（STATE.md D1）。

### P-02 文档体系改为 STATE / GATES / PLAN 三分

- 旧的三份大账本（STATUS 208KB、CHERRY_UI_EXECUTION_STATUS、DECISIONS 混排）互相矛盾：typecheck 同时被记成 39 错 / 0 错 / 2 错；`/settings/general` 一处写"BLOCKED 诊断页"、一处写"域能力面板挂在它下面"；日期非单调，测试计数 690→669→690 交叉。
- **决定**：`.agent/STATE.md`＝现在为真（实测+标记）；`.agent/GATES.md`＝门禁定义；`.agent/PLAN.md`＝下一步。三者单写者、单事实源。DECISIONS 保持追加式历史。

### P-03 旧文档移动而非删除

用户明确允许。移到 `.agent/history/2026-10-27/` 与 `.agent/handoff/2026-10-27/`，附 README 说明归档原因与"不得当现状引用"。`docs/GRIMOIRE_V8_UPGRADE_MASTER_SPEC.md` 与 `.agent/SPEC.md` 有 10 处实质冲突（含 GPL vs AGPL、P0 范围相反、无 Agent/ChatEngine 层），一并归档，其仍有效的量化目标与错误流摘录进 STATE.md 第 7 节。

### P-04 计划统一

`CHERRY_UI_EXECUTION_PLAN.md`、`OPENCODE_PI_EXECUTION_PLAN.md` 的"下一步"并入 `PLAN.md`；后者保留为 runtime 证据日志但不再是指令来源。一个项目不能同时有两份"下一步"。

### P-05 默认入口暂不切换

用户在 2026-10-27 解除了"source-shell 不得成为默认入口"这条约束。**当前仍不切**：切换需要真实 tabs 生命周期、mini-app 运行时与 runtime stream/approval 桥，这些正是 M2/M3 的工作。放到 M5.1 做 A/B 评估后决定，届时给对比表。

### P-06 先基线后功能

在 D1（死分支）、D3（过期门禁数字）、D6（根测试 flaky）、G9（信号误报）修好之前不铺新功能。理由：这三类问题会让"通过"这个词失去意义，而迁移项目最贵的成本是把假绿当成进展。

### 快照

`验收备份/2026-10-27-pre-takeover/`：`tracked-changes.patch`（2MB，`git diff HEAD --binary`）+ `worktree-src-agent.tar.gz`（28MB，`.agent`/`scripts`/`src` 去掉 node_modules 与 dist）+ 未跟踪文件清单 + HEAD。用途：任何误操作前的兜底；**不能替代版本控制**（`.agent/` 与 `src/vendor/` 至今全部未跟踪）。

## 2026-10-27 范围与形态定稿（P-07…P-12）

> 完整依据与逐条处置见 `.agent/records/2026-10-27-takeover/`。

### P-07 Cherry 范围收缩

用户按截图逐条裁撤 18 项（0001、0003、0005–0008、0010–0016、0019、0024、0028、0032、0077），其余未提到的按建议执行：保留约 30 项、待定 4 项（归档/通知/联网搜索/本地备份）、不适用 2 项。**MCP 只保留服务器列表 + 详情，裁掉内置/市场/安装/包搜索四个子页。** 被裁撤的矩阵行在 evidence 列写 OUT_OF_SCOPE，不计入 DoD。SPEC.md 的「全产品对等」需要改写为「选定面对等 + 裁撤登记」。

### P-08 NovelAI Prompt Studio 只取功能

94 项功能逐项处置：**采纳 67 / 后备 18 / 不做 9**。不做的是：精确参考、点券预估、中转站、第三方词典、ChatGPT 账号登录、多配置档、独立客户端窗口、托盘、自动更新。代码不复制（GPL-3.0 与 AGPL 兼容，但按用户要求按行为规格重写）。

### P-09 MOSS 只收 120 条 + 120 图

完整 34,251 条在 2.07GB 的 Release 包，不下载。仓库里的 120 条（96 角色 + 24 风格）+ 8MB 示例图全部内置；需要新增本地图片通道；随附 MIT LICENSE 与 NOTICE。

### P-10 设置是面板，不是浮窗

设置默认在主窗口占一整页标签（左侧分类 + 分组卡片 + 可折叠 + 全局搜索），双击面板标题或点按钮可独立成窗口。独立窗口是另一个渲染进程，因此需要面板状态契约；同步复用已有 `data:refresh` 广播；防闪烁三措施（主题底色、就绪再显示、原窗口占位）。

### P-11 二开不套壳

继续以 Cherry 源码为底（禁止用自建组件替换源页面），在其上做 8 层改造：设计令牌 → 品牌 → 密度 → 组件 → 布局 → 图标 → 文案 → 动效。**颜色只占三成，密度/布局/品牌/文案占七成。** 不修改 `src/vendor/cherry/source`。

### P-12 主题沿用现有系统

昼夜两套 + 色轮自定义主色（已有），新增主题桥把我们自己的变量映射到 Cherry 的变量族并同步深色开关；用户换任何主色，Cherry 页面跟着变。

## 2026-11-04 M4 runtime 等价语义定稿

### D-M4-01 能力账本读实例上下文，不读 runtime 名字

- **决定**：`nativeRuntimeCapabilities(kind, context)` 的 `session.fork`、`compaction`、`permission.session`、`native.tools`、`process.lease` 由 `nativeSessionOperations`、`hostPermissionBroker`、`nativeToolPolicy`、`managed` 决定。UI 只消费主进程给出的 contract，不按 `codex`/`opencode`/`pi` 分支。
- **依据**：`OpenCodeRuntime.forkSession`/`compactSession` 已实现但受 `enableNativeSessionOperations` 门控；`process.lease` 只在 `prepareNativeRuntime` 启动 managed OpenCode 后存在；把整个 kind 写成 `not-implemented`/`unavailable` 会让账本与实例事实相反。
- **后果**：同为空上下文时 OpenCode 的 fork/compact/session-grant 报 `unavailable`，Pi RPC 也报 `unavailable`；区别由 context 表达，不靠名字猜测。

### D-M4-02 `permission.session` 指本地精确 scope，不指 native `always`

- **决定**：`permission.session` 仅在 `hostPermissionBroker:true` 时 `supported`，理由写明 owner/session/action/pattern 精确 grant；native process-wide `always` 明确不发送，也不作为能力承诺。
- **依据**：OpenCode `Permission.state.approved` 是实例级，不是 session 级；adapter 的 approve/reject 永远发 `once`/`reject`。Grimoire broker 的持久化是 sender+session scope+精确 action/pattern，比 native `always` 窄。
- **不做什么**：不把 native `always` 映射成 `allowForSession`，也不为了"session 支持"而放宽成 permission kind 级 grant。

### D-M4-03 pure adapter 的 once/deny 与 broker session 分开

- **决定**：`permission.once`/`permission.deny` 在 `nativeToolPolicy:'ask'` 下即 `supported`；是否存在 host broker 只影响 `permission.session`。
- **依据**：adapter 本身能回 `once`/`reject` 并拿到工具继续/错误；broker 只是决定"是否自动回答下一同 pattern 请求"。把两者绑在一起会把纯 adapter 的能力写成 `unavailable`。
- **失败关闭**：`decide('allowForSession')` 若无精确 grant（force-prompt 或 detail 无法提炼 scope），降级 `allowOnce`，不写宽 grant。

### D-M4-04 OpenCode fork/compact 在 opt-in 下 supported，Pi RPC 仍 unavailable

- **决定**：`nativeSessionOperations:true` 的 OpenCode 报 `session.fork`/`compaction` supported；Pi RPC 即使传该标志也报 unavailable。
- **依据**：legacy `/session/:id/fork` 与 `/session/:id/summarize` 已在 adapter 实现并 await 原生结果；Pi RPC 没有对应的版本匹配操作，Pi SDK 是另一个 driver，不能冒充 RPC。
- **边界**：fork 只复制 native history，Grimoire 必须重写 provenance；compaction 只 await 原生 summarize，不伪造 `compaction-started`/recovery。

### D-M4-05 v2 probe 是结论测试，不是 execution 验证

- **决定**：`scripts/opencode-event-replay-smoke.mjs` 的 `passed` 只表示"已确认 v2 只到 admission"；结果固定写 `admissionOnly:true`、`executionVerified:false`，并记录 `/doc` 接口与真实 `POST /api/session/:id/wait` 的 503 响应。
- **依据**：真实 1.18.34 上 v2 prompt 返回 `SessionInput.Admitted`，durable events 只有 admitted/prompted，provider 调用为 0；wait 返回 `ServiceUnavailableError: Session wait is not available yet`。
- **不做什么**：不把 admission 当成模型执行，不把 durable event 当成 legacy live event 的 replay 桥。

### D-M4-06 未接压缩时 AI compact 失败关闭

- **决定**：`AI_SESSION_COMPACT` 在没有已验证压缩操作时抛 `AI_SESSION_COMPACT_NOT_IMPLEMENTED`；不写 `compaction-finished`，不写 `compactedAt`/`compactedMessageCount`。
- **依据**：旧 handler 只改 metadata 并追加成功事件，会让 UI 显示压缩成功而实际没有压缩。回归测试断言事件与 metadata 均不变。OpenCode 的原生压缩走 `OpenCodeRuntime.compactSession`，不在这个 IPC 上伪造。

### D-M4-07 UI runtime 选择契约

- **决定**：runtime status 增加主进程拥有的 `contract:{provider:'grimoire'|'runtime', model:'catalog'|'freeform'}`；`ProviderModelSelector` 与 `AgentWorkspacePanel` 用它决定 provider 选择器是否可用、模型是目录选择还是自由输入。
- **依据**：UI 不得按 `pi`/`opencode`/`codex` 名字分支；runtime 名字只用于显示。
- **不做**：不在 renderer 里维护第二张 runtime→行为表。

### D-M4-08 recovery 保持 projection-only

- **决定**：`recovery` 仍为 `not-implemented`；没有 runtime/adapter 构造 `recovery` 事件。
- **依据**：没有 source-backed recovery 证据；构造空事件会让 UI 等待永不发生的事件，属于伪造能力。

### D-M5-01 capture 只证明表面，不证明功能接受

- **决定**：catalog 证据分开记录 `surfaceCaptured`、`featureVerified`、`manualAcceptance`；截图通过只把 `surfaceCaptured` 记为 true，`featureAccepted` 始终 false，直到用户明确接受。
- **依据**：PNG 存在、内容 selector 可见，都不能证明功能语义正确。用户要求“诊断 captured 不代表 feature accepted”。
- **契约**：普通页面 action 必须是真实 `navigation.open_route_in_main`；PNG 必须解析 IHDR 正宽高；bounds 必须在 viewport 内；route/query 参数 canonical 精确；证据绑定当前 source-shell SHA-256。

### D-M5-02 74–76 走允许的 base route + 源子菜单

- **决定**：不放开导航 admission 的 query 禁令；data-settings 子面板先导航到允许的 `/settings/data`，再点击源子菜单，断言源内容 selector，并按 catalog route 精确绑定 `panel` 参数。
- **依据**：admission 明确拒绝 query/fragment/编码/空白，这是安全边界；放开它会把 provider/OAuth 等 payload 带进导航。子面板本来就不是独立可导航 URL。
- **结果**：74–76 从 `NAVIGATION_ROUTE_FORBIDDEN` 变为真实捕获；`/settings/mcp/$` 用显式内容解析（`/settings/mcp/servers` + password input selector）记录，不放宽为前缀匹配。

### D-M5-03 journeys 失败粘性

- **决定**：resume 保留每次 attempt；任何历史失败把 aggregate 固定为 failed；partial/duplicate 索引只能 blocked 或 failed，不能 passed。
- **依据**：后一次绿色覆盖前一次红色会隐藏 flaky/真实失败；批量 partial 不是整体通过。

### D-M5-04 final aggregate 不重跑即汇总

- **决定**：`m5-final-aggregate.mjs` 从现有 gates/root logs/journeys/pack/packaged GUI/secrets/A-B/index 原始证据汇总，校验当前构建 SHA-256 与 pack 精确 hash；不为了“绿”重跑 45 分钟套件。
- **依据**：本轮未改产品源码；已有 raw evidence 可复核。任何 evidence 与当前构建不匹配、或任何红色项，aggregate 保持 failed。

### D-M4-09 Review-3：模型选择、driver 契约与 effective permission

- **决定**：本地 runtime 的模型只来自显式选择/session/同 runtime 记忆，不读 active provider 默认值；切 runtime 用主进程 `RuntimeSelectionContract` 清理不兼容 provider/model，切回时只恢复 provider/catalog 仍承认的模型。Pi SDK 开启时 status 直接报 `pi-sdk`，不探测 `pi` CLI；capability 查询带 `provenance`，静态 metadata 的 `session.resume` 保持 `blocked`，真实实例复用 `getCapabilities()`；OpenCode 用 `opencode-unprepared`/`opencode-managed` 区分实例边界。
- **权限**：broker `decideWithDecision` 返回并应用 effective decision，`decide` 保持 bool 兼容；IPC 与 host-tool 路径持久化 effective decision，`resolveAiPermission` 只接受首个终态，避免先写原始 `allowForSession` 再被降级覆盖。
- **依据**：provider default 不是本地 runtime 的模型来源；静态能力不能知道 resume 引用或 host tool allowlist；raw UI 选择不等于 broker 实际应用的 decision。
- **不做什么**：不把 SDK 能力写成 RPC 能力，不从 renderer flags 推断 managed/lease/权限，不把 fixed `allowOnce` 写进 host-tool 的真实 session 决定，不重跑无关 journeys 来制造全量重跑证据。

### D-M7-06 ComfyUI 地址策略只判定字面量，不扩散到 provider

- **决定**：新增 `requireComfyAddress`，保留 `requireHttpUrl` 对供应商地址的既有语义；只让 `ComfyUIClient` 的 constructor、`setBaseUrl`、`downloadImage` 使用新策略。
- **边界**：允许 loopback（`127.0.0.1`、`localhost`、`::1`）HTTP/HTTPS 与公网 HTTPS；拒绝非 loopback HTTP、私有/链路本地/元数据 IPv4 字面量（`0/8`、`10/8`、`100.64/10`、非 loopback `127/8`、`169.254/16`、`172.16/12`、`192.168/16`）以及 IPv6 ULA（`fc00::/7`）、link-local/site-local（`fe80::/9`）、IPv4-mapped 私有字面量。
- **不做什么**：不做 DNS 解析、连接目标 IP pinning 或 rebinding 防护；公网 hostname 解析到私有地址仍可能通过。`settings.ipc` 的通用预校验不在本切片修改，实际网络访问仍由客户端 setBaseUrl 拒绝。（2026-11-05 后续切片已让 `settings.ipc` 复用同一校验，见 D-M7-07。）
- **证据**：`input-validation.test.ts` + `comfy-client.test.ts` 共 22 tests；renderer/main typecheck exit 0；完整 `npm run build` exit 0。

### D-M7-07 settings IPC 复用 ComfyUI 地址策略

- **决定**：`settings.ipc.ts` 的 `comfyui_base_url` GET 回退、SET 校验与 `configureComfyUI` 调用统一使用 `requireComfyAddress`，不再用只校验 scheme 的 `requireHttpUrl` 预校验。
- **依据**：旧的 SET 路径会接受 `https://10.0.0.1` 并先写库，直到 `ComfyUIClient.setBaseUrl` 才拒绝；GET 也会把不合规的存储值直接交给 configure。设置写入边界与客户端必须使用同一策略，非法地址应在写库前失败。
- **边界**：只改 ComfyUI 设置键与 `settings.ipc.ts` 内的相关 configure 路径；供应商 `base_url` 仍使用 `requireHttpUrl`。DNS 解析与 IP pinning 仍不在范围。`src/main/index.ts` 的启动读取仍在切片外，保持 `requireHttpUrl` 预校验，违规值由 `ComfyUIClient` 的 `requireComfyAddress` 拒绝。
- **证据**：新增 4 条 settings IPC 用例（私有 HTTPS 写库前拒绝、loopback HTTP 接受、公网 HTTPS 接受、GET 存储值不合规回退默认）；`src/main/ipc/settings.ipc.test.ts` 8/8 通过，`npx tsc -p tsconfig.node.json --noEmit` exit 0。

### D-M6-06 元数据 UI 以草稿对象承载全字段与未知键

- **决定**：`NovelAIPromptPanel` 的生成参数以文本草稿保存，空值表示字段缺省；导出时转换成 `steps/cfg/seed/width/height` 数字与 `loras: string[]`，未知键从草稿 metadata 对象展开回导出载荷。导入时全部已知字段回填输入框，未知键只保存在草稿对象并显示键名。
- **依据**：空文本框不能被写成 `0`/空串，否则往返会把“未设置”伪装成真实值；未知键若丢掉，新版工具写出的文件经过本 UI 再导出就会降级。
- **边界**：只改面板与 renderer 全局契约，不新增存储、不改 vendor/source；兄弟 `.meta.png` 写入仍由既有文件服务负责。
- **证据**：面板 16 tests（含全字段导出、全字段导入、未知键保留、`.meta.png` 路径）+ 元数据 8 tests；renderer/main typecheck exit 0；G9 panel-layout 0/0。


### D-C2-01 Codex 接手的 Comfy 受控网络合同（2026-11-08）

- 沿用已批准PLAN和work/2026-10-27-m0；DSH user-aborted终态与11736文件接手快照已核实，不重新审批或替换用户基线。
- Cherry remoteFetch原有直连、固定lookup、Host/SNI、流式读取和settlement经ADAPTER/MINIMAL_MODIFICATION进入Comfy transport；只读remoteUrlSafety直接复用。保留原始Source及MIT/AGPL声明，不重新实现IP解析。
- 使用本机compat锁中已存在的ipaddr.js 1.9.1；IPv4 198.18/15和IPv6 2001:2::/48用源策略明确要求的CIDR补齐。原始source测试88项中86通过/2项受旧库benchmarking标签缺失影响，该失败历史保留；Comfy生产adapter通过独立源地址语料验证，不声称原始source测试全绿。
- 设置地址复用C1 requireComfyExecutionEndpoint，拒绝凭据/query/hash/空白；资源URL另用同一网络策略但保留query。SET前零写验证，GET对非法旧地址只返回安全运行默认值，原库值保留且不导出凭据。
- 所有Comfy JSON、图片及默认source取消请求使用main Node HTTP/HTTPS、全部A/AAAA验证及已验证IP固定；保留Host/SNI/证书验证，3次同源redirect，view路径固定。
- JSON10MiB/图片100MiB按实际stream计数；caller取消优先，超限优先于可重试HTTP，HTTP非JSON错误保持状态，JSON错误体保留有效服务消息。所有解析在拥有的deadline内。
- 源cancelAction的后台GET保留源码行为，但通过本次scope追踪、中止和await排空；不删除源快照、不放宽精确prompt_id取消版本门槛。
- focused、源码/构建来源、类型、全量gates、native fixture和人工接受分开；最后两项仍按当前证据标注，不把历史C1通过计入当前源码。


### D-W1-01 编辑草稿与领域租约（2026-11-08）

- 既有workspace_editor_states是唯一持久草稿真相，原SQL revision CAS复用；草稿baseRevision/observedRevision/localSequence与业务work/asset revision分别维护。flush不自动createVersion。
- Host每key独立控制器，不可变快照、旧加载/ACK/广播隔离、显式conflict与remote选择、失败原输入可重试；返回普通结构DTO，不用boolean隐含窗口移交成功。
- 主进程owner从IPC sender+editorKey确定；renderer输入owner/source不能提升权限。NovelAI work/asset TTL30s、heartbeat10s，destroy释放，重新acquire旋转leaseId防迟release关新租约；默认runtime/legacy写有用户租约时EDIT_LOCKED。
- schema42仅给现novelai_asset加revision，旧内容默认1；与原C1execution及schema晋级事务边界同回滚。原C1升级用例仍覆盖40迁移，版本断言跟实际CURRENT_SCHEMA_VERSION而不强行停在41。
- 两个面板消费Host，按work/asset隔离草稿，完整现有metadata包括unknown；保存草稿和保存业务版本分开。W2正式移交/N1全多角色文档/N2全部版本CAS事务未因W1stage计入完成。
- 116focused/two-end types通过，完整自动、native双sender接受和manual分别记录，不自动commit/push。

### D-W2-01 有序窗口移交与既有画布恢复（2026-11-10）

- main签发transferId、sequence、revision和阶段；只投影已知input/bounds字段，renderer的recovery/phase/owner标记不进入authority。普通流程严格freeze/flush→hidden hydrate-ready→转owner→真实源卸载ACK→activate，不等待隐藏窗口的rAF作为卸载证据。
- 活跃移交一直监听终止事件；target timeout/crash/write/conflict撤销并恢复原租约proof和generic owner。已停止renderer由main读取最后持久状态发起恢复；不向crashed sender发送UI事件。恢复通知使用应用已有info类型，避免unsupported icon导致全app error boundary。
- Canvas仍用原vendor保存链和SQLite项目表；真实失败/未排空不冒saved，canonical revision与本地投机revision分离。Workspace只存项目、版本、视口与选择，不增业务文档副本。正式hydrate清除失效缓存，普通resume使用原recovery-aware store保留既有恢复能力。
- 同一已ready画布的普通restore不重新导航；正式hydrate以requestId内部key强制新页面实例并等待新adapter，防旧实例的ready和迟load回滚视口。冻结期间拒绝未完成交互和运行任务，鼠标释放/移动/滚轮均不改文档。
- 旧prompt按原singleton store复用，因此全部视图共享window owner；本地所有写动作在移交/foreign owner时冻结，main也校验family owner。正常草稿消费及完整现有undo/权重/BREAK/排除记录保持；不重造prompt业务引擎。Settings只转移搜索/分区/展开，credential form不转移。
- 当前使用native DatabaseSync SQLite，saveDatabase是兼容no-op；未因旧CodeGraph行号推测重写持久事务。所有source snapshots继续只读，docking engine不替换。
- 原生失败与成功attempt全部保留；当前frame首次启动timeout仍属于S2/V2自启动调查，单次成功不抹掉失败。完整W2门禁、N1之后及最终人工接受分别验收，不自动commit/push。

### D-W2-02 复审后的窗口身份与保存基线（2026-11-15）
- Window/CAS/Canvas原队列继续直接复用；新增页代次、ACK基线与只读原生窗口状态为ADAPTER/MINIMAL_MODIFICATION，不更换布局引擎。重启等待源Host后走既有协议；inactive工作区选中后恢复。页面window.close与原生close分别验证，不假设Electron生命周期相同。
- 所有旧收据/失败保留，当前W2-v2绑定09c42ad1…/51native/14gates；原文文档和完整版本仍归N1/N2，人工与完整计划未接受。

### D-UI-01 商业级界面收口：设置布局、资产分类、面板合并、字体与圆角（2026-11-26）

- **设置面板**：报障「点击只滚动、按钮不变色」的根因不是样式缺失，而是 embedded 分支只调用了 `scrollIntoView()`、从不 `setSection()`，`aria-current` 与激活类冻结在「通用」。改为同一套 shell：左侧 rail（图标+标题+描述，窄容器经 container query 收成图标磁贴）+ 右侧只渲染当前分区（page 语义）；搜索时才切换为堆叠可折叠结果视图。激活态=accent 底色+左边 2px 指示条+accent 文字，与内容一一对应，不可能再漂移。窄容器用 `@container` 而非 `sm:`/`md:`（G9 明确禁止面板内视口断点）。
- **提示词资产**：两个独立缺陷。①卡片封面曾用 `aspect-[4/3] w-full`，单列时一张图撑满整个面板；改为固定 80px 高缩略图 + `auto-fill minmax(148px,1fr)`，动作行不再换行（图标复制/预览 + 文本「应用」）。②「空类目」不是空数据，而是面板按 40 条分页后拿当前页过滤分类树，其余分区的类目必然显示 0/暂无内容；改为浏览时按 100 条分块取全量（IPC 单页上限 100 保持不放宽），搜索仍真分页。
- **资产分类**：内置源共 568 个自由 tag，直接当类目产出数百个单资产货架；改为 9 个固定货架（角色/风格/场景/商品电商/海报排版/UI 界面/信息图/摄影写实/生活趣味）+ 其他，tag 仍留在卡片上作元数据。已带类目名的 tag（如 MOSS 的 角色/风格）优先采信，保证 96/24 不变。7 个提示词源合并到「提示词资产合集」一个根，MOSS 保留独立根（策展集而非源转储）；种子后再删除无链接且无子节点的内置类目。标记 v10，旧版重导入自动重建。
- **面板合并**：`tag-batch` 面板并入「标签与资产」第 4 个页签「批量工具」，同时移除 panelTypes 联合、PanelRegistry 定义/分组/渲染分支、`WORKSPACE_POPOUT_TYPES` 白名单，并在 `LEGACY_PANEL_ALIASES` 加 `tag-batch → tag-asset-manager`，旧布局文档不跳空。
- **Emoji**：自有源码零 emoji（Sidebar 22 处、canvas 插件 15 处、会话侧栏、宿主工具条），一律换 lucide（开源图标库，已是本仓依赖）。canvas 的插件 `icon` 是字符串契约，新增 `node-glyph.tsx` 做语义键 → 图标映射，并为已保存数据保留 emoji 键（以 `\u{...}` 转义书写，源码不再出现字形）；未知键渲染为空而非回退成 emoji。
- **字体**：`--font-sans/--font-display` 全面改用「Sarasa UI SC（更纱黑体 UI）」，本机已安装 SarasaUiSC-Regular/Bold；用 `@font-face { src: local(...) }` 覆盖多种别名，**不打包** 48MB TTF，缺字体机器回落到原 Segoe/雅黑链。
- **圆角**：全站 ≤5px。`--gr-radius-sm/md/lg/xl/2xl` 与 `--radius-*` 收为 4/4/5/5/5，Tailwind v4 的 `rounded-*` 由 `@theme` 同名变量派生（91 处硬编码调用点无需逐个改），index.css 里 6/7/8px 字面量统一改 5px；pills（999px）与 50% 环不属「角」保持原样。G11 样式契约的三条实测期望同步（8→5、7→5、6→4），canvas 内联 16/18px 一并收紧。
- 证据：`.agent/records/2026-11-06-sol-execution/ui-2026-11-26/`（主窗/设置两态/提示词资产/标签批量页签截图）+ `commands/ui-overhaul-*` 回执；未做 commit/push。

### D-REL-01 v1.7.2.1-alpha 发版准备（2026-11-26）

- **版本号**：package.json 用 `1.7.2-alpha.1`——四段的 `1.7.2.1-alpha` 不是合法 semver（`semver.valid(x[,"loose"])` 全为 null），electron-builder 的 `normalizePackageData` 会直接抛 `Invalid version`。用户可见处（README、StatusBar、设置关于页、MCP clientInfo）统一写 `1.7.2.1-alpha`；安装包文件名用 `nsis.artifactName` / `portable.artifactName` 硬编码成 `Grimoire.Setup.1.7.2.1-alpha.exe` 与 `Grimoire.1.7.2.1-alpha.exe`，与 UI 一致。
- **字体打包**：`public/fonts/` + `src/renderer/fonts.ts` 运行时 `FontFace` 注册。原因：把 24MB×2 的 TTF 写进 `index.css` 的 `url()` 会让 Vite 的 CSS 管线在 `@import "tailwindcss"` 内联后的超长行上抛 postcss「Missed semicolon」（`assetsInlineLimit: 0` 也不解决，已实测），改用 public 静态资源 + 相对 `document.baseURI` 解析，dev 与 `file://` 打包两边同一条 URL。`asarUnpack: dist/renderer/fonts/**` 让 Chromium 能读 asar 外的字体；CSS 的 `local()` 仍优先命中已装字体。OFL 1.1 全文随 `public/fonts/SarasaGothic-LICENSE (OFL-1.1).txt` 分发。
- **首帧白窗兜底**：主进程 `createWindow` 里 `did-fail-load`（忽略 ERR_ABORTED）与 2.5s 无 URL 的 blankGuard 各重载一次、累计最多两次，避免安装版用户看到 about:blank 却不知道按 Ctrl+R。日志写 `renderer/RENDERER_NAV_RETRY`。
- **产物体积**：NSIS 271.7MB / 便携单文件 271.5MB / ZIP 389.7MB；体积主要来自 Electron + 生产依赖（字体 47.9MB、资产 12MB）。未做字体子集化与依赖裁剪，宁可大也不破坏字形与运行时。
- **未执行**：commit/tag/push 与 GitHub Release 上传（仓规禁止未经确认的 push，且 V1–V3 未做）；NSIS 安装流程未实机点完，仅验证 `win-unpacked` 实机启动、标题、`file://` 页面 3.1M 字符正文与 Sarasa 字面量加载。

### D-UI-02 字体回退：不随包分发更纱黑体（2026-11-26）

- 用户决定「只是不打包」：删 `public/fonts/`（两个 TTF 45.4MB + OFL 文件）、`src/renderer/fonts.ts` 与 main.tsx 的运行时注册、`build.asarUnpack`；**保留** `index.css` 里 `@font-face { src: local(...) }` 与 `--font-sans/--font-display` 的首选链，因此本机已装更纱黑体时仍用它（`document.fonts.check('14px "Sarasa UI SC"') === true` 实测），未装机器回落到 Segoe UI / 微软雅黑。
- 顺带删掉上一轮新增、但从未被引用的 `--gr-font-ui` / `--gr-font-display` token（tokens.css），避免留死代码。
- 体积实测：安装包 271.7→252.3MB、便携单文件 271.5→252.1MB、ZIP 389.7→366.1MB（TTF 仅 gzip 51%，所以 ZIP 只减 23.6MB）。
- 截图 5 张全部按新版本号重拍（设置两图改 1280×880，1600 宽时 `max-w-3xl` 内容偏空）。

### D-REL-02 版本号定为 0.7.3-alpha（2026-11-26）

- `0.7.3-alpha` 是合法 semver（major 0 / minor 7 / patch 3 / prerelease ["alpha"]）；四段的 `1.7.2.1-alpha` 非法，已弃用。
- 影响：项目无 `electron-updater`，降号不触发任何更新器判定；NSIS 不比较版本，可覆盖安装；数据库 schema 42 不变。代价是 Release 列表出现 7.x→0.7.3 的观感倒退，已在 RELEASE_NOTES 首屏写明「版本号重置」。
- 产物名改为 `Grimoire.Setup.0.7.3-alpha.exe` / `Grimoire.0.7.3-alpha.exe` / `Grimoire-portable-0.7.3-alpha.zip` / `SHA256SUMS-0.7.3-alpha.txt`；UI、MCP clientInfo、README、README.en 同步。

### D-REL-03 发布文案与 about 收口（2026-11-26）

- README/.en 重写：删掉字体、体积、已知问题 3 等与使用者无关的实现细节，改为「解决什么问题 → 核心能力 → 典型用法 → 下载/源码」的结构；字体在 README 中不再出现（D-UI-02 的延续）。
- 设置「关于」补一句定位文案，技术栈更正为 `node:sqlite`（原写 SQLite，实际用 `DatabaseSync`）。
- GitHub Release 标题去掉括号说明，改回纯版本号 `v0.7.3-alpha`（`gh release edit --title` 只改元数据，不重传资产）。
- 已上传的 0.7.3-alpha 二进制仍是改文案前的构建（about 面板显示旧技术栈行）；是否为此重打包由用户决定，不擅自重传 870MB。

### D-STO-01 数据存储控制台：P1 只读面板（2026-11-27）

- **数据面用「自动发现 + 手写注册表」**：`src/shared/storage-registry.ts` 声明 70 张表（含 8 个域）与 11 条路径项，运行时与 `sqlite_master` 交叉校验；未映射的表进 `other` 域并在开发日志告警。上线首测就抓到 `wd14_history` 没被映射——这类遗漏只有交叉校验能发现，纯手写清单会一直漏。
- **表体积用 `dbstat`**：`SELECT SUM(pgsize) FROM dbstat GROUP BY name`，再用 `PRAGMA index_list(<table>)` 把索引页归并回所属表（UI 不显示 `idx_*` 噪音）。实测 9.3MB / 69 表库上毫秒级；`dbstat` 不可用时降级为 `null` + `approximate=true`，不把未知渲染成 0。
- **目录体积不用 worker_threads**（与计划草案的偏差，已实测后改）：`storage-size.service.ts` 用 `fs/promises` + 并发 8 + 3s 预算 + 10 万文件上限 + 5 分钟 TTL 缓存 + in-flight 合并。理由是遍历本身是异步 IO，实测 527MB 的 userData 在 300ms 内完成，引入 worker 只会多一层打包与调试成本。上限/超时命中时 `truncated=true`，UI 标注「体积为下限」。
- **分组卡片不能用 `ui-list-card` 裸类**：它的 `:hover` 会把整块染成强调色，看起来像被选中；改用 `ui-list-card-no-hover`。
- **窄容器用 ResizeObserver 而不是 container query**：阈值 780px。踩到两个坑并已修：①`ref` 放在 loading 早退之后的树里，`useEffect([])` 首次拿不到元素 → 改为依赖 `inventory`；②窄布局必须用两行块布局（标题+行数+大小 / 路径+操作），三层 flex-col 在 340px 下会互相压字。
- **P1 只渲染已实现的操作**（打开目录 / 复制路径）。导出、导入、迁移、清理的能力位已在数据里，但按钮等 P2–P5 真做出来再加，宁可少一个按钮也不做「点了没反应」的占位。
- 实测：本机 527MB userData 中，迁移备份 20 份占 145MB、Chromium 缓存 348MB、真实库 9.3MB；面板总览的顺序即按此设计（先看清构成，再谈导出）。

### D-STO-02 数据面板三级结构 + 悬停详情 + 字体三槽位（2026-11-27，P1.5）

- **子组按体积排序而不是注册表顺序**：`storage-inventory` 先按 `bytes` 降序排条目，子组顺序取首次出现。代价是「别名为关系」可能排在「本体」前面，但这正是存储面板要表达的语义——先看谁在吃空间。若以后要改成业务顺序，只需在 registry 加 `subgroupOrder`。
- **组的 `complete` 位**：组内存在未统计项且合计为 0 时，UI 显示「—」而不是「0 B」。这是 P1 的遗留缺陷（只有未知一项的域显示 0 B，误导用户以为没有数据）。
- **悬停卡片用 `position: fixed`**：面板最窄 210px，`absolute` 会被容器裁掉；固定定位 + 视口边界翻转，路径可选中复制。
- **字体走三个独立槽位**，不是一个全局字体：`--font-sans` / `--font-display` / `--font-mono` 在项目里是三种真实语义（正文、标题、提示词原文/日志）。回落链固定追加 `Microsoft YaHei UI`，因为选中字体可能只有拉丁字形。
- **字体名校验必须严**：白名单只放行 `字母/数字/空格/点/下划线/连字符/加号`，括号也不放行（`url(evil)` 这类值必须被拒）。设置是可手改的 JSON，直接拼进 style 就是注入。
- **命名冲突教训**：`index.ts` 已有一个本地 `registerSystemIPC`（管 openExternal / showItem），新模块最初同名导致 import 被静默跳过、handler 从未注册（现象是 `No handler registered for 'system:listFonts'`）。改为 `registerSystemFontsIPC`。同一文件里出现同名本地函数时，插入 import 不会报错但会被本地声明覆盖——`grep` 编译产物比读源码更可靠。
- **「朋友项目迁移」→「提示词索引（JSON）导入」**：功能保留（写 `prompt_assets` + `migration_runs`），只是名字换成用户能懂的词；P2 建好导入弹窗后并入统一入口。

### D-PERF-01 首屏性能：实测归因与三处修复（2026-11-27，P3 第一批）

实测（spawn → 首帧，临时 profile）：温启动 0.78s、冷启动 7.24s、首次运行 22s。归因不是"渲染慢"，而是三件不同的事：

1. **标签种子没有事务**：`importDefaultTags` 逐条 INSERT 4589 次，每次都 fsync。打点显示 `app-ready 271ms → tags-seeded 3311ms`。包进 `BEGIN/COMMIT` 后降到 **528ms**。这是本轮最划算的一处，零行为变化。
2. **首次运行的资产导入与首屏查询抢同一个 SQLite 写锁**：导入 1862 条的写事务与渲染层首批查询并发，把首帧推到 5–24s。改为「等首帧信号（`afterFirstPaint`）再写库」，首帧后广播 `broadcastDatabaseReload` 刷新面板。无头/测试环境用 4s 兜底定时器，保证数据仍会导入。
3. **资产面板一次性渲染 1862 张卡片 = 75,930 DOM 节点**（P1 为了修「空类目」改成全量加载导致的）。修法不是退回分页（会让类目计数失真），而是**数据全量、渲染分批**：`ProgressiveGrid` 每组先渲染 60 张 + 「显示全部 (N)」，并让 `ResourceGroup` 支持 `defaultCollapsed`（条目 > 40 的组默认收起）。

**实测结果**（同一台机、全新 profile）

| 指标 | 修复前 | 修复后 |
|---|---|---|
| 全页 DOM 节点 | 75,930 | **1,096**（-98.6%） |
| 资产面板 DOM | 14,781 | **157**（展开一个大组后 5,415，按需） |
| 首次运行到首帧 | ~22s | **1.107s** |
| tags-seeded 阶段 | 3,311ms | **857ms**（含事务 + 更早的 db 阶段） |

**首帧口径踩坑**：最初用 `performance.now()` 上报，窗口被遮挡时 rAF 被节流，回调晚跑 30s 就把首帧记成 35s。改成 `performance.timeOrigin + first-contentful-paint` 还原绝对时刻，`totalMs` 不再随查询时间漂移；无历史时回落到「最大 mark」而不是 `Date.now()`。

### D-PERF-02 面板保活取消（2.2 不做）：实测切换已在目标内（2026-11-27）

原计划 2.2 是「非活动面板隐藏而非卸载，切回 <150ms 且不重复 IPC」。DOM 修复后实测：

```
标签管理 ↔ 标签与资产   15ms / 84ms
标签与资产 ↔ 标签库     31ms / 9ms
页面 DOM（空闲）        1,801
```

切换成本已远低于 150ms 目标，收益不足以抵消保活带来的内存占用与订阅生命周期复杂度（每个面板要处理 `aria-hidden`、事件解绑、LRU 淘汰、重新可见时的补拉）。**按数据取消该项**，不做"为了计划表好看而实现一个没收益的机制"。

### D-TRANSFER-01 备份包：格式、校验与「先看再动」（2026-11-27，P2 第一批）

- **包格式自版本化**：`format: 'grimoire-backup/1'` 与 `schemaVersion` 分开记。包格式变（加字段/换布局）才升 format；数据库结构升级不需要让旧包失效。
- **每个文件都有 sha256**：导入 full 时先解 db 到临时目录、比对 manifest 里的 sha256，再交给现有 `importDatabase()`。它有 staging + integrity + `.before-import-*.bak` 回退，不重写。
- **数据库快照用 `VACUUM INTO`**：`DatabaseSync.backup()` 不存在（实测），`VACUUM INTO` 只读句柄也能跑，且顺带压实（9.3MB → 7.9MB）。
- **partial（选择性导入）在本批只导出不导入**：`applyImport` 对 partial 明确抛「还在实现中」，不做半吊子写入。下一批补「按条目 JSON + 外键顺序 + 单事务」。
- **拒绝非本格式文件要给出可读原因**：`yauzl` 抛的是 `End of central directory record signature not found`，用户看不懂；`inspectImport` 会转成「压缩包内缺少 manifest.json，无法识别为 Grimoire 备份」。
- **schema 更高的包直接拦**：`schemaVersion > CURRENT_SCHEMA_VERSION` 时 `compatible=false`，避免把新库塞进旧代码。
- **对话框留在主进程**：渲染层只发「导出/导入/诊断」意图，路径由 `dialog` 决定，避免渲染层被注入后获得任意写权限。验收脚本用 `GRIMOIRE_TRANSFER_DIR`（只读环境变量）绕过对话框，这是唯一的自动化缝合点。
