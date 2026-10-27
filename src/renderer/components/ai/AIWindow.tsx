import { X } from 'lucide-react'
import { AgentWorkspacePanel } from './AgentWorkspacePanel'
import { IconButton } from '../ui/Button'
import { CherryHostProvider } from '../../services/cherry-host-provider'

export function AIWindow({ onClose }: { onClose: () => void }) {
  return (
    <div className="flex h-screen min-h-0 flex-col overflow-hidden bg-[var(--color-bg-primary)]">
      <div className="ui-app-chrome flex h-10 shrink-0 items-center justify-between border-b border-[var(--color-border)] px-3">
        <div className="text-sm font-semibold text-[var(--color-text-primary)]">Agent 工作台</div>
        <IconButton onClick={onClose} icon={X} label="关闭 Agent 窗口" className="ui-icon-button-danger" />
      </div>
      <CherryHostProvider><div className="min-h-0 flex-1 overflow-hidden"><AgentWorkspacePanel variant="workspace" /></div></CherryHostProvider>
    </div>
  )
}
