import { describe, expect, it } from "vitest"
import { listModelCatalog, listProviderCatalog } from "./provider-catalog"

describe("Cherry provider catalog", () => {
  it("loads the bundled provider and model metadata", () => {
    expect(listProviderCatalog().length).toBeGreaterThan(20)
    expect(listModelCatalog({ limit: 10 }).length).toBeGreaterThan(0)
  })

  it("filters models by capability", () => {
    const imageModels = listModelCatalog({ capability: "image-recognition", limit: 20 })
    expect(imageModels.every(model => model.capabilities?.includes("image-recognition"))).toBe(true)
  })
})

