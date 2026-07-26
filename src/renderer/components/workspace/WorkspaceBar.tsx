import React, { useEffect, useRef, useState } from "react"
import { WORKSPACES, useWorkspaceStore } from "../../stores/workspace.store"

export function WorkspaceBar() {
  const activeWorkspaceId = useWorkspaceStore(s => s.activeWorkspaceId)
  const setActiveWorkspace = useWorkspaceStore(s => s.setActiveWorkspace)
  const resetWorkspace = useWorkspaceStore(s => s.resetWorkspace)
  const resetAllWorkspaces = useWorkspaceStore(s => s.resetAllWorkspaces)
  const copyWorkspaceLayout = useWorkspaceStore(s => s.copyWorkspaceLayout)
  const layoutPresets = useWorkspaceStore(s => s.layoutPresets)
  const saveCurrentLayoutPreset = useWorkspaceStore(s => s.saveCurrentLayoutPreset)
  const applyLayoutPreset = useWorkspaceStore(s => s.applyLayoutPreset)
  const deleteLayoutPreset = useWorkspaceStore(s => s.deleteLayoutPreset)
  const [layoutMenuOpen, setLayoutMenuOpen] = useState(false)
  const layoutMenuRef = useRef<HTMLDivElement>(null)
  const activeWorkspace = WORKSPACES.find(workspace => workspace.id === activeWorkspaceId) || WORKSPACES[0]
  const activeLayoutPresets = layoutPresets.filter(preset => preset.workspaceId === activeWorkspaceId)

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

  const saveLayoutPreset = () => {
    const name = window.prompt("保存当前布局为", `${activeWorkspace.title}布局`)
    if (!name?.trim()) return
    runMenuAction(() => saveCurrentLayoutPreset(name))
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
          <div className="absolute right-0 top-full z-50 mt-1 max-h-[70vh] w-64 overflow-y-auto rounded border border-[var(--color-border)] bg-[var(--color-bg-tertiary)] py-1 shadow-2xl">
            <div className="px-3 py-1.5 text-[10px] text-[var(--color-text-secondary)]">
              当前：{activeWorkspace.title}
            </div>
            <button
              onClick={saveLayoutPreset}
              className="block w-full px-3 py-1.5 text-left text-xs text-[var(--color-text-primary)] hover:bg-[var(--color-accent)]/15 hover:text-[var(--color-accent)]"
            >
              保存当前布局
            </button>
            {activeLayoutPresets.length > 0 && (
              <>
                <div className="my-1 border-t border-[var(--color-border)]" />
                <div className="px-3 py-1 text-[10px] text-[var(--color-text-secondary)]">已保存布局</div>
                {activeLayoutPresets.map(preset => (
                  <div key={preset.id} className="flex items-center gap-1 px-1.5 py-0.5 hover:bg-[var(--color-accent)]/10">
                    <button
                      onClick={() => runMenuAction(() => applyLayoutPreset(preset.id))}
                      className="min-w-0 flex-1 truncate rounded px-1.5 py-1 text-left text-xs text-[var(--color-text-primary)] hover:text-[var(--color-accent)]"
                      title={new Date(preset.createdAt).toLocaleString("zh-CN")}
                    >
                      {preset.name}
                    </button>
                    <button
                      onClick={() => runMenuAction(() => deleteLayoutPreset(preset.id))}
                      className="h-6 w-6 shrink-0 rounded text-xs text-[var(--color-text-secondary)] hover:bg-red-500/10 hover:text-red-400"
                      title="删除布局预设"
                    >
                      ×
                    </button>
                  </div>
                ))}
              </>
            )}
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
