# Grimoire 开发计划（2026-10-27 批准版）

> 批准时间：2026-10-27。依据：`.agent/STATE.md`（现状）、`.agent/GATES.md`（门禁）、`.agent/records/2026-10-27-takeover/`（范围与决策全过程）。
> 本文件是**唯一执行计划**；里程碑完成或范围变更时更新本文件，并在 `.agent/DECISIONS.md` 记一条。

---

## 0. 批准后的第一批动作

1. 建分支 `work/2026-10-27-m0`（从 `baseline/2026-10-27-takeover` 起）。
2. 写 `scripts/gates.mjs` + `.agent/gates/compat-source-baseline.json`（G5 拆分落地）。
3. 修掉 D1 死分支与 D2 死变量。
4. 跑一次全量门禁，把真实数字写回 `STATE.md`。

---

## 1. 目标与完成定义（DoD）

**本轮目标**：在不动 `src/vendor/*/source` 的前提下，把「AI 页面真能用」「设置中心成型」「范围收缩后的 Cherry 面收尾」「NovelAI 能力落地」「MOSS 与 ComfyUI 接入」依次做完，每一步都有可复现证据。

**完成的硬条件**：

1. `MIGRATION_MATRIX.md` 每行都有可复现证据；无未说明的 MISSING / PARTIAL。
2. 所有 BLOCKED 行写明解除条件，且用户书面接受。
3. 门禁 G1–G11 全绿（G9/G11 含真实 Electron 与打包）。
4. 用户对截图目录做出 `manualAcceptance` 判定。
5. 旧功能零回退：标签、提示词、图片、WD14、ComfyUI、画布、Provider、聊天记录、工作区布局。

**明确不做**：接 NovelAI 生成 API、引入第三方词典、ChatGPT 账号登录、打包 ComfyUI、push 远程、建 Release、修改只读源。

---

## 2. 起跑线（2026-10-27 实测）

| 门禁 | 结果 |
|---|---|
| 渲染层类型 / 主进程类型 | 0 错误 / 0 错误 |
| 根测试 | 144 文件 / 1339 通过 / 2 跳过；5 次运行 3 次全绿、1 次 2 用例失败、1 次 worker 超时 |
| Cherry 适配层测试 | 35 文件 / 292 全绿 |
| Cherry 严格类型 | 272 条 = 270 条只读源码 + 2 条自有（其中 1 条是真 bug） |
| 全量构建 | exit 0 |
| 已知缺陷 | D1 死分支、D2 死变量、D3 过期快照、D4 61/79 无截图、D5 审计信号误报、D6 flaky、D7 文档口径、D8 事件 detail 不一致 |

---

## 3. 已锁定的范围与设计决策

### 3.1 范围

- **Cherry**：79 条中保留约 23 条 + 特殊 5 条；裁撤 44 条；待定 4 条；不适用 2 条；0001 为结构项。MCP 只留「服务器列表 + 详情」。
- **NovelAI**：94 项中采纳 67、后备 18、不做 9。
- **MOSS**：120 条提示词 + 120 张示例图，不下载 2.07GB 全量。
- **ComfyUI**：不内置；一个面板两个页签（内嵌网页 + 连接控制台）；先内嵌框架，失败可降级。
- **设置**：一个面板；默认主窗口整页标签；双击标题/按钮可独立窗口；自动保存与同步；防闪烁三措施。
- **视觉**：以 Cherry 源码为底二开，8 层改造；主题沿用昼夜 + 色轮。
- **旧 AI 面板**：Cherry 聊天稳定后下线，留一个版本周期过渡。

### 3.2 硬约束

1. `src/vendor/*/source` 只读。
2. UI 不得按 runtime 名分支。
3. SQLite 是唯一业务真相；不建第二套会话库。
4. 未验证能力显式 `blocked/unavailable/not-implemented`。
5. 不 reset / checkout / clean；不 push。
6. 每个里程碑本地提交一次；最终门禁前不建「完成提交」。

---

## 4. 里程碑总览

| 里程碑 | 内容 | 估计 | 依赖 |
|---|---|---|---|
| **M0** 基线可信 | 门禁脚本、G5 拆分、修 D1/D2、重测回写 | 0.5–1 天 | — |
| **M1** UI 台账 | 79 条定性、只读页 effect 审计、审计信号修复、选择器重测 | 2–3 天 | M0 |
| **M1.5** 设计基线与设置壳 | 令牌、主题桥、设置中心、面板独立窗口、品牌替换 | 3–5 天 | M0 |
| **M2** 最后一公里 | stream 合同、AgentPage 接真流、审批端到端、recovery、预热、三链路 smoke | 1–2 周 | M0/M1.5 |
| **M3** 设置面收尾 | MCP、模型/供应商、数据、依赖、提示词、快捷键、搜索 | 3–5 天 | M1.5 |
| **M6** NovelAI 吸收 | 块解析 → 版本树 → 图↔版本 → 素材 → 元数据读回 | 2–3 周 | M2/M3 |
| **M7** MOSS + ComfyUI | 资产摄入、本地图片通道、网页面板、连接工具 | 1–1.5 周 | M1.5 |
| **M4** runtime 等价 | 真实 grant、v2 结论、能力语义、Pi 边界 | ~1 周 | M2 |
| **M5** 入口与验收 | A/B、全量门禁、打包、人工验收 | 3–5 天 | 全部 |

**顺序理由**：先让「绿」可信（M0），再把「看得见」补齐（M1/M1.5），然后打通价值最高的最后一公里（M2），再铺收尾与吸收（M3/M6/M7），最后做等价审计与验收（M4/M5）。

---

## 5. 里程碑详表

### M0 — 基线可信（0.5–1 天）

| ID | 任务 | 关键文件 | 出口 |
|---|---|---|---|
| M0.1 | 一键门禁脚本 G1–G8，输出 JSON 摘要 | 新增 `scripts/gates.mjs`；`package.json` 增 `gates` | `artifacts/gates-<ts>.json` |
| M0.2 | G5 拆分：按文件分桶统计 tsc；冻结源码诊断基线 | 新增 `scripts/check-compat-types.mjs`、`.agent/gates/compat-source-baseline.json` | 自有 0 条；源码 ≤ 基线 |
| M0.3 | 修 D1：删死分支；`CompatDomainCapabilities` 挂到 general 诊断块 | `cherry-chat-shell-entry.tsx`、`CompatSourceSettings.tsx` | 面板真机可见；自有类型错误归零 |
| M0.4 | 删 D2 死变量 | `scripts/opencode-permission-smoke.mjs` | 脚本仍可跑 |
| M0.5 | 重跑 G1–G8 回写 STATE；截图清单快照改 272 | `STATE.md`、`截图清单.json` | 数字与输出对应 |
| M0.6 | 抓 D6：连跑 3 次根测试，捕获失败用例名 | `STATE.md` | 有名字、有复现条件 |

### M1 — UI 台账（2–3 天）

| ID | 任务 | 出口 |
|---|---|---|
| M1.1 | 79 条逐条定性（route/挂载/真实动作/数据源/失败态/缺口/证据）写 JSON+MD | 每条有据可查 |
| M1.2 | 6 个只读页 mount effect 审计 | 无未脱敏密钥；网络调用要么禁用要么 BLOCKED |
| M1.3 | 修路由审计信号（中文标题 → DOM 结构/角色） | 51 路由失败归零或有分类 |
| M1.4 | 模型选择器真机重测 | 选中 fixture 模型并读回偏好 |
| M1.5 | Usage / Archive 合同差距表 | supported/partial/missing |

### M1.5 — 设计基线与设置壳（3–5 天）

| ID | 任务 | 出口 |
|---|---|---|
| M1.5.1 | 设计令牌（颜色/圆角/间距/阴影/字号/动效） | 一处改、两处生效 |
| M1.5.2 | 主题桥（主进程广播 + Cherry 窗口写变量与 dark 类） | 昼夜与色轮在 Cherry 页同步 |
| M1.5.3 | 设置中心（分类 + 分组卡片 + 折叠 + 搜索） | 真机截图 + 用户确认 |
| M1.5.4 | 面板独立窗口（双击/按钮 + 状态契约 + 防闪烁） | 不丢状态、无白闪 |
| M1.5.5 | 品牌替换 | 无 Cherry 品牌残留 |
| M1.5.6 | 组件基线 | 改一处全局生效 |

### M2 — 最后一公里（1–2 周）

| ID | 任务 | 出口 |
|---|---|---|
| M2.1 | ChatEngine stream 合同（open/attach/detach/abort） | 模拟 runtime 跑通 |
| M2.2 | 源 AgentPage 接真流 | 真流式文本；刷新可 attach |
| M2.3 | 审批端到端 | allow-once 与 deny 各一条 UI 证据 |
| M2.4 | recovery：实现或 UI 不渲染 | 二者之一落地 |
| M2.5 | prewarm 收敛 | 无「假预热」 |
| M2.6 | 三链路 smoke | chat/agent/vision 可重复跑 |

### M3 — 设置面收尾（3–5 天）

MCP 列表+详情、模型/供应商、数据/依赖、提示词/快捷键/搜索、通用页只读分组。

### M6 — NovelAI 吸收（2–3 周）

| ID | 任务 | 出口 |
|---|---|---|
| M6.1 | 块解析纯函数 + 属性测试 | 往返一致 |
| M6.2 | 版本树 schema v36 + 服务 + UI | 拉分支、只看当前线 |
| M6.3 | 图↔版本多对多、回收站、删除保护 | 三种删除语义可验 |
| M6.4 | 素材合并 + `asset_usage` 反向查询 | 「这块用在哪些图」可查 |
| M6.5 | AI 整理（JSON 契约） | 三类任务有测试 |
| M6.6 | 元数据写回/读回 | 往返一致或如实降级 |

### M7 — MOSS + ComfyUI（1–1.5 周）

| ID | 任务 | 出口 |
|---|---|---|
| M7.1 | MOSS 120 条 + 120 图 + 来源登记 + 双标记 + 分类重建 | 1,742 → 1,862 |
| M7.2 | 本地图片通道 | 开发/打包都显示 |
| M7.3 | ComfyUI 面板（新面板类型，四处登记）+ 降级 | 可拖拽/拆分/独立 |
| M7.4 | 连接工具（端点/队列/节点/工作流/提交/取回/错误分级） | 控制台可用 |
| M7.5 | 移植工作流转换（界面→接口格式） | 任意工作流可导入 |
| M7.6 | 安全边界 | 越界地址被拒 |

### M4 — runtime 等价（~1 周）

真实 grant smoke、v2 结论固化、能力语义对齐、Pi 边界、recovery 结论。

### M5 — 入口与验收（3–5 天）

A/B、全量门禁 G1–G11、人工验收包、收尾提交。

---

## 6. 文件级改动地图

| 里程碑 | 新增 | 主要修改 |
|---|---|---|
| M0 | `scripts/gates.mjs`、`scripts/check-compat-types.mjs`、`.agent/gates/*.json` | `package.json`、`CompatSourceSettings.tsx`、`cherry-chat-shell-entry.tsx`、`opencode-permission-smoke.mjs`、`STATE.md` |
| M1 | `artifacts/cherry-ui-inventory.json/.md` | `audit-cherry-routes.mjs`、`MIGRATION_MATRIX.md` |
| M1.5 | `tokens.css`、`grimoire-theme.css`、`theme-palette.ts`、`SettingsCenter/*` | `settings.ipc.ts`、`preload/index.ts`、`PanelRegistry.tsx`、`PanelShell.tsx`、`WorkspacePopoutWindow.tsx`、`workspace.store.ts`、`index.ts` |
| M2 | `chat-engine-types.ts`、`scripts/e2e-*.mjs` | `ai-sessions.ipc.ts`、`agent.ipc.ts`、`agent-runtime-*.ts`、compat adapter |
| M3 | — | compat 设置页与主进程服务 |
| M6 | `prompt-blocks.ts`、`work-version.service.ts`、`asset-usage.service.ts` | `database.ts`（v36）、图库/资产业务与 UI |
| M7 | `data/default-prompt-assets/moss-character.json`、`comfyui-web/*` | `default-prompt-assets.service.ts`、`workspace-panels.ts`、`workspace.store.ts`、`PanelRegistry.tsx`、comfy 服务 |
| M4/M5 | — | 矩阵、计划、证据 |

---

## 7. 门禁与证据标准

- 每里程碑结束附：命令 + 退出码 + 运行时间 + 次数。
- 根测试连续 3 次 exit 0 才算通过。
- 网页证据：入口、观测路由、动作、可见非零边界、PNG 摘要、断言。
- 只有 PNG 文件存在不算通过。
- `manualAcceptance` 只有用户确认后才能从 `pending` 改。

---

## 8. 测试策略

| 层 | 内容 |
|---|---|
| 单元 | 块解析属性测试、版本分支规则、删除保护、权限 scope、主题调色板 |
| 集成 | IPC 端到端（假 provider）、数据库迁移（v35→v36）、MOSS 导入标记 |
| 冒烟 | 真实 Electron：设置中心、独立窗口、主题切换、ComfyUI 面板降级 |
| 手工 | 用户截图目录 + 分步清单 |

---

## 9. 风险与缓解

| # | 风险 | 缓解 |
|---|---|---|
| R1 | 只读源码 + 无 tsconfig | G5 拆分（自有=0、源码棘轮） |
| R2 | 独立窗口重新挂载 | 面板状态契约（flush/hydrate） |
| R3 | 主题覆盖过多 | 先令牌后组件，一次一层，可回退 |
| R4 | 内嵌网页被拒 | 双页签 + 自动降级 + 系统浏览器 |
| R5 | 版本树改动面大 | 先 schema 与纯函数，再接 UI；迁移前备份 |
| R6 | MOSS 来源硬编码 | 测试断言资产数与分类树 |
| R7 | 根测试 flaky | 连续 3 次 + 抓到名字再判定 |
| R8 | 多会话并行 | 单写者；并行只用只读子代理 |

---

## 10. 并行策略

- 写操作串行；每里程碑单写者。
- 只读可并行（审计、盘点、证据）。
- M1 与 M1.5 可交错，但令牌必须先于任何新界面。

---

## 11. 待用户拍板（不阻塞 M0/M1）

1. 默认主色是否换（现 #a855f7）。
2. 0041 默认模型 / 0045 供应商两页最终保留（暂按保留）。
3. 归档 / 通知 / 联网搜索 / 本地备份 四页：先裁还是先只读。
4. 设计二改验收方式：逐层对照稿，还是先做一页样板。
5. 里程碑节奏：每步停下汇报，还是一口气做完 M0–M1.5 再汇报。

---

## 12. 第一批可执行任务（接下来 3 天）

1. M0.1–M0.6 全部完成。
2. M1.1 出 JSON 骨架 + 前 20 条样例。
3. M1.5.1 设计令牌初稿（只做令牌与对照表，给颜色/密度两层对照图）。
