import React from 'react'
import type { CanvasDocument } from '../../../shared/canvas-types'
import { createCanvasConnectionPath, getCanvasPortAnchor } from '../../../shared/canvas-dataflow'

interface Props {
  document: CanvasDocument
  selectedIds: Set<string>
  onSelect: (id: string, additive: boolean) => void
}

export function CanvasConnectionLayer({ document, selectedIds, onSelect }: Props) {
  const { viewport } = document
  return (
    <svg className='pointer-events-none absolute inset-0 z-10 h-full w-full' aria-label='画布连接层'>
      {document.connections.map(connection => {
        const from = document.nodes.find(node => node.id === connection.fromNodeId)
        const to = document.nodes.find(node => node.id === connection.toNodeId)
        if (!from || !to) return null
        const fromAnchor = connection.fromPort ? getCanvasPortAnchor(from, connection.fromPort) : { x: from.position.x + from.width / 2, y: from.position.y + from.height / 2 }
        const toAnchor = connection.toPort ? getCanvasPortAnchor(to, connection.toPort) : { x: to.position.x + to.width / 2, y: to.position.y + to.height / 2 }
        if (!fromAnchor || !toAnchor) return null
        const path = createCanvasConnectionPath(
          { x: fromAnchor.x * viewport.scale + viewport.x, y: fromAnchor.y * viewport.scale + viewport.y },
          { x: toAnchor.x * viewport.scale + viewport.x, y: toAnchor.y * viewport.scale + viewport.y },
        )
        const stroke = connection.dataType === 'image' ? '#0ea5e9' : connection.dataType === 'tags' ? '#ec4899' : connection.dataType === 'prompt' ? 'var(--color-accent)' : 'var(--color-border-strong)'
        const selected = selectedIds.has(connection.id)
        return (
          <g key={connection.id} className='pointer-events-auto cursor-pointer' onPointerDown={event => { event.stopPropagation(); onSelect(connection.id, Boolean(event.ctrlKey || event.metaKey || event.shiftKey)) }}>
            <title>{connection.dataType ? `${from.title}.${connection.fromPort} -> ${to.title}.${connection.toPort} · ${connection.dataType}` : `${from.title} -> ${to.title} · 旧式视觉连接`}</title>
            <path d={path} fill='none' stroke='transparent' strokeWidth='16' />
            <path d={path} fill='none' stroke={selected ? 'var(--color-warning)' : stroke} strokeWidth={selected ? '4' : '2'} strokeDasharray={connection.dataType ? undefined : '6 5'} />
          </g>
        )
      })}
    </svg>
  )
}
