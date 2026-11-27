import crypto from 'node:crypto'
import { EDITOR_TRANSFER_TYPES, type EditorTransferInput, type EditorTransferRecord } from '../../shared/editor-transfer'
import { requireId } from './input-validation'

export type TransferOwner = { isDestroyed(): boolean; isCrashed?(): boolean; getURL?(): string; once?(event: string, callback: () => void): unknown; on?(event: string, callback: (...args: any[]) => void): unknown; removeListener?(event: string, callback: (...args: any[]) => void): unknown }
export interface TransferHooks {
  revision(key: string): number | null
  freeze(key: string, owner: TransferOwner, id: string): void
  release(key: string, owner: TransferOwner, id: string): void
  move(key: string, source: TransferOwner, target: TransferOwner, id: string): void
  activate(key: string, source: TransferOwner, target: TransferOwner, id: string): void
  notify(owner: TransferOwner, record: EditorTransferRecord, role: 'source' | 'target'): void
  close(owner: TransferOwner): void
  show(owner: TransferOwner): void
}
export class EditorTransferError extends Error {
  constructor(readonly code: string, message: string) { super(code + ': ' + message); this.name = 'EditorTransferError' }
}
type Transfer = { record: EditorTransferRecord; source: TransferOwner; target?: TransferOwner; targetDocumentCommitted?: boolean; timer: ReturnType<typeof setTimeout>; cleanups: Array<() => void> }
const copy = (value: EditorTransferRecord) => structuredClone(value)
const active = (value: EditorTransferRecord) => ['waiting', 'ready', 'transferred'].includes(value.phase)

/** Directed readiness/close discipline extends existing source window lifecycle adapters. */
export class EditorTransferManager {
  private transfers = new Map<string, Transfer>()
  private sequence = 0
  constructor(private hooks: TransferHooks) {}
  prepare(input: EditorTransferInput, source: TransferOwner): EditorTransferRecord {
    if (!source || source.isDestroyed()) throw new EditorTransferError('EDITOR_TRANSFER_OWNER', '发起窗口不可用')
    if (!input || !EDITOR_TRANSFER_TYPES.has(input.panelType)) throw new EditorTransferError('EDITOR_ADAPTER_UNAVAILABLE', '该面板没有已注册的草稿移交适配')
    try {
      for (const value of [input.workspaceId, input.panelId, input.editorId, input.editorKey]) requireId(value)
      if (input.editorKey !== input.workspaceId + ':' + input.editorId + ':' + input.panelType || !['popout', 'return'].includes(input.direction) || !Number.isSafeInteger(input.committedRevision) || input.committedRevision < 0) throw new Error('Invalid key or revision')
    } catch { throw new EditorTransferError('EDITOR_TRANSFER_INVALID', '移交参数或编辑器状态键无效') }
    if (this.isFrozen(input.editorKey)) throw new EditorTransferError('EDITOR_TRANSFER_BUSY', '该编辑器已有未结束的移交')
    if ((this.hooks.revision(input.editorKey) ?? 0) !== input.committedRevision) throw new EditorTransferError('REVISION_CONFLICT', '已保存的草稿revision发生变化')
    const transferId = crypto.randomUUID()
    this.hooks.freeze(input.editorKey, source, transferId)
    const bounds = input.bounds && typeof input.bounds === 'object' ? Object.fromEntries(['x', 'y', 'width', 'height'].flatMap(key => {
      const value = input.bounds?.[key as keyof NonNullable<EditorTransferInput['bounds']>]
      return typeof value === 'number' && Number.isFinite(value) ? [[key, value]] : []
    })) : undefined
    const record: EditorTransferRecord = { direction: input.direction, workspaceId: input.workspaceId, panelId: input.panelId, editorId: input.editorId, editorKey: input.editorKey, panelType: input.panelType, committedRevision: input.committedRevision, ...(bounds ? { bounds } : {}), title: String(input.title || input.panelType).slice(0, 200), transferId, sequence: ++this.sequence, phase: 'waiting', expiresAt: Date.now() + 10_000 }
    const transfer: Transfer = { record, source, timer: setTimeout(() => this.abortInternal(transfer, 'EDITOR_TRANSFER_TIMEOUT', '目标未在10秒内确认草稿就绪'), 10_000), cleanups: [] }
    this.transfers.set(transferId, transfer)
    this.watch(transfer, source, 'destroyed', 'EDITOR_SOURCE_CLOSED')
    this.watch(transfer, source, 'render-process-gone', 'EDITOR_SOURCE_CRASHED')
    this.watchNavigation(transfer, source, 'source')
    this.notify(transfer)
    return copy(record)
  }
  /** Main-only recovery uses its observed process-gone signal and the actual stored revision. */
  prepareRecovery(input: EditorTransferInput, source: TransferOwner, processGone = false): EditorTransferRecord {
    if (!processGone && source.isCrashed?.() !== true) throw new EditorTransferError('EDITOR_SOURCE_NOT_CRASHED', '只有已停止的窗口可从持久草稿恢复')
    const record = this.prepare({ ...input, direction: 'return', committedRevision: this.hooks.revision(input.editorKey) ?? 0 }, source)
    const transfer = this.require(record.transferId)
    transfer.record.recovery = 'persisted-after-crash'
    return copy(transfer.record)
  }
  bindTarget(id: string, owner: TransferOwner): void {
    const transfer = this.require(id)
    this.requireActive(transfer)
    if (transfer.target || !owner || owner.isDestroyed() || owner === transfer.source) throw new EditorTransferError('EDITOR_TRANSFER_OWNER', '移交目标窗口无效')
    transfer.target = owner
    const url = owner.getURL?.()
    transfer.targetDocumentCommitted = Boolean(url && url !== 'about:blank')
    const documentCommitted = () => { transfer.targetDocumentCommitted = true }
    owner.on?.('did-navigate', documentCommitted)
    transfer.cleanups.push(() => owner.removeListener?.('did-navigate', documentCommitted))
    this.watch(transfer, owner, 'destroyed', 'EDITOR_TARGET_CLOSED')
    this.watch(transfer, owner, 'render-process-gone', 'EDITOR_TARGET_CRASHED')
    this.watchNavigation(transfer, owner, 'target')
    this.notify(transfer)
  }
  ready(id: string, owner: TransferOwner, revision: number): EditorTransferRecord {
    const transfer = this.require(id)
    this.requireActive(transfer)
    if (owner !== transfer.target) throw new EditorTransferError('EDITOR_TRANSFER_OWNER', '就绪消息不是目标窗口发送')
    if (transfer.record.phase === 'transferred') return copy(transfer.record)
    if (!Number.isSafeInteger(revision) || revision < transfer.record.committedRevision) throw new EditorTransferError('EDITOR_HYDRATION_STALE', '目标尚未读取到已提交的草稿revision')
    if ((this.hooks.revision(transfer.record.editorKey) ?? 0) !== transfer.record.committedRevision) {
      this.abortInternal(transfer, 'REVISION_CONFLICT', '草稿在移交中发生变化')
      throw new EditorTransferError('REVISION_CONFLICT', '草稿在移交中发生变化')
    }
    transfer.record.phase = 'ready'
    this.notify(transfer)
    if (transfer.record.recovery) {
      this.commit(id, transfer.source)
      const recovered = this.complete(id, transfer.source)
      this.hooks.close(transfer.source)
      return recovered
    }
    return copy(transfer.record)
  }
  commit(id: string, owner: TransferOwner): EditorTransferRecord {
    const transfer = this.require(id)
    this.requireActive(transfer)
    if (owner !== transfer.source) throw new EditorTransferError('EDITOR_TRANSFER_OWNER', '只有发起窗口可以提交移交')
    if (transfer.record.phase === 'transferred') return copy(transfer.record)
    if (transfer.record.phase !== 'ready' || !transfer.target) throw new EditorTransferError('EDITOR_TARGET_NOT_READY', '目标编辑器尚未确认就绪')
    if ((this.hooks.revision(transfer.record.editorKey) ?? 0) !== transfer.record.committedRevision) {
      this.abortInternal(transfer, 'REVISION_CONFLICT', '草稿在移交中发生变化')
      throw new EditorTransferError('REVISION_CONFLICT', '草稿在移交中发生变化')
    }
    try { this.hooks.move(transfer.record.editorKey, transfer.source, transfer.target, id) }
    catch (error) { this.abortInternal(transfer, 'EDITOR_TRANSFER_OWNER', error instanceof Error ? error.message : String(error)); throw error }
    transfer.record.phase = 'transferred'
    this.notify(transfer)
    return copy(transfer.record)
  }
  complete(id: string, owner: TransferOwner): EditorTransferRecord {
    const transfer = this.require(id)
    if (owner !== transfer.source) throw new EditorTransferError('EDITOR_TRANSFER_OWNER', '只有原窗口可以确认业务内容已卸载')
    if (transfer.record.phase === 'committed') return copy(transfer.record)
    this.requireActive(transfer)
    if (transfer.record.phase !== 'transferred' || !transfer.target) throw new EditorTransferError('EDITOR_TARGET_NOT_READY', '编辑权尚未转移到目标窗口')
    try { this.hooks.activate(transfer.record.editorKey, transfer.source, transfer.target, id) }
    catch (error) { this.abortInternal(transfer, 'EDITOR_TRANSFER_OWNER', error instanceof Error ? error.message : String(error)); throw error }
    transfer.record.phase = 'committed'
    this.finish(transfer)
    this.notify(transfer)
    this.hooks.show(transfer.target)
    return copy(transfer.record)
  }
  abort(id: string, owner: TransferOwner, code = 'EDITOR_TRANSFER_ABORTED'): EditorTransferRecord {
    const transfer = this.require(id)
    if (owner !== transfer.source && owner !== transfer.target) throw new EditorTransferError('EDITOR_TRANSFER_OWNER', '移交不属于当前窗口')
    if (transfer.record.phase !== 'committed' && transfer.record.phase !== 'aborted') this.abortInternal(transfer, code, '移交已撤销，原草稿和编辑权保留')
    return copy(transfer.record)
  }
  get(id: string, owner: TransferOwner): EditorTransferRecord | null {
    const transfer = this.transfers.get(id)
    return transfer && (transfer.source === owner || transfer.target === owner) ? copy(transfer.record) : null
  }
  pendingFor(owner: TransferOwner): EditorTransferRecord[] {
    return [...this.transfers.values()].filter(value => value.target === owner && active(value.record)).map(value => copy(value.record))
  }
  mayCloseSource(owner: TransferOwner, editorKey: string): boolean {
    const latest = [...this.transfers.values()].filter(value => value.source === owner && value.record.editorKey === editorKey).at(-1)
    return latest?.record.direction === 'return' && latest.record.phase === 'committed'
  }
  isFrozen(key: string): boolean { return [...this.transfers.values()].some(value => value.record.editorKey === key && active(value.record)) }
  shutdown(): void { for (const value of this.transfers.values()) if (active(value.record)) this.abortInternal(value, 'EDITOR_TRANSFER_SHUTDOWN', '应用正在关闭') }
  private require(id: string): Transfer {
    const value = this.transfers.get(id)
    if (!value) throw new EditorTransferError('EDITOR_TRANSFER_ENDED', '移交不存在或已结束')
    return value
  }
  private requireActive(transfer: Transfer): void {
    if (!active(transfer.record)) throw new EditorTransferError('EDITOR_TRANSFER_ENDED', '移交已经结束')
    if (Date.now() >= transfer.record.expiresAt) { this.abortInternal(transfer, 'EDITOR_TRANSFER_TIMEOUT', '移交未在10秒内确认完成'); throw new EditorTransferError('EDITOR_TRANSFER_TIMEOUT', '移交未在10秒内确认完成') }
  }
  private watch(transfer: Transfer, owner: TransferOwner, event: string, code: string): void {
    const callback = () => this.abortInternal(transfer, code, '移交窗口在就绪前关闭或崩溃')
    owner.once?.(event, callback)
    transfer.cleanups.push(() => owner.removeListener?.(event, callback))
  }
  private watchNavigation(transfer: Transfer, owner: TransferOwner, role: 'source' | 'target'): void {
    const callback = (details: { isMainFrame?: boolean; isSameDocument?: boolean }, _url?: string, legacySameDocument?: boolean, legacyMainFrame?: boolean) => {
      const mainFrame = details?.isMainFrame ?? legacyMainFrame
      const sameDocument = details?.isSameDocument ?? legacySameDocument
      if (mainFrame !== true || sameDocument === true || role === 'target' && transfer.record.phase === 'waiting' && !transfer.targetDocumentCommitted) return
      this.abortInternal(transfer, role === 'target' ? 'EDITOR_TARGET_NAVIGATED' : 'EDITOR_SOURCE_NAVIGATED', '移交页面重新加载，旧页面的就绪确认已失效；原草稿和编辑权保留')
    }
    owner.on?.('did-start-navigation', callback)
    transfer.cleanups.push(() => owner.removeListener?.('did-start-navigation', callback))
  }
  private finish(transfer: Transfer): void {
    clearTimeout(transfer.timer)
    for (const cleanup of transfer.cleanups.splice(0)) cleanup()
    // Retain a bounded terminal receipt so a late client can read its outcome.
    const terminal = [...this.transfers.entries()].filter(([, value]) => !active(value.record))
    for (const [id] of terminal.slice(0, Math.max(0, terminal.length - 128))) this.transfers.delete(id)
  }
  private notify(transfer: Transfer): void {
    if (!transfer.record.recovery && !transfer.source.isDestroyed() && transfer.source.isCrashed?.() !== true) this.hooks.notify(transfer.source, copy(transfer.record), 'source')
    if (transfer.target && !transfer.target.isDestroyed() && transfer.target.isCrashed?.() !== true) this.hooks.notify(transfer.target, copy(transfer.record), 'target')
  }
  private abortInternal(transfer: Transfer, code: string, message: string): void {
    if (!active(transfer.record)) return
    transfer.record.phase = 'aborted'
    transfer.record.error = { code, message }
    this.hooks.release(transfer.record.editorKey, transfer.source, transfer.record.transferId)
    this.finish(transfer)
    this.notify(transfer)
    if (transfer.target && !transfer.target.isDestroyed()) this.hooks.close(transfer.target)
  }
}
