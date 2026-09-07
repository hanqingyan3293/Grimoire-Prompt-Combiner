import type { CanvasNodeKind, CanvasPortDefinition } from '../../../shared/canvas-types'
import { AI_CANVAS_PLUGIN, CORE_CANVAS_PLUGIN, validateCanvasPluginManifest, type CanvasPluginCapability, type CanvasPluginManifest } from '../../../shared/canvas-plugin'

export interface CanvasNodeDefinition {
  kind: CanvasNodeKind
  title: string
  description: string
  defaultSize: { width: number; height: number }
  minimapColor: string
  creatable: boolean
  pluginId?: string
  capabilities?: CanvasPluginCapability[]
  ports?: CanvasPortDefinition[]
}

const definitions = new Map<CanvasNodeKind, CanvasNodeDefinition>()
const plugins = new Map<string, CanvasPluginManifest>()

export function registerCanvasNode(definition: CanvasNodeDefinition): void {
  if (definitions.has(definition.kind)) throw new Error(`画布节点类型已注册：${definition.kind}`)
  definitions.set(definition.kind, definition)
}

export function getCanvasNodeDefinition(kind: CanvasNodeKind): CanvasNodeDefinition {
  const definition = definitions.get(kind)
  if (!definition) throw new Error(`画布节点类型未注册：${kind}`)
  return definition
}

export function listCanvasNodeDefinitions(): CanvasNodeDefinition[] {
  return [...definitions.values()]
}

export function registerCanvasPlugin(manifest: CanvasPluginManifest): void {
  const plugin = validateCanvasPluginManifest(manifest)
  if (plugins.has(plugin.id)) throw new Error(`画布插件已注册：${plugin.id}`)
  const conflict = plugin.nodes.find(node => definitions.has(node.kind))
  if (conflict) throw new Error(`画布节点类型已注册：${conflict.kind}`)
  for (const node of plugin.nodes) registerCanvasNode({ ...node, pluginId: plugin.id })
  plugins.set(plugin.id, plugin)
}

export function listCanvasPlugins(): CanvasPluginManifest[] {
  return [...plugins.values()]
}

export function canvasNodeHasCapability(kind: CanvasNodeKind, capability: CanvasPluginCapability): boolean {
  return Boolean(getCanvasNodeDefinition(kind).capabilities?.includes(capability))
}

registerCanvasPlugin(CORE_CANVAS_PLUGIN)
registerCanvasPlugin(AI_CANVAS_PLUGIN)
