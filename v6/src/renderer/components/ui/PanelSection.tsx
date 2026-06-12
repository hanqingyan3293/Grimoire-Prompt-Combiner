import React, { useState } from 'react'

interface PanelSectionProps {
  title: string
  badge?: string
  defaultOpen?: boolean
  children: React.ReactNode
}

const PanelSection: React.FC<PanelSectionProps> = ({ title, badge, defaultOpen = true, children }) => {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div className={'ps-section' + (open ? '' : ' ps-section--collapsed')}>
      <div className="ps-section__header" onClick={() => setOpen(!open)} title={open ? 'Collapse' : 'Expand'}>
        <span className="ps-section__arrow">{open ? '▼' : '▶'}</span>
        <span className="ps-section__title">{title}</span>
        {badge !== undefined && <span className="ps-section__badge">{badge}</span>}
      </div>
      <div className="ps-section__content" style={{ maxHeight: open ? '9999px' : '0' }}>
        {children}
      </div>
    </div>
  )
}

export default PanelSection