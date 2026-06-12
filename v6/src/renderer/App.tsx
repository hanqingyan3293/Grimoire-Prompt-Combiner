import React, { useEffect, useState, useCallback } from 'react'
import { I18nProvider, useI18n } from './i18n/context'
import { useSettingsStore } from './stores/settings.store'
import { useTagsStore } from './stores/tags.store'
import { usePromptsStore } from './stores/prompts.store'
import { useGlobalShortcuts } from './hooks/useGlobalShortcuts'
import OptionsBar from './components/layout/OptionsBar'
import Sidebar from './components/layout/Sidebar'
import MainContent from './components/layout/MainContent'
import PanelSystem from './components/layout/PanelSystem'
import StatusBar from './components/layout/StatusBar'

type WorkspaceMode = 'default' | 'compact' | 'wide-canvas'

function AppInner() {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [toast, setToast] = useState<{ message: string; type: string } | null>(null)
  const [workspace, setWorkspace] = useState<WorkspaceMode>('default')
  const [rightCollapsed, setRightCollapsed] = useState(false)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [activePanelTab, setActivePanelTab] = useState<string>('prompt')

  const { t } = useI18n()
  const theme = useSettingsStore(s => s.theme)
  const fontSize = useSettingsStore(s => s.fontSize) || '14'
  const customAccent = useSettingsStore(s => s.customAccent)
  const loadSettings = useSettingsStore(s => s.loadSettings)
  const loadTags = useTagsStore(s => s.loadTags)

  useGlobalShortcuts()

  const showToast = useCallback((message: string, type: string = 'info') => {
    setToast({ message, type }); setTimeout(() => setToast(null), 2500)
  }, [])

  useEffect(() => {
    loadSettings().then(() => loadTags()).catch(e => setError(e.message)).finally(() => setLoading(false))
  }, [])

  const handleWorkspaceChange = (mode: WorkspaceMode) => {
    setWorkspace(mode)
    if (mode === 'compact') { setSidebarCollapsed(true); setRightCollapsed(false) }
    else if (mode === 'wide-canvas') { setSidebarCollapsed(false); setRightCollapsed(false) }
    else { setSidebarCollapsed(false); setRightCollapsed(false) }
  }

  const handleOpenSettings = () => {
    setActivePanelTab('settings')
    if (rightCollapsed) setRightCollapsed(false)
  }

  // Menu event handler
  useEffect(() => {
    const cleanup = window.electronAPI.onMenuEvent(async (eventName: string) => {
      switch (eventName) {
        case 'menu:import-tags': {
          const result = await window.electronAPI.tags.importTags()
          if (result.ok) {
            showToast(`导入成功: ${result.imported} 个标签`)
            loadTags()
          } else if (!result.canceled) {
            showToast(`导入失败: ${result.error}`, 'error')
          }
          break
        }
        case 'menu:export-tags': {
          const result = await window.electronAPI.tags.exportTags()
          if (result.ok) {
            showToast(`导出成功: ${result.count} 个标签 → ${result.path}`)
          } else if (!result.canceled) {
            showToast(`导出失败: ${result.error}`, 'error')
          }
          break
        }
        case 'menu:import-presets': {
          try {
            const result = await window.electronAPI.presets.import(null)
            if (result?.ok) showToast('预设导入成功')
          } catch { showToast('预设导入需要选择JSON文件', 'info') }
          break
        }
        case 'menu:export-presets': {
          try {
            const result = await window.electronAPI.presets.export('all')
            if (result?.ok) showToast('预设导出成功')
          } catch { showToast('预设导出功能开发中', 'info') }
          break
        }
        case 'menu:select-all':
          document.dispatchEvent(new CustomEvent('tag:select-all'))
          break
        case 'menu:clear-page':
          document.dispatchEvent(new CustomEvent('tag:clear-page'))
          break
        case 'menu:clear-all':
          document.dispatchEvent(new CustomEvent('tag:clear-all'))
          break
        case 'menu:workspace-default':
          handleWorkspaceChange('default')
          break
        case 'menu:workspace-compact':
          handleWorkspaceChange('compact')
          break
        case 'menu:workspace-wide':
          handleWorkspaceChange('wide-canvas')
          break
        case 'menu:toggle-right-panel':
          setRightCollapsed(v => !v)
          break
        case 'menu:toggle-sidebar':
          setSidebarCollapsed(v => !v)
          break
        case 'menu:shortcuts':
          showToast('快捷键: Ctrl+1/2/3 切换布局 | Ctrl+B 右侧面板 | Ctrl+L 左侧栏 | Ctrl+I/E 导入/导出', 'info')
          break
      }
    })
    return cleanup
  }, [])

  const accentOverride = customAccent && customAccent !== '#4b9cd3'
    ? (() => {
        const r = parseInt(customAccent.slice(1,3), 16); const g = parseInt(customAccent.slice(3,5), 16); const b = parseInt(customAccent.slice(5,7), 16)
        const toHex = (v: number) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2,'0')
        return {
          '--ps-accent': customAccent, '--ps-accent-hover': '#' + toHex(r+20) + toHex(g+20) + toHex(b+20),
          '--color-accent': customAccent, '--color-accent-hover': '#' + toHex(r+20) + toHex(g+20) + toHex(b+20),
          '--color-accent-bg': '#' + toHex(r*0.12) + toHex(g*0.12) + toHex(b*0.12),
          '--color-tag-bg': '#' + toHex(r*0.10) + toHex(g*0.10) + toHex(b*0.10),
          '--color-tag-border': '#' + toHex(r*0.25) + toHex(g*0.25) + toHex(b*0.25),
        } as React.CSSProperties
      })() : {}

  if (loading) return (
    <div className="app-shell flex-center" data-theme={theme} style={{ fontSize: fontSize+'px', ...accentOverride }}>
      <div style={{ textAlign: 'center' }}>
        <div style={{ fontSize: 48, marginBottom: 16 }}>📖</div>
        <div style={{ color: 'var(--color-text-secondary)' }}>{t('app.loading')}</div>
      </div>
    </div>
  )

  if (error) return (
    <div className="app-shell flex-center" data-theme={theme} style={{ fontSize: fontSize+'px', ...accentOverride }}>
      <div style={{ textAlign: 'center', padding: 32, background: 'var(--color-bg-secondary)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-lg)' }}>
        <div style={{ fontSize: 40, marginBottom: 12 }}>⚠</div>
        <div style={{ color: 'var(--color-danger)', marginBottom: 8, fontSize: 14 }}>{t('app.error')}</div>
        <div style={{ color: 'var(--color-text-secondary)', marginBottom: 16 }}>{error}</div>
        <button onClick={() => window.location.reload()} className="ps-btn ps-btn--primary">{t('app.retry')}</button>
      </div>
    </div>
  )

  return (
    <div className="app-shell" data-theme={theme} style={{ fontSize: fontSize+'px', ...accentOverride }}>
      <OptionsBar
        workspace={workspace}
        setWorkspace={handleWorkspaceChange}
        rightPanelCollapsed={rightCollapsed}
        onToggleRightPanel={() => setRightCollapsed(!rightCollapsed)}
        sidebarCollapsed={sidebarCollapsed}
        onToggleSidebar={() => setSidebarCollapsed(!sidebarCollapsed)}
        onOpenSettings={handleOpenSettings}
      />

      <div className="app-workspace">
        {!sidebarCollapsed && <Sidebar />}
        <MainContent />
        {!rightCollapsed && (
          <PanelSystem
            showToast={showToast}
            activeTab={activePanelTab}
            onTabChange={setActivePanelTab}
            collapsed={rightCollapsed}
            onToggleCollapse={() => setRightCollapsed(!rightCollapsed)}
          />
        )}
      </div>

      <StatusBar />
      {toast && (
        <div className="ps-toast" style={{
          position: 'fixed', bottom: 32, right: 32,
          background: 'var(--color-bg-elevated)',
          color: 'var(--color-text-primary)',
          padding: '8px 16px', borderRadius: 'var(--radius-md)',
          fontSize: 'var(--font-size-ui)',
          border: '1px solid var(--color-border)',
          boxShadow: '0 4px 16px rgba(0,0,0,0.3)',
          zIndex: 9998, maxWidth: 400,
        }}>
          {toast.message}
        </div>
      )}
    </div>
  )
}

export default function App() {
  return <I18nProvider><AppInner /></I18nProvider>
}
