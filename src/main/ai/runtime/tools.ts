import type { AgentRuntimeKind } from "./types"

export type ToolPermission = "read" | "write" | "execute" | "network"

export type AgentToolContext = {
  runtime: AgentRuntimeKind
  sessionId: string
  permission: (permission: ToolPermission, detail?: unknown) => Promise<boolean>
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
    if (!(await context.permission(tool.permission, { tool: name, input }))) throw new Error("Tool 权限被拒绝：" + name)
    return tool.execute(input, context)
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
