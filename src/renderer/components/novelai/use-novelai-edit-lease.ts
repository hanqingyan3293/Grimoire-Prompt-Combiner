import { useEffect, useMemo, useRef, useState } from 'react'
import type { NovelaiEditResource, NovelaiEditProof, NovelaiEditLease } from '../../../shared/novelai-edit-types'
import { useOptionalWorkspaceEditorState } from '../workspace/WorkspaceEditorHost'

export function useNovelaiEditLease(resource: NovelaiEditResource | null) {
  const editor = useOptionalWorkspaceEditorState()
  const standalone = useRef('standalone-novelai:' + crypto.randomUUID())
  const editorKey = editor?.stateKey || standalone.current
  const resourceKey = resource ? resource.kind + ':' + resource.id : ''
  const stableResource = useMemo(() => resource ? { kind: resource.kind, id: resource.id } : null, [resourceKey])
  const [state, setState] = useState<{ status: 'idle' | 'loading' | 'ready' | 'error' | 'unavailable'; error: { code: string; message: string } | null }>({ status: 'idle', error: null })
  const [attempt, setAttempt] = useState(0)
  const active = useRef<{ resource: NovelaiEditResource; editorKey: string; lease: NovelaiEditLease | null; pending: Promise<void>; alive: boolean; error: {code:string;message:string}|null } | null>(null)
  const supported = typeof window !== 'undefined' && typeof window.api?.workspace?.acquireEditLease === 'function'
  const receiving = Boolean(editor?.transferTarget && editor.frozen)
  useEffect(() => {
    if (!stableResource) { active.current = null; setState({ status: 'idle', error: null }); return }
    if (!supported) { setState({ status: 'unavailable', error: null }); return }
    if (receiving) { setState({ status: 'loading', error: null }); return }
    const api = window.api.workspace
    const scope = { resource: stableResource, editorKey, lease: null as NovelaiEditLease | null, pending: Promise.resolve(), alive: true, error: null as {code:string;message:string}|null }
    active.current = scope
    setState({ status: 'loading', error: null })
    const fail = (value: {code:string;message:string}) => {
      if (!scope.alive) return
      scope.error = value
      setState({ status: 'error', error: value })
    }
    const validate = (lease: NovelaiEditLease) => {
      if (!lease || lease.resource?.kind !== stableResource.kind || lease.resource?.id !== stableResource.id || typeof lease.leaseId !== 'string' || !lease.leaseId || !Number.isFinite(lease.expiresAt)) throw new Error('EDIT_BAD_RESPONSE: 编辑租约回包无效')
      return lease
    }
    const release = (lease: NovelaiEditLease) => { void api.releaseEditLease(stableResource, editorKey, lease.leaseId).catch(error => console.warn('Edit lease release failed', error instanceof Error ? error.message : String(error))) }
    scope.pending = api.acquireEditLease(stableResource, editorKey).then(result => {
      if (!result.ok) { fail({ code: result.code, message: result.message }); return }
      const lease = validate(result.lease)
      if (!scope.alive) { release(lease); return }
      scope.lease = lease; scope.error = null
      setState({ status: 'ready', error: null })
    }).catch(error => fail({ code: 'EDIT_ACQUIRE_FAILED', message: error instanceof Error ? error.message : String(error) }))
    let heartbeating = false
    const timer = setInterval(() => {
      if (!scope.alive || !scope.lease || scope.error || heartbeating) return
      heartbeating = true
      void api.heartbeatEditLease(stableResource, editorKey, scope.lease.leaseId).then(result => {
        if (!scope.alive) return
        if (!result.ok) { fail({ code: result.code, message: result.message }); return }
        scope.lease = validate(result.lease)
      }).catch(error => fail({ code: 'EDIT_HEARTBEAT_FAILED', message: error instanceof Error ? error.message : String(error) })).finally(() => { heartbeating = false })
    }, 10_000)
    return () => {
      scope.alive = false
      clearInterval(timer)
      if (scope.lease) release(scope.lease)
      if (active.current === scope) active.current = null
    }
  }, [stableResource, editorKey, supported, attempt, receiving])

  const proof = async (): Promise<NovelaiEditProof | undefined> => {
    if (!supported || !stableResource) return undefined
    const scope = active.current
    if (!scope || scope.resource.kind !== stableResource.kind || scope.resource.id !== stableResource.id) throw new Error('EDIT_RESOURCE_CHANGED: 编辑资源已经切换')
    await scope.pending
    if (!scope.alive || scope !== active.current) throw new Error('EDIT_RESOURCE_CHANGED: 编辑资源已经切换')
    if (scope.error) throw new Error(scope.error.code + ': ' + scope.error.message)
    if (!scope.lease || scope.lease.expiresAt <= Date.now()) throw new Error('EDIT_LEASE_EXPIRED: 编辑租约已经过期，请重试')
    return { editorKey: scope.editorKey, leaseId: scope.lease.leaseId }
  }
  return { ...state, proof, retry: () => setAttempt(value => value + 1), supported, editorKey }
}
