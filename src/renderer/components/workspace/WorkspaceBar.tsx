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
  const layoutPresets = useWorkspaceStore(s => s.layoutPresets)
  const saveCurrentLayoutPreset = useWorkspaceStore(s => s.saveCurrentLayoutPreset)
  const applyLayoutPresetToCurrentWorkspace = useWorkspaceStore(s => s.applyLayoutPresetToCurrentWorkspace)
  const deleteLayoutPreset = useWorkspaceStore(s => s.deleteLayoutPreset)
  const [layoutMenuOpen, setLayoutMenuOpen] = useState(false)
  const [editingWorkspaceId, setEditingWorkspaceId] = useState<string | null>(null)
  const [workspaceTitleInput, setWorkspaceTitleInput] = useState("")
  const [savingPreset, setSavingPreset] = useState(false)
  const [presetName, setPresetName] = useState("")
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

  const startSaveLayoutPreset = () => {
    setPresetName(`${activeWorkspace.title}布局`)
    setSavingPreset(true)
  }

  const commitLayoutPreset = () => {
    const name = presetName.trim()
    if (!name) return
    saveCurrentLayoutPreset(name)
    setSavingPreset(false)
    setPresetName("")
  }

  return (
    <div className="ui-app-chrome ui-workspace-bar flex h-8 shrink-0 items-center gap-1 border-b border-[var(--color-border)] px-2">
      <div className="ui-workspace-tabs flex min-w-0 items-center gap-1" role="tablist" aria-label="工作区">
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
            className="h-6 w-24 rounded border border-[var(--color-accent)] bg-[var(--color-bg-primary)] px-2 text-xs text-[var(--color-text-primary)] outline-none"
          />
        ) : (
          <button
            key={workspace.id}
            onClick={() => setActiveWorkspace(workspace.id)}
            onDoubleClick={() => startRenameWorkspace(workspace.id, workspace.title)}
            className={
              "ui-workspace-tab h-6 px-3 " +
              (workspace.id === activeWorkspaceId
                ? "ui-workspace-tab-active"
                : "")
            }
            role="tab"
            aria-selected={workspace.id === activeWorkspaceId}
            title="双击重命名"
          >
            <span className="block max-w-36 truncate">{workspace.title}</span>
          </button>
        )
      ))}
      </div>
      <button
        onClick={createWorkspace}
        className="ui-toolbar-button ui-workspace-add h-6 w-6 text-sm"
        title="新建布局"
        aria-label="新建布局"
      >
        +
      </button>
      <div className="flex-1" />
      <div ref={layoutMenuRef} className="relative">
        <button
          onClick={() => setLayoutMenuOpen(open => !open)}
          className="ui-subtle-button ui-layout-menu-trigger h-6 px-2 text-xs"
          title="布局管理"
          aria-expanded={layoutMenuOpen}
          aria-haspopup="menu"
        >
          布局
        </button>
        {layoutMenuOpen && (
          <div className="ui-popover-surface ui-popover-menu absolute right-0 top-full z-50 mt-1 max-h-[70vh] w-64 overflow-y-auto">
            <div className="ui-menu-muted px-3 py-1.5 text-[10px]">
              当前：{activeWorkspace.title}
            </div>
            <button
              onClick={startSaveLayoutPreset}
              className="ui-menu-item px-3 py-1.5 text-xs"
            >
              保存布局
            </button>
            {savingPreset && (
              <div className="px-3 py-2">
                <input
                  autoFocus
                  value={presetName}
                  onChange={event => setPresetName(event.target.value)}
                  onKeyDown={event => {
                    if (event.key === "Enter") commitLayoutPreset()
                    if (event.key === "Escape") {
                      setSavingPreset(false)
                      setPresetName("")
                    }
                  }}
                  className="mb-2 w-full rounded border border-[var(--color-border)] bg-[var(--color-bg-primary)] px-2 py-1.5 text-xs text-[var(--color-text-primary)] outline-none focus:border-[var(--color-accent)]"
                  placeholder="布局名称"
                />
                <div className="flex gap-1.5">
                  <button
                    onClick={commitLayoutPreset}
                    className="flex-1 rounded bg-[var(--color-accent-fill)] px-2 py-1 text-xs font-medium text-[var(--color-accent-foreground)] hover:bg-[var(--color-accent-fill-hover)]"
                  >
                    保存
                  </button>
                  <button
                    onClick={() => {
                      setSavingPreset(false)
                      setPresetName("")
                    }}
                    className="flex-1 rounded border border-[var(--color-border)] px-2 py-1 text-xs text-[var(--color-text-secondary)] hover:border-[var(--color-accent)]/50 hover:text-[var(--color-accent-text)]"
                  >
                    取消
                  </button>
                </div>
              </div>
            )}
            <button
              onClick={() => runMenuAction(saveCurrentWorkspaceLayout)}
              className="ui-menu-item px-3 py-1.5 text-xs"
            >
              覆盖当前工作区
            </button>
            <div className="ui-menu-divider" />
            <div className="ui-menu-muted px-3 py-1 text-[10px]">布局预设</div>
            {layoutPresets.length === 0 ? (
              <div className="px-3 py-1.5 text-xs text-[var(--color-text-secondary)] opacity-70">
                暂无布局预设
              </div>
            ) : layoutPresets.map(preset => (
              <div key={preset.id} className="flex items-center gap-1 px-1.5 py-0.5 hover:bg-[var(--color-accent)]/10">
                <button
                  onClick={() => runMenuAction(() => applyLayoutPresetToCurrentWorkspace(preset.id))}
                  className="ui-menu-item min-w-0 flex-1 px-1.5 py-1 text-xs"
                  title={`应用到当前工作区：${activeWorkspace.title}`}
                >
                  <span className="block truncate">{preset.name}</span>
                  <span className="block truncate text-[10px] text-[var(--color-text-secondary)]">
                    点击覆盖当前：{activeWorkspace.title}
                  </span>
                </button>
                <button
                  onClick={() => deleteLayoutPreset(preset.id)}
                  className="h-6 w-6 shrink-0 rounded text-xs text-[var(--color-text-secondary)] hover:bg-red-500/10 hover:text-red-400"
                  title="删除布局预设"
                >
                  ×
                </button>
              </div>
            ))}
            <div className="ui-menu-divider" />
            <button
              onClick={() => runMenuAction(resetWorkspace)}
              className="ui-menu-item px-3 py-1.5 text-xs"
            >
              重置当前工作区
            </button>
            <button
              onClick={() => runMenuAction(resetAllWorkspaces)}
              className="ui-menu-item px-3 py-1.5 text-xs"
            >
              重置全部工作区
            </button>
            <div className="ui-menu-divider" />
            <div className="ui-menu-muted px-3 py-1 text-[10px]">复制当前布局到</div>
            {workspaces.filter(workspace => workspace.id !== activeWorkspaceId).map(workspace => (
              <button
                key={workspace.id}
                onClick={() => runMenuAction(() => copyWorkspaceLayout(activeWorkspaceId, workspace.id))}
                className="ui-menu-item px-3 py-1.5 text-xs"
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
