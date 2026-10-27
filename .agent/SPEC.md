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
