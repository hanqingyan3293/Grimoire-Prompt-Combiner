以下内容可直接交接给下一位 Agent。**注意：最近一次完整绿色门禁是在当前最后一批 WIP 修改之前；当前工作树仍需重新运行定向测试和全量 gates 后，才能再次声明为绿色。不要 reset、checkout、clean、覆盖或丢弃现有变更，也不要 commit/push。**

## 项目当前目标

本工作流只负责 **Grimoire 的 OpenCode / Pi AgentRuntime 后端接入与生产边界验证**。

范围包括：

- OpenCode managed loopback server、HTTP/SSE adapter、session identity、权限、取消、进程租约、持久化 provenance、replay/reconnect 可行性。
- Pi 1.0.1 JSONL RPC 生产基线，以及 feature-gated Pi SDK DIRECT_REUSE 适配器。
- AI/Agent IPC 到 shared runtime turn runner、permission broker、SQLite 业务会话的集成。
- main-process-only secrets、runtime workspace、binary/version、child process 生命周期和包内 ESM 可加载性。

明确不在范围内：

- Cherry UI、AgentPage、Topic tree、Workspace、renderer 工作流。
- 修改 `src/vendor/*/source`；这些 vendor source 是只读证据。
- 新增第二套业务会话/历史数据库。
- 将未验证的能力伪装成已完成。

当前迁移状态：

- OpenCode runtime：`PARTIALLY_MIGRATED`
- Pi runtime：`PARTIALLY_MIGRATED`
- Pi SDK：feature-gated，默认生产路线仍是 Pi RPC
- Recovery：`NOT_IMPLEMENTED`
- OpenCode legacy replay/reconnect：仍需要按当前新证据重新定义 blocker，尚不能声称完整实现

---

## 已完成模块与状态

### 1. Shared AgentRuntime 与 turn 生命周期

已实现并接入：

- 统一 turn runner：[agent-runtime-turn.service.ts](src/main/services/agent-runtime-turn.service.ts)
  - 有界 turn 数；
  - terminal event 必需；
  - EOF 无 terminal 视为失败；
  - cancellation；
  - Host/runtime tool ownership 分离；
  - Host tool call 去重；
  - AI 与 Agent 各自保留独立 persistence/event sink。
- turn admission：[agent-runtime-admission.service.ts](src/main/services/agent-runtime-admission.service.ts)
  - 同一 session 不允许重叠 send；
  - sender-bound cancel；
  - window destroy 时取消；
  - stale release 不会删除更新后的 reservation。

### 2. OpenCode 1.18.34 legacy production adapter

核心实现位于 [adapters.ts](src/main/ai/runtime/adapters.ts)。

已验证行为：

- 使用 `/api/session` 创建或恢复 remote session identity。
- 实际 Agent execution 使用 legacy：
  - `GET /event`
  - `POST /session/:id/message`
  - `POST /session/:id/abort`
  - `POST /permission/:requestID/reply`
- 实际 binary smoke 已验证：
  - 同一 native session 两轮；
  - 新 adapter 实例利用 persisted remote reference reopen；
  - 三轮最终返回 `adapter ok`；
  - user message echo 不会误投影为 assistant text；
  - reasoning/text/tool/permission/compaction 事件有归一化；
  - `EOF` 无 terminal event 会失败；
  - reader 与 prompt body 会清理；
  - per-session 并发发送受限；
  - per-turn bounded event ID 去重。

正常 smoke：

- [opencode-adapter-smoke.mjs](scripts/opencode-adapter-smoke.mjs)
- `node scripts/opencode-adapter-smoke.mjs`

### 3. OpenCode native permission

已验证：

- native bash `allow once`；
- native bash `deny`；
- allow-once 后 native tool 继续，provider 收到 tool result 后生成后续回答；
- deny 后工具不会继续执行，runtime 以 native tool error + terminal idle 收束；
- OpenCode native `always` 不被使用，main broker 仅向 native 回复 `once` 或 `reject`；
- `task`、`skill`、`question`、`external_directory` 保持拒绝；
- unknown native action 映射为 `execute`，不能被 automatic mode 降级为 read。

核心文件：

- [adapters.ts](src/main/ai/runtime/adapters.ts)
- [tools.ts](src/main/ai/runtime/tools.ts)
- [agent-runtime-permission.service.ts](src/main/services/agent-runtime-permission.service.ts)
- [opencode-permission-smoke.mjs](scripts/opencode-permission-smoke.mjs)

**当前 WIP：**

- 正在为真实 native `permission.asked` payload 增加 sanitized scope 输出，以确认其能否形成 `patterns + tool.name` 的 exact session grant key。
- [opencode-permission-smoke.mjs](scripts/opencode-permission-smoke.mjs) 目前新增了 `permissionDetail` 局部变量，但尚未写入结果输出，属于未完成修改；应完成脱敏投影或删除该变量后再跑 smoke。
- `GRIMOIRE_DEBUG_APPROVAL=1` 的调试路径出现过一个未处理的 `OpenCode Runtime 已关闭`；正常非 debug smoke 此前通过。不要把 debug 模式当 acceptance gate，需先修复其 clone-reader 生命周期。

### 4. Permission broker、session grant 与 IPC 清理

核心实现：

- [agent-runtime-permission.service.ts](src/main/services/agent-runtime-permission.service.ts)
- [ai-sessions.ipc.ts](src/main/ipc/ai-sessions.ipc.ts)
- [agent.ipc.ts](src/main/ipc/agent.ipc.ts)

已完成：

- grant 精确绑定 sender、scope、action、native detail/resource；
- `allowForSession` 不会放宽到同一 read/write/execute permission kind 的所有工具；
- unknown/stale/wrong-sender permission decision 拒绝；
- abort、destroy、timeout 后 late decision 无效；
- `clearScope` 能删除 idle grant，不只取消 pending request；
- AI archive/delete 和 Agent delete 会清理对应 session 的 grant；
- sender destroy listener 在 scope cleanup 后移除。

新补充的 IPC 测试位于：

- [runtime-turn.ipc.test.ts](src/main/ipc/runtime-turn.ipc.test.ts)

已在本轮中通过的定向测试覆盖：

- AI 与 Agent production IPC 均可对相同 native exact scope 使用 session grant；
- 改变 native resource pattern 会重新 prompt；
- AI archive 会撤销 session grant；
- Agent delete 会撤销 grant，并解除 sender listener。

**但注意：这些测试在最新一次修改 [agent.ipc.ts](src/main/ipc/agent.ipc.ts) 后尚未重新执行。**

### 5. Agent IPC native deny 语义修正

刚刚修改但**尚未重新验证**：

- [agent.ipc.ts](src/main/ipc/agent.ipc.ts) 原先在将 native deny 回复给 runtime 后仍执行：

  ```ts
  throw new Error("Agent 权限请求被拒绝：" + event.action);
  ```

- 这与真实 OpenCode deny 的语义冲突：runtime 会产生 native tool error 并自己进入 terminal state，而 Agent IPC 额外抛错会把已正常收束的 native deny 变成 Agent session failure。
- 已移除该 early throw，使 AI 与 Agent 都等待 runtime 的真实 terminal event。

下一位 Agent 必须先验证：

```bash
npx vitest run src/main/ipc/runtime-turn.ipc.test.ts
```

然后再运行相关 IPC、adapter 与全量测试。

### 6. Runtime provenance 与执行状态

核心文件：

- [agent-runtime-reference.service.ts](src/main/services/agent-runtime-reference.service.ts)
- [agent-runtime-preparation.service.ts](src/main/services/agent-runtime-preparation.service.ts)
- [ai-session.service.ts](src/main/services/ai-session.service.ts)
- [agent-session.service.ts](src/main/services/agent-session.service.ts)

已完成：

- `__runtimeExecution` 是 main-owned namespace；
- 保存 runtime、driver、owner、directory、binary version、config fingerprint、native ID、`running/settled`；
- 首个 native turn 在执行前写入 `state: "running"`；
- 仅 settled checkpoint 可以 resume；
- generic metadata/data update 不能注入或擦除 runtime reference；
- branch 不继承 parent native reference；
- owner/config/version/directory 不匹配时 resume 拒绝；
- public DTO 移除 main-owned reference。

### 7. OpenCode managed process / lease

核心文件：

- [agent-runtime-lease.service.ts](src/main/services/agent-runtime-lease.service.ts)
- [agent-runtime-manager.ts](src/main/services/agent-runtime-manager.ts)
- [agent-runtime-safety.service.ts](src/main/services/agent-runtime-safety.service.ts)

已完成：

- owner/config fingerprint scoped `RuntimeLeasePool`；
- pending startup reservation；
- same owner + same config 才可共享；
- owner 同时使用不同 config 会拒绝；
- child exit 使 lease 无效；
- startup failure、shutdown、release 都走 idempotent cleanup；
- config fingerprint 不包含原始 secret；
- OpenCode 临时 config 和 per-owner profile/state directory 隔离；
- Pi RPC child 改为 OS-only environment allowlist，不继承 provider/OAuth/profile/runtime override 变量。

### 8. Pi 1.0.1 JSONL RPC

核心文件：

- [adapters.ts](src/main/ai/runtime/adapters.ts)
- [modelInjection.ts](src/integrations/pi/modelInjection.ts)
- [pi-headless-smoke.mjs](scripts/pi-headless-smoke.mjs)

已验证：

- Pi 1.0.1 JSONL RPC prompt/delta/settled；
- fake provider 输出；
- native session-file persistence；
- isolated temporary `PI_CODING_AGENT_DIR`；
- native tools/extensions 默认关闭；
- `agent_end` 不作为终态，必须等待 `agent_settled`。

默认生产路线仍为 Pi RPC。

### 9. Pi SDK feature-gated adapter

核心文件：

- [piSdk.ts](src/integrations/pi/piSdk.ts)
- [sdk-session.ts](src/integrations/pi/sdk-session.ts)
- [pi-sdk.runtime.ts](src/main/ai/runtime/pi-sdk.runtime.ts)
- [pi-sdk-tool-bridge.service.ts](src/main/services/pi-sdk-tool-bridge.service.ts)
- [pi-sdk-runtime-smoke.mjs](scripts/pi-sdk-runtime-smoke.mjs)

已验证的 gated runtime smoke：

- ESM-only import；
- 两轮 prompt；
- resume；
- full-history fork；
- custom host tool allow-once；
- deny；
- exact-input session grant；
- cancellation；
- manual compaction；
- provider error、split secret delta、summary secret 的 redaction；
- native state digest mismatch 拒绝；
- 无 external resources；
- 无 native tools；
- cleanup。

默认 feature flag 关闭：

```text
GRIMOIRE_PI_SDK_RUNTIME=1
```

才允许 registry 选择 SDK adapter。

### 10. Package / regression baseline

**最近一次完整绿色 baseline，发生在后续 WIP 修改之前：**

- `npm test`：142 test files，1325 passed，2 skipped；
- `npm run build:main`：通过；
- `npm run build`：通过；
- `npm run pack`：通过；
- `npm run check:migration-matrix`：115 data rows，无 malformed rows；
- unpacked Windows `app.asar` 中实际动态加载 Pi SDK ESM surface：通过；
- OpenCode text/reopen、allow-once、deny、Pi RPC、Pi SDK runtime、Pi SDK surface、source-backed idle smoke：通过。

当前最新 WIP 之后必须重跑全部相应 gates。

---

## 关键架构决策及理由

### 1. SQLite 是唯一业务真相

Grimoire SQLite 保存业务 session、message、event。

OpenCode remote session ID、Pi native JSONL/session state 只能作为受管理 execution state，不能成为第二业务会话数据库。所有 native references 通过 main-owned provenance namespace 保存。

### 2. UI 不得识别具体 runtime

renderer/UI 只消费统一 `AgentRuntime` contract 和 normalized runtime events，不得按 `opencode`、`pi` 或其他 runtime 分支决定业务行为。

### 3. Native telemetry 不会重新执行 Host tool

native OpenCode/Pi tool event 是 presentation telemetry。只有 `completed.toolOwnership === "host"` 的 batch 才能进入 Grimoire ToolRegistry，避免 native tool 执行被 replay 或重复执行。

### 4. 权限必须 fail-closed、精确 scope

- unknown native action → `execute`；
- session grant 不可扩大成全局 permission kind；
- sender、session、config fingerprint、action、tool/input/resource scope 都必须一致；
- OpenCode native process-wide `always` 不可信，native reply 永远维持 once；
- 无法证实的 native tools 或路径边界保持禁用/blocked。

### 5. OpenCode legacy execution 仍是实际生产路径

legacy `/event` + `/session/:id/message` 已被真实 binary 验证能执行 provider loop、native permission、tool continuation 和 terminal idle。

v2 路径是独立的 experimental durable session protocol，不能只因 API 存在就替换 legacy adapter。

### 6. 新发现：OpenCode v2 durable replay 本身存在，但只验证到 admission

真实 1.18.34 v2 probe 当前证明：

- `POST /api/session/:id/prompt` 返回 200；
- 返回 `SessionInput.Admitted`；
- `GET /api/session/:id/event?after=0` 可以读取 durable event；
- `GET /api/session/:id/history?after=0&limit=100` 可以读取 finite durable history；
- durable sequence 为 `1, 2`；
- durable types 为：
  - `session.next.prompt.admitted`
  - `session.next.prompted`

相关 source：

- `packages/protocol/src/groups/session.ts`
- `packages/core/src/session.ts`
- `packages/core/src/event.ts`
- `packages/schema/src/session-event.ts`
- `packages/schema/src/durable-event-manifest.ts`

但当前 binary probe 同时观察到：

- session agent/model 都正确；
- `GET /api/session/active` 返回空；
- fake provider request 数为 `0`；
- 没有 `session.next.step.*`、text、tool 或 terminal durable events。

因此当前结论应为：

> **v2 durable admission + finite replay 已验证；v2 Agent execution 未验证且在当前 bundled binary/config 下未启动。**

不能据此接通 production adapter，也不能声称 replay/reconnect 完成。

### 7. Recovery 保持 NOT_IMPLEMENTED

当前没有 runtime、adapter 或 integration 发出 source-backed `recovery` event。不能根据 SSE EOF、health、native state 文件或 restart 推断 recovery 成功。

---

## 核心文件清单及其职责

| 文件                                                                                           | 职责                                                                                    |
| ---------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| [OPENCODE_PI_EXECUTION_PLAN.md](.agent/OPENCODE_PI_EXECUTION_PLAN.md)                          | 本专项执行计划、证据、当前 blocker。                                                    |
| [MIGRATION_MATRIX.md](.agent/MIGRATION_MATRIX.md)                                              | OpenCode/Pi 迁移状态；必须保持不夸大完成度。                                            |
| [DECISIONS.md](.agent/DECISIONS.md)                                                            | 运行时、权限、SQLite、lease、provenance 等决策理由。                                    |
| [adapters.ts](src/main/ai/runtime/adapters.ts)                                                 | OpenCode legacy adapter、Pi RPC adapter、SSE/JSONL normalization、native permission。   |
| [types.ts](src/main/ai/runtime/types.ts)                                                       | Runtime contract、event union、capability model、tool ownership。                       |
| [registry.ts](src/main/ai/runtime/registry.ts)                                                 | runtime factory、Pi SDK feature gate、OpenCode main-provided config forwarding。        |
| [capabilities.ts](src/main/ai/runtime/capabilities.ts)                                         | `supported / unavailable / blocked / not-implemented` ledger。                          |
| [features.ts](src/main/ai/runtime/features.ts)                                                 | main-only feature flags。                                                               |
| [pi-sdk.runtime.ts](src/main/ai/runtime/pi-sdk.runtime.ts)                                     | gated Pi SDK adapter。                                                                  |
| [agent-runtime-turn.service.ts](src/main/services/agent-runtime-turn.service.ts)               | AI/Agent 共用 turn loop。                                                               |
| [agent-runtime-admission.service.ts](src/main/services/agent-runtime-admission.service.ts)     | per-session admission/cancel。                                                          |
| [agent-runtime-permission.service.ts](src/main/services/agent-runtime-permission.service.ts)   | exact permission grant、pending decision、scope cleanup。                               |
| [agent-runtime-reference.service.ts](src/main/services/agent-runtime-reference.service.ts)     | main-owned runtime provenance、running/settled reference。                              |
| [agent-runtime-preparation.service.ts](src/main/services/agent-runtime-preparation.service.ts) | main-owned provider/workspace/version/reference preparation。                           |
| [agent-runtime-manager.ts](src/main/services/agent-runtime-manager.ts)                         | managed OpenCode child process、isolated config、version/lease 管理。                   |
| [agent-runtime-lease.service.ts](src/main/services/agent-runtime-lease.service.ts)             | owner/config lease pool。                                                               |
| [agent-runtime-safety.service.ts](src/main/services/agent-runtime-safety.service.ts)           | workspace validation、safe environment、error redaction。                               |
| [ai-sessions.ipc.ts](src/main/ipc/ai-sessions.ipc.ts)                                          | AI send/interrupt/permission/SQLite persistence 集成。                                  |
| [agent.ipc.ts](src/main/ipc/agent.ipc.ts)                                                      | Agent send/permission/event persistence 集成；当前有未重新验证的 native deny 语义修正。 |
| [runtime-turn.ipc.test.ts](src/main/ipc/runtime-turn.ipc.test.ts)                              | AI/Agent shared loop、native grant、archive/delete cleanup 集成测试。                   |
| [opencode-adapter-smoke.mjs](scripts/opencode-adapter-smoke.mjs)                               | legacy production adapter 三 turn/reopen smoke。                                        |
| [opencode-permission-smoke.mjs](scripts/opencode-permission-smoke.mjs)                         | real OpenCode allow-once / deny native bash smoke。                                     |
| [opencode-event-replay-smoke.mjs](scripts/opencode-event-replay-smoke.mjs)                     | v2 durable admission/event/history probe；不是 legacy execution acceptance。            |
| [pi-headless-smoke.mjs](scripts/pi-headless-smoke.mjs)                                         | Pi RPC binary smoke。                                                                   |
| [pi-sdk-runtime-smoke.mjs](scripts/pi-sdk-runtime-smoke.mjs)                                   | gated Pi SDK lifecycle/tool/redaction smoke。                                           |

---

## 已知遗留问题

1. **OpenCode v2 Agent execution 未验证。**  
   已确认 v2 prompt admission 和 durable history/replay，但当前 binary 没有在 v2 path 触发 provider request 或 durable step/text events。需要继续诊断 runner activation、catalog/model availability 或 binary integration gap。

2. **OpenCode legacy reconnect/replay 未实现。**  
   legacy `/event` 是 live instance stream，没有已经验证的 persistent cursor；当前只有 per-turn bounded dedupe。不能把 v2 admission replay 当成 legacy execution replay。

3. **OpenCode session grant 的真实 binary end-to-end smoke 尚未完成。**  
   broker 和 IPC mock 已覆盖 exact scope，但需要从真实 `permission.asked` payload 提炼安全、稳定、脱敏的 scope input，并验证：
   - 相同 session + 相同 action + 相同 resource 范围不重复 prompt；
   - 变更 resource/input 必须重新 prompt；
   - 不同 local session 不能继承；
   - native reply 始终是 `once`，不发送 process-global `always`。

4. **当前 WIP 尚未回归。**  
   特别包括：
   - [agent.ipc.ts](src/main/ipc/agent.ipc.ts) 删除 native deny 后 early throw；
   - [runtime-turn.ipc.test.ts](src/main/ipc/runtime-turn.ipc.test.ts) 新增 IPC grant/archive/delete 测试；
   - [opencode-event-replay-smoke.mjs](scripts/opencode-event-replay-smoke.mjs) v2 diagnostics；
   - [opencode-permission-smoke.mjs](scripts/opencode-permission-smoke.mjs) 尚未完成的 `permissionDetail` 输出工作。

5. **debug permission smoke 有生命周期问题。**  
   `GRIMOIRE_DEBUG_APPROVAL=1` 下 clone stream reader 可能在 runtime close 后产生未处理异常；正常 smoke 不受此路径影响，但调试路径要么修复、要么删除。

6. **OpenCode fork/compaction/recovery parity 不完整。**  
   feature-gated native operations 不能等同 source parity；需要独立 source/wire + real binary 验收。

7. **Pi RPC native approval / native tools / extensions 未实现。**  
   保持 blocked，不得通过 CLI args 或 renderer metadata 绕过。

8. **Pi SDK 仍不应设为默认。**  
   gated smoke 很强，但完整 packaged SDK turn lifecycle、default switch、生产回归和 broader source parity 仍未闭合。

9. **完整 source parity 未完成。**  
   当前所有相关矩阵行继续是 `PARTIALLY_MIGRATED`。

---

## 建议的下一步

### 1. 先稳定当前 WIP，再进行任何扩展

优先执行：

```bash
npx vitest run src/main/ipc/runtime-turn.ipc.test.ts
```

```bash
npx vitest run src/main/ipc/agent.ipc.test.ts src/main/services/agent-runtime-permission.service.test.ts src/main/ai/runtime/adapters.test.ts
```

```bash
npm run build:main
```

检查 [agent.ipc.ts](src/main/ipc/agent.ipc.ts) 的 native deny 改动后，AI 与 Agent 两条路径是否都由 runtime terminal event 决定最终状态。

完成或删除 [opencode-permission-smoke.mjs](scripts/opencode-permission-smoke.mjs) 中尚未使用的 `permissionDetail`，避免留下半成品诊断变量。

### 2. 完成真实 OpenCode session-grant smoke

在 [opencode-permission-smoke.mjs](scripts/opencode-permission-smoke.mjs) 中：

- 将 `permission.asked` 的 detail 投影为脱敏、有限长度的结构；
- 先确认 `patterns`、`tool.name`、call ID 和 action 的实际字段；
- 不要将完整 native payload 或可能包含路径/secret 的数据写入日志；
- 使用同一 native session 完成：
  1. allowForSession；
  2. 同 scope second tool call；
  3. changed pattern/input tool call；
  4. second local session；
  5. deny；
  6. cleanup。
- 如果实际 native payload 无法形成安全 exact scope，保留 `permission.session = blocked`，不能猜测 scope。

### 3. 继续 v2 execution diagnosis，但不要替换 legacy adapter

以 [opencode-event-replay-smoke.mjs](scripts/opencode-event-replay-smoke.mjs) 为基础：

- 保持 v2 prompt + `/event?after=` + `/history` 的真实证据；
- 记录以下无秘密信息：
  - session model/agent；
  - `/api/session/active`；
  - provider request count；
  - durable event sequence/type；
  - finite history page；
- 查明 v2 wake 为什么不调度 `SessionRunner`：
  - binary 是否缺少 location runner binding；
  - catalog/model availability 是否未被 v2 location layer 接纳；
  - 是否需要公开但未暴露的 resume/run route；
  - 是否是 bundled 1.18.34 的已知 incomplete v2 slice。
- **只有满足以下全部条件，才考虑 v2 execution adapter：**
  - real provider request；
  - durable step/text/tool/terminal events；
  - cancellation；
  - permission bridge；
  - reconnect from durable cursor；
  - finite history + live stream handoff 无重复；
  - native identity/provenance 绑定。
- 在此之前，legacy adapter 继续为生产 execution path。

### 4. 保留并明确 blocker

若 v2 runner 在当前 binary 无法被公开 API 启动，应将矩阵和专项计划改为更精确的状态：

- `event.replay`：v2 **admission-level durable replay supported by source/binary probe**，但 **production execution replay BLOCKED**；
- legacy execution replay：`BLOCKED`；
- recovery：`NOT_IMPLEMENTED`。

不要将 v2 admission SSE 直接标为完整 Agent turn replay。

### 5. 最后重新执行完整 gates

在当前 WIP 稳定后：

```bash
npm test
```

```bash
npm run build
```

```bash
npm run pack
```

```bash
npm run check:migration-matrix
```

然后重新运行：

```bash
node scripts/opencode-adapter-smoke.mjs
```

```bash
node scripts/opencode-permission-smoke.mjs
```

```bash
node scripts/opencode-permission-smoke.mjs --deny
```

```bash
node scripts/opencode-event-replay-smoke.mjs
```

```bash
node scripts/pi-headless-smoke.mjs
```

```bash
node scripts/pi-sdk-runtime-smoke.mjs
```

最后更新 [OPENCODE_PI_EXECUTION_PLAN.md](.agent/OPENCODE_PI_EXECUTION_PLAN.md)、[MIGRATION_MATRIX.md](.agent/MIGRATION_MATRIX.md)、[DECISIONS.md](.agent/DECISIONS.md) 和 [STATUS.md](.agent/STATUS.md)，但不要创建 completion commit 或 push。
