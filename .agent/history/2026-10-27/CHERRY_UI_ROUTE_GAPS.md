# Cherry 源路由缺口核对（P0）

日期：2026-10-13。证据同时包含 source-shell/compat 隔离 Electron smoke 与 catalog capture；注册路径或截图仍不等于完整行为迁移。

## 实际 surface 不一致

| 路径/能力 | 状态 | 源与当前差异 | 下一动作 |
|---|---|---|---|
| `/app/agents` | PARTIALLY_MIGRATED | **source-shell** 已挂载真实 `routes/app/agents.tsx` → `AgentPage`，并在隔离 Electron 中验证空态、蓝图/session 创建、joined workspace、真实行选择、持久化历史、重命名与页面 tab identity；默认 compat hash 入口仍是助手/主题 rail + 普通聊天，未切换为 source AgentPage | 继续补 source AgentPage 的 runtime-owned stream/approval/recovery/skills/commands/right-pane consumers；完成独立截图目录证据后再评估默认入口替换 |
| `/app/chat` | PARTIALLY_MIGRATED | compat 复用聊天组件，不等于源 HomePage 完整生命周期 | P1 Topic tree + P2 shell/tabs + 菜单/隐藏动作核对 |
| `/app/browser` | PARTIALLY_MIGRATED | 已新增 CompatBrowserPage，复用源 normalizeBrowserEntryUrl 和源 blank-default 规则；10 个针对性测试验证传参、hash 更新及拒绝路径。浏览器 guest 生命周期尚未因此完成 | 验证实际 guest 导航、隔离/权限、tabs 生命周期 |
| `/app/file-preview` | MISSING | 源有 FilePreviewPage 和 path search schema，compat 未注册 | 桥接安全文件预览和 validated path 参数，再挂载源组件 |
| `/app/mini-app/`、`/app/mini-app/$appId` | BLOCKED | 源列表用 useTabs；详情以 useParams 取得 appId，仍依赖 tab identity/activity。现诊断说从 currentTab.url 推导 appId，不准确 | P2 真实 tabs 生命周期后挂源列表/详情；修正诊断文案 |
| 主 shell/tabs | PARTIALLY_MIGRATED | source-shell 已用真实 `MainApp`/`TabsProvider`/`AppShell`/`TabRouter`，隔离 Electron 已验证 create/switch/close/reload/navigation 与 AgentPage tab；默认 compat 仍是单 `ChatAppShell` + hash registry | 保持 source-shell 为隔离审计入口；补齐 source shell 未桥接的 runtime/domain/window consumers，不能因为 smoke/build 通过就切默认入口 |
| `/settings/general` | BLOCKED | 当前诊断而非源页面；部分 preference consumer 已有，需逐项核对 | 对照完整源控件消费者，不以过时“全部无消费者”描述为依据 |
| MCP nested layout | PARTIALLY_MIGRATED | 源 `/settings/mcp` 的 `McpSettingsPage` layout 现在通过 `CompatOutletProvider` 接收 compat registry 选择的真实 child；isolated route audit 在该接线后 33/33 targets rendered。Compat 仍不是生成的 TanStack route tree，provider-discovery/catch-all 与完整 action parity 未完成 | 对每个 nested child 做 source action/diagnostic 验收，并补 settings catalog 截图；不要把 Outlet seam 等同完整 router parity |

miniApp/unknown 诊断当前出现在 rail，main fallback 仍是 chat；不能将此算作完整源诊断页复刻。

## 已采用源页面，但尚需完整行为验收

App：launchpad、browser、knowledge、notes、code、translate、files、paintings index/splat、release-notes。

Settings：provider、MCP servers/detail、appearance、data、dependencies、notifications、about、prompts、usage、shortcut、archive。

这只是源组件挂载证据，不自动把后台、菜单、持久化、状态、错误或 runtime 能力改为完成。

## 未在 compat 注册的源设置路由

以下统一为 MISSING（路由/surface），不预判底层服务是否存在；执行时核对源依赖并优先复用：

- `/settings/api-gateway`
- `/settings/browser`
- `/settings/channels`
- `/settings/device-connections`
- `/settings/file-processing`
- `/settings/local-models`
- `/settings/model`
- `/settings/ocr`
- `/settings/quick-assistant`
- `/settings/screenshot`
- `/settings/search`
- `/settings/selection-assistant`
- `/settings/websearch`
- `/settings/skills` layout、`/settings/skills/` index、`/settings/skills/$skillId`
- `/settings/scheduled-tasks` layout、`/settings/scheduled-tasks/` index、`/settings/scheduled-tasks/$taskId`
- `/settings/mcp/builtin`
- `/settings/mcp/marketplaces`
- `/settings/mcp/mcp-install`
- `/settings/mcp/npx-search`
- `/settings/mcp/$`

缺少源 redirect：`/settings/` → provider；`/settings/system` → general；`/settings/code-execution` → appearance。

## U7 目录交付（2026-10-13）

`artifacts/cherry-ui-catalog/` 已生成 flat 简体中文编号截图目录；`截图清单.json`/`截图清单.md` 记录 79 个受控条目、69 个 PNG、10 个明确无 PNG 的窗口/非渲染器原因，并保持 `manualAcceptance: pending`。源窗口阻塞项不生成伪造截图；用户仍需手动查看并验收。

## 后续验收

P0 还需菜单/commands/窗口/事件与消费者清单、实际 runtime binary 核验、typecheck 255 条诊断分类。上述缺口不能由已注册路由 audit 或截图数量覆盖。
