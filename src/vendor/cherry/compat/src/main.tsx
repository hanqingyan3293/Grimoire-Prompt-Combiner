import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import CherryChatShellEntry from './cherry-chat-shell-entry'
import { initI18n } from '../../source/src/renderer/i18n/resolver'
// Same two stylesheets, same order as the source window entry
// (`source/src/renderer/windows/main/entryPoint.tsx`). They stay separate modules:
// concatenating them puts `@import` after rule blocks, which is invalid CSS.
import './index.css'
import './tailwind.css'
import { startThemeBridge } from './theme-bridge'

// Follow the Grimoire theme (light/dark + accent) before the first paint of the shell.
startThemeBridge()

// Source contract: every window entry awaits initI18n() before rendering because
// translation packs load asynchronously. When the Grimoire preload has no
// preference API, the resolver falls back to the default language instead of
// rejecting, so the compat window still renders with real Cherry labels.
void initI18n().finally(() => {
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <CherryChatShellEntry />
    </StrictMode>
  )
})
