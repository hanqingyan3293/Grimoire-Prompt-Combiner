import React from 'react'
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

if (!window.api && window.parent !== window && window.parent.api) {
  Object.defineProperty(window, 'api', { value: window.parent.api, configurable: false, writable: false })
}

registerBuiltinNodes()
registerBundledCanvasPlugins()

const router = createMemoryRouter([
  { path: '/', element: <CanvasPage /> },
  { path: '/canvas', element: <CanvasPage /> },
  { path: '/canvas/:id', element: <CanvasProjectPage /> },
], { initialEntries: ['/canvas?mode=recent'] })

document.documentElement.classList.add('grimoire-canvas-vendor')
document.body.style.fontFamily = 'var(--font-ui, "Microsoft YaHei", sans-serif)'

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <AppProviders><RouterProvider router={router} /></AppProviders>
  </React.StrictMode>,
)
