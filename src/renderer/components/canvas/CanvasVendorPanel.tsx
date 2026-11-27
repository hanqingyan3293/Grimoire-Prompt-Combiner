import React, { useEffect, useMemo, useRef, useState } from 'react'
import { useUnifiedAgentStore } from '../../stores/unified-agent.store'
import { useOptionalWorkspaceEditorState } from '../workspace/WorkspaceEditorHost'
import { parseCanvasEditorView, parseCanvasEditorViewEvent } from '../../../shared/canvas-editor-transfer'
import { CanvasEditorFrameClient } from './canvas-editor-frame-client'

function canvasEntryUrl() {
  if (window.location.protocol === 'file:') return new URL('../canvas.html', import.meta.url).toString()
  return window.location.origin + '/canvas.html'
}

type CanvasFrameStatus = 'loading' | 'ready' | 'error'

export function CanvasVendorPanel() {
  const editor = useOptionalWorkspaceEditorState()
  if (editor?.status === 'loading') return <div role='status' className='flex h-full items-center justify-center text-sm text-[var(--color-text-secondary)]'>正在读取画布编辑状态…</div>
  return <CanvasFramePanel key={editor?.stateKey || 'standalone'} editor={editor} />
}

function CanvasFramePanel({ editor }: { editor: ReturnType<typeof useOptionalWorkspaceEditorState> }) {
  const editorKey = editor?.stateKey || 'canvas:standalone'
  const editorRef = useRef(editor); editorRef.current = editor
  const initialView = useMemo(() => parseCanvasEditorView(editor?.state), [editorKey])
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const src = useMemo(() => {
    const url = new URL(canvasEntryUrl()); url.searchParams.set('editorKey', editorKey)
    if (editor?.transferTarget || initialView?.projectId) url.searchParams.set('editorFrozen', '1')
    if (initialView && !initialView.projectId) url.searchParams.set('editorLibrary', '1')
    return url.toString()
  }, [editorKey])
  const [status, setStatus] = useState<CanvasFrameStatus>('loading')
  const [error, setError] = useState('')
  const [reloadKey, setReloadKey] = useState(0)
  const [generation, setGeneration] = useState('')
  const generationRef = useRef('')
  const viewSequence = useRef(0)
  const [initialized, setInitialized] = useState(!editor?.transferTarget && !initialView?.projectId)
  const initializedRef = useRef(initialized); initializedRef.current = initialized
  const mirrorSessionRef = useRef<{ projectId: string; sessionId: string } | null>(null)
  const clientRef = useRef<CanvasEditorFrameClient | null>(null)
  const statusRef = useRef(status); statusRef.current = status
  const wasFrozen = useRef(Boolean(editor?.frozen))
  useEffect(() => {
    const client = new CanvasEditorFrameClient(editorKey, () => iframeRef.current?.contentWindow || null, window)
    clientRef.current = client
    return () => { client.dispose(); if (clientRef.current === client) clientRef.current = null }
  }, [editorKey, reloadKey])
  useEffect(() => {
    if (!editor?.registerTransferAdapter) return
    const client = (requireView = true) => { if (!clientRef.current || statusRef.current !== 'ready' || requireView && !initializedRef.current) throw new Error('CANVAS_NOT_READY: 请等待画布读取完成后重试'); return clientRef.current }
    const thaw = () => { void clientRef.current?.request('thaw').catch(error => console.warn('Canvas transfer thaw failed', error instanceof Error ? error.message : String(error))) }
    return editor.registerTransferAdapter({
      freeze: async () => { await client().request('freeze') },
      thaw,
      capture: async () => { const view = await client().request('flush'); if (!view) throw new Error('CANVAS_REVISION_NOT_READY: 画布没有返回持久句柄'); return view },
      hydrate: async state => { const view = parseCanvasEditorView(state); if (!view) throw new Error('CANVAS_TRANSFER_INVALID: 画布移交句柄格式无效'); await client(false).request('hydrate', view); initializedRef.current = true; setInitialized(true) },
      ready: () => statusRef.current === 'ready',
    })
  }, [editor?.registerTransferAdapter, status, reloadKey])
  useEffect(() => {
    if (status !== 'ready' || editor?.transferTarget || initialized) return
    const saved = parseCanvasEditorView(editorRef.current?.state)
    if (!saved) { initializedRef.current = true; setInitialized(true); return }
    let disposed = false
    void clientRef.current?.request('restore', saved).then(restored => {
      if (disposed) return
      if (restored) editorRef.current?.setState(restored)
      initializedRef.current = true; setInitialized(true)
    }).catch(error => { if (!disposed) { setStatus('error'); setError(error instanceof Error ? error.message : String(error)) } })
    return () => { disposed = true }
  }, [status, generation, editor?.transferTarget, editor?.state, initialized])
  useEffect(() => {
    if (status === 'ready' && initialized && !editor?.frozen && (wasFrozen.current || new URL(src).searchParams.get('editorFrozen') === '1')) void clientRef.current?.request('thaw').catch(error => console.warn('Canvas transfer thaw failed', error instanceof Error ? error.message : String(error)))
    wasFrozen.current = Boolean(editor?.frozen)
  }, [editor?.frozen, status, reloadKey, src, generation, initialized])

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = setTimeout(() => {
      setStatus(current => current === 'ready' ? current : 'error')
      setError(current => current || '无限画布入口在 10 秒内没有完成初始化，请检查旧进程、数据库和 API 桥接。')
    }, 10000)
    const onMessage = (event: MessageEvent) => {
      if (event.source !== iframeRef.current?.contentWindow) return
      if (event.data?.type === 'grimoire:canvas-ready') {
        if (event.data?.detail?.apiReady !== true || event.data?.detail?.hydrated !== true) {
          if (timer) clearTimeout(timer)
          timer = null
          setStatus('error')
          setError('无限画布发送了不完整的就绪状态，API 桥接或项目数据尚未确认完成。')
          return
        }
        if (timer) clearTimeout(timer)
        timer = null
        const nextGeneration = typeof event.data.detail.generationId === 'string' ? event.data.detail.generationId : 'legacy-' + reloadKey
        if (generationRef.current !== nextGeneration) {
          if (generationRef.current) { clientRef.current?.dispose(); clientRef.current = new CanvasEditorFrameClient(editorKey, () => iframeRef.current?.contentWindow || null, window) }
          generationRef.current = nextGeneration; viewSequence.current = 0; setGeneration(nextGeneration)
          const saved = parseCanvasEditorView(editorRef.current?.state)
          const readyView = !editorRef.current?.transferTarget && !saved?.projectId
          initializedRef.current = readyView; setInitialized(readyView)
        }
        setStatus('ready')
        setError('')
      }
      if (event.data?.type === 'grimoire:canvas-editor-view') {
        const view = parseCanvasEditorViewEvent(event.data)
        if (!view || view.editorKey !== editorKey || view.generationId !== generationRef.current || view.sequence <= viewSequence.current || !initializedRef.current || editorRef.current?.frozen) return
        viewSequence.current = view.sequence
        editorRef.current?.setState(view.state)
      }
      if (event.data?.type === 'grimoire:canvas-agent-mirror') {
        void mirrorCanvasAgentEvent(event.data, mirrorSessionRef)
      }
      if (event.data?.type === 'grimoire:canvas-error') {
        if (timer) clearTimeout(timer)
        timer = null
        setStatus('error')
        setError(String(event.data.message || '无限画布初始化失败'))
      }
    }
    window.addEventListener('message', onMessage)
    return () => {
      if (timer) clearTimeout(timer)
      window.removeEventListener('message', onMessage)
    }
  }, [reloadKey])

  const retry = () => {
    setStatus('loading')
    setError('')
    setReloadKey(value => value + 1)
  }

  return (
    <div className='relative h-full min-h-0 w-full overflow-hidden bg-[var(--color-bg-primary)]'>
      <iframe
        key={reloadKey}
        ref={iframeRef}
        title='无限画布工作台'
        src={src}
        onError={() => { setStatus('error'); setError('canvas.html 加载失败：' + src) }}
        className='block h-full min-h-0 w-full border-0 bg-[var(--color-bg-primary)]'
        allow='clipboard-read; clipboard-write'
      />
      {status === 'error' && (
        <div className='absolute inset-0 z-20 grid place-items-center bg-[var(--color-bg-primary)]/95 p-6'>
          <div className='w-full max-w-xl rounded-xl border border-red-400/30 bg-[var(--color-bg-secondary)] p-5 shadow-xl'>
            <div className='text-base font-semibold text-[var(--color-text-primary)]'>无限画布没有完成加载</div>
            <p className='mt-2 whitespace-pre-wrap text-sm leading-6 text-[var(--color-text-secondary)]'>{error}</p>
            <p className='mt-2 break-all text-xs text-[var(--color-text-secondary)]'>入口：{src}</p>
            <button type='button' onClick={retry} className='mt-4 rounded-md bg-[var(--color-accent-fill)] px-4 py-2 text-sm text-[var(--color-accent-foreground)]'>重新加载</button>
          </div>
        </div>
      )}
    </div>
  )
}

async function mirrorCanvasAgentEvent(data: { projectId?: string; kind?: 'message' | 'event'; payload?: Record<string, unknown> }, sessionRef: React.MutableRefObject<{ projectId: string; sessionId: string } | null>) {
  const projectId = String(data.projectId || 'unknown')
  if (!data.kind || !data.payload) return
  try {
    if (!sessionRef.current || sessionRef.current.projectId !== projectId) {
      const activeSessionId = useUnifiedAgentStore.getState().activeSessionId
      const active = activeSessionId ? await window.api.ai.sessions.get(activeSessionId).catch(() => null) : null
      const existing = await window.api.ai.sessions.list({ kind: 'canvas', limit: 100 })
      const match = active?.session || existing.find(item => item.metadata?.projectId === projectId)
      const session = match || await window.api.ai.sessions.create({ kind: 'canvas', runtime: 'codex', title: '画布 Agent · ' + projectId, metadata: { projectId, source: 'vendor-agent' } })
      sessionRef.current = { projectId, sessionId: session.id }
      useUnifiedAgentStore.getState().setActiveSessionId(session.id)
    }
    const sessionId = sessionRef.current.sessionId
    if (data.kind === 'message') {
      const payload = data.payload
      const role = payload.role === 'user' || payload.role === 'tool' || payload.role === 'system' ? payload.role : 'assistant'
      await window.api.ai.sessions.appendMessage({ sessionId, role, content: { text: String(payload.text || ''), title: payload.title }, attachments: Array.isArray(payload.attachments) ? payload.attachments : [] })
    } else {
      await window.api.ai.sessions.appendEvent({ sessionId, eventType: String(data.payload.eventType || 'canvas-agent-event'), payload: data.payload })
    }
  } catch {
    // Mirroring must never interrupt the Vendor Agent's real-time canvas flow.
  }
}
