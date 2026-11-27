import crypto from 'node:crypto'
import type { ToolPermission } from '../ai/runtime/tools'
import type { RuntimeTurnOwner } from './agent-runtime-admission.service'

export type RuntimePermissionDecision = 'allowOnce' | 'allowForSession' | 'deny' | 'cancel'
export type PermissionOwner = RuntimeTurnOwner & { send(channel: string, value: unknown): void }
type PermissionRequest = {
  sender: PermissionOwner
  scope: string
  requestId: string
  grant?: string
  finish(decision: RuntimePermissionDecision): void
}

function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable)
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, child]) => [key, stable(child)]))
  return value
}

/** Exact tool/action/resource scopes, never a whole read/write/execute permission kind. */
export function runtimePermissionGrantKey(action: string, detail: unknown, native: boolean): string | undefined {
  if (!detail || typeof detail !== 'object' || Array.isArray(detail)) return undefined
  const info = detail as Record<string, unknown>
  let scope: unknown
  if (native) {
    const tool = info.tool && typeof info.tool === 'object' ? info.tool as Record<string, unknown> : {}
    const patterns = Array.isArray(info.patterns) ? info.patterns : undefined
    if (!patterns?.length || !patterns.every(pattern => typeof pattern === 'string') || !action.trim()) return undefined
    scope = { action, tool: typeof tool.name === 'string' ? tool.name : action, patterns: [...patterns].sort() }
  } else {
    if (typeof info.tool !== 'string' || !info.tool.trim()) return undefined
    scope = { action, tool: info.tool, input: info.input ?? null }
  }
  try {
    const encoded = JSON.stringify(stable(scope))
    if (encoded.length > 16_384) return undefined
    return crypto.createHash('sha256').update(encoded).digest('hex')
  } catch { return undefined }
}

export class RuntimePermissionBroker {
  private readonly pending = new Map<string, PermissionRequest>()
  private readonly grants = new Map<PermissionOwner, Map<string, Set<string>>>()
  private readonly grantDestroyListeners = new Map<PermissionOwner, () => void>()

  private clearSenderGrants(sender: PermissionOwner): void {
    const destroyed = this.grantDestroyListeners.get(sender)
    if (destroyed) sender.removeListener?.('destroyed', destroyed)
    this.grantDestroyListeners.delete(sender)
    this.grants.delete(sender)
  }

  private trackGrantedSender(sender: PermissionOwner): void {
    if (this.grantDestroyListeners.has(sender)) return
    const destroyed = () => this.clearSenderGrants(sender)
    this.grantDestroyListeners.set(sender, destroyed)
    sender.once?.('destroyed', destroyed)
  }

  request(input: {
    sender: PermissionOwner
    sessionId: string
    scope: string
    requestId?: string
    permission: ToolPermission
    detail: unknown
    channel: string
    signal?: AbortSignal
    mode?: unknown
    native?: boolean
    action?: string
    forcePrompt?: boolean
    timeoutMs?: number
  }): Promise<RuntimePermissionDecision> {
    const { sender } = input
    if (sender.isDestroyed() || input.signal?.aborted) return Promise.resolve('cancel')
    const requestId = input.requestId || 'permission_' + crypto.randomUUID()
    if (this.pending.has(requestId)) throw new Error('RUNTIME_PERMISSION_DUPLICATE_REQUEST')
    const grant = runtimePermissionGrantKey(input.action || input.permission, input.detail, input.native === true)
    if (!input.forcePrompt) {
      if (!input.native && (input.mode === 'full' || (input.mode === 'automatic' && input.permission === 'read'))) return Promise.resolve('allowOnce')
      if (grant && this.grants.get(sender)?.get(input.scope)?.has(grant)) return Promise.resolve('allowOnce')
    }
    return new Promise(resolve => {
      const destroyed = () => finish('cancel')
      const aborted = () => finish('cancel')
      const timer = setTimeout(() => finish('deny'), input.timeoutMs ?? 5 * 60_000)
      const finish = (decision: RuntimePermissionDecision) => {
        if (this.pending.get(requestId)?.finish !== finish) return
        clearTimeout(timer)
        input.signal?.removeEventListener('abort', aborted)
        sender.removeListener?.('destroyed', destroyed)
        this.pending.delete(requestId)
        resolve(decision)
      }
      this.pending.set(requestId, { sender, scope: input.scope, requestId, grant: input.forcePrompt ? undefined : grant, finish })
      sender.once?.('destroyed', destroyed)
      input.signal?.addEventListener('abort', aborted, { once: true })
      if (sender.isDestroyed() || input.signal?.aborted) { finish('cancel'); return }
      try { sender.send(input.channel, { requestId, sessionId: input.sessionId, permission: input.permission, detail: input.detail }) }
      catch { finish('cancel') }
    })
  }

  /**
   * Return the decision the broker actually applied. A `allowForSession` with
   * no exact grant is downgraded to `allowOnce`; callers that persist the
   * answer must use this value, not the raw UI choice.
   */
  decideWithDecision(sender: PermissionOwner, requestId: string, decision: unknown): RuntimePermissionDecision | null {
    if (!['allowOnce', 'allowForSession', 'deny', 'cancel'].includes(String(decision))) return null
    const request = this.pending.get(requestId)
    if (!request || request.sender !== sender || sender.isDestroyed()) return null
    const effective: RuntimePermissionDecision = decision === 'allowForSession' && !request.grant ? 'allowOnce' : decision as RuntimePermissionDecision
    if (decision === 'allowForSession' && request.grant) {
      const scopes = this.grants.get(sender) || new Map<string, Set<string>>()
      const grants = scopes.get(request.scope) || new Set<string>()
      grants.add(request.grant)
      scopes.set(request.scope, grants)
      this.grants.set(sender, scopes)
      this.trackGrantedSender(sender)
    }
    request.finish(effective)
    return effective
  }

  /** Boolean compatibility for existing callers; use decideWithDecision to persist the effective answer. */
  decide(sender: PermissionOwner, requestId: string, decision: unknown): boolean {
    return this.decideWithDecision(sender, requestId, decision) !== null
  }

  clearScope(scope: string): void {
    for (const request of [...this.pending.values()]) if (request.scope === scope) request.finish('cancel')
    for (const [sender, scopes] of [...this.grants.entries()]) {
      scopes.delete(scope)
      if (!scopes.size) this.clearSenderGrants(sender)
    }
  }

  clearScopes(prefix: string): void {
    const scopes = new Set<string>()
    for (const request of this.pending.values()) if (request.scope === prefix || request.scope.startsWith(prefix + ':')) scopes.add(request.scope)
    for (const senderScopes of this.grants.values()) for (const scope of senderScopes.keys()) if (scope === prefix || scope.startsWith(prefix + ':')) scopes.add(scope)
    for (const scope of scopes) this.clearScope(scope)
  }

  shutdown(): void {
    for (const request of [...this.pending.values()]) request.finish('cancel')
    for (const sender of [...this.grants.keys()]) this.clearSenderGrants(sender)
  }
}
