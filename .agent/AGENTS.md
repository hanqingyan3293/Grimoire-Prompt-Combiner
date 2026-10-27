# Grimoire migration discipline

## Reading order (2026-10-27)

1. `STATE.md` — what is true right now (measured facts, known defects, capability ledger).
2. `GATES.md` — the commands that decide green/red, including the compat typecheck split.
3. `PLAN.md` — the single execution plan and milestone exits.
4. `SPEC.md` — architecture contracts and forbidden dependency directions.
5. `MIGRATION_MATRIX.md` — row-level capability status; `DECISIONS.md` — why.

`history/` and `handoff/` are archives. Quote them as history, never as current status. The decision trail for the 2026-10-27 takeover lives in `records/2026-10-27-takeover/`.

## Mission

Grimoire is a source-level migration, vendor, adapter, and integration project. It is not a project that merely studies other applications and writes simplified equivalents.

## Required implementation order

For every source capability, evaluate in this order and record the result:

~~~text
DIRECT_REUSE
VENDOR
WRAPPER
ADAPTER
MINIMAL_MODIFICATION
PARTIAL_EXTRACTION
REIMPLEMENT
GREENFIELD_REWRITE
~~~

The last two levels require written proof that every earlier level was technically rejected. Large scope, many files, dependency count, different frameworks, or easier greenfield development are not proof.

## Source fidelity

- Preserve source layout, component boundaries, state transitions, keyboard shortcuts, menus, drag/drop, loading, empty, streaming, error, retry, and recovery behavior whenever the source already implements them.
- Theme changes, Electron IPC, local persistence, security boundaries, and Grimoire data adapters are allowed; redesigning a mature source UI is not the default.
- A visual imitation, a feature summary, a one-request Agent, a static MCP list, or a fixed three-column workspace is not accepted as migration.

## Vendor and adapter boundaries

- Keep vendored source under src/vendor/project where practical.
- Keep Grimoire bridges under src/integrations/project.
- Source code must not reach directly into Grimoire SQLite tables or unrelated stores. Use explicit adapters and contracts.
- Keep Provider, Model, AgentRuntime, Session, Message, Event, Tool, MCP, Permission, Workspace, Area, Editor, and Asset concepts separate.

## Core architecture boundary

Grimoire Core is the integration boundary. Mature projects provide capabilities behind contracts; they do not call one another directly.

- The UI depends on ChatEngine, WorkspaceEngine, ToolRegistry, and domain-service contracts. UI code must not branch on opencode, pi, or another runtime name to decide behavior.
- Agent implementations enter through AgentRuntime. Pi supplies the kernel-level lifecycle and event abstractions; OpenCode supplies advanced planning, tool strategy, permission, context, and coding workflow behavior. A future Codex runtime is another adapter, not a UI special case.
- Dockview is a Workspace infrastructure dependency. It is reached through a Workspace adapter and does not own Grimoire panel semantics, business data, or domain services.
- Prompt, Tag, Image, WD14, Canvas, and related capabilities are domain services. Their panels consume services; agents consume their Tool Registry tools; neither layer reaches into another project's storage directly.
- All agent-facing operations are registered as tools and pass through permission policy. Tool implementations call domain services and persistence adapters in the main process.
- Grimoire's SQLite and business stores remain the source of truth. Imported source stores are translated at the boundary and are never treated as a second business database.

### Forbidden dependency directions

~~~text
UI -> concrete runtime implementation
UI -> vendor storage
vendor source -> Grimoire SQLite tables
domain service -> renderer state or panel implementation
agent adapter -> another vendor project's private internals
~~~

The allowed direction is UI -> application contract -> adapter/service -> source capability or Grimoire store.

## Existing-function protection

Do not remove or silently alter existing tags, Prompt assets, images, WD14, Canvas projects, Canvas persistence, Workspace layout, Provider configuration, Session data, themes, shortcuts, or database compatibility.

## Status and evidence

Use only the statuses defined in .agent/MIGRATION_MATRIX.md:

~~~text
DIRECTLY_MIGRATED, VENDORED, WRAPPED, ADAPTED,
MINIMAL_MODIFICATION, PARTIALLY_MIGRATED, BLOCKED,
MISSING, REIMPLEMENTED, NOT_IMPLEMENTED
~~~

Never report “基本完成”, “核心完成”, or “类似实现”. Every incomplete or blocked capability must name the missing behavior and the next action.

## Three gates per milestone

Each milestone must pass all three gates before the next milestone begins:

1. Automated: typecheck, lint when available, tests, build.
2. Functional: mock provider/MCP tests, Electron smoke flow, and manual checks.
3. Migration audit: source files, UI behavior, hidden states, errors, edge cases, and source parity are checked against the matrix.

## Reimplementation gate

Before any REIMPLEMENTED change, update MIGRATION_MATRIX.md and DECISIONS.md with source files, migration attempts, blockers, behavior differences, and covering tests. Pause for explicit user approval before writing that replacement.

## License and security

Read actual LICENSE files and source headers. Do not infer permissions from README text. Preserve notices and copyleft obligations. Keep API keys, tokens, environment variables, and runtime secrets in the main process; do not log or export them.

## Working-tree policy

- Treat all current uncommitted changes as user-owned baseline.
- Do not use destructive reset or checkout commands.
- Use local diff/archive snapshots only; do not push GitHub.
- Do not create a final or done commit until all final gates pass.
