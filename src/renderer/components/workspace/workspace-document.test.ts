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

  it("persists floating and popout bounds in the semantic document", () => {
    const document = workspaceDocumentFromLegacy("compose", {
      kind: "panel",
      id: "canvas-panel",
      type: "canvas",
    }, {
      floatingPanels: ["canvas-panel"],
      floatingPositions: { "canvas-panel": { x: 12, y: 18, width: 640, height: 480, zIndex: 5 } },
      popoutPanels: ["canvas-panel"],
      popoutBounds: { "canvas-panel": { x: 20, y: 24, width: 900, height: 700 } },
    })
    expect(document.floatingGroups[0]).toMatchObject({ x: 12, y: 18, width: 640, height: 480, zIndex: 5 })
    expect(document.popouts[0]).toMatchObject({ open: true, x: 20, y: 24, width: 900, height: 700 })
  })
})
