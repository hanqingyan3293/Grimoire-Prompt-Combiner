export const WORKSPACE_POPOUT_TYPES = new Set([
  'tag-sidebar', 'prompt-workbench', 'utility-sidebar', 'presets', 'history', 'images',
  'agent', 'ai-assistant', 'ai-chat', 'ai-vision', 'agent-sessions', 'mcp', 'settings', 'logs', 'provider-manager', 'model-manager',
  'tasks', 'wd14', 'comfyui', 'canvas', 'prompt-assets', 'tag-asset-manager', 'gallery-search',
  'novelai-workbench', 'novelai-assets',
]) as ReadonlySet<string>

export function isWorkspacePopoutType(value: unknown): value is string {
  return typeof value === 'string' && WORKSPACE_POPOUT_TYPES.has(value)
}
