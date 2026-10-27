import { describe, expect, it } from 'vitest'
import { isWorkspacePopoutType } from './workspace-panels'

describe('workspace popout panel allowlist', () => {
  it('keeps agent and mcp panels eligible for popout', () => {
    expect(isWorkspacePopoutType('agent')).toBe(true)
    expect(isWorkspacePopoutType('agent-sessions')).toBe(true)
    expect(isWorkspacePopoutType('mcp')).toBe(true)
    expect(isWorkspacePopoutType('tag-asset-manager')).toBe(true)
    expect(isWorkspacePopoutType('tag-batch')).toBe(true)
    expect(isWorkspacePopoutType('gallery-search')).toBe(true)
    expect(isWorkspacePopoutType('logs')).toBe(true)
    expect(isWorkspacePopoutType('provider-manager')).toBe(true)
    expect(isWorkspacePopoutType('model-manager')).toBe(true)
  })

  it('rejects unknown or malformed panel types', () => {
    expect(isWorkspacePopoutType('remote-plugin')).toBe(false)
    expect(isWorkspacePopoutType(null)).toBe(false)
  })
})
