import React from 'react'

interface PanelTabProps {
  icon: string
  label: string
  active: boolean
  onClick: () => void
  title?: string
}

const PanelTab: React.FC<PanelTabProps> = ({ icon, label, active, onClick, title }) => (
  <button
    className={'ps-tab' + (active ? ' ps-tab--active' : '')}
    onClick={onClick}
    title={title || label}
    type="button"
  >
    <span className="ps-tab__icon">{icon}</span>
    <span className="ps-tab__label">{label}</span>
  </button>
)

export default PanelTab