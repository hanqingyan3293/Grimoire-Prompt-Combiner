export type ComfyValue = string | number | boolean | null | ComfyValue[] | { [key: string]: ComfyValue }
export type ComfyNode = { class_type: string; inputs: Record<string, ComfyValue>; _meta?: Record<string, ComfyValue> }
export type ComfyWorkflow = Record<string, ComfyNode>
export type ComfyObjectInfo = Record<string, { input?: { required?: Record<string, unknown>; optional?: Record<string, unknown> }; input_order?: { required?: string[]; optional?: string[] }; [key: string]: unknown }>
export interface ComfySourceTarget { nodeId: string; input: string; samplerId: string }
export interface ComfyWorkflowSource {
  convertUiWorkflowToPrompt(ui: unknown, objectInfo: ComfyObjectInfo): { prompt: ComfyWorkflow; warnings: string[] }
  findPromptTarget(prompt: ComfyWorkflow): ComfySourceTarget | undefined
  applySeed(graph: ComfyWorkflow, seed: number | undefined, samplerId?: string): void
  isReference(value: unknown): value is [string, number]
  listWorkflows(baseUrl: string, signal?: AbortSignal, options?: { fetch?: typeof fetch; headers?: Record<string, string> }): Promise<string[]>
}
export interface ComfyFrontendWidgetSchema {
  positions: Array<string | null>
  advancedPositions?: Array<string | null>
}
export type ComfyFrontendWidgetSchemas = Record<string, ComfyFrontendWidgetSchema>
export interface ParseComfyFrontendOptions { schemas?: ComfyFrontendWidgetSchemas; objectInfo?: unknown }
export interface ComfyFrontendParseResult { workflow: ComfyWorkflow; warnings: string[] }

export interface ComfyPublicWorkflow {
  id: string
  name: string
  source: string
  analysis: { nodeCount?: number; warnings?: string[]; bindings?: Array<{ key: string; nodeId: string; field: string }> }
  bindings: Array<{ key: string; label: string; nodeId: string; field: string; valueType: 'string' | 'number' | 'integer' | 'json' }>
  defaults: Record<string, unknown>
  created_at: string
  updated_at: string
}
