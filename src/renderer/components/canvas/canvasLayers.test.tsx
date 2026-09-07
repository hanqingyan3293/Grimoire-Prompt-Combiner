// @vitest-environment jsdom
import React from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { CanvasDocument, CanvasNode } from '../../../shared/canvas-types'
import { createTypedCanvasConnection } from '../../../shared/canvas-dataflow'
import { CanvasConnectionLayer } from './CanvasConnectionLayer'
import { CanvasNodePorts } from './CanvasNodePorts'

const asset: CanvasNode = { id: 'asset', kind: 'prompt-asset', title: 'Asset', content: 'solo', position: { x: 0, y: 0 }, width: 340, height: 220 }
const comfy: CanvasNode = { id: 'comfy', kind: 'comfyui', title: 'Comfy', content: '', position: { x: 500, y: 0 }, width: 340, height: 250 }

function linkedDocument(): CanvasDocument {
  const document: CanvasDocument = { version: 1, viewport: { x: 0, y: 0, scale: 1 }, nodes: [asset, comfy], connections: [] }
  return { ...document, connections: [createTypedCanvasConnection(document, 'asset', 'comfy', 'link').connection!] }
}

describe('canvas connection and port layers', () => {
  it('renders selectable Bezier connections and reports additive selection', () => {
    const onSelect = vi.fn()
    const { container } = render(<CanvasConnectionLayer document={linkedDocument()} selectedIds={new Set()} onSelect={onSelect} />)
    const group = container.querySelector('g')!
    expect(container.querySelectorAll('path')).toHaveLength(2)
    expect(container.querySelector('path')?.getAttribute('d')).toContain(' C ')
    fireEvent.pointerDown(group)
    expect(onSelect).toHaveBeenCalledWith('link', false)
  })

  it('enables input ports only during connect or reconnect and preserves labels at low zoom', () => {
    const onConnect = vi.fn()
    const { rerender } = render(<CanvasNodePorts node={comfy} scale={1} connectingFrom={null} reconnecting={false} onStart={() => {}} onConnect={onConnect} />)
    expect((screen.getByRole('button', { name: '输入 提示词 · prompt' }) as HTMLButtonElement).disabled).toBe(true)
    rerender(<CanvasNodePorts node={comfy} scale={0.5} connectingFrom={{ nodeId: 'asset', portId: 'prompt' }} reconnecting={false} onStart={() => {}} onConnect={onConnect} />)
    const input = screen.getByRole('button', { name: '输入 提示词 · prompt' })
    expect((input as HTMLButtonElement).disabled).toBe(false)
    expect(input.textContent).toBe('')
    fireEvent.click(input)
    expect(onConnect).toHaveBeenCalledWith('comfy', 'prompt')
  })
})
