# Cherry Studio 2.1.4 剩余 UI 源级迁移与 OpenCode / Pi Agent 接入计划

## Context

目标是完成 Cherry Studio 2.1.4 的完整 UI、交互和状态迁移，不把“页面挂载”“看起来相似”或“测试通过”当成完整复刻。Cherry 提供成熟 UI；OpenCode 和 Pi 主要提供 Agent 能力及运行时能力；Grimoire Core 负责契约、数据、权限和集成。

先纠正既有汇报：此前的“65–70%”没有完整验收分母，撤销该百分比；`/app/agents` 当前只是切换助手/主题 rail，尚未接入真正的源 `AgentPage`。提示词 CRUD、绑定、可见性已有实现，不重复列为待开发。历史测试数字、路由数量和文档状态均需要执行时重新核验。

本次只制定计划，不修改业务代码，不安装依赖，不执行数据库迁移。

## 已锁定的方向与边界

- **Cherry：UI 所有权。** 优先直接复用源的 shell、页面、列表、工具卡、菜单、弹窗、编辑器和状态机；保持布局、快捷键、拖放、IME、隐藏动作及异常行为。
- **Pi：Agent 生命周期基础。** 接入会话、上下文、流式、工具循环、取消、恢复、分叉与扩展能力。保留现有 RPC 路径，核对源码/版本后决定是否复用源 SDK 驱动；不能宣称 RPC 是伪协议而未经验证更换它。
- **OpenCode：工程 Agent 与策略能力。** 通过匹配版本的 HTTP/SSE 或公开 SDK 接入规划、工程工具、权限、上下文与子任务能力；不把外部终端启动当作内嵌 Agent 接入完成。
- **Grimoire Core：集成所有权。** UI → ChatEngine / AgentRuntime / WorkspaceEngine / ToolRegistry / DomainService → 适配器 → 源能力或 Grimoire 存储。UI 不按 `pi/opencode/codex` 名称决定行为，只读规范化能力描述。
- Pi 与 OpenCode 可独立作为运行时提供者；组合时通过契约共享策略/能力，不直接调用彼此私有模块，不启动两个重复执行同一 turn 的 Agent loop。
- Grimoire SQLite、资产、设置是唯一业务真相。运行时原生文件/远端会话允许作为受管执行状态，需持久化映射、所有权、同步和清理协议，不能成为第二业务数据库。
- `src/vendor/cherry/source` 只读；适配放 compat、`src/integrations/*`、Host Bridge、main service/IPC。遵循 DIRECT_REUSE → VENDOR → WRAPPER → ADAPTER → 最小修改 → 部分提取；重写必须提供拒绝此前路径的证据并另行获批。
- 不 reset/checkout/clean，不删除用户改动，不最终 commit/push，不把未完成 Cherry 窗口设为默认入口。
- API key/token/env secret 只在 main 读取和使用；不回传、记录或导出。破坏性恢复、删除、远程上传等必须有明确用户动作与确认。

## 工作包与执行顺序

每个工作包包含：源符号清单、数据/事件契约、适配位置、隐藏动作、错误场景、测试和证据。每个阶段通过自动化、功能、迁移审计三门后再推进；视觉和回归证据从第一阶段持续积累，不留到最后才测。

### P0：事实核对、完整缺口清单与基线锁定

1. 阅读 `.agent/{AGENTS,SPEC,PLAN,STATUS,MIGRATION_MATRIX,REMAINING_WORK,DECISIONS,WINDOW_MATRIX}.md`，核对当前用户工作树。
2. 从源 route/page/window/menu/command 注册表建立完整能力台账，覆盖主 shell、设置子页、Agent、产品域、弹窗、窗口和后台行为；不只统计 compat 已注册路由。
3. 逐项区分：源组件已采用 / 页面可渲染 / 用户操作有消费者 / 持久化闭环 / 已验收。纠正过时 BLOCKED 和完成描述。
4. 核对当前 schema 及 Pi/OpenCode 版本、可执行文件、manifest、协议和依赖许可。后续迁移使用届时可用的下一个版本，不预定 v32/v33。
5. 固定隔离 profile、无密钥 fixture 和可重放验收场景。建立计划执行账本，每项记录下一动作和依赖。

**出口：** 所有必需 UI/行为都有准确状态与下一步；无没有证据的百分比，未接真实 AgentPage 明确列为缺口。

### P1：会话、Topic 与 Agent 数据契约补齐

1. 严格区分 Assistant、Topic、可复用 Agent 蓝图、执行 Session、Workspace、Message、ToolCall。
2. 对照源 Agent/Session schema 添加蓝图和 workspace 映射，复用现有 session 服务；蓝图默认配置与会话运行快照分离，修改蓝图不能静默改写历史会话。
3. 建立独立 Topic 消息所有权和 active-node/message-tree 契约：分支、编辑/重生成、清空、导入导出、跨助手移动必须操作真正的 Topic 历史，不再投影同一 session 的消息冒充独立线程。
4. 数据库 additive 迁移、迁移前备份、事务、引用完整性和幂等；历史数据无法确定归属时保留原样并明确映射规则，不根据标题生成重复 Agent 蓝图。
5. 补齐 `/agents`、`/agent-sessions`、Topic tree 的源形状 DataApi；路径、分页和 envelope 以源 schema 为准。

**出口：** 两个 Topic 消息互不串联；蓝图创建→实例化→重开闭环；旧会话、附件、主题、归档和分叉迁移后不丢失。

### P2：完整主窗口 shell、tabs 与导航迁移

1. 对照源 MainApp/AppShell/TabRouter/TabsProvider 及 provider 顺序，先尝试恢复路由生成/构建边界，再适配 source shell；不能因缺生成文件直接永久退回自建替代 UI。
2. 迁移 tabs 的创建、激活、关闭、重排序、LRU/休眠、恢复、同路由不同实体、拖放和分离/附着行为。接入 Grimoire workspace/window 契约，避免第二套不受管布局状态。
3. 复用源导航栏、应用入口、资源侧栏、设置导航和命令上下文；逐项解除 shim/no-op，而不是提供空 TabsContext。
4. 列表剩余行为：cursor/latest/reveal、键盘、IME、乐观失败回滚、分组、跨 owner 移动、完整上下文菜单和 active replacement。

**出口：** 多 tab 状态独立且重启恢复正确；回退/深链接/参数保真；设置和应用入口符合源布局；现有 Grimoire workspace 回归通过。

### P3：OpenCode / Pi AgentRuntime 能力接入

1. 规范化 capability 描述及会话/turn/工具/审批 ID；补会话创建/恢复、持续连接、取消、重试、recovery、fork、上下文用量、commands、steering/config reconcile 等契约，仅报告真正支持的能力。
2. **Pi**：核对 vendored CLI 与实际安装版本的 RPC、终止事件、model/session/extension 支持；评估复用源 Pi 驱动和动态 ESM import 边界。优先复用成熟 session、compaction、fork、MCP/approval extension，不另造简化循环。
3. **OpenCode**：保留 managed server 和 HTTP/SSE 路径，逐端点对照对应源版本；持久化本地↔远端 session、event cursor 和恢复映射。修复事件去重、reasoning/text 混用、EOF 假完成、取消/失败终态及 reader/进程清理。
4. ToolRegistry 统一 builtin/MCP/Grimoire domain 工具身份和呈现元数据；“能力类别 read/write/execute/network”与“approval auto/prompt”是不同维度，自动批准只能由实际权限策略推导。
5. 内嵌 runtime 的原生工具也须经过受管工作目录和可证明的审批桥；已有工具被传给 runtime 不代表它真的接受并执行了这些工具。
6. 验证独立 Pi/OpenCode 路径；需要组合策略时通过公开合同进行，不能叠加重复调用或绕过权限。

**出口：** 两种 runtime 均有 matching-version fixture 与真实运行证据；发送/工具/拒绝/取消/进程退出/恢复闭环；不支持项返回 unavailable，不伪造 usage 或 recovery。

### P4：真正的 Cherry AgentPage 与 Agent 工作流

1. 在源 `/app/agents` 及源详情路由挂载真实 `AgentPage`、AgentResourceList、Sessions、AgentChat；移除“助手 rail 等于 Agent 页面”的命名混淆，不发明新路径代替源路由。
2. 接入蓝图编辑、model、instructions、MCP/tool 配置、工作目录、会话创建/切换/归档/分叉、流式历史与配置变更。
3. 接入源 Agent 工具卡/执行时间线、权限 composer、上下文用量、重试/compaction/recovery、后台任务和子 Agent 状态。身份映射基于工具语义而非 runtime 名称。
4. 技能与 commands：调查 Pi/OpenCode 可复用 skill/extension/命令发现能力，建立受管 catalog、路径与许可；接入源技能选择/资源提及。不凭空返回技能列表。
5. AgentRightPane 的文件/任务/浏览器预览使用真实 workspace 与生命周期服务；每个依赖单独记账，不能以挂载一个聊天框宣告本阶段完成。

**出口：** 同一源 UI 分别使用 Pi/OpenCode 完成蓝图→会话→工具→审批→取消/恢复→分叉；任务/技能/文件/预览有真实消费者。

### P5：设置与聊天隐藏动作补齐

- **Provider/Model**：模型元数据和 CRUD、多 key 健康/轮换、endpoint/protocol、导入、失败回滚；密钥读取保持 masked/write-only。
- **MCP**：排序、工具、prompts/resources、logs、trust、重连/restart、marketplace/OAuth 等逐源登记并接真实服务；未知/未查询不能以空列表冒充成功。
- **General**：核对已存在的自启/代理/防休眠/重试/上下文消费者，补 tray/close-to-tray、启动参数、硬件加速等缺口；未消费者的控件不假可用。
- **Notification/About/Dependencies/Shortcuts**：通知 dispatcher、doctor、更新事件族、快捷键冲突与全局注册、依赖管理。更新和依赖下载维持显式确认及现有 local-only 策略，不能悄悄放开。
- **聊天动作**：源菜单、复制/编辑/重生成/分叉/导出、提及、真实 drag/paste、文件预览、模型筛选、压缩提示和失败/重试状态。
- 保留已完成 prompt CRUD/绑定/visibility/回收站/usage 回归；补尚未支持的 visibility 转换、成本（只有真实价格来源才显示）、归档域。

**出口：** 每个暴露控件有可观察作用或诚实的不可用状态；隐藏动作有 source parity 证据，持久化往返不丢秘密或配置。

### P6：剩余产品域完整用户流程

按依赖推进，不把以下项目简化成“补几个 IPC”：

1. **Files**：picker、write_if_unchanged 冲突、真实 MIME/路径、PDF/视频预览、引用计数；一起完成 trash→restore→permanent delete，保护外部引用和共享内容。
2. **Notes**：源编辑器、目录/搜索、保存队列、持久化、导入导出、附件、冲突/恢复。
3. **Browser/miniApps**：P2 tabs 基础上的实体管理、导航、历史、webContents/guest 生命周期和权限/隔离；miniApps 列表与详情都须闭环。
4. **Paintings**：复用源 provider 适配，模型能力、参数、任务、取消、结果保存/历史/资产引用；不把模型字符串猜成绘画能力。
5. **Translate**：文本翻译优先复用现有 provider streaming 契约；PDF/file processing 独立迁移源处理流程、进度/取消、结果和失败回收。
6. **Knowledge**：复用源 ingestion/job/vector/query 分层，适配 Grimoire repositories；完成库/数据源/embedding/索引/检索/引用/重索引/取消。不可用、失败与真正零命中必须区分。
7. **Code CLI**：复用源终端启动/config 管理；与 P3 内嵌 Agent 路径明确区分。DSH/Hermes/OpenClaw 等已暴露入口逐一登记能力，不因 OpenCode/Pi 主力定位而静默删除。
8. Domain 面板与 Agent 都调用相同 DomainService/ToolRegistry，而非访问各自私有数据库。

**出口：** 各域都有创建/导入→使用→保存→重开→失败/取消的真实流程；离线/缺模型/缺 binary 有明确诊断。

### P7：备份、安全恢复与第三方集成

1. 先定义 **Grimoire 归档协议**：manifest、版本/校验、数据库安全快照、资产/附件、引用重映射、明确排除项；不把 SQLite 原文件重命名成 ZIP。
2. 不直接导出含 secrets 的数据库。快照中脱敏/剔除 key/token/auth/env 等秘密并检查 canary；恢复后要求重新认证。用户聊天/文档仍属于敏感数据，上传须明确确认。
3. 复用源 WebDAV/S3 传输客户端，绕过 Cherry 私有 application/数据库 orchestration；Local→WebDAV/S3→坚果云 SSO 分步验收。依赖精确记录与许可证审计，不为包装添加整套无用 ORM。
4. 恢复先 staging 和只读校验（schema、路径/zip-slip、大小、哈希、引用），停止并排空写入/Agent 后进行受控替换；复用 `exportDatabase/importDatabase` 已有机制但验证其适用范围，纳入资产一致性、崩溃恢复和回滚。
5. retention、自动备份、进度、通知、并发互斥与失败清理均单独验收；自动远程备份仅在用户明确启用后运行。
6. Notion/Joplin/思源/语雀/Obsidian 等保持源 UI，统一 secret 存储与 main 请求边界；已可用导出保留回归，不因现有 renderer fetch 可工作而忽略 secret 边界。

**出口：** archive 不含 secret canary；附件/数据往返一致；损坏/越界/未来 schema 被拒绝；故障注入能恢复旧状态；未确认不上传。

### P8：源窗口与 OS 生命周期

1. 复用现有安全 BrowserWindow 边界建立 create/reuse/pool/init-data/close/restore 服务；源 window root/provider/style 顺序分别保持，不统一套主窗口样式。
2. subWindow：真实分离/附着 conversation、Topic/Session 数据 feed 和跨窗口刷新，不冒充普通 panel popout。
3. quickAssistant：globalShortcut 冲突、焦点/always-on-top、快速对话/翻译和关闭策略。
4. screenshot：多显示器、DPI/坐标、权限、区域捕获、clipboard/file、取消和窗口池清理。
5. selection toolbar/action：评估并复用源 native hook，明确 Windows 兼容/依赖许可和降级；缺 native 依赖保持 BLOCKED，但列为剩余必需能力，不宣布完成。
6. userData relocation/reset 等既有明确拒绝项保持原政策；与没有 renderer 的 enum 成员、Cherry v1 migration 等不适用项分开，不把枚举数量当作 UI 工作量。

**出口：** 窗口创建/复用/关闭/重开/退出无泄漏；跨窗口数据同步、快捷键和截图权限实际工作；未解决平台能力有解除条件。

### P9：全产品 UI 保真验收与收口

- 按源逐符号核对页面、导航、菜单、隐藏状态、键盘/IME、reveal/DnD、dialog 和生命周期；完整台账不得只覆盖已接页面。
- 固定 profile 下捕获 1280×800 / 1920×1080、light/dark、100%/125%/150% zoom；明确 zoom 不等于真 DPI，并加入多显示器真实 DPI 手测。
- 补 loading、retry、permission、recovery、streaming、empty、error、菜单、折叠等独立状态；使用真实 runtime/service 或确定性集成 fixture 触发，不能伪造成功状态。
- 自动捕获必须先断言对应状态真的出现；缺帧/错会话/致命回退/空页面必须失败，禁止跳过后报成功。mutation 验证结构和视觉 gate 都能抓回归。
- 真机 drag/paste、Provider/MCP、Pi/OpenCode、Topic tree、tabs、全部域、备份和窗口端到端验收；记录运行版本、命令退出码、截图和诊断。
- 最后重跑打包、依赖/license/NOTICE、secret 泄漏和性能检查。完整迁移只有必需行为全部通过、外部限制被用户明确接受才可宣布；无默认入口切换或最终提交授权。

## 关键实施位置（source 只读参考）

- 台账：`.agent/{PLAN,STATUS,MIGRATION_MATRIX,REMAINING_WORK,DECISIONS,WINDOW_MATRIX}.md`。
- compat：`src/vendor/cherry/compat/src/{cherry-chat-shell-entry.tsx,route-registry.ts,part-projection.ts,live-turn.ts}`、`shims/*`、`vite.shared.config.ts`。
- 契约/桥：`src/shared/{ai-types,agent-types,cherry-host-types}.ts`、`src/renderer/services/cherry-host-bridge.ts`、compat fallback bridge、`src/preload/index.ts`（sandboxed preload 必须自包含）。
- 数据/IPC：`src/main/database.ts`、`src/main/ipc/{cherry-data-api,ai-sessions,agent}.ipc.ts`、`src/main/services/{ai-session,agent-session,cherry-assistant,mcp,prompt-asset-browser}.ts`。
- runtime：`src/main/ai/runtime/{types,registry,adapters,tools,grimoire-tools}.ts`、`src/main/services/agent-runtime-manager.ts`、`src/integrations/{pi,opencode}/*`。
- 窗口/验收：`src/main/index.ts`、`src/main/visual-capture.ts`、`scripts/{audit-cherry-routes,visual-baseline,visual-compare}.mjs`。
- 重点源参考：Cherry `windows/main/*`、`pages/agents/*`、`hooks/agent/*`、`main/ai/runtime/pi/*`、各 domain service、`WebDav.ts/S3Storage.ts`；Pi/OpenCode vendored lifecycle/session/permission/tool 源。
- 新服务按现有 main service + integration 模式添加，不预先复制一套 source application/ORM/数据库。

## 三门验证与通过标准

1. **Automated**：执行时核验 package scripts；root typecheck、compat 自身 typecheck、root/compat tests、针对迁移与协议的 tests、完整 build/copy/package、route 内容 audit、CSS/type-map/矩阵检查、视觉 compare。保留原始退出码，不用管道最后一条命令代替测试成功证据。
2. **Functional**：隔离 DB/profile 下真实 Electron；确定性 mock provider/MCP + 实际 Pi/OpenCode 的匹配版本 smoke。并发会话、重复/乱序事件、网络断连、取消、拒绝、子进程退出、重启恢复和跨窗口同步必须覆盖。
3. **Migration audit**：源布局/行为对照截图与操作记录；每个必需台账项有源码定位、实现位置和证据。测试/route 数只报本次结果，不折算完成率。

## 风险、解除条件与回退

| 风险 | 处理与验收 |
|---|---|
| 主 shell/AgentPage 依赖大、缺生成文件 | 先验证源构建与 provider closure，分块接源组件；复杂度不是重写理由 |
| Pi/OpenCode 协议与包版本不一致 | pin 版本、保留协议 fixture、真实 binary smoke；未验证能力显式 unavailable |
| Topic/Agent ownership 迁移损坏旧数据 | additive migration、前置快照、幂等/约束/旧 fixture 回归；不猜历史归属 |
| Agent 权限扩大或两个 loop 重复执行 | turn/call 身份与单一执行所有权；拒绝/重入/并发测试；main 强制策略 |
| 备份泄密、遗漏资产、恢复竞争写入 | sanitized archive、canary、staging/quiesce、故障注入、受控回滚 |
| 全局 hook/browser/截图平台依赖 | native capability 探测、边界校验、permission flow、平台阻塞诊断 |
| 绿色测试掩盖空页或 no-op | Electron 实测、状态断言、隐藏动作审计、mutation gate |

回退使用显式关闭 compat feature/恢复既有入口及受控数据快照；不破坏用户工作树、不修改 vendored 源、不通过全局杀进程清理构建资源。任何未完成或政策拒绝项保留名字、缺失行为、解除条件和后续动作。
