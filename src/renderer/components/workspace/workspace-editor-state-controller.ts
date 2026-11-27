import { encodeWorkspaceEditorState, type StoredWorkspaceEditorState, type WorkspaceEditorBridge, type WorkspaceEditorFlushResult, type WorkspaceEditorSnapshot } from '../../../shared/workspace-editor-state'

function immutableCopy(value: unknown): unknown {
  const copy = structuredClone(value)
  const stack = [copy]
  while (stack.length) {
    const current = stack.pop()
    if (!current || typeof current !== 'object' || Object.isFrozen(current)) continue
    Object.freeze(current)
    for (const child of Object.values(current)) stack.push(child)
  }
  return copy
}

/** One instance owns one editor key and a serial stream of save acknowledgements. */
export class WorkspaceEditorStateController {
  private snapshot: WorkspaceEditorSnapshot = { status: 'loading', state: null, revision: 0, baseRevision: 0, localSequence: 0, dirty: false, remote: null, error: null }
  private listeners = new Set<() => void>()
  private bridge: WorkspaceEditorBridge | null = null
  private generation = 0
  private active = false
  private loaded = false
  private observedRevision = -1
  private localText = 'null'
  private storedText = 'null'
  private loading = Promise.resolve()
  private saves: Promise<unknown> = Promise.resolve()
  private unsubscribe: (() => void) | undefined
  private pending: { revision: number; text: string } | null = null

  constructor(readonly key: string) {}
  getSnapshot = (): WorkspaceEditorSnapshot => this.snapshot
  subscribe = (callback: () => void): (() => void) => { this.listeners.add(callback); return () => this.listeners.delete(callback) }
  private publish(patch: Partial<WorkspaceEditorSnapshot>): void {
    if (patch.error) patch = { ...patch, error: Object.freeze({ ...patch.error }) }
    this.snapshot = Object.freeze({ ...this.snapshot, ...patch })
    for (const listener of this.listeners) listener()
  }
  private failure(error: unknown, fallback: string): WorkspaceEditorFlushResult {
    const message = error instanceof Error ? error.message : String(error)
    const code = message.match(/\bEDITOR_[A-Z_]+/)?.[0] || fallback
    if (this.active) this.publish({ status: 'error', error: { code, message } })
    return { status: 'error', code, message }
  }
  connect(bridge: WorkspaceEditorBridge | null): void {
    const generation = ++this.generation
    this.active = true
    this.bridge = bridge
    if (!bridge) { this.failure(new Error('草稿存储暂不可用'), 'EDITOR_BRIDGE_UNAVAILABLE'); return }
    this.unsubscribe = bridge.onEditorStateChanged(value => {
      if (this.active && generation === this.generation) this.receive(value)
    })
    this.loading = bridge.loadEditorState(this.key).then(value => {
      if (!this.active || generation !== this.generation) return
      if (value) this.receive(this.validateStored(value))
      else { this.loaded = true; if (this.observedRevision < 0 && this.snapshot.status === 'loading') this.publish({ status: 'ready' }) }
    }).catch(error => {
      if (this.active && generation === this.generation && this.observedRevision < 0) this.failure(error, 'EDITOR_LOAD_FAILED')
    })
  }
  disconnect(): void {
    this.active = false
    this.generation++
    this.unsubscribe?.()
    this.unsubscribe = undefined
  }
  private receive(value: StoredWorkspaceEditorState): void {
    try {
      if (!value || typeof value !== 'object') throw new Error('EDITOR_BAD_RESPONSE: 草稿广播无效')
      if (value.editorKey !== this.key) return
      this.validateStored(value)
      if (value.revision <= this.observedRevision) return
      const text = encodeWorkspaceEditorState(value.state)
      this.observedRevision = value.revision
      this.loaded = true
      const own = this.pending && value.revision === this.pending.revision && text === this.pending.text
      if (own || !this.snapshot.dirty || this.localText === text) {
        const keepDirty = this.snapshot.dirty && this.localText !== text
        this.storedText = text
        if (!keepDirty) this.localText = text
        this.publish({ status: 'ready', state: keepDirty ? this.snapshot.state : immutableCopy(value.state), revision: value.revision, baseRevision: value.revision, dirty: keepDirty, remote: null, error: null })
      } else {
        this.publish({ status: 'conflict', revision: value.revision, remote: immutableCopy(value) as StoredWorkspaceEditorState, error: null })
      }
    } catch (error) { this.failure(error, 'EDITOR_BAD_RESPONSE') }
  }
  private validateStored(value: unknown): StoredWorkspaceEditorState {
    if (!value || typeof value !== 'object') throw new Error('EDITOR_BAD_RESPONSE: 草稿响应不是对象')
    const stored = value as StoredWorkspaceEditorState
    if (stored.editorKey !== this.key || !Number.isSafeInteger(stored.revision) || stored.revision < 0) throw new Error('EDITOR_BAD_RESPONSE: 草稿响应key或revision无效')
    encodeWorkspaceEditorState(stored.state)
    return immutableCopy(stored) as StoredWorkspaceEditorState
  }
  setState = (state: unknown): void => {
    try {
      const text = encodeWorkspaceEditorState(state)
      if (text === this.localText) return
      this.localText = text
      this.publish({ state: immutableCopy(state), localSequence: this.snapshot.localSequence + 1, dirty: text !== this.storedText, status: this.snapshot.status === 'conflict' ? 'conflict' : 'ready', error: null })
    } catch (error) { this.failure(error, 'EDITOR_STATE_INVALID') }
  }
  updateState = (updater: (state: unknown) => unknown): void => { this.setState(updater(this.snapshot.state)) }
  useRemote = (): void => {
    if (this.snapshot.status !== 'conflict') return
    const remote = this.snapshot.remote
    this.localText = this.storedText = encodeWorkspaceEditorState(remote?.state ?? null)
    this.observedRevision = remote?.revision ?? 0
    this.publish({ status: 'ready', state: immutableCopy(remote?.state ?? null), revision: this.observedRevision, baseRevision: this.observedRevision, dirty: false, remote: null, error: null, localSequence: this.snapshot.localSequence + 1 })
  }
  keepLocal = (): void => {
    if (this.snapshot.status !== 'conflict') return
    const remote = this.snapshot.remote
    this.storedText = encodeWorkspaceEditorState(remote?.state ?? null)
    this.observedRevision = remote?.revision ?? 0
    this.publish({ status: 'ready', revision: this.observedRevision, baseRevision: this.observedRevision, dirty: this.localText !== this.storedText, remote: null, error: null })
  }
  flush = (_reason: string): Promise<WorkspaceEditorFlushResult> => {
    const generation = this.generation
    const operation = this.saves.then(() => this.save(generation))
    this.saves = operation.then(() => undefined, () => undefined)
    return operation
  }
  private currentResult(): WorkspaceEditorFlushResult {
    const snapshot = this.getSnapshot()
    if (snapshot.status === 'conflict') return { status: 'conflict', local: immutableCopy(snapshot.state), remote: snapshot.remote }
    if (snapshot.status === 'error' && snapshot.error) return { status: 'error', ...snapshot.error }
    return { status: 'saved', revision: snapshot.baseRevision }
  }
  private async save(generation: number): Promise<WorkspaceEditorFlushResult> {
    await this.loading
    if (!this.active || generation !== this.generation) return { status: 'error', code: 'EDITOR_KEY_CHANGED', message: '编辑器已关闭或切换' }
    if (!this.bridge || !this.loaded) return { status: 'error', code: this.snapshot.error?.code || 'EDITOR_LOAD_FAILED', message: this.snapshot.error?.message || '草稿尚未读取' }
    if (this.snapshot.status === 'conflict') return { status: 'conflict', local: immutableCopy(this.snapshot.state), remote: this.snapshot.remote }
    if (this.snapshot.status === 'error' && this.snapshot.error && ['EDITOR_BAD_RESPONSE', 'EDITOR_STATE_INVALID', 'EDITOR_STATE_TOO_LARGE'].includes(this.snapshot.error.code)) return { status: 'error', ...this.snapshot.error }
    if (!this.snapshot.dirty) return { status: 'saved', revision: this.snapshot.baseRevision }
    const state = immutableCopy(this.snapshot.state), text = this.localText, base = this.snapshot.baseRevision
    const pending = { revision: base + 1, text }
    this.pending = pending
    try {
      const result = await this.bridge.saveEditorState(this.key, base, state)
      if (!this.active || generation !== this.generation) return { status: 'error', code: 'EDITOR_KEY_CHANGED', message: '原草稿的回包不会覆盖新编辑器' }
      if (!result || typeof result !== 'object') return this.failure(new Error('EDITOR_BAD_RESPONSE: 保存回包无效'), 'EDITOR_BAD_RESPONSE')
      if (result.saved === true) {
        const saved = this.validateStored(result.value)
        if (saved.revision !== base + 1 || encodeWorkspaceEditorState(saved.state) !== text) return this.failure(new Error('EDITOR_BAD_RESPONSE: 保存回包无效'), 'EDITOR_BAD_RESPONSE')
        if (this.observedRevision > saved.revision) {
          return this.currentResult()
        }
        this.storedText = text
        this.observedRevision = Math.max(this.observedRevision, result.value.revision)
        this.publish({ status: 'ready', revision: Math.max(this.snapshot.revision, result.value.revision), baseRevision: Math.max(this.snapshot.baseRevision, result.value.revision), dirty: this.localText !== text, remote: null, error: null })
        return { status: 'saved', revision: result.value.revision }
      }
      if (result.saved === false && 'conflict' in result && result.conflict === true) {
        const current = result.current === null ? null : this.validateStored(result.current)
        if ((current?.revision || 0) >= this.observedRevision || current === null && this.observedRevision <= base) {
          this.publish({ status: 'conflict', remote: current, revision: Math.max(this.snapshot.revision, current?.revision || 0), error: null })
          this.observedRevision = current?.revision || 0
        }
        return this.currentResult()
      }
      if (result.saved === false && 'error' in result && result.error && typeof result.error.code === 'string' && typeof result.error.message === 'string') return this.failure(new Error(result.error.message), result.error.code)
      return this.failure(new Error('EDITOR_BAD_RESPONSE: 保存回包无效'), 'EDITOR_BAD_RESPONSE')
    } catch (error) {
      if (!this.active || generation !== this.generation) return { status: 'error', code: 'EDITOR_KEY_CHANGED', message: '原编辑器保存已结束' }
      if (this.observedRevision > base) return this.currentResult()
      return this.failure(error, 'EDITOR_SAVE_FAILED')
    }
    finally { if (this.pending === pending) this.pending = null }
  }
}
