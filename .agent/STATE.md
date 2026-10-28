# Grimoire 当前状态（单一事实源）

> 快照时间：**2026-10-27** ｜ HEAD：`5672084` ｜ 工作树：85 个 tracked 修改 + 约 15,040 个未跟踪文件（648MB）
> 本文只写**现在为真**的事实。历史过程见 [history/2026-10-27/](history/2026-10-27/README.md)，能力行级状态见 [MIGRATION_MATRIX.md](MIGRATION_MATRIX.md)，下一步见 [PLAN.md](PLAN.md)，门禁定义见 [GATES.md](GATES.md)。

标记约定：**【实测】**= 2026-10-27 本机跑出来的；**【继承】**= 来自交接文档 / 旧账本，尚未复测；**【未知】**= 没有可信证据。

---

## 1. 一句话现状

源级迁移已经做到"真实 Cherry 组件能跑、构建与测试是绿的"，但两条流各差**最后一公里**：

- **UI 流**：页面渲染得出来，但源 runtime 的 stream / approval / recovery 没有桥，所以 AgentPage 的"真跑"闭环没通。
- **Runtime 流**：适配器能在真实二进制上跑 turn 和审批，但 durable replay 与 recovery 未实现，capability 账本与实现语义有偏差。
- **账本流**：三份旧文档互相矛盾且落后于代码（含一处死代码、一处过期截图），已归档，重建为本文。

---

## 2. 门禁实测（本机，2026-10-27）

| 门禁 | 命令 | 结果 |
|---|---|---|
| 跑法 | — | **`node scripts/gates.mjs`**（G1–G8 一条命令；`--fast` 跳过测试与构建） |
| G1 渲染层类型 | `npx tsc --noEmit -p tsconfig.json` | **0 错误** 【实测 2026-10-27】 |
| G2 主进程类型 | `npx tsc -p tsconfig.node.json --noEmit` | **0 错误** 【实测】 |
| G3 根测试 | `npx vitest run` | **144 files / 1339 passed / 2 skipped，41.1s，exit 0** 【实测】 |
| G4 compat 测试 | `cd src/vendor/cherry/compat && npx vitest run` | **35 files / 292 tests 全绿，25.8s** 【实测】 |
| G5 compat 类型 | `node scripts/check-compat-types.mjs` | **自有 0 条 / 只读源码 270 条（冻结基线）** 【实测】 |
| G6 全量构建 | `npm run build` | **exit 0，23.4s** 【实测】 |
| G7 矩阵格式 | `npm run check:migration-matrix` | **115 rows，无坏行** 【实测】 |
| G8 CSS 覆盖率 | `npm run check:cherry-css` | **PASS（≥90%）** 【实测】 |
| G9 路由审计 | `env -u ELECTRON_RUN_AS_NODE node scripts/audit-cherry-routes.mjs` | **51/51 全部渲染** 【实测 2026-10-27】。注意：本机环境变量 `ELECTRON_RUN_AS_NODE=1` 会让 Electron 以 Node 模式启动，必须用 `env -u` 取消 |
| G11 打包 | `npm run pack` | 未跑【未知】 |
| 截图证据 | catalog evidence guard | 79 条里 18 条 captured、61 条 pending，`manualAcceptance=pending`【清单自带】 |

**一次全绿记录**：2026-10-27 17:11（UTC）`node scripts/gates.mjs` 八个门禁全过，快照 `artifacts/gates-2026-10-27T17-11-46-412Z.json`。

**根测试 flaky 政策**：vitest 3.2.7 在本机会偶发 worker RPC 超时（`Timeout calling "onTaskUpdate"`）而所有用例通过。`scripts/gates.mjs` 对该签名**只重试一次且记录 attempts**；任何真实用例失败都不重试。

---

## 3. 项目结构与规模【实测】

```
src/vendor/cherry/source      8,084 文件   90MB   只读源闭包（AGPL-3.0）
src/vendor/cherry/compat      独立工程     1.2G   其中 node_modules 1.1G、dist 134M
src/vendor/opencode/source       71 文件           MIT
src/vendor/pi/source            108 文件           MIT
src/vendor/dockview/source      272 文件           MIT
src/vendor/infinite-canvas/source 424 文件         MIT
resources/agent-runtimes/     opencode.exe 134M (1.18.34) / pi.exe 107M (1.0.1)
```

分层（[SPEC.md](SPEC.md)）：UI → ChatEngine/WorkspaceEngine/ToolRegistry → AgentRuntime/WorkspaceAdapter/domain adapter → 领域服务 + Grimoire SQLite（唯一业务真相）。

---

## 4. 已确认的缺陷与过期记录

### D1（已修复 2026-10-27）`/settings/general` 曾是死分支，域能力面板渲染不到

- 证据：`src/vendor/cherry/compat/src/cherry-chat-shell-entry.tsx:1097` 的 `route.id === 'settings-general'` 被 TS 判为 **TS2367 永不成立**——因为 `settings-general` 已在 `SOURCE_SETTINGS` 里，第 1089 行的 `isCompatSourceSettingsRoute(route.id)` 先命中。
- 后果：1097–1110 整块（"常规设置尚未接入（BLOCKED）" + `<CompatDomainCapabilities />`）**不可达**；`CompatDomainCapabilities` 全仓只有这一处引用 → 这个域能力面板**永远不会渲染**。
- 连带后果：`artifacts/visual/cherry-routes/route-settings-general.png`（10-26 10:45）拍的是那个 BLOCKED 面板，而 `CompatSourceSettings.tsx` 在 **10-26 13:24** 才把 general 加进 `SOURCE_SETTINGS` → **该截图是过期证据**。
### 修复记录

- 删除 `cherry-chat-shell-entry.tsx` 中不可达的 general 分支（原 1097–1110）与多余的 import。
- 把 `<CompatDomainCapabilities />` 移进 `CompatSourceSettings.tsx`，仅当 `route.id === 'settings-general'` 时渲染，位置在诊断横幅之后、只读 fieldset 之前。
- 回归测试：`CompatSourceSettings.test.tsx` 新增「general 可达且承载域能力报告」用例；`CompatRemainingSettings.test.tsx` 的排序断言改为「不得再出现 general 专用分支」。
- 结果：G5 自有类型错误 272→**270 条（全部来自只读源码，自有 0 条）**；G4/G3 全绿。

### D2（已修复 2026-10-27）`opencode-permission-smoke.mjs` 的死变量

- 已删除 `let permissionDetail` 与其赋值；脚本其余逻辑未动。

### D3（已更新 2026-10-27）截图清单里的门禁快照

- 原记 `failed / 255 条`（10-14 证据）；现更新为「自有 0 / 只读源码 270（冻结基线）」并注明证据文件。

### D4（验收缺口）截图目录

- 79 条：源组件已挂载 41 / 受阻诊断 27 / 不可用 9 / 非渲染器 2；**captured 18、pending 61**；`manualAcceptance=pending`。

### D5（已修复 2026-10-27）路由审计的误报

- 原信号是「页面中文标题文本」，页面一改文案就误报。现改为**结构选择器**（源页面包装器 + 域能力面板标记），并从 `CompatSourceSettings` 实际导出推导「已挂载的源设置页」，不再硬编码。
- 修完后 51/51 全部通过；同一次修复还暴露了 D9。

### D6（政策化 2026-10-27）根测试偶发

- 现象：vitest 3.2.7 在本机偶发 `Timeout calling "onTaskUpdate"`（worker RPC），此时所有用例仍通过，但进程 exit 1。
- 政策：`scripts/gates.mjs` 只对该签名重试一次并记录 `attempts`；任何真实用例失败不重试。
- 尚未抓到那 1 次「2 个用例失败」的名字；下次出现时按 G3 输出定位。

### D7（权威链）旧文档三套口径

- 已归档：STATUS（39/0/2 三种 typecheck 口径）、V8 spec（GPL vs AGPL、P0 范围相反、无 Agent 层）等。见 [history/2026-10-27/README.md](history/2026-10-27/README.md)。

### D8（记录级）`agent.ipc.ts:234` 写事件用的是 `event.detail`

- 225 行算出了合并后的 `detail`，234 行却写 `event.detail`。不一定是 bug（可能故意保留原值），但两条路径不一致，需一次明确判断。

---

## 5. UI 流真实状态

| 面 | 状态 | 证据 | 真实缺口 |
|---|---|---|---|
| compat shell（默认入口） | 可运行 | 全量 build 通过；compat 292 测试绿 | 不是真实 TanStack routeTree，是 hash registry |
| source-shell（真实 MainApp） | 隔离可运行 | 独立 build + smoke 通过【继承】 | 不得默认切换；runtime/domain/window consumers 未桥 |
| 源设置面 | 15 路由挂载 + 17 descriptor 诊断 | `settings-route-descriptors.ts` | 见下 |
| 只读挂载的 6 个源页 | general / api-gateway / websearch / selection(仅 Win) / browser / screenshot | `CompatSourceSettings.tsx:10-35` | 包装器用 `<fieldset disabled>`；**但源组件 mount 时自己的读取 hook 仍会跑**（`useApiGateway`、`useWebSearchProviderLists`）。fieldset 挡交互，不挡读取 |
| 凭据边界 | 三层齐备 | settings.ipc.ts:40/48、preference-service.ts:103/206、`cherry-settings-privacy.ts` | 需一次完整 "malformed JSON / 嵌套 secret" fail-closed 验证 |
| Skills / Tasks | **未接入 shell** | `CompatSkillsSettings`/`CompatTasksSettings` 只被自身测试引用 | 缺 `useBlocker` shim；源 `SkillFileBrowser` 需要它 |
| 模型选择器 | 10-13 曾通过 | `settings-actions.json`: `modelSelectionPersisted=true`，读回 `settings-smoke-provider::gpt-4o` | **需在现树重测**；10-14 的账本声称 picker 显示"无可用模型" |
| Link shim | 已实现 | 内部路径 → hash 锚点；非内部/含反斜杠 → throw | 未实现 `useBlocker`/`useRouter` 完整语义 |
| 聊天/AgentPage 闭环 | **未通** | —— | 源 runtime stream（open/attach/detach/abort）、approvals、recovery 未桥 |
| 窗口矩阵 | 8 个 WindowType 中 2 个 NOT_APPLICABLE，其余 BLOCKED | `WINDOW_MATRIX.md` | 多窗口生命周期、全局输入钩子、截屏管线、userData 迁移 |

---

## 6. Runtime 流真实状态

### 6.1 能力账本（权威表，来自 `src/main/ai/runtime/capabilities.ts`）

| capability | pi | opencode |
|---|---|---|
| streaming | supported | supported |
| session.resume | blocked（`persistent` 时 supported） | blocked（`persistent` 时 supported） |
| session.fork | not-implemented | not-implemented |
| event.replay | unavailable | blocked |
| permission.once | blocked | supported |
| permission.deny | blocked | supported |
| permission.session | blocked | blocked |
| native.tools | blocked | blocked |
| compaction | not-implemented | not-implemented |
| recovery | not-implemented | not-implemented |
| process.lease | unavailable | unavailable（传 `managed` 才 supported） |

**两处语义待对齐**（不是 bug，是口径）：
- `process.lease` 生产恒为 `unavailable`，因为 `adapters.ts` 只传 `persistent`、`registry.ts` 不传 options——而 `RuntimeLeasePool` 确实在管理 OpenCode 子进程。账本读起来像"没有租约"，实际是"没声明"。
- `permission.session` 两侧都是 blocked，但 Grimoire 侧的 `allowForSession` 精确 scope grant 已实现并被 21 个 IPC 用例覆盖。差别在定义：native process-wide `always` 不可信（blocked），本地 grant 可用（已有）。

### 6.2 已实现并验证

- 共享 turn runner `agent-runtime-turn.service.ts`：有界 turn、必须有 terminal、EOF 视为失败、取消、host/runtime ownership 分离。
- admission、permission broker（sender/session/action/input 精确 grant、5 分钟超时 deny、`clearScope` 清 idle grant）、provenance（首轮先写 `running`，只有 settled 可 resume，branch 剥离）、lease pool。
- `agent.ipc.ts` native deny 的 early throw **已删除**；deny 后由 runtime 的 terminal event 决定终态。【实测：4 个定向测试文件 85 用例全绿】

### 6.3 未实现 / 阻塞

| 项 | 状态 | 含义 |
|---|---|---|
| OpenCode `event.replay` | blocked | v2 `/api/session/:id/event?after=` 只吐 `SessionEvent.Durable`，而生产执行走 legacy `/event`+`/session/:id/message` 发 V1 live 事件；不能伪造桥 |
| OpenCode v2 execution | 未验证 | 真实 1.18.34 上 v2 prompt 只到 `SessionInput.Admitted`，不触发 provider 请求；`/api/session/active` 为空 |
| `recovery` | not-implemented | 没有任何 runtime/adapter 构造这个事件；IPC 分支不可达 |
| session-wide native grant | 未做 | native reply 永远只发 `once`/`reject`，不发 process-global `always` |
| Pi native approval / tools | blocked | 不得用 args 或 renderer metadata 绕过 |
| Pi SDK | 仅 ESM surface gate | `GRIMOIRE_PI_SDK_RUNTIME=1` 才可选；生产默认仍是 RPC |
| 真实 grant smoke | 未完成 | broker 有 IPC 级覆盖，但没有从真实 `permission.asked` payload 提炼 scope 的端到端证据 |

---

## 7. 保留自 V8 规格的可用部分（其余已归档）

以下条目仍有效，作为非功能性目标保留：

- 量化目标：冷启动 ≤5s；4000+ 标签搜索 ≤150ms；10 万资产筛选 ≤500ms；1000 节点画布 ≥45FPS；1366×768 ~ 2560×1440、100–200% 缩放无遮挡。
- 错误流：版本化错误对象（错误码/模块/任务 ID/阶段/可重试/恢复建议），重启后未完成任务必须标"待恢复 / 外部仍运行 / 已中断"，不得伪装成功。
- 扩展点：AIProviderAdapter、ImageAnalyzerAdapter、GenerationAdapter、WorkspacePanelDefinition、CanvasNodeDefinition、Importer/Exporter、TaskHandler。
- 依赖禁令：Renderer 不得直连 SQLite/文件系统/Python 端口/ComfyUI/API Key；画布不得以 IndexedDB 为真相；Python 不得改主库。

---

## 8. 环境与数据事实

- 数据库：`src/main/services/sqlite.compat.ts` 已用 `node:sqlite` 的 `DatabaseSync` + 兼容层；`sql.js` 仍在依赖里（需确认是否还有运行路径）。
- 用户数据：`%APPDATA%/grimoire/grimoire.db`；仓库内 `artifacts/visual/.user-data/` 是隔离测试 profile。
- 密钥：只在 main 进程；renderer DTO 与 preference cache 都脱敏，generic write 拒绝（`feature.api_gateway.api_key`、`chat.web_search.provider_overrides`）。
- 版本控制：**`.agent/` 整个目录、`src/vendor/` 绝大部分、`artifacts/`、`resources/agent-runtimes/` 都是未跟踪文件**。git 里只有 85 个 tracked 修改。一次 `git clean -xdf` 会毁掉 648MB 不可再生的迁移成果。
- 现有快照：`验收备份/2026-10-27-pre-takeover/`（tracked patch 2MB + src/scripts/.agent 打包 28MB + 文件清单）。其余 `验收备份/` 为 2026-09 的 Electron userData 快照。

---

## 9. 硬约束（来自 AGENTS.md / SPEC.md，未变）

1. `src/vendor/*/source` 只读。
2. 不 reset / checkout / clean / 覆盖用户改动。
3. 未授权前不 commit、不 push。
4. UI 不得按 `pi`/`opencode`/`codex` 名字分支。
5. 只有 `toolOwnership === 'host'` 的 toolCalls 由 Grimoire 执行；native telemetry 不重放。
6. 未验证能力必须显式 `blocked / unavailable / not-implemented`，不许写成 supported。
7. 状态词汇只用 MIGRATION_MATRIX 的 10 个值。
---

## 4.1 M1 / M1.5 进展（2026-10-27）

### 已完成

| 项 | 结果 |
|---|---|
| M1.1 UI 台账 | `artifacts/cherry-ui-inventory.json` + `.agent/UI-INVENTORY.md`（79 条逐条：处置/动作/数据源/缺口） |
| M1.2 挂载副作用审计 | 6 个只读页，**无一在挂载时读密钥**；全部是平台探测或状态查询 |
| M1.3 路由审计信号 | 改为结构选择器；**51/51 通过** |
| D9 真 bug | `isWin` 依赖不存在的 `window.electron` → 划词助手页在任何系统都降级；已改为 UA 判断 |
| M1.5.1 设计令牌 | `src/renderer/styles/tokens.css`（圆角/间距/字号/阴影/动效/密度 + 三个共享类） |
| M1.5.2 主题桥 | 主渲染层读实际计算样式 → `theme:publish` → 主进程广播 → Cherry 窗口写变量并切 `.dark`；含品牌色阶推导 |
| M1.5.3 设置面板 | `settings` 面板现在渲染**完整设置页**（不再是快捷设置子集），加搜索框与分区过滤 |
| M1.5.4 独立窗口 | 双击面板标题栏可弹出；弹出窗口 `show:false` + 主题底色 + `ready-to-show` 防白闪 |
| M1.5.5 品牌 | Cherry 窗口标题改为「魔导书 · 智能工作区」 |

### M1.5 已完成（2026-10-27 第二轮）

- **分组卡片 + 折叠**：8 个分区在面板模式下堆叠为可折叠卡片（`data-ui="settings.section"`），侧栏变锚点滚动；折叠状态按分区独立，折叠后标题仍可见。测试：`SettingsWindow.embedded.test.tsx`（8 张卡片、单独折叠、搜索过滤）。
- **组件基线**：`ui-field` / `ui-settings-nav-item` / `ui-segmented` / `ui-popover-surface` / `ui-panel-shell` 改用设计令牌（圆角与阴影），不改尺寸。

### 未完成

- 品牌全量替换（关于页、空状态插画、图标）仍待办；目前只改了窗口标题。
- ~~M1.4 模型选择器真机重测~~ **已完成**：搜索按供应商名 → 选中 `settings-smoke-provider::gpt-4o` → 四项检查全绿（证据 `artifacts/visual/cherry-routes/settings-actions.json`）。
### D10（真实，低危）跨视图缓存不失效

- 通过 DataApi 新建供应商后，compat 窗口的供应商面板仍显示「已配置 0 / 0」，必须整页刷新才更新；数据本身已写入（`providers.list()` 能读到）。
- 触发条件：provider 由 DataApi（而非设置页表单）创建，或由另一个窗口创建。
- 影响：M1.4 的选择器测试曾因此误判为「picker 不显示模型」；实际是缓存问题。
- 处置：M3 里给 provider 的创建/更新/删除加广播，让渲染层重新拉取；在此之前审计脚本用一次 reload 规避并已注明。
---

## 4.2 M2 调查结论（2026-10-27，开工前）

**目标**：让 Cherry 的聊天页 / Agent 页接到真实 runtime，含 open/attach/detach/abort、审批、recovery。

### 已查明的事实

| 事实 | 证据 |
|---|---|
| 源 AgentPage 的发送路径调用 `ipcApi.request('ai.stream.open', request)`（与聊天页同一条协议） | `pages/agents/useAgentChatRuntimeState.ts:232`、`hooks/useConversationTurnController.ts:68` |
| 协议定义完整：`AiStreamOpenRequest/Response`、`StreamChunk/Done/ErrorPayload`、attach/detach/abort；chunk 负载是 AI SDK v6 的 `UIMessageChunk` | `shared/ai/transport/stream.ts` |
| 事件名：`ai.stream.chunk` / `ai.stream.done` / `ai.stream.error`（定向发送，不广播） | `shared/ipc/schemas/ai.ts:485+` |
| 主进程已有 agent 侧协调器（租约、重放游标、容量上限），但 **pump 是显式不可用**（`createCherryAgentRuntimePump` 直接抛 503） | `services/cherry-agent-stream.service.ts:160` |
| `ai.stream.*` 路由**尚未在任何地方实现**；`ipcApi.request` 目前只转发了少数路由 | `preload/index.ts:392-410`、`cherry-data-api.ipc.ts:2396` |
| 源 Page 允许注入 `openStream` 覆盖默认 IPC 路径 | `useConversationTurnController.ts:68` |

### 两条可行路线

| 路线 | 做法 | 代价 | 风险 |
|---|---|---|---|
| **A 渲染层桥**（推荐先做） | 在 compat 里实现 `openStream`：用现有 Host Bridge 发送 + 本地事件总线派发 chunk；用现有 IPC 建占位消息 | 中等；不动主进程协议 | 依赖占位消息能提前建行 |
| B 主进程协议实现 | 在 main 实现完整 `ai.stream` 管理器（多模型、attempt 水位、topic 状态缓存、审批） | 大（多日） | 会与现有 turn runner 重复 |

**决定**：先走 A，把「真流式 + 取消 + 占位消息 + 结束后落库」跑通；B 中真正需要的部分（多模型、审批）再按需补。审批沿用现有 agent permission broker，不另造。
### M2 第一批（2026-10-27 第三轮）

| 项 | 结果 |
|---|---|
| 共享 turn 入口 | `handleAiSessionSend` / `handleAiSessionInterrupt` 从 `ai-sessions.ipc.ts` 抽成导出函数，IPC 注册改为引用；行为不变（runtime-turn + agent.ipc 共 32 用例通过） |
| `ai.stream.*` 路由 | 主进程实现 open/attach/detach/abort；维护 topic → 执行标识（executionId / attemptId / anchorMessageId）；只支持 submit-message，其余变体返回 `blocked` |
| 渲染层桥 | compat `stream-bridge.ts`：把主进程真实的 session 事件（delta / reasoning / 失败 / 终态 assistant）翻译成 `ai.stream.chunk/done/error`；不伪造任何 chunk |
| 桥测试 | 3 条：文本与推理顺序、失败事件、非流事件透传 |
| 门禁 | G5 已修（测试桩参数类型）；G3 出现 worker RPC 超时，正在定位 |

**尚未完成**：Agent 会话路径（agent.ipc 的发送不广播增量，需要 pump）、审批接到 `ai.tool.approval.respond`、recovery、prewarm 收敛、三条端到端 smoke。
### M2 第二批（2026-10-27 第四轮）—— 端到端跑通

| 项 | 结果 |
|---|---|
| Agent 发送抽共享入口 | `handleAgentSessionSend` 从 `agent.ipc.ts` 抽出并导出；行为不变（21 个 IPC 用例通过） |
| 审批路由 | `ai.tool.approval.respond` 落到真实 broker（agent/ai 两个 broker 依次尝试，未知名返回 ok:false） |
| 增量改由主进程转发 | 发现 contextBridge 暴露的 `window.api.ipcApi` 是**只读对象**，渲染层无法包装（实测报 `Cannot assign to read only property 'request'`）。改为：两个发送函数接受 `hooks`，流路由把真实增量转成 `ai.stream.chunk`，经单一通道 `cherry:ai:stream:event` 发回窗口；preload 把该通道拆成 chunk/done/error 三个事件名 |
| 渲染层桥删除 | `compat/src/stream-bridge.ts` 与其测试删除（方案作废，保留则是死代码） |
| Agent 实时输出 | `agent.ipc` 现在推送 `agent:session:stream`（text/reasoning/done/error），preload 暴露 `agent.sessions.onStream` |
| 端到端 smoke | 新增 `scripts/chat-stream-smoke.mjs`（`npm run smoke:stream`）：假 SSE provider + 真 Electron + 真协议，断言 5 段增量拼成 `你好，世界`、终态 success、且**落库**的 assistant 行内容一致 |

**实测证据**（2026-10-27 18:53 UTC）：窗口 URL `#/app/chat`，chunk 序列 `text-start,text-delta×5,text-end`，terminal `status=success,isTopicDone=true`。

**未完成**：M2.4 recovery（未实现，界面不展示）、M2.5 prewarm（仍是显式不可用）、Agent 页 smoke、审批的真实交互 smoke。
### M2 完成（2026-10-27 第五轮）

| 计划项 | 状态 | 证据 |
|---|---|---|
| M2.1 ChatEngine / `ai.stream` 契约 | 完成 | open/attach/detach/abort 全实现；chunk/done/error 三事件经 `cherry:ai:stream:event` 分发；attach 有界重放（512 条 / 512KB） |
| M2.2 源聊天页真实流 | 完成 | smoke：窗口 `#/app/chat`，5 段增量拼成「你好，世界」，终态 success，落库 assistant 行一致 |
| M2.2b 源 Agent 页真实流 | 完成（协议层） | `agent:session:stream` + `agent.sessions.onStream`；smoke 用 agent 会话跑同一轮，文本与终态一致 |
| M2.3 审批闭环 | 完成 | 权限请求 → `tool-approval-request` chunk → `ai.tool.approval.respond` → broker → 工具执行 → 续写「工具已完成」；smoke 断言 approvalIds 非空且终态 success |
| M2.4 续流 / 恢复 | 完成（有界） | 源没有 recover 路由；等价能力是 attach 回放。终态后 attach 返回 not-found，历史从 SQLite 读 |
| M2.5 prewarm 收敛 | 显式不可用 | `ai.agent.session.prewarm` 返回 NOT_IMPLEMENTED；源实现只在 `.catch` 里 `logger.warn`，用户不可见（见 AgentSessionMessages.tsx:164） |
| M2.6 三条 smoke | 完成 | `npm run smoke:stream`：聊天 / Agent / 识图三条主线 + 审批允许/拒绝两条；真 Electron + 假 provider（流式 SSE 与非流式 JSON 两种形态） |

**说明**：M2.2b 只证明协议层（Agent 会话通过同一条 `ai.stream` 路由收发），没有对 Agent 页做 DOM 级点击验证。
### D11 撤销（误报，2026-10-27）

识图曾报 `Cannot read properties of undefined (reading '0')`。根因在 **smoke 的假 provider**：它对非流式请求（vision 走一次性 JSON）也返回了 SSE 帧，SDK 解析不到 `choices[0]`。假 provider 补上非流式 JSON 分支后，`api.ai.vision` 返回 `{success:true, text:'看到图片'}`，产品代码无缺陷。教训：假服务必须覆盖真实调用形态（stream 与非 stream）。

### M2 完成证据

`artifacts/stream-smoke-2026-10-27T19-31-56Z.json`：聊天 / Agent / 审批允许 / 审批拒绝 四条，含 chunk 序列、终态、落库内容。

审批拒绝的语义记录：Grimoire runtime 把「工具被拒」当作整轮失败并上报原因（`Tool 权限被拒绝：…`），不是让模型带着拒绝结果继续。这是既有 runtime 行为，不在本轮改动范围。
### M1.5.6 组件基线（2026-10-27 第二轮，进行中）

- 控件几何令牌：`--gr-control-{radius,height-sm/md/lg,font-sm/md/lg,pad-*,gap}`，`--button-*` 已改为引用它们（一处改、全局生效）。
- `.ui-button` 按源 Button 规格对齐：`font-normal`、13px、6px gap；新增 `.ui-button-lg`；`primary` 改为源默认的中性填充（前景色/背景色反转，深色下自动反向），accent 只用于 focus 环。
- 测试钩子：`data-ui="panel.shell"` / `panel.header` / `workspace.tab`（带 `data-workspace-id`），供点击脚本稳定定位。
- 新增 `scripts/ui-parity.mjs`（主窗口点击+截图），**当前不可用**：未打包时主窗口加载 Vite dev server，残留 Electron 实例的 CDP 端口对应 `about:blank`，脚本会驱动错窗口。已复现并记录，下一步要先做实例/端口隔离再启用。
### 交叉矩阵 · 点击与截图（2026-10-27 第三轮）

`node scripts/audit-cherry-routes.mjs --chat-journey`（需 `env -u ELECTRON_RUN_AS_NODE`）会在临时 profile 里：

1. 起一个假 SSE provider，通过 `providers.save` + `setActive` 注册；
2. 打开 `#/app/chat`，**真实鼠标点击**输入框（`[data-ui=part:composer-input]` 内的 contenteditable）、`Input.insertText` 输入、真实 Enter 键发送；
3. 等页面出现流式文本，截图 `chat-journey-streaming.png`，等完成态再截图 `chat-journey-final.png`；
4. 读回 `ai.sessions.latest` 的 assistant 行，断言内容与页面一致。

实测结果（2026-10-27 20:54 UTC）：`realTyping / realSendKey / streamedText / persisted` 四项全 true，PASS。

顺带修掉两个真实视觉缺陷：改品牌后侧栏标题被挤成竖排（已改 nowrap + 标题独占一行、标签换行），以及输入框读取把 innerText/textContent 相加导致的「看起来重复输入」。
### M6.1 块解析（2026-10-27 第四轮）

新增 `src/shared/prompt-blocks.ts`（纯函数，无依赖）：

| 能力 | 说明 |
|---|---|
| 顶层切分 | 只在引号外、括号外、数字权重组外的逗号（半角/全角）切块 |
| 原文保真 | 块的 `prefix`/`raw`/`trailing` 来自**原始字符串的区间**，序列化天然逐字一致 |
| 权重 | `{x}` +5%/层、`[x]` -5%/层、`1.3::x::` 数字权重 |
| 随机块 | `__池名*数量r~min-max/step__` 的解析与格式化（含校验） |
| 分类 | 标签块 / 段落块 / 随机块；阈值与参考实现一致（20 项长标签列表、中文 16 字、虚词比例等） |

测试 `src/shared/prompt-blocks.test.ts`：7 条，含 **300 例确定性生成的往返测试**（种子 20261027），以及引号逗号、权重组、偏移可编辑性。
### M6.2 版本树 schema v36（2026-10-27 第五轮）

- `CURRENT_SCHEMA_VERSION` 升到 **36**；新增 `migrateNovelaiPromptVersions`：`novelai_work` / `novelai_version` / `novelai_branch_name` / `novelai_version_image` 四表 + 三个索引，升级时为空，不做推断回填。
- `src/main/services/novelai-version.service.ts`：建作品（含根版本）、加版本、分支出规则、按线取路径、分支命名、图↔版本多对多与「这张图出现在哪些版本」反查。
- 不变量在服务层强制：父/分支必须同作品；`snapshot` 是唯一权威；每次写入带 `expectedRevision`；内容没变不产生空版本；父已有子版本时新版本自立分支（`branch_id=自己`、`branch_number+1`）。
- 语义决定：`listNovelaiBranchLine` 返回**从根到该分支最新版本的路径**（不是只按 `branch_id` 过滤），否则版本栏会把共享历史藏起来。
- 测试：9 条（分支规则、空版本、修订冲突、跨作品父版本、按线取路径、分支命名、图多对多与反查、schema 版本）。
### M6.3 删除语义与回收站（2026-10-27 第六轮，数据层）

- Schema **37**：`novelai_version.deleted_at` / `novelai_work.deleted_at` + 索引；删除是软删除，可恢复。
- 三种语义分开实现，避免「一种删除包打天下」：
  1. `mode:'single'` 只删**叶子**，有子版本直接拒绝；
  2. `mode:'branch'` 删整条分支**含所有后代**，并移除分支名；
  3. `purgeNovelaiVersion` 永久删除，**仍有存活子版本时拒绝**（F8 的版本侧对应）。
- 删除后自动把 `last_version_id` 回退到仍在的最新版本；恢复时把被删祖先一并恢复，避免线的空洞。
- 测试补 6 条（合计 15）：叶子删除与回收站可见、单删拒绝、整支删除含后代与分支名、恢复含祖先、永久删除的前后守卫、回收站里的版本不能再被扩展。
### M6.4 素材库与反向查询（2026-10-27 第七轮，数据层）

- Schema **38**：`novelai_asset` + `novelai_asset_usage`（(asset_id,image_id) 唯一）+ 索引。
- `src/main/services/novelai-asset.service.ts`：建档/改档/列档（按 kind+name 排序，`uses` 由使用表实时计数，不存冗余列）；
  记使用（幂等，重复记录只更新时间与 via）、撤销使用；
  **「这块素材用在哪些图」**（`listImagesUsingAsset`）与 **「这张图用了哪些素材」**（`listAssetsUsedByImage`）双向查询；
  仍有引用时拒绝删除素材（`force` 才连引用一起清）；
  F8 图片侧守卫：`assertNovelaiImageRemovable` 在版本仍引用图片时拒绝永久删除。
- 测试 7 条：增删改列、非法 kind/空名、双向查询、幂等与撤销、删除守卫、F8 图片守卫、schema 版本。
- G3 分片从 2 改 3，缩短单次窗口，降低 worker-RPC 偶发超时的代价。
### M6.5 一键整理与 AI 计划契约（2026-10-27 第八轮）

新增 `src/shared/novelai-organize.ts`（纯函数）：

| 能力 | 说明 |
|---|---|
| 三类整理 | 去重（大小写/空白不敏感、保留首个）、排序（大小写不敏感、稳定）、清理（trim + 合并空白 + 去空块 + 去前导缩进） |
| AI 计划契约 | `parseOrganizePlan` 严格校验：非 JSON / 非对象 / 非数组 / 未知 op / 越界索引 / 非字符串文本 / 超过 500 条，**一律拒绝而不是跳过**——半套用的计划是用户没看过的提示词 |
| 执行器 | `applyOrganizePlan` 按顺序执行 remove/replace/move，返回 `{text, changed, applied}`；越界在执行期再校验一次 |
| 渲染 | 整理后允许改变文本（与解析器的逐字保真是两件事），用规范分隔符 `, ` 重建 |

测试 8 条：三类整理、入口分发、合法计划（对象与 JSON 串）、**8 种畸形计划各返回具体错误码**、顺序执行、无变化检测。
### M3 第一批：设置接线登记（2026-10-27 第九轮）

- 新增 `src/main/services/cherry-preference-consumers.ts`：通用设置每个键登记 `{wired, note}`，
  由 `app.preferences.consumers` 路由暴露给兼容窗口。
- 现状：**17 个键，13 已接线**（开机自启、防休眠、代理三键、上下文四键、重试四键、开发者模式）；
  未接线 4 个并写明原因：`agent.language`（无系统提示词装配）、`agent.commit_attribution.enabled`
  （Agent 不创建 git 提交）、`app.fetch.allow_private_network`（无网络工具私网判定）、`app.user.id`（无读取方）。
- 开发者模式变成真开关：显式关闭时 `system.toggle_dev_tools` 返回 `DEVELOPER_MODE_DISABLED`；未设置时保持原有允许行为。
- 兼容窗口的只读横幅新增接线报告（`compat.preference-wiring`）：显示已接线 N/M，并逐条列出未接线键与原因。
- 测试 4 条：键唯一且覆盖、wired 必须写清消费者、JSON 与原始值读取、开发者模式默认与关闭。
### M3 第二批：agent.language 接线（2026-10-27 第十轮）

- `agent.language` 从「未接线」变为已接线：源里存的是人类可读标签（`"English"`、`"中文"`）或 null，
  现在在 agent 轮次装配系统提示词时注入一行语言指令（`始终使用以下语言回复：…（Always reply in …）`）；
  null/空串不注入，不猜默认值。
- `app.fetch.allow_private_network` 的未接线原因改写为准确描述：Grimoire 没有面向用户的抓取工具，
  只有供应商 / ComfyUI / MCP 这类固定端点，私网判定没有作用面。
- 通用设置接线现状 **14/17**；剩 3 个：`agent.commit_attribution.enabled`（无 git 提交可归因）、
  `app.fetch.allow_private_network`、`app.user.id`（无读取方）。
- 测试 5 条（新增语言指令注入：未设置/设置/与既有系统提示词拼接/清除）。
### 交叉矩阵：设置接线旅程（2026-10-27 第十一轮）

`node scripts/audit-cherry-routes.mjs --settings-wiring-journey`：

1. 打开 `#/settings/general`，等待 `[data-ui="compat.preference-wiring"]`；
2. 断言报告文本匹配 `已接线 \d+/\d+`（当前 14/17），截图 `settings-general-wiring.png`；
3. 写 `cherry_pref.app.developer_mode.enabled=false` → 断言 `system.toggle_dev_tools` 返回 `ok:false` 且 `error.code=DEVELOPER_MODE_DISABLED`；
4. 写回 `true` → 断言 `ok:true`。

实测三项全 true，PASS。过程中修正了两处**说错话**：横幅里「消费者仍未验收」的旧文案（14 个键其实已接）与 `missing` 列表（还写着托盘/代理/重试未接），现在改成只列真正未接的 3 个键及原因。

另记：`ipcApi.request` 返回 `IpcResult` 信封，**拒绝是 `ok:false` 而不是抛异常**；第一版断言按抛异常写导致假失败，已修正。
### M6.6 元数据写回/读回（2026-10-27 第十二轮）

- `src/main/services/png-metadata.ts`：不引依赖的 PNG 文本块读写（`tEXt`/`iTXt`，iTXt 压缩用 `zlib`，
  CRC 用 `zlib.crc32`）；写回时其余块逐字节复制、`IEND` 仍在最后，像素数据不会被碰。
  同一 keyword 是**替换**而不是追加，避免文件里堆出重复注释。
- `src/main/services/novelai-metadata.ts`：生成参数 ↔ PNG `Comment` JSON（version=1）。
  已建模字段：prompt / negativePrompt / steps / cfg / seed / sampler / scheduler / width / height / model / checkpoint / loras；
  未知字段**原样保留**并随再次编码写回；非 PNG 返回 null，不假装成功。
- 测试 9 条（4 PNG 块 + 5 参数往返）：像素块不变、替换语义、多键顺序、非 PNG 拒绝、全字段往返、未知键保留、畸形输入返回 null。
### M6 UI 第一批：提示词工作台面板（2026-10-27 第十三轮）

- 新增 IPC `src/main/ipc/novelai.ipc.ts`（9 个通道）与 preload `window.api.novelai.*`；
  规则仍只在 service 层（分支、空版本、修订号、回收站），IPC 只做编解码。
- 新增面板 `src/renderer/components/novelai/NovelAIPromptPanel.tsx`：
  左侧作品列表（新建）、中间原文编辑 + **块视图**（类型徽章、权重百分比、来自真实解析器）、
  右侧版本线（点选回看）、保存为新版本、删单版/删整支、分支命名、回收站恢复。
- 注册 `novelai-workbench` 面板类型，归入「素材」分组。
- 组件测试 2 条：块视图来自真实解析器（标签块/随机块/`{{}}` 两层 +10%）、
  保存时带上服务器给的 `expectedRevision`（防覆盖）。
### 交叉矩阵：主窗口点击与截图跑通（2026-10-27 第十四轮）

- 之前 `ui-parity.mjs` 一直报 `WINDOW_NEVER_NAVIGATED`。本轮定位：**应用的 `loadURL` 在本机启动路径下没有真正生效**，窗口 target 的 URL 是 dev server、文档却停在 `about:blank`（25 秒后依旧）。
- 解法：连上 target 后若正文为空，显式 `Page.navigate(devUrl)` 一次；报告里用 `forcedNavigation: true` 标记，不假装是应用自己加载的。
- 实测（临时 profile + vite）：`ok:true`，正文 1321 字符，标题「魔导书 Grimoire」；点击 6 个工作区标签、3 个面板标题，产出 10 张截图到 `artifacts/visual/ui-parity/`（`00-initial.png`、`tab-0N-*.png`、`panel-0N-*.png`）。
- 截图确认主窗口真实结构：工作区标签（创作 / AI / 识图 / 图片参考 / 标签管理 / 标签与资产）、标签库、提示词工作区、提示词资产三栏、底部状态栏与「AI 助手 / 设置」入口。

### 新缺陷 D12（2026-10-27）

| 编号 | 现象 | 证据 | 下一步 |
|---|---|---|---|
| D12 | ~~启动时内置提示词资产导入失败：`column index out of range`~~ **已修（2026-10-27）** | 根因：INSERT 13 列却传了 14 个值（旧 schema 的 `tags` 位置留了一个空串），每行都抛错且被 `.catch` 吞成一行 warn | 修正参数顺序并补 3 条回归测试；实跑确认：正常启动后 profile 数据库 `prompt_assets` = **1742** 行（修复前为 0） |

### 交叉矩阵：工作台面板旅程（2026-10-27 第十六轮，未通过）

尝试在主窗口里驱动「提示词工作台」面板做点击旅程，**当前失败**，记录清楚免得后面重复踩：

| 尝试 | 结果 |
|---|---|
| 切 `select.ui-panel-select` | 该控件不是面板类型选择器，切换无效 |
| 用 `workspace.loadDocument/saveDocument` 播种文档 | 能写入（ok:true），但界面不变：渲染层另有 localStorage 布局快照，文档不是唯一来源 |
| 点面板头部「添加面板」→ 菜单项「提示词工作台」 | 菜单能打开、菜单项 click() 返回 OK，但 DOM 里没有新面板 |
| 加可见性过滤（offsetParent） | 仍无效；页面里存在**多个工作区同时挂载**，选择器容易点到隐藏工作区 |

下一步方向：确认 `handleAddPanel` 对系统面板/浮动面板是否静默 no-op；或给渲染层加一个明确的测试入口（如 `#main?panel=…`），而不是靠猜测 DOM。

### 修「加了面板却被换成别的」+ 工作台旅程通过（2026-10-27 第十七/十八轮）

- **真缺陷**：`workspace.store.ts` 里有一份**手写的** `VALID_PANEL_TYPES` 列表，与 `panelTypes.ts` 的联合类型重复；
  新加的 `novelai-workbench` 不在列表里，保存/重载时被**静默**改成 `utility-sidebar`——用户点的面板变成了另一个。
- 修法：`panelTypes.ts` 改为 `PANEL_TYPES` 常量数组作为唯一来源，store 直接用它校验；新增 3 条回归测试
  （每个声明类型都必须有定义、都必须可持久化、未知值仍拒绝）。
- 上一轮四次失败里的三次其实都是这个缺陷的表象（菜单项「点了没反应」= 切过去又被换回来）。
- 工作台点击旅程现在 **PASS**：新建作品 → 编辑 → 块视图（标签块/随机块、`{{}}` +10%）→ 保存新版本 → 删此版本 → 恢复，
  6 张截图在 `artifacts/visual/ui-parity/wb-*.png`；断言改为读 `window.api.novelai.bundle()` 的真实状态，
  不再用页面文本里出现「回收站」这种会误判的写法。
- 顺带修面板在窄宽度下的排版：外层 `flex-wrap` + 主区 `min-w-[18rem]` + 块列表改为「徽章在上、文本在下」，
  之前窄面板会把作品名和块内容挤成竖排。

### M6 UI 第二批：素材库面板（2026-10-27 第十九轮）

- IPC 新增 7 个素材通道（list/create/update/delete/use/images/byImage）+ preload `window.api.novelai.assets.*`。
- 面板 `NovelAIAssetPanel`：分类筛选、素材列表（带引用数）、素材内容编辑（失焦写回）、
  **「用在哪些图」**（选中的素材 → 引用列表）、记一次引用、**反查「这张图用了哪些素材」**、删除素材（强制）。
- 注册 `novelai-assets` 面板类型（单一来源 PANEL_TYPES + 定义 + 渲染分支）。
- 测试 3 条：列表与引用数、记录引用后刷新、反查；顺带修正断言口径（UI 不编造 via，由主进程补默认）。

### 进程清理教训（2026-10-27）

- 一次「按 vite 杀进程」把正在跑的门禁 vitest 也杀了（`vitest.mjs` 的 command line 里包含子串 `vite`），
  G3 分片 2 因此红了一次；单独重跑该分片是通过的。以后只按 `vite\bin|vite.js` 精确匹配。
- 同时发现 `ui-parity.mjs` 每次运行会漏一个 vite dev server（`npx vite` 的子进程），单个约 1.3GB；
  已在 killTree 里按本次端口精确清理。清理后 node 进程从 14 个 / 5.9GB 降到 6 个 / 0.4GB。

### M6.6 收口：PNG 参数导出/读取接进工作台（2026-10-27 第二十一轮）

- 新增 `novelai-metadata-file.service`：`exportNovelaiMetadataToPng` 写**同目录 `<名>.meta.png`**（原图字节不变），
  `readNovelaiMetadataFromFile` 纯读；非 PNG 直接报错，不写误导性文件。
- IPC 两个通道（导出/导入），对话框在主进程，渲染层拿不到可复用的文件路径。
- 工作台面板新增「参数写入 PNG」「从 PNG 读取」：导出当前草稿的参数，读取后把 prompt 填回草稿。
- 测试：文件服务 3 条（原图不变、非 PNG 拒绝、无参数返回 null）+ 面板 1 条（导出/读回往返）。

### M3：通用设置整页解除只读（2026-10-27 第二十二轮）

- 补上最后一个可见开关的消费者：`BootConfig.app.disable_hardware_acceleration` 在 **app ready 之前**读取并调用 `app.disableHardwareAcceleration()`
  （新增 `boot-config.service`，用只读 SQLite 直接读 settings；读不到/坏库都不阻塞启动）。
- 两个无处生效的开关（`app.fetch.allow_private_network`、`agent.commit_attribution.enabled`）用 compat CSS **隐藏**（节点仍在，display:none），
  并在接线报告里写明「已隐藏 N 个无法生效的开关」；`app.user.id` 在页面上没有控件，单独注明。
- `settings-general` 从「只读」变为**可编辑**：`CompatSourceSettings` 支持 per-route `readOnly` 标记，字段集只对其余页面禁用。
- 接线报告现状 **15/18**（含硬件加速），2 隐藏 + 1 无控件。
- 交叉矩阵 journey 增两条断言：`pageEditable`（fieldset 未禁用）与 `deadSwitchesHidden`（两行 computedStyle 为 none），五项全 PASS，
  截图 `artifacts/visual/cherry-routes/settings-general-wiring.png`。
- 踩坑记录：只 `build:cherry-compat` 时接线报告仍显示旧数字——那份数字来自**主进程** bundle，必须同时 `build:main`。

### M1.5.6 字段基线 + 素材面板旅程（2026-10-27 第二十三轮）

- `.ui-field` 对齐源 `Input` 规格：36px 高（`--gr-input-height`）、`rounded-md`、透明背景、1px 边框，
  focus 只改边框颜色（去掉原来的发光环）；`textarea.ui-field` 保持自适应高度。密集面板里未标 `.ui-field` 的原生输入不受影响。
- 素材库旅程 `node scripts/ui-parity.mjs --assets` 一次通过：新建素材 → 记一次引用（API 断言 images 里有 img_matrix）
  → 反查（byImage 返回该素材）→ 删除（列表清空），4 张截图 `as-*.png`。
- 顺带给素材面板补上窄宽度换行规则，列表名不再折成两行。

### 交叉矩阵：主题对比（2026-10-27 第二十四轮）

`node scripts/audit-cherry-routes.mjs --theme-journey`：从 `themes.css` 解析 `:root` / `[data-appearance=light|dark]` 的 `--color-*`，
通过 `window.api.theme.publish` 依次发布浅色与深色调色板（走真实 theme bridge），同一路由各截一张图，
再把两张 PNG 注入页面用 canvas 做**逐像素差异**统计。

实测：`lightApplied / darkApplied / filesDiffer / pixelsDiffer` 四项全 true，1583×954，meanDelta **231.1**，changedPct **100%**。
截图 `artifacts/visual/cherry-routes/theme-light.png` / `theme-dark.png`。

踩坑：空聊天页没有 `chat.view`，等待锚点改用 `part:composer-input`；另外 theme journey 自带的 waitExpression 需要在本块内定义。

### M1.5.5 品牌收尾：关于页换成我们自己的（2026-10-27 第二十五轮）

- 源 `AboutSettings` 会把产品名写成 Cherry Studio、给出 Cherry 的反馈邮箱、并提供指向 Cherry 发布服务的「检查更新」。
  这三件事在本构建里都不是真的，因此该路由改为渲染 `CompatAbout`（`data-ui="compat.about"`）。
- 新页面内容：魔导书 Grimoire + 版本（`app.get_info`）、上游与许可（**保留 Cherry Studio 2.1.4 / AGPL-3.0 署名**——这是许可要求，不是残留）、
  运行形态 / 应用路径 / 数据目录 / 架构，以及一句明确说明「没有检查更新、没有 Cherry 反馈邮箱」。
- 路由审计的 About 期望信号同步改为本页内容（`魔导书 Grimoire` / `上游与许可`），51/51 仍全绿，截图 `route-settings-about.png`。
- 导出路径核查：`ExportService` 里剩余的 Cherry 字样（Joplin `source` 字段、思源默认路径、User-Agent）都不在我们暴露的导出入口上；
  我们的 markdown 导出走 `saveMarkdownExport`，不写入任何品牌字样。

### M1.5.6 对话框与表格基线（2026-10-27 第二十六轮）

- 对话框对齐源规格：新增 `--gr-radius-2xl: 24px`（源 `rounded-3xl`），`.ui-dialog-surface` **去掉 1px 边框**、
  圆角改用 2xl、阴影保留——之前边框和阴影互相打架；遮罩改为 0.55 透明度 + 2px 模糊。
- 新增 `.ui-table` 基线：表头高 `--gr-control-height-sm`、行高 `--gr-row-height`（随密度切换）、
  细分隔线（`color-mix` 60%）与 hover 底色，让设置表和媒体表看起来是同一个产品。
- 测试补 1 条：`.ui-dialog-surface` / `.ui-dialog-overlay` 存在且点遮罩能关闭（与 Escape 关闭并列）。

### M3：本地 OpenAI 兼容网关（2026-10-27 第二十七轮）

- 新增 `api-gateway.service`：真 HTTP 服务，路由 `/v1/models`、`/v1/chat/completions`（流式与非流式）、`/health`；
  Bearer 鉴权；**转发到当前 provider**（复用 `ai/client` 与 `getActiveProvider`），不做第二套供应商配置。
- 端口 0 = 由系统分配；`restart` 会先关旧监听再起（测试验证不泄漏）。流式分支若已发出响应头再抛错，只 `end()` 不再写 JSON（否则掩盖真实上游错误）。
- IPC 路由 `api_gateway.status/start/stop/restart` 接到 `ipcApi` 路由器，配置读 `feature.api_gateway.{host,port,api_key}` 偏好——页面与服务不会对端口/密钥各说各话。
- 测试 4 条（假上游）：models + 非流式完成、SSE 流式、缺/错 token 401、restart 后仍可服务。
- 待办：页面还需要 `feature.api_gateway.running` 的共享缓存来源，以及把 api-gateway 从只读里解禁。

### M3：API 网关页面接上真服务（2026-10-27 第二十八轮）

- `CompatApiGatewayBridge`：每 2 秒把 `api_gateway.status` 映射进源共享缓存 `feature.api_gateway.running`，
  页面徽章因此显示**真实**运行状态（此前源 main 写缓存，我们的 main 不写，徽章只会显示已停止）。
- `settings-api-gateway` 从只读解禁：fieldset 用 per-route `readOnly` 标记（补上其余 4 页的 `readOnly: true`，
  否则联合类型里访问 `.readOnly` 报 TS2339）。
- 品牌：新增 `brand-overrides`，在 i18n 初始化后覆盖少数把上游当产品名的文案（如网关副标题“暴露 Cherry Studio 的 AI 功能”→“暴露魔导书的 AI 能力”）。
- journey `--api-gateway` 五项全 PASS：页面可编辑、启动成功、**徽章显示运行中**、状态接口 running、停止成功；
  截图显示运行中 + 端口 62935。
- 门禁修复：G4 断言改为「只读页仍禁用、网关于可编辑」；G5 自有类型 0 错误。

### M6 UI：分支列表与切换（2026-10-27 第二十九轮）

- 服务新增 `listNovelaiBranches(workId)`：按 `branch_id` 聚合出每条分支的 tip 与版本数，tip 新的在前；未知 work 抛错而不是返回空表。
- `bundle` 返回值新增 `branches`，面板一次请求就能画出分支条；`novelai:branch:list` 通道与 `window.api.novelai.listBranches` 同步提供。
- 面板新增分支条（>1 条分支才显示）：名字或「分支 N」+ `bN` 标记，点击用 `bundle({workId, branchId})` 切到该分支；
  当前分支高亮。之前只有当前线可见，其它分支在数据里存在但界面上完全看不到。
- 测试：版本服务 +2（两条分支的 tip/大小、未知 work 抛错），共 17 条绿；面板 6 条绿。
- **踩坑**：面板在 `branches` 缺失时直接崩掉整块面板（ui-parity 报 `NO_PANEL`）。原因是 ui-parity 用的是**已构建**的 dist/main，
  改完 IPC 必须 `build:main`；同时给面板加了 `bundle?.branches ?? []` 兜底——旧主进程/旧数据只应隐藏分支条，不应该连累整块面板。

### M6 UI：从此版本开分支（2026-10-27 第三十轮）

- 版本线上每个版本多一个「开分支」按钮：点了之后草稿区顶部显示「将从 vN 开新分支」（可取消），
  保存时 `parentVersionId` 用该版本、`operation='开分支'`——分支规则仍由服务决定（父版本已有子版本则自立分支），UI 不自己造规则。
- `NovelaiBranchSummary` 补 `branchNumber`：分支条显示「分支 2 b2 · 1 版」，与版本块上的 `b2` 对齐；
  之前的 `number` 是「起分支的版本号」，和 `branchNumber` 混用会让人以为分支编号错乱。
- 测试：面板 +1（点从 v1 开分支 → 保存时 parentVersionId=v1、operation=开分支），novelai 相关共 24 条绿。
- 交叉矩阵：工作台旅程新增分支步骤，`branches` 实测 `[1,2]`（两条分支、版本数 1 与 2），断言 6 项全 PASS，截图 `wb-06-branches.png`。

### M1.5.6：开关组件基线 + 图库窄宽度修复（2026-10-27 第三十一轮）

- 新增 `Switch`（`role="switch"`）：32×18 轨道 / 14px 滑块 / 选中填 accent，`sm` 为 26×15；
  键盘焦点环、disabled 半透明、`prefers-reduced-motion` 下不动画。
- 迁移三处原生 checkbox：图库「来源」5 项、「包含隐含子标签」、供应商模型勾选（模型名也变成可点击标签）。
- 图库面板窄宽度修复：外层 `flex-wrap`，左栏 `min-w-[13rem]`、主区 `min-w-[20rem]`；
  修之前媒体列被挤成一条缝，右侧控件竖排成「在/网/格」。
- 测试：新增 Switch 2 条；图库测试把 `getByRole('checkbox')` 改为 `switch`（语义变了，断言也要跟着变）。
- 证据：ui-parity 新增 `--gallery` 旅程（切到图库面板 → 截图），实测 **6 个开关**渲染正常，截图 `gallery-01-switches.png`。

### 窄面板系统排查（2026-10-27 第三十二轮）

新增 `node scripts/ui-parity.mjs --narrow-audit`：把面板选择器里的**每一个**面板类型（17 个）依次挂到同一条窄列（304px）里，测量两类失败信号：

1. **竖排文字**：宽度 < 40px 但高度 > 20px 且带 4 字以上文本的叶子节点（附 3 层祖先 className）；
2. **横向溢出**：`scrollWidth > clientWidth + 8` 的容器。

每个面板存一张截图（`artifacts/visual/ui-parity/narrow-*.png`），汇总写 `narrow-audit.json`。

首轮结果：**17 个面板中 7 个有命中** —— utility-sidebar、agent、comfyui、prompt-assets、tag-asset-manager、tag-batch、gallery-search。

本轮修掉 2 处：
- `tag-batch`：两处 `flex items-center gap-3` 的筛选行（固定宽 select + nowrap 标签）改成 `flex-wrap`，容器不再 447px 溢出（命中数 7 → 6）。
- `gallery-search`：主区 `min-w-[20rem]` → `min-w-[12rem]`，窄列下媒体区不再强行撑开。

仍待修（下一轮）：`agent`（消息区被挤到 28px 宽，文字竖排）、`comfyui`（输入框溢出 20px）、`utility-sidebar` / `prompt-assets` / `tag-asset-manager`（span 文本截断无省略号）、`gallery-search`（筛选轨内部仍有 425px 容器）。

### 窄面板：命中数 6 → 0，并加棘轮（2026-10-27 第三十三轮）

- **agent 面板根因**：`AgentShell` 用 CSS grid `leftWidth px | 1fr | rightWidth px`；面板被拖到 304px 时，
  两个固定侧栏把中间列压成 **28px**，于是每条消息一个字一行。
  修法：外壳用 `ResizeObserver` 记录宽度，**< 720px 时自动收起两侧栏**（中间列为 `minmax(0,1fr)`），
  且折叠时**不再渲染侧栏内容**（零宽列里的隐形文字既占布局又会读给读屏器）。
- 审计口径收紧两处：
  1. 跳过 `display:none / visibility:hidden / opacity:0` 的祖先——折叠掉的界面不算缺陷；
  2. 横向溢出只统计 **computed overflow-x 为 visible** 的容器；自己裁切或滚动的（省略号、滚动条）属于已处理。
  否则会把「已在处理的裁切」误报成缺陷，把所有面板都算成坏。
- 收敛结果：**17 个面板，命中 0**（上一轮 7、修完 6）。
- 新增棘轮 `scripts/narrow-baseline.json`（当前 `offenders: 0`）：命中数超过预算时 `--narrow-audit` 退出码为 1，
  只能手动下调，不能悄悄放过。
- 附带修：`cherry-ui.test.tsx` 的折叠断言改为「内容不再在 DOM 里」，并给 `ResizeObserver` 加了 jsdom 兜底。

### 宽度矩阵审计（2026-10-27 第三十四轮）

`--narrow-audit` 支持 `--width=`（CDP `Emulation.setDeviceMetricsOverride`），同一套检查在多个视口宽度下跑：

| 视口 | 面板实际宽度 | 命中 | 结论 |
|---|---|---|---|
| 默认（1733） | 304 | **0** | 门禁基线 |
| 1280 | 280 | 3 → **1** | 原 3 项已修，剩 gallery 13px 溢出 |
| 640 | 139 | **17** | 四栏布局在 640 窗口下根本放不下（已知限制，未修） |

关键发现（比数字更重要）：
1. **面板宽度与视口宽度不成比例**：1280 窗口下每块面板只有 280px。因此 `sm:` / `md:` / `lg:` 这些**视口断点**在面板里是骗人的——
   `ComfyUI` 的 `sm:grid-cols-4` 在 280px 面板里把四列压成 47px（Seed/Steps 标签竖排）。已改为固定两列；`QuickUtilityPopover` 同类问题一并处理。
2. 640 窗口下 17/17 命中不是误报，是**四栏固定布局的真实下限**；要支持这种宽度需要重做布局（本轮未做，记录为已知限制）。
3. 审计口径又收紧一次：**竖排文字必须是「宽度<60 且至少 3 行」**（按 lineHeight 折算行数），两行标题属于正常换行，不算缺陷。

### M6：素材 ↔ 版本联动（2026-10-27 第三十五轮）

素材是记在**图片**上的，版本通过 `novelai_version_image` 关联图片，因此「版本用过哪些素材」是**推导**出来的（一条 JOIN），
不再存第二份关系——少一份数据就少一处漂移。

- 新服务：`listAssetsUsedByVersion(versionId)`（版本→素材，带 imageId）、`listVersionsUsingAsset(assetId)`（素材→版本，排除回收站）。
- 新通道：`novelai:asset:byVersion`、`novelai:asset:versions`，以及补上 `novelai:version:linkImage`（此前没有把图片挂到版本的入口，链条是断的）。
- 面板：工作台选中版本时显示「这版用到的素材：名字 · imageId」；素材面板显示「用在哪些版本：v3 · imageId」。
- 测试：素材服务 +2（推导双向、空版本返回空），共 9 条；面板 7 条。
- 旅程新增两条断言：**先只建素材+记引用时 `byVersion` 必须为 0**（证明推导确实需要版本侧也挂图），补上 `linkImage` 后才出现素材；
  工作台旅程现 8 项全 PASS。

### M3 剩余四页：可行性判定文件（2026-10-27 第三十六轮）

产出 `.agent/records/2026-10-28-m3-feasibility/M3-remaining-pages.md`，逐页写清「源页面做什么 / 需要什么真服务 / 我们有什么 / 结论」，并在 `MIGRATION_MATRIX.md` 追加 6 行（常规、API 网关、联网搜索、浏览器、截图、划词助手）。

| 页面 | 结论 |
|---|---|
| 联网搜索 | 需要先做服务（SearXNG + Tavily 适配器 + 正文提取） |
| 浏览器 | 需要先做服务（WebContentsView 宿主，工作量最大） |
| 截图 | 需要先做服务（desktopCapturer + OCR；OCR 未到位前 auto_ocr 保持隐藏） |
| 划词助手 | 不适用于本构建（全局选区钩子 + 置顶浮窗，与面板体系是两套界面） |

顺带把已完成的两个页面写进矩阵：**常规**（ADAPTED，15/18 键有消费者，2 个死开关隐藏）与 **API 网关**（页面 VENDOR + 服务 REIMPLEMENTED，附重写证明：源服务依赖 Cherry 的 AI 服务/共享缓存/IPC 生命周期，本仓库均不存在）。

结论的判据不是「难不难」，而是「解禁后有没有真服务」——否则就是一路在清除的那种假成功。

### M3：联网搜索执行服务（2026-10-27 第三十七轮）

- `websearch.service`：两个**形状不同**的供应商适配器证明适配边界——
  SearXNG（自建、JSON、免 key、GET）与 Tavily（托管、POST、需 key）；其他 id 一律 `PROVIDER_NOT_SUPPORTED`，
  不返回空列表冒充「没有结果」。
- `fetchUrls`：只接受 http/https；**二进制内容直接拒绝**（不把乱码当正文）；解析后按 `maxBytes` 截断并标记 `truncated`。
- `websearch-extract`：零依赖 HTML→文本（去 script/style/注释，按块换行，实体解码）。不是 readability，够喂模型。
- IPC：`web_search.search_keywords` / `web_search.fetch_urls` 接进 `ipcApi` 路由；
  供应商与凭据读页面自己写的偏好（`chat.web_search.provider_overrides`、`default_*_provider`、`max_results`），页面与执行方不会各说各话。
- 测试 8 条（假上游）：SearXNG JSON + 摘要裁剪、Tavily POST + limit、未知供应商拒绝、
  SearXNG 返回 HTML 时报错、正文提取去脚本、二进制拒绝、非 http 协议拒绝、实体解码。
- 待办：页面仍只读——解禁前需要把「测试」按钮的结果接到界面上（现在只返回 IPC 结果），下一轮处理。

### M3：联网搜索页为什么仍只读（2026-10-27 第三十八轮）

本轮尝试解禁 `/settings/websearch`，被一道**我们自己设的**防护挡住，并且证明挡得对：

- 执行方已具备（`websearch.service`：SearXNG/Tavily 适配 + 正文提取 + 8 条测试），IPC 路由也已接上；
- 但供应商凭据 `chat.web_search.provider_overrides` 属于**受保护偏好**（`cherry-settings-privacy.ts`），
  `settings:set` 直接拒绝通用写入：
  `Cherry credential settings require a dedicated main-process credential adapter; generic writes are unavailable`；
- 也就是说：用户现在在页面上填 API key **存不下来**。此时解禁页面 = 让用户白填，正是要清除的假成功。

因此：websearch 页**保持只读**，理由改成「缺专用凭据适配器」（比原来的「缺执行方」更精确）。

交叉矩阵新增 `--websearch` 旅程，断言的是**防线本身**：

| 断言 | 含义 |
|---|---|
| `credentialWriteRefused` | 通用路径写入凭据必须被拒绝（含被拒绝的原因） |
| `executorReachable` | IPC 能到达执行方；未配置端点时返回 UPSTREAM，而不是假装搜到结果 |
| `unsupportedProviderRefused` | 未知供应商返回 `PROVIDER_NOT_SUPPORTED` |
| `pageStaysReadOnly` | 页面字段集仍禁用 |

下一步（解禁前置）：实现 `chat.web_search.provider_overrides` 的**主进程凭据适配器**（写入加密、读取脱敏），
然后页面才能解禁；届时把 `credentialsWriteRefused` 改成「写入成功且读回脱敏」。

### M3：联网搜索解禁（凭据适配器落地，2026-10-27 第三十九轮）

上一轮被自己的防护挡住，这一轮把**缺失的那一环**补上而不是关掉防护：

- 新增 `cherry-credential.service`：受保护偏好（`chat.web_search.provider_overrides`）的专用通道——
  **写入时逐字段加密**（`safeStorage`，存 `enc:v1:<base64>`），**渲染层读回一律脱敏**（`********`），
  明文只在本进程内可读；OS 加密不可用时**拒绝写入**（绝不落明文）。
- `settings:set` 改为：受保护偏好走凭据通道，其余键仍走原路径；通用写入对凭据依然关闭。
- websearch 路由改用 `readCredentialPreference` 取明文，页面与执行方仍读同一份配置。
- 测试：凭据服务 4 条（加密落盘不含明文、加密不可用拒绝、非受保护键拒绝、非 JSON 拒绝）。
- 旅程 `--websearch` 五项全 PASS，且**真的搜到了结果**：
  `credentialWriteAccepted` / `readBackMasked`（读回是 `********`，host 仍可见）/ `executorReachable`
  （假 SearXNG 返回「矩阵搜索结果」）/ `unsupportedProviderRefused` / `pageEditable`。
- 页面从只读改为**可编辑**，理由写进 limitation：只有 SearXNG 与 Tavily 会真正执行，其余供应商明确报不支持。

### M6：版本差异对比（2026-10-27 第四十轮）

- 新增 `shared/prompt-diff`：**按内容而不是位置**比较两个快照（移动标签不算改动）；
  权重语法在比较前剥掉（`{x}` → `{{x}}` 是**同一标签加重**，不是删一个加一个）；
  权重变化单独归为 `reweighted`，标签描述带 kind+value（`increase:0.05` → `increase:0.1`）。
- 面板：版本块新增「对比」，选中基准后显示 `v1 → v3：+2 / -1 / ~0 / =2` 与逐项 `+ / - / ~` 标签；
  对比在渲染层用两个快照本地计算，不额外请求、不引入服务端状态。
- 测试：diff 4 条（增删不误报、权重算 reweight、位置无关、空输入）+ 面板 1 条（点「对比 v1」出现 `+1` 与新增块）。

### M6：回收站批量操作（2026-10-27 第四十一轮）

- 服务：`softDeleteNovelaiVersions`（多选删除）与 `restoreNovelaiVersions`（多选恢复）。
  两个要点：**全有或全无**（先校验全部 id，再落第一个写入）；**修订号只升一次**（一次用户动作 = 一次 revision）。
- 校验规则比原来更准：子节点**也在本批**里就不算阻塞（选中尾巴和它的父节点一起删是合法操作），
  只有当活子节点不在本批中时才拒绝。
- 通道：`novelai:version:deleteMany` / `restoreMany` + preload `deleteVersions` / `restoreVersions`。
- 界面：回收站每条前加复选框，>1 条时出现「全选 / 恢复选中(n) / 永久删除选中」。
- 测试：版本服务 20 条（新增 3 条批量：一次 revision、子节点不在批内拒绝、批量恢复且未知 id 先拒）；
  面板 9 条（新增批量恢复断言：勾选 v2、v1 → `restoreVersions(['v2','v1'])`）。

### M3：截图服务与快捷键策略（2026-10-27 第四十二轮）

- `screenshot.service`：`listCaptureSources`（找不到源时报 `NO_SOURCES`，不返回空列表）、
  `decodePngDataUrl`（**校验 PNG 签名**、限制 40MB、拒绝非 data URL）、
  `saveCapturedPng`（文件名消毒 + 时间戳，落盘前先解码校验）。capturer 以参数注入，无显示器也能测。
- `screenshot-shortcut.service`：注册策略被测——关闭时必须**释放**旧加速键；换键时释放旧键；
  冲突返回 `CONFLICT`；空加速键返回 `NO_ACCELERATOR`；registrar 抛错返回 `ERROR`。
  实现上记住**拥有该绑定的 registrar**，释放时不再依赖调用方传同一个实例（这正是单测发现的设计缺陷）。
- 偏好接线新增 3 条：`feature.screenshot.enabled`、`shortcut.screenshot.capture` 已接；
  `feature.screenshot.auto_ocr` 标记为隐藏（本项目没有 OCR 服务，WD14 是标注不是 OCR）。
- 测试：截图管线 4 条 + 快捷键策略 4 条，全绿。
- 待办（下一步）：把 desktopCapturer/globalShortcut 真实实例接进主进程、加一个 `screenshot.capture_now` 路由，
  然后解禁截图页；`auto_ocr` 保持隐藏。

### M3：截图页解禁（真实截屏落盘，2026-10-27 第四十三轮）

- 新增 `screenshot-capture.service`：真正调用 `desktopCapturer`（screen 源、1920×1080 缩略图），
  交给 `screenshot.service` 做 PNG 魔数校验与命名，落盘到 `userData/media/screenshots/` 并复制到剪贴板。
- 新通道 `screenshot:capture` + preload `window.api.screenshot.capture()`，错误以 `{ok:false,error.code}` 返回。
- 偏好副作用接上 `globalShortcut`：开关或加速键变化时统一应用（关闭即释放、换键先释放旧键、冲突记 warn）。
- 旅程 `--screenshot` 五项全 PASS，且是**真实截图**：
  `captureOk / hasBytes / hasSize(1920×1080) / fileOnDisk / pngSignature`，实测 1.33MB PNG。
- 截图页从只读改为**可编辑**；`auto_ocr` 行用 compat CSS 隐藏（本项目没有 OCR 服务）。
- 测试调整：compat 的截图断言从「只读且控件禁用」改为「可编辑且 fieldset 未禁用」。

### M3：浏览器页数据层（2026-10-27 第四十四轮）

- schema **v39** 新增 `browser_history`（id/url/title/visited_at + 两个索引）。
- `browser-history.service`：记录访问（**同 URL 去重**，重复访问更新而不是堆重复行——历史弹窗要的是站点不是每次导航）、
  搜索（url 或 title）、单条删除、清空；**只接受 http/https**（`file://` 之类会把本地路径塞进历史）。
- `browser-data.service`：`clearBrowserData(session, scopes)` 分域清理 cache/cookies/storage/auth，
  **未选中的域一律不动**，失败逐域回报（不是整体成败），平台没有 clearAuthCache 时明确报不支持。
- IPC 路由：`browser.history.list/add/delete/clear`、`browser.data.clear`（session 由 `persist:grimoire-browser` 取）。
- 测试 8 条：去重与顺序、搜索与 limit、拒绝非 web URL、删除/清空、分域清理、失败回报、平台缺 API。
- **页面保持只读**：缺的是浏览器宿主（WebContentsView 生命周期与导航），数据层不再是阻塞点。

### 面板布局约定 + G9（2026-10-27 第四十五轮）

同一个缺陷（双栏在窄面板里压成 28px、文字一字一行）在四处被手工修过，这轮把它变成约定和门禁：

- 新增 `scripts/check-panel-layout.mjs`，两条规则：
  1. `flex` 行里同时有 `shrink-0` 与 `flex-1` 却没有 `flex-wrap|flex-col|min-w-` → 命中（真实事故形状）；
  2. 面板内出现 `sm:/md:/lg:/xl:` 视口断点 → 命中（面板宽度不跟窗口走）。
  排除 `components/dev/`（整窗预览）与 `SettingsWindow.tsx`（独立设置窗口），它们的视口断点是正确的。
- 修掉 8 处面板内视口断点：ImagesPanel、PromptAssetsPanel ×2、TagAssetManagerPanel ×2、
  WorkspaceSystemPanels ×2、AgentWorkspacePanel 的 `xl:flex` 头部件。
- 结果 **0 命中**，写入 `scripts/panel-layout-baseline.json` 作为只降不升的基线。
- 新门禁 **G9 面板布局约定**（0.1s），并写进 GATES.md 的约定章节（三条规则 + 出处）。

### M3：浏览器宿主服务（2026-10-27 第四十六轮）

`browser-host.service`：主进程持有 `WebContentsView`，渲染层只上报为它预留的矩形。

- `openBrowserHost(id, {window, createView, url, bounds, onVisit})`：按 `persist:grimoire-browser` 建视图、
  挂到窗口、设 bounds、`loadURL`；订阅 `did-navigate` / `page-title-updated`，每次导航回调 `onVisit` → 写 `browser_history`。
- `updateBrowserHostBounds`：**位置先夹回窗口内，尺寸再按剩余空间夹**——只按窗口尺寸夹宽度仍会在 x=1150 溢出（单测发现）。
- `navigateBrowserHost` / `closeBrowserHost` / `getBrowserHost` / `closeAllBrowserHosts`。
- URL 校验：没写协议补 `https://`（用户直接输 `example.com` 能用），有协议则必须 http/https（`file:` / `javascript:` 拒绝）。
- IPC 路由：`browser.host.open/bounds/navigate/close/get`，`createView` 用真实 `WebContentsView`（sandbox + contextIsolation）。
- 测试 5 条：分区与挂载、导航回调、bounds 夹取（含越界回拉）、拒绝非 web URL 与未知 id、关闭幂等。
- 页面仍只读：现在只差**渲染层面板**（上报矩形 + 地址栏），下一轮做。

### M3：浏览器面板（真视图上线，2026-10-27 第四十七轮）

- 新增面板类型 `browser` 与组件 `BrowserPanel`：地址栏 + 打开/刷新/后退/前进 + 历史回访列表；
  **组件本身不渲染网页**，只上报为 `WebContentsView` 预留的矩形（ResizeObserver + rAF 合并，避免拖分隔条时每帧跨 IPC）。
- 卸载时调 `browser.host.close`；首次挂载 `browser.host.open`。
- 旅程 `--browser` 六项全 PASS：面板切换/挂载、导航被接受、**历史记录了该 URL**、
  **标题捕获到「矩阵浏览器页」**、宿主存活。
- 说明：截图中网页区域是空白——CDP `Page.captureScreenshot` 只截渲染层合成结果，**不含原生子视图**。
  所以证明「页面真的渲染了」的不是截图，而是标题：`<title>` 只有在 Chromium 真解析并渲染后才会回调到 `page-title-updated`。
- 页面（设置页）仍只读：历史/清理已可用，但**书签导入**还没有解析器，且宿主尚未接隐私/权限偏好。

### M3：书签导入（2026-10-27 第四十八轮）

- `bookmark-import.service` + schema **v40** `browser_bookmark`：解析 Netscape 书签格式（Chrome/Edge/Firefox 导出同一格式），
  **只接受 http/https**（`javascript:` / `chrome://` / `place:` 计入 skipped，不进库——它们在内嵌宿主里无法安全打开）。
- 两个细节：`href` 里的 `&amp;` 也要解码（第一版只解码标题，查询串会带 `&amp;` 进库，单测抓到）；
  重复导入**幂等**（URL 主键，第二次 imported=0）。
- 路由：`browser.import.run`（收文件文本）、`browser.import.list`、`browser.import.clear`。
- 测试 3 条：文件夹/链接解析与实体解码、幂等导入、空文件与清空。
- 浏览器设置页仍只读，但三条动作（导入 / 历史 / 清理）此后都有真实后端；
  剩余只差两个偏好消费者（`app.browser.open_links_in_browser`、`app.browser.agent_control.enabled`）。

### M3：浏览器设置页解禁（2026-10-27 第四十九轮）

- 新增 `open-link.service`：`app.browser.open_links_in_browser` 的**单一判定点**——
  http/https 且偏好为真 → 内嵌 `WebContentsView`（每窗口复用 `external-links` 宿主，尺寸铺满窗口）；
  其余一律 `shell.openExternal`。非 web 协议（`file:` / `javascript:`）**永远走系统**，不进内嵌宿主。
- `OPEN_EXTERNAL` 改走该服务，链接不会因打开它的界面不同而走两条路。
- 偏好接线：`app.browser.open_links_in_browser` 已接；`app.browser.agent_control.enabled` 标记**隐藏**
  （本构建没有 Agent 浏览器控制工具，留着就是死开关）。
- 浏览器设置页从只读改为**可编辑**：导入/历史/清理三条动作都有真实后端，一个可见偏好真实生效。
- 测试：链接路由 2 条（默认系统、非 web 永不走内嵌）+ compat 断言改为「可编辑」口径。

### M1.5：视觉回归矩阵（3 宽度 × 18 面板，2026-10-27 第五十轮）

`node scripts/ui-parity.mjs --visual-matrix`：同一会话内依次把视口切到 1600 / 1280 / 960，
每种宽度遍历**全部 18 个面板类型**，记录该宽度下面板的实际宽度并各截一张图。

| 视口 | 面板实际宽度 | 挂载 |
|---|---|---|
| 1600 | 351px | 18/18 |
| 1280 | 280px | 18/18 |
| 960 | 210px | 18/18 |

产出 54 张截图（`w1600-*` / `w1280-*` / `w960-*`）与 `visual-matrix.json`（含每面板宽度与截图名）。

- 棘轮 `scripts/visual-matrix-baseline.json`（`minMountedPerWidth: 18`）：任一宽度下面板挂载数下降即 `MATRIX-FAIL`。
  这份基线要让「加面板」时手动上调，降下来必须写理由。
- 说明与取舍：这张矩阵测的是**挂载与尺寸**，缺陷判定仍在 `--narrow-audit`（竖排文字/真溢出）。
  两者分工明确，避免把「截图看起来还行」当成通过。

### M1.5：抽检截图 → 修面板头折行（2026-10-27 第五十一轮）

从 54 张矩阵截图抽检 3 张（w960-agent、w960-tag-batch、w960-narrow-prompt-assets），发现真问题：

- **右侧 `prompt-assets` 面板标题区竖排**：`PanelHeader` 是 `flex` 行，动作按钮 `shrink-0` 占掉大半宽度，
  210px 面板下标题区只剩约 60px，描述文字变成一列。
- 修法（系统级）：`.ui-content-header` 加 `flex-wrap`，标题区 `min-width: min(100%, 12rem)`。
  所有用 `PanelHeader` 的面板一起受益，不是逐个打补丁。
- 修后用 960 视口的审计截图确认：标题换行正常、描述横排、按钮落到下一行。

**960 视口的量化结论（作为待决事项的证据）**：960 窗口 → 面板 **210px** → `--narrow-audit` **18/18 命中**，
命中多为深层内容被挤（如 57px 宽的标题块）。这不是某个面板的 bug，而是**四栏固定布局的下限**：
与 640 窗口同源。两条路（响应式分栏 / 设最小宽度+横向滚动）都需要产品决定，我不擅自改。

### M1.5：第二轮截图抽检（2026-10-27 第五十二轮）

抽检 w960-novelai-workbench / w960-comfyui / w960-settings 三张：

- **ComfyUI 地址输入框只有 12px 宽**（截图里显示成 `ht`）：`flex gap-2` 行里按钮是固定宽，输入框被压到极小。
  改为 `flex flex-wrap` + 输入框 `min-w-[10rem] flex-1`：修后显示 `http://127.0.0.1:818…`，按钮换到下一行。
- 上一轮的面板头折行修复在刷新后的矩阵截图里确认生效：右列「提示词资产」标题与描述已横排（3 行）。
- 设置面板在 210px 下导航项（通用/外观/API 配置/AI 工作台/无限画布）可读，标题+描述换行正常。
- 矩阵刷新（第二轮，全部 54 张）：1600→351px、1280→280px、960→210px，18/18 挂载。

### M1.5：第三轮截图抽检（2026-10-27 第五十三轮）

抽检 `w960-wd14` 与 `w960-images`，两处真缺陷：

- **WD14「运行环境」整块竖排**：`flex items-start justify-between` 行里左侧内容被右侧挤到 1 字宽。
  改为 `flex flex-wrap` + 左块 `min-w-[11rem] flex-1`：修后标题横排、状态徽标逐行、解释器/模型/提示都可读。
- **图片库三个按钮竖排**：`grid grid-cols-3` 在 210px 下每格约 60px，「链接原文件」四字竖排。
  改为 `flex flex-wrap` + 每个按钮 `min-w-[8rem] flex-1`（**由宽度驱动而不是视口断点**）——
  210px 下每行一个、351px 下每行两个，符合 G9 的约定。
- 修后刷新矩阵截图确认两处均正常；第二轮矩阵数据不变（351/280/210，18/18）。

至此三轮抽检共 10 张截图，修掉 4 处真实布局缺陷，全部是「能挂载但内容不可用」这一类。

### G9 第三条规则：固定列数网格（2026-10-27 第五十四轮）

图片库按钮竖排的根因是 `grid-cols-3`：固定列数网格**不知道自己有多宽**，210px 下每格约 60px。
这条补进 G9：

```text
grid-cols-N（N≥3）且类里没有 min-w- / minmax / auto-fit / auto-fill  → 命中
```

首轮命中 5 处并全部处理：

| 位置 | 处理 |
|---|---|
| CanvasToolbar `grid-cols-3` | 改 `flex flex-wrap` |
| ComfyUI 指标三列 | 保留网格 + `[&>*]:min-w-0` |
| InspectorPanel `grid-cols-4` | 保留网格 + `[&>*]:min-w-0` |
| QuickUtilityPopover `grid-cols-3` | 保留网格 + `[&>*]:min-w-0` |
| PromptAssetsPanel 分段控件 | 改 `flex flex-wrap` |

刷新矩阵截图确认 1600 视口（351px 面板）下这些改动没有把布局搞坏：分段控件仍一行、ComfyUI 地址行正常。
命中数 5 → **0**，GATES.md 已补规则来历与两种修法。

### M1.5：第四轮抽检——发现 canvas 面板空白（2026-10-27 第五十五轮）

抽检 `w960-tasks`（正常）与 `w960-canvas`（**整个面板空白**）。

空白在 1600 视口同样存在，因此**与宽度无关**，是真实缺陷：

- 面板宿主（`[data-panel-type=canvas]`）实测 **351×421**，但它的第一个子元素只有 **32px 高**；
- 也就是说面板内容根（`flex h-full min-h-0 flex-col`）没有拿到高度，工具条之后的可视区高度为 0；
- 面板头「无限画布」可见、正文一片白——截图能看出来，挂载检查（18/18）看不出来。

已把 `height` / `firstChildHeight` 加进 `--narrow-audit` 的测量结果（这次就是靠它把「空白」量化成 421 vs 32）。

下一步（明确）：拿到 canvas 内容根的父链高度后修——候选修法是给 `.ui-panel-content` 内的直接子元素 `height:100%` 的百分比链补一个确定高度，
或让 canvas 根改用 `absolute inset-0`。**下一轮必须先复现再改**，不能靠猜。

### 修：无限画布空白（真根因是 Router 上下文，2026-10-27 第五十六轮）

上一轮把空白量化为「宿主 421px、内容根 32px」，这一轮拿到**真根因**：

```
Error: useLocation() may be used only in the context of a <Router> component.
An error occurred in the <LocalAgentPanel> component.
```

`canvas-vendor-entry.tsx` 把 `<AgentPanel />` 渲染在 `<RouterProvider>` **旁边**（sibling），
而 `LocalAgentPanel` 内部调用 `useLocation()` → 挂载即抛错 → 整棵画布树被卸载 → 白屏，**且没有任何错误提示**。

修法两处：
1. 新增 `CanvasSurface` 布局组件，把 Agent 浮层放进路由元素内部（三个路由都用它包一层）；
2. 新增 `CanvasErrorBoundary`：以后再崩会显示「无限画布渲染失败 + 原因 + 重新加载」，不再是白屏。

验证方式（重要）：**截图看不到 iframe 内容**——CDP `Page.captureScreenshot` 不合成跨文档 iframe，
和之前 WebContentsView 是同一类限制。所以证据换成**读取 iframe 的 innerText**：
修复后 `canvas.html` 帧内文本 **612 字符**，包含「画布/资产/提示词库/画布元素/画布暂无节点/无限画布 1/Codex 未连接」等真实 UI 文本，
修复前该帧因崩溃为空。

### M1.5：矩阵加「空白面板」检测 + 修标签名消失（2026-10-27 第五十七轮）

- `--visual-matrix` 每个面板现在记录 `textLength`（面板正文 innerText 长度），**为 0 即 `blankPanels` 并让矩阵失败**；
  `canvas` / `browser` 两个「把内容托管给 iframe / 原生视图」的面板豁免（探针读不到它们的内容，已用别的方式验证）。
  这条检测正是为了自动抓住上一轮那种「挂载成功但一片空白」——手动抽检抓到过一次，现在变成常驻检查。
- 修 `tag-asset-manager`：210px 下标签名被 `truncate` 压成 0 宽，**整行只剩徽标**（用户看不出是哪条标签）。
  行改 `flex-wrap`、名称按钮 `min-w-[8rem] flex-1`；截图中名称恢复显示（手臂 (ar… / 寿司卷…），徽标换行到下一行。
- 复跑矩阵：三档宽度 18/18 挂载、`blank: []`。

### M6：回收站「永久删除」名不副实（2026-10-27 第五十八轮）

抽查回收站按钮时发现一个**承诺与行为不一致**的问题：

- 按钮写着「永久删除选中」，但 `deletePicked` 调的是 `api.deleteVersions` → `softDeleteNovelaiVersions`，
  也就是**又一次软删除**：行还躺在回收站里，用户以为已经删干净了。
- 修法：补 `novelai:version:purgeMany` 通道 + `window.api.novelai.purgeVersions`，按钮改调 `purgeVersions`（真 `DELETE`）。
- 服务层原有守卫保留：`purgeNovelaiVersion` 在还有活子节点时拒绝。
- 测试：面板 +1（断言调用 `purgeVersions` 且**不再**调用 `deleteVersions`）；服务 +1（软删后真删、live 子节点拒绝），版本服务 21 条全绿。

这也是一类「假成功」：不是功能缺失，而是按钮承诺了它没做的事。

### M1.5：窄面板审计按宽度分开记账（2026-10-27 第五十九轮）

上一轮之后 `--narrow-audit` 只有单一预算（默认宽度 0），960/1280 的命中数没被跟踪，等于「知道了但没管住」。
现在改为按视口宽度分别记账：

| 视口 | 面板宽度 | 命中 | 预算 |
|---|---|---|---|
| 默认 | 304–351px | 0 | 0 |
| 1280 | 280px | 1（gallery-search） | 1 |
| 960 | 210px | 18（全量） | 18 |

要点：**默认宽度必须为 0**；另两档是登记在案的结构性债，只能降不能升，升要用 STATE 写理由。
这样「窄窗口下四栏不可用」既不冒充通过，也不阻塞其它工作。

另：本轮抽检 `w960-history` / `w960-novelai-assets` / `w960-utility-sidebar` 三张，未发现新缺陷（标题换行、分类芯片多行、页签换行都正常）。

### M1.5：徽标对齐源原语（2026-10-27 第六十轮）

逐项比对 `packages/ui/src/components/primitives/badge.tsx` 与我们的 `.ui-badge`：

| 属性 | 源 | 我们（修前） | 我们（修后） |
|---|---|---|---|
| 形状 | `rounded-full border` | 已一致 | 一致 |
| 图标槽 | `[&>svg]:size-3` | 无 | `12px` |
| 间距 | `gap-1` | 无 | `4px` |
| 换行 | `whitespace-nowrap` | 无 | 有 |
| 被压缩 | `shrink-0 w-fit` | **无** | `flex-shrink: 0` + `width: fit-content` |
| 最大宽 | `overflow-hidden` | 无 | `max-width: 100%` + `overflow: hidden` |

`flex-shrink: 0` 这条最实际：紧行里徽标原本会被压到文字消失（和标签名消失是同一类症状，只是发生在徽标上）。
截图复核（1280 视口 / 280px 面板）徽标为完整胶囊、无换行、名称正常截断。

### M1.5：分段控件对齐源 tabs（2026-10-27 第六十一轮）

源 `tabs.tsx` 的 `default` 变体：`h-9 w-fit rounded-lg bg-muted p-[3px]`，触发项 `text-sm font-medium whitespace-nowrap`，
选中项落在**抬起的表面**上（`bg-background shadow`），而不是染 accent 色。

对照我们的 `.ui-segmented`（修前）：有 1px 边框、`--radius-md` 圆角、项高 32px、选中项染 accent 12%。

修后：

| 属性 | 源 | 修后 |
|---|---|---|
| 边框 | 无（靠 muted 轨道） | 无 |
| 圆角 | `rounded-lg` = 8px | 8px（注释说明为何不用共享 token：`--gr-radius-lg` 是 10px，为卡片调的） |
| 高度 | `h-9` = 36px | `min-height: var(--gr-input-height)` = 36px |
| 选中 | 抬起表面 + 阴影 | `surface` + `panel-shadow`，不再染 accent |

截图复核（1280 视口）：分段控件为 muted 轨道 + 白色抬起项，与源一致；左侧与右侧两个实例都正常。

### M1.5：复选框基线（2026-10-27 第六十二轮）

源 `checkbox.tsx`：`aspect-square rounded-[4px] border` + `bg-transparent`，hover `bg-accent/50`，
选中 `border-foreground text-foreground`（反色填充 + 勾），带轻微缩放动效。

我们的原生 `<input type=checkbox>` 之前只设 `accent-color`——**控制不了圆角、轨道与 hover**。
新增 `.ui-checkbox`：`appearance: none` 重绘方框（16px、4px 圆角、透明轨道、hover 淡 accent），
选中用 `background-image` 画白色勾（data URI），保留原生语义（`:checked`、label 关联、disabled）。

已迁移 4 处：回收站多选、识图面板、简易 AI 面板、图库检查器「连续探索」。
分页器复核：源用 `buttonVariants(outline|ghost, size=icon)` = 36px 方按钮；我们的 `IconButton` 是 30px 方按钮，
尺寸不同但同族，暂不改（改动会影响面板头所有图标按钮，收益不抵风险），记录在此备查。

**踩坑（本轮）**：勾选标记最初用内联 SVG data URI 作 `background-image`，`vite build` 直接失败：
`CssSyntaxError: index.css: Missed semicolon`（列号指向合并后的样式表，很难一眼看出是哪行）。
定位方法是把它换成 `background-image: none` 后构建即通过，确认是 URI 本身的问题。
改为纯 CSS：`appearance: none` 让方框成为普通元素，勾由 `::after` 的旋转边框画出（`border-width: 0 2px 2px 0` + `rotate(45deg)`）。
教训：**样式里的 data URI 要先跑一次构建**，不要等门禁。

### M1.5：提示气泡（Tooltip）替换原生 title（2026-10-27 第六十三轮）

源 `tooltip.tsx`：深色气泡（`bg-neutral-900 text-neutral-50`）、`rounded-md`、`px-3 py-1.5`、`text-xs leading-relaxed`、
`max-w-80`、带 12×6 箭头、默认 `sideOffset` 让气泡**离开触发元素**（源注释解释这是为了避免 hover 反馈循环）。

我们此前全靠原生 `title`：系统样式、无箭头、不跟主题、键盘用户要等浏览器自己决定显示。

新增 `Tooltip` 组件 + `.ui-tooltip` 样式：
- 固定定位（不受面板 `overflow` 裁剪——这正是原生 title 唯一还行的原因）；
- hover 与 **focus** 都显示，用 `aria-describedby` 关联（键盘可达）；
- 深色气泡 + 箭头，深色主题下反色（`[data-appearance='dark']`）；
- 偏移 6px，避免气泡压住触发元素。

`IconButton` 改为用 Tooltip 包裹（去掉 `title`），所有面板头的图标按钮一次性受益。
测试：Tooltip 2 条（hover 显示/离开隐藏、focus 显示且 `aria-describedby` 指向气泡），ui 原语 15 条全绿。

### M1.5：弹出层对齐 + 提示气泡真机验证（2026-10-27 第六十四轮）

- `.ui-popover-surface` 对齐源 popover：**0.5px 发丝边框**（源 `border-[0.5px]`）、8px 圆角、`shadow-lg`。
  去掉了原来的 `0 0 0 1px` 内环——它和真实边框叠在一起，深色模式下看着像双线。
- 新增 `.ui-popover-panel`（`w-72 p-4`）对应源的通用 popover 体；菜单仍用 `.ui-popover-menu` 的 4px 紧凑内边距。
- 新增 `--tooltip` 旅程：用 CDP 真鼠标移动到图标按钮上 → 断言气泡出现、文本匹配、**不是系统样式**、`aria-describedby` 关联，并截图。
  四项全 PASS，气泡文本「刷新提示词资产」，截图可见深色气泡 + 向下箭头指向刷新按钮。

说明：单测在 jsdom 里只能验证逻辑，真机验证补的是「定位、层级、主题色」这些只有渲染器才知道的事。

### M1.5：标签页对齐源 line 变体（2026-10-27 第六十五轮）

源 `tabs.tsx` 的 `line` 变体（horizontal）：触发项 `relative gap-2 px-2 py-2 **font-normal**`、
`text-muted-foreground`，激活 `text-primary`，底部标记用 **`::after` 绝对定位**：平时 2px，激活 4px。

我们原实现是 `border-bottom: 2px` + 常亮 2px，激活只换颜色、另外加了 8% accent 背景。两处偏差：
1. 字重 600（源是 normal）；
2. 激活标记高度应当 2px → 4px —— 但换成 border 会在激活瞬间把文字推动 2px，所以照源的做法规避：改 `::after` 绝对定位条。

修后：字重 normal、字号 0.8125rem（源 14px，面板头一排四个页签在 210px 下需要紧一档，已注释说明）、
激活项去掉背景色块（源没有），底部 4px accent 条。截图确认「标签字典」下方粗紫条正确，其它页签为 muted 常规字重。

### 反「凑数」审计：面板类型 vs 渲染分支（2026-10-27 第六十六轮）

抽查占位标记（`TODO` / `尚未接入` / `占位`）时发现 `PanelRegistry` 里有个默认分支：
```
default: … 面板尚未接入 …
```
也就是说**只要某个面板类型没有渲染分支，它就会以「面板尚未接入」出现在界面里**。于是做了一次机器核对：

| 项 | 数 |
|---|---|
| 声明的面板类型 | 33 |
| 有渲染分支的 case | 27 |
| **没有渲染分支** | **6**（`tag-tree` / `favorites` / `tag-cards` / `prompt-editor` / `output` / `errors`） |

核对结论：这 6 个都是 `enabled: false`，所以**没有出现在面板选择器里**——此前担心的「占位面板可被用户选中」不成立。
这也顺带回答了悬置多轮的「五个旧面板怎么办」：它们已经是禁用状态的遗留类型，既不渲染也不可选，保持现状即可（可逆、无债）。

**新增 G9 第四条规则**（机器防线）：`enabled: true` 的面板类型必须有对应 `case`，否则命中。
当前 18 个启用类型全部有分支，0 命中。这样以后谁把占位类型改成启用，门禁会先拦住。

### 反「凑数」审计第二层：路由覆盖（2026-10-27 第六十七轮）

面板层查完，接着查**服务层**：已挂载的源页面调用的每条 `ipcApi.request(route)` 是否真的有处理分支。
没有分支的调用会落到通用「未知路由」错误，而源页面对这类错误是 `catch` + 记日志——
**按钮照样能点、界面照样在，只是什么也没发生**。这和「简易版凑数」是同一种欺骗。

首轮核对：页面请求 9 条路由，**4 条无处理**：

| 路由 | 后果 |
|---|---|
| `app.relaunch` | 截图设置页的「重新启动」按钮点了没反应（Windows 上真实可达） |
| `system.mac.screen_capture_status` | macOS 权限状态永远拿不到 |
| `system.mac.request_screen_capture` | 无法跳到系统权限页 |
| `system.mac.open_screen_capture_settings` | 同上 |

修法：四条全部实现，并且**非 macOS 上如实回答 `'unavailable'`**（不是假装「被拒绝」）。
`app.relaunch` 沿用既有策略：重载窗口而不是重启进程（重启会杀掉无关窗口与在途任务）。

**新增 G10「路由覆盖」门禁**（`scripts/check-route-coverage.mjs`）：挂载页调用的路由必须都有分支，否则失败。
现在 9/9 覆盖，0 缺失。以后谁新挂一个源页面但漏了路由，门禁先红。

### M1.5 + 抽检：Agent 模式行溢出、原生单选按钮（2026-10-27 第六十八轮）

抽检 `w1600-agent` 与 `w1600-gallery-search`：

1. **Agent 工作台七个模式在 351px 面板里被裁掉第 5 个以后**。原因不是没换行，而是模式条放在**面板头**里，
   而面板头高度固定（`--panel-header-height`）——换行后第二行直接被裁。
   修法：模式条移到独立的首行（`modeRow`，`flex-wrap` + `role=tablist`），面板头只留标题/运行时/模型。
   截图确认七个模式分两行全部可见（对话/识图/绘图/画布 + 会话/MCP/日志）。
2. **图库筛选里的单选是未收编的原生控件**（系统画小灰圆，选中与否几乎看不出差别）。
   新增 `.ui-radio`（16px、圆形、选中实心点），仅替换了原生外观，保留 label 关联与键盘行为。
3. 顺带把 `.ui-switch` 轨道底色从 `--color-bg-tertiary` 改成与边框色的混合——原来的浅色轨道在浅色面板上
   几乎看不出是开关。**遗留观察**：图库「来源」行的开关截图仍偏小偏淡，下一轮用元素级测量确认（宽度/背景实测值），
   不靠肉眼判断。

第三层反凑数审计（服务层硬编码）结论：`ipcOk(null)` / `ipcOk([])` 共 12 处，逐条看过——
多数是操作类路由的正常返回（打开外链、MCP 停止等），`mcp.server.list_prompts|list_resources|get_logs` 是「空协议结果」
而非伪造数据，已补注释说明。未发现假数据。

### 测量取代猜测 + 矩阵新增表头裁剪检测（2026-10-27 第六十九轮）

1. **上轮那个「图库开关偏小偏淡」的怀疑，被测量推翻了。** 新增 `--measure=<选择器>` 后实测：
   `.ui-switch` 全部 **26×15**，浅灰轨道 `rgb(188,194,204)` 边框、`color(srgb .855 .868 .89)` 底，选中项是紫色 `rgb(168,85,247)`。
   也就是说开关渲染完全正常，是我在 1600px 缩略图上**看错了**。结论：截图用来发现异常，测量用来定性；
   两者混用会把错觉写成 bug。
2. **矩阵新增「表头裁剪」检测**：每个面板测 `[data-ui="panel.header"]` 的 `scrollHeight - clientHeight`，>1px 即记 `clippedHeaders` 并让矩阵失败。
   这条来自上轮的真实事故：Agent 模式条放在固定高度表头里，换行后第二行被裁掉，肉眼只看到「少了两项」。
   三档宽度复跑：`18/18` 挂载、`blank: []`、`clippedHeaders: []`。

### M6 收尾：生命周期集成测试（2026-10-27 第七十轮）

新增 `src/main/services/novelai-lifecycle.test.ts`：一条测试走完工作台 UI 的真实顺序，
断言每一步用户会看到的状态——

1. 建作品（根版本 = 1）；2. 在尖端续写（= 2）；3. **从根开分支**（`branched: true`）；
4. 软删该分支（尖端仍在）；5. 恢复（编号保持 3）；6. 再软删并**真删**（行消失、回收站清空）；
7. 幸存分支完好、编号不变、`lastVersionId` 不指向已删版本。

单测覆盖零件，这条覆盖**接缝**（revision 递增、分支编号、回收站往返）。

过程中三个断言是我写错、被测试纠正的（值得记录）：
- 分支编号不是 2 而是 **3**（编号取该分支首版本的版本号）；
- `createNovelaiAsset` 返回资产本身、入参是 `{kind,name,payload}`（没有 workId/content）；
- `restoreNovelaiVersions` 收的是**裸 id 数组**，不是 `{workId,versionIds,expectedRevision}`。
资产↔版本的关联走「版本 → 图片 → 资产用量」，那条链已有独立测试，本测试不重复造 image 行。

### 反「凑数」第四层：端到端持久化验证（2026-10-27 第七十一轮）

前三层查的是「有没有壳」（面板分支）、「有没有后端」（路由）、「有没有假数据」（服务返回值）。
第四层补最后一类：**设置改了到底有没有写进 SQLite 并在重载后生效**。

新增 `--comfy-persist` 旅程（走我们自己实现的 ComfyUI 面板，所以是对我们代码的检验，不是对源页面的）：

1. 打开 ComfyUI 面板；2. 用**原生 setter + input 事件**往地址框真输入；3. 点「保存并连接」；
4. 从 `settings.getAll()` 读 `comfyui_base_url`，必须等于输入值；5. **切走再切回**面板，输入框必须显示库里的值。

四项关键断言全 PASS：`storedInDatabase: true`、`restoredFromDatabase: true`（实测值两端都是 `http://127.0.0.1:8199`）。

为什么第 5 步是必需的：只断言输入框的值，即使什么都没保存也会通过（React 受控组件的 state 就够）。
必须是「写入库 → 重新挂载 → 从库读回」，才算真的持久化。

### 证据汇总文件（2026-10-27 第七十二轮）

新增 `.agent/records/2026-10-28-e2e-evidence.md`：把**实际跑过**的旅程与矩阵结果集中成一份可复现清单，
每条都对应机器生成的 JSON / 截图。本轮实跑结果：

| 旅程 | 断言 | 结果 |
|---|---|---|
| `--workbench` | 8 | PASS（分支 `[1,2]`、素材联动双向可见） |
| `--assets` | 4 | PASS（反向查询返回「雨中少女」） |
| `--gallery` | 3（含 6 个开关） | PASS |
| `--tooltip` | 4 | PASS |
| `--comfy-persist` | 5 | PASS（库内与重载后均为 `http://127.0.0.1:8199`） |

矩阵：1600/1280/960 三档均 18/18 挂载，空白面板 0、表头裁剪 0。

文件里同时**写明三条已知限制**（CDP 截图不含 iframe / 原生视图、960 四栏不可用、源码类型棘轮未清零），
避免后续把「没测到」误读成「没问题」。

### G8 的盲区：类存在 ≠ 样式生效（2026-10-27 第七十三轮）

`G8 CSS 覆盖率` 只查「类名在样式表里有没有定义」。新增 `--style-contract` 补另一半：
在真实渲染器里建临时元素、读 `getComputedStyle`、与源原语规定值逐条比对（16 条）。

首轮就抓到一条：`.ui-popover-surface` 的圆角实际是 **10px**，而源是 8px。原因不是写错，是**样式表里有两份同名规则**
（早期令牌层又定义了一次 `border-radius: var(--gr-radius-lg)`），后出现的赢了级联。

修法：删掉后出现的那份重复定义并留注释说明；16 条契约全部通过。

契约覆盖：徽标（圆角/display/不换行/不被压缩）、输入框 36px、开关 32×18 与 26×15、复选框/单选 16px、
图标按钮 30px、分段控件 36px、弹层 8px、气泡 fixed、页签 relative。

这一类缺陷（**重复定义互相覆盖**）grep 抓不到、截图也未必看得出，只有「量出来的值」能抓住。

### 门禁 G11：样式契约（2026-10-27 第七十四轮）

`--style-contract` 从 16 条扩到 **24 条**，并接进门禁（G11，排在 G6 之后——它要启动真实渲染器，依赖已构建的主进程包）。

新增覆盖：徽标 gap 4px / padding 2px 7px；分段控件 padding 3px；popover-panel 288px 宽 / 16px 内边距；
气泡 6px 内边距；页签字重 400。全部通过。

门禁现在 11 条，单次全量约 12–13 分钟（G3 450s + G11 77s 为主）。

### 旅程套件一键化（2026-10-27 第七十五轮）

新增 `npm run journeys`（`scripts/journeys.mjs`）：顺序跑完 8 条旅程/矩阵，任一失败即非零退出，
并打印每条的**一行摘要**（WORKBENCH / ASSETS / GALLERY / TOOLTIP / COMFY-PERSIST / STYLE-CONTRACT / MATRIX / NARROW）。

本轮实跑结果：**全部 PASS**。
- 工作台 8 项、素材库 4 项（反查返回「雨中少女」）、图库 3 项、气泡 4 项、持久化 5 项（两端同为 `127.0.0.1:8199`）、样式契约 24 项；
- 矩阵三档 18/18、空白 0、表头裁剪 0；
- 960 窄面板 18 命中 = 预算 18（登记在案的结构性债）。

定位：**不并入默认门禁**（整套 6–9 分钟），用于批量 UI 改动后或交付前。门禁仍是每轮跑的 G1–G11。

### 迁移矩阵纠偏（2026-10-27 第七十六轮）

矩阵里有 49 行 PARTIALLY_MIGRATED、1 行 BLOCKED、3 行 NOT_IMPLEMENTED。挑出状态最可疑的三行逐条核对代码，
结果**两行已经过时**（写着未完成，其实早就做了）：

| 行 | 原状态 | 实测 | 新状态 |
|---|---|---|---|
| 89 `/settings/general` | BLOCKED（称只显示诊断页） | `readOnly: false`，页面可编辑；无对应能力的两个开关由 compat CSS 隐藏；开发者模式闸门由 `--settings-wiring-journey` 验证（关→`DEVELOPER_MODE_DISABLED`，开→成功） | PARTIALLY_MIGRATED |
| 43 提示词目录生命周期 | NOT_IMPLEMENTED（称审计未做） | 表 `prompt_assets` / `prompt_asset_categories` / `prompt_asset_category_links` 俱全，`default-prompt-assets.service`、`prompt-asset-browser`、`prompt-assets` 面板都在；缺的是目录包的导入导出与版本固定 | PARTIALLY_MIGRATED |
| 37 Docking engine | NOT_IMPLEMENTED | adapter 声明 `legacy-compatible | dockview`；dockview 已 vendor 但**不是**当前引擎，实际用的是 Grimoire 自有面板系统 | **保持 NOT_IMPLEMENTED**：按 AGENTS.md，自有实现属 REIMPLEMENTED，需书面证明 + 明确批准才能改状态，下一步写证明并请示 |

`G7` 迁移矩阵格式门禁在改后仍通过（121 行、列数一致）。

教训：矩阵是「当时的判断」，不是「现在的真相」——过一段时间必须回头核对，否则它会以权威的口吻说谎。

**G4 抖动修复（同轮）**：G4 曾红一次，单独跑该文件 6/6 通过——说明是**负载下的 flake**（G4 与 G3 并行，整机被占满）。
默认 `findBy*` 只等 1000ms，在那种负载下会超时。修法：compat 的 vitest 配置 `testTimeout/hookTimeout = 20s`，
`configure({ asyncUtilTimeout: 5000 })`。重跑 G4 与全量门禁均绿。
这类红不掩盖：如果真是逻辑问题，加长超时只会让它更慢地红，不会变绿。

### Docking engine 证明文档（2026-10-27 第七十七轮）

上一轮把矩阵第 37 行留在 NOT_IMPLEMENTED，并记下「下一步写证明」。本轮写完：
`.agent/records/2026-10-28-docking-engine-proof.md`。

实测证据（不是判断）：
- `dockview-core/package.json` 的 `main`/`types` 指向 `dist/`，vendored 源码里没有 `dist/`；
- 探针实验：渲染层直接 import vendor 的 TS 入口 → `TS2307: Cannot find module`（解析依赖构建产物）；
- 渲染层 `tsconfig.include` 不含 `src/vendor/**`；
- `workspace-engine-adapter.ts` 适配边界已在，但没有可实例化的后端。

文档同时写明真实差距：源支持任意嵌套分割，我们只有固定列结构——这也是 960 视口 18 命中的结构性来源。
结论：建议改为 REIMPLEMENTED，等批准；文档末尾列了三个选项（批准 / 先补嵌套分割 / 走 VENDOR 路线）。
探针文件已删除，类型检查干净。
