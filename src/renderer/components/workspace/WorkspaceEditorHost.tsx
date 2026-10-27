import React, { createContext, useContext, useEffect, useMemo, useRef, useState } from "react"
import { getEditorDefinition } from "./PanelRegistry"
import type { PanelType } from "./panelTypes"

type WorkspaceEditorContextValue = {
  workspaceId: string
  editorId: string
  type: PanelType
  stateKey: string
  state: unknown
  setState: (state: unknown) => void
  saveState: (state?: unknown) => Promise<boolean>
}

const WorkspaceEditorContext = createContext<WorkspaceEditorContextValue | null>(null)

export function WorkspaceEditorHost({ workspaceId, editorId, type, children }: { workspaceId: string; editorId: string; type: PanelType; children: React.ReactNode }) {
  const definition = getEditorDefinition(type)
  const stateKey = useMemo(() => definition.stateKeyFactory({ workspaceId, editorId, type }), [definition, workspaceId, editorId, type])
  const [state, setState] = useState<unknown>(null)
  const [revision, setRevision] = useState(0)
  const revisionRef = useRef(0)

  useEffect(() => {
    let disposed = false
    const load = async () => {
      if (!window.api?.workspace) return
      const stored = await window.api.workspace.loadEditorState(stateKey)
      if (disposed || !stored) return
      setState(stored.state)
      setRevision(stored.revision)
      revisionRef.current = stored.revision
    }
    void load().catch(() => {})
    const unsubscribe = window.api?.workspace?.onEditorStateChanged((value) => {
      if (!disposed && value.editorKey === stateKey && value.revision > revisionRef.current) {
        setState(value.state)
        setRevision(value.revision)
        revisionRef.current = value.revision
      }
    })
    return () => {
      disposed = true
      unsubscribe?.()
    }
  }, [stateKey])

  const saveState = async (nextState = state) => {
    if (!window.api?.workspace) return false
    const result = await window.api.workspace.saveEditorState(stateKey, revisionRef.current, nextState)
    if (result.saved && result.value) {
      setState(nextState)
      setRevision(result.value.revision)
      revisionRef.current = result.value.revision
      return true
    }
    if (result.current && result.current.revision > revisionRef.current) {
      setState(result.current.state)
      setRevision(result.current.revision)
      revisionRef.current = result.current.revision
    }
    return false
  }

  const value = useMemo<WorkspaceEditorContextValue>(() => ({ workspaceId, editorId, type, stateKey, state, setState, saveState }), [workspaceId, editorId, type, stateKey, state, revision])
  return (
    <WorkspaceEditorContext.Provider value={value}>
      <div className="flex h-full min-h-0 min-w-0 flex-col" data-editor-id={editorId} data-editor-type={type} data-editor-state-key={stateKey}>
        {children}
      </div>
    </WorkspaceEditorContext.Provider>
  )
}

export function useWorkspaceEditorState<T = unknown>() {
  const context = useContext(WorkspaceEditorContext)
  if (!context) throw new Error("useWorkspaceEditorState 必须在 WorkspaceEditorHost 内使用")
  return context as WorkspaceEditorContextValue & { state: T; setState: (state: T) => void; saveState: (state?: T) => Promise<boolean> }
}

