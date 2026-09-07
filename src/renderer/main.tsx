import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './index.css'

const ThemePreview = React.lazy(() => import('./components/dev/ThemePreview').then(module => ({ default: module.ThemePreview })))

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

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    {window.location.hash.startsWith('#theme-preview')
      ? <React.Suspense fallback={<div className='flex h-screen items-center justify-center text-sm text-[var(--color-text-secondary)]'>正在载入视觉验收页</div>}><ThemePreview /></React.Suspense>
      : <App />}
  </React.StrictMode>
)
