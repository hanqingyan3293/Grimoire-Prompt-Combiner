export type CanvasBootstrapState = "api-error" | "hydration-error" | "loading" | "ready"

export function getCanvasBootstrapState(input: { apiReady: boolean; hydrated: boolean; hydrationError: string | null }): CanvasBootstrapState {
  if (!input.apiReady) return "api-error"
  if (input.hydrationError) return "hydration-error"
  if (!input.hydrated) return "loading"
  return "ready"
}
