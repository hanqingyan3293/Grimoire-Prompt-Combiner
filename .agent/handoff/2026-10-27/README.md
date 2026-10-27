# 交接存档：2026-10-27

上一任 AI 的两个工作流交接摘要（用户提供，原文件在 `D:/File/Data/魔导书/` 根目录）。

| 文件 | 覆盖范围 | 覆盖不到 |
|---|---|---|
| `UI.md` | Cherry Studio 2.1.4 **UI-only** 源级迁移：shell、路由、设置面、截图验收、凭据边界 | 源 runtime stream/approval/recovery 的桥（明确划给另一条流） |
| `opencodepi.md` | OpenCode 1.18.34 / Pi 1.0.1 **AgentRuntime 后端**接入：turn 生命周期、admission、permission broker、provenance、lease、capability、smoke | Cherry UI、AgentPage、Topic tree、Workspace、renderer |

## 已经核实的部分（2026-10-27 只读盘点）

两份文档里的大部分事实成立，但有 4 处已经过期或与实际不符，已写入 `../STATE.md` 第 4 节：

1. `UI.md` 说 compat suite "1 failed / 34 passed / 2 failed tests" —— 实测 **35 files / 292 tests 全绿**。失败发生在 10-27 03:10，测试文件在 03:40 被更新过，之后没人重跑。
2. 两份文档都说 `/settings/general` 是 BLOCKED 诊断页 —— 实际已被挂进 `SOURCE_SETTINGS`（只读挂载 + 诊断横幅），原来的 BLOCKED 分支成了**不可达死代码**，连带 `CompatDomainCapabilities` 也渲染不到。
3. `opencodepi.md` 要求"先验证 agent.ipc.ts 的 deny 改动" —— 已核实：early throw 已删除，定向 4 个测试文件 85 用例全绿。
4. compat strict 类型门禁：文档记 254–256 条，实测 **272 条**（270 条在只读 vendor source，2 条在我们自己的文件里，其中 1 条就是上面那个死分支）。

## 使用规则

- 这两份文档是**交接输入**，不是权威。与 `../STATE.md` 冲突时以 STATE.md 的实测为准。
- 其中的"建议下一步"已并入 `../PLAN.md`，不再是独立计划。
