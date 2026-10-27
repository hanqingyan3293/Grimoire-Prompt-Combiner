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
