import React from 'react'
import type { CanvasNode } from '../../../shared/canvas-types'
import type { PromptAssetItem } from '../../../shared/prompt-asset-types'
import type { ImageRef } from '../../../shared/types'
import type { TaskRecord } from '../../../shared/task-types'
import type { CanvasWorkflowDefinition } from './businessNodeRuntime'

export interface CanvasWD14Model { id: string; name: string; hasCsv: boolean }

interface Props {
  node: CanvasNode
  images: ImageRef[]
  promptAssets: PromptAssetItem[]
  workflows: CanvasWorkflowDefinition[]
  wd14Models: CanvasWD14Model[]
  tasks: TaskRecord[]
  executing: boolean
  onTextFocus: (nodeId: string) => void
  onTextChange: (nodeId: string, content: string) => void
  onTextBlur: (nodeId: string) => void
  onPatch: (nodeId: string, patch: Partial<CanvasNode>) => void
  onApplyPrompt: (node: CanvasNode) => void
  onBindImage: (nodeId: string, value: string) => void
  onBindPromptAsset: (nodeId: string, value: string) => void
  onApplyPromptAsset: (node: CanvasNode) => void
  onBindWD14Image: (nodeId: string, value: string) => void
  onBindWD14Model: (nodeId: string, value: string) => void
  onCreateWD14: (node: CanvasNode) => void
  onApplyWD14: (task: TaskRecord) => void
  onBindComfyWorkflow: (nodeId: string, value: string) => void
  onCreateComfy: (node: CanvasNode) => void
  onAddResultImage: (task: TaskRecord) => void
  onBindTask: (nodeId: string, value: string) => void
  canApplyWD14: boolean
  canImportComfyResult: boolean
  onCapabilityDenied: (message: string) => void
}

const stop = (event: React.PointerEvent) => event.stopPropagation()

export function CanvasNodeContent(props: Props) {
  const { node } = props
  if (node.kind === 'text' || node.kind === 'prompt') return <TextNodeContent {...props} />
  if (node.kind === 'image') return <ImageNodeContent {...props} />
  if (node.kind === 'prompt-asset') return <PromptAssetNodeContent {...props} />
  if (node.kind === 'wd14') return <WD14NodeContent {...props} />
  if (node.kind === 'comfyui') return <ComfyNodeContent {...props} />
  return <TaskNodeContent {...props} />
}

function TextNodeContent({ node, onTextFocus, onTextChange, onTextBlur, onApplyPrompt }: Props) {
  return <div className='flex h-[calc(100%-28px)] min-h-0 flex-col gap-1.5 p-2'><textarea value={node.content} onFocus={() => onTextFocus(node.id)} onChange={event => onTextChange(node.id, event.target.value)} onBlur={() => onTextBlur(node.id)} onPointerDown={stop} className='min-h-0 flex-1 resize-none rounded border border-[var(--color-border)] bg-[var(--color-bg-primary)] p-2 text-xs text-[var(--color-text-primary)] outline-none focus:border-[var(--color-accent)]' placeholder={node.kind === 'prompt' ? '输入提示词，支持逗号和 --neg...' : '输入内容...'} />{node.kind === 'prompt' && <button onPointerDown={stop} onClick={() => onApplyPrompt(node)} className='ui-subtle-button shrink-0 px-2 py-1 text-[11px]'>应用到当前提示词</button>}</div>
}

function ImageNodeContent({ node, images, onBindImage }: Props) {
  return <div className='flex h-[calc(100%-28px)] min-h-0 flex-col gap-1.5 p-2'>{node.content ? <img src={'file://' + node.content.split(String.fromCharCode(92)).join('/')} alt={node.title} className='min-h-0 flex-1 object-contain bg-[var(--color-bg-primary)]' draggable={false} /> : <div className='flex min-h-0 flex-1 items-center justify-center text-xs text-[var(--color-text-secondary)]'>图片节点，等待资源绑定</div>}<select value={node.refId || ''} onChange={event => onBindImage(node.id, event.target.value)} onPointerDown={stop} className='ui-field px-2 py-1 text-[11px]'><option value=''>选择图片资源</option>{images.filter(image => image.available).map(image => <option key={image.id} value={image.id}>{image.original_name || `图片 ${image.id}`}</option>)}</select></div>
}

function PromptAssetNodeContent({ node, promptAssets, onBindPromptAsset, onApplyPromptAsset }: Props) {
  return <div className='flex h-[calc(100%-28px)] min-h-0 flex-col gap-1.5 p-2'><select value={node.config?.assetId || ''} onChange={event => onBindPromptAsset(node.id, event.target.value)} onPointerDown={stop} className='ui-field shrink-0 px-2 py-1 text-[11px]'><option value=''>选择提示词资产</option>{promptAssets.map(asset => <option key={asset.id} value={asset.id}>{asset.name}</option>)}</select><div className='min-h-0 flex-1 overflow-auto whitespace-pre-wrap break-words rounded border border-[var(--color-border)] bg-[var(--color-bg-primary)] p-2 font-mono text-xs text-[var(--color-text-secondary)]'>{node.content || '提示词资产节点，等待资产绑定'}</div><button onPointerDown={stop} onClick={() => onApplyPromptAsset(node)} disabled={!node.content} className='ui-subtle-button shrink-0 px-2 py-1 text-[11px]'>应用资产提示词</button></div>
}

function WD14NodeContent({ node, images, wd14Models, tasks, executing, onBindWD14Image, onBindWD14Model, onPatch, onCreateWD14, onApplyWD14, canApplyWD14, onCapabilityDenied }: Props) {
  return <div className='flex h-[calc(100%-28px)] min-h-0 flex-col gap-1.5 p-2'><select value={node.config?.imageId || ''} onChange={event => onBindWD14Image(node.id, event.target.value)} onPointerDown={stop} className='ui-field shrink-0 px-2 py-1 text-[11px]'><option value=''>选择图片资源</option>{images.filter(image => image.available).map(image => <option key={image.id} value={image.id}>{image.original_name || `图片 ${image.id}`}</option>)}</select><select value={node.config?.modelId || ''} onChange={event => onBindWD14Model(node.id, event.target.value)} onPointerDown={stop} className='ui-field shrink-0 px-2 py-1 text-[11px]'><option value=''>自动选择模型</option>{wd14Models.map(model => <option key={model.id} value={model.id}>{model.name}</option>)}</select><label className='flex items-center gap-2 text-[11px] text-[var(--color-text-secondary)]'>阈值<input type='range' min='0.01' max='0.99' step='0.01' value={node.config?.threshold ?? 0.35} onPointerDown={stop} onChange={event => onPatch(node.id, { config: { ...node.config, threshold: Number(event.target.value) } })} className='min-w-0 flex-1 accent-[var(--color-accent)]' /><span className='w-9 text-right tabular-nums'>{(node.config?.threshold ?? 0.35).toFixed(2)}</span></label><div className='min-h-0 flex-1 overflow-auto text-xs text-[var(--color-text-secondary)]'>{node.content || '选择图片后创建本地反推任务'}</div><button onPointerDown={stop} onClick={() => onCreateWD14(node)} disabled={executing || !node.config?.imageId} className='ui-subtle-button shrink-0 px-2 py-1 text-[11px]'>{executing ? '创建中' : '创建反推任务'}</button>{node.status === 'success' && <button onPointerDown={stop} onClick={() => { if (!canApplyWD14) { onCapabilityDenied('WD14 节点未授权结果应用能力'); return } const task = tasks.find(item => item.id === node.refId); if (task) onApplyWD14(task) }} className='ui-subtle-button shrink-0 px-2 py-1 text-[11px]'>应用反推标签</button>}</div>
}

function ComfyNodeContent({ node, workflows, tasks, executing, onTextFocus, onTextChange, onTextBlur, onBindComfyWorkflow, onCreateComfy, onAddResultImage, canImportComfyResult, onCapabilityDenied }: Props) {
  return <div className='flex h-[calc(100%-28px)] min-h-0 flex-col gap-1.5 p-2'><select value={node.config?.workflowId || ''} onChange={event => onBindComfyWorkflow(node.id, event.target.value)} onPointerDown={stop} className='ui-field shrink-0 px-2 py-1 text-[11px]'><option value=''>选择导入工作流</option>{workflows.map(workflow => <option key={workflow.id} value={workflow.id}>{workflow.name}</option>)}</select><textarea value={node.content} onFocus={() => onTextFocus(node.id)} onChange={event => onTextChange(node.id, event.target.value)} onBlur={() => onTextBlur(node.id)} onPointerDown={stop} className='min-h-0 flex-1 resize-none rounded border border-[var(--color-border)] bg-[var(--color-bg-primary)] p-2 text-xs text-[var(--color-text-primary)] outline-none focus:border-[var(--color-accent)]' placeholder='输入用于工作流 prompt 绑定的提示词' /><button onPointerDown={stop} onClick={() => onCreateComfy(node)} disabled={executing || !node.config?.workflowId || !node.content.trim()} className='ui-subtle-button shrink-0 px-2 py-1 text-[11px]'>{executing ? '提交中' : '创建生成任务'}</button>{node.status === 'success' && <button onPointerDown={stop} onClick={() => { if (!canImportComfyResult) { onCapabilityDenied('ComfyUI 节点未授权结果导入能力'); return } const task = tasks.find(item => item.id === node.refId); if (task) onAddResultImage(task) }} className='ui-subtle-button shrink-0 px-2 py-1 text-[11px]'>添加首张结果图片</button>}</div>
}

function TaskNodeContent({ node, tasks, onBindTask, onAddResultImage, onApplyWD14 }: Props) {
  return <div className='flex h-[calc(100%-28px)] min-h-0 flex-col gap-1.5 p-2'><div className='min-h-0 flex-1 overflow-auto text-xs text-[var(--color-text-secondary)]'>{node.content || '任务节点，等待任务绑定'}</div><select value={node.refId || ''} onChange={event => onBindTask(node.id, event.target.value)} onPointerDown={stop} className='ui-field px-2 py-1 text-[11px]'><option value=''>选择任务</option>{tasks.map(task => <option key={task.id} value={task.id}>{task.kind.toUpperCase()} · {task.status} · {task.id.slice(-6)}</option>)}</select>{node.status === 'success' && tasks.some(item => item.id === node.refId && item.kind === 'comfyui') && <button onPointerDown={stop} onClick={() => { const task = tasks.find(item => item.id === node.refId); if (task) onAddResultImage(task) }} className='ui-subtle-button shrink-0 px-2 py-1 text-[11px]'>添加首张结果图片</button>}{node.status === 'success' && tasks.some(item => item.id === node.refId && item.kind === 'wd14') && <button onPointerDown={stop} onClick={() => { const task = tasks.find(item => item.id === node.refId); if (task) onApplyWD14(task) }} className='ui-subtle-button shrink-0 px-2 py-1 text-[11px]'>应用反推标签</button>}</div>
}
