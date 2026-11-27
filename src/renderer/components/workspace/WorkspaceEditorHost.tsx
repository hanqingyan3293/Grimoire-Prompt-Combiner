import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { getEditorDefinition } from './PanelRegistry'
import type { PanelType } from './panelTypes'
import type { WorkspaceEditorFlushResult, WorkspaceEditorSnapshot } from '../../../shared/workspace-editor-state'
import { WorkspaceEditorStateController } from './workspace-editor-state-controller'
import { registerEditorTransferHandle } from './editor-transfer-client'
import type { WorkspaceEditorTransferAdapter } from './editor-types'
import type { EditorTransferRecord } from '../../../shared/editor-transfer'

type WorkspaceEditorContextValue = WorkspaceEditorSnapshot & {
  workspaceId: string
  editorId: string
  type: PanelType
  stateKey: string
  setState: (value: unknown) => void
  updateState: (updater: (value: unknown) => unknown) => void
  flush: (reason: string) => Promise<WorkspaceEditorFlushResult>
  useRemote: () => void
  keepLocal: () => void
  saveState: (value?: unknown) => Promise<boolean>
  frozen: boolean
  transferTarget: boolean
  registerTransferAdapter: (adapter: WorkspaceEditorTransferAdapter) => () => void
}
const WorkspaceEditorContext = createContext<WorkspaceEditorContextValue | null>(null)

export function WorkspaceEditorHost({ workspaceId, editorId, type, children, transfer }: { workspaceId: string; editorId: string; type: PanelType; children: React.ReactNode; transfer?: EditorTransferRecord | null }) {
  const definition = getEditorDefinition(type)
  const stateKey = definition.stateKeyFactory({ workspaceId, editorId, type })
  const controller = useMemo(() => new WorkspaceEditorStateController(stateKey), [stateKey])
  const snapshot = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot)
  const [localFrozen, setLocalFrozen] = useState(false)
  const [adapterVersion, setAdapterVersion] = useState(0)
  const adapterRef = useRef<WorkspaceEditorTransferAdapter | null>(null)
  const composition = useRef(0)
  const transferTarget = Boolean(transfer && ['waiting', 'ready', 'transferred'].includes(transfer.phase))
  const frozen = localFrozen || transferTarget
  const frozenRef = useRef(frozen); frozenRef.current = frozen
  const readySent = useRef<string | null>(null)
  const registerTransferAdapter = useCallback((adapter: WorkspaceEditorTransferAdapter) => {
    adapterRef.current = adapter; setAdapterVersion(value => value + 1)
    return () => { if (adapterRef.current === adapter) adapterRef.current = null }
  }, [])
  useEffect(() => {
    controller.connect(window.api?.workspace ?? null)
    return () => controller.disconnect()
  }, [controller])
  useEffect(() => {
    if (!adapterRef.current) return
    const adapter = adapterRef.current
    let active = true
    let froze = false
    const current = () => active && adapterRef.current === adapter
    const unregister = registerEditorTransferHandle(stateKey, {
      ready: () => current() && controller.getSnapshot().status === 'ready' && adapter.ready?.() !== false,
      freeze: async () => {
        if (!current()) throw new Error('EDITOR_SOURCE_CHANGED: 原编辑器适配器已改变')
        if (composition.current > 0) throw new Error('EDITOR_COMPOSITION_ACTIVE: 请先完成输入法组合输入，再移交')
        froze = true
        frozenRef.current = true; setLocalFrozen(true)
        await adapter.freeze?.()
        if (!current()) throw new Error('EDITOR_SOURCE_CHANGED: 原编辑器适配器已改变')
      },
      thaw: () => { if (current()) { if (froze) adapter.thaw?.(); froze = false; frozenRef.current = false; setLocalFrozen(false) } },
      flush: async reason => {
        if (!current()) throw new Error('EDITOR_SOURCE_CHANGED: 原编辑器适配器已改变')
        const captured = await adapter.capture?.()
        if (!current()) throw new Error('EDITOR_SOURCE_CHANGED: 原编辑器适配器已改变')
        if (captured !== undefined) controller.setState(captured)
        return controller.flush(reason)
      },
    })
    return () => { active = false; unregister(); if (froze) { adapter.thaw?.(); froze = false; frozenRef.current = false; setLocalFrozen(false) } }
  }, [controller, stateKey, adapterVersion])
  useEffect(() => {
    if (!transferTarget || !transfer || readySent.current === transfer.transferId || !adapterRef.current || snapshot.status === 'loading' || snapshot.status === 'error' || snapshot.revision < transfer.committedRevision || adapterRef.current.ready?.() === false) return
    let disposed = false
    const adapter = adapterRef.current
    void (async () => {
      try {
        if (transfer.editorKey !== stateKey) throw new Error('EDITOR_TRANSFER_INVALID: 目标草稿key不匹配')
        await adapter.hydrate?.(controller.getSnapshot().state)
        if (disposed || adapter.ready?.() === false) return
        readySent.current = transfer.transferId
        const result = await window.api.workspace.readyTransfer(transfer.transferId, controller.getSnapshot().revision)
        if (!result.ok) throw new Error(result.code + ': ' + result.message)
      } catch (error) {
        if (!disposed) { void window.api.workspace.abortTransfer(transfer.transferId).catch(() => undefined); console.warn('Editor target hydration failed', error instanceof Error ? error.message : String(error)) }
      }
    })()
    return () => { disposed = true }
  }, [transfer, transferTarget, controller, stateKey, snapshot.status, snapshot.revision, adapterVersion])
  const setState = useCallback((state: unknown) => { if (!frozenRef.current) controller.setState(state) }, [controller])
  const updateState = useCallback((update: (state: unknown) => unknown) => { if (!frozenRef.current) controller.updateState(update) }, [controller])
  const saveState = useCallback(async (state?: unknown) => {
    if (state !== undefined && !frozenRef.current) controller.setState(state)
    return (await controller.flush('legacy-save')).status === 'saved'
  }, [controller])
  const value = useMemo<WorkspaceEditorContextValue>(() => ({ ...snapshot, workspaceId, editorId, type, stateKey, setState, updateState, flush: controller.flush, useRemote: controller.useRemote, keepLocal: controller.keepLocal, saveState, frozen, transferTarget, registerTransferAdapter }), [snapshot, workspaceId, editorId, type, stateKey, controller, saveState, setState, updateState, frozen, transferTarget, registerTransferAdapter])
  return <WorkspaceEditorContext.Provider value={value}>
    <div className='flex h-full min-h-0 min-w-0 flex-col' data-editor-id={editorId} data-editor-type={type} data-editor-state-key={stateKey} data-editor-status={snapshot.status} onCompositionStartCapture={() => { composition.current++ }} onCompositionEndCapture={() => { composition.current = Math.max(0, composition.current - 1) }}>
      {frozen && <p role='status' className='shrink-0 px-3 py-1 text-xs text-[var(--color-text-secondary)]'>正在移交编辑器，原草稿已保留…</p>}
      {snapshot.status === 'conflict' && <div role='alert' className='ui-inline-note ui-inline-note-warning m-2 shrink-0 flex-wrap text-xs'>
        <span>另一处已更新这份草稿。本地输入已保留，请选择要继续使用的内容。</span>
        <button type='button' className='ui-button ui-button-secondary ui-button-sm' onClick={controller.keepLocal}>保留本地</button>
        <button type='button' className='ui-button ui-button-secondary ui-button-sm' onClick={controller.useRemote}>使用远端</button>
      </div>}
      {snapshot.error && <div role='alert' className='ui-inline-note ui-inline-note-danger m-2 shrink-0 text-xs'>草稿保存或读取失败：{snapshot.error.message}</div>}
      <div className='flex min-h-0 flex-1 flex-col' inert={frozen}>{children}</div>
    </div>
  </WorkspaceEditorContext.Provider>
}

export function useOptionalWorkspaceEditorState<T = unknown>() {
  const value = useContext(WorkspaceEditorContext)
  return value as (WorkspaceEditorContextValue & { state: T; setState: (state: T) => void; saveState: (state?: T) => Promise<boolean> }) | null
}
export function useWorkspaceEditorState<T = unknown>() {
  const value = useOptionalWorkspaceEditorState<T>()
  if (!value) throw new Error('useWorkspaceEditorState 必须在 WorkspaceEditorHost 内使用')
  return value
}

