# Cherry UI 台账（M1.1）

> 生成方式：运行 scripts/build-cherry-ui-inventory.mjs。数据源：截图清单 + 范围决策 + 动作映射。

## 汇总

| 处置 | 条数 |
|---|---|
| 结构项 | 1 |
| 保留 | 23 |
| 裁撤（用户点名） | 17 |
| 裁撤（建议） | 27 |
| 特殊 | 5 |
| 待定 | 4 |
| 不适用 | 2 |

## 保留与特殊页的真实动作

| # | 页面 | 能做什么 | 数据来源 | 首要缺口 |
|---|---|---|---|---|
| 2 | 助手页面 | 列出助手、新建助手、进入会话 | Cherry DataApi /assistants,/topics → Grimoire 服务 | 全局 Topic 所有权与消息树未建 |
| 4 | 对话 | 发送消息、流式渲染、停止生成、消息内工具卡片、审批卡片 | ChatEngine/Host Bridge | 源 runtime stream 的 open/attach/detach/abort 未桥（M2） |
| 17 | 设置布局 | 左侧分类导航、搜索入口 | compat route registry | 仅壳，具体分类由子路由决定 |
| 18 | 设置重定向 | /settings → /settings/provider | ROUTE_REDIRECTS | 无 |
| 20 | API网关设置 | — | — | — |
| 21 | 外观设置 | 主题色选择、右键菜单样式、会话列表位置、字体 | cherry_pref + 我们的主题变量 | 需接入昼夜/色轮主题桥（M1.5） |
| 25 | 代码执行设置重定向 | /settings/code-execution → /settings/appearance | ROUTE_REDIRECTS | 无 |
| 26 | 数据设置 | 应用信息、缓存清理、导入外部数据、Markdown 导出、云备份（只读/拒绝） | app.get_info / cache_cleanup / export.* | 数据重置与迁移永久拒绝 |
| 27 | 依赖设置 | 二进制工具探测 | binary-tools.service | 安装/更新拒绝（无 mise） |
| 30 | 通用设置 | 只读源页面、域能力报告、缺失服务清单 | 静态 + Host Bridge domains | 托盘/自启/代理/防休眠无消费者 |
| 33 | MCP重定向 | /settings/mcp → 列表 | ROUTE_REDIRECTS | 无 |
| 39 | MCP服务器 | 服务器列表、搜索、启停、连接测试、新增 | DataApi /mcp-servers → mcp.service | 批量操作与导入未做 |
| 40 | MCP服务器详情 | 编辑表单、工具/资源/提示词/日志页签、保存、删除 | mcp.service + shared cache | 长连接日志只保留最近一次 |
| 41 | 默认模型设置 | 四个默认模型选择、focus 深链 | cherry_pref + model catalog | quick/translate/painting 的执行消费者未验证 |
| 44 | 提示词设置 | 提示词列表、新增、删除 | prompt_assets | PATCH 未实现；visibility 恒 global |
| 45 | 供应商设置 | 供应商增删改、拉模型、连接测试、密钥只在主进程 | providers + provider-connection.service | 鉴权变体（OAuth）未做 |
| 51 | 设置搜索 | 搜索设置、回车跳转、一次性 focusId | 源 SearchResultsPage + 源排名 | q 字节上限验证未接 |
| 53 | 快捷键设置 | 快捷键列表、冲突提示 | cherry_pref | 全局钩子未接 |
| 57 | 系统设置重定向 | /settings/system → /settings/general | ROUTE_REDIRECTS | 无 |
| 58 | 用量设置 | 用量图表、时间范围 | usage 表（部分） | range/group/metric/cursor 未完全满足 |
| 60 | 主窗口 | 工作区壳、面板拖拽/拆分/合并、布局持久化 | workspace.store + SQLite | 与 Cherry 内容区的边界待统一 |
| 71 | 会话右键菜单 | 重命名、置顶、归档、删除、分支 | 源上下文菜单 → Host Bridge | 仅允许名单内的动作生效 |
| 72 | 快捷面板 | 搜索命令、方向键选择、回车执行 | 源 QuickPanel | 改造为我们的命令面板并接工具注册表 |
| 73 | 消息删除确认弹窗 | 确认删除、取消 | 源确认弹窗 | 无 |
| 75 | 导入外部数据 | 导入 ChatGPT/Claude 对话 | POST /assistants,/topics → Grimoire 服务 | 缺 per-topic 消息树 |
| 76 | Markdown导出 | 选择目录、导出 Markdown | data.export.* + selectFolder | 无 |
| 78 | 真实源壳设置标签页 | 真实 MainApp + Tabs 导航 | source-shell 独立构建 | 仅审计入口，不做默认 |
| 79 | 源壳运行时能力诊断 | 运行时能力诊断 | Host Bridge domains | 无 |

## 待定页（页面能开、后台无功能）

- 22 归档设置
- 42 通知设置
- 59 联网搜索设置
- 74 本地备份设置

## 裁撤清单

3、5、6、7、8、9、10、11、12、13、14、15、16、19、23、24、28、29、31、32、34、35、36、37、38、43、46、47、48、49、50、52、54、55、56、61、62、63、64、65、66、67、70、77

## M1.2 只读挂载页的挂载副作用审计（2026-10-27）

判定标准：挂载时是否读密钥、是否发网络、是否需要原生能力。**结论：没有一页在挂载时读密钥**；全部是平台能力探测或状态查询。

| 页面 | 挂载时的调用 | 性质 | 风险 |
|---|---|---|---|
| 通用设置 | 无挂载调用；`window.api.application.relaunch()` 只在按钮处理器里 | 交互 | 无 |
| API 网关 | `useApiGateway()` ×4（读取网关状态） | 本机服务探测 | 网关没实现 → 如实报错 |
| 联网搜索 | `useWebSearchProviderLists()` ×3（读供应商列表） | 数据读取 | 密钥在主进程已脱敏 |
| 划词助手 | `system.mac.is_process_trusted`、`selection.get_linux_env_info`（各一次） | 平台探测 | 无 |
| 浏览器 | 仅 4 个 `useState`，无挂载调用 | — | 无 |
| 截图 | `shortcut.onRegistrationConflict` 订阅；`app.relaunch` 仅在处理器里 | 事件订阅 | 无 |

**结论**：`<fieldset disabled>` 挡的是交互，但上述读取在设计上都是只读探测，没有会写偏好或泄漏密钥的挂载副作用。后续仍需在 M1.5 主题桥落地后复测一次（主题写入会新增一次挂载期读取）。

## M1.3 路由审计（2026-10-27 结果）

- 修复前：4/51 失败（api-gateway、browser、screenshot、websearch、general/system 信号过期）。
- 修法：把「中文标题文本」换成**结构选择器**（`[data-ui="compat.settings.source-readonly"][data-settings-route="…"]` + 域能力面板标记），并把「已挂载的源设置页」从源码实际导出推导，不再硬编码。
- 附带修掉一个真 bug：`isWin` 读 `window.electron.process.platform`，compat 窗口没有这个全局 → 划词助手页在任何系统都降级为诊断页。改为用户代理判断后正常挂载。
- 修复后：**51/51 全部渲染**。

## M1.4 模型选择器真机重测（2026-10-27 结果）

- 结论：**通过**。`settings-actions.json` 四项检查全绿，`modelSelectionPersisted=true`，读回 `settings-smoke-provider::gpt-4o`。
- 两次踩坑都记在这里，避免下次重犯：
  1. 选择器是**虚拟列表**，只渲染视口内的行 —— 直接用 `querySelectorAll('[role=option]')` 断言会漏掉列表下方的模型；必须先输入搜索词再断言。
  2. 搜索 `gpt-4o` 会命中目录里的 `openai::gpt-4o`（真实存在），于是写回的是它。要断言我们自己配置的模型，得**按供应商名搜索**。
- 附带发现（记入 STATE D10）：通过 DataApi 新建供应商后，同一窗口里的供应商面板仍显示「已配置 0/0」，直到整页刷新才更新 —— 跨视图缓存没有失效通知。选择器本身没问题。
