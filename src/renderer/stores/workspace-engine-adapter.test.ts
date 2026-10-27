import { describe, expect, it } from "vitest"
import { createWorkspaceEngineAdapter } from "./workspace-engine-adapter"

describe("workspace engine adapter", () => {
  it("keeps the offline-compatible engine as the safe backend", () => {
    const adapter = createWorkspaceEngineAdapter()
    expect(adapter.backend).toBe("legacy-compatible")
    expect(adapter.available).toBe(true)
    expect(typeof adapter.engine.serialize).toBe("function")
  })
})

