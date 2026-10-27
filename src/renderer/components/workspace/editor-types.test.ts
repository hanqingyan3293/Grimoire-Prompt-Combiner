import { describe, expect, it } from "vitest"
import { EDITOR_DEFINITIONS, getEditorDefinition } from "./PanelRegistry"

describe("editor registry", () => {
  it("registers every production panel as a workspace editor", () => {
    for (const type of ["prompt-workbench", "images", "wd14", "canvas", "agent-sessions", "mcp", "settings"] as const) {
      const definition = getEditorDefinition(type)
      expect(definition.type).toBe(type)
      expect(definition.supportsSplit).toBe(true)
      expect(definition.supportsTab).toBe(true)
      expect(definition.stateKeyFactory({ workspaceId: "w", editorId: "e", type })).toBe("w:e:" + type)
    }
  })

  it("exposes canvas regions without making business state part of layout", () => {
    expect(EDITOR_DEFINITIONS.canvas.regions.map(region => region.kind)).toEqual([
      "header", "toolbar", "asset", "main", "agent", "task", "inspector",
    ])
  })
})

