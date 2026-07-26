import React, { useEffect, useRef, useState } from "react"
import { WORKSPACES, useWorkspaceStore } from "../../stores/workspace.store"

export function WorkspaceBar() {
  const activeWorkspaceId = useWorkspaceStore(s => s.activeWorkspaceId)
  const setActiveWorkspace = useWorkspaceStore(s => s.setActiveWorkspace)
  const resetWorkspace = useWorkspaceStore(s => s.resetWorkspace)
  const resetAllWorkspaces = useWorkspaceStore(s => s.resetAllWorkspaces)
  const copyWorkspaceLayout = useWorkspaceStore(s => s.copyWorkspaceLayout)
  const [layoutMenuOpen, setLayoutMenuOpen] = useState(false)
  const layoutMenuRef = useRef<HTMLDivElement>(null)
  const activeWorkspace = WORKSPACES.find(workspace => workspace.id === activeWorkspaceId) || WORKSPACES[0]

  useEffect(() => {
    if (!layoutMenuOpen) return
    const handlePointerDown = (event: PointerEvent) => {
      if (!layoutMenuRef.current?.contains(event.target as Node)) setLayoutMenuOpen(false)
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setLayoutMenuOpen(false)
    }
    document.addEventListener("pointerdown", handlePointerDown)
    document.addEventListener("keydown", handleKeyDown)
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown)
      document.removeEventListener("keydown", handleKeyDown)
    }
  }, [layoutMenuOpen])

  const runMenuAction = (action: () => void) => {
    action()
    setLayoutMenuOpen(false)
  }

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
      <div ref={layoutMenuRef} className="relative">
        <button
          onClick={() => setLayoutMenuOpen(open => !open)}
          className="px-2 h-7 rounded text-xs text-[var(--color-text-secondary)] hover:text-[var(--color-accent)] hover:bg-[var(--color-accent)]/10"
          title="布局管理"
        >
          布局
        </button>
        {layoutMenuOpen && (
          <div className="absolute right-0 top-full z-50 mt-1 w-52 rounded border border-[var(--color-border)] bg-[var(--color-bg-tertiary)] py-1 shadow-2xl">
            <div className="px-3 py-1.5 text-[10px] text-[var(--color-text-secondary)]">
              当前：{activeWorkspace.title}
            </div>
            <button
              onClick={() => runMenuAction(resetWorkspace)}
              className="block w-full px-3 py-1.5 text-left text-xs text-[var(--color-text-primary)] hover:bg-[var(--color-accent)]/15 hover:text-[var(--color-accent)]"
            >
              重置当前工作区
            </button>
            <button
              onClick={() => runMenuAction(resetAllWorkspaces)}
              className="block w-full px-3 py-1.5 text-left text-xs text-[var(--color-text-primary)] hover:bg-[var(--color-accent)]/15 hover:text-[var(--color-accent)]"
            >
              重置全部工作区
            </button>
            <div className="my-1 border-t border-[var(--color-border)]" />
            <div className="px-3 py-1 text-[10px] text-[var(--color-text-secondary)]">复制当前布局到</div>
            {WORKSPACES.filter(workspace => workspace.id !== activeWorkspaceId).map(workspace => (
              <button
                key={workspace.id}
                onClick={() => runMenuAction(() => copyWorkspaceLayout(activeWorkspaceId, workspace.id))}
                className="block w-full px-3 py-1.5 text-left text-xs text-[var(--color-text-primary)] hover:bg-[var(--color-accent)]/15 hover:text-[var(--color-accent)]"
              >
                {workspace.title}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
