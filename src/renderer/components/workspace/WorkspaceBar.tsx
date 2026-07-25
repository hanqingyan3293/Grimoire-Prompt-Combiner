import React from "react"
import { WORKSPACES, useWorkspaceStore } from "../../stores/workspace.store"

export function WorkspaceBar() {
  const activeWorkspaceId = useWorkspaceStore(s => s.activeWorkspaceId)
  const setActiveWorkspace = useWorkspaceStore(s => s.setActiveWorkspace)
  const resetWorkspace = useWorkspaceStore(s => s.resetWorkspace)

  return (
    <div className="h-9 shrink-0 flex items-center gap-1 px-2 border-b border-[var(--color-border)] bg-[var(--color-bg-secondary)]">
      {WORKSPACES.map(workspace => (
        <button
          key={workspace.id}
          onClick={() => setActiveWorkspace(workspace.id)}
          className={
            "px-3 h-7 rounded text-xs font-medium transition-colors " +
            (workspace.id === activeWorkspaceId
              ? "bg-[var(--color-accent)]/15 text-[var(--color-accent)] border border-[var(--color-accent)]/30"
              : "text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-bg-primary)]")
          }
        >
          {workspace.title}
        </button>
      ))}
      <div className="flex-1" />
      <button
        onClick={resetWorkspace}
        className="px-2 h-7 rounded text-xs text-[var(--color-text-secondary)] hover:text-[var(--color-accent)] hover:bg-[var(--color-accent)]/10"
        title="重置工作区"
      >
        重置
      </button>
    </div>
  )
}

