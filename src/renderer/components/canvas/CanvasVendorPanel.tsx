import React, { useMemo } from 'react'

function canvasEntryUrl() {
  if (window.location.protocol === 'file:') return new URL('../canvas.html', import.meta.url).toString()
  return `${window.location.origin}/canvas.html`
}

/** Full basketikun/infinite-canvas workbench, isolated from the host layout CSS. */
export function CanvasVendorPanel() {
  const src = useMemo(canvasEntryUrl, [])
  return (
    <iframe
      title='无限画布工作台'
      src={src}
      className='block h-full min-h-0 w-full border-0 bg-[var(--color-bg-primary)] p-[2px]'
      allow='clipboard-read; clipboard-write'
    />
  )
}
