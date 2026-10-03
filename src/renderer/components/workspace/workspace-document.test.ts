import { describe, expect, it } from "vitest"
import { workspaceDocumentFromLegacy, workspaceDocumentToLegacy } from "./workspace-document"

describe("workspace document migration", () => {
  it("converts legacy split layouts into areas and editors", () => {
    const document = workspaceDocumentFromLegacy("compose", {
      kind: "split",
      id: "root",
      direction: "horizontal",
      ratio: 0.2,
      first: { kind: "panel", id: "left", type: "tag-sidebar" },
      second: { kind: "panel", id: "main", type: "prompt-workbench" },
    })

    expect(Object.keys(document.areas)).toHaveLength(2)
    expect(document.editors.main.type).toBe("prompt-workbench")
    expect(document.root.kind).toBe("split")
  })

  it("keeps legacy layout semantics when converting back", () => {
    const legacy = {
      kind: "split" as const,
      id: "root",
      direction: "vertical" as const,
      ratio: 0.7,
      first: { kind: "panel" as const, id: "a", type: "canvas" as const },
      second: { kind: "panel" as const, id: "b", type: "wd14" as const },
    }
    const document = workspaceDocumentFromLegacy("compose", legacy)
    expect(workspaceDocumentToLegacy(document)).toMatchObject({ kind: "split", direction: "vertical", ratio: 0.7 })
  })
})
