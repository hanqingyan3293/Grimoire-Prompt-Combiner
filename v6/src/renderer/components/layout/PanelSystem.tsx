import React, { useState } from 'react'
import PanelTab from '../ui/PanelTab'
import IconButton from '../ui/IconButton'
import { useI18n } from '../../i18n/context'
import PromptPanel from '../panels/PromptPanel'
import HistoryPanel from '../panels/HistoryPanel'
import PresetsPanel from '../panels/PresetsPanel'
import ImagesPanel from '../panels/ImagesPanel'
import SettingsPanel from '../panels/SettingsPanel'
import AIPanel from '../panels/AIPanel'

type TabId = 'prompt' | 'history' | 'presets' | 'images' | 'ai' | 'settings'

interface PanelSystemProps {
  showToast: (msg: string, type?: string) => void
  activeTab?: TabId
  onTabChange?: (tab: TabId) => void
  collapsed?: boolean
  onToggleCollapse?: () => void
}

const PanelSystem: React.FC<PanelSystemProps> = ({
  showToast, activeTab: externalTab, onTabChange,
  collapsed, onToggleCollapse,
}) => {
  const { t } = useI18n()
  const [internalTab, setInternalTab] = useState<TabId>('prompt')
  const [selfCollapsed, setSelfCollapsed] = useState(false)

  const activeTab = externalTab || internalTab
  const isCollapsed = collapsed !== undefined ? collapsed : selfCollapsed
  const toggleCollapse = onToggleCollapse || (() => setSelfCollapsed(v => !v))

  const setTab = (tab: TabId) => {
    if (onTabChange) onTabChange(tab)
    else setInternalTab(tab)
  }

  const tabs: { id: TabId; icon: string }[] = [
    { id: 'prompt', icon: '📝' },
    { id: 'history', icon: '🕐' },
    { id: 'presets', icon: '💾' },
    { id: 'images', icon: '🖼' },
    { id: 'ai', icon: '🤖' },
    { id: 'settings', icon: '⚙' },
  ]

  const getTabLabel = (id: TabId) => {
    if (id === 'ai') return 'AI'
    if (id === 'settings') return t('right.settings')
    if (id === 'prompt') return t('panels.prompt.tab')
    if (id === 'history') return t('panels.history.tab')
    if (id === 'presets') return t('panels.presets.tab')
    if (id === 'images') return t('panels.images.tab')
    return ''
  }

  const renderContent = () => {
    switch (activeTab) {
      case 'prompt': return <PromptPanel showToast={showToast} />
      case 'history': return <HistoryPanel showToast={showToast} />
      case 'presets': return <PresetsPanel showToast={showToast} />
      case 'images': return <ImagesPanel showToast={showToast} />
      case 'ai': return <AIPanel showToast={showToast} />
      case 'settings': return <SettingsPanel showToast={showToast} />
      default: return null
    }
  }

  if (isCollapsed) {
    return (
      <div className="right-panel right-panel--collapsed ps-panel" style={{
        width: 40, flexShrink: 0, display: 'flex', flexDirection: 'column',
        alignItems: 'center', padding: '4px 0', gap: 2,
        borderLeft: '1px solid var(--color-border)',
      }}>
        <button onClick={toggleCollapse} className="ps-icon-btn"
          title={t('panel.expand')} style={{ marginBottom: 4 }}>
          ◀
        </button>
        {tabs.map(tb => (
          <button
            key={tb.id}
            onClick={() => { setTab(tb.id); toggleCollapse() }}
            title={getTabLabel(tb.id)}
            className={'ps-icon-btn' + (activeTab === tb.id ? ' ps-icon-btn--active' : '')}
            style={{ fontSize: 14, width: 32, height: 28 }}
          >
            {tb.icon}
          </button>
        ))}
      </div>
    )
  }

  return (
    <div className="right-panel ps-panel" style={{
      display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden',
    }}>
      <div className="ps-tab-bar" style={{
        display: 'flex', alignItems: 'center', height: 32,
        borderBottom: '1px solid var(--color-border)',
        flexShrink: 0, paddingRight: 4,
      }}>
        {tabs.map(tb => (
          <PanelTab
            key={tb.id}
            icon={tb.icon}
            label={getTabLabel(tb.id)}
            active={activeTab === tb.id}
            onClick={() => setTab(tb.id)}
          />
        ))}
        <div style={{ flex: 1 }} />
        <button onClick={toggleCollapse} className="ps-icon-btn" title={t('panel.collapse')}>
          ▶
        </button>
      </div>

      <div className="panel-content" style={{ flex: 1, overflow: 'auto', position: 'relative' }}>
        {renderContent()}
      </div>
    </div>
  )
}

export default PanelSystem
