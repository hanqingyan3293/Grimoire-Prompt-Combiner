# Cherry Studio UI 迁移交接摘要

> **快照时间：2026-10-27**  
> 本文件交接的是当前未提交工作树的真实状态。不要 `reset`、`checkout`、`clean`、覆盖或删除现有改动；不要 commit/push；`src/vendor/cherry/source` 为只读。

## 1. 项目当前目标

完成 Cherry Studio 2.1.4 的 **UI-only 源级迁移**：路由、真实源页面、设置、菜单、弹窗、状态呈现、窗口边界和人工截图验收。

- UI 仅消费 Grimoire 的规范化合同；不得按 `pi`、`opencode` 或 `codex` 名称分支。
- Pi/OpenCode runtime、provider 执行、工具循环、审批、恢复和 native runtime 权限由另一会话负责，当前不能补造第二套 runtime。
- 默认 packaged entry 仍是 Grimoire-owned compat/hash shell；`source-shell` 是真实 Cherry `MainApp` 的隔离审计入口，**不得默认切换**。
- 用户最终要求：所有可真实采集的 Cherry renderer 表面放到一个扁平截图目录，中文分类+全局序号，用户手工验收；无法真实运行的窗口/非渲染器必须写明无 PNG 原因，不能伪造成功截图。

## 2. 已完成模块与状态

### 2.1 源闭包、shell 与路由

| 模块 | 状态 | 已有证据 / 说明 |
|---|---|---|
| Cherry source closure | `VENDORED` | `src/vendor/cherry/source` 已有完整源闭包，必须只读。 |
| 真实 source-shell | `PARTIALLY_MIGRATED` | `source-shell-entry.tsx` 使用真实 `MainApp`、`TabsProvider`、`AppShell`、`TabRouter`。历史 isolated smoke 验证 tab 创建/切换/关闭/reload、导航和 AgentPage 会话选择。 |
| 默认 compat shell | `PARTIALLY_MIGRATED` | `cherry-chat-shell-entry.tsx` 使用 hash registry + source Chat/Settings 子树；不是完整 TanStack generated router。 |
| MCP 嵌套设置 layout | `PARTIALLY_MIGRATED` | 真实 `McpSettingsPage` 通过 `CompatOutletProvider` 包含 servers/detail/builtin/marketplace/install/npx/provider diagnostic child。 |
| `/app/file-preview` | `PARTIALLY_MIGRATED` | 已新增 `CompatFilePreviewPage`，复用源路径校验和无效路径 UI；有效文件 MIME/读取/预览尚未验收。 |

### 2.2 已真实挂载的设置页面

以下页面由真实 Cherry source component 或 source layout 驱动，不代表每个操作的后端已完成：

- `SettingsPage` layout：源侧栏、搜索入口、`SettingsSearchDomIdsProvider`、focus URL/scroll。
- `/settings/search`：源 `SearchResultsPage`，已实际 CDP 输入“右键菜单样式”→结果→Enter 到 appearance，且 `focusId` 一次性参数已消费。
- `/settings/model`：源 `ModelSettings` 四个模型选择器；配置抽屉通过 source prop 禁用，避免未接通执行链。
- `/settings/provider`、`/settings/mcp*`、`/settings/appearance`、`/settings/data`、`/settings/dependencies`、`/settings/notifications`、`/settings/about`、`/settings/prompts`、`/settings/usage`、`/settings/shortcut`、`/settings/archive`：已有不同程度 source mount/adapter。
- `/settings/file-processing`、`/settings/ocr`：源页面已接入，真实 `file_processing.list_available_processors` 拒绝时显示源加载失败，不能把它看成“没有处理器”。
- `/settings/local-models`：源 `LocalModelsSection` 已接入；`local_model.*` 后端未接入，模型列表/下载/删除/加速操作未完成。
- `/settings/browser`、`/settings/screenshot`：source page 通过 native disabled fieldset 只读挂载；禁用了 preference/action/dialog入口，未提供 fake TabsProvider。
- 当前正在接入但**尚未完成构建/隔离 Electron 验证**：`/settings/general`、`/settings/api-gateway`、`/settings/websearch`、`/settings/selection-assistant` 的只读 source wrapper；交接者先编译再判断是否保留。

### 2.3 真实交互截图

已由 source-shell + CDP 的真实输入获得，不是 DOM 注入：

- 会话右键菜单：CDP right click 打开，Escape 关闭。
- 快捷面板：真实按钮打开，等待稳定后大小约 736×297.6 CSS px；ArrowDown 改变选中项，Escape 关闭，消息历史不变。
- 消息删除确认：真实删除按钮打开，Cancel 后通过精确 message ID 证明历史未删。

关键 isolated evidence：

`artifacts/source-shell/2026-10-13T18-37-25-726Z-59640/smoke.json`

截图目录：

`artifacts/cherry-ui-catalog/`

**重要：** 旧 catalog 曾按“PNG 文件存在/侧栏文字”标通过，已被证据门禁推翻。现在只有带 surface identity、PNG SHA-256、entry、observedRoute、可见 bounds 与 action/assertion 的帧可标通过。不要再把旧 PNG 直接回填为通过。

### 2.4 模型选择器修复

根因已确定并修复：源 `ModelSelector.tsx` 使用相对导入 `./useModelSelectorData`，原有绝对 alias 没拦截，实际 picker 落到源 DataApi `/models`，配置 provider 中的模型不显示。

当前改动：

- `vite.shared.config.ts` 增加精确相对模块 alias。
- `shims/model-selector-data.ts`：
  - catalog capability metadata 优先，避免 configured placeholder 擦除 image/reasoning capability；
  - configured provider 的 uncatalogued model fallback；
  - disabled provider/model 过滤；
  - 复用 source tag/filter 合同，去掉不兼容硬编码 tag；
  - 稳定 callback，避免 picker effect loop。
- `DefaultModelSelector.integration.test.tsx` 使用真实 source picker，验证 configured `gpt-4o`、disabled provider 排除、catalog image capability 保留。

最新真实 Electron `settings-actions.json` 已显示：`settings-smoke-provider::gpt-4o` 写入 `cherry_pref.chat.default_model_id`，并按 source cascade 写入 quick/translate preference。执行消费者仍未验收。

### 2.5 设置凭据边界（进行中）

新增 `src/shared/cherry-settings-privacy.ts`，目标是防止以下内容进入 renderer preference cache：

- `cherry_pref.feature.api_gateway.api_key`
- `cherry_pref.chat.web_search.provider_overrides` 中的 API key、token、密码、Authorization/header secret

已有变更：

- `src/main/ipc/settings.ipc.ts` 对 `settings.getAll` 做脱敏投影，generic `SETTINGS_SET` 拒绝这两类 protected key。
- compat `preference-service.ts` 在 snapshot cache 前再次脱敏，generic `set/setMultiple` 在 optimistic cache 前拒绝 protected preference。
- `cherry-settings-privacy.test.ts`、`settings.ipc.test.ts`、`preference-service.test.ts` 添加 targeted coverage。

当前 targeted root privacy tests 为 **10 passed**；compat preference suite为 **24 passed**。交接者需要先全量 compat/build 再决定是否可安全把 API Gateway/WebSearch source page 保留为只读 mount。

## 3. 关键架构决策及理由

1. **source vendor 永远只读**  
   适配只能放 compat、`src/integrations`、main IPC/service、preload 或 Host 边界。不能在 Cherry 源码里“修”环境问题。

2. **source-shell 与默认 compat 分离**  
   source-shell 证明真实 Cherry shell 可构建/运行；默认 compat 仍保持 Grimoire 的安全 hash 边界。source-shell 成功不自动授权默认入口切换。

3. **未知后端必须显示真实 error/blocked，而不是空列表**  
   例如处理器发现失败显示 source load-failed；技能/任务/渠道如果 source 会把失败变空，则需要 capability diagnostic 或禁用边界，不能叫“无数据”。

4. **只读 source page 使用 React/native boundary，不允许 imperative DOM 改写**  
   `CompatSourceSettings` 用 `<fieldset disabled>` 阻止 source page 的 preference/action writes。不要使用 MutationObserver 按图标猜按钮并修改 `button.disabled`，那会绕开 React 状态且不具可审计性。

5. **秘密仅主进程**  
   UI 的 `password` input 或视觉 mask 不等于安全。API Gateway/WebSearch 只有在 settings snapshot 和 preference cache 都脱敏、generic write 拒绝后，才能考虑 source read-only mount；真实 secret 管理由专门 main adapter 负责。

6. **截图通过条件严格**  
   通过条件 = entry ownership + observed route + action provenance + visible nonzero bounds + PNG hash + assertion。PNG 存在、页面有文字、sidebar 有标题都不是通过条件。

7. **UI 不分支具体 runtime**  
   Pi/OpenCode/Codex 仅在 Application/AgentRuntime adapter 层。UI 只消费 capability 或 typed unavailable state。

## 4. 核心文件清单及职责

### 路由 / source 页面挂载

| 文件 | 职责 |
|---|---|
| `src/vendor/cherry/compat/src/route-registry.ts` | compat hash 路径、动态 skill/task/MCP 参数解析、safe decode、supported-path list。 |
| `src/vendor/cherry/compat/src/settings-route-descriptors.ts` | remaining settings URL 与每个真实 blocker 的 source symbol、missing contract、next action。 |
| `src/vendor/cherry/compat/src/cherry-chat-shell-entry.tsx` | 默认 compat shell；source SettingsPage child dispatch、MCP Outlet、app pages。 |
| `src/vendor/cherry/compat/src/shims/tanstack-router.ts` | bounded `useNavigate/useSearch/useLocation/useParams/useRouter/Outlet/Link` shim；近期 `Link` 实现尚需 build/audit。 |
| `src/vendor/cherry/compat/src/CompatModelSettings.tsx` | source ModelSettings wrapper，禁用未接通 drawers，显示 capability note。 |
| `src/vendor/cherry/compat/src/CompatFilePreviewPage.tsx` | source FilePreview 路径参数 wrapper。 |
| `src/vendor/cherry/compat/src/CompatProcessingSettings.tsx` | source document/OCR page wrapper，保留真实 processor load failure。 |
| `src/vendor/cherry/compat/src/CompatLocalModelsSettings.tsx` | source local model section wrapper，注明 `local_model.*` 未接通。 |
| `src/vendor/cherry/compat/src/CompatSourceSettings.tsx` | browser/screenshot/general/API gateway/websearch/selection source-page read-only wrapper；当前最新改动未做最终 audit。 |
| `src/vendor/cherry/compat/src/CompatSkillsSettings.tsx` | source SkillsSettings/SkillDetails + source SkillLauncherProvider wrapper；尚未接到 shell。 |
| `src/vendor/cherry/compat/src/CompatTasksSettings.tsx` | source TasksSettings wrapper；尚未接到 shell。 |
| `src/vendor/cherry/compat/src/CompatSettingsActionBoundary.tsx` | 技能/任务禁用边界。当前刚从 imperative DOM mutation 改为 fieldset 方案，必须复查再接入。 |

### 模型 / 秘密边界

| 文件 | 职责 |
|---|---|
| `src/vendor/cherry/compat/vite.shared.config.ts` | Cherry source/compat aliases；relative `./useModelSelectorData` alias 是 picker 修复关键。 |
| `src/vendor/cherry/compat/src/shims/model-selector-data.ts` | configured/catalog model projection、source tag filter、disabled filtering。 |
| `src/vendor/cherry/compat/src/DefaultModelSelector.integration.test.tsx` | 真实 source picker integration regression。 |
| `src/shared/cherry-settings-privacy.ts` | secret preference key detection与安全脱敏。 |
| `src/main/ipc/settings.ipc.ts` | main-only settings snapshot / generic write boundary；目前加了 protected key redaction/rejection。 |
| `src/vendor/cherry/compat/src/shims/preference-service.ts` | renderer preference cache；必须在这里再次保证保护 key 不进入 cache。 |

### 验收 / 截图

| 文件 | 职责 |
|---|---|
| `scripts/audit-cherry-routes.mjs` | isolated Electron route audit；近期加入 content-column signal、settings search/model actual action journey；需清理/稳定后保留。 |
| `scripts/audit-cherry-source-shell.mjs` | authentic source-shell smoke，`--interactions` 驱动真实右键/QuickPanel/confirm/cancel。 |
| `scripts/capture-cherry-ui-catalog.mjs` | manifest-driven catalog capture；需要进一步稳定 profile/target/state assertions。 |
| `scripts/cherry-ui-capture-evidence.mjs` | surface identity + PNG hash + action/bounds evidence guard。 |
| `scripts/merge-cherry-ui-catalog-captures.mjs` | 只保留 verified evidence，禁止按文件存在自动通过。 |
| `artifacts/cherry-ui-catalog/截图清单.json` | 人工验收清单，`manualAcceptance` 必须保持 `pending`，直到用户明确验收。 |

## 5. 已知遗留问题

### 必须先处理

1. **当前树处于中间状态，先跑 build/test/audit**  
   最新增加的 `Link` shim、`useParams` 路由参数投影、source wrappers、privacy boundary 还没有作为一个完整组合通过 all gates。不要根据旧 51/51 或旧截图宣称现在通过。

2. **`Link` shim 原先是 `throw`**  
   ScreenshotSettings 等 source pages 会因 `<Link>` 进入 compat error boundary。当前已开始替换为内部 hash anchor adapter，但必须验证：普通 click、modifier click、target、functional search、shortcut/local-model links、source `Link` 导入页面。

3. **Skills/Tasks wrapper 尚未接 shell**  
   wrappers存在，但没有 verified shell dispatch。技能详情源 `SkillFileBrowser` 使用 `useBlocker`，tanstack shim 尚未实现；在没有无副作用/disabled detail path之前不要接 source detail 或 fake blocker。

4. **API Gateway / WebSearch credential hardening尚未全链验证**  
   current `settings.ipc.ts` & preference shim 已加保护，targeted tests pass；但通用 settings snapshot malformed credential behavior可能导致整个 `settings.getAll` 拒绝。必须决定并测试 fail-closed UX。不得让 raw secret、mask placeholder write、nested API keys 或 headers 回流 renderer。

5. **source pages与硬件/服务依赖**  
   - Browser：guest/session、history/import/clear、真实 tabs 未接通。  
   - Screenshot：capture window、global shortcut、OCR pipeline、native permission 未接通。  
   - Processing/OCR：processor discovery/credential/parser execution未接通。  
   - Local models：list/status/download/cancel/remove/acceleration未接通。  
   - API Gateway：gateway lifecycle / shared running status未接通。  
   - WebSearch：provider secret management / search-fetch executor未接通。  
   - Channels：query failure currently risks looking empty。  
   - Device pairing：invitation/pair/LAN effects未接通。  
   - Quick assistant：window/hotkey/temp topic lifecycle未接通。  
   - Selection assistant：selection hook / toolbar/action window未接通。  
   - Skills/tasks：catalog/files/task execution/logs/service未接通。  

6. **Usage 和 Archive 仍只部分真实**  
   Usage handler 尚未完整遵守 source range/group/metric/cursor/sort；Archive 缺 file refs/trash/purge/retention/部分 domain restore-delete。

7. **strict compatibility gate仍失败**  
   最后稳定测量是 `exit 2`、约 254–255 source diagnostics。不得 `noCheck`、exclude imported source 或使用 wildcard ambient declaration 清零。

8. **截图不等于人工验收**  
   catalog 旧 PNG 已标为历史参考；当前证据帧数必须从最新 JSON 读取。`manualAcceptance` 仍 pending。renderer `capturePage` 不证明 native title bar/dialog、真 DPI、多显示器或 OS permission。

## 6. 建议的下一步

### 优先级 0：恢复可靠基线

1. `git status --short`，确认别的会话没有正在写同一文件。
2. 运行/修复：
   - targeted privacy tests；
   - full compat tests；
   - `npm run build:cherry-compat`；
   - `npm run build:main`；
   - `node scripts/audit-cherry-routes.mjs`；
   - `node scripts/audit-cherry-source-shell.mjs --interactions`；
   - fresh strict compat log（保留 failure）。
3. 如果 route audit 出现 source error boundary，先修 shim/alias/actual source contract，不要松宽 signal。

### 优先级 1：把可安全读取的源设置页完成到“部分真实”

1. 验证并完善 Browser/Screenshot/Processing/OCR/LocalModels/Model/Search source mount；所有 action boundary需原生 React props/fieldset，不能 imperative DOM mutation。
2. 对 API Gateway/WebSearch，先完成 credential projection/write boundary安全测试，再决定 source read-only mount；不允许直接使能文本框、复制、network check 或 gateway controls。
3. 完成 Skills/Tasks source wrapper接入前，补 bounded `useBlocker` shim或保持 detail diagnostics；所有 mutation/launch/install/edit/run actions必须 disabled且后端拒绝。
4. 对 General/Selection，只在所有 mount effects安全、所有 controls disabled及平台条件正确时挂载；否则保持细粒度 blocker。

### 优先级 2：补真实能力，不是只挂页面

1. Usage：实现 validated range/group/metric/sort/cursor，保留 unknown cost/pricing null。
2. Archive：补/拒绝明确的 file references、purge、retention、unsupported domain action。
3. File preview：实现有效绝对路径 MIME/read/preview acceptance。
4. Browser/mini-app/window 工作在 main lifecycle/Workspace contract之后进行，不能 fake TabsProvider。

### 优先级 3：重新做截图验收

1. 每个 route/interaction 用 isolated profile + real action + state/bounds/hash assertion重采集。
2. 更新 flat catalog；blocked/non-renderer写无 PNG reason；不重新采纳旧 PNG。
3. 只在所有自动门禁和用户人工查看后更新 `manualAcceptance`；否则保持 pending。

## 固定约束（必须保留）

- 不修改 `src/vendor/cherry/source`。
- 不 reset/checkout/clean、不删除用户改动、不 commit/push。
- 不切默认入口到 source-shell。
- API keys/tokens/env secrets只在主进程；不进 renderer DTO、日志、fixture、截图或 manifest。
- 不把 runtime-owned stream/approval/recovery当作 UI已完成。
- 不报告“基本完成/核心完成/类似实现/完成百分比”。
