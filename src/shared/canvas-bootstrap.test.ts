import { describe, expect, it } from "vitest"
import { getCanvasBootstrapState } from "./canvas-bootstrap"

describe("canvas bootstrap readiness", () => {
  it("does not report ready when the preload bridge is absent", () => {
    expect(getCanvasBootstrapState({ apiReady: false, hydrated: true, hydrationError: null })).toBe("api-error")
  })

  it("reports hydration failure before considering the iframe ready", () => {
    expect(getCanvasBootstrapState({ apiReady: true, hydrated: true, hydrationError: "database unavailable" })).toBe("hydration-error")
  })

  it("only reports ready after API bridge and project hydration both succeed", () => {
    expect(getCanvasBootstrapState({ apiReady: true, hydrated: false, hydrationError: null })).toBe("loading")
    expect(getCanvasBootstrapState({ apiReady: true, hydrated: true, hydrationError: null })).toBe("ready")
  })
})
