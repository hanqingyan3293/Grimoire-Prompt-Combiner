import './index.css'
import './tailwind.css'
import { createRoot } from 'react-dom/client'
import { prepareWindow } from '@renderer/windows/prepareWindow'
import MainApp from '@renderer/windows/main/MainApp'

// Authentic bootstrap and provider composition, including AppShell/TabsProvider/TabRouter.
// No compat hash registry or custom tabs UI. Requires real preload capabilities at runtime;
// a compilation artifact does not imply those backend/window capabilities are implemented.
async function bootstrap(): Promise<void> {
  await prepareWindow({ preference: 'all' })
  createRoot(document.getElementById('root')!).render(<MainApp />)
}
void bootstrap()
