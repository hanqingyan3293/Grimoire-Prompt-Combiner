import type { AgentRuntimeKind } from "./types"

export type ToolPermission = "read" | "write" | "execute" | "network"

export type AgentToolContext = {
  runtime: AgentRuntimeKind
  sessionId: string
  permission: (permission: ToolPermission, detail?: unknown) => Promise<boolean>
  /**
   * The model's tool-call id for this invocation. A tool that reports incremental
   * progress needs it to attribute events to the right call — it is the same id the
   * renderer uses as the join key for its tool block (source `MessageMcpTool`
   * subscribes by tool id), and the same id persisted on `tool-finished`/tool messages.
   */
  toolCallId?: string
}

export type AgentTool = {
  name: string
  description: string
  permission: ToolPermission
  inputSchema: Record<string, unknown>
  execute: (input: unknown, context: AgentToolContext) => Promise<unknown>
}

export class ToolRegistry {
  private readonly tools = new Map<string, AgentTool>()

  register(tool: AgentTool) {
    if (!tool.name.trim()) throw new Error("Tool 名称不能为空")
    if (this.tools.has(tool.name)) throw new Error("Tool 已注册：" + tool.name)
    this.tools.set(tool.name, tool)
    return () => this.tools.delete(tool.name)
  }

  get(name: string) {
    return this.tools.get(name)
  }

  list() {
    return Array.from(this.tools.values())
  }

  async execute(name: string, input: unknown, context: AgentToolContext) {
    const tool = this.tools.get(name)
    if (!tool) throw new Error("Tool 不存在：" + name)
    // The permission detail carries the tool-call id alongside the tool name: the source
    // approval card correlates an approval to a specific call by `toolCallId`, and its
    // "always allow" action persists a per-TOOL rule, so the decision path needs both
    // the per-call identity and enough context to know which tool it was.
    if (!(await context.permission(tool.permission, { tool: name, input, toolCallId: context.toolCallId }))) {
      throw new Error("Tool 权限被拒绝：" + name)
    }
    return tool.execute(input, context)
  }
}

/**
 * Map a runtime-native permission action onto Grimoire's coarser policy.
 * Unknown native actions fail closed as execute; never downgrade them to a
 * read that automatic mode could allow without a prompt.
 */
export function runtimePermissionForAction(action: string): ToolPermission {
  const normalized = action.trim().toLowerCase()
  switch (normalized) {
    case "read": case "file.read": case "read_file": case "glob": case "grep": case "list": case "search":
      return "read"
    case "write": case "file.write": case "write_file": case "edit": case "apply_patch": case "delete": case "mkdir":
      return "write"
    case "network": case "http": case "webfetch": case "websearch":
      return "network"
    default:
      return "execute"
  }
}

export type PermissionDecision = "allow" | "deny"

export type PermissionPolicy = {
  mode: "request" | "automatic" | "full"
  request: (permission: ToolPermission, detail?: unknown) => Promise<PermissionDecision>
}

export function createPermissionChecker(policy: PermissionPolicy) {
  return async (permission: ToolPermission, detail?: unknown) => {
    if (policy.mode === "full") return true
    if (policy.mode === "automatic" && permission === "read") return true
    return (await policy.request(permission, detail)) === "allow"
  }
}
