// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { installCanvasEditorTransfer, registerCanvasProjectTransferAdapter } from './canvas-editor-transfer'

const key = 'workspace:canvas:canvas'
const view = { version: 1 as const, projectId: 'project-1', projectRevision: 4, viewport: { x: 1, y: 2, k: 1 }, selectedNodeIds: ['node-1'], selectedConnectionId: null }
const cleanups: Array<() => void> = []
afterEach(() => { cleanups.splice(0).forEach(cleanup => cleanup()); vi.restoreAllMocks() })

function setup() {
  const reply = vi.spyOn(window.parent, 'postMessage').mockImplementation(() => {})
  const deps = { ready: () => true, projectId: () => view.projectId as string | null, flush: vi.fn(async () => {}), readProject: vi.fn(async () => ({ revision: 4 })), hydrateProject: vi.fn(async () => {}), navigate: vi.fn(async () => {}) }
  const adapter = { projectId: view.projectId, ready: () => true, assertCanTransfer: vi.fn(), flush: vi.fn(async () => {}), view: () => view, restore: vi.fn(async () => {}) }
  deps.navigate.mockImplementation(async (path?: string) => { if (path?.includes('__editorHydration=')) cleanups.push(registerCanvasProjectTransferAdapter({ ...adapter })) })
  cleanups.push(registerCanvasProjectTransferAdapter(adapter), installCanvasEditorTransfer(window, key, deps))
  const send = (operation: string, requestId = 'request-1', state?: unknown, source: Window = window.parent) => window.dispatchEvent(new MessageEvent('message', { source, data: { type: 'grimoire:canvas-editor-request', requestId, editorKey: key, operation, ...(state ? { state } : {}) } }))
  return { reply, deps, adapter, send }
}

describe('Canvas iframe directed transfer', () => {
  it('restores a normal editor view from the existing recovery-aware store instead of replacing its document with canonical data', async () => {
    const { deps, adapter, send, reply } = setup()
    send('restore', 'resume-1', view)
    await vi.waitFor(() => expect(reply).toHaveBeenCalledTimes(1))
    expect(deps.hydrateProject).not.toHaveBeenCalled()
    expect(deps.navigate).not.toHaveBeenCalled()
    expect(adapter.restore).toHaveBeenCalledWith(view, false)
    expect(reply.mock.calls[0][0]).toMatchObject({ operation: 'restore', ok: true, state: view })
  })
  it('does not treat the old ready page as the newly hydrated target', async () => {
    const { send, reply, deps, adapter: old } = setup()
    deps.navigate.mockImplementation(async () => {})
    send('hydrate', 'new-page', view)
    await new Promise(resolve => setTimeout(resolve, 40))
    expect(reply).not.toHaveBeenCalled()
    const target = { ...old, restore: vi.fn(async () => {}), view: () => view }
    cleanups.push(registerCanvasProjectTransferAdapter(target))
    await vi.waitFor(() => expect(reply).toHaveBeenCalledTimes(1))
    expect(target.restore).toHaveBeenCalledWith(view)
  })
  it('blocks a late pointer release and zoom event after the document was frozen and flushed', async () => {
    const { send, reply } = setup()
    const mutate = vi.fn()
    window.addEventListener('mouseup', mutate); window.addEventListener('wheel', mutate)
    cleanups.push(() => { window.removeEventListener('mouseup', mutate); window.removeEventListener('wheel', mutate) })
    send('freeze', 'freeze-1'); await vi.waitFor(() => expect(reply).toHaveBeenCalledTimes(1))
    send('flush', 'flush-1'); await vi.waitFor(() => expect(reply).toHaveBeenCalledTimes(2))
    window.dispatchEvent(new MouseEvent('mouseup')); window.dispatchEvent(new WheelEvent('wheel'))
    expect(mutate).not.toHaveBeenCalled()
  })
  it('rejects foreign sources and malformed messages without invoking business save', async () => {
    const { deps, send, reply } = setup()
    const foreign = document.createElement('iframe'); document.body.append(foreign)
    send('flush', 'foreign', undefined, foreign.contentWindow!)
    send('hydrate', 'malformed', { ...view, nodes: [] })
    await Promise.resolve()
    expect(deps.flush).not.toHaveBeenCalled(); expect(reply).not.toHaveBeenCalled()
    foreign.remove()
  })

  it('freezes, flushes local edits and the original save queue, then reports the canonical revision', async () => {
    const { deps, adapter, send, reply } = setup()
    send('freeze', 'freeze-1')
    await vi.waitFor(() => expect(reply).toHaveBeenCalledTimes(1))
    send('flush', 'flush-1')
    await vi.waitFor(() => expect(reply).toHaveBeenCalledTimes(2))
    expect(adapter.flush).toHaveBeenCalledTimes(1); expect(deps.flush).toHaveBeenCalledTimes(1)
    expect(reply.mock.calls[1][0]).toMatchObject({ operation: 'flush', requestId: 'flush-1', editorKey: key, ok: true, state: view })
  })

  it('returns a real save failure and lets thaw bypass a stalled queue', async () => {
    const { deps, send, reply } = setup()
    let finish!: () => void
    deps.flush.mockReturnValueOnce(new Promise<void>(resolve => { finish = resolve }))
    send('freeze', 'freeze-1'); await vi.waitFor(() => expect(reply).toHaveBeenCalledTimes(1))
    send('flush', 'pending-flush'); await vi.waitFor(() => expect(deps.flush).toHaveBeenCalled())
    send('thaw', 'thaw-1'); await vi.waitFor(() => expect(reply.mock.calls.some(call => (call[0] as { requestId: string }).requestId === 'thaw-1')).toBe(true))
    finish()
    await vi.waitFor(() => expect(reply.mock.calls.find(call => (call[0] as { requestId: string }).requestId === 'pending-flush')?.[0]).toMatchObject({ ok: false, code: 'CANVAS_TRANSFER_CANCELLED' }))
  })

  it('never acknowledges a failed queue as a persisted transfer', async () => {
    const { deps, send, reply } = setup()
    deps.flush.mockRejectedValueOnce(new Error('CANVAS_SAVE_FAILED: disk fixture'))
    send('freeze', 'freeze-1'); await vi.waitFor(() => expect(reply).toHaveBeenCalledTimes(1))
    send('flush', 'failed-flush'); await vi.waitFor(() => expect(reply).toHaveBeenCalledTimes(2))
    expect(reply.mock.calls[1][0]).toMatchObject({ ok: false, code: 'CANVAS_SAVE_FAILED', message: 'disk fixture' })
  })

  it('hydrates canonical storage before routing/restoring selection and acknowledges a request only once', async () => {
    const { deps, adapter, send, reply } = setup()
    send('hydrate', 'hydrate-1', view)
    send('hydrate', 'hydrate-1', view)
    await vi.waitFor(() => expect(reply).toHaveBeenCalledTimes(2))
    expect(deps.hydrateProject).toHaveBeenCalledWith(view.projectId, view.projectRevision)
    expect(adapter.restore).toHaveBeenCalledWith(view)
    expect(deps.hydrateProject).toHaveBeenCalledTimes(1)
    expect(deps.hydrateProject.mock.invocationCallOrder[0]).toBeLessThan(adapter.restore.mock.invocationCallOrder[0])
  })

  it('refuses an active generation and Chinese composition without discarding either', async () => {
    const { adapter, send, reply } = setup()
    window.dispatchEvent(new CompositionEvent('compositionstart'))
    send('freeze', 'ime')
    await vi.waitFor(() => expect(reply).toHaveBeenCalledTimes(1))
    expect(reply.mock.calls[0][0]).toMatchObject({ ok: false, code: 'EDITOR_COMPOSITION_ACTIVE' })
    window.dispatchEvent(new CompositionEvent('compositionend'))
    adapter.assertCanTransfer.mockImplementation(() => { throw new Error('CANVAS_TASK_ACTIVE: generation fixture') })
    send('freeze', 'busy')
    await vi.waitFor(() => expect(reply).toHaveBeenCalledTimes(2))
    expect(reply.mock.calls[1][0]).toMatchObject({ ok: false, code: 'CANVAS_TASK_ACTIVE' })
  })
})
