import React, { useEffect, useMemo, useRef, useState } from 'react'
import { useUnifiedAgentStore } from '../../stores/unified-agent.store'

function canvasEntryUrl() {
  if (window.location.protocol === 'file:') return new URL('../canvas.html', import.meta.url).toString()
  return window.location.origin + '/canvas.html'
}

type CanvasFrameStatus = 'loading' | 'ready' | 'error'

export function CanvasVendorPanel() {
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const src = useMemo(canvasEntryUrl, [])
  const [status, setStatus] = useState<CanvasFrameStatus>('loading')
  const [error, setError] = useState('')
  const [reloadKey, setReloadKey] = useState(0)
  const mirrorSessionRef = useRef<{ projectId: string; sessionId: string } | null>(null)

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
        setStatus('ready')
        setError('')
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
