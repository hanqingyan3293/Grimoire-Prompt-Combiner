import React, { useEffect } from 'react'
import { createRoot } from 'react-dom/client'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import 'antd/dist/reset.css'
import 'streamdown/styles.css'
import './canvas-vendor/styles/globals.css'
import { AppProviders } from './canvas-vendor/components/layout/app-providers'
import CanvasPage from './canvas-vendor/pages/canvas'
import CanvasProjectPage from './canvas-vendor/pages/canvas/project'
import './canvas-vendor/i18n'
import { registerBuiltinNodes } from './canvas-vendor/components/canvas/nodes/builtin-nodes'
import { registerBundledCanvasPlugins } from './canvas-vendor-plugins'
import { useCanvasStore } from './canvas-vendor/stores/canvas/use-canvas-store'
import { getCanvasBootstrapState } from '@shared/canvas-bootstrap'
import { useAgentStore } from './canvas-vendor/stores/use-agent-store'
import { AgentPanel } from './canvas-vendor/components/agent/agent-panel'

if (!window.api && window.parent !== window && window.parent.api) {
  Object.defineProperty(window, 'api', { value: window.parent.api, configurable: false, writable: false })
}
window.dispatchEvent(new CustomEvent('grimoire:canvas-mounted'))

registerBuiltinNodes()
registerBundledCanvasPlugins()

// The agent overlay must live INSIDE the router: `LocalAgentPanel` calls `useLocation()`, and rendering
// it as a sibling of `<RouterProvider>` threw on mount, unmounting the whole canvas tree — the panel was
// simply blank with no error shown (found by the visual matrix).
// A crash used to unmount the whole canvas and leave a blank white frame with no message. An error
// boundary turns that into something the user (and a screenshot) can see.
class CanvasErrorBoundary extends React.Component<{ children: React.ReactNode }, { message: string | null }> {
  state = { message: null as string | null }
  static getDerivedStateFromError(error: unknown) {
    return { message: error instanceof Error ? error.message : String(error) }
  }
  render() {
    if (this.state.message === null) return this.props.children
    return (
      <main className="grid h-full min-h-0 place-items-center bg-background p-6 text-foreground">
        <section className="w-full max-w-xl rounded-xl border border-red-400/30 bg-card p-5 shadow-xl">
          <h1 className="text-base font-semibold">无限画布渲染失败</h1>
          <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-muted-foreground">{this.state.message}</p>
          <button type="button" className="mt-3 rounded-md border px-3 py-1.5 text-sm" onClick={() => window.location.reload()}>重新加载</button>
        </section>
      </main>
    )
  }
}

function CanvasSurface({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative h-full min-h-0 w-full overflow-hidden">
      {children}
      <div className="pointer-events-none absolute inset-y-0 right-0 z-[70] flex justify-end">
        <div className="pointer-events-auto h-full"><AgentPanel /></div>
      </div>
    </div>
  )
}

const router = createMemoryRouter([
  { path: '/', element: <CanvasSurface><CanvasPage /></CanvasSurface> },
  { path: '/canvas', element: <CanvasSurface><CanvasPage /></CanvasSurface> },
  { path: '/canvas/:id', element: <CanvasSurface><CanvasProjectPage /></CanvasSurface> },
], { initialEntries: ['/canvas?mode=recent'] })

document.documentElement.classList.add('grimoire-canvas-vendor')
document.documentElement.style.height = '100%'
document.body.style.height = '100%'
document.body.style.margin = '0'
document.body.style.fontFamily = 'var(--font-ui, "Microsoft YaHei", sans-serif)'

function CanvasBootGate() {
  const hydrated = useCanvasStore(state => state.hydrated)
  const hydrationError = useCanvasStore(state => state.hydrationError)
  const retryHydration = useCanvasStore(state => state.retryHydration)
  const apiReady = Boolean(window.api?.canvas?.vendor)
  const bootstrapState = getCanvasBootstrapState({ apiReady, hydrated, hydrationError })
  const agentPanelOpen = useAgentStore(state => state.panelOpen)
  const activeProjectId = useAgentStore(state => state.canvasContext?.snapshot.projectId || '')

  useEffect(() => {
    const targetOrigin = window.location.protocol === 'file:' ? '*' : window.location.origin
    if (bootstrapState === 'api-error') {
      window.parent?.postMessage({ type: 'grimoire:canvas-error', code: 'API_BRIDGE_MISSING', message: '无限画布 API 桥接未就绪。请确认主应用已经加载 preload，再重新加载画布。' }, targetOrigin)
      return
    }
    if (bootstrapState === 'hydration-error') {
      window.parent?.postMessage({ type: 'grimoire:canvas-error', code: 'CANVAS_HYDRATION_FAILED', message: hydrationError }, targetOrigin)
      return
    }
    if (bootstrapState !== 'ready') return
    const frame = requestAnimationFrame(() => {
      window.parent?.postMessage({ type: 'grimoire:canvas-ready', detail: { apiReady: true, hydrated: true } }, targetOrigin)
    })
    return () => cancelAnimationFrame(frame)
  }, [bootstrapState, hydrationError])

  useEffect(() => {
    const targetOrigin = window.location.protocol === 'file:' ? '*' : window.location.origin
    window.parent?.postMessage({ type: 'grimoire:canvas-agent-state', open: agentPanelOpen, projectId: activeProjectId }, targetOrigin)
  }, [agentPanelOpen, activeProjectId])

  if (bootstrapState === 'api-error' || bootstrapState === 'hydration-error') {
    return (
      <main className="grid h-full min-h-0 place-items-center bg-background p-6 text-foreground">
        <section className="w-full max-w-xl rounded-xl border border-red-400/30 bg-card p-5 shadow-xl">
          <h1 className="text-base font-semibold">无限画布启动失败</h1>
          <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-muted-foreground">
            {bootstrapState === 'api-error' ? '无限画布 API 桥接未就绪。请确认主应用已加载 preload。' : hydrationError}
          </p>
          {hydrationError ? <button type="button" className="mt-3 rounded-md border px-3 py-1.5 text-sm" onClick={() => void retryHydration()}>重试读取画布项目</button> : null}
        </section>
      </main>
    )
  }
  if (bootstrapState === 'loading') return <main className="grid h-full min-h-0 place-items-center bg-background text-sm text-muted-foreground">正在读取画布项目…</main>
  return (
    <div className="relative h-full min-h-0 w-full overflow-hidden">
      <RouterProvider router={router} />
    </div>
  )
}

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <CanvasErrorBoundary><AppProviders><CanvasBootGate /></AppProviders></CanvasErrorBoundary>
  </React.StrictMode>,
)
