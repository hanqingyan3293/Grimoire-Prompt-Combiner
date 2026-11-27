import type { EditorTransferInput, EditorTransferRecord, EditorTransferResult } from '../../../shared/editor-transfer'
import type { WorkspaceEditorFlushResult } from '../../../shared/workspace-editor-state'
export interface EditorTransferHandle { freeze(): Promise<void>; thaw(): void; flush(reason: string): Promise<WorkspaceEditorFlushResult>; ready?(): boolean }
export interface EditorTransferBridge {
  prepareTransfer(input: EditorTransferInput): Promise<EditorTransferResult>
  commitTransfer(id: string): Promise<EditorTransferResult>
  finishTransfer(id: string): Promise<EditorTransferResult>
  abortTransfer(id: string): Promise<EditorTransferResult>
  getTransfer(id: string): Promise<EditorTransferRecord | null>
  onTransferChanged(callback: (event: { role: 'source' | 'target'; transfer: EditorTransferRecord }) => void): () => void
}
const handles = new Map<string, EditorTransferHandle>()
const busy = new Set<string>()
export function registerEditorTransferHandle(key: string, handle: EditorTransferHandle): () => void {
  handles.set(key, handle)
  return () => { if (handles.get(key) === handle) handles.delete(key) }
}
export async function waitForEditorTransferHandle(key: string, cancelled: () => boolean, timeoutMs = 10_000): Promise<boolean> {
  const expires = Date.now() + timeoutMs
  while (!cancelled()) {
    const handle = handles.get(key)
    if (handle && handle.ready?.() !== false) return true
    if (Date.now() >= expires) throw new Error('EDITOR_ADAPTER_UNAVAILABLE: 恢复窗口时原编辑器未在预算内读取完成，草稿保留在主工作区')
    await new Promise<void>(resolve => setTimeout(resolve, 50))
  }
  return false
}
function resultError(result: Extract<EditorTransferResult, { ok: false }>): Error { return new Error(result.code + ': ' + result.message) }
function observeTransfer(id: string, bridge: EditorTransferBridge) {
  let cancelled: Error | null = null
  let ready!: (record: EditorTransferRecord) => void
  let rejectReady!: (error: Error) => void
  let abort!: (error: Error) => void
  const readiness = new Promise<EditorTransferRecord>((resolve, reject) => { ready = resolve; rejectReady = reject })
  const aborted = new Promise<never>((_resolve, reject) => { abort = reject })
  const fail = (error: Error) => { if (!cancelled) { cancelled = error; rejectReady(error); abort(error) } }
  const receive = (record: EditorTransferRecord | null) => {
    if (!record || record.transferId !== id) return
    if (record.phase === 'ready' || record.phase === 'transferred') ready(record)
    else if (record.phase === 'aborted') fail(new Error((record.error?.code || 'EDITOR_TRANSFER_ABORTED') + ': ' + (record.error?.message || '移交已撤销')))
  }
  // Keep this subscription through detachment: main timeout/crash must restore the source immediately.
  const unsubscribe = bridge.onTransferChanged(event => { if (event.role === 'source') receive(event.transfer) })
  const timer = setTimeout(() => fail(new Error('EDITOR_TRANSFER_TIMEOUT: 移交状态未在预算内返回')), 12_000)
  void readiness.catch(() => undefined); void aborted.catch(() => undefined)
  void bridge.getTransfer(id).then(receive, error => fail(error instanceof Error ? error : new Error(String(error))))
  return { readiness, aborted, check: () => { if (cancelled) throw cancelled }, dispose: () => { clearTimeout(timer); unsubscribe() } }
}

/** Source remains recoverable until it receives a directed target hydration ACK. */
export async function performEditorTransfer(input: Omit<EditorTransferInput, 'committedRevision'>, bridge: EditorTransferBridge, detach: () => Promise<void>, restore: () => void): Promise<EditorTransferRecord> {
  const handle = handles.get(input.editorKey)
  if (!handle) throw new Error('EDITOR_ADAPTER_UNAVAILABLE: 当前编辑器尚未注册草稿移交适配')
  if (busy.has(input.editorKey)) throw new Error('EDITOR_TRANSFER_BUSY: 当前编辑器正在移交')
  busy.add(input.editorKey)
  let transferId: string | undefined
  let detached = false
  let observation: ReturnType<typeof observeTransfer> | undefined
  try {
    await handle.freeze()
    const flushed = await handle.flush('transfer')
    if (flushed.status === 'conflict') throw new Error('EDITOR_FLUSH_CONFLICT: 本地草稿与其他窗口有冲突，请先选择保留内容')
    if (flushed.status === 'error') throw new Error(flushed.code + ': ' + flushed.message)
    const result = await bridge.prepareTransfer({ ...input, committedRevision: flushed.revision })
    if (!result.ok) throw resultError(result)
    transferId = result.transfer.transferId
    observation = observeTransfer(transferId, bridge)
    const observed = observation
    const id = transferId
    const complete = async () => {
      await observed.readiness; observed.check()
      if (handle.ready?.() === false) throw new Error('EDITOR_SOURCE_CHANGED: 原编辑器已改变，未移交新页面内容')
      const moved = await bridge.commitTransfer(id); observed.check()
      if (!moved.ok) throw resultError(moved)
      if (moved.transfer.phase !== 'transferred') throw new Error('EDITOR_TRANSFER_INVALID: 主进程没有确认编辑权已转移')
      if (handle.ready?.() === false) throw new Error('EDITOR_SOURCE_CHANGED: 原编辑器已改变，未卸载新页面内容')
      detached = true
      await detach(); observed.check()
      const activated = await bridge.finishTransfer(id); observed.check()
      if (!activated.ok) throw resultError(activated)
      return activated.transfer
    }
    return await Promise.race([complete(), observed.aborted])
  } catch (error) {
    if (transferId) {
      const outcome = await bridge.getTransfer(transferId).catch(() => null)
      if (outcome?.phase === 'committed') return outcome
    }
    if (transferId) await bridge.abortTransfer(transferId).catch(() => undefined)
    if (detached) restore()
    handle.thaw()
    throw error
  } finally { observation?.dispose(); busy.delete(input.editorKey) }
}
