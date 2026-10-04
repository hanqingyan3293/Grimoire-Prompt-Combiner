import { describe, expect, it } from 'vitest'
import { isWorkspacePopoutType } from './workspace-panels'

describe('workspace popout panel allowlist', () => {
  it('keeps agent and mcp panels eligible for popout', () => {
    expect(isWorkspacePopoutType('agent-sessions')).toBe(true)
    expect(isWorkspacePopoutType('mcp')).toBe(true)
  })

  it('rejects unknown or malformed panel types', () => {
    expect(isWorkspacePopoutType('remote-plugin')).toBe(false)
    expect(isWorkspacePopoutType(null)).toBe(false)
  })
})
