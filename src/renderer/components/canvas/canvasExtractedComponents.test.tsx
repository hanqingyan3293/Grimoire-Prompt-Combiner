// @vitest-environment jsdom
import React, { createRef } from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { CanvasNode } from '../../../shared/canvas-types'
import { CanvasToolbar } from './CanvasToolbar'
import { CanvasNodeContent } from './CanvasNodeContent'

const noop = () => {}
const toolbarProps = {
  project: { id: 'p', name: '画布' }, projects: [{ id: 'p', name: '画布' }], renaming: false, nameDraft: '', interactionMode: 'select' as const, selectedNodeCount: 0, selectedConnectionCount: 1, selectedConnectionTyped: true, selectedHasGroup: false, selectedGroupId: null, selectedGroupTitle: '', groupTitleDraft: '', organizeOpen: false, canUndo: false, canRedo: false, message: '', importRef: createRef<HTMLInputElement>(),
  onSelectProject: noop, onStartRename: noop, onNameDraftChange: noop, onCommitRename: noop, onCancelRename: noop, onCreateProject: noop, onAddNode: noop, onExportCanvas: noop, onExportPackage: noop, onImportPackage: noop, onImportCanvas: noop, onInteractionMode: noop, onGroup: noop, onUngroup: noop, onGroupTitleChange: noop, onRenameGroup: noop, onOrganizeOpen: noop, onAlign: noop, onDistribute: noop, onSnap: noop, onUndo: noop, onRedo: noop, onPluginDiagnostics: noop, onConnectionDetails: noop, onSynchronize: noop, onReconnect: noop, onDelete: noop,
}

function contentProps(node: CanvasNode) {
  return { node, images: [], promptAssets: [], workflows: [], wd14Models: [], tasks: [], executing: false, onTextFocus: vi.fn(), onTextChange: vi.fn(), onTextBlur: vi.fn(), onPatch: vi.fn(), onApplyPrompt: vi.fn(), onBindImage: vi.fn(), onBindPromptAsset: vi.fn(), onApplyPromptAsset: vi.fn(), onBindWD14Image: vi.fn(), onBindWD14Model: vi.fn(), onCreateWD14: vi.fn(), onApplyWD14: vi.fn(), onBindComfyWorkflow: vi.fn(), onCreateComfy: vi.fn(), onAddResultImage: vi.fn(), onBindTask: vi.fn(), canApplyWD14: true, canImportComfyResult: true, onCapabilityDenied: vi.fn() }
}

describe('extracted canvas components', () => {
  it('shows single-connection commands and disables reconnect for legacy links', () => {
    const { rerender } = render(<CanvasToolbar {...toolbarProps} />)
    expect(screen.getByRole('button', { name: '连接详情' })).toBeTruthy()
    expect((screen.getByRole('button', { name: '重连目标' }) as HTMLButtonElement).disabled).toBe(false)
    rerender(<CanvasToolbar {...toolbarProps} selectedConnectionTyped={false} />)
    expect((screen.getByRole('button', { name: '重连目标' }) as HTMLButtonElement).disabled).toBe(true)
    rerender(<CanvasToolbar {...toolbarProps} selectedConnectionCount={2} />)
    expect(screen.queryByRole('button', { name: '连接详情' })).toBeNull()
    expect(screen.getByRole('button', { name: '删除连线 2' })).toBeTruthy()
  })

  it('routes prompt editing through callbacks and protects incomplete business nodes', () => {
    const prompt: CanvasNode = { id: 'prompt', kind: 'prompt', title: 'Prompt', content: 'solo', position: { x: 0, y: 0 }, width: 320, height: 210 }
    const promptProps = contentProps(prompt)
    const { rerender } = render(<CanvasNodeContent {...promptProps} />)
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'long hair' } })
    expect(promptProps.onTextChange).toHaveBeenCalledWith('prompt', 'long hair')

    const wd: CanvasNode = { ...prompt, id: 'wd', kind: 'wd14', content: '', config: { threshold: 0.35 } }
    const wdProps = contentProps(wd)
    rerender(<CanvasNodeContent {...wdProps} />)
    expect((screen.getByRole('button', { name: '创建反推任务' }) as HTMLButtonElement).disabled).toBe(true)

    const comfy: CanvasNode = { ...prompt, id: 'comfy', kind: 'comfyui', content: '' }
    const comfyProps = contentProps(comfy)
    rerender(<CanvasNodeContent {...comfyProps} />)
    expect((screen.getByRole('button', { name: '创建生成任务' }) as HTMLButtonElement).disabled).toBe(true)
  })
})
