import React, { useEffect, useMemo, useRef, useState } from 'react'

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
