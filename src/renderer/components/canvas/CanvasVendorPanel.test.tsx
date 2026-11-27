// @vitest-environment jsdom
import React from 'react'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CanvasEditorFrameClient } from './canvas-editor-frame-client'
import { parseCanvasEditorRequest, parseCanvasEditorResponse, parseCanvasEditorView, parseCanvasEditorViewEvent } from '../../../shared/canvas-editor-transfer'
import { CanvasVendorPanel } from './CanvasVendorPanel'
import type { WorkspaceEditorTransferAdapter } from '../workspace/editor-types'

const host = vi.hoisted(() => ({ stateKey: 'compose:canvas-editor:canvas', status: 'ready', state: null as unknown, setState: vi.fn(), frozen: false, transferTarget: false, registerTransferAdapter: vi.fn() }))
vi.mock('../workspace/WorkspaceEditorHost', () => ({ useOptionalWorkspaceEditorState: () => host }))

const key = 'compose:canvas-editor:canvas'
const view = { version: 1 as const, projectId: 'project-1', projectRevision: 4, viewport: { x: 20, y: -30, k: 1.25 }, selectedNodeIds: ['node-1'], selectedConnectionId: null }
afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); host.registerTransferAdapter.mockReset(); host.setState.mockReset(); host.state = null; host.status = 'ready'; host.frozen = false; host.transferTarget = false })

describe('Canvas transfer message boundary', () => {
  it('resumes the saved view without copying the document and persists only directed current-generation view events', async () => {
    host.state = view
    render(<CanvasVendorPanel />)
    const frame = screen.getByTitle('无限画布工作台') as HTMLIFrameElement
    const post = vi.spyOn(frame.contentWindow!, 'postMessage').mockImplementation(() => {})
    act(() => window.dispatchEvent(new MessageEvent('message', { source: frame.contentWindow!, data: { type: 'grimoire:canvas-ready', detail: { apiReady: true, hydrated: true, generationId: 'frame-a' } } })))
    const restore = post.mock.calls[0]?.[0] as Record<string, unknown>
    expect(restore).toMatchObject({ operation: 'restore', state: view, editorKey: key })
    await act(async () => window.dispatchEvent(new MessageEvent('message', { source: frame.contentWindow!, data: { ...restore, type: 'grimoire:canvas-editor-response', ok: true, state: view } })))
    const thaw = post.mock.calls.find(call => (call[0] as Record<string, unknown>).operation === 'thaw')![0] as Record<string, unknown>
    act(() => window.dispatchEvent(new MessageEvent('message', { source: frame.contentWindow!, data: { ...thaw, type: 'grimoire:canvas-editor-response', ok: true } })))
    const next = { ...view, viewport: { x: 123, y: 7, k: 1.5 } }
    const event = { type: 'grimoire:canvas-editor-view', editorKey: key, generationId: 'frame-a', sequence: 2, state: next }
    expect(parseCanvasEditorViewEvent(event)?.state).toEqual(next)
    act(() => window.dispatchEvent(new MessageEvent('message', { source: frame.contentWindow!, data: event })))
    expect(host.setState).toHaveBeenLastCalledWith(next)
    const count = host.setState.mock.calls.length
    for (const data of [{ ...event, generationId: 'old-frame' }, { ...event, sequence: 1 }, { ...event, state: { ...next, nodes: [] } }]) act(() => window.dispatchEvent(new MessageEvent('message', { source: frame.contentWindow!, data })))
    expect(host.setState).toHaveBeenCalledTimes(count)
  })
  it('thaws a recreated frame after its earlier transfer already completed', () => {
    host.frozen = true; host.transferTarget = true
    const view = render(<CanvasVendorPanel />)
    const old = screen.getByTitle('无限画布工作台') as HTMLIFrameElement
    expect(new URL(old.src).searchParams.get('editorFrozen')).toBe('1')
    const oldPost = vi.spyOn(old.contentWindow!, 'postMessage').mockImplementation(() => {})
    act(() => window.dispatchEvent(new MessageEvent('message', { source: old.contentWindow!, data: { type: 'grimoire:canvas-ready', detail: { apiReady: true, hydrated: true } } })))
    expect(oldPost).not.toHaveBeenCalled()
    host.frozen = false; host.transferTarget = false
    view.rerender(<CanvasVendorPanel />)
    const request = oldPost.mock.calls[0][0] as Record<string, unknown>
    act(() => window.dispatchEvent(new MessageEvent('message', { source: old.contentWindow!, data: { ...request, type: 'grimoire:canvas-editor-response', ok: true } })))
    act(() => window.dispatchEvent(new MessageEvent('message', { source: old.contentWindow!, data: { type: 'grimoire:canvas-error', message: 'reload fixture' } })))
    fireEvent.click(screen.getByText('重新加载'))
    const fresh = screen.getByTitle('无限画布工作台') as HTMLIFrameElement
    const freshPost = vi.spyOn(fresh.contentWindow!, 'postMessage').mockImplementation(() => {})
    act(() => window.dispatchEvent(new MessageEvent('message', { source: fresh.contentWindow!, data: { type: 'grimoire:canvas-ready', detail: { apiReady: true, hydrated: true } } })))
    expect(freshPost).toHaveBeenCalledWith(expect.objectContaining({ operation: 'thaw', editorKey: key }), expect.any(String))
    const thaw = freshPost.mock.calls[0][0] as Record<string, unknown>
    act(() => window.dispatchEvent(new MessageEvent('message', { source: fresh.contentWindow!, data: { ...thaw, type: 'grimoire:canvas-editor-response', ok: true } })))
  })
  it('accepts only the persisted project handle and view, with no duplicate document', () => {
    expect(parseCanvasEditorView(view)).toEqual(view)
    expect(parseCanvasEditorView({ ...view, nodes: [{ text: 'private document' }] })).toBeNull()
    expect(parseCanvasEditorView({ ...view, viewport: { x: NaN, y: 0, k: 1 } })).toBeNull()
    expect(parseCanvasEditorView({ ...view, projectRevision: -1 })).toBeNull()
  })

  it('validates the directed request and response schema', () => {
    const input = { type: 'grimoire:canvas-editor-request', operation: 'hydrate', requestId: 'request-1', editorKey: key, state: view }
    expect(parseCanvasEditorRequest(input)).toEqual(input)
    expect(parseCanvasEditorRequest({ ...input, requestId: '' })).toBeNull()
    expect(parseCanvasEditorRequest({ ...input, operation: 'save-arbitrary-document' })).toBeNull()
    expect(parseCanvasEditorResponse({ type: 'grimoire:canvas-editor-response', operation: 'flush', requestId: 'request-1', editorKey: key, ok: true, state: view })).not.toBeNull()
    expect(parseCanvasEditorResponse({ type: 'grimoire:canvas-editor-response', operation: 'flush', requestId: 'request-1', editorKey: key, ok: true, state: { ...view, document: {} } })).toBeNull()
  })

  it('ignores foreign frames, mismatched keys, operations, and stale request IDs', async () => {
    const target = { postMessage: vi.fn() } as unknown as Window
    const client = new CanvasEditorFrameClient(key, () => target, window)
    const result = client.request('flush')
    const sent = vi.mocked(target.postMessage).mock.calls[0][0] as Record<string, unknown>
    const reply = { ...sent, type: 'grimoire:canvas-editor-response', ok: true, state: view }
    let completed = false
    void result.then(() => { completed = true })
    for (const [source, data] of [[window, reply], [target, { ...reply, editorKey: 'foreign' }], [target, { ...reply, requestId: 'late' }], [target, { ...reply, operation: 'hydrate' }]] as const) {
      window.dispatchEvent(new MessageEvent('message', { source, data }))
    }
    await Promise.resolve()
    expect(completed).toBe(false)
    window.dispatchEvent(new MessageEvent('message', { source: target, data: reply }))
    await expect(result).resolves.toEqual(view)
    client.dispose()
  })

  it('rejects explicit queue errors and bounds a missing reply to ten seconds', async () => {
    vi.useFakeTimers()
    const target = { postMessage: vi.fn() } as unknown as Window
    const client = new CanvasEditorFrameClient(key, () => target, window)
    const failed = client.request('flush')
    const failure = expect(failed).rejects.toThrow('CANVAS_SAVE_FAILED: disk fixture')
    const sent = vi.mocked(target.postMessage).mock.calls[0][0] as Record<string, unknown>
    window.dispatchEvent(new MessageEvent('message', { source: target, data: { ...sent, type: 'grimoire:canvas-editor-response', ok: false, code: 'CANVAS_SAVE_FAILED', message: 'disk fixture' } }))
    await failure
    const missing = client.request('hydrate', view)
    const timeout = expect(missing).rejects.toThrow('CANVAS_TRANSFER_TIMEOUT')
    await vi.advanceTimersByTimeAsync(10_000)
    await timeout
    client.dispose()
  })

  it('rejects in-flight requests when the iframe is replaced or unmounted', async () => {
    const target = { postMessage: vi.fn() } as unknown as Window
    const client = new CanvasEditorFrameClient(key, () => target, window)
    const pending = client.request('flush')
    const rejected = expect(pending).rejects.toThrow('CANVAS_FRAME_CLOSED')
    client.dispose()
    await rejected
  })

  it('registers the real panel only after its own frame is ready and captures a directed persisted view', async () => {
    render(<CanvasVendorPanel />)
    const frame = screen.getByTitle('无限画布工作台') as HTMLIFrameElement
    const currentAdapter = () => host.registerTransferAdapter.mock.calls.at(-1)![0] as WorkspaceEditorTransferAdapter
    expect(currentAdapter().ready?.()).toBe(false)
    act(() => window.dispatchEvent(new MessageEvent('message', { source: window, data: { type: 'grimoire:canvas-ready', detail: { apiReady: true, hydrated: true } } })))
    expect(currentAdapter().ready?.()).toBe(false)
    act(() => window.dispatchEvent(new MessageEvent('message', { source: frame.contentWindow!, data: { type: 'grimoire:canvas-ready', detail: { apiReady: true, hydrated: true } } })))
    expect(currentAdapter().ready?.()).toBe(true)
    const post = vi.spyOn(frame.contentWindow!, 'postMessage').mockImplementation(() => {})
    const capture = currentAdapter().capture!()
    const request = post.mock.calls[0][0] as Record<string, unknown>
    expect(request).toMatchObject({ type: 'grimoire:canvas-editor-request', operation: 'flush', editorKey: key })
    act(() => window.dispatchEvent(new MessageEvent('message', { source: frame.contentWindow!, data: { ...request, type: 'grimoire:canvas-editor-response', ok: true, state: view } })))
    await expect(capture).resolves.toEqual(view)
  })
})
