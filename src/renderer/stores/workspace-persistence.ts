import { createWorkspacePersistenceDocument, useWorkspaceStore } from "./workspace.store"
import { findPanelNode, normalizePanelTabs } from "./workspace.store"
import { PANEL_DEFINITIONS } from "../components/workspace/PanelRegistry"
import { EDITOR_TRANSFER_TYPES } from '../../shared/editor-transfer'

const DOCUMENT_ID = "grimoire-main"
const SAVE_DEBOUNCE_MS = 180

export function startWorkspacePersistence() {
  let disposed = false
  let hydrated = false
  let applyingRemote = false
  let saving = false
  let saveAgain = false
  let saveTimer: ReturnType<typeof setTimeout> | null = null

  const applyRemote = (value: { workspaceId: string; revision: number; document: unknown }) => {
    if (disposed || value.workspaceId !== DOCUMENT_ID) return
    if (value.revision <= useWorkspaceStore.getState().persistenceRevision) return
    if (!hydrated) return
    applyingRemote = true
    try { useWorkspaceStore.getState().applyPersistenceDocument(value.revision, value.document) }
    finally { applyingRemote = false }
  }
  const unsubscribeRemote = window.api.workspace.onDocumentChanged(applyRemote)
  const unsubscribePopout = window.api.workspace.onPopoutClosed(({ popoutId, bounds }) => {
    const separator = popoutId.indexOf(':')
    if (separator <= 0) return
    const workspaceId = popoutId.slice(0, separator)
    const panelId = popoutId.slice(separator + 1)
    useWorkspaceStore.getState().setPopoutPanel(workspaceId, panelId, false)
    if (bounds) useWorkspaceStore.getState().setPopoutBounds(workspaceId, panelId, bounds)
  })

  const persistLatest = async () => {
    if (disposed || !hydrated) return
    if (saving) { saveAgain = true; return }
    saving = true
    saveAgain = false
    const state = useWorkspaceStore.getState()
    const snapshot = createWorkspacePersistenceDocument(state)
    const expectedRevision = state.persistenceRevision
    try {
      const result = await window.api.workspace.saveDocument(DOCUMENT_ID, expectedRevision, snapshot)
      if (disposed) return
      if (result.saved && result.value) {
        useWorkspaceStore.getState().setPersistenceRevision(result.value.revision)
      } else if (result.current) {
        applyingRemote = true
        try { useWorkspaceStore.getState().applyPersistenceDocument(result.current.revision, result.current.document) }
        finally { applyingRemote = false }
        window.dispatchEvent(new CustomEvent("grimoire:toast", { detail: { message: "Workspace 已从其他窗口同步最新布局", type: "info" } }))
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      useWorkspaceStore.getState().setPersistenceError(message)
      window.dispatchEvent(new CustomEvent("grimoire:toast", { detail: { message: "Workspace 布局保存失败：" + message, type: "error" } }))
    } finally {
      saving = false
      if (saveAgain && !disposed) scheduleSave()
    }
  }

  const scheduleSave = () => {
    if (saveTimer) clearTimeout(saveTimer)
    saveTimer = setTimeout(() => {
      saveTimer = null
      void persistLatest()
    }, SAVE_DEBOUNCE_MS)
  }

  const unsubscribeStore = useWorkspaceStore.subscribe((state, previous) => {
    if (state.popoutPanels !== previous.popoutPanels) {
      const restoringPopouts = Object.fromEntries(Object.entries(state.restoringPopouts).map(([workspaceId, ids]) => [workspaceId, ids.filter(id => state.popoutPanels[workspaceId]?.includes(id))]))
      if (Object.entries(state.restoringPopouts).some(([workspaceId, ids]) => ids.length !== restoringPopouts[workspaceId].length)) useWorkspaceStore.setState({ restoringPopouts })
    }
    if (!hydrated || applyingRemote || !state.hydrated) return
    const changed = state.activeWorkspaceId !== previous.activeWorkspaceId
      || state.workspaces !== previous.workspaces
      || state.layouts !== previous.layouts
      || state.maximizedPanels !== previous.maximizedPanels
      || state.floatingPanels !== previous.floatingPanels
      || state.floatingPositions !== previous.floatingPositions
      || state.popoutPanels !== previous.popoutPanels
      || state.popoutBounds !== previous.popoutBounds
      || state.layoutPresets !== previous.layoutPresets
    if (changed) scheduleSave()
  })

  const reloadCanonical = async () => {
    if (saveTimer) {
      clearTimeout(saveTimer)
      saveTimer = null
      await persistLatest()
    }
    try {
      const current = await window.api.workspace.loadDocument(DOCUMENT_ID)
      if (current && current.revision > useWorkspaceStore.getState().persistenceRevision) applyRemote(current)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      useWorkspaceStore.getState().setPersistenceError(message)
    }
  }
  window.addEventListener("grimoire:refresh", reloadCanonical)

  void (async () => {
    try {
      const stored = await window.api.workspace.loadDocument(DOCUMENT_ID)
      if (disposed) return
      if (stored) {
        applyingRemote = true
        try { useWorkspaceStore.getState().applyPersistenceDocument(stored.revision, stored.document) }
        finally { applyingRemote = false }
      } else {
        const localSnapshot = createWorkspacePersistenceDocument()
        const result = await window.api.workspace.saveDocument(DOCUMENT_ID, 0, localSnapshot)
        if (disposed) return
        if (result.saved && result.value) useWorkspaceStore.getState().setPersistenceRevision(result.value.revision)
        else if (result.current) useWorkspaceStore.getState().applyPersistenceDocument(result.current.revision, result.current.document)
        else throw new Error("旧 Workspace 布局迁移未能写入数据库")
      }
      hydrated = true
      useWorkspaceStore.setState({ hydrated: true, persistenceError: null })
      if (!window.location.hash.startsWith("#workspace-popout?")) {
        const state = useWorkspaceStore.getState()
        const activePopouts = state.popoutPanels
        const restoringPopouts: Record<string, string[]> = {}
        for (const workspace of state.workspaces) {
          for (const panelId of activePopouts[workspace.id] || []) {
            const panel = findPanelNode(state.getLayout(workspace.id), panelId)
            const tab = panel ? (normalizePanelTabs(panel).find(item => item.id === panel.activeTabId) || normalizePanelTabs(panel)[0]) : null
            if (!tab) continue
            if (EDITOR_TRANSFER_TYPES.has(tab.type)) {
              if (await window.api.workspace.isPopoutOpen(workspace.id + ':' + panelId)) continue
              if (disposed) return
              if (!useWorkspaceStore.getState().popoutPanels[workspace.id]?.includes(panelId)) continue
              ;(restoringPopouts[workspace.id] ||= []).push(panelId)
              continue
            }
            const definition = PANEL_DEFINITIONS[tab.type]
            const bounds = state.popoutBounds[workspace.id]?.[panelId]
            void window.api.workspace.openPopout({ popoutId: workspace.id + ":" + panelId, panelType: tab.type, title: definition.title, bounds }).catch(() => state.setPopoutPanel(workspace.id, panelId, false))
          }
        }
        useWorkspaceStore.setState({ restoringPopouts })
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      hydrated = true
      useWorkspaceStore.setState({ hydrated: true, persistenceError: message })
      window.dispatchEvent(new CustomEvent("grimoire:toast", { detail: { message: "Workspace 使用本地恢复布局；数据库同步失败：" + message, type: "error" } }))
    }
  })()

  return () => {
    disposed = true
    if (saveTimer) clearTimeout(saveTimer)
    unsubscribeRemote()
    unsubscribePopout()
    unsubscribeStore()
    window.removeEventListener("grimoire:refresh", reloadCanonical)
  }
}
