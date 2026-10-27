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

### 未完成（明确留到下一批）

- **分组卡片 + 折叠**：设置内容仍是「一次显示一个分区」。要变成 Cherry 那种「全部分区堆叠 + 每张卡片可折叠」，需要把 8 个分区的内联 JSX 逐个改造成可折叠卡片（约 8 处结构性改动，风险中等）。
- **组件基线**（按钮/开关/标签/对话框/表格）：只做了令牌与三个共享类，组件级统一未做。
- ~~M1.4 模型选择器真机重测~~ **已完成**：搜索按供应商名 → 选中 `settings-smoke-provider::gpt-4o` → 四项检查全绿（证据 `artifacts/visual/cherry-routes/settings-actions.json`）。
### D10（真实，低危）跨视图缓存不失效

- 通过 DataApi 新建供应商后，compat 窗口的供应商面板仍显示「已配置 0 / 0」，必须整页刷新才更新；数据本身已写入（`providers.list()` 能读到）。
- 触发条件：provider 由 DataApi（而非设置页表单）创建，或由另一个窗口创建。
- 影响：M1.4 的选择器测试曾因此误判为「picker 不显示模型」；实际是缓存问题。
- 处置：M3 里给 provider 的创建/更新/删除加广播，让渲染层重新拉取；在此之前审计脚本用一次 reload 规避并已注明。
