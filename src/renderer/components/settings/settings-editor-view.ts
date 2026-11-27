import { encodeWorkspaceEditorState } from '../../../shared/workspace-editor-state'
export interface SettingsEditorView { kind: 'settings-view'; version: 1; section: string; query: string; collapsed: Record<string, boolean> }
const sections = new Set(['general', 'appearance', 'api', 'ai', 'canvas', 'shortcuts', 'data', 'about'])
export function captureSettingsView(section: string, query: string, collapsed: Record<string, boolean>): SettingsEditorView {
  return validateSettingsView({ kind: 'settings-view', version: 1, section, query, collapsed })
}
export function validateSettingsView(raw: unknown): SettingsEditorView {
  const value = raw as SettingsEditorView | null
  if (!value || value.kind !== 'settings-view' || value.version !== 1 || !sections.has(value.section) || typeof value.query !== 'string' || !value.collapsed || typeof value.collapsed !== 'object' || Array.isArray(value.collapsed) || Object.keys(value).some(key => !['kind', 'version', 'section', 'query', 'collapsed'].includes(key)) || Object.entries(value.collapsed).some(([key, entry]) => !sections.has(key) || typeof entry !== 'boolean')) throw new Error('EDITOR_STATE_INVALID: 设置移交只接受分区、搜索和展开状态')
  encodeWorkspaceEditorState(value)
  return structuredClone(value)
}
