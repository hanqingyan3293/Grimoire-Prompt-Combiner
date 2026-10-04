import { describe, expect, it } from "vitest"
import { createAgentRuntime, hasAgentRuntime, listAgentRuntimes, registerAgentRuntime, registerBuiltInAgentRuntimes } from "./registry"

describe("agent runtime registry", () => {
  it("registers and creates independent runtime adapters", () => {
    registerAgentRuntime("codex", () => ({
      kind: "codex",
      createSession: (model) => ({ id: "codex-session", runtime: "codex", model, createdAt: "now", messages: [] }),
      async *send() { yield { type: "completed", text: "ok" } },
    }))
    expect(hasAgentRuntime("codex")).toBe(true)
    expect(listAgentRuntimes()).toContain("codex")
    expect(createAgentRuntime("codex").createSession("test").runtime).toBe("codex")
  })

  it("registers the four built-in runtime kinds", () => {
    registerBuiltInAgentRuntimes()
    expect(listAgentRuntimes()).toEqual(expect.arrayContaining(['openai-compatible', 'codex', 'opencode', 'pi']))
  })
})
