import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './index.css'
import './styles/tokens.css'

const ThemePreview = React.lazy(() => import('./components/dev/ThemePreview').then(module => ({ default: module.ThemePreview })))
const SelectionAssistantView = React.lazy(() => import('./components/selection/SelectionAssistantView').then(module => ({ default: module.SelectionAssistantView })))

function reportRendererFailure(message: string, stack = '', context = '') {
  try {
    window.api?.error?.log(message, stack, context)
  } catch {
    // The renderer may fail before the preload bridge is ready.
  }
}

window.addEventListener('error', event => {
  reportRendererFailure(
    'Renderer error: ' + (event.message || event.error?.message || 'unknown'),
    event.error?.stack || '',
    event.filename ? 'source=' + event.filename + ':' + event.lineno + ':' + event.colno : '',
  )
})
window.addEventListener('unhandledrejection', event => {
  const reason = event.reason
  reportRendererFailure(
    'Unhandled renderer rejection: ' + (reason instanceof Error ? reason.message : String(reason)),
    reason instanceof Error ? reason.stack || '' : '',
  )
})

// 首帧上报：双 rAF 之后才是「真的画出来了」，比 DOMContentLoaded 更接近用户感知。
// 只上报一次；失败不影响任何功能（打点是诊断用的）。
requestAnimationFrame(() => {
  try {
    const fcp = performance.getEntriesByType('paint').find((entry) => entry.name === 'first-contentful-paint')
    const paintMs = Math.round(fcp?.startTime ?? performance.now())
    void window.api?.boot?.painted({ timeOrigin: Math.round(performance.timeOrigin), paintMs })?.catch?.(() => {})
  } catch {
    // 桥未就绪时忽略
  }
})

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    {window.location.hash.startsWith('#selection-assistant')
      ? <React.Suspense fallback={<div className='flex h-screen items-center justify-center text-sm'>正在载入划词助手</div>}><SelectionAssistantView /></React.Suspense>
      : window.location.hash.startsWith('#theme-preview')
      ? <React.Suspense fallback={<div className='flex h-screen items-center justify-center text-sm text-[var(--color-text-secondary)]'>正在载入视觉验收页</div>}><ThemePreview /></React.Suspense>
      : <App />}
  </React.StrictMode>
)
