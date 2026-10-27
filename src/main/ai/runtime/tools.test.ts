import { describe, expect, it } from "vitest"
import { ToolRegistry, createPermissionChecker, runtimePermissionForAction } from "./tools"

describe("agent tool registry", () => {
  it("requires permission before executing a tool", async () => {
    const registry = new ToolRegistry()
    registry.register({ name: "read-test", description: "test", permission: "read", inputSchema: {}, execute: async () => "ok" })
    const allowed = await registry.execute("read-test", {}, { runtime: "codex", sessionId: "s1", permission: async () => true })
    expect(allowed).toBe("ok")
    await expect(registry.execute("read-test", {}, { runtime: "codex", sessionId: "s1", permission: async () => false })).rejects.toThrow("权限被拒绝")
  })

  it("fails closed for unknown runtime permission actions", () => {
    expect(runtimePermissionForAction("bash")).toBe("execute")
    expect(runtimePermissionForAction("permission.asked")).toBe("execute")
    expect(runtimePermissionForAction("read")).toBe("read")
    expect(runtimePermissionForAction("write")).toBe("write")
    expect(runtimePermissionForAction("webfetch")).toBe("network")
  })

  it("allows safe reads in automatic mode and asks for writes", async () => {
    const asked: string[] = []
    const checker = createPermissionChecker({ mode: "automatic", request: async permission => { asked.push(permission); return "allow" } })
    expect(await checker("read")).toBe(true)
    expect(await checker("write")).toBe(true)
    expect(asked).toEqual(["write"])
  })
})
