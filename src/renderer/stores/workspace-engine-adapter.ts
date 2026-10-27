import { createWorkspaceEngine, type WorkspaceEngine } from "./workspace-engine"

export type WorkspaceEngineBackend = "legacy-compatible" | "dockview"

export interface WorkspaceEngineAdapter {
  backend: WorkspaceEngineBackend
  available: boolean
  engine: WorkspaceEngine
}

export function createWorkspaceEngineAdapter(): WorkspaceEngineAdapter {
  // The repository intentionally does not depend on Dockview at runtime yet:
  // the local source snapshot has no reproducible package in node_modules.
  // Keeping this boundary lets the renderer switch engines without coupling
  // business editors or persisted documents to a third-party API.
  return {
    backend: "legacy-compatible",
    available: true,
    engine: createWorkspaceEngine(),
  }
}

