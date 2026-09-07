import React from 'react'
import type { CanvasNode } from '../../../shared/canvas-types'
import { getCanvasNodePorts } from '../../../shared/canvas-dataflow'

interface Props {
  node: CanvasNode
  scale: number
  connectingFrom: { nodeId: string; portId: string } | null
  reconnecting: boolean
  onStart: (nodeId: string, portId: string) => void
  onConnect: (nodeId: string, portId: string) => void
}

function portTop(node: CanvasNode, direction: 'input' | 'output', portId: string, scale: number): number {
  const ports = getCanvasNodePorts(node.kind, direction)
  const index = ports.findIndex(port => port.id === portId)
  return (32 + Math.max(24, node.height - 40) * ((index + 1) / (ports.length + 1))) * scale
}

function color(dataType: string): string {
  return dataType === 'image' ? '#0ea5e9' : dataType === 'tags' ? '#ec4899' : 'var(--color-accent)'
}

export function CanvasNodePorts({ node, scale, connectingFrom, reconnecting, onStart, onConnect }: Props) {
  return (
    <>
      {getCanvasNodePorts(node.kind, 'input').map(port => (
        <button key={port.id} onPointerDown={event => event.stopPropagation()} onClick={() => onConnect(node.id, port.id)} disabled={!connectingFrom && !reconnecting}
          className='absolute -left-2 z-50 flex h-5 min-w-5 -translate-y-1/2 items-center gap-1 rounded-full border border-[var(--color-border-strong)] bg-[var(--color-bg-secondary)] px-1 text-[9px] text-[var(--color-text-secondary)] shadow-sm disabled:opacity-45'
          style={{ top: `${portTop(node, 'input', port.id, scale)}px` }} title={`输入 ${port.label} · ${port.dataType}`} aria-label={`输入 ${port.label} · ${port.dataType}`}>
          <span className='h-2 w-2 flex-none rounded-full' style={{ background: color(port.dataType) }} aria-hidden='true' />
          {scale >= 0.65 && <span>{port.label}</span>}
        </button>
      ))}
      {getCanvasNodePorts(node.kind, 'output').map(port => (
        <button key={port.id} onPointerDown={event => event.stopPropagation()} onClick={() => onStart(node.id, port.id)}
          className={'absolute -right-2 z-50 flex h-5 min-w-5 -translate-y-1/2 items-center gap-1 rounded-full border border-[var(--color-border-strong)] bg-[var(--color-bg-secondary)] px-1 text-[9px] text-[var(--color-text-secondary)] shadow-sm ' + (connectingFrom?.nodeId === node.id && connectingFrom.portId === port.id ? 'ring-2 ring-[var(--color-accent)]' : '')}
          style={{ top: `${portTop(node, 'output', port.id, scale)}px` }} title={`输出 ${port.label} · ${port.dataType}`} aria-label={`输出 ${port.label} · ${port.dataType}`}>
          {scale >= 0.65 && <span>{port.label}</span>}
          <span className='h-2 w-2 flex-none rounded-full' style={{ background: color(port.dataType) }} aria-hidden='true' />
        </button>
      ))}
    </>
  )
}
