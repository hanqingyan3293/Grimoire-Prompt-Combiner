import React from 'react'

interface PanelProps {
  children: React.ReactNode
  collapsed?: boolean
  className?: string
}

const Panel: React.FC<PanelProps> = ({ children, collapsed, className }) => (
  <div className={'ps-panel' + (collapsed ? ' ps-panel--collapsed' : '') + (className ? ' ' + className : '')}>
    {children}
  </div>
)

export default Panel