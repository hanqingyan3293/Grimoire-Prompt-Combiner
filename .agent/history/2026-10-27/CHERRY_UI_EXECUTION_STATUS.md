# Cherry UI 剩余迁移执行账本

日期：2026-10-12
计划：[CHERRY_UI_EXECUTION_PLAN.md](CHERRY_UI_EXECUTION_PLAN.md)

## 当前阶段

P1/P2/P3 — PARTIALLY_MIGRATED。按用户批准分层验收：Agent蓝图/安全session namespace/独立Topic foundation及源API已接入；真实MainApp/tabs隔离shell的create/switch/close/reload/navigation smoke通过；runtime stable lease/tool ownership已修复，Pi/OpenCode idle实际协议smoke通过。下一片Agent workspace/session source readmodel正在实施。P0隐藏行为清单继续维护，两个完整strict gate仍失败，不因分层推进而标绿。

## 本次确认的事实

| 项目 | 状态/证据 | 下一动作 |
|---|---|---|
| compat 类型门禁 | BLOCKED：旧 npm 脚本带 `--noCheck`，此前“通过”不代表类型正确。已移除该参数。真正 `tsc --noEmit -p .../compat/tsconfig.json` 退出 2，551 条 TS 诊断。原始输出：`artifacts/cherry-compat-strict-typecheck.log` | 分类 compat 自身、source alias/ambient 声明、第三方依赖诊断，修复契约和解析边界；不得改 vendored source 或用 `noCheck` 恢复假绿 |
| Pi RPC | manifest 明确记载 `--mode rpc --no-session get_state` passed；这不是“自造协议”的证据 | 对照实际 executable、哈希、版本与 vendored CLI 核验；保留 RPC，SDK 驱动复用决策待证据 |
| runtime artifacts | 本次 `sha256sum` 两个 artifact 与 manifest 一致；实际 `--version` 返回 Pi 1.0.1、OpenCode 1.18.34，命令退出 0。这只证明版本/来源，不代表完整 Agent 流程 | 继续匹配版本的 RPC/HTTP/SSE/权限/恢复功能 smoke |
| `/app/agents` | PARTIALLY_MIGRATED：历史汇报将助手 rail 与真实 AgentPage 混淆，尚未通过 AgentPage 完整功能验收 | 逐源核对 `/agents` 蓝图、session/workspace 契约和源页面依赖 |
| 整体完成比例 | 无完整行为分母，不报告百分比 | 按完整台账逐行为验收 |

## 阶段执行顺序

P0 事实/门禁 → P1 数据所有权 → P2 shell/tabs → P3 Pi/OpenCode runtime → P4 真 AgentPage → P5 设置/聊天动作 → P6 domain → P7 备份 → P8 windows → P9 全产品验收。

## P0 第二批：门禁与真实缺陷修复

- root/compat 两个 typecheck 脚本的 `--noCheck` 已移除。
- compat tsconfig 对齐构建使用的精确别名（host、icons、现有 shims、router、table fork 类型），加载真实 Vite/Node 环境声明；没有新增虚构的完整 Cherry window API。
- 恢复 `CompatAssistantTopicRailProps` 明确类型，修复 `CompatTopicRow` 缺失 export callback 的实际作用域错误。callback 绑定菜单所在行 ID，而非激活主题。
- 修复 provider model filter type predicate 返回 string/false 的类型错误，改为明确布尔值。
- 添加 `CompatTopicExportWiring.test.tsx`，五种导出逐一验证 row ID + 无 callback 安全分支；测试 fixtures 也必须通过严格检查，未以测试通过代替类型门禁。

本次验证：

| 门禁 | 结果 | 证据 |
|---|---|---|
| root tsc | 退出 0 | `artifacts/cherry-root-typecheck-p0.log` |
| root tests | 112 文件，690 passed，2 skipped，退出 0 | `artifacts/cherry-root-tests-p0.log` |
| compat tests | 16 文件，89 passed，退出 0 | `artifacts/cherry-compat-tests-p0.log` |
| 完整 build/copy | 退出 0 | `artifacts/cherry-full-build-p0.log` |
| Electron route audit | 构建稳定后串行重跑：26/26 rendered，退出 0。只证明注册路由渲染，不代表 AgentPage/完整产品验收 | `artifacts/cherry-route-audit-p0-serial.log` |
| compat strict types | 仍失败，退出 2；551 → 516 → 414 → 415 → 413；新 regression test 的两条不支持的 getByRole option 诊断已修正，focused tests 6/6 passed，新 test 无严格类型诊断 | `artifacts/cherry-compat-strict-typecheck.log` |

首次 route audit 与 build/copy 重叠，20/26 failure；该轮不作为有效通过证据，失败日志保留 `artifacts/cherry-route-audit-p0.log`。后续 Electron 门禁必须在稳定构建上串行运行。

P0 仍未完成：需修正剩余 ambient/alias/dependency/adapter 诊断，并补齐所有隐藏行为和窗口消费者清单。不得用排除导入源码、宽泛 any 或 noCheck 清零。

## P0 第三批：真实环境与页面参数契约

- 加入 `build-env.d.ts`，四个 `__APP_*__` 使用源 AppEdition/ReleaseNotesEntry 类型，与 vite.shared.config 注入值一致。
- strict config 加载实际 Grimoire renderer/global.d.ts，不虚构完整 Cherry API；新增 build/test config 纳入检查。
- Knowledge source route adapter 接 baseId 与必需 onBaseIdChange，选择/清空使用 replace history；3 个针对性测试通过。
- Browser source route adapter 复用 normalizeBrowserEntryUrl，修复固定 about:blank 丢弃深链接；10 个针对性测试通过。
- 上述 wrapper 不表示 knowledge 后端或 browser guest 服务已经可用。
- 本轮真实 strict typecheck 退出 2，最新观察 374 条诊断；剩余 source/preload 方法、依赖声明、版本身份和 adapter 契约问题仍需修复。
- 最新 build→Electron audit 已按串行流程启动，结果待完成通知；不预先计为通过。

## P0 第四批：类型边界继续修复

- 为 21 个实际存在的 Lucide 深入口声明精确 public icon 类型，无 wildcard/no-any；已对安装包文件和公开声明核验。
- 修复既有 test fixtures：完整 Topic/MCP tool/required rail props、typed provider mocks、cast-free ResizeObserver 和 partial failure bridge。子任务只修测试，5 条 test 类型诊断清零。
- Markdown 主题/单消息导出原来调用不存在的 `window.api.file.save`。现通过 `saveMarkdownExport` 复用实际 `window.api.dialog.save(content, defaultName)`；新增成功/取消/失败三个回归场景。main handler `index.ts:537–548` 是真实 native save + UTF-8 写入，不是虚构声明。
- 修复 provider preview 的 unknown[] 边界及 model-selector priority Map 的 tuple/value 类型。
- 最新 strict 检查仍退出 2，318 条诊断；没有 compat-local 文件诊断。剩余诊断位于导入的 source，需区分缺失实际 Host capability、dependency graph 与 upstream strictness，不能按位置归因或忽略。
- 新一轮完整 build→Electron audit 退出 0；compat 全量 19 文件/105 tests passed。该 audit 只验证注册路由渲染，不代表完整 Agent UI。
- renderer global 类型补齐实际已存在的 MCP cache preload（onSync payload 保持 unknown，broadcastSync 惰性行为如实注明）；root tsc 退出 0。
- 再次 strict 检查退出 2，308 条诊断。未新增 backup/command/window.electron 等不存在的 API。P0 仍未通过类型门禁。

## P0 第五批：真实依赖所有权与防退化测试

- 新增 `config-contract.test.ts` 13 个测试，检查精确 aliases/build globals/真实 table fork 声明，防止 typecheck 脚本再次带 noCheck。
- 修正 mini-app BLOCKED 诊断：appId 来自 useParams；真实缺口是 tab identity/activity/metadata 生命周期，而非 currentTab.url 推导 ID。
- 使用现有安装记录的 pnpm 12.10.1（corepack）显式添加 runtime-direct CodeMirror、mime-types、use-sync-external-store，以及六个精确 @types 包。source 继续通过既有 compat junction 解析，不改源码。
- 已读安装包 LICENSE 文本，13 个新增直接声明均含 MIT permission grant。
- 缺少 TS7016、CodeMirror private identity 和 HAST 双版本诊断已从本次 log 消失；strict 仍退出 2，最新观察 298 条。
- peer check 退出 1，报告 `artifacts/cherry-compat-peers-p0.log`：既有 Tiptap 子包 3.31.4 与 core/pm 3.26.1 等 peer 问题仍需逐版本核对。不能将依赖安装成功等价于全图通过。

## P0 第六批：源 file.save 真实能力

- 实现源 file.save(fileName, string/Uint8Array, options?) → path/null 的 verified contract，保持 filename-first 与 source artifact caller 的返回路径需求。
- main native dialog 使用 calling BrowserWindow 作为 parent；取消返回 null，错误拒绝；仅写用户在 dialog 选择的路径，保护 userData（包括 junction/symlink 解析路径）。preload 自包含；renderer 声明与实际能力一致。
- 20 个新增 IPC/preload 用例覆盖 UTF-8/bytes、取消、dialog/write failure、参数拒绝、父窗口与受管目录保护；focused 26/26，main tsc 通过。未进行真实 native dialog 手动保存，不把 mock 当作 OS 手测。
- 最新 root tests：113 文件、710 passed、2 skipped；compat tests：20 文件、118 passed；strict 仍失败 289 条诊断。
- 本轮依赖/file.save 后完整 build→Electron route audit 串行执行退出 0；只证明已注册路由的渲染回归，不代表 native dialog 手测或完整迁移验收。
- 未实现 file.openPath/saveImage/backup，也未虚构这些类型以消除诊断。

## P0 第七批：编辑器 drift 与实际 file.openPath

- 19 个 Tiptap 3.31.4 漂移子包精确 override 到 source 3.26.1；安装 manifest 核验通过。peer report 已不含 Tiptap，仍有 react-spinners React 19 peer 警告，不称整个 peer gate 通过。
- 新增 CodeMirror 源入口/compat 入口 realpath 一致性回归，config-contract tests 14 passed。
- file.openPath(path) → Promise<void> 已主进程实现，复用源 absolute/home-relative 与安全限制；missing/invalid/shell-error 拒绝而非成功。54 focused tests passed、1 existing platform skip；main tsc 通过。未做真实 OS shell 手测。
- 为已存在的 path helper/selectFolder 补准确 global 类型，resolvePath 仍 nullable；类型失败剩余 277 条，不声明不存在 backup/electron/commands。
- root tsc/root tests 本轮退出 0；编辑器/file.openPath 后完整 build→Electron render audit 串行退出 0。
- 类型阻塞归因与后续阶段归属见 `CHERRY_UI_TYPECHECK_BLOCKERS.md`。完整闭包仍失败，不能将 P7 备份等能力“补类型”塞入 P0 清零。
- 检查 preload 时额外发现 isPathInside 失败返回 false 的 fail-closed 注释与调用者判定可能相反，已建议独立安全修复任务；当前未修复，不作为正确行为背书。

## P0 第八批：源版本与补丁 provenance

- 对照 source-package/source-pnpm-lock，将 compat i18next/react-i18next/PDF.js 独立图精确对齐 23.16.8/14.1.3/5.4.296，不修改 root 版本。
- compat suite 对齐后退出 0；最新 strict 检查退出 2，272 条诊断。
- 额外获准参考目录中找到了三个 Tiptap patch 实体，正在逐文件核对；未施加未知 patch，也未因同版本而宣称 patched editor parity。
- 新一轮 locale/PDF source pin 后 build→Electron audit 已串行启动，结果待通知。
- 缺失 SDK/protocol 模块的实际版本/type-only/runtime-import 清单已核验；remote-protocol 工作区真实 schema 存在于参考源码但不在 vendored closure，不用 permissive stub 代替。后续按许可/闭包/构建边界引入，不为消类型错误自动接 native 服务。

## 分层验收与 P1 启动（用户选择，2026-10-12）

用户明确选择“分层验收推进”：完整 strict gate 保持失败，不再要求在 P0 提前实现 P7 等所有服务以消诊断。P0 inventory/implemented-contract 检查与后续功能阶段按依赖衔接；该选择不是将完整 gate 标绿。完整隐藏行为清单持续补充。

- 已批准从 source schema 核对 P1 Agent 蓝图/session/workspace 契约；首片为 additive reusable blueprint persistence，不能从历史标题/model 反推蓝图，不把 source claude-code 类型冒充 OpenCode，不静默启用权限/技能/workspace 行为。
- preference adapter 写失败/缺 backend/false ack 现真实拒绝，回滚并通知 key/global 订阅；支持非乐观更新与 same-key 串行，未知 options/BootConfig 写显式拒绝。23 个 preference tests、25 neighboring tests passed；完整实测 compat suite 21 文件/188 passed。
- 三个原样 Tiptap 源 patches 已启用，哈希与源锁一致，NOTICE 补齐 MIT base + Cherry AGPL contribution 边界；53 个未改动 source editor regressions passed，加 3 provenance tests 共 56 passed。
- provenance 初版错误全量解析巨大源 lock，超时后停止自己的 test task；修正为只解析 patch section。随后又修正 pnpm 12 hash-string lock 形状，最终 3/3 passed。未隐藏失败。
- patched editor+preference 后完整 build→Electron render audit 退出 0；完整 strict 最新记录仍 272 条/退出 2。
- 原生 save/openPath 实际 OS 手测、outer-scroll/drag 等仍待功能验收；版本与源 suite passing 不等价于完整 UI acceptance。

## P1 第一片：Agent blueprint 存储（2026-10-12）

- Additive schema v32 `agent_blueprints` 已完成；先核验 live schema v31，再选择 v32。无标题/model 推断，无现有 session/ai_session 回写，无第二业务数据库。
- 源形状字段包括 name/description/instructions/composite provider::model/plan/small model/configuration/disabledTools/MCP IDs/knowledge IDs/type；Grimoire runtime 单独保存，OpenCode 不冒充 source claude-code。
- `agent-blueprint.validation.ts` 保留未知非秘密 configuration keys，拒绝 builtin_role/env_vars/unsafe JSON；读 projection 移除 secret-bearing 值。MCP/knowledge IDs 只是惰性引用，不授予权限、不启动工具、不创建 workspace。
- CRUD、分页/搜索、orderKey、浅合并配置、soft archive/restore 已实现；`data.agentSession` attachment/snapshot namespace 现在可选接入现有 session，严格校验并保留旧 runtime 字段；attach/snapshot IPC/preload 已增量接入。该 namespace 是 Grimoire adapter extension，不是 Cherry MessageSnapshot parity。仍未实现 DataApi、workspace provisioning/skills、runtime enforcement、AgentPage。
- 15 个 blueprint + 9 个 session persistence tests 通过；最新 full root suite 报告 114 files/748 passed/2 skipped；root tsc 与 main build 通过；先前 full build 退出 0（`artifacts/cherry-full-build-p1.log`）。blueprint 存储分层检查通过；session namespace 的安全契约因独立核验发现问题而重新打开，不作已验收声明。fresh compat strict 仍退出 2、272 条诊断（`artifacts/cherry-compat-strict-typecheck.log`）。

## P1 中断恢复与独立核验

- 中断前 `/agents` read/PATCH 任务未落地；恢复后先检查现有文件，再继续，不将 stopped 子任务计为完成。
- 会话 namespace 独立核验确认五处缺陷：generic data replacement 擦除/注入 namespace；snapshot config root 非 object 仍接受；IPC 无效 agentId 被静默省略；部分 namespace identifier/path 字段校验不全；新 blueprint 关联和 snapshot provenance 未验证。正在修复，既有 9 个 service tests 不代表安全契约验收通过。
- blueprint imported configuration root array 原投影通过双重强制转换伪装为 object；已改为不投影非法根数组，保留 raw main blob 不作破坏性修复。新增真实 SQLite 回归，blueprint focused 16/16 passed。
- 源 Agent `type` 不含 OpenCode；source-shaped API 对无法表达的实体必须显式拒绝，不将 OpenCode 假装为 pi/claude-code，不静默过滤用户记录。

## P1 API 与会话安全收口（中断恢复后）

- `/agents` GET、`/agents/:id` GET/PATCH 已接 blueprint main store；source 分页 `{items,total,page}`、白名单 DTO、未知 modelName 返回 null；type=null（如 OpenCode）返回明确 409，不伪造 source AgentType。
- PATCH 拒绝未支持技能更新/readonly/runtime/type 字段，配置合并由 service 在 tx 中处理。当前 source API configuration 只支持已核对的 known-key 子集，未知扩展仍可在存储 service 保留，但此 API 尚未宣称完整 source extension parity。
- 实际写后 broadcast 已发出；preload 原 onDataChanged no-op 已替换为真正 `data-api:data-changed` 订阅/精确 unsubscribe，2 个真实 preload 装载测试通过。首版测试未隔离 mock 调用历史导致 identity 断言失败；已加 beforeEach mockClear，不隐藏失败。
- 独立发现的五处 session 缺陷已修复：generic legacy replacement 保留 main-owned namespace、拒绝注入/变更；private raw read 防止脱敏 DTO 写回破坏存储；config root plain object；identifier/path 校验；IPC invalid ID 拒绝；新关联验证 active blueprint；新 snapshot 校验 runtime/provider/model/association，显式 reassociation 不重算历史 snapshot。
- 48 个 focused safety tests 通过。完整 root suite 已重新执行退出 0，115 文件/823 passed/2 skipped（`artifacts/cherry-root-tests-p1-api.log`）；compat 22 文件/191 passed；root tsc 退出 0；完整 strict gate 仍退出 2、272 条，不把分层通过称为完整类型通过。
- 完整 build→Electron app 隔离 profile 的 source Agent read/missing/invalid/no-change smoke 退出 0；`artifacts/visual/cherry-routes/agent-api-smoke.json` passed=true，真实 preload/main/SQLite。fresh list items=[]/total=0/page=1，missing GET/PATCH=404，invalid query=400，不发 false change，unsubscribe=function。成功 mutation/creation 与真正 AgentPage 仍未因此覆盖。

## P1 source creation 真实 Electron 往返

- `ai.agent.create` source IPC 已提供 source pi → registered Grimoire pi 的 blueprint storage 创建；claude-code/dsh/unregistered runtime/nonempty skills/env/reserved fields 明确拒绝。无 runtime/session/workspace/heartbeat launch。
- 126 focused dispatcher+blueprint tests 通过；source list/detail/PATCH 继续保留严格 DTO 边界。
- 完整 build→`audit-cherry-routes --agent-api-smoke` 退出 0；fresh isolated Electron 实际 preload/main 创建→GET→PATCH rename→GET→list 成功，after total=1，committed changes=2（membership+projection）；no-op 和 DSH refusal 不发变更。证据 `artifacts/visual/cherry-routes/agent-api-smoke.json` passed=true。没有 provider key，没有触碰 production profile。
- P2 新源 shell seam 使用 original MainApp/TabsProvider/AppShell/TabRouter 与完整真实 routeTree，独立 build/output。首次缺 xyflow、随后 croner/qrcode/AI-SDK React；源码版本逐项确认后补齐。独立 shell build 现退出 0（11,973 transformed），source staging 63 owned files --check 通过；旧 compat build 回归退出 0，23 文件/197 tests 通过。实际 Electron 已挂 source tabbar/sidebar，但默认工作页 GET /agent-sessions/latest 触发 error boundary，smoke 退出 1，不能把 compilation 当作运行完成。真实 shell 日志暴露的 window is_maximized/minimum/reset/get_init_data 已接入 sender-scoped main adapter；navigation readiness/open-route 已接入真实注册 shell、bounded FIFO 和 source event。独立 source-shell smoke 现退出 0：MainApp/AppShell/TabsProvider/TabRouter真实挂载，真实 CDP 点击创建/切换/恢复 home+launchpad tabs，真实 navigation.open_route_in_main 复用现有 launchpad tab，no fatal fallback/uncaught source exception。证据 `artifacts/source-shell/smoke.json` checks 全 true；截图已保存但本环境图像传输无法复核视觉像素。mini-apps/agent-channels/backup auto-sync 仍是独立后端缺口，需保留显式 diagnostics。

## P1 Topic foundation 与 P2 shell runtime acceptance

- schema v33 additive `topic_tree_state`/`topic_tree_messages` 已落地；显式 opt-in 初始化 root，不采用 legacy session history。append/select/path cursor、cross-topic guards、rollback、same-session isolation 通过 11 focused SQLite tests；full root suite 117 files/912 passed/2 skipped，main/full build passed。状态仍 PARTIAL：GET/POST /topics/:id/messages + source PUT /topics/:id/active-node 现已接 v33真实服务，153 focused dispatcher/service tests通过，7个real fixture覆盖隔离/cursor/跨Topic/rollback/effects。未接 runtime send/siblings/duplicate/file relation，legacy unresolved topic明确501；未新增虚构初始化endpoint，只有显式service opt-in。
- isolated source shell build exit 0；real Electron smoke `artifacts/source-shell/smoke.json` checks 全 true：MainApp/AppShell/TabsProvider/TabRouter、source 工作页、真实 CDP mouse 创建 launchpad tab、tab restore、real navigation.open_route_in_main 激活既有 tab、无 fatal/uncaught。该 smoke 不覆盖 backup/mini-app/agent channel 后端，也未做 OS protocol ingress。

## P3 OpenCode / Pi runtime turn foundation（2026-10-13）

- OpenCode/Pi UI migration remains out of scope for this session. `src/main/services/agent-runtime-turn.service.ts` now owns the shared bounded turn loop used by both `ai-sessions.ipc.ts` and `agent.ipc.ts`; each caller retains its own persistence/broadcast/permission sink. The runner rejects non-terminal EOF, propagates failure/cancel distinctly, limits recursive host-tool turns, and executes only `toolOwnership:'host'` batches. Native runtime tool telemetry is never re-executed by Grimoire.
- Pi wrapper now accepts main-owned provider/model configuration, writes an isolated temporary `models.json`/`auth.json` directory (cleaned on close/exit), uses a Grimoire-owned session directory only when explicitly supplied, passes a stable session id for native persistence, and disables native tools/extensions by default until an approval handoff is proven. Composite `provider::model` ids are reduced to the wire model id inside the adapter. Pi SDK DIRECT_REUSE remains an audited next step, not a false completion claim.
- OpenCode remains the managed loopback HTTP/SSE wrapper. Native remote-session references can now be supplied and read at the adapter boundary; AI metadata and Agent `data.agentSession.runtimeSessionId` retain the main-owned mapping after `session-started`. The global managed-process owner, cursor persistence/reconnect, and full native permission/tool parity remain open.
- `package.json` electron-builder `extraResources` now includes `resources/agent-runtimes`; `npm run pack` succeeded and `release/win-unpacked/resources/agent-runtimes/{pi/pi.exe,opencode/opencode.exe}` were verified present. Focused runtime/IPC/session tests: 98 passed; mock-provider integration: 9 passed; full root suite: 131 files / 1248 passed / 2 skipped; `npm run build:main` and full `npm run build` passed. Real binary evidence also passed: `p3-runtime-smoke.mjs` (Pi 1.0.1 idle/abort + OpenCode 1.18.34 health), `opencode-headless-smoke.mjs` (fake-provider text `mock ok`), and `pi-headless-smoke.mjs` (fake-provider text `pi ok` + native session-file persistence). Migration-audit and complete native capability parity remain outstanding; statuses stay `PARTIALLY_MIGRATED`.
- source shell failure 已转化为实际接线：window min/max/init/reset sender adapter、registered navigation shell、bounded readiness queue、preload navigation event channel；61 navigation +31 window +3 preload effects tests，source smoke exit 0。
- 两个不同 entry 使用不同 router 合同，默认 compat config 不包含 owned source-shell-generated entry；其真正 full source-shell strict config 显式 exclude=[] 覆盖继承，保留完整 source 检查。曾因继承 exclude 得到 1 条诊断的虚假弱检查已纠正，source-shell 仍309 条/退出2；默认 compat 273 条（含 owned staging .mjs 缺声明，随后补精确 .d.mts）。此分界不排除 vendor imported source、不隐藏原 gate。
- shared source-navigation event 映射首次缺失导致真实 producer smoke 失败；修正 main channel/preload inline 常量+映射后再跑通过，新增 channel parity test 防复发。
- P3 audit 确认 host tool loop每次创建 runtime session 与重复执行 Pi/OpenCode native tool 风险；现已使用 stable session lease 和 explicit host/runtime tool ownership。仅 completed.toolCalls 明确 host-owned 才执行 registry；Pi/OpenCode telemetry 仅呈现。87 focused tests +119 files/998 passed/2 skipped 子任务验收；独立重跑24个lease/adapters tests通过。Pi update→progress、payload-free settled、agent_end text/retry 与 OpenCode text/reasoning separation 已纠正。实际 binary协议smoke正在执行，未猜 endpoint、不宣称Pi权限/recovery。
## P3 actual binary smoke 与整合回归

- credential-free isolated Pi1.0.1 actual JSONL get_state→abort→get_state 成功，同session、idle、0messages、process exit0；OpenCode1.18.34 source-defined /api/health HTTP200 healthy，owned process清理。证据 `artifacts/p3-runtime-smoke.json`。只验证idle RPC/health，不代表模型请求/工具/权限/recovery/fork。
- fresh root full suite 119files/1005passed/2skipped（`artifacts/cherry-root-tests-current.log`）；full build退出0。
- source tab lifecycle smoke扩展真实 close/settings/Reload persistence/新document ready+导航，最终两次exit0。保留timestamp evidence `artifacts/source-shell/2026-10-11T21-06-55-543Z-55728/`；真实tab IDs/routes/active settings在reload后恢复，无uncaught。截图传输仍无法视觉复核。
- source Agent workspace repository schema v34 已落地：空表无legacy inference；真实user目录只注册不mkdir，system路径main派生并显式准备，path aliases/managed root/引用删除保护。source session readmodel schema v35一对一现有runtime ID、workspace join、conversation/trash/activity/order/entity cursor、创建/修改/工作目录变更事务已落地。81 focused5suite tests通过，main/root类型通过；transport GET/list/latest/detail/POST/PATCH/PUTworkspace现已接真实sidecar，166 focused dispatcher+sidecar tests通过，no-op/invalid不发effects，system row no mkdir；legacy409/background-trash exclusion保留。真实源AgentPage选择/会话展示正在Electron核验。
- 新sidecar FK使workspace downgrade fixture先删parent失败；修正依赖先删除agent_session_read_model+try/finally关闭fixture后18 workspace tests通过，未削弱数据保护断言。
- main-frame admission guard已接入window/navigation dispatcher，注册sender+exact local artifacts+真实senderFrame===mainFrame、拒绝subframe/remote/stale；41 guard tests通过；真实source-shell close/reload/navigation smoke加入admission后exit0。

## P4 mapped AgentPage 实际展示闭环

- source workspace GET/POST(new201/reused200)/detail PATCH/order 与session GET/list/latest/POST/PATCH/PUTworkspace已接；真实joined sidecar，不复制history；reuse_or_create源IPC已接exact predicates+idle安全偏差，system-only重复placeholder清理事务，unsafe purge拒绝，185focused tests通过。
- 真实source-shell Electron smoke已创建pi蓝图+mapped session，实际点击source蓝图激活real session route/tab/conversation-main/message-list/composer，再PATCH rename并验证detail/list/latest相同workspace与UI tab名；保留PARTIAL exit1，因为消息读取/prewarm/file.tree尚未接入，phantom model404不伪造。
- Message read facade已读取真实events并保留sequence/IDs/text/tool history，32realSQLite tests通过；GET `/agent-sessions/:id/messages` 与 detail transport 已接真实服务，严格区分 empty history 与 greeting，model known detail GET已实现，unknown fixture真实404。真正源stream open/attach/detach/abort/approvals未因此可用，不得将mounted greeting当作空history已成功加载。
- runtime OpenCode EOF/abort后独立40adapters/lease tests通过；最新root full122files1111passed/2skipped。

## P4 bounded file-tree and turn persistence slices (2026-10-12)

- Cherry `file.tree.*` received a dependency-backed `PARTIAL_EXTRACTION`: source directory-tree builder/manager/watcher/gitignore/scanner/event primitives are retained under `src/integrations/cherry/file-tree/`, with exact `chokidar@4.0.3`, `ignore@7.0.6`, and `zod@4.3.4` dependencies and source SHA-256 provenance. Main `CherryFileTreeService` authorizes only registered main-owned Agent workspaces, checks lexical + real-path containment and every symlink/junction component, binds trees to the requesting WebContents, queues mutations until explicit activation, and cleans up on navigation/destroy/process-gone. Missing roots, `watchMissingRoot`, depth beyond one, rename and unsupported options return explicit errors; no mkdir/write/trash/database mutation is claimed. Five service tests pass; three IPC-adapter tests and a preload owner-channel test pass. Native chokidar uses the source watcher path in production; this Windows host's focused tests inject source polling because native fs-event initialization aborts in this environment.
- The file-tree IPC adapter is now wired through source `ipcApi.request('file.tree.*')` and preload `file.tree.mutation`; it remains a shallow read/watch capability, not full Files/Notes parity. A rerun of the real Electron source-shell smoke (fresh profile, owned PID cleanup) still stops honestly at the earlier source mount's `ai.agent.session.prewarm` / `close_warm` NOT_IMPLEMENTED response before reaching `file.tree.create`; therefore file-tree functional acceptance remains pending and no success is claimed.
- Agent turn persistence now has a bounded source-shaped reservation/reducer adapter on the existing `agent_session_events` table: atomic real user + pending assistant anchor IDs, versioned attempt/ordinal envelopes, ordered text/reasoning transitions, partial terminal error/paused preservation, restart pending lock, cumulative byte/event/part limits, strict allowlists and no secret/config copying. Existing flat history remains supported; unsupported attachments/edit/regenerate/tool/approval/recovery modes remain explicit. Focused message + turn tests pass (40 cases); main typecheck passes. This is persistence/lifecycle groundwork only: no runtime pump, source stream open/attach/detach/abort IPC, provider execution or approval bridge is claimed.
- After the file-tree/turn changes, the full `npm run build` gate passed (compat bundle, renderer, main, and copy step); the focused file-tree IPC/preload/service and turn/message suites passed (20 route/preload/tree/turn cases plus the 32 message cases). The first concurrent full `npm test` run did not emit its final Vitest summary before the harness stopped it, so it is not counted as a completed full-suite gate; a serial rerun with compact output completed cleanly: 127 test files, 1192 passed, 2 skipped (1194 total), 39.68s wall time.
- A main-owned `CherryAgentStreamCoordinator` now provides the next honest lifecycle seam around the turn persistence APIs: owner-token admission, injected real-runtime pump requirement, ordered publish/finalize/abort, bounded in-memory replay, attach cursor, terminal retention and explicit cleanup. Pump exceptions are generalized before persistence, and no runtime/IPC route claims stream success. Its focused suite is included in the latest 90-case focused result; root/main typechecks and `git diff --check` pass.

## P3/P4 runtime seam independent review (2026-10-12)

- A proposed custom `agent.stream` executable path was reviewed before acceptance. Provider existence is not selected-model injection, and silently ignoring native tool/approval events does not enforce blueprint permissions. Execution now fails closed before runtime launch and before message reservation; the custom lease transport is NOT the source topic-addressed `ai.stream` contract. Real source stream integration remains missing.
- Independent review found seven concrete lifecycle defects in the groundwork: terminal-budget exhaustion can strand pending state; abort can release admission before pump drain; destroyed terminal owners leak leases; replay can silently omit an evicted prefix; replay byte pressure can terminate generation; mutable snapshot/update references can diverge from SQLite; turn reads did not match the persisted attempt ID. These findings reopen acceptance of the coordinator slice; fixes and regression tests are in progress, not yet claimed passed.
- File-tree IPC now also requires registered trusted-main-frame admission. Malformed activate revisions and unavailable-owner rejection tests were added; file-tree IPC plus admission tests pass 45 cases. Bounded real Electron acceptance passed all 16 checks on the prior compiled artifact: actual add/remove watcher events, same treeId revisions 1→2, subscription-before-activate, dispose/reactivate=false, no post-dispose delivery over 3s, invalid/unregistered roots refused. Evidence: `artifacts/source-shell/2026-10-11T22-35-57-874Z-17756/smoke.json`; owned PID/profile/fixture cleaned. Initial short-path/canonical-path harness mismatch was corrected and failed evidence retained. Latest main compile now passes; guarded-artifact rerun is in progress. This bounded pass does not waive full prewarm/source-stream gates.
- SDK work is proceeding on the matching Pi package/native-ESM loader/provider injection seam; no import-only result will be called model/tool/approval acceptance. `readExternal` was verified to mean document text extraction with optional encoding detection, not binary reads; this slice therefore aligns existing Host declarations only instead of publishing a misleading replacement.

## UI-only plan reset and U0 inventory (2026-10-12)

- The execution scope is now UI-only: Cherry renderer routes, source shell/router/tabs, Home/chat interactions, AgentPage presentation against normalized external contracts, app/settings pages, dialogs/menus/panels, eligible windows and visual acceptance. OpenCode/Pi/Codex SDK/process/protocol/tool-loop/permission/session-runtime work is owned by another session and is excluded from this UI implementation.
- Fresh source inventory script: `scripts/audit-cherry-ui-inventory.mjs`; generated review handoff: `artifacts/cherry-ui-catalog/截图清单.json` and `截图清单.md`. It records 59 `createFileRoute` registrations, 25 current compat path/pattern entries, 8 source window roots and 3 non-renderer/not-applicable entries (70 rows total). The source/ledger 56-route count and 59-registration count are deliberately distinguished; neither is a completion percentage.
- Fresh strict compat result: `npm run typecheck:cherry-compat` exited 2 with 254 source diagnostics, preserved in `artifacts/cherry-compat-strict-typecheck-2026-10-12.log`. This remains an unsuppressed failing gate; no `noCheck`, imported-source exclusion or wildcard ambient API was added.
- U1 bounded route work added source settings redirects (`/settings`→provider, `/settings/system`→general, `/settings/code-execution`→appearance) and MCP nested visual surfaces (builtin, marketplaces, install, npx-search, provider diagnostic) to the compat route boundary. Compat build and main build pass; isolated route audit now reports all 33 route targets rendered, including new nested paths and redirects. This is route/surface evidence, not complete backend/action parity.
- At the U0/U1 checkpoint the screenshot catalog was only an inventory (`capture: pending` for every row). U7 later produced the flat Simplified-Chinese numbered catalog; see the U7 evidence section below. `manualAcceptance` remains pending.

## 保护规则

保持现有用户改动；源只读；不 reset/checkout/clean/commit/push；不全局杀进程。未通过已批准的分层自动化、Electron功能和源码行为审计，不推进完成状态；完整strict总门禁持续报告失败。历史数字只作为历史记录。

## U1 nested MCP 与 U3 source AgentPage evidence (2026-10-12/13)

- `CompatOutletProvider` 已接入 `cherry-chat-shell-entry.tsx`：MCP 路由不再绕过源 `McpSettingsPage` layout；`McpSettingsPage` 的真实 sidebar/active state/Outlet 现在包住 builtin、marketplaces、install、npx-search、provider diagnostic、servers 与 detail child。该 seam 明确是 compat hash registry 到 source layout 的适配，不是生成的 TanStack route tree。
- 接线后的串行验证：`npm run build:main` 退出 0；直接 compat Vite build 退出 0；`corepack pnpm vitest run src/route-registry.test.ts --reporter=dot` 为 1 文件 / 13 tests passed；`node scripts/audit-cherry-routes.mjs` 为 33/33 route targets rendered，包含 `/settings/mcp` 及五个 nested child。此前 audit 在 layout 接线前运行，不能代替本次证据。
- fresh `npm run typecheck:cherry-compat` 仍退出 2；本次 raw log 计数为 255 条 `src/` diagnostic（文件：`artifacts/cherry-compat-strict-typecheck-2026-10-12.log`）。这是 source/contract/dependency strict gate，未用 `noCheck`、import 排除或宽泛 ambient 声明清空。
- authentic source-shell smoke `node scripts/audit-cherry-source-shell.mjs` 退出 0，证据目录：`artifacts/source-shell/2026-10-12T10-02-47-572Z-47000/`。真实隔离 Electron 使用 source `MainApp`/`TabsProvider`/`AppShell`/`TabRouter` 和 source `/app/agents` → `AgentPage`，验证了空 AgentPage、蓝图/session 建立、system workspace joined readback、真实 session 行选择、持久化历史显示、source tab identity、rename/readback、new-conversation 路径，以及 tabs create/switch/close/reload/navigation。该证据属于 source-shell，不把默认 compat hash 入口标记为 AgentPage 已切换。
- source-shell smoke 同时记录了未桥接的 runtime/domain/window routes（例如 backup auto-sync）作为 capability blocker；因此 AgentPage 的 stream、approval、recovery、skills/commands、file/browser right-pane 和独立 window lifecycle 仍由外部 runtime/UI work package 继续，不以空/错误 fallback 伪造成功。
- 截至本节，截图目录仍是 `manualAcceptance: pending`；尚未把 source-shell smoke PNG 或旧 `artifacts/visual` PNG 误登记为 U7 catalog capture。

## U7 flat screenshot catalog evidence (2026-10-13)

- Added `scripts/capture-cherry-ui-catalog.mjs` and `npm run capture:cherry-ui-catalog`. It launches a fresh isolated Electron profile with `GRIMOIRE_CHERRY_ENTRY=source-shell` / `GRIMOIRE_UI_CATALOG_CAPTURE=1`, drives real source navigation and pointer-like sidebar interactions, asserts route identity/content/fatal fallback absence, then writes flat numbered Simplified-Chinese PNGs directly to `artifacts/cherry-ui-catalog/`. Failed assertions retain run diagnostics under `artifacts/cherry-ui-catalog-runs/` and never receive a PNG.
- The catalog now contains 79 controlled rows: 59 source route registrations, 8 source window rows, 3 non-renderer rows, and 9 interaction/source-shell/runtime-diagnostic rows. 66 PNGs are present: 59 route captures, the authentic source-shell main-window frame, and 6 verified data/source-shell/diagnostic frames. `截图清单.json` and `截图清单.md` record the exact filename, route/window, evidence, viewport, zoom and real-DPI limitation; the three unverified menu/panel/dialog rows stay pending.
- Real captured rows include source-shell launchpad/settings tabs, three DataSettings subpanels, and the AgentPage runtime capability diagnostic. Data panels were reached by clicking the source settings rail after landing on `/settings/data`; they were not captured by DOM injection. The session context menu, quick panel, and message confirmation dialog rows remain `pending` without PNG because this run did not perform their real pointer/keyboard action; ordinary `/app/chat` frames are not treated as menu/dialog evidence.
- Thirteen rows intentionally have no PNG: three interaction rows still require real context-menu/keyboard/dialog actions, plus detached/quick-assistant/screenshot/selection/user-data relocation windows, Cherry v1 migration, and two non-renderer entries. The default main-window row is covered separately by the authentic source-shell startup frame. Their explicit reasons remain in `pendingNoPng`; no fabricated interaction or blocked-window image was added. `manualAcceptance` remains `pending` until the user reviews the folder.
- Fresh gates after the catalog tooling: root `npm test` = 131 files / 1247 passed / 2 skipped; compat suite = 23 files / 198 passed; `npm run build:main` exit 0; `node scripts/audit-cherry-routes.mjs` = 33/33; `npm run check:cherry-css` = 98.6% utility coverage; migration matrix = 111 rows valid; strict compat remains exit 2 with 255 diagnostics in `artifacts/cherry-compat-strict-typecheck-2026-10-13.log`.
- The catalog is a visual handoff, not a completion claim. Default packaged entry remains compat; source-shell build remains an isolated audit target. Runtime-owned stream/approval/recovery and blocked native windows remain named blockers.

## Real interaction and capture-evidence repair (2026-10-14)

- Previous 66-PNG acceptance is reopened: legacy catalog rows had no identity-bound state assertions/hash, some signals matched shared chrome, and the reconciliation script promoted filenames to success. Old PNGs remain historical references, but no longer count as verified captures. The current manifest has 79 rows, 2 verified interaction PNGs and 77 pending revalidation rows; manualAcceptance remains pending.
- `scripts/cherry-ui-capture-evidence.mjs` now requires matching surface identity, PNG SHA-256, entry, observed route and passed assertions. Interactions additionally require CDP input provenance and visible nonzero bounds. A Node regression test covers missing evidence, mismatched identity/bytes, zero bounds and evidence preservation; 1/1 passed. Inventory preservation uses identity rather than sequence; merger does not promote files merely because they exist.
- `audit-cherry-source-shell.mjs --interactions` drives actual CDP right-button input, the source composer launcher and the persisted message delete toolbar. Successful run `artifacts/source-shell/2026-10-13T17-04-21-527Z-16176/` verified menu open/Escape and message delete-confirm/Cancel with exact persisted message retained, isolated profile verified and removed. Those two frames were imported with verified provenance; their entry is source-shell `/app/agents`, not compat `/app/chat`.
- QuickPanel was truly opened/dismissed, but its first screenshot measured only ~12px height during animation, so it was refused for catalog acceptance. Later settled-state runs failed before capture: Agent prewarm rejected the fixture provider endpoint and persisted source history did not appear. Failed evidence directories ending `22352` and `29104` are retained. Next action: repeat the UI journey against the external normalized runtime/readiness contract without bypassing prewarm or injecting renderer state.
- Added source `CompatFilePreviewPage` wrapper and `/app/file-preview` default compat route. Source `parseFilePreviewRouteSearch` validates reactive query paths; absent/relative paths render the source invalid-path state. Two wrapper tests plus 13 registry tests pass; compat bundle/main builds pass; isolated route audit 34/34 rendered, asserting the distinctive invalid-path description. Valid-file MIME/read/preview workflows still need functional acceptance; this is not complete FilePreview parity.
- Remaining settings descriptor/search/model/usage/archive work from the approved wave was not implemented at that checkpoint. No runtime implementation/source vendor edits/default-entry switch/commit/push occurred.

## Remaining settings URL coverage and settled interactions (2026-10-14)

- Added `settings-route-descriptors.ts` + `CompatRemainingSettings.tsx`: 15 previously missing fixed settings URLs and 2 skill/task detail patterns now render full main-slot BLOCKED diagnostics, not provider/chat fallbacks. Each names its source component (not mounted), missing backend/consumer and next action. Safe parameter decode, invalid-ID diagnostics and fixed-before-detail precedence are tested. This closes URL handling only; it does not complete source settings functionality.
- Source settings families still blocked: API Gateway/browser/channels/device pairing/document processing/local models/OCR/quick assistant/screenshot/selection/websearch/skills/scheduled tasks. Model/Search remain blocked on actual preference consumers/search validation/scoped context/pending-focus semantics; no fake settings search results or effective-looking toggles were added.
- Fresh source-shell interaction run `artifacts/source-shell/2026-10-13T18-37-25-726Z-59640/` passed real menu right-click/Escape, settled QuickPanel (736 × 297.6 CSS px), ArrowDown active-row transition, Escape and unchanged message IDs, plus message delete-confirm/Cancel with exact persisted message retained. Profile isolation and removal passed. Three interaction frames are now verified by identity/hash/action/assertion and survive inventory refresh. This run does not test tabs/reload or provider execution.
- `audit-cherry-routes --catalog-diagnostics` now checks the actual diagnostic element, its current hash/route text, missing-contract/source-not-mounted labels and nonzero bounds before registering 17 diagnostic PNGs. Together with 3 real interaction PNGs, current catalog has 79 rows, 20 verified frames and 59 pending revalidation rows. Old PNGs remain historical only. Filenames for newly inventoried settings use Simplified Chinese. manualAcceptance remains pending.
- Verification: focused parent tests 3 files/64 passed; full compat suite 25 files/249 passed (`artifacts/cherry-compat-tests-2026-10-14.log`); main + compat builds exit 0; isolated route audit 51/51 rendered (includes blocked diagnostics, not 51 functional pages); evidence-guard test 1 passed; unsuppressed strict compat exit 2/255 diagnostics in `artifacts/cherry-compat-strict-typecheck-2026-10-14.log`.
- The broader settings migration remains partial: source layouts/search/model consumers, usage query semantics, archive unsupported actions and native lifecycle were not completed at this checkpoint. No vendor source changes, runtime implementation, default entry switch, commit or push.

## Authentic source SettingsPage/Search/Model integration (2026-10-14)

- Default compat now mounts the unchanged source `SettingsPage` layout with canonical sidebar, `SettingsSearchDomIdsProvider`, source search box, focus URL translator and focus-scroll consumer. Existing setting/MCP children flow through nested `CompatOutletProvider`; no source file modified.
- `/settings/search` renders real source `SearchResultsPage` and aggregate/ranking engine, not the prior diagnostic. Router seam now supports bounded source history/back, functional search updaters evaluated at navigation time, source q byte-limit validation and `from` reads. Three router tests passed.
- Real isolated Electron journey passed source search button click → CDP typing “右键菜单样式” → actual ranked results → Enter → appearance route, plus one-shot focusId removal. Screenshot `artifacts/visual/cherry-routes/source-settings-search.png`; passed evidence existed before adding the separate model-selection journey. Current combined action report is failed because model picker has no available fixture row; do not claim entire action suite passed.
- `/settings/model` renders unchanged source ModelSettings with four selectors, validated reactive focus, persisted source cascade and independent painting preference. Source props disable unsupported configuration drawers and auto-fill-on-entry; visible note separates persistence from execution consumers. Eight tests exercise real source page/preference/query hooks (picker presentation mocked). Actual Electron mounted page passed render assertions, but live model-selection acceptance failed: stored enabled fixture provider lists gpt-4o, while selector shows no available models. Next action: repair the picker catalog/availability contract and rerun actual selection/readback; no persistence success claimed for this journey.
- Fixed catalog-metadata precedence in compat model-selector shim: known capabilities no longer get erased by configured-ID placeholders. Regression test passed; this does not itself resolve the live empty picker.
- Full compat suite 28 files/261 passed; compat build exit 0; 51 route targets render with real search/model pages (others still diagnostic where backend missing). Fresh strict compat remains exit2/254 diagnostics (`artifacts/cherry-source-settings-strict.log`).
- Remaining required pages/backends and usage/archive semantics remain pending; this wave advances source layout/search/model UI, not complete settings parity. Default entry type remains compat, vendor source read-only, no commit/push.
