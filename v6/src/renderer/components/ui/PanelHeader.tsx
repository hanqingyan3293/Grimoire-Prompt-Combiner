import React from 'react'

interface PanelHeaderProps {
  title: string
  badge?: string
  onCollapse?: () => void
  collapsed?: boolean
  children?: React.ReactNode
}

const PanelHeader: React.FC<PanelHeaderProps> = ({ title, badge, onCollapse, collapsed, children }) => (
  <div className="ps-panel-header">
    <div className="ps-panel-header__dots" title="Drag to move panel">
      <span className="ps-panel-header__dot" />
      <span className="ps-panel-header__dot" />
      <span className="ps-panel-header__dot" />
    </div>
    <span className="ps-panel-header__title">{title}</span>
    {badge && <span className="ps-section__badge">{badge}</span>}
    {children && <div className="ps-panel-header__actions">{children}</div>}
  </div>
)

export default PanelHeader