export type CanvasNodeKind = 'text' | 'image' | 'prompt' | 'task' | 'prompt-asset' | 'wd14' | 'comfyui'
export type CanvasDataType = 'prompt' | 'image' | 'tags'
export type CanvasPortDirection = 'input' | 'output'

export interface CanvasPortDefinition {
  id: string
  label: string
  direction: CanvasPortDirection
  dataType: CanvasDataType
}

export function isCanvasTaskNodeKind(kind: CanvasNodeKind): kind is 'task' | 'wd14' | 'comfyui' {
  return kind === 'task' || kind === 'wd14' || kind === 'comfyui'
}

export interface CanvasNodeConfig {
  assetId?: string
  imageId?: number
  modelId?: string
  threshold?: number
  workflowId?: string
}

export interface CanvasPoint {
  x: number
  y: number
}

export interface CanvasViewport {
  x: number
  y: number
  scale: number
}

export interface CanvasNode {
  id: string
  kind: CanvasNodeKind
  title: string
  content: string
  position: CanvasPoint
  width: number
  height: number
  refId?: string
  status?: 'idle' | 'running' | 'success' | 'error'
  groupId?: string
  config?: CanvasNodeConfig
}

export interface CanvasGroup {
  id: string
  title: string
}

export interface CanvasConnection {
  id: string
  fromNodeId: string
  toNodeId: string
  fromPort?: string
  toPort?: string
  dataType?: CanvasDataType
}

export interface CanvasDocument {
  version: 1
  viewport: CanvasViewport
  nodes: CanvasNode[]
  connections: CanvasConnection[]
  groups?: CanvasGroup[]
}

export interface CanvasProject {
  id: string
  name: string
  document: CanvasDocument
  created_at: string
  updated_at: string
}
