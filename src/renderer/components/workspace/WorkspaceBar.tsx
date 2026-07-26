import React, { useEffect, useRef, useState } from "react"
import { useWorkspaceStore } from "../../stores/workspace.store"

export function WorkspaceBar() {
  const activeWorkspaceId = useWorkspaceStore(s => s.activeWorkspaceId)
  const workspaces = useWorkspaceStore(s => s.workspaces)
  const setActiveWorkspace = useWorkspaceStore(s => s.setActiveWorkspace)
  const createWorkspace = useWorkspaceStore(s => s.createWorkspace)
  const renameWorkspace = useWorkspaceStore(s => s.renameWorkspace)
  const resetWorkspace = useWorkspaceStore(s => s.resetWorkspace)
  const resetAllWorkspaces = useWorkspaceStore(s => s.resetAllWorkspaces)
  const copyWorkspaceLayout = useWorkspaceStore(s => s.copyWorkspaceLayout)
  const saveCurrentWorkspaceLayout = useWorkspaceStore(s => s.saveCurrentWorkspaceLayout)
  const [layoutMenuOpen, setLayoutMenuOpen] = useState(false)
  const [editingWorkspaceId, setEditingWorkspaceId] = useState<string | null>(null)
  const [workspaceTitleInput, setWorkspaceTitleInput] = useState("")
  const layoutMenuRef = useRef<HTMLDivElement>(null)
  const activeWorkspace = workspaces.find(workspace => workspace.id === activeWorkspaceId) || workspaces[0]

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

  const startRenameWorkspace = (workspaceId: string, title: string) => {
    setEditingWorkspaceId(workspaceId)
    setWorkspaceTitleInput(title)
  }

  const commitRenameWorkspace = () => {
    if (!editingWorkspaceId) return
    const title = workspaceTitleInput.trim()
    if (title) renameWorkspace(editingWorkspaceId, title)
    setEditingWorkspaceId(null)
    setWorkspaceTitleInput("")
  }

  return (
    <div className="h-9 shrink-0 flex items-center gap-1 px-2 border-b border-[var(--color-border)] bg-[var(--color-bg-secondary)]">
      {workspaces.map(workspace => (
        editingWorkspaceId === workspace.id ? (
          <input
            key={workspace.id}
            autoFocus
            value={workspaceTitleInput}
            onChange={event => setWorkspaceTitleInput(event.target.value)}
            onBlur={commitRenameWorkspace}
            onKeyDown={event => {
              if (event.key === "Enter") commitRenameWorkspace()
              if (event.key === "Escape") {
                setEditingWorkspaceId(null)
                setWorkspaceTitleInput("")
              }
            }}
            className="h-7 w-24 rounded border border-[var(--color-accent)] bg-[var(--color-bg-primary)] px-2 text-xs text-[var(--color-text-primary)] outline-none"
          />
        ) : (
          <button
            key={workspace.id}
            onClick={() => setActiveWorkspace(workspace.id)}
            onDoubleClick={() => startRenameWorkspace(workspace.id, workspace.title)}
            className={
              "px-3 h-7 rounded text-xs font-medium transition-colors " +
              (workspace.id === activeWorkspaceId
                ? "bg-[var(--color-accent)]/15 text-[var(--color-accent)] border border-[var(--color-accent)]/30"
                : "text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-bg-primary)]")
            }
            title="双击重命名"
          >
            {workspace.title}
          </button>
        )
      ))}
      <button
        onClick={createWorkspace}
        className="h-7 w-7 rounded text-sm text-[var(--color-text-secondary)] hover:bg-[var(--color-accent)]/10 hover:text-[var(--color-accent)]"
        title="新建布局"
      >
        +
      </button>
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
          <div className="absolute right-0 top-full z-50 mt-1 max-h-[70vh] w-64 overflow-y-auto rounded border border-[var(--color-border)] bg-[var(--color-bg-tertiary)] py-1 shadow-2xl">
            <div className="px-3 py-1.5 text-[10px] text-[var(--color-text-secondary)]">
              当前：{activeWorkspace.title}
            </div>
            <button
              onClick={() => runMenuAction(saveCurrentWorkspaceLayout)}
              className="block w-full px-3 py-1.5 text-left text-xs text-[var(--color-text-primary)] hover:bg-[var(--color-accent)]/15 hover:text-[var(--color-accent)]"
            >
              保存当前布局（覆盖）
            </button>
            <div className="my-1 border-t border-[var(--color-border)]" />
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
            {workspaces.filter(workspace => workspace.id !== activeWorkspaceId).map(workspace => (
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
