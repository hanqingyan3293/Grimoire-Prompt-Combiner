import { describe, expect, it } from "vitest"
import { workspaceDocumentFromLegacy } from "../components/workspace/workspace-document"
import { createWorkspaceEngine } from "./workspace-engine"

function createDocument() {
  return workspaceDocumentFromLegacy("test", {
    kind: "split",
    id: "root",
    direction: "horizontal",
    ratio: 0.5,
    first: {
      kind: "panel",
      id: "left",
      type: "prompt-workbench",
      tabs: [
        { id: "prompt", type: "prompt-workbench" },
        { id: "images", type: "images" },
      ],
      activeTabId: "prompt",
    },
    second: { kind: "panel", id: "right", type: "canvas" },
  })
}

describe("semantic workspace engine", () => {
  it("preserves areas, tab groups, regions and editor state keys", () => {
    const document = createDocument()
    expect(document.areas.area_left.editorIds).toEqual(["prompt", "images"])
    expect(document.tabGroups.tabs_area_left.activeEditorId).toBe("prompt")
    expect(document.regions.region_area_left_main.kind).toBe("main")
    expect(document.editors.images.stateKey).toBe("test:images:images")
  })

  it("splits and moves editors without changing the business state key", () => {
    const engine = createWorkspaceEngine()
    const document = createDocument()
    const split = engine.splitArea(document, "area_right", "vertical", {
      id: "wd14",
      type: "wd14",
      stateKey: "test:wd14:wd14",
    })
    expect(Object.values(split.areas).some(area => area.editorIds.includes("wd14"))).toBe(true)
    const moved = engine.moveEditor(split, "images", "area_right")
    expect(moved.editors.images.stateKey).toBe("test:images:images")
    expect(moved.areas.area_right.editorIds).toContain("images")
  })

  it("round-trips floating and popout state", () => {
    const engine = createWorkspaceEngine()
    const document = createDocument()
    const floating = engine.floatEditor(document, "prompt", { x: 32, y: 48, width: 640, height: 520, zIndex: 9, maximized: false })
    expect(floating.floatingGroups[0]).toMatchObject({ x: 32, y: 48, width: 640, height: 520, zIndex: 9 })
    const popped = engine.popoutEditor(floating, "images", { x: 80, y: 90, width: 900, height: 700, maximized: false })
    expect(popped.popouts[0]).toMatchObject({ open: true, width: 900, height: 700 })
    const restored = engine.restore(engine.serialize(popped))
    expect(restored.editors.images.popoutId).toBe(popped.editors.images.popoutId)
  })
})

