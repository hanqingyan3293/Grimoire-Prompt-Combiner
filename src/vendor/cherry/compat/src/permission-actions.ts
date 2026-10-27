/**
 * Pure helpers behind the source tool-approval actions (`respondToolApproval`,
 * `useToolApproval.autoApprove`).
 *
 * These live outside the entry component so the rules can be tested directly: the
 * component only wires them to the Host bridge. Everything here is a decision, not a
 * side effect — the caller performs the IPC.
 */

/** Grimoire registers an MCP tool under `mcp:<serverId>:<toolName>`. */
const MCP_REGISTERED_TOOL = /^mcp:([^:]+):(.+)$/

export type McpToolIdentity = { serverId: string; toolName: string }

/**
 * Resolves the MCP server + tool a registered tool name refers to, or `null` when the
 * name is not an MCP tool.
 *
 * The source exposes its "always allow" action only for tools that have a per-tool
 * auto-approve store, and only MCP servers have one. A non-MCP name therefore has no
 * rule to persist, and the caller must not pretend otherwise.
 */
export function parseMcpToolIdentity(registeredName: string): McpToolIdentity | null {
  const match = MCP_REGISTERED_TOOL.exec(String(registeredName || ''))
  if (!match) return null
  const [, serverId, toolName] = match
  if (!serverId || !toolName) return null
  return { serverId, toolName }
}

/**
 * The `disabledAutoApproveTools` list after "always allow" for `toolName`.
 *
 * The list is a DENYLIST of tools forced to prompt, so granting auto-approve REMOVES
 * the tool from it (source `persistAutoApprove`). Returns `null` when the tool was not
 * in the list — the source returns early in that case, because the tool is already
 * auto-approved server-side and writing an unchanged value would be a no-op write
 * reported as a success.
 */
export function withoutToolFromDenylist(disabledTools: unknown, toolName: string): string[] | null {
  const current = Array.isArray(disabledTools) ? disabledTools.map(String) : []
  if (!current.includes(toolName)) return null
  return current.filter(name => name !== toolName)
}

/**
 * The approval id a source `MessageToolApprovalInput` refers to, or an empty string.
 *
 * `match.approvalId` identifies the approval to settle. The source always populates it
 * from the matched part; an empty value means the part could not be resolved, and the
 * caller must fail rather than answer a request it cannot name.
 */
export function approvalIdFromInput(input: unknown): string {
  const match = (input as { match?: { approvalId?: unknown } } | null | undefined)?.match
  return String(match?.approvalId || '')
}

/**
 * The decision to send for a plain allow/deny answer.
 *
 * Deliberately NOT `allowForSession`: Grimoire's session grant is keyed by permission
 * KIND, so answering an approval with it would authorise every future tool of that
 * kind — far broader than what the user was asked. An allow/deny answer settles the
 * call and nothing else; a persistent rule goes through {@link withoutToolFromDenylist}
 * for the one tool the user actually named.
 */
export function decisionForApproval(approved: unknown): 'allowOnce' | 'deny' {
  return approved === true ? 'allowOnce' : 'deny'
}

/**
 * Source `isToolAutoApproved` semantics: a tool on a known MCP server whose name is NOT
 * on that server's force-prompt denylist runs without asking.
 *
 * NOT YET WIRED — kept here with its tests because the rule is the other half of the
 * "always allow" action above and the reason that action can be verified at all. The
 * source reads this through `MessageListUiSelectorsContext`, which the compat entry
 * cannot populate today: `MessageContentProvider` (the wrapper the entry mounts) builds
 * its provider value from a narrow `state` slice and never forwards `isToolAutoApproved`
 * — the field exists on `MessageListState`, which that wrapper does not accept. Wiring
 * it means mounting `MessageListProvider` directly with a full provider value, which is
 * a larger change to the entry's composition than this slice.
 *
 * Until then the compat window's MCP tool cards do not render the auto-approved badge
 * and always show the approval affordance — over-prompting, which is the safe direction
 * and never a fake auto-approval.
 */
export function isToolAutoApproved(
  tool: { name?: unknown; serverId?: unknown } | null | undefined,
  servers: readonly { id?: unknown; disabled_auto_approve_tools?: unknown }[] | null | undefined
): boolean {
  if (!tool || !Array.isArray(servers)) return false
  const serverId = String(tool.serverId ?? '')
  if (!serverId) return false
  const server = servers.find(candidate => String(candidate?.id ?? '') === serverId)
  // An unknown server answers false: prompting is the safe direction, and the source
  // does the same (`server ? … : false`).
  if (!server) return false
  const toolName = String(tool.name ?? '')
  const disabled = Array.isArray(server.disabled_auto_approve_tools)
    ? (server.disabled_auto_approve_tools as unknown[]).map(String)
    : []
  return !disabled.includes(toolName)
}
