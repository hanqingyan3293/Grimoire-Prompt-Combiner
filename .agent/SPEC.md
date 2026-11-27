# Grimoire migration specification

## Product definition

Grimoire is a local-first Electron creative workspace that integrates mature AI, Agent, Prompt, Tag, Media, WD14, Infinite Canvas, and Blender-style Workspace capabilities through source migration and adapters.

## Layered architecture

The product is assembled as a capability platform, with Grimoire Core owning the contracts between layers:

~~~text
UI Layer
  Cherry UI and Grimoire panels
        |
Application Contracts
  ChatEngine / WorkspaceEngine / ToolRegistry
        |
Runtime and Adapter Layer
  AgentRuntime -> Pi kernel, OpenCode policy, future Codex adapter
  WorkspaceAdapter -> Dockview or another docking engine
  Domain adapters -> Prompt, Tag, Image, WD14, Canvas
        |
Domain and Storage Layer
  PromptService / TagService / ImageService / WD14Service / CanvasService
  Grimoire SQLite, asset storage, settings, project state
~~~

The UI only consumes application contracts. It must not identify or special-case a concrete agent runtime. A runtime may be composed from Pi lifecycle primitives, OpenCode advanced policy, Grimoire tools, and a provider adapter without changing the chat UI.

The minimum contract surface is:

- ChatEngine: send a message, stream events, cancel work, and restore a session.
- AgentRuntime: create or restore a session, send a message, stream events, execute tools, approve permissions, cancel, and recover.
- WorkspaceEngine: open, close, split, merge, move, dock, float, pop out, maximize, restore, serialize, switch, and reset editors.
- ToolRegistry: register, discover, validate, invoke, cancel, and report failures for Prompt, Tag, Image, Canvas, File, Search, MCP, WD14, and Workspace tools.
- Domain services: own business rules and persistence adapters for Prompt, Tag, Image, WD14, Canvas, and project assets.

Each boundary must have an explicit adapter, typed events, error states, cancellation, and recovery behavior. The source project remains auditable under src/vendor/project; Grimoire-specific integration remains under src/integrations/project or the corresponding service boundary.

## Non-negotiable parity

- Cherry AI UI: source-level chat shell, sessions, message parts, Markdown, code blocks, Composer, attachments, model/provider selection, tool state, permission state, MCP UI, and settings behavior.
- Agent: Agent Loop, Session, Context, streaming events, tools, permissions, MCP, cancellation, retry, errors, lifecycle, persistence, recovery, and sub-agent/compaction behavior where present in the source.
- Workspace: Workspace, Area, Editor, Region, Tab, Split, Merge, Move, Dock, Float, Popout, Maximize, Restore, serialize, restore, switch, and reset.
- Infinite Canvas: nodes, connections, viewport, revision persistence, save queue, recovery, assets, tags, Agent, tasks, preview, zoom, pan, import, and export.
- Prompt, Tag, Media, and WD14: existing Grimoire behavior remains available and source capabilities are added rather than replacing it.

## External capabilities

Cloud, login, paid, and platform-specific features enter the matrix. If they cannot run locally, keep their source or adapter boundary, entry point, status, and diagnostics, and mark them BLOCKED with an unblock condition. They are not silently removed.

## Data truth

Grimoire SQLite and business stores remain the source of truth. Vendored source stores are adapted at the boundary; a second untracked business database is not allowed.

## Capability ownership

| Capability | Owning boundary | Integration rule |
|---|---|---|
| Chat interaction | ChatEngine and Cherry UI adapter | UI receives normalized messages and runtime events |
| Agent execution | AgentRuntime | Pi/OpenCode/Codex implementations are interchangeable adapters |
| Window and editor layout | WorkspaceEngine and Workspace adapter | Docking engine handles layout mechanics; Grimoire owns editor semantics |
| Prompt, Tag, Image, WD14 | Domain services | Panels and agents use services/tools, not source-project storage |
| Cross-capability automation | ToolRegistry plus Permission Policy | Every tool has a typed contract, approval path, cancellation, and failure result |
| Persistence | Grimoire stores and explicit repositories | Imported source stores are read or translated through adapters |

## Completion language

The project may only be called complete when all required rows are verified and every remaining external blocker is explicitly accepted by the user. Otherwise report DONE, PARTIAL, BLOCKED, MISSING, and REIMPLEMENTED separately.

## 数据存储控制台（0.7.4 起）

设置「数据」分区的单一事实源是 `src/shared/storage-registry.ts`：

- `STORAGE_TABLES`：每张表 → `{ label, domain, exportable }`。运行时与 `sqlite_master` 交叉校验，未映射表进 `other` 域并告警。
- `STORAGE_PATHS`：userData / 包内资源的路径项，带 `exportable` / `migratable` / `cleanable` 三个能力位。

合同（`src/shared/storage-types.ts`）：

```ts
interface StorageEntry {
  id: string; kind: 'table' | 'directory' | 'file' | 'package'
  domain: StorageDomain; label: string; location: string
  bytes: number | null; rows?: number; files?: number; lastWrite?: string
  exportable: boolean; importable: boolean; migratable: boolean; cleanable: boolean; note?: string
}
interface StorageInventory { generatedAt: string; totalBytes: number; groups: StorageGroup[]; unmappedTables: string[]; approximate: boolean }
```

规则：

1. `bytes === null` 表示未统计，UI 必须显示「—」；0 与未知是两件事。
2. 只读操作（inventory / diagnose / backup）不得写入用户库；备份用 `VACUUM INTO`，因为 `DatabaseSync` 没有 `backup()`。
3. 删除一律先进 `userData/trash/`，24 小时或手动确认才真删；有引用的数据拒删并说明原因。
4. 数据库只能冷迁移：写 boot 配置 → 退出 → 复制校验 → 切换 → 重启自检 → 失败回退。
5. 新增表必须同时更新注册表；`storage-registry.test.ts` 与运行时交叉校验共同兜底。

IPC 分期：P1 已有 `storage:inventory`、`storage:scanSizes`；`exportItem` / `importItem` / `migrate` / `cleanup` / `diagnose` / `backup*` 见 DECISIONS 的 D-STO-01 分期表。
