import React, { useCallback, useEffect, useRef, useState } from 'react'
import { isCanvasTaskNodeKind, type CanvasConnection, type CanvasDocument, type CanvasNode, type CanvasNodeKind, type CanvasPoint, type CanvasProject } from '../../../shared/canvas-types'
import { createTypedCanvasConnection, patchCanvasNode, reconnectTypedCanvasConnection, synchronizeCanvasConnection, toggleCanvasConnectionSelection } from '../../../shared/canvas-dataflow'
import type { PromptAssetItem } from '../../../shared/prompt-asset-types'
import type { ImageRef } from '../../../shared/types'
import type { TaskRecord } from '../../../shared/task-types'
import { usePromptsStore } from '../../stores/prompts.store'
import { useTagsStore } from '../../stores/tags.store'
import { alignSelectedNodes, deleteCanvasConnections, distributeSelectedNodes, expandGroupedSelection, groupBounds, groupSelectedNodes, moveSelectedNodes, moveSelectedNodesWithGuides, normalizeRect, renameCanvasGroup, resizeCanvasNode, selectNodesInRect, snapSelectedNodes, ungroupSelectedNodes, type CanvasAlignMode, type CanvasSnapGuides } from '../../../shared/canvas-operations'
import { canvasNodeHasCapability, getCanvasNodeDefinition, listCanvasPlugins } from './nodeRegistry'
import { executeComfyBusinessNode, executePromptAssetBusinessNode, executeWD14BusinessNode, extractTaskImageIds, extractWD14TagNames, reconcileBusinessTaskNode, type CanvasWorkflowDefinition } from './businessNodeRuntime'
import { CanvasConnectionLayer } from './CanvasConnectionLayer'
import { CanvasNodePorts } from './CanvasNodePorts'
import { CanvasNodeContent, type CanvasWD14Model } from './CanvasNodeContent'
import { CanvasToolbar } from './CanvasToolbar'
import { Badge } from '../ui/Badge'
import { Button } from '../ui/Button'
import { Modal } from '../ui/Modal'

const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T
const canvasPlugins = listCanvasPlugins()

function newNode(kind: CanvasNodeKind, position: CanvasPoint): CanvasNode {
  const definition = getCanvasNodeDefinition(kind)
  return { id: 'node_' + crypto.randomUUID().slice(0, 8), kind, title: definition.title, content: '', position, width: definition.defaultSize.width, height: definition.defaultSize.height, status: 'idle' }
}

function taskNodeState(task: TaskRecord): Pick<CanvasNode, 'title' | 'content' | 'status'> {
  let imageCount = 0
  if (task.output_json) {
    try {
      const output = JSON.parse(task.output_json) as { imageIds?: unknown }
      imageCount = Array.isArray(output.imageIds) ? output.imageIds.length : 0
    } catch { /* Invalid legacy output remains visible through the task status. */ }
  }
  const status = task.status === 'succeeded' ? 'success' : task.status === 'failed' ? 'error' : task.status === 'running' || task.status === 'queued' || task.status === 'cancelling' ? 'running' : 'idle'
  const detail = task.error_message || (imageCount ? `${task.status} · ${imageCount} 张图片` : task.status)
  return { title: task.kind.toUpperCase() + ' 任务', content: detail, status }
}

export function CanvasPanel() {
  const [projects, setProjects] = useState<Array<{ id: string; name: string }>>([])
  const [project, setProject] = useState<CanvasProject | null>(null)
  const [images, setImages] = useState<ImageRef[]>([])
  const [tasks, setTasks] = useState<TaskRecord[]>([])
  const [promptAssets, setPromptAssets] = useState<PromptAssetItem[]>([])
  const [workflows, setWorkflows] = useState<CanvasWorkflowDefinition[]>([])
  const [wd14Models, setWD14Models] = useState<CanvasWD14Model[]>([])
  const [executingNodeId, setExecutingNodeId] = useState<string | null>(null)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set())
  const [history, setHistory] = useState<CanvasDocument[]>([])
  const [future, setFuture] = useState<CanvasDocument[]>([])
  const [message, setMessage] = useState('')
  const [renaming, setRenaming] = useState(false)
  const [nameDraft, setNameDraft] = useState('')
  const [connectingFrom, setConnectingFrom] = useState<{ nodeId: string; portId: string } | null>(null)
  const [selectionBox, setSelectionBox] = useState<{ start: CanvasPoint; current: CanvasPoint; additive: boolean; initialIds: string[] } | null>(null)
  const [interactionMode, setInteractionMode] = useState<'select' | 'pan'>('select')
  const [selectedConnectionIds, setSelectedConnectionIds] = useState<Set<string>>(() => new Set())
  const [reconnectingConnectionId, setReconnectingConnectionId] = useState<string | null>(null)
  const [connectionDetailsOpen, setConnectionDetailsOpen] = useState(false)
  const [pluginDetailsOpen, setPluginDetailsOpen] = useState(false)
  const [snapGuides, setSnapGuides] = useState<CanvasSnapGuides>({})
  const [organizeOpen, setOrganizeOpen] = useState(false)
  const [groupTitleDraft, setGroupTitleDraft] = useState('')
  const panRef = useRef<{ x: number; y: number; startX: number; startY: number } | null>(null)
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const dragRef = useRef<{ ids: string[]; x: number; y: number; guides: boolean } | null>(null)
  const resizeRef = useRef<{ id: string; startX: number; startY: number; width: number; height: number } | null>(null)
  const viewportRef = useRef<HTMLDivElement>(null)
  const dragStartRef = useRef<CanvasDocument | null>(null)
  const movedRef = useRef(false)
  const importRef = useRef<HTMLInputElement>(null)
  const initializedRef = useRef(false)
  const textEditStartRef = useRef<Map<string, CanvasDocument>>(new Map())
  const currentPrompt = usePromptsStore(state => state.getFullPrompt('en'))
  const replaceFromPromptText = usePromptsStore(state => state.replaceFromPromptText)
  const tags = useTagsStore(state => state.tags)

  const loadProjects = useCallback(async () => {
    const list = await window.api.canvas.list()
    setProjects(list)
    if (!initializedRef.current && list[0]) setProject(await window.api.canvas.get(list[0].id))
    if (!initializedRef.current && !list[0]) {
      const created = await window.api.canvas.create('我的第一个画布')
      setProjects([{ id: created.id, name: created.name }])
      setProject(created)
    }
    initializedRef.current = true
  }, [])

  useEffect(() => { void loadProjects().catch(error => setMessage(error instanceof Error ? error.message : '画布加载失败')) }, [loadProjects])
  useEffect(() => {
    void Promise.all([
      window.api.images.list().then(setImages),
      window.api.tasks.list().then(setTasks),
      window.api.promptAssets.list({ limit: 100 }).then(page => setPromptAssets(page.items)),
      window.api.comfy.workflows().then(items => setWorkflows(items.map(item => ({ id: item.id, name: item.name, bindings: item.bindings, defaults: item.defaults })))).catch(() => setWorkflows([])),
      window.api.wd14.models().then(result => setWD14Models(result.models.map(model => ({ id: String(model.id || ''), name: String(model.name || model.id || ''), hasCsv: Boolean(model.has_csv) })).filter(model => model.id && model.hasCsv))).catch(() => setWD14Models([])),
    ]).catch(error => setMessage(error instanceof Error ? error.message : '画布业务数据加载失败'))
    return window.api.tasks.onUpdated(event => {
      void window.api.tasks.list().then(setTasks).catch(() => {})
      if (event.kind === 'comfyui' && event.status === 'succeeded') void window.api.images.list().then(setImages).catch(() => {})
    })
  }, [])

  useEffect(() => {
    if (!tasks.length) return
    setProject(current => {
      if (!current) return current
      let changed = false
      const nodes = current.document.nodes.map(node => {
        if (!isCanvasTaskNodeKind(node.kind) || !node.refId) return node
        const task = tasks.find(item => item.id === node.refId)
        if (!task) return node
        const next = { ...node, ...reconcileBusinessTaskNode(node, task) }
        if (node.title === next.title && node.content === next.content && node.status === next.status) return node
        changed = true
        return next
      })
      if (!changed) return current
      const next = { ...current, document: { ...current.document, nodes } }
      if (saveTimer.current) clearTimeout(saveTimer.current)
      saveTimer.current = setTimeout(() => { void window.api.canvas.save(next.id, next.name, next.document).catch(() => {}) }, 350)
      return next
    })
  }, [tasks])

  const persist = (next: CanvasProject) => {
    setProject(next)
    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => { void window.api.canvas.save(next.id, next.name, next.document).catch(error => setMessage(error instanceof Error ? error.message : '画布保存失败')) }, 350)
  }

  const commit = (document: CanvasDocument) => {
    if (!project) return
    setHistory(items => [...items.slice(-49), clone(project.document)])
    setFuture([])
    persist({ ...project, document })
  }

  const updateDocumentWithoutHistory = (document: CanvasDocument) => {
    if (!project) return
    persist({ ...project, document })
  }

  const createProject = async () => {
    const created = await window.api.canvas.create('未命名画布')
    setProjects(items => [{ id: created.id, name: created.name }, ...items])
    setProject(created); setSelectedIds(new Set()); setHistory([]); setFuture([])
  }

  const renameProject = async () => {
    if (!project || !nameDraft.trim()) return
    try {
      const saved = await window.api.canvas.save(project.id, nameDraft.trim(), project.document)
      setProject(saved)
      setProjects(items => items.map(item => item.id === saved.id ? { id: saved.id, name: saved.name } : item))
      setRenaming(false)
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '画布重命名失败')
    }
  }

  const addNode = (kind: CanvasNodeKind, initial?: Partial<CanvasNode>) => {
    if (!project) return
    const center = { x: (500 - project.document.viewport.x) / project.document.viewport.scale, y: (260 - project.document.viewport.y) / project.document.viewport.scale }
    const node = { ...newNode(kind, center), ...initial }
    commit({ ...project.document, nodes: [...project.document.nodes, node] })
  }

  const addPromptNode = () => addNode('prompt', { content: currentPrompt })
  const addImageNode = () => {
    const image = images.find(item => item.available)
    if (!image) { setMessage('请先在图片面板导入图片'); addNode('image'); return }
    addNode('image', { content: image.file_path, refId: String(image.id), title: image.original_name || '图片' })
  }
  const addTaskNode = () => {
    const task = tasks[0]
    addNode('task', task ? { ...taskNodeState(task), refId: task.id } : undefined)
  }
  const addPromptAssetNode = () => {
    const asset = promptAssets[0]
    addNode('prompt-asset', asset ? { title: asset.name, content: asset.prompt, config: { assetId: asset.id } } : undefined)
  }
  const addWD14Node = () => addNode('wd14', { config: { threshold: 0.35 } })
  const addComfyUINode = () => addNode('comfyui', { content: currentPrompt })
  const addNodeFromToolbar = (kind: CanvasNodeKind) => {
    if (kind === 'prompt') addPromptNode()
    else if (kind === 'image') addImageNode()
    else if (kind === 'task') addTaskNode()
    else if (kind === 'prompt-asset') addPromptAssetNode()
    else if (kind === 'wd14') addWD14Node()
    else if (kind === 'comfyui') addComfyUINode()
    else addNode(kind)
  }

  const updateNode = (id: string, patch: Partial<CanvasNode>) => {
    if (!project) return
    commit(patchCanvasNode(project.document, id, patch))
  }

  const updateNodeWithoutHistory = (id: string, patch: Partial<CanvasNode>) => {
    if (!project) return
    updateDocumentWithoutHistory({ ...project.document, nodes: project.document.nodes.map(node => node.id === id ? { ...node, ...patch } : node) })
  }

  const finishTextEdit = (id: string) => {
    const before = textEditStartRef.current.get(id)
    textEditStartRef.current.delete(id)
    if (!before || !project) return
    const beforeContent = before.nodes.find(node => node.id === id)?.content
    const currentContent = project.document.nodes.find(node => node.id === id)?.content
    if (beforeContent === currentContent) return
    setHistory(items => [...items.slice(-49), before])
    setFuture([])
  }

  const applyPromptNode = (node: CanvasNode) => {
    const result = replaceFromPromptText(node.content, tags)
    setMessage(result.matched ? `已应用 ${result.matched} 个标签${result.unknown.length ? `，${result.unknown.length} 项未匹配` : ''}` : '没有匹配到当前标签库中的标签')
  }

  const bindImageNode = (nodeId: string, imageId: string) => {
    const image = images.find(item => String(item.id) === imageId)
    updateNode(nodeId, image ? { refId: String(image.id), content: image.file_path, title: image.original_name || '图片' } : { refId: undefined, content: '', title: '图片' })
  }

  const bindTaskNode = (nodeId: string, taskId: string) => {
    const task = tasks.find(item => item.id === taskId)
    updateNode(nodeId, task ? { refId: task.id, ...taskNodeState(task) } : { refId: undefined, content: '', status: 'idle', title: '任务' })
  }

  const bindPromptAssetNode = (nodeId: string, assetId: string) => {
    const asset = promptAssets.find(item => item.id === assetId)
    updateNode(nodeId, asset ? { title: asset.name, content: asset.prompt, config: { assetId: asset.id } } : { title: '提示词资产', content: '', config: undefined })
  }

  const bindWD14ImageNode = (nodeId: string, imageId: string) => {
    const node = project?.document.nodes.find(item => item.id === nodeId)
    if (!node) return
    const nextImageId = Number(imageId)
    updateNode(nodeId, { config: { ...node.config, imageId: Number.isInteger(nextImageId) && nextImageId > 0 ? nextImageId : undefined } })
  }

  const bindWD14ModelNode = (nodeId: string, modelId: string) => {
    const node = project?.document.nodes.find(item => item.id === nodeId)
    if (!node) return
    updateNode(nodeId, { config: { ...node.config, modelId: modelId || undefined } })
  }

  const bindComfyWorkflowNode = (nodeId: string, workflowId: string) => {
    const node = project?.document.nodes.find(item => item.id === nodeId)
    if (!node) return
    const workflow = workflows.find(item => item.id === workflowId)
    updateNode(nodeId, { config: { ...node.config, workflowId: workflow?.id }, content: node.content || (workflow ? String(workflow.defaults.prompt || '') : '') })
  }

  const applyPromptAssetNode = (node: CanvasNode) => {
    const result = executePromptAssetBusinessNode(node, { hasCapability: canvasNodeHasCapability, applyPromptText: text => replaceFromPromptText(text, tags) })
    updateNode(node.id, result.patch)
    setMessage(result.message)
  }

  const createWD14NodeTask = async (node: CanvasNode) => {
    setExecutingNodeId(node.id)
    const result = await executeWD14BusinessNode(node, {
      hasCapability: canvasNodeHasCapability,
      createWD14Task: input => window.api.wd14.createTask(input),
      createComfyTask: (workflowId, values) => window.api.comfy.createTask(workflowId, values),
    })
    updateNode(node.id, result.patch)
    setMessage(result.message)
    setExecutingNodeId(null)
  }

  const createComfyNodeTask = async (node: CanvasNode) => {
    setExecutingNodeId(node.id)
    const result = await executeComfyBusinessNode(node, workflows, {
      hasCapability: canvasNodeHasCapability,
      createWD14Task: input => window.api.wd14.createTask(input),
      createComfyTask: (workflowId, values) => window.api.comfy.createTask(workflowId, values),
    })
    updateNode(node.id, result.patch)
    setMessage(result.message)
    setExecutingNodeId(null)
  }

  const addResultImageNode = (task: TaskRecord) => {
    let imageIds: number[] = []
    try { imageIds = extractTaskImageIds(task) } catch { /* Keep malformed legacy output visible. */ }
    const image = imageIds.map(id => images.find(item => item.id === id)).find((item): item is ImageRef => Boolean(item?.available))
    if (!image) { setMessage('该任务没有可回填的图片资源'); return }
    addNode('image', { content: image.file_path, refId: String(image.id), title: image.original_name || '生成图片' })
  }

  const applyWD14Task = (task: TaskRecord) => {
    try {
      const names = extractWD14TagNames(task)
      if (!names.length) { setMessage('该 WD14 任务没有可应用的反推标签'); return }
      const result = replaceFromPromptText(names.join(', '), tags)
      setMessage(result.matched ? `已应用 ${result.matched} 个 WD14 标签${result.unknown.length ? `，${result.unknown.length} 项未匹配` : ''}` : 'WD14 标签未匹配当前标签库')
    } catch {
      setMessage('WD14 任务输出格式无效')
    }
  }

  const deleteSelected = () => {
    if (project && selectedConnectionIds.size) {
      commit(deleteCanvasConnections(project.document, selectedConnectionIds))
      setSelectedConnectionIds(new Set())
      setReconnectingConnectionId(null)
      setConnectionDetailsOpen(false)
      return
    }
    if (!project || !selectedIds.size) return
    const ids = expandGroupedSelection(project.document.nodes, selectedIds)
    const remainingNodes = project.document.nodes.filter(node => !ids.has(node.id))
    const usedGroups = new Set(remainingNodes.map(node => node.groupId).filter(Boolean))
    commit({ ...project.document, nodes: remainingNodes, groups: (project.document.groups || []).filter(group => usedGroups.has(group.id)), connections: project.document.connections.filter(connection => !ids.has(connection.fromNodeId) && !ids.has(connection.toNodeId)) })
    setSelectedIds(new Set())
  }

  const synchronizeSelectedConnection = () => {
    const connectionId = selectedConnectionIds.size === 1 ? [...selectedConnectionIds][0] : null
    if (!project || !connectionId) return
    const result = synchronizeCanvasConnection(project.document, connectionId, node => {
      const task = tasks.find(item => item.id === node.refId)
      if (!task) return []
      try { return extractWD14TagNames(task) } catch { return [] }
    })
    if (result.changed) commit(result.document)
    setMessage(result.message)
  }

  const startReconnect = () => {
    const connectionId = selectedConnectionIds.size === 1 ? [...selectedConnectionIds][0] : null
    if (!connectionId) return
    setReconnectingConnectionId(connectionId)
    setMessage('请选择新的目标节点；系统会保留源端口并检查类型兼容')
  }

  const connectToInputPort = (nodeId: string, portId: string) => {
    if (!project || !connectingFrom) return
    const result = createTypedCanvasConnection(project.document, connectingFrom.nodeId, nodeId, 'conn_' + crypto.randomUUID().slice(0, 8), connectingFrom.portId, portId)
    if (result.connection) commit({ ...project.document, connections: [...project.document.connections, result.connection] })
    else setMessage(result.error || '连接创建失败')
    setConnectingFrom(null)
  }

  const reconnectToInputPort = (nodeId: string, portId: string) => {
    if (!project || !reconnectingConnectionId) return
    const result = reconnectTypedCanvasConnection(project.document, reconnectingConnectionId, nodeId, portId)
    if (result.connection) commit({ ...project.document, connections: project.document.connections.map(connection => connection.id === reconnectingConnectionId ? result.connection! : connection) })
    else setMessage(result.error || '重连失败')
    setReconnectingConnectionId(null)
  }

  const selectConnection = (id: string, additive: boolean) => {
    setSelectedConnectionIds(current => toggleCanvasConnectionSelection(current, id, additive))
    setSelectedIds(new Set())
  }

  const undo = () => {
    if (!project || !history.length) return
    const previous = history[history.length - 1]
    setHistory(history.slice(0, -1)); setFuture(items => [clone(project.document), ...items]); persist({ ...project, document: previous })
  }

  const redo = () => {
    if (!project || !future.length) return
    const next = future[0]
    setFuture(future.slice(1)); setHistory(items => [...items, clone(project.document)]); persist({ ...project, document: next })
  }

  const onPointerMove = (event: React.PointerEvent) => {
    if (selectionBox && project) {
      const rect = viewportRef.current?.getBoundingClientRect()
      if (!rect) return
      const current = { x: (event.clientX - rect.left - project.document.viewport.x) / project.document.viewport.scale, y: (event.clientY - rect.top - project.document.viewport.y) / project.document.viewport.scale }
      const inside = expandGroupedSelection(project.document.nodes, selectNodesInRect(project.document.nodes, normalizeRect(selectionBox.start, current)))
      setSelectionBox(box => box ? { ...box, current } : null)
      setSelectedIds(new Set(selectionBox.additive ? [...selectionBox.initialIds, ...inside] : inside))
      return
    }
    const pan = panRef.current
    if (pan && project) {
      const dx = event.clientX - pan.startX
      const dy = event.clientY - pan.startY
      persist({ ...project, document: { ...project.document, viewport: { ...project.document.viewport, x: pan.x + dx, y: pan.y + dy } } })
      return
    }
    const resizing = resizeRef.current
    if (resizing && project) {
      const width = resizing.width + (event.clientX - resizing.startX) / project.document.viewport.scale
      const height = resizing.height + (event.clientY - resizing.startY) / project.document.viewport.scale
      if (Math.abs(width - resizing.width) > 1 || Math.abs(height - resizing.height) > 1) movedRef.current = true
      updateDocumentWithoutHistory({ ...project.document, nodes: resizeCanvasNode(project.document.nodes, resizing.id, width, height) })
      return
    }
    const drag = dragRef.current
    if (!drag || !project) return
    const dx = (event.clientX - drag.x) / project.document.viewport.scale
    const dy = (event.clientY - drag.y) / project.document.viewport.scale
    if (Math.abs(dx) > 1 || Math.abs(dy) > 1) movedRef.current = true
    const guidesEnabled = event.shiftKey
    const moved = guidesEnabled ? moveSelectedNodesWithGuides(project.document.nodes, drag.ids, dx, dy, 14) : { nodes: moveSelectedNodes(project.document.nodes, drag.ids, dx, dy), guides: {} }
    updateDocumentWithoutHistory({ ...project.document, nodes: moved.nodes })
    setSnapGuides(moved.guides)
    dragRef.current = { ...drag, x: event.clientX, y: event.clientY, guides: guidesEnabled }
  }

  const finishNodeDrag = () => {
    if (!project || !dragStartRef.current || !movedRef.current) { dragStartRef.current = null; movedRef.current = false; return }
    setHistory(items => [...items.slice(-49), clone(dragStartRef.current!)])
    setFuture([])
    dragStartRef.current = null
    movedRef.current = false
  }

  const applyNodeLayout = (nodes: CanvasNode[]) => {
    if (!project || nodes === project.document.nodes) return
    commit({ ...project.document, nodes })
  }

  const alignSelection = (mode: CanvasAlignMode) => applyNodeLayout(alignSelectedNodes(project?.document.nodes || [], selectedIds, mode))
  const distributeSelection = (mode: 'horizontal' | 'vertical') => applyNodeLayout(distributeSelectedNodes(project?.document.nodes || [], selectedIds, mode))
  const snapSelection = () => applyNodeLayout(snapSelectedNodes(project?.document.nodes || [], selectedIds, 24))
  const groupSelection = () => {
    if (!project || selectedIds.size < 2) return
    const groupId = 'group_' + crypto.randomUUID().slice(0, 8)
    commit(groupSelectedNodes(project.document, selectedIds, groupId, `分组 ${(project.document.groups?.length || 0) + 1}`))
  }
  const ungroupSelection = () => { if (project) commit(ungroupSelectedNodes(project.document, selectedIds)) }
  const selectedGroupId = project?.document.nodes.find(node => selectedIds.has(node.id) && node.groupId)?.groupId || null
  const renameSelectedGroup = () => {
    if (!project || !selectedGroupId || !groupTitleDraft.trim()) return
    commit(renameCanvasGroup(project.document, selectedGroupId, groupTitleDraft))
    setGroupTitleDraft('')
  }

  const exportProject = () => {
    if (!project) return
    const blob = new Blob([JSON.stringify(project, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `${project.name || 'canvas'}.json`
    link.click()
    URL.revokeObjectURL(url)
  }

  const importProject = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    try {
      const imported = JSON.parse(await file.text()) as Partial<CanvasProject>
      if (!imported.document || imported.document.version !== 1) throw new Error('画布文件版本不支持')
      const created = await window.api.canvas.create(typeof imported.name === 'string' ? imported.name : '导入画布')
      const saved = await window.api.canvas.save(created.id, created.name, imported.document)
      setProjects(items => [saved, ...items])
      setProject(saved)
      setSelectedIds(new Set()); setHistory([]); setFuture([])
      setMessage('画布已导入')
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '画布导入失败')
    }
  }

  const exportPackage = async (format: 'json' | 'zip') => {
    if (!project) return
    try {
      const saved = await window.api.canvas.exportPackage(project.id, format)
      if (saved) setMessage(`${format.toUpperCase()} 项目包已导出`)
    } catch (error) { setMessage(error instanceof Error ? error.message : '项目包导出失败') }
  }

  const importPackage = async () => {
    try {
      const imported = await window.api.canvas.importPackage()
      if (!imported) return
      const list = await window.api.canvas.list()
      const next = await window.api.canvas.get(imported.projectId)
      setProjects(list); setProject(next); setSelectedIds(new Set()); setHistory([]); setFuture([])
      setMessage(`项目包已导入：${imported.projectName}，${imported.importedImages} 张图片，${imported.importedPromptAssets} 条提示词资产，${imported.importedWorkflows} 个工作流${imported.warnings.length ? `，${imported.warnings.length} 个警告` : ''}`)
    } catch (error) { setMessage(error instanceof Error ? error.message : '项目包导入失败') }
  }

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      if (target?.tagName === 'TEXTAREA' || target?.tagName === 'INPUT' || target?.isContentEditable) return
      if (event.key === 'Escape') { setConnectingFrom(null); setReconnectingConnectionId(null) }
      if (event.key === 'Delete' || event.key === 'Backspace') deleteSelected()
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') { event.preventDefault(); undo() }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'y') { event.preventDefault(); redo() }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  })

  const finishPointerInteraction = () => {
    finishNodeDrag()
    dragRef.current = null
    panRef.current = null
    resizeRef.current = null
    setSelectionBox(null)
    setSnapGuides({})
  }

  const selectNode = (node: CanvasNode, event: React.PointerEvent) => {
    const additive = event.ctrlKey || event.metaKey || event.shiftKey
    const groupMembers = node.groupId ? canvasDocument.nodes.filter(item => item.groupId === node.groupId).map(item => item.id) : [node.id]
    const nextSelected = new Set(additive || selectedIds.has(node.id) ? selectedIds : [])
    const removeGroup = additive && groupMembers.every(id => nextSelected.has(id))
    for (const id of groupMembers) {
      if (removeGroup) nextSelected.delete(id)
      else nextSelected.add(id)
    }
    setSelectedIds(nextSelected)
    setSelectedConnectionIds(new Set())
    setReconnectingConnectionId(null)
    setConnectionDetailsOpen(false)
    return nextSelected
  }

  const startNodeDrag = (node: CanvasNode, event: React.PointerEvent) => {
    const nextSelected = selectNode(node, event)
    if (!nextSelected.has(node.id)) return
    dragStartRef.current = clone(canvasDocument)
    movedRef.current = false
    event.currentTarget.setPointerCapture(event.pointerId)
    dragRef.current = { ids: [...expandGroupedSelection(canvasDocument.nodes, nextSelected)], x: event.clientX, y: event.clientY, guides: event.shiftKey }
  }

  const startBackgroundInteraction = (event: React.PointerEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement
    if (event.button === 1 || (event.button === 0 && interactionMode === 'pan')) {
      event.preventDefault()
      event.currentTarget.setPointerCapture(event.pointerId)
      panRef.current = { x: canvasDocument.viewport.x, y: canvasDocument.viewport.y, startX: event.clientX, startY: event.clientY }
      return
    }
    if (event.button !== 0 || interactionMode !== 'select' || (event.target !== event.currentTarget && !target.dataset.canvasBackground)) return
    setSelectedConnectionIds(new Set())
    const rect = event.currentTarget.getBoundingClientRect()
    const start = { x: (event.clientX - rect.left - canvasDocument.viewport.x) / canvasDocument.viewport.scale, y: (event.clientY - rect.top - canvasDocument.viewport.y) / canvasDocument.viewport.scale }
    const additive = event.ctrlKey || event.metaKey || event.shiftKey
    event.currentTarget.setPointerCapture(event.pointerId)
    setSelectionBox({ start, current: start, additive, initialIds: additive ? [...selectedIds] : [] })
    if (!additive) setSelectedIds(new Set())
  }

  if (!project) return <div className='flex h-full items-center justify-center text-sm text-[var(--color-text-secondary)]'>加载画布中...</div>
  const canvasDocument = project.document
  const selectedConnection = selectedConnectionIds.size === 1 ? canvasDocument.connections.find(connection => connection.id === [...selectedConnectionIds][0]) : undefined
  const selectedConnectionFrom = selectedConnection ? canvasDocument.nodes.find(node => node.id === selectedConnection.fromNodeId) : undefined
  const selectedConnectionTo = selectedConnection ? canvasDocument.nodes.find(node => node.id === selectedConnection.toNodeId) : undefined
  return <div className='flex h-full min-h-0 flex-col'>
    <CanvasToolbar project={project} projects={projects} renaming={renaming} nameDraft={nameDraft} interactionMode={interactionMode} selectedNodeCount={selectedIds.size} selectedConnectionCount={selectedConnectionIds.size} selectedConnectionTyped={Boolean(selectedConnection?.dataType)} selectedHasGroup={canvasDocument.nodes.some(node => selectedIds.has(node.id) && Boolean(node.groupId))} selectedGroupId={selectedGroupId} selectedGroupTitle={(canvasDocument.groups || []).find(group => group.id === selectedGroupId)?.title || ''} groupTitleDraft={groupTitleDraft} organizeOpen={organizeOpen} canUndo={history.length > 0} canRedo={future.length > 0} message={message} importRef={importRef} onSelectProject={async id => { const next = await window.api.canvas.get(id); setProject(next); setSelectedIds(new Set()); setSelectedConnectionIds(new Set()); setConnectingFrom(null); setReconnectingConnectionId(null); setConnectionDetailsOpen(false); setHistory([]); setFuture([]) }} onStartRename={() => { setNameDraft(project.name); setRenaming(true) }} onNameDraftChange={setNameDraft} onCommitRename={() => void renameProject()} onCancelRename={() => setRenaming(false)} onCreateProject={() => void createProject()} onAddNode={addNodeFromToolbar} onExportCanvas={exportProject} onExportPackage={format => void exportPackage(format)} onImportPackage={() => void importPackage()} onImportCanvas={event => void importProject(event)} onInteractionMode={setInteractionMode} onGroup={groupSelection} onUngroup={ungroupSelection} onGroupTitleChange={setGroupTitleDraft} onRenameGroup={renameSelectedGroup} onOrganizeOpen={setOrganizeOpen} onAlign={mode => { alignSelection(mode); setOrganizeOpen(false) }} onDistribute={mode => { distributeSelection(mode); setOrganizeOpen(false) }} onSnap={() => { snapSelection(); setOrganizeOpen(false) }} onUndo={undo} onRedo={redo} onPluginDiagnostics={() => setPluginDetailsOpen(true)} onConnectionDetails={() => setConnectionDetailsOpen(true)} onSynchronize={synchronizeSelectedConnection} onReconnect={startReconnect} onDelete={deleteSelected} />
    <div ref={viewportRef} className={'relative min-h-0 flex-1 overflow-hidden bg-[var(--color-bg-primary)] ' + (interactionMode === 'pan' ? 'cursor-grab active:cursor-grabbing' : 'cursor-crosshair')} onPointerMove={onPointerMove} onPointerUp={finishPointerInteraction} onPointerCancel={finishPointerInteraction} onWheel={event => { if (!event.ctrlKey && !event.metaKey) return; event.preventDefault(); const scale = Math.max(0.25, Math.min(2.5, canvasDocument.viewport.scale * (event.deltaY > 0 ? 0.9 : 1.1))); updateDocumentWithoutHistory({ ...canvasDocument, viewport: { ...canvasDocument.viewport, scale } }) }} onPointerDown={startBackgroundInteraction}>
      <div data-canvas-background className='absolute inset-0 opacity-30' style={{ backgroundImage: 'radial-gradient(circle, var(--color-border) 1px, transparent 1px)', backgroundSize: `${24 * canvasDocument.viewport.scale}px ${24 * canvasDocument.viewport.scale}px`, backgroundPosition: `${canvasDocument.viewport.x}px ${canvasDocument.viewport.y}px` }} />
      {(canvasDocument.groups || []).map(group => { const bounds = groupBounds(canvasDocument.nodes, group.id); if (!bounds) return null; return <div key={group.id} className='pointer-events-none absolute rounded-lg border border-dashed border-[var(--color-accent)]/55 bg-[var(--color-accent)]/5' style={{ left: bounds.left * canvasDocument.viewport.scale + canvasDocument.viewport.x, top: bounds.top * canvasDocument.viewport.scale + canvasDocument.viewport.y, width: (bounds.right - bounds.left) * canvasDocument.viewport.scale, height: (bounds.bottom - bounds.top) * canvasDocument.viewport.scale }}><span className='absolute left-2 top-1 text-[10px] font-medium text-[var(--color-accent-text)]'>{group.title}</span></div> })}
      <CanvasConnectionLayer document={canvasDocument} selectedIds={selectedConnectionIds} onSelect={selectConnection} />
      {canvasDocument.nodes.map(node => <div key={node.id} data-canvas-no-zoom className={'absolute z-20 overflow-visible rounded-lg border shadow-lg ' + (selectedIds.has(node.id) ? 'border-[var(--color-accent)] ring-2 ring-[var(--color-accent)]/30' : 'border-[var(--color-border)]')} style={{ left: node.position.x * canvasDocument.viewport.scale + canvasDocument.viewport.x, top: node.position.y * canvasDocument.viewport.scale + canvasDocument.viewport.y, width: node.width * canvasDocument.viewport.scale, height: node.height * canvasDocument.viewport.scale, background: 'var(--color-bg-secondary)' }} onPointerDown={event => { event.stopPropagation(); selectNode(node, event) }}>
        <CanvasNodePorts node={node} scale={canvasDocument.viewport.scale} connectingFrom={connectingFrom} reconnecting={Boolean(reconnectingConnectionId)} onStart={(nodeId, portId) => setConnectingFrom({ nodeId, portId })} onConnect={(nodeId, portId) => { if (connectingFrom) connectToInputPort(nodeId, portId); else if (reconnectingConnectionId) reconnectToInputPort(nodeId, portId) }} />
        <div onPointerDown={event => { event.stopPropagation(); startNodeDrag(node, event) }} className='flex min-h-8 cursor-grab items-center justify-between overflow-hidden rounded-t-lg border-b border-[var(--color-border)] px-2 py-1 text-xs font-semibold text-[var(--color-text-primary)] active:cursor-grabbing' title='拖动标题栏移动节点'><span className='min-w-0 truncate' title={getCanvasNodeDefinition(node.kind).pluginId ? `${getCanvasNodeDefinition(node.kind).pluginId} v${canvasPlugins.find(plugin => plugin.id === getCanvasNodeDefinition(node.kind).pluginId)?.version || '?'}` : undefined}>{node.title}</span><span className='ml-2 shrink-0 text-[10px] text-[var(--color-text-secondary)]'>拖动</span></div>
        <CanvasNodeContent node={node} images={images} promptAssets={promptAssets} workflows={workflows} wd14Models={wd14Models} tasks={tasks} executing={executingNodeId === node.id} onTextFocus={nodeId => { if (!textEditStartRef.current.has(nodeId)) textEditStartRef.current.set(nodeId, clone(canvasDocument)) }} onTextChange={(nodeId, content) => updateNodeWithoutHistory(nodeId, { content })} onTextBlur={finishTextEdit} onPatch={updateNode} onApplyPrompt={applyPromptNode} onBindImage={bindImageNode} onBindPromptAsset={bindPromptAssetNode} onApplyPromptAsset={applyPromptAssetNode} onBindWD14Image={bindWD14ImageNode} onBindWD14Model={bindWD14ModelNode} onCreateWD14={node => void createWD14NodeTask(node)} onApplyWD14={applyWD14Task} onBindComfyWorkflow={bindComfyWorkflowNode} onCreateComfy={node => void createComfyNodeTask(node)} onAddResultImage={addResultImageNode} onBindTask={bindTaskNode} canApplyWD14={canvasNodeHasCapability(node.kind, 'wd14.applyResult')} canImportComfyResult={canvasNodeHasCapability(node.kind, 'comfyui.importResult')} onCapabilityDenied={setMessage} />
        {selectedIds.has(node.id) && selectedIds.size === 1 && <button onPointerDown={event => { event.preventDefault(); event.stopPropagation(); dragStartRef.current = clone(canvasDocument); movedRef.current = false; event.currentTarget.setPointerCapture(event.pointerId); resizeRef.current = { id: node.id, startX: event.clientX, startY: event.clientY, width: node.width, height: node.height } }} className='absolute bottom-0 right-0 z-40 h-4 w-4 cursor-nwse-resize border-l border-t border-[var(--color-accent)] bg-[var(--color-accent)]/25' title='拖动缩放节点' aria-label='拖动缩放节点' />}
      </div>)}
      {snapGuides.x !== undefined && <div className='pointer-events-none absolute inset-y-0 z-40 w-px bg-[var(--color-accent)]/70' style={{ left: snapGuides.x * canvasDocument.viewport.scale + canvasDocument.viewport.x }} />}
      {snapGuides.y !== undefined && <div className='pointer-events-none absolute inset-x-0 z-40 h-px bg-[var(--color-accent)]/70' style={{ top: snapGuides.y * canvasDocument.viewport.scale + canvasDocument.viewport.y }} />}
      {selectionBox && (() => { const box = normalizeRect(selectionBox.start, selectionBox.current); return <div className='pointer-events-none absolute z-50 border border-[var(--color-accent)] bg-[var(--color-accent)]/10' style={{ left: box.left * canvasDocument.viewport.scale + canvasDocument.viewport.x, top: box.top * canvasDocument.viewport.scale + canvasDocument.viewport.y, width: (box.right - box.left) * canvasDocument.viewport.scale, height: (box.bottom - box.top) * canvasDocument.viewport.scale }} /> })()}
      <CanvasMiniMap nodes={canvasDocument.nodes} viewport={canvasDocument.viewport} />
    </div>
    <Modal title='连接详情' open={connectionDetailsOpen && Boolean(selectedConnection)} onClose={() => setConnectionDetailsOpen(false)}>
      {selectedConnection && <div className='space-y-3'>
        <div className='grid grid-cols-[90px_1fr] gap-2 text-sm'><span className='text-[var(--color-text-secondary)]'>来源</span><span className='truncate'>{selectedConnectionFrom?.title || selectedConnection.fromNodeId}{selectedConnection.fromPort ? ` · ${selectedConnection.fromPort}` : ''}</span><span className='text-[var(--color-text-secondary)]'>目标</span><span className='truncate'>{selectedConnectionTo?.title || selectedConnection.toNodeId}{selectedConnection.toPort ? ` · ${selectedConnection.toPort}` : ''}</span><span className='text-[var(--color-text-secondary)]'>数据类型</span><span>{selectedConnection.dataType ? <Badge tone='accent'>{selectedConnection.dataType}</Badge> : <Badge>旧式视觉连接</Badge>}</span><span className='text-[var(--color-text-secondary)]'>执行策略</span><span>仅手动同步，不自动执行下游节点</span></div>
        <div className='flex gap-2'><Button onClick={() => { synchronizeSelectedConnection(); setConnectionDetailsOpen(false) }} disabled={!selectedConnection.dataType} className='flex-1'>同步数据</Button><Button onClick={() => { startReconnect(); setConnectionDetailsOpen(false) }} disabled={!selectedConnection.dataType} className='flex-1'>重连目标</Button><Button variant='danger' onClick={() => { deleteSelected(); setConnectionDetailsOpen(false) }} className='flex-1'>删除连接</Button></div>
      </div>}
    </Modal>
    <Modal title='内置画布插件诊断' open={pluginDetailsOpen} onClose={() => setPluginDetailsOpen(false)} maxWidth='max-w-2xl'>
      <div className='space-y-3'>{canvasPlugins.map(plugin => <article key={plugin.id} className='ui-list-card ui-list-card-no-hover p-3'><div className='flex items-start justify-between gap-3'><div><h3 className='text-sm font-semibold text-[var(--color-text-primary)]'>{plugin.name}</h3><p className='mt-1 text-xs text-[var(--color-text-secondary)]'>{plugin.id}</p></div><Badge tone='success'>v{plugin.version} · API {plugin.apiVersion}</Badge></div><div className='mt-3 flex flex-wrap gap-1'>{plugin.nodes.map(node => <Badge key={node.kind}>{node.title}</Badge>)}</div><div className='mt-2 flex flex-wrap gap-1'>{plugin.capabilities.map(capability => <Badge key={capability} tone='accent'>{capability}</Badge>)}</div></article>)}</div>
      <div className='ui-inline-note ui-inline-note-info mt-3 text-xs'>仅加载随应用打包的静态插件；不支持远程插件、动态代码或任意权限。</div>
    </Modal>
  </div>
}

function CanvasMiniMap({ nodes, viewport }: { nodes: CanvasNode[]; viewport: { x: number; y: number; scale: number } }) {
  if (!nodes.length) return null
  const minX = Math.min(...nodes.map(node => node.position.x)) - 120
  const minY = Math.min(...nodes.map(node => node.position.y)) - 120
  const maxX = Math.max(...nodes.map(node => node.position.x + node.width)) + 120
  const maxY = Math.max(...nodes.map(node => node.position.y + node.height)) + 120
  const width = Math.max(1, maxX - minX)
  const height = Math.max(1, maxY - minY)
  return <div className='pointer-events-none absolute bottom-3 right-3 h-24 w-36 overflow-hidden rounded border border-[var(--color-border)] bg-[var(--color-bg-secondary)]/90 p-1 shadow-lg' aria-label='画布小地图'>
    {nodes.map(node => <span key={node.id} className='absolute rounded-sm opacity-75' style={{ left: `${((node.position.x - minX) / width) * 100}%`, top: `${((node.position.y - minY) / height) * 100}%`, width: `${Math.max(3, (node.width / width) * 100)}%`, height: `${Math.max(2, (node.height / height) * 100)}%`, backgroundColor: getCanvasNodeDefinition(node.kind).minimapColor }} />)}
    <span className='absolute bottom-1 left-1 text-[9px] text-[var(--color-text-secondary)]'>缩放 {Math.round(viewport.scale * 100)}%</span>
  </div>
}
