# Grimoire 项目计划（2026-10-27 起）

> 本文是**唯一的执行计划**。旧的两份执行计划与 STATUS 已归档到 [history/2026-10-27/](history/2026-10-27/README.md)。
> 现状事实见 [STATE.md](STATE.md)，门禁定义见 [GATES.md](GATES.md)，能力行级状态见 [MIGRATION_MATRIX.md](MIGRATION_MATRIX.md)。

> **已确认的范围变更（2026-10-27）**：裁剪 Cherry 产品面、吸收 NovelAI Studio 能力、内置 MOSS 提示词（120 条 + 图）、增加 ComfyUI 网页面板、设置改面板并支持独立窗口、全应用视觉二改。决策过程与逐条处置见 [records/2026-10-27-takeover/](records/2026-10-27-takeover/00-README.md)。

## 0. 完成定义（DoD）

项目可以叫"完成"的唯一条件（沿用 SPEC.md）：

1. MIGRATION_MATRIX 里每一行都有**可复现证据**，且不存在未说明的 MISSING / PARTIAL。
2. 所有 BLOCKED 行都有明确解除条件，且**用户书面接受**这些阻塞。
3. GATES 的 G1–G11 全绿（G9/G11 含真实 Electron / 打包）。
4. 用户对截图目录做出 `manualAcceptance` 判定。
5. 旧功能无回退：标签、提示词、图片、WD14、ComfyUI、无限画布、Provider、聊天记录、工作区布局。

在此之前只报 **DONE / PARTIAL / BLOCKED / MISSING / REIMPLEMENTED**，不报百分比、不报"基本完成"。

---

## 1. 排序原则

1. **先让"绿"可信，再让功能变多。** 当前账本与代码已脱节（D1 死分支、D3 过期数字、D6 flaky），在这之上做功能只会积累更多假绿。
2. **先补最后一公里，再铺广度。** UI 已经能渲染源页面，但 stream/approval/recovery 没桥——这是"看起来能用其实不能用"的最大来源。
3. **每步留证据。** 一条证据 = 命令 + 退出码 + 文件路径 + （必要时）截图/DB 行。
4. **写操作串行，只读盘点可并行。** 同一文件不并发写；只读审计交给 subagent。

---

## 2. 里程碑

### M0 — 基线可信化（0.5–1 天）

| ID | 任务 | 交付物 | 出口 |
|---|---|---|---|
| M0.1 | 建 `scripts/gates.mjs`：G1–G8 一条命令跑完，输出 JSON 摘要 | 脚本 + `artifacts/gates-<ts>.json` | 跑一次，结果与 STATE.md 第 2 节一致 |
| M0.2 | 实现 G5 拆分：按文件分桶统计 tsc 输出，冻结源码诊断基线 | `.agent/gates/compat-baseline.json` + 脚本 | 自有文件错误数单独可见；源码诊断数不得增长 |
| M0.3 | 修 D1：删除 `cherry-chat-shell-entry.tsx:1097-1110` 死分支；把 `CompatDomainCapabilities` 挂到能到达的位置（`settings/general` 的诊断横幅下方或 `settings-root`） | 代码改动 + 一条断言测试 | G5a 从 2 条降到 1 条；域能力面板真机能打开 |
| M0.4 | 删 D2 死变量 `permissionDetail`（等 M4.1 真正做 grant 时再按需加回） | 一行删除 | smoke 脚本仍能跑 |
| M0.5 | 重跑 G1–G8，把真实数字写回 STATE.md；更新截图清单的 `strictTypecheck` 快照 | STATE.md 第 2 节 | 数字与命令输出逐条对应 |
| M0.6 | 修 D6：连跑 3 次根测试，抓到失败用例名并记录（能修则修，不能修则标注 quarantine 理由） | STATE.md D6 更新 | 有名字、有复现条件 |

**M0 不做**：不碰 vendor source、不改 runtime 语义、不补依赖。

---

### M1 — UI 证据台账（2–3 天，可与 M2 并行）

目的：把"页面能渲染"升级为"每条都能说清真实动作与缺口"。

| ID | 任务 | 交付物 | 出口 |
|---|---|---|---|
| M1.1 | 79 条 catalog 逐条定性：`route / 挂载状态 / 真实动作 / 数据源 / 失败态 / 缺口 / 证据` 写成机器可读 JSON | `artifacts/cherry-ui-inventory.json` | 每条至少有一个字段能指向代码或证据；"挂载≠可用"写清 |
| M1.2 | 6 个只读挂载页的 mount effect 审计：每个源页 mount 时读了什么、发不发网络、secret 是否经过脱敏 | 表 + 必要时补 boundary | 无未脱敏 secret 读取；有网络调用的页要么禁用要么记 BLOCKED |
| M1.3 | 修 G9 信号：3 个"失败"是中文标题缺失导致；改用 DOM 结构/role 判定，或补稳定 title 信号 | 审计脚本改动 | 重跑 51 路由，失败数归零或有明确 BLOCKED 分类 |
| M1.4 | 模型选择器真机重测：更新 `scripts/audit-cherry-routes.mjs` 的动作旅程到当前路由集合 | `settings-actions.json` 新证据 | picker 能选中 fixture 的 `gpt-4o` 并读回 `cherry_pref.chat.default_model_id` |
| M1.5 | Usage / Archive 合同差距表：源 range/group/metric/sort/cursor 与当前实现的逐项对照 | 表格进 MIGRATION_MATRIX | 每项标 supported/partial/missing |

**M1 出口**：截图目录的 79 条里，"源组件已挂载"的 41 条都有真实动作定义；`manualAcceptance` 保持 pending 直到用户签字。

---


### M1.5 — 设计基线与设置壳（3–5 天，新增）

先于 M2 之后、NovelAI/ComfyUI 新界面之前完成，避免新页面按旧风格做完再返工。

| ID | 任务 | 出口 |
|---|---|---|
| M1.5.1 | 设计令牌层：颜色/圆角/间距/阴影/字号/动效统一成变量，覆盖 Cherry 样式变量 | 一份 tokens 文件 + 对照表 |
| M1.5.2 | 设置面改为占满窗口的标签页（左侧分类 + 分组卡片 + 折叠 + 全局搜索），保留独立窗口入口 | 真机截图 + 分类清单 |
| M1.5.3 | 品牌层替换：产品名/图标/关于页/窗口标题/空状态 | 全局搜索不到 Cherry 品牌残留 |
| M1.5.4 | 视觉二改对照表（8 层）逐项落地，用户逐项确认 | 用户签字 |
| M1.5.5 | 组件基线：按钮/开关/标签/对话框/表格 | 一处改、全局生效 |

### M2 — 最后一公里：UI ↔ Runtime（1–2 周，主轨）

这是当前最大的价值缺口。

| ID | 任务 | 关键文件 | 出口 |
|---|---|---|---|
| M2.1 | **Runtime stream 合同**：定义 open / attach / detach / abort 的 ChatEngine 语义 + IPC 通道 + 事件归一化 | `src/main/ai/runtime/types.ts`、`src/main/ipc/*`、`src/shared/*` | 一个模拟 runtime 能完成 open→delta→abort 的可测链路 |
| M2.2 | **源 AgentPage 接上真实 stream**：把 source 的 `ai.stream.*` 消费面接到上面的合同 | compat 侧 adapter（不得改 source） | 打开 AgentPage 能收到真实流式文本；断流能 attach 回去 |
| M2.3 | **approval 端到端**：真实 `permission.asked` → 主进程 broker → UI 卡片（已有投影）→ 决策 → native reply `once`/`reject`，并带 sender provenance | `agent-runtime-permission.service.ts`、`ai-sessions.ipc.ts`、`agent.ipc.ts` | 真实 OpenCode 上 allow-once 与 deny 各一条带 UI 证据的记录 |
| M2.4 | **recovery 决策**：要么实现 source-backed recovery 事件（Pi/OpenCode 各一条路径），要么 UI 不渲染恢复入口 | `types.ts` 的 `recovery` 变体 | 二者之一落地，矩阵口径同步 |
| M2.5 | **prewarm / prewarm-fail-closed 收敛**：当前 `agent-session-prewarm` 是 fail-closed；要么给它真实可消费的 lease，要么 UI 明示不可用 | `agent-session-prewarm.service.ts` | 不再存在"看似预热、实际没有"的状态 |
| M2.6 | **真实 provider 三链路 smoke**：chat / agent / vision 各一条，含取消与拒绝；证据格式统一 | `scripts/agent-e2e-*.mjs` | 三条脚本可重复跑，产物落 `artifacts/e2e/` |

**M2 出口**：在真实 provider 下走完"发消息 → 流式 → 工具调用 → 审批 → 取消 → 恢复"一条完整证据链。

---

### M3 — 设置与领域面补齐（1–2 周）

| ID | 任务 | 出口 |
|---|---|---|
| M3.1 | Skills：实现 bounded `useBlocker` shim + skill catalog 服务；接 `CompatSkillsSettings` 进 shell（或明确移除 wrapper 并保持诊断） | 技能页能列出真实目录；写操作 fail-closed |
| M3.2 | Scheduled tasks：任务 CRUD/调度/日志接 Grimoire 服务 | 任务页能创建/暂停/看日志 |
| M3.3 | File preview / `file.tree`：真实 MIME/读取/预览；树深度 >1、rename/write/trash 的拒绝语义 | 预览有效文件；无效路径有真实错误 |
| M3.4 | Usage / Archive 实现（按 M1.5 的表） | 未支持项返回能力错误，不返回空数据 |
| M3.5 | 剩余 11 个 BLOCKED 设置页：逐页给"实现 or 保持 BLOCKED + 解除条件" | 矩阵里每个 BLOCKED 都有解除条件 |

**M3 出口**：设置面不再有"能打开但什么都不做"的页；每个缺口都有名字。

---

### M4 — Runtime 等价（约 1 周，可与 M3 交替）

| ID | 任务 | 出口 |
|---|---|---|
| M4.1 | 真实 OpenCode session-grant smoke：allowForSession → 同 scope 二次不弹 → 改 pattern 再弹 → 跨 session 不继承 → deny → 清理 | 6 步全过的日志 + 脱敏 scope 证据 |
| M4.2 | v2 durable 结论固化：确认能否用公开 API 启动 runner；不能则矩阵改为 "admission-level replay supported / execution replay BLOCKED" | 一份可复现的 probe 报告 |
| M4.3 | capability 语义对齐：`process.lease`（生产恒 unavailable 但租约真实存在）、`permission.session`（本地 grant vs native always） | 账本能被外部读者正确理解 |
| M4.4 | Pi：native approval/tools 保持 blocked 并写清解除条件；SDK 在打包产物里验证 ESM surface | 打包内加载证据 |
| M4.5 | recovery 结论与矩阵口径统一（与 M2.4 合并收口） | 无悬空能力 |

---

### M5 — 入口与全量验收（3–5 天）

| ID | 任务 | 出口 |
|---|---|---|
| M5.1 | source-shell vs compat 的 A/B 评估：功能覆盖、缺失消费者、切换代价 | 一份对比表 + 我的建议 |
| M5.2 | 全量门禁：G1–G11（含 pack 与 Windows 冒烟） | 全绿记录 |
| M5.3 | 人工验收包：截图目录 + 分步操作清单 + 已知缺口 | 用户逐项签字 |
| M5.4 | 收尾：更新矩阵/状态/决策；commit（**需用户授权**） | 干净的收尾提交 |

---

## 3. 依赖关系

```
M0 ──► M2 ──► M5
 │      ▲
 └► M1 ─┘
        └► M3 ──► M4 ──► M5
```

- M1/M3/M4 之间没有硬依赖，但共用同一批文件时要串行。
- M2 依赖 M0 的 G5 拆分（否则无法判断自己有没有引入新错误）。

## 4. 风险

| # | 风险 | 影响 | 应对 |
|---|---|---|---|
| R1 | 648MB 迁移成果未纳入版本控制（`.agent` 整个目录都未跟踪） | 一次误操作不可恢复 | 已做 `验收备份/2026-10-27-pre-takeover`；**建议授权在独立分支做基线提交** |
| R2 | Cherry 源码只读且缺自带 tsconfig | 类型门禁永远红 | 已决策 G5 拆分（G5a 真 0 + G5b 棘轮） |
| R3 | Electron 证据依赖本机 GUI / DPI / 多屏 | 无法 CI，人工验收不可替代 | 证据脚本统一落 `artifacts/` + 记录屏幕参数 |
| R4 | 源码缺 18 个依赖模块 | 类型基线无法降到 0 | 补依赖单独决策，不顺手做 |
| R5 | 历史上多会话并行写同一账本，导致日期/数字矛盾 | 事实不可信 | 本文 + STATE.md 单写者；并行只用只读 subagent |
| R6 | 根测试 flaky | "绿"不可信 | 连续 3 次才算通过；抓到名字再判定 |
| R7 | 用户人工验收是唯一终审 | 可能反复 | 每个里程碑末给一份可照做的验收清单 |

## 5. 本次已做的决定（可在 DECISIONS.md 追加）

| ID | 决定 | 理由 |
|---|---|---|
| P-01 | compat 类型门禁拆成 G5a（自有=0）+ G5b（源码棘轮） | 270/272 条错误在只读源码里；真 0 不可达，清零=自欺；拆分后立刻抓到 D1 死分支 |
| P-02 | 文档体系改为 STATE / GATES / PLAN 三分 + history/handoff 归档 | 旧的三份大账本互相矛盾，读者无法判断哪句为真 |
| P-03 | 旧文档移动而非删除 | 保留可追溯性，用户明确允许 |
| P-04 | 计划改由本文件统一，两份执行计划归档 | 一个项目不能有两份"下一步" |
| P-05 | 默认入口暂不切 source-shell，M5 再评估 | 用户已解除该约束；但切换需要 tabs/mini-app/runtime 状态，当前不具备 |
| P-06 | 先做 M0+M1，再做 M2 | 假绿之上做功能会放大返工 |

## 6. 需要用户拍板

1. **commit 授权**（最重要）：是否允许我在独立分支上做一次基线提交（不 push）？没有它，648MB 只有一份 28MB 的目录快照兜底。
2. **优先级**：按 M0→M1→M2 走，还是先集中火力做 M2（让 AI 页面真能用），把 M1 台账压后？
3. **产品形态**：最终你要的是"和 Cherry 一样的真 shell"，还是"Grimoire 外壳 + Cherry 组件"？这决定 M5.1 的结论方向。
4. **验收节奏**：每个里程碑末要不要一份"可照做的人工验收清单"（截图+步骤+预期）？