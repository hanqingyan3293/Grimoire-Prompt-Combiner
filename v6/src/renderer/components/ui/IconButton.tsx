import React from 'react'

interface IconButtonProps {
  icon: string
  title?: string
  active?: boolean
  onClick?: () => void
  className?: string
}

const IconButton: React.FC<IconButtonProps> = ({ icon, title, active, onClick, className }) => (
  <button
    className={'ps-icon-btn' + (active ? ' ps-icon-btn--active' : '') + (className ? ' ' + className : '')}
    title={title || ''}
    onClick={onClick}
    type="button"
  >
    {icon}
  </button>
)

export default IconButton