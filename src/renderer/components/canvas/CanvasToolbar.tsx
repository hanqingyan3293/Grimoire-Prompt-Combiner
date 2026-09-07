import React from 'react'
import type { CanvasAlignMode } from '../../../shared/canvas-operations'
import type { CanvasNodeKind } from '../../../shared/canvas-types'

interface ProjectOption { id: string; name: string }

interface Props {
  project: ProjectOption
  projects: ProjectOption[]
  renaming: boolean
  nameDraft: string
  interactionMode: 'select' | 'pan'
  selectedNodeCount: number
  selectedConnectionCount: number
  selectedConnectionTyped: boolean
  selectedHasGroup: boolean
  selectedGroupId: string | null
  selectedGroupTitle: string
  groupTitleDraft: string
  organizeOpen: boolean
  canUndo: boolean
  canRedo: boolean
  message: string
  importRef: React.RefObject<HTMLInputElement | null>
  onSelectProject: (id: string) => void
  onStartRename: () => void
  onNameDraftChange: (value: string) => void
  onCommitRename: () => void
  onCancelRename: () => void
  onCreateProject: () => void
  onAddNode: (kind: CanvasNodeKind) => void
  onExportCanvas: () => void
  onExportPackage: (format: 'json' | 'zip') => void
  onImportPackage: () => void
  onImportCanvas: (event: React.ChangeEvent<HTMLInputElement>) => void
  onInteractionMode: (mode: 'select' | 'pan') => void
  onGroup: () => void
  onUngroup: () => void
  onGroupTitleChange: (value: string) => void
  onRenameGroup: () => void
  onOrganizeOpen: (open: boolean) => void
  onAlign: (mode: CanvasAlignMode) => void
  onDistribute: (mode: 'horizontal' | 'vertical') => void
  onSnap: () => void
  onUndo: () => void
  onRedo: () => void
  onPluginDiagnostics: () => void
  onConnectionDetails: () => void
  onSynchronize: () => void
  onReconnect: () => void
  onDelete: () => void
}

const nodeCommands: Array<{ kind: CanvasNodeKind; label: string }> = [
  { kind: 'text', label: '文本' }, { kind: 'prompt', label: '当前提示词' }, { kind: 'image', label: '图片资产' }, { kind: 'task', label: '任务状态' }, { kind: 'prompt-asset', label: '资产节点' }, { kind: 'wd14', label: 'WD14 节点' }, { kind: 'comfyui', label: 'ComfyUI 节点' },
]

export function CanvasToolbar(props: Props) {
  return (
    <div className='flex shrink-0 flex-wrap items-center gap-1.5 border-b border-[var(--color-border)] bg-[var(--color-bg-secondary)] px-3 py-2'>
      {props.renaming ? <input autoFocus value={props.nameDraft} onChange={event => props.onNameDraftChange(event.target.value)} onBlur={props.onCommitRename} onKeyDown={event => { if (event.key === 'Enter') props.onCommitRename(); if (event.key === 'Escape') props.onCancelRename() }} className='w-36 rounded border border-[var(--color-accent)] bg-[var(--color-bg-primary)] px-2 py-1.5 text-xs text-[var(--color-text-primary)]' /> : <select value={props.project.id} onChange={event => props.onSelectProject(event.target.value)} className='min-w-36 rounded border border-[var(--color-border)] bg-[var(--color-bg-primary)] px-2 py-1.5 text-xs'><option value={props.project.id}>{props.project.name}</option>{props.projects.filter(item => item.id !== props.project.id).map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select>}
      <button onClick={props.onStartRename} className='ui-toolbar-button px-2 py-1 text-xs' title='重命名当前画布'>重命名</button>
      <button onClick={props.onCreateProject} className='ui-toolbar-button px-2 py-1 text-xs'>新建</button>
      {nodeCommands.map(command => <button key={command.kind} onClick={() => props.onAddNode(command.kind)} className='ui-toolbar-button px-2 py-1 text-xs'>{command.label}</button>)}
      <button onClick={props.onExportCanvas} className='ui-toolbar-button px-2 py-1 text-xs'>画布 JSON</button><button onClick={() => props.onExportPackage('json')} className='ui-toolbar-button px-2 py-1 text-xs'>项目 JSON</button><button onClick={() => props.onExportPackage('zip')} className='ui-toolbar-button px-2 py-1 text-xs'>项目 ZIP</button><button onClick={props.onImportPackage} className='ui-toolbar-button px-2 py-1 text-xs'>导入项目包</button><button onClick={() => props.importRef.current?.click()} className='ui-toolbar-button px-2 py-1 text-xs'>导入画布</button><input ref={props.importRef} type='file' accept='application/json,.json' onChange={props.onImportCanvas} className='hidden' />
      <div className='ml-auto flex items-center rounded border border-[var(--color-border)] bg-[var(--color-bg-primary)] p-0.5'><button onClick={() => props.onInteractionMode('select')} className={'h-6 rounded px-2 text-[11px] ' + (props.interactionMode === 'select' ? 'bg-[var(--color-accent)]/15 text-[var(--color-accent-text)]' : 'text-[var(--color-text-secondary)]')}>选择</button><button onClick={() => props.onInteractionMode('pan')} className={'h-6 rounded px-2 text-[11px] ' + (props.interactionMode === 'pan' ? 'bg-[var(--color-accent)]/15 text-[var(--color-accent-text)]' : 'text-[var(--color-text-secondary)]')}>平移</button></div>
      <span className='min-w-14 text-center text-[11px] text-[var(--color-text-secondary)]'>{props.selectedConnectionCount ? `连线 ${props.selectedConnectionCount}` : props.selectedNodeCount ? `节点 ${props.selectedNodeCount}` : '未选择'}</span>
      <button onClick={props.onGroup} disabled={props.selectedNodeCount < 2} className='ui-toolbar-button px-2 py-1 text-xs'>分组</button><button onClick={props.onUngroup} disabled={!props.selectedHasGroup} className='ui-toolbar-button px-2 py-1 text-xs'>取消分组</button>
      {props.selectedGroupId && <div className='flex items-center gap-1'><input value={props.groupTitleDraft} onChange={event => props.onGroupTitleChange(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') props.onRenameGroup() }} className='ui-field h-7 w-24 px-2 py-1 text-[11px]' placeholder={props.selectedGroupTitle || '分组名称'} /><button onClick={props.onRenameGroup} disabled={!props.groupTitleDraft.trim()} className='ui-toolbar-button px-2 py-1 text-[11px]'>改名</button></div>}
      <div className='relative'><button onClick={() => props.onOrganizeOpen(!props.organizeOpen)} className='ui-toolbar-button px-2 py-1 text-xs' aria-expanded={props.organizeOpen}>整理</button>{props.organizeOpen && <div className='ui-popover-surface absolute right-0 top-full z-[80] mt-1 w-48 p-2'><div className='mb-1 text-[10px] text-[var(--color-text-secondary)]'>对齐</div><div className='grid grid-cols-3 gap-1'>{([['left','左'],['center','水平中'],['right','右'],['top','顶'],['middle','垂直中'],['bottom','底']] as Array<[CanvasAlignMode,string]>).map(([mode,label]) => <button key={mode} onClick={() => props.onAlign(mode)} disabled={props.selectedNodeCount < 2} className='ui-menu-direction-button w-auto px-1'>{label}</button>)}</div><div className='my-2 border-t border-[var(--color-border)]' /><div className='grid grid-cols-2 gap-1'><button onClick={() => props.onDistribute('horizontal')} disabled={props.selectedNodeCount < 3} className='ui-menu-item px-2 py-1 text-[11px]'>横向等距</button><button onClick={() => props.onDistribute('vertical')} disabled={props.selectedNodeCount < 3} className='ui-menu-item px-2 py-1 text-[11px]'>纵向等距</button></div><button onClick={props.onSnap} disabled={!props.selectedNodeCount} className='ui-menu-item mt-1 px-2 py-1 text-[11px]'>吸附到 24px 网格</button></div>}</div>
      <button onClick={props.onUndo} disabled={!props.canUndo} className='ui-toolbar-button px-2 py-1 text-xs'>撤销</button><button onClick={props.onRedo} disabled={!props.canRedo} className='ui-toolbar-button px-2 py-1 text-xs'>重做</button><button onClick={props.onPluginDiagnostics} className='ui-toolbar-button px-2 py-1 text-xs'>插件诊断</button>{props.selectedConnectionCount === 1 && <><button onClick={props.onConnectionDetails} className='ui-toolbar-button px-2 py-1 text-xs'>连接详情</button><button onClick={props.onSynchronize} className='ui-toolbar-button px-2 py-1 text-xs'>同步连接</button><button onClick={props.onReconnect} disabled={!props.selectedConnectionTyped} className='ui-toolbar-button px-2 py-1 text-xs'>重连目标</button></>}<button onClick={props.onDelete} disabled={!props.selectedNodeCount && !props.selectedConnectionCount} className='ui-toolbar-button px-2 py-1 text-xs'>{props.selectedConnectionCount ? `删除连线 ${props.selectedConnectionCount}` : '删除'}</button>
      {props.message && <span className='max-w-64 truncate text-xs text-[var(--color-danger)]'>{props.message}</span>}
    </div>
  )
}
