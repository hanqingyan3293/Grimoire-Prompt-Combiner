import React, { useEffect, useState } from 'react'
import { useSettingsStore } from './stores/settings.store'
import { useTagsStore } from './stores/tags.store'
import { useGlobalShortcuts } from './hooks/useGlobalShortcuts'
import Sidebar from './components/layout/Sidebar'
import MainContent from './components/layout/MainContent'
import RightPanel from './components/layout/RightPanel'
import ImagePanel from './components/images/ImagePanel'
import PresetsModal from './components/presets/PresetsModal'
import HistoryModal from './components/history/HistoryModal'
import SettingsModal from './components/settings/SettingsModal'
import Toast from './components/ui/Toast'

type ModalType = 'presets' | 'history' | 'settings' | null

export default function App() {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [activeModal, setActiveModal] = useState<ModalType>(null)
  const [toast, setToast] = useState<{ message: string; type: string } | null>(null)
  const [showImagePanel, setShowImagePanel] = useState(false)

  const theme = useSettingsStore(s => s.theme)
  const loadSettings = useSettingsStore(s => s.loadSettings)
  const loadTags = useTagsStore(s => s.loadTags)

  useGlobalShortcuts()

  const showToast = (message: string, type: string = 'info') => {
    setToast({ message, type })
    setTimeout(() => setToast(null), 3000)
  }

  useEffect(() => {
    const init = async () => {
      try {
        await loadSettings()
        await loadTags()
      } catch (e: any) {
        setError(e.message)
      } finally {
        setLoading(false)
      }
    }
    init()
  }, [])

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.key === 'h') { e.preventDefault(); setActiveModal(m => m === 'history' ? null : 'history') }
      if (e.ctrlKey && e.key === 'p') { e.preventDefault(); setActiveModal(m => m === 'presets' ? null : 'presets') }
      if (e.ctrlKey && e.key === ',') { e.preventDefault(); setActiveModal(m => m === 'settings' ? null : 'settings') }
      if (e.ctrlKey && e.key === 'i') { e.preventDefault(); setShowImagePanel(v => !v) }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center" data-theme={theme}>
        <div className="text-center">
          <div className="mb-4 text-4xl animate-bounce">📖</div>
          <p className="text-lg" style={{ color: 'var(--color-text-secondary)' }}>魔导书加载中...</p>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex h-full items-center justify-center" data-theme={theme}>
        <div className="text-center p-8 glass-panel">
          <div className="text-5xl mb-4">⚠️</div>
          <p className="text-lg mb-2" style={{ color: 'var(--color-danger)' }}>加载失败</p>
          <p className="mb-4" style={{ color: 'var(--color-text-secondary)' }}>{error}</p>
          <button onClick={() => window.location.reload()} className="btn btn-primary">重试</button>
        </div>
      </div>
    )
  }

  return (
    <div
      data-theme={theme}
      className="flex h-full"
      style={{
        backgroundColor: 'var(--color-bg-primary)',
        color: 'var(--color-text-primary)',
        transition: 'background-color 250ms ease, color 250ms ease'
      }}
    >
      <Sidebar onOpenModal={setActiveModal} />
      <MainContent />
      <RightPanel showToast={showToast} onOpenModal={setActiveModal} />
      
      <ImagePanel showToast={showToast} />

      {activeModal === 'presets' && <PresetsModal onClose={() => setActiveModal(null)} showToast={showToast} />}
      {activeModal === 'history' && <HistoryModal onClose={() => setActiveModal(null)} showToast={showToast} />}
      {activeModal === 'settings' && <SettingsModal onClose={() => setActiveModal(null)} showToast={showToast} />}

      {toast && <Toast message={toast.message} type={toast.type} />}
    </div>
  )
}