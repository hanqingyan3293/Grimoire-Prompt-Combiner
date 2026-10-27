# M1 / M2 全量审计（2026-10-27）

审计目标：确认 M1、M2 是否真的完成，有没有用「简易版」凑数；为 M1.5 / M3 / M6 划出真实工作项。

方法：读源码 + 跑既有验证（门禁、路由审计、stream smoke）+ 抽查截图；不做推测。

---

## 1. M1 可见基座

| 声明 | 证据 | 结论 |
|---|---|---|
| Cherry 窗口挂载真实源组件 | `cherry-chat-shell-entry.tsx` 直接 import `source/src/renderer/components/chat/shell/ChatAppShell`、`MessageList`、`ComposerSurface`、`ModelSelector`、`ExportService` 等 | 真，非自绘 |
| 设置页挂载源页面 | `CompatSourceSettings.tsx` 挂 6 个源页面：general / api-gateway / websearch / selection-assistant / browser / screenshot | 真，但**全部只读**（原生 disabled fieldset） |
| 其余设置路由不是假页面 | `settings-route-descriptors.ts` 15 条 BLOCKED 诊断页，明确列出缺失合同与下一步 | 真（诊断页，不是仿造 UI） |
| 51 条路由可渲染 | 本轮重跑 `audit-cherry-routes.mjs`：51/51 OK，截图在 `artifacts/visual/cherry-routes` | 真 |
| 面板独立窗口 / 状态契约 | `PanelShell` 双击 + `WorkspacePopoutWindow` + `show:false`/`ready-to-show` | 真，未做像素级防闪烁测量 |
| 品牌替换 | 本轮前 compat 侧栏硬编码 `Cherry Studio`、占位符「发送消息给 Cherry Studio」、标题回退「Cherry 对话」 | **不完整 → 本轮已修**（改为 魔导书 / 智能工作区 / 新对话 / 发送消息给魔导书） |

**结论**：M1 没有用简易版冒充源 UI；但「设置面」大部分是只读或诊断，属于能力缺口，不是伪造。

---

## 2. M2 最后一公里

| 声明 | 证据 | 结论 |
|---|---|---|
| `ai.stream.open/attach/detach/abort` | `cherry-data-api.ipc.ts` 的 `handleChatStreamRoute`；attach 有界重放 512 条 / 512KB | 真 |
| 聊天页真流 | `scripts/chat-stream-smoke.mjs`：`#/app/chat`，5 段增量拼成「你好，世界」，落库一致 | 真 |
| Agent 真流 | `agent:session:stream` + `handleAgentSessionSend` hooks；smoke 跑 agent 会话 | 真（协议层） |
| 审批闭环 | 权限请求 → `tool-approval-request` chunk → `ai.tool.approval.respond` → broker → 工具执行；拒绝 → 整轮失败上报 | 真（协议层，未做 DOM 点击录屏） |
| prewarm | 显式 NOT_IMPLEMENTED；源只在 `.catch` 里 warn | 诚实缺口 |
| 识图 | smoke 断言 `{success:true,text:'看到图片'}` | 真 |

**结论**：M2 的流与审批是真实现，没有假 chunk；缺的是 UI 级点击验证（见第 4 节）。

---

## 3. 「简易版凑数」逐项检查

| 区域 | 检查方式 | 结论 |
|---|---|---|
| Cherry 聊天壳 | import 图 + 截图 | 源组件，非简易版 |
| Cherry 设置页 | 6 源页 + 15 诊断页 | 无仿造页；但能力未通 |
| 主窗口面板 | `PanelRegistry.tsx` | 我们自己的产品面板（用户明确要求以面板为核心），不是冒充 Cherry |
| 禁用面板 15 个 | 逐个看 `description` | 有明确归属：`presets→提示词资产`、`logs→Agent 诊断`、`provider/model→设置`、`ai-chat/ai-vision/ai-assistant/agent-sessions→Agent 工作台` 或 Cherry 窗口；**但 `tag-tree/favorites/tag-cards/prompt-editor/output` 没有替代入口，属于历史面板被收起，需要与用户确认是否恢复** |
| 空页面（prompts 15 字、notifications 34 字） | 截图核对 | 是空数据库的空状态，不是桩 |
| 假成功 / 假数据 | `grep` 全仓 TODO/占位/NOT_IMPLEMENTED | 230 处，绝大多数是显式拒绝（501 / 诊断），不是假成功 |

---

## 4. 缺口 → 后续里程碑

| 缺口 | 归属 | 具体动作 |
|---|---|---|
| 品牌残留（导出元数据 `source:'Cherry Studio'`、源 About 页文案） | M1.5.5 | 导出走 `markdown-save` 适配层改写 source；About 目前是诊断页，挂载前需品牌替换方案 |
| 组件基线只覆盖圆角/阴影 | M1.5.6 | 按钮/输入/开关/表格/对话框逐个对齐源样式与令牌 |
| 6 个源设置页只读 | M3 | 逐个接入真实写入与副作用（general 先做：托盘/自启/代理/防休眠的消费者） |
| 15 个诊断页 | M3 | 按合同实现：MCP 列表+详情、模型/供应商、数据/依赖、提示词/快捷键/搜索、通用只读分组 |
| 无 UI 级点击/截图对比 | 交叉矩阵测试 | 写 Playwright/CDP 点击脚本：聊天发送、审批点击、设置保存、面板拖动/独立窗口，逐页截图与基线对比 |
| NovelAI 全量 | M6 | 块解析 → 版本树 → 图↔版本 → 素材 → 元数据 |

---

## 5. 本轮已修

- compat 侧栏标题/副标题/占位符/标题回退的品牌替换（4 处）。
