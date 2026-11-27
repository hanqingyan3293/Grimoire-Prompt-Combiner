import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import { LoaderCircle, X } from 'lucide-react'
import { PANEL_DEFINITIONS, renderPanel } from './PanelRegistry'
import type { PanelType } from './panelTypes'
import { findPanelNode, normalizePanelTabs, useWorkspaceStore, type WorkspaceTab } from '../../stores/workspace.store'
import { WorkspaceEditorHost } from './WorkspaceEditorHost'
import { performEditorTransfer } from './editor-transfer-client'
import { useTransferredEditorRecord } from './use-editor-transfer'

export function WorkspacePopoutWindow({ popoutId, panelType, title }: { popoutId: string; panelType: PanelType; title: string }) {
  const separator = popoutId.indexOf(':')
  const workspaceId = separator > 0 ? popoutId.slice(0, separator) : ''
  const panelId = separator > 0 ? popoutId.slice(separator + 1) : ''
  const params = new URLSearchParams(window.location.hash.split('?')[1] || '')
  const transferId = params.get('transferId') || ''
  const transfer = useTransferredEditorRecord(transferId)
  const hydrated = useWorkspaceStore(state => state.hydrated)
  const layouts = useWorkspaceStore(state => state.layouts)
  const resolvedType = useMemo<PanelType>(() => {
    if (!hydrated || !workspaceId || !panelId) return panelType
    const panel = findPanelNode(layouts[workspaceId] || useWorkspaceStore.getState().getLayout(workspaceId), panelId)
    if (!panel) return panelType
    const tabs = normalizePanelTabs(panel)
    const active = tabs.find(tab => tab.id === panel.activeTabId) || tabs[0]
    return active?.type || panelType
  }, [hydrated, layouts, panelId, panelType, workspaceId])
  const resolvedTab = useMemo((): WorkspaceTab | undefined => {
    if (!hydrated || !workspaceId || !panelId) return undefined
    const panel = findPanelNode(layouts[workspaceId] || useWorkspaceStore.getState().getLayout(workspaceId), panelId)
    if (!panel) return undefined
    const tabs = normalizePanelTabs(panel)
    return tabs.find(tab => tab.id === panel.activeTabId) || tabs[0]
  }, [hydrated, layouts, panelId, workspaceId])
  const editorId = transfer?.editorId || params.get('editorId') || resolvedTab?.id || panelId
  const definition = PANEL_DEFINITIONS[resolvedType]
  const [returning, setReturning] = useState(false)
  const [detached, setDetached] = useState(false)
  const [error, setError] = useState('')
  const action = useRef<() => Promise<void>>(async () => {})
  const returnToMain = useCallback(async () => {
    if (returning) return
    if (!transferId || !transfer) { void window.api.workspace.closePopout(popoutId); return }
    setReturning(true); setError('')
    try {
      await performEditorTransfer({ direction: 'return', workspaceId, panelId, editorId, editorKey: transfer.editorKey, panelType: resolvedType, title: title || definition.title }, window.api.workspace, async () => {
        flushSync(() => setDetached(true))
      }, () => setDetached(false))
      void window.api.workspace.closeTransferredSource().catch(() => undefined)
    } catch (cause) { setError(cause instanceof Error ? cause.message : '返回主工作区失败，原草稿已保留'); setReturning(false) }
  }, [returning, transferId, transfer, popoutId, workspaceId, panelId, editorId, resolvedType, title, definition.title])
  action.current = returnToMain
  useEffect(() => {
    if (!transferId || transfer?.phase !== 'committed') return
    // Electron page close can destroy WebContents directly; route it through the same owned flush/return as the title bar.
    const original = window.close
    const close = () => { void action.current() }
    window.close = close
    return () => { if (window.close === close) window.close = original }
  }, [transferId, transfer?.phase])
  useEffect(() => window.api.workspace.onTransferReturnRequested?.(() => { void action.current() }), [])
  const targetHidden = Boolean(transferId && (!transfer || transfer.phase !== 'committed'))
  return <div className='flex h-screen min-h-0 flex-col overflow-hidden bg-[var(--color-bg-primary)] text-[var(--color-text-primary)]' style={{ visibility: targetHidden ? 'hidden' : 'visible' }}>
    <header className='flex h-10 shrink-0 items-center justify-between border-b border-[var(--color-border)] bg-[var(--color-bg-secondary)] px-3'>
      <div className='min-w-0 truncate text-sm font-semibold'>{title || definition.title}</div>
      <button type='button' className='grid size-7 place-items-center rounded hover:bg-[var(--color-bg-tertiary)]' onClick={() => { void returnToMain() }} disabled={returning} aria-label={transferId ? '返回主工作区' : '关闭弹出面板'} title={transferId ? '保存草稿并返回主工作区' : '关闭弹出面板'}><X size={15} /></button>
    </header>
    {error && <p role='alert' className='ui-inline-note ui-inline-note-danger m-2 shrink-0 text-xs'>{error}</p>}
    <main className='min-h-0 flex-1 overflow-hidden'>
      {!detached && (!transferId || transfer) && <Suspense fallback={<div className='flex h-full items-center justify-center gap-2 text-sm text-[var(--color-text-secondary)]'><LoaderCircle size={17} className='animate-spin' />正在载入面板</div>}>
        <WorkspaceEditorHost workspaceId={workspaceId} editorId={editorId} type={resolvedType} transfer={transfer}>
          {renderPanel(resolvedType, { agentMode: resolvedTab?.mode })}
        </WorkspaceEditorHost>
      </Suspense>}
    </main>
  </div>
}
