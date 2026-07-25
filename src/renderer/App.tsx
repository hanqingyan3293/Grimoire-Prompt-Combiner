// 魔导书 Grimoire v7 — App 根组件
import React, { useEffect, useState } from 'react'
import { I18nProvider } from './i18n/context'
import { useTagsStore } from './stores/tags.store'
import { useSettingsStore } from './stores/settings.store'
import { useI18n } from './i18n/context'
import { StatusBar } from './components/layout/StatusBar'
import { Toast } from './components/ui/Toast'
import { ErrorBoundary } from './components/ui/ErrorBoundary'
import { SettingsWindow } from './components/settings/SettingsWindow'
import { AIWindow } from './components/ai/AIWindow'
import { FixedWorkspace } from './components/workspace/FixedWorkspace'
import { WorkspaceBar } from './components/workspace/WorkspaceBar'
import './styles/themes.css'

function AppInner() {
  const [windowType, setWindowType] = useState<string>(window.location.hash.replace("#", "") || "main")
  const { lang, setLang } = useI18n()
  const loadTags = useTagsStore(s => s.loadTags)
  const { loadSettings, language } = useSettingsStore()
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' | 'info' } | null>(null)

  useEffect(() => {
    const onHashChange = () => setWindowType(window.location.hash.replace("#", "") || "main")
    window.addEventListener("hashchange", onHashChange)
    return () => window.removeEventListener("hashchange", onHashChange)
  }, [])
  useEffect(() => { loadSettings(); loadTags() }, [loadSettings, loadTags])
  useEffect(() => { if (language !== lang) setLang(language as 'zh' | 'en') }, [language])

  useEffect(() => {
    const handler = (e: Event) => {
      const ce = e as CustomEvent<{ message: string; type: 'success' | 'error' | 'info' }>
      setToast(ce.detail); setTimeout(() => setToast(null), 3000)
    }
    window.addEventListener('grimoire:toast', handler); return () => window.removeEventListener('grimoire:toast', handler)
  }, [])

  // Window focus -> refresh stores for cross-window sync
  useEffect(() => {
    let cleanup = null
    try {
      cleanup = window.api.db.onFocus(() => {
        loadSettings().catch(() => {})
        window.dispatchEvent(new CustomEvent('grimoire:refresh'))
      })
    } catch {}
    return () => { if (cleanup) cleanup() }
  }, [loadSettings])

  // 跨窗口数据同步：监听主进程广播的 data:refresh
  useEffect(() => {
    let cleanup: (() => void) | null = null
    try {
      cleanup = window.api.db.onRefresh(() => {
        loadSettings().catch(() => {})
        window.dispatchEvent(new CustomEvent('grimoire:refresh'))
      })
    } catch {}
    return () => { if (cleanup) cleanup() }
  }, [loadSettings])

    // 设置独立窗口
  if (windowType === "settings") {
    return (
      <div className="flex flex-col h-screen overflow-hidden bg-[var(--color-bg-primary)]">
        <SettingsWindow onClose={() => window.close()} />
      </div>
    )
  }

  // AI 独立窗口
  if (windowType === "ai") {
    return (
      <div className="flex flex-col h-screen overflow-hidden bg-[var(--color-bg-primary)]">
        <AIWindow onClose={() => window.close()} />
      </div>
    )
  }

  return (
    <div className="flex flex-col h-screen overflow-hidden">
      <WorkspaceBar />
      <FixedWorkspace />
      <StatusBar />
      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
    </div>
  )
}

export default function App() {
  return (
    <ErrorBoundary>
      <I18nProvider initialLang="zh">
        <AppInner />
      </I18nProvider>
    </ErrorBoundary>
  )
}
