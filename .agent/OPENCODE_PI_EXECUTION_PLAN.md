# OpenCode / Pi AgentRuntime 接入执行计划

日期：2026-10-13。范围沿用已批准的 P3 计划；Cherry UI 由另一会话负责。本文件只管理后端 runtime 接入，不替代总迁移计划。

## Context

现有 OpenCode HTTP/SSE 和 Pi JSONL RPC 路径提供部分能力，但 binary health、单次脚本 prompt 和绿色 mock 测试不能证明生产 session/工具/权限/恢复链路。当前两条 IPC 发送路径已共享 main turn runner；新增 provider/native-session-reference 和打包改动还需要独立安全与生产链路核验，未因此完成 P3。

## 已锁定边界

- `DIRECT_REUSE → VENDOR → WRAPPER → ADAPTER → MINIMAL_MODIFICATION → PARTIAL_EXTRACTION`。`src/vendor/*/source` 只读；不重写成熟 Agent loop。
- OpenCode 保持 managed loopback server + matching-version HTTP/SSE adapter；Pi 保留已核验 RPC 基线，同时评估已安装 SDK 的 native ESM DIRECT_REUSE。SDK import 成功不等于模型/工具/权限接入。
- 单 turn、单 tool call 只有一个执行 owner。Native telemetry 不是 Host execution request；只执行明确 `toolOwnership:'host'` 的批次。
- Grimoire SQLite 是业务真相。复用现有 session/message/event 表及 main-owned namespace；不新增第二套会话/历史数据库。原生文件/远端 session 只是受管执行状态，需 identity、provenance、分支隔离和清理规则。
- 秘密只在 main 读取/使用，不回传、记录或导出。不可依赖 renderer data 中的任意 native ID、command、args 或权限标记。
- Workspace 只传已验证的 source-shaped reference，不创建/provision workspace。不改 Cherry UI、source AgentPage、Topic tree 或 renderer 工作流。
- 所有未提交改动视为用户基线；不 reset/checkout/clean/commit/push，不静默下载。

## 顺序和出口

### P3.0 事实与版本基线

核对规则、当前 git 状态、实际 scripts、manifest/hash/version、source symbols/LICENSE/闭包。厘清 Pi license audit 的旧版本记录以及两份 vendor source 缺 commit 的事实。二进制版本匹配协议 fixture 后才能声明对应 adapter 兼容；无 source commit 不声明完整 source parity。

### P3.1 统一 contract

在现有 `runtime/types.ts`/shared contracts 增量添加实际 capability：session/create/restore、turn、工具 ownership、审批、cancel、fork/compact、steer、usage/recovery。区分 session/turn/event/call/permission IDs；unsupported/unavailable/error/empty 不混淆；EOF/进程退出不假完成；未知 token/cost 不伪造 0。

### P3.2 共享 turn 和 process ownership

复用 `agent-runtime-turn.service.ts`；AI 和 Agent IPC 保留不同 persistence/event sinks，但不再维护两套发送循环。覆盖 admission、并发 send、取消中工具、终态/无终态、最大轮数、stream cleanup。Process manager 需 owner/session/config scoped leases，拒绝错误配置的并发复用；只能停止本应用所有的进程。Prewarm 不具备真实可消费 lease 时继续 fail-closed。

**Milestone 0/1/3 implementation evidence (2026-10-20)**：Added main-owned runtime capability/status ledger and gated flags; hardened owner/config OpenCode lease lifecycle; added turn admission, sender-bound exact permission broker, native action fail-closed mapping, main-owned provenance references with branch isolation, and managed preparation checks. AI/Agent IPC now use admission, scoped permission, native preparation and provenance; Pi SDK remains disabled by default. Runtime/lease/provenance/permission tests and all existing IPC tests remain green; real OpenCode text/allow-once/deny and Pi RPC/surface smokes remain the acceptance baseline.

**Milestone 0/1 implementation evidence (2026-10-18)**：Runtime capability states are exposed through main IPC/preload; `runtime:pi-sdk-surface` imports the ESM package and confirms the public export surface without reading profiles or contacting providers. `agent-runtime-lease.service.ts` provides pending-safe owner/config lease accounting; `agent-runtime-manager.ts` uses it for OpenCode, with spawn-error handling, redacted startup errors, shutdown draining and confirmed child cleanup. AI and Agent IPC pass session owners and release leases. `runtime-capabilities.test.ts`, `agent-runtime-lease.service.test.ts` and `agent-runtime-manager.test.ts` cover the new boundaries. Prewarm remains fail-closed until a full turnless provider/workspace/permission handoff is proven.

**Milestone 1 implementation evidence (2026-10-17)**：`agent-runtime-manager.ts` now uses the main-only `RuntimeLeasePool` with owner/config keyed acquisition, pending-start reservation, owner-config conflict rejection, shared same-owner leases, shutdown generation barrier, idempotent release, confirmed child-exit cleanup, spawn-error handling, redacted startup errors, and secret-free fingerprints. AI and Agent IPC pass `ai:<sessionId>` / `agent:<sessionId>` owners and release leases after runtime cleanup. `agent-runtime-lease.service.test.ts` covers pending shutdown, cancellation, close failure retention, owner isolation and release ordering; `agent-runtime-manager.test.ts` covers same-owner sharing, owner isolation, config conflict, secret fingerprint exclusion, async spawn failure and failed startup replacement. Capability states are exposed through main IPC/preload and Pi SDK ESM surface inspection passes without reading profiles or contacting providers. Prewarm remains fail-closed until a full turnless provider/workspace/permission handoff is proven.

### P3.3 Pi 接入

逐条核对 source RpcCommand/RpcResponse/AgentSessionEvent，验证生产 PiRuntime 不只是独立 CLI 脚本。Provider/model 注入优先复用 `src/integrations/pi/{piSdk,modelInjection,providerExtension}.ts`，不能另造猜测 metadata。工具/扩展默认关闭必须无法被 args/explicit -e 绕过；abort/error/settled 和 child/stdin/close 均有真实终态与超时。Main-owned native session mapping 必须在 source identity 确认后才保存，branch 不共享 parent native history。

优先评估已安装 SDK 的 model runtime、session manager、custom tools/受管 resource loader；若无法闭合 ESM/资源/权限边界，记录技术证据后保留 RPC。原生 approval 不支持时明确 unavailable，不能提供绕过 policy 的 tools。

### P3.4 OpenCode 接入

保持 `OpenCodeRuntime`/managed HTTP-SSE。真实 binary 对照后记录一个关键版本边界：1.18.34 的 `/api/session/*` v2 路由可以创建 session 并产生 durable admission 事件，但 HTTP-created session 的 `/api/session/:id/wait` 返回 503 `Session wait is not available yet`，`/api/session/:id/prompt` 不会驱动可消费的 agent loop；因此生产 adapter 使用同一 `/api/session` create/reference 入口，使用该 binary 实际工作的 legacy `/event` + `/session/:id/message` 执行协议，不把 v2 admission 当成完成。旧 legacy 路径现已由生产 adapter 的多 turn/reopen smoke 覆盖。增量处理 cursor/replay/dedupe、message/part identity、reasoning/text、permission/error/EOF、reader/cancel/进程清理。Remote references 由 main 验证并持久化，owner/config 更换及 branch 不能串原生会话。

### P3.5 工具与权限

类别 read/write/execute/network 与 auto/prompt/deny 分开；未知 native action 不降为 read 自动放行。保留完整 allowOnce/allowForSession/deny 决定并准确回传，限制 grant 范围，sender/session/call 关联可证。无法证明 native 工具工作目录、schema/路径边界和审批 handoff 的能力禁用或拒绝。Host 工具绝不重跑 native calls。真实 OpenCode 1.18.34 production smoke 已验证 native `permission.asked` 在 native tool execution 阻塞等待时通过 legacy event stream送达，Grimoire adapter 回传 `/permission/:id/reply` 的 `once`，native bash 继续并触发第二次 fake-provider 请求；`scripts/opencode-permission-smoke.mjs` 只发出无副作用 `echo`。这验证 allow-once 路径，不证明拒绝、session-wide grant、UI sender provenance 或工具路径边界完整。

### P3.6 持久化、包体、账本

Main-only namespace writes 保留 legacy 顶层含义和已有快照，不把脱敏 DTO 当 raw 数据回写。测试 generic update/branch/reopen/并发 ownership，不复制 parent native reference。验证实际 electron-builder 配置、unpacked binary hashes/versions、required assets/licenses；只写本会话对应矩阵行/证据，不覆盖另一会话 UI 记录。

### P3 execution updates (2026-10-23)

- Fixed a real first-turn provenance hole: `beginRuntimeExecutionReference` now persists `state: running` before the first native turn, so an interrupted/failed first turn cannot silently adopt a later native checkpoint. Settled references remain the only resumable state, and branches still start without the parent reference.
- Permission scope cleanup now revokes idle `allowForSession` grants as well as pending requests, removes sender destroy listeners, and clears all scopes for AI/Agent session archive/delete. The broker remains exact tool/input/action scoped; OpenCode native replies remain `once`, so process-global `always` is never trusted.
- Pi RPC child processes now receive the shared OS-only environment allowlist; provider/OAuth variables, `HOME`/profile paths and renderer runtime overrides are not inherited. The new regression test passes against an injected environment map.
- Runtime acceptance after these fixes: 142 host test files, 1325 passed, 2 skipped; main/full build and unpacked Windows packaging pass. OpenCode three-turn/reopen, allow-once and deny smokes pass; Pi RPC, Pi SDK gated runtime, SDK surface and packaged `app.asar` ESM surface loading pass. OpenCode durable replay remains **BLOCKED**: 1.18.34 exposes `/api/session/:id/event?after=` for `SessionEvent.Durable`, but the production legacy `/event` + `/session/:id/message` loop emits V1 live events that the v2 route filters out; no cursor/reconnect handoff is claimed. Recovery remains **NOT_IMPLEMENTED** because no runtime emits a source-backed recovery event.

## 验证与当前状态

每个增量都执行自动化、功能和 migration audit 三门。自动化复用 adapters、runtime-turn IPC、modelInjection、session 和 mock-provider tests；新增反例必须失败，不能以 prop/fixture shape 断言代替消费者验证。

功能：隔离 profile + loopback fake provider，通过 **生产 adapter** 分别验证两轮 prompt、恢复/分支、拒绝/取消、故障/EOF、退出/清理。独立 CLI health/prompt 只能作为二进制协议证据。测试及产物只含无密钥 fixture，记录原始退出码；只清理本次拥有的 PID/目录。

当前已记录（历史门禁，后续改动需重跑）：root 139 files / 1317 passed / 2 skipped，main/full build、unpacked pack 通过；Pi 1.0.1 与 OpenCode 1.18.34 CLI fake-provider prompt 通过。新增生产 adapter 三 turn/reopen smoke 与 native bash allow-once approval smoke 均通过；Windows 临时目录、child、reader、provider fixture 均清理。`p3-runtime-smoke.mjs` 要求完整 source checkout（`packages/opencode/package.json` 与 protocol route）；已使用本机完整 reference checkout `D:/File/Data/魔导书/项目参考/opencode-dev` 重跑并通过 Pi idle RPC/OpenCode health，两个 child 均清理，source git identity 仍 unavailable。当前 71-file vendored subset 不满足该前置条件，使用 subset 路径会在启动前如实失败，不能当作 binary/runtime failure。**生产 runtime identity、拒绝/session grant、recovery、cursor/reconnect 与 SDK DIRECT_REUSE 仍未完成；P3 保持 PARTIALLY_MIGRATED，不宣布接入完成。**

后续必需：SDK/source 复用证据、真实 owner lease、native tool/permission bridge、cursor/reconnect/recovery/fork/compaction/commands 和 source-stream 消费者；不具备条件项逐项列 BLOCKED/NOT_IMPLEMENTED 与解除条件。
