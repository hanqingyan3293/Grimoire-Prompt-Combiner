# Cherry Studio UI 迁移交接摘要

> **状态快照：2026-10-27**  
> 本摘要面向接手开发的 Agent。工作树包含用户与其他协作会话的未提交改动，必须先查看 `git status` 再改文件。**禁止 reset、checkout、clean、覆盖或删除改动；禁止 commit/push。** `src/vendor/cherry/source` 是只读源代码。

## 项目当前目标

继续完成 Cherry Studio 2.1.4 的 **UI-only 源级迁移**，范围包括源页面、路由、设置、交互、状态呈现和截图验收。

- OpenCode/Pi/Codex runtime、provider 执行、工具循环、审批、恢复和 native runtime 权限由其他工作流负责；当前不得实现第二套 runtime。
- UI 只消费规范化应用合同，不得按 `pi`、`opencode` 或 `codex` 名称分支。
- 默认 packaged entry 仍是 Grimoire compat/hash shell；真实 Cherry `MainApp` 的 `source-shell` 仅供隔离审计，**不要切换默认入口**。
- 目前仍须逐页核对操作、持久化、错误和状态；路由能打开、页面能渲染或截图存在，都不代表 UI parity。
- 用户要手动验收扁平中文编号截图目录。清单 `manualAcceptance` 未经用户确认必须保持 `pending`。

## 已完成模块与状态

### Shell 与路由

- **真实 source-shell：`PARTIALLY_MIGRATED`。** 已用 Cherry `MainApp`、`TabsProvider`、`AppShell`、`TabRouter` 和真实 `AgentPage`，曾在隔离 Electron 中验证 tabs、导航、蓝图/session、workspace、历史显示和重命名。
- **默认 compat shell：`PARTIALLY_MIGRATED`。** 使用 Grimoire hash 路由和 source 子页面，不等同完整生成的 TanStack Router。
- **MCP 嵌套布局：`PARTIALLY_MIGRATED`。** 真实 `McpSettingsPage` 通过 `CompatOutletProvider` 包含服务器列表、详情、内置、市场、安装、NPX 搜索和提供商诊断。
- **文件预览：`PARTIALLY_MIGRATED`。** 新增 compat wrapper，复用源路径解析及无效路径状态；有效文件的读取、MIME 和预览流程仍未验收。

### 设置页面

真实 source layout、搜索和模型页面已挂载到默认 compat：

- `SettingsPage` 源布局、侧栏、搜索框、focus URL 和 focus-scroll context。
- `/settings/search` 使用源 `SearchResultsPage` 与真实排名引擎。曾隔离 Electron 实测点击搜索、输入“右键菜单样式”、显示结果、Enter 跳转到外观页，并消费一次性 `focusId`。
- `/settings/model` 使用源 `ModelSettings`，包含四个选择器和 validated focus。未接入的执行消费者、配置侧栏已明确说明/禁用。
- 已有不同程度 source mount/adapter 的路由：Provider、MCP、Appearance、Data、Dependencies、Notifications、About、Prompts、Usage、Shortcut、Archive。
- 最近接入的部分源设置页面：
  - Browser、Screenshot：源页面只读挂载，使用 native disabled boundary；Browser history/import/clear 与 screenshot 全局行为不可操作。
  - Document Processing、OCR：源页面使用真实处理器发现请求；请求拒绝时显示源加载错误，不伪装为空数据。
  - Local Models：源 `LocalModelsSection` 已挂载，local model 服务不可用时明确说明目录未知。
  - General、API Gateway、WebSearch、Selection Assistant 正在临时工作树中接入只读/安全边界；**必须先检查当前文件状态并编译验证，不要假设这些更改已完成或安全。**

未接通服务的设置地址已有 descriptor-based 全屏 `BLOCKED` 诊断：API Gateway、Browser、Channels、Device Connections、File Processing、Local Models、Model/Search 部分合同、OCR、Quick Assistant、Screenshot、Selection、WebSearch、Skills、Scheduled Tasks。Skills/Tasks 的 source wrappers 虽存在，但是否已接入 shell需检查最新代码。

### 模型选择器

- 根因已定位：源 `ModelSelector` 通过相对导入 `./useModelSelectorData`，之前的绝对 Vite alias 没拦截，picker 实际读取未适配的源 `/models`。
- 已添加精确 alias，并修复兼容 hook：
  - configured provider 的模型作为 fallback；
  - disabled provider/model 不出现在候选；
  - catalog 的 capability metadata 优先，避免 placeholder 覆盖已知能力；
  - 复用源 tag/filter contracts，稳定 source picker effect callbacks。
- 真实 source picker integration tests 覆盖 configured-only `gpt-4o`、disabled provider、image capability。
- 最新隔离 Electron source settings action 报告曾验证 selection 写入 `cherry_pref.chat.default_model_id`，并按源级联写 quick/translate preference。再次确认当前日志、测试和源码后再把这条算作最新证据。

### 真实交互截图

- source-shell AgentPage 使用 CDP 鼠标/键盘完成：
  - 会话行右键菜单打开和 Escape 关闭；
  - QuickPanel 实际打开、稳定后截图、ArrowDown 切换活动项、Escape 关闭，消息 ID 无变化；
  - persisted message delete confirmation 打开，Cancel 后精确 message ID 仍在数据库。
- 最近通过统一 evidence guard 的帧保存在 `artifacts/cherry-ui-catalog/`；证据 run 位于 `artifacts/source-shell/`。
- **重要：** 旧截图目录曾错误地把普通页面 PNG 认作菜单/弹窗成功。当前仅接受 route/surface identity、真实 action、可见非零 bounds、assertion、PNG SHA-256 和成功退出码都匹配的 capture。不得仅凭 PNG 文件存在重标 `passed`。

### 凭据隐私边界（进行中）

- `src/shared/cherry-settings-privacy.ts` 为 API Gateway key、WebSearch provider overrides 中的 API key/token/password/header secret 提供脱敏和拒绝通用写入的函数。
- `src/main/ipc/settings.ipc.ts` 已开始在 settings snapshot 中脱敏，并拒绝通用写入 protected keys。
- Compat preference shim 已开始在 cache snapshot 前再次脱敏，并在 optimistic update 前拒绝 generic secret writes。
- targeted root privacy tests 最近为 10 passed；preference-service focused suite 最近为 24 passed。需再次完整验证 malformed JSON 的 fail-closed 行为和所有生产入口。

## 关键架构决策及理由

1. **Cherry source 只读。** 适配只能放在 compat、`src/integrations`、main IPC/service、preload 或 Host 边界。
2. **source-shell 与默认 compat 分开。** source-shell smoke/build 证明的是独立入口，不授权切换默认 packaged entry。
3. **真实失败不等于空列表。** 缺少 backend 时应显示 rejected/error/diagnostic，不能用空 `[]` 或 `ok:true` 伪装能力存在。
4. **设置页面的只读 boundary 要原生且有审计。** 使用 React 原生 disabled controls/fieldset；不要以 MutationObserver 或图标 DOM selector 改写 React 按钮状态。
5. **密码遮罩不是安全边界。** API key、token、密码和 Authorization header 必须在主进程投影和 renderer cache 前脱敏；generic write 应失败，mask placeholder 不能覆盖真实密钥。
6. **截图验收按来源和动作。** source-shell、compat、blocked diagnostic 是不同 entry/status；不把一个入口的截图说成另一个入口的 parity。
7. **未验证运行状态必须标明。** strict compat 类型门禁此前多次是 exit 2、约 254–256 条 vendor/source diagnostics；每轮都需 fresh raw log，不可沿用旧数字。

## 核心文件清单及其职责

| 文件                                                                               | 职责                                                                                                                                        |
| ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/vendor/cherry/compat/src/route-registry.ts`                                   | Compat hash routes、source path aliases、MCP/Skills/Tasks detail ID 验证。                                                                  |
| `src/vendor/cherry/compat/src/settings-route-descriptors.ts`                       | 缺失设置页 source symbol、缺少能力和 next action。                                                                                          |
| `src/vendor/cherry/compat/src/cherry-chat-shell-entry.tsx`                         | 默认 compat shell 与 app/settings 页面 dispatch。                                                                                           |
| `src/vendor/cherry/compat/src/shims/tanstack-router.ts`                            | Source settings 的 bounded `useNavigate/useSearch/useLocation/useParams/useRouter/Outlet/Link` shim；正在完善 source Link/history/blocker。 |
| `src/vendor/cherry/compat/src/CompatModelSettings.tsx`                             | Source ModelSettings wrapper 与 execution-capability说明。                                                                                  |
| `src/vendor/cherry/compat/src/CompatProcessingSettings.tsx`                        | Source document/OCR settings wrapper，保留真实 processor error。                                                                            |
| `src/vendor/cherry/compat/src/CompatLocalModelsSettings.tsx`                       | Source local-model UI wrapper，backend unavailable 保持可见。                                                                               |
| `src/vendor/cherry/compat/src/CompatSourceSettings.tsx`                            | Browser/Screenshot/General/ApiGateway/WebSearch/Selection source mount + read-only/security boundary；本文件近期还在改变，优先检查。        |
| `src/vendor/cherry/compat/src/CompatSkillsSettings.tsx`、`CompatTasksSettings.tsx` | Source Skill/Task页面 wrappers；详情涉及 `useBlocker` 和真实 service contracts。                                                            |
| `src/vendor/cherry/compat/src/CompatSettingsActionBoundary.tsx`                    | Skills/Tasks wrapper action blocking；近期应采用 native React boundary，不得 imperative DOM mutation。                                      |
| `src/vendor/cherry/compat/src/shims/model-selector-data.ts`                        | Source picker 的 provider/model projection、capability metadata、过滤/tag logic。                                                           |
| `src/vendor/cherry/compat/vite.shared.config.ts`                                   | Source/compat Vite alias；ModelSelector 的 relative `./useModelSelectorData` alias 是 picker 修复关键。                                     |
| `src/shared/cherry-settings-privacy.ts`                                            | Protected preference key 标识与脱敏。                                                                                                       |
| `src/main/ipc/settings.ipc.ts`                                                     | 主进程 settings read/write、settings side effects 和凭据边界。                                                                              |
| `src/vendor/cherry/compat/src/shims/preference-service.ts`                         | Source PreferenceService adapter、settings snapshot 与 renderer cache。                                                                     |
| `scripts/audit-cherry-routes.mjs`                                                  | Isolated compat Electron route/content/action audit；当前 includes search/model settings actions。                                          |
| `scripts/audit-cherry-source-shell.mjs`                                            | Authentic source-shell smoke；`--interactions` 运行真实菜单/QuickPanel/消息确认旅程。                                                       |
| `scripts/capture-cherry-ui-catalog.mjs`                                            | Manifest-driven flat screenshot catalog runner。                                                                                            |
| `scripts/cherry-ui-capture-evidence.mjs`                                           | Evidence identity/PNG digest/visible-bounds/action guard。                                                                                  |
| `scripts/audit-cherry-ui-inventory.mjs`、`merge-cherry-ui-catalog-captures.mjs`    | Catalog inventory/reconciliation；必须 preserve identity-bound evidence，不按 filename 自动标通过。                                         |

## 已知遗留问题

- **完整源设置树仍未迁移。** 当前正在增量挂载一些可读-only/source error state；API Gateway、WebSearch、browser history、Screenshot native action、Channels、Device connections、Skills/Tasks、Search/Model consumer contracts 等还有真实缺口。源组件挂载不代表操作闭环。
- **Secrets boundary 要完整审计。** `settings.getAll` 当前返回整个 settings map；若对 nested provider overrides/redaction失败必须 fail closed。generic preferences 不能接收这些 secrets。
- **Model picker 本轮状态需确认。** 当前 source alias/tag fixes 已到达，但 latest live action may fail because settings fixture is in inactive user profile or component data; check `artifacts/visual/cherry-routes/settings-actions.json`, recent alias and source test before claiming pass.
- **Usage 数据合同**尚未完整满足 source 的 range/group/metric/sort/cursor。已有 stored tokens，不代表所有 source charts valid。
- **Archive**虽有 list/restore 某些域，文件 refs、trash/purge/retention 和部分 restore/delete actions 不完整。
- **Skills nested detail**需要安全 `useBlocker`，文件写/flush 依赖明确 refusal；没有 skill catalog 时不能假称真空列表。
- **QuickPanel、菜单和弹窗截图**每次重采集都必须确保 settled visible bounds/action state，否则保留 pending。
- **截图目录仍需人工验收**：`artifacts/cherry-ui-catalog/截图清单.json` 的 `manualAcceptance` 在用户明确确认前保持 `pending`。
- **严格 compat typecheck仍失败**。需 fresh raw log，不能使用 `noCheck`/排除 source。
- **source-shell smoke runtime prewarm/stream remains blocked**；不要伪造 Agent generation success。

## 建议的下一步

1. 立即运行并修复完整 compat suite（当前最近一次 suite **1 failed / 34 passed / 2 failed tests**，失败在 `CompatSourceSettings.test.tsx`，断言仍将现已只读挂载的 API Gateway/WebSearch 视作未挂载）。按最新真实 scope 更新测试，不要降级 privacy tests。
2. 检查 `CompatSourceSettings.tsx` 最近增加 General/API Gateway/WebSearch/Selection mounts；逐项静态审计真实 mount effects、secret reads、native controls、portals/link interactions，别只依赖 disabled fieldset。若组件在 mount 时自动读密钥/写偏好/构造副作用，先修主进程投影再加载该 page。
3. 完成 Settings Search / Model：
   - Source SettingsPage links requires `Link` shim; recent implementation刚写，确保 test + build + actual route。
   - source ModelSettings真实 picker通过 configured fallback修复后，需 actual Electron click + preference readback，而不是只测 wrapper hooks。
   - 对未验证消费的 quick/translate/painting settings effects继续报告 partial。
4. 逐个 source-mount诚实页面：
   - Browser 只读源页面：先修其效应说明。它 screenshot 上真实 toggles显示 ON，但 boundary禁用，只能称“stored values displayed, actions disabled”，不能说字段非活动/没有配置。
   - Screenshot source currently只在 Windows适用，其他 platform留 diagnostic；校验其 `Link` target/source shortcut conflicts。
   - FileProcessing/OCR源 error state testing现在应通过（当前 compat test 的 selector预期曾错翻译key）。
   - Skills/Tasks wrappers当前不再使用 MutMutationObserver，但 source Card action trigger coverage测试请审查完整。
   - General mount需核对所有既有 main consumers；不能一刀切称未接入。
5. 真正完成源设置布局交互：SearchBox结果点击/键盘焦点、输入退格/历史、focusId滚动；直接 URL/参数；MCP nested Outlet；Layouts画面职责。
6. Run serial:
   - compat focused + full tests
   - `npm run build:cherry-compat`, `npm run build:main`
   - `node scripts/audit-cherry-routes.mjs` (verify destination content: last run new audit 3 false failures appearance/notifications due stale signals)
   - `node scripts/audit-cherry-source-shell.mjs --interactions` only after current source artifact ready
   - fresh strict compat tsc/log, matrix check, secret-canary scan, CSS check
7. Catalog PNG invalidation rules刚加强：仅 captured evidence通过 identity+hash+action bounds可留。重新采集只在验证成功后copy evidence/PNG；不应运行无条件 merger/inventory来抹去或自动复活旧证据。
8. Update status/matrix with tested outcomes, no completion percentages or assumptions. Do not touch `src/vendor/cherry/source`, do not alter default application entry, no commits/push.
