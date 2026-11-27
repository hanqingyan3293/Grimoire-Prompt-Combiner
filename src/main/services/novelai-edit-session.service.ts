import crypto from 'node:crypto'
import type { NovelaiEditResource, NovelaiEditLease } from '../../shared/novelai-edit-types'
import { requireId } from './input-validation'
import { editorOwnershipKey, type WorkspaceEditorAccess } from '../../shared/editor-transfer'

export type NovelaiEditOwner = {
  kind: 'window'
  sender: { isDestroyed(): boolean; once?(event: string, callback: () => void): unknown; removeListener?(event: string, callback: () => void): unknown }
  editorKey: string
  leaseId?: string
} | { kind: 'runtime'; sessionId: string }

export class NovelaiEditSessionError extends Error {
  constructor(readonly code: 'EDIT_LOCKED' | 'EDIT_LEASE_EXPIRED' | 'EDIT_OWNER_UNAVAILABLE' | 'EDIT_RESOURCE_INVALID' | 'REVISION_CONFLICT', message: string) {
    super(code + ': ' + message)
    this.name = 'NovelaiEditSessionError'
  }
}
const TTL_MS = 30_000
export const NOVELAI_EDIT_HEARTBEAT_MS = 10_000
interface Lease extends NovelaiEditLease { owner: NovelaiEditOwner; destroyed?: () => void }
type WindowSender = Extract<NovelaiEditOwner, {kind: 'window'}>['sender']
interface TransferHold { source: WindowSender; id: string; target?: WindowSender; leases: Array<{ key: string; lease: Lease; owner: NovelaiEditOwner; leaseId: string }> }

function resourceKey(resource: NovelaiEditResource): string {
  if (!resource || !['work', 'asset'].includes(resource.kind)) throw new NovelaiEditSessionError('EDIT_RESOURCE_INVALID', '编辑资源无效')
  try { return resource.kind + ':' + requireId(resource.id, '编辑资源 ID') }
  catch { throw new NovelaiEditSessionError('EDIT_RESOURCE_INVALID', '编辑资源 ID 无效') }
}
function validOwner(owner: NovelaiEditOwner): void {
  if (!owner) throw new NovelaiEditSessionError('EDIT_OWNER_UNAVAILABLE', '缺少真实编辑者')
  if (owner.kind === 'window') {
    if (!owner.sender || owner.sender.isDestroyed()) throw new NovelaiEditSessionError('EDIT_OWNER_UNAVAILABLE', '编辑窗口已经关闭')
    try { requireId(owner.editorKey, '编辑器状态键') } catch { throw new NovelaiEditSessionError('EDIT_OWNER_UNAVAILABLE', '编辑器状态键无效') }
  } else if (owner.kind !== 'runtime' || !owner.sessionId) throw new NovelaiEditSessionError('EDIT_OWNER_UNAVAILABLE', '缺少已验证的runtime会话')
}
function sameOwner(left: NovelaiEditOwner, right: NovelaiEditOwner): boolean {
  return left.kind === 'window' && right.kind === 'window'
    ? left.sender === right.sender && left.editorKey === right.editorKey
    : left.kind === 'runtime' && right.kind === 'runtime' && left.sessionId === right.sessionId
}
function publicLease(lease: Lease): NovelaiEditLease {
  return { resource: { ...lease.resource }, leaseId: lease.leaseId, expiresAt: lease.expiresAt }
}

/** Main process policy, reusing runtime admission's exact-owner/stale-release discipline. */
export class NovelaiEditSessionManager {
  private leases = new Map<string, Lease>()
  private transfers = new Map<string, TransferHold>()
  private editorOwners = new Map<string, { sender: WindowSender; destroyed: () => void }>()
  private editorHeld(key: string): boolean { return [...this.transfers.keys()].some(held => editorOwnershipKey(held) === editorOwnershipKey(key)) }
  private editorOwner(key: string) { return this.editorOwners.get(editorOwnershipKey(key)) }
  private setEditorOwner(key: string, sender: WindowSender): void {
    key = editorOwnershipKey(key)
    const previous = this.editorOwners.get(key)
    if (previous?.sender === sender) return
    if (previous) previous.sender.removeListener?.('destroyed', previous.destroyed)
    const ownership = { sender, destroyed: () => { if (this.editorOwners.get(key) === ownership) this.editorOwners.delete(key) } }
    this.editorOwners.set(key, ownership)
    sender.once?.('destroyed', ownership.destroyed)
  }
  getEditorAccess(editorKey: string, sender: WindowSender): WorkspaceEditorAccess {
    if (!sender || sender.isDestroyed()) throw new NovelaiEditSessionError('EDIT_OWNER_UNAVAILABLE', '编辑窗口已经关闭')
    requireId(editorKey, '编辑器状态键')
    if (!this.editorOwner(editorKey) && editorOwnershipKey(editorKey) === 'legacy-prompts' && !this.editorHeld(editorKey)) this.setEditorOwner(editorKey, sender)
    if (this.editorHeld(editorKey)) return { writable: false, reason: 'held' }
    const owner = this.editorOwner(editorKey)
    return owner && owner.sender !== sender ? { writable: false, reason: 'foreign' } : { writable: true, reason: 'owned' }
  }
  private heldResource(key: string): boolean { return [...this.transfers.values()].some(transfer => transfer.leases.some(value => value.key === key)) }
  private watchWindow(key: string, lease: Lease, sender: WindowSender): void {
    lease.destroyed = () => { if (lease.owner.kind === 'window' && lease.owner.sender === sender) this.remove(key, lease) }
    sender.once?.('destroyed', lease.destroyed)
  }
  private remove(key: string, lease: Lease): void {
    if (this.leases.get(key) !== lease) return
    if (lease.owner.kind === 'window' && lease.destroyed) lease.owner.sender.removeListener?.('destroyed', lease.destroyed)
    this.leases.delete(key)
  }
  private current(key: string): Lease | undefined {
    const lease = this.leases.get(key)
    if (lease && (lease.expiresAt <= Date.now() || lease.owner.kind === 'window' && lease.owner.sender.isDestroyed())) {
      this.remove(key, lease)
      return undefined
    }
    return lease
  }
  acquire(resource: NovelaiEditResource, owner: NovelaiEditOwner): NovelaiEditLease {
    validOwner(owner)
    const key = resourceKey(resource)
    if (owner.kind === 'window' && this.editorOwner(owner.editorKey) && this.editorOwner(owner.editorKey)?.sender !== owner.sender) throw new NovelaiEditSessionError('EDIT_LOCKED', '编辑器属于另一窗口')
    if (this.heldResource(key)) throw new NovelaiEditSessionError('EDIT_LOCKED', '编辑资源正在移交')
    const current = this.current(key)
    if (owner.kind === 'window' && this.editorHeld(owner.editorKey)) throw new NovelaiEditSessionError('EDIT_LOCKED', '编辑器正在移交')
    if (current) {
      if (!sameOwner(current.owner, owner)) throw new NovelaiEditSessionError('EDIT_LOCKED', '另一处正在编辑该资源')
      current.leaseId = crypto.randomUUID()
      current.expiresAt = Date.now() + TTL_MS
      return publicLease(current)
    }
    const lease: Lease = { resource: { ...resource }, owner, leaseId: crypto.randomUUID(), expiresAt: Date.now() + TTL_MS }
    this.leases.set(key, lease)
    if (owner.kind === 'window') {
      this.watchWindow(key, lease, owner.sender)
    }
    return publicLease(lease)
  }
  heartbeat(resource: NovelaiEditResource, leaseId: string, owner: NovelaiEditOwner): NovelaiEditLease {
    validOwner(owner)
    const lease = this.current(resourceKey(resource))
    if (!lease || lease.leaseId !== leaseId || !sameOwner(lease.owner, owner)) throw new NovelaiEditSessionError('EDIT_LEASE_EXPIRED', '编辑租约已过期或已经移交')
    lease.expiresAt = Date.now() + TTL_MS
    return publicLease(lease)
  }
  release(resource: NovelaiEditResource, leaseId: string, owner: NovelaiEditOwner): boolean {
    const key = resourceKey(resource), lease = this.current(key)
    if (!lease || lease.leaseId !== leaseId || !sameOwner(lease.owner, owner)) return false
    if (lease.owner.kind === 'window' && this.transfers.has(lease.owner.editorKey)) return false
    this.remove(key, lease)
    return true
  }
  assertWrite(resource: NovelaiEditResource, owner?: NovelaiEditOwner): void {
    const key = resourceKey(resource)
    if (this.heldResource(key)) throw new NovelaiEditSessionError('EDIT_LOCKED', '编辑资源正在移交')
    const lease = this.current(key)
    if (lease?.owner.kind === 'window' && this.transfers.has(lease.owner.editorKey)) throw new NovelaiEditSessionError('EDIT_LOCKED', '编辑器正在移交，暂不接受业务写入')
    if (!lease) {
      if (owner?.kind === 'window' && owner.leaseId) throw new NovelaiEditSessionError('EDIT_LEASE_EXPIRED', '编辑租约已过期，请重新取得编辑权')
      return
    }
    if (!owner || !sameOwner(lease.owner, owner) || owner.kind === 'window' && owner.leaseId !== lease.leaseId) throw new NovelaiEditSessionError('EDIT_LOCKED', '另一处正在编辑该资源')
    validOwner(owner)
  }
  assertEditorWrite(editorKey: string, sender: Extract<NovelaiEditOwner, { kind: 'window' }>['sender']): void {
    if (!sender || sender.isDestroyed()) throw new NovelaiEditSessionError('EDIT_OWNER_UNAVAILABLE', '编辑窗口已经关闭')
    if (this.editorHeld(editorKey)) throw new NovelaiEditSessionError('EDIT_LOCKED', '编辑器正在移交')
    if (this.editorOwner(editorKey) && this.editorOwner(editorKey)?.sender !== sender) throw new NovelaiEditSessionError('EDIT_LOCKED', '编辑器属于另一窗口')
    for (const [key] of this.leases) {
      const lease = this.current(key)
      if (lease?.owner.kind === 'window' && lease.owner.editorKey === editorKey && lease.owner.sender !== sender) throw new NovelaiEditSessionError('EDIT_LOCKED', '编辑器状态属于另一处正在编辑的资源')
    }
  }
  holdTransfer(editorKey: string, source: Extract<NovelaiEditOwner, {kind:'window'}>['sender'], transferId: string): void {
    if (!source || source.isDestroyed() || this.editorHeld(editorKey)) throw new NovelaiEditSessionError('EDIT_LOCKED', '编辑器无法移交')
    if (this.editorOwner(editorKey) && this.editorOwner(editorKey)?.sender !== source) throw new NovelaiEditSessionError('EDIT_LOCKED', '编辑器属于另一窗口')
    const leases = [...this.leases.keys()].map(key => this.current(key)).filter((lease): lease is Lease => Boolean(lease?.owner.kind === 'window' && lease.owner.editorKey === editorKey))
    if (leases.some(lease => lease.owner.kind !== 'window' || lease.owner.sender !== source)) throw new NovelaiEditSessionError('EDIT_LOCKED', '编辑器属于其他窗口')
    for (const lease of leases) lease.expiresAt = Date.now() + TTL_MS
    this.setEditorOwner(editorKey, source)
    this.transfers.set(editorKey, { source, id: transferId, leases: leases.map(lease => ({ key: resourceKey(lease.resource), lease, owner: lease.owner, leaseId: lease.leaseId })) })
  }
  abortTransfer(editorKey: string, source: Extract<NovelaiEditOwner, {kind:'window'}>['sender'], transferId: string): void {
    const transfer = this.transfers.get(editorKey)
    if (!transfer || transfer.source !== source || transfer.id !== transferId) return
    if (transfer.target) for (const original of transfer.leases) {
      const current = this.leases.get(original.key)
      if (current) this.remove(original.key, current)
      if (source.isDestroyed()) continue
      const lease = original.lease
      lease.owner = original.owner; lease.leaseId = original.leaseId; lease.expiresAt = Date.now() + TTL_MS
      this.leases.set(original.key, lease)
      this.watchWindow(original.key, lease, source)
    }
    if (!source.isDestroyed()) this.setEditorOwner(editorKey, source)
    this.transfers.delete(editorKey)
  }
  commitTransfer(editorKey: string, source: Extract<NovelaiEditOwner, {kind:'window'}>['sender'], target: Extract<NovelaiEditOwner, {kind:'window'}>['sender'], transferId: string): void {
    const transfer = this.transfers.get(editorKey)
    if (!transfer || transfer.source !== source || transfer.id !== transferId || source.isDestroyed() || target.isDestroyed()) throw new NovelaiEditSessionError('EDIT_LOCKED', '编辑器移交身份已经改变')
    if (transfer.target) { if (transfer.target !== target) throw new NovelaiEditSessionError('EDIT_LOCKED', '移交目标已经改变'); return }
    transfer.target = target
    this.setEditorOwner(editorKey, target)
    for (const [key, lease] of this.leases) {
      if (lease.owner.kind !== 'window' || lease.owner.editorKey !== editorKey || lease.owner.sender !== source) continue
      if (lease.destroyed) source.removeListener?.('destroyed', lease.destroyed)
      lease.owner = { kind: 'window', sender: target, editorKey }
      lease.leaseId = crypto.randomUUID(); lease.expiresAt = Date.now() + TTL_MS
      this.watchWindow(key, lease, target)
    }
  }
  completeTransfer(editorKey: string, source: WindowSender, target: WindowSender, transferId: string): void {
    const transfer = this.transfers.get(editorKey)
    if (!transfer || transfer.source !== source || transfer.target !== target || transfer.id !== transferId || target.isDestroyed()) throw new NovelaiEditSessionError('EDIT_LOCKED', '编辑器移交身份已经改变')
    this.transfers.delete(editorKey)
  }
}
export const novelaiEditSessions = new NovelaiEditSessionManager()
