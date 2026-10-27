import { describe, expect, it } from 'vitest'
import {
  approvalIdFromInput,
  decisionForApproval,
  isToolAutoApproved,
  parseMcpToolIdentity,
  withoutToolFromDenylist
} from './permission-actions'

describe('tool approval actions', () => {
  it('resolves the MCP server and tool from a registered tool name', () => {
    expect(parseMcpToolIdentity('mcp:pvd_docs:search')).toEqual({ serverId: 'pvd_docs', toolName: 'search' })
    // A colon inside the tool name belongs to the tool, not the separator.
    expect(parseMcpToolIdentity('mcp:srv:ns:deep_tool')).toEqual({ serverId: 'srv', toolName: 'ns:deep_tool' })
    // Non-MCP tools have no per-tool auto-approve store in the source.
    expect(parseMcpToolIdentity('bash')).toBeNull()
    expect(parseMcpToolIdentity('mcp:srv')).toBeNull()
    expect(parseMcpToolIdentity('mcp::tool')).toBeNull()
    expect(parseMcpToolIdentity('')).toBeNull()
  })

  it('removes the tool from the force-prompt denylist, or reports nothing to do', () => {
    // Granting auto-approve removes the tool's force-prompt rule.
    expect(withoutToolFromDenylist(['search', 'write'], 'search')).toEqual(['write'])
    expect(withoutToolFromDenylist(['search'], 'search')).toEqual([])
    // Already auto-approved server-side: the source returns early rather than writing
    // an unchanged value and reporting a success.
    expect(withoutToolFromDenylist(['write'], 'search')).toBeNull()
    expect(withoutToolFromDenylist([], 'search')).toBeNull()
    expect(withoutToolFromDenylist(undefined, 'search')).toBeNull()
    // A malformed stored value is treated as an empty denylist, not a crash.
    expect(withoutToolFromDenylist('not-an-array', 'search')).toBeNull()
  })

  it('reads the approval id the source action must settle', () => {
    expect(approvalIdFromInput({ match: { approvalId: 'appr_1' }, approved: true })).toBe('appr_1')
    // The composer path may hand over a bare request id when no part matched.
    expect(approvalIdFromInput({ match: {} })).toBe('')
    expect(approvalIdFromInput({})).toBe('')
    expect(approvalIdFromInput(null)).toBe('')
  })

  it('decides tool auto-approval from the owning server’s force-prompt denylist', () => {
    const servers = [{ id: 'srv', disabled_auto_approve_tools: ['search'] }]
    // On the denylist → always prompts.
    expect(isToolAutoApproved({ name: 'search', serverId: 'srv' }, servers)).toBe(false)
    // Any other tool on a known server runs without prompting.
    expect(isToolAutoApproved({ name: 'write', serverId: 'srv' }, servers)).toBe(true)
    // Unknown server / missing id / absent list all answer false — prompting is safe.
    expect(isToolAutoApproved({ name: 'search', serverId: 'ghost' }, servers)).toBe(false)
    expect(isToolAutoApproved({ name: 'search' }, servers)).toBe(false)
    expect(isToolAutoApproved({ name: 'search', serverId: 'srv' }, null)).toBe(false)
    expect(isToolAutoApproved(null, servers)).toBe(false)
    // A server with no denylist auto-approves all of its tools (the source reads a
    // missing `disabledAutoApproveTools` as an empty denylist).
    expect(isToolAutoApproved({ name: 'anything', serverId: 'srv' }, [{ id: 'srv' }])).toBe(true)
    // A malformed stored value is treated as an empty denylist, not a crash.
    expect(isToolAutoApproved({ name: 'search', serverId: 'srv' }, [{ id: 'srv', disabled_auto_approve_tools: 'nope' }])).toBe(true)
  })

  it('answers an allow/deny for this call only, never a session-wide grant', () => {
    expect(decisionForApproval(true)).toBe('allowOnce')
    expect(decisionForApproval(false)).toBe('deny')
    // Only an explicit boolean true approves; anything else (including a missing flag,
    // or a truthy string) denies rather than silently granting.
    expect(decisionForApproval(undefined)).toBe('deny')
    expect(decisionForApproval('true')).toBe('deny')
    expect(decisionForApproval(1)).toBe('deny')
  })
})
