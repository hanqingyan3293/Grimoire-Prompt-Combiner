import { ipcMain, type WebContents } from 'electron'
import crypto from 'crypto'
import { IPC_CHANNELS } from '../../shared/types'
import type { AgentRuntimeKind, AgentSessionEventType, AgentSessionSnapshot, AgentSessionStatus, AgentSessionWorkspace, McpServerRecord } from '../../shared/agent-types'
import { requireId } from '../services/input-validation'
import { appendAgentSessionEvent, attachAgentSession, branchAgentSession, createAgentSession, deleteAgentSession, getAgentSession, listAgentSessions, snapshotAgentSession, updateAgentSession } from '../services/agent-session.service'
import { callMcpTool, connectMcpServer, deleteMcpServer, disconnectMcpServer, isMcpToolForcePrompt, listMcpServers, saveMcpServer } from '../services/mcp.service'
import { getActiveProvider } from './providers.ipc'
import { agentRuntimeSessionDirectory, resolveAgentRuntimeCommand, runtimeSelectionContract, startOpenCodeRuntime } from '../services/agent-runtime-manager'
import { createAgentRuntime } from '../ai/runtime/registry'
import { runtimePermissionForAction, type ToolPermission } from '../ai/runtime/tools'
import type { RuntimeMessage, RuntimeSession } from '../ai/runtime/types'
import { createGrimoireToolRegistry } from '../ai/runtime/grimoire-tools'
import { runAgentRuntimeLoop } from '../services/agent-runtime-turn.service'
import { admitRuntimeTurn } from '../services/agent-runtime-admission.service'
import { RuntimePermissionBroker } from '../services/agent-runtime-permission.service'
import { prepareNativeRuntime } from '../services/agent-runtime-preparation.service'
import { attachRuntimeExecutionReference, beginRuntimeExecutionReference, type RuntimeExecutionIdentity } from '../services/agent-runtime-reference.service'
import { safeRuntimeError } from '../services/agent-runtime-safety.service'
import { piSdkHostTools, piSdkPermission } from '../services/pi-sdk-tool-bridge.service'
import { composeAgentSystemPrompt } from '../services/cherry-preference-consumers'
import { CherryAgentRuntimeUnavailableError, createCherryAgentRuntimePump } from '../services/cherry-agent-stream.service'
import { runtimeModelFallback } from '../../shared/runtime-contract'

function readAgentId(input: Record<string, unknown>): string | null | undefined {
  const value = input.agentId
  if (value !== undefined && value !== null && typeof value !== 'string') throw new Error('AGENT_SESSION_INVALID_AGENT_ID')
  return value as string | null | undefined
}

type PermissionDecision = 'allowOnce' | 'allowForSession' | 'deny' | 'cancel'
const permissions = new RuntimePermissionBroker()

export function shutdownAgentPermissionBroker(): void { permissions.shutdown() }

async function requestAgentPermission(sender: WebContents, sessionId: string, permission: ToolPermission, detail: unknown, mode: unknown, forcePrompt = false, signal?: AbortSignal, scope = 'agent:' + sessionId): Promise<boolean> {
  const decision = await permissions.request({ sender, sessionId, scope, permission, detail, mode, forcePrompt, signal, channel: IPC_CHANNELS.AGENT_PERMISSION_REQUEST })
  return decision === 'allowOnce' || decision === 'allowForSession'
}

/**
 * Maps a renderer `MCP_SERVER_SAVE` payload onto the fields `saveMcpServer` accepts.
 *
 * Every field here must be forwarded: this is the path the compat window's MCP detail
 * form and its per-tool "always allow" action write through, so silently dropping one
 * turns the corresponding control into a no-op that still reports success. The v24/v25
 * columns in particular each drive runtime behaviour (auto-approve suppression, the
 * tool-call timeout policy, the stdio launch env, list search), so a dropped write is
 * not cosmetic.
 *
 * `stored` is the row read WITH secrets: masked `••••••••` placeholders echoed back by
 * the renderer restore the stored value instead of persisting the mask. Exported for
 * direct testing — the handler itself needs an `ipcMain` to register against.
 */
export function toMcpSaveInput(
  input: Record<string, unknown>,
  stored: McpServerRecord | undefined
): Partial<McpServerRecord> {
  const restoreMasked = (source: unknown, current: Record<string, string> | undefined): Record<string, string> | undefined => {
    if (!source || typeof source !== 'object') return undefined
    return Object.fromEntries(Object.entries(source as Record<string, unknown>).map(([key, val]) => {
      const text = String(val)
      return [key, text === '••••••••' ? (current?.[key] ?? '') : text]
    }))
  }
  return {
    id: typeof input.id === 'string' ? input.id : undefined,
    name: typeof input.name === 'string' ? input.name : undefined,
    transport: input.transport as 'http' | 'stdio' | undefined,
    endpoint: typeof input.endpoint === 'string' ? input.endpoint : undefined,
    command: typeof input.command === 'string' ? input.command : undefined,
    args: Array.isArray(input.args) ? input.args.map(String) : undefined,
    env: restoreMasked(input.env, stored?.env),
    ...(input.description !== undefined ? { description: typeof input.description === 'string' ? input.description : '' } : {}),
    ...(input.headers !== undefined ? { headers: restoreMasked(input.headers, stored?.headers) || {} } : {}),
    ...(typeof input.timeout === 'number' ? { timeout_seconds: input.timeout > 0 ? input.timeout : null } : {}),
    // v24 columns the tools tab writes.
    ...(Array.isArray(input.disabled_auto_approve_tools)
      ? { disabled_auto_approve_tools: input.disabled_auto_approve_tools.map(String) }
      : {}),
    // v25 columns the detail form writes.
    ...(typeof input.long_running === 'boolean' ? { long_running: input.long_running } : {}),
    ...(typeof input.registry_url === 'string' ? { registry_url: input.registry_url } : {}),
    ...(Array.isArray(input.tags) ? { tags: input.tags.map(String).filter(tag => tag.trim().length > 0) } : {}),
    enabled: input.enabled !== false
  }
}

// Same contract as the AI side: the source approval route carries one id and one boolean,
// and the broker decides. Unknown/stale ids return false rather than pretending to apply.
export function decideAgentSessionPermission(sender: Electron.WebContents, requestId: string, decision: 'allowOnce' | 'allowForSession' | 'deny' | 'cancel'): boolean {
  if (!requestId || !['allowOnce', 'allowForSession', 'deny', 'cancel'].includes(decision)) return false
  return permissions.decide(sender, requestId, decision)
}

export function registerAgentIPC(): void {
  // Explicit unavailable boundary, not source ai.stream integration. No leases,
  // pending messages, process launches or subscriptions are created here.
  for (const channel of [IPC_CHANNELS.CHERRY_AGENT_STREAM_OPEN, IPC_CHANNELS.CHERRY_AGENT_STREAM_ATTACH, IPC_CHANNELS.CHERRY_AGENT_STREAM_ABORT, IPC_CHANNELS.CHERRY_AGENT_STREAM_CLOSE]) {
    ipcMain.handle(channel, async () => {
      try { await createCherryAgentRuntimePump('', '') } catch (error) {
        if (error instanceof CherryAgentRuntimeUnavailableError) return { status: 'unavailable', code: error.code, dependency: error.dependency }
        throw error
      }
      throw new Error('CHERRY_AGENT_STREAM_UNAVAILABLE_BOUNDARY_CHANGED')
    })
  }

  ipcMain.handle(IPC_CHANNELS.AGENT_PERMISSION_DECISION, async (_event, value: unknown) => {
    if (!value || typeof value !== 'object') throw new Error('权限决定参数无效')
    const input = value as Record<string, unknown>
    const requestId = typeof input.requestId === 'string' ? input.requestId : ''
    const decision = input.decision as PermissionDecision
    if (!requestId || !['allowOnce', 'allowForSession', 'deny', 'cancel'].includes(decision)) throw new Error('权限决定无效')
    return permissions.decide(_event.sender, requestId, decision)
  })
  ipcMain.handle(IPC_CHANNELS.AGENT_SESSION_LIST, async () => listAgentSessions())
  ipcMain.handle(IPC_CHANNELS.AGENT_SESSION_GET, async (_event, id: unknown) => getAgentSession(requireId(id, '会话 ID')))
  ipcMain.handle(IPC_CHANNELS.AGENT_SESSION_CREATE, async (_event, value: unknown) => {
    if (!value || typeof value !== 'object') throw new Error('会话参数无效')
    const input = value as Record<string, unknown>
    const runtime = String(input.runtime || 'openai-compatible') as AgentRuntimeKind
    if (!['openai-compatible', 'codex', 'opencode', 'pi'].includes(runtime)) throw new Error('Runtime 类型无效')
    return createAgentSession({
      runtime,
      providerId: typeof input.providerId === 'string' ? input.providerId : undefined,
      model: typeof input.model === 'string' ? input.model : undefined,
      title: typeof input.title === 'string' ? input.title : undefined,
      parentId: typeof input.parentId === 'string' ? input.parentId : undefined,
      agentId: readAgentId(input),
      workspace: input.workspace as AgentSessionWorkspace | undefined,
      attachments: input.attachments as unknown[] | undefined,
      snapshot: input.snapshot as AgentSessionSnapshot | undefined,
    })
  })
  ipcMain.handle(IPC_CHANNELS.AGENT_SESSION_APPEND_EVENT, async (_event, value: unknown) => {
    if (!value || typeof value !== 'object') throw new Error('会话事件参数无效')
    const input = value as Record<string, unknown>
    const type = String(input.type || 'status') as AgentSessionEventType
    if (!['message', 'tool-call', 'tool-result', 'permission', 'status', 'error'].includes(type)) throw new Error('会话事件类型无效')
    return appendAgentSessionEvent({ sessionId: requireId(input.sessionId, '会话 ID'), type, data: input.data && typeof input.data === 'object' ? input.data as Record<string, unknown> : {} })
  })
  ipcMain.handle(IPC_CHANNELS.AGENT_SESSION_SEND, handleAgentSessionSend)
  ipcMain.handle(IPC_CHANNELS.AGENT_SESSION_BRANCH, async (_event, value: unknown) => {
    const input = value && typeof value === 'object' ? value as Record<string, unknown> : {}
    return branchAgentSession({ sessionId: requireId(input.sessionId, '会话 ID'), title: typeof input.title === 'string' ? input.title : undefined })
  })
  ipcMain.handle(IPC_CHANNELS.AGENT_SESSION_UPDATE, async (_event, value: unknown) => {
    if (!value || typeof value !== 'object') throw new Error('会话更新参数无效')
    const input = value as Record<string, unknown>
    const status = input.status as AgentSessionStatus | undefined
    if (status && !['idle', 'running', 'completed', 'failed', 'interrupted'].includes(status)) throw new Error('会话状态无效')
    return updateAgentSession({ id: requireId(input.id, '会话 ID'), status, title: typeof input.title === 'string' ? input.title : undefined, data: input.data && typeof input.data === 'object' ? input.data as Record<string, unknown> : undefined })
  })
  ipcMain.handle(IPC_CHANNELS.AGENT_SESSION_ATTACH, async (_event, value: unknown) => {
    if (!value || typeof value !== 'object') throw new Error('会话附件参数无效')
    const input = value as Record<string, unknown>
    return attachAgentSession({
      id: requireId(input.id, '会话 ID'),
      agentId: readAgentId(input),
      workspace: input.workspace as AgentSessionWorkspace | undefined,
      attachments: input.attachments as unknown[] | undefined,
    })
  })
  ipcMain.handle(IPC_CHANNELS.AGENT_SESSION_SNAPSHOT, async (_event, value: unknown) => {
    if (!value || typeof value !== 'object') throw new Error('会话快照参数无效')
    const input = value as Record<string, unknown>
    if (!input.snapshot || typeof input.snapshot !== 'object' || Array.isArray(input.snapshot)) throw new Error('会话快照参数无效')
    return snapshotAgentSession({ id: requireId(input.id, '会话 ID'), snapshot: input.snapshot as AgentSessionSnapshot })
  })
  ipcMain.handle(IPC_CHANNELS.AGENT_SESSION_DELETE, async (_event, id: unknown) => {
    const sessionId = requireId(id, '会话 ID')
    const result = deleteAgentSession(sessionId)
    permissions.clearScopes('agent:' + sessionId)
    return result
  })

  ipcMain.handle(IPC_CHANNELS.MCP_SERVER_LIST, async () => listMcpServers())
  ipcMain.handle(IPC_CHANNELS.MCP_SERVER_SAVE, async (_event, value: unknown) => {
    if (!value || typeof value !== 'object') throw new Error('MCP 配置无效')
    const input = value as Record<string, unknown>
    if (input.transport !== undefined && input.transport !== 'http' && input.transport !== 'stdio') throw new Error('MCP 传输类型无效')
    // `env`/`headers` values read back from the renderer are masked placeholders; a
    // save that echoes one keeps the stored secret instead of persisting the mask.
    const storedRecord = typeof input.id === 'string' ? listMcpServers(true).find(server => server.id === input.id) : undefined
    return saveMcpServer(toMcpSaveInput(input, storedRecord))
  })
  ipcMain.handle(IPC_CHANNELS.MCP_SERVER_DELETE, async (_event, id: unknown) => deleteMcpServer(requireId(id, 'MCP Server ID')))
  ipcMain.handle(IPC_CHANNELS.MCP_SERVER_DISCONNECT, async (_event, id: unknown) => disconnectMcpServer(requireId(id, 'MCP Server ID')))
  ipcMain.handle(IPC_CHANNELS.MCP_SERVER_CONNECT, async (_event, id: unknown) => connectMcpServer(requireId(id, 'MCP Server ID')))
  ipcMain.handle(IPC_CHANNELS.MCP_SERVER_CALL_TOOL, async (_event, value: unknown) => {
    if (!value || typeof value !== 'object') throw new Error('MCP 工具调用参数无效')
    const input = value as Record<string, unknown>
    const name = typeof input.name === 'string' ? input.name.trim() : ''
    if (!name) throw new Error('MCP 工具名称不能为空')
    return callMcpTool({ serverId: requireId(input.serverId, 'MCP Server ID'), name, arguments: input.arguments && typeof input.arguments === 'object' ? input.arguments as Record<string, unknown> : {} })
  })
}

export type AgentStreamHooks = {
  onTextDelta?: (text: string) => void
  onReasoningDelta?: (text: string) => void
  onPermissionRequest?: (requestId: string, detail: { permission: string; detail: unknown }) => void
}

export async function handleAgentSessionSend(_event: { sender: Electron.WebContents }, value: unknown, hooks?: AgentStreamHooks) {

    if (!value || typeof value !== 'object') throw new Error('Agent 消息参数无效')
    const input = value as Record<string, unknown>
    const sessionId = requireId(input.sessionId, '会话 ID')
    const content = typeof input.content === 'string' ? input.content.trim() : ''
    if (!content) throw new Error('消息内容不能为空')
    const admission = admitRuntimeTurn('agent:' + sessionId, _event.sender)
    try {
    const snapshot = getAgentSession(sessionId)
    if (!snapshot) throw new Error('Agent 会话不存在')
    const provider = await getActiveProvider()
    if (!provider) throw new Error('请先配置 API 供应商')
    const providerWithSecret = provider as typeof provider & { api_key?: string; base_url?: string }
    const model = runtimeModelFallback({
      contract: runtimeSelectionContract(snapshot.session.runtime),
      explicitModel: typeof input.model === 'string' ? input.model : '',
      sessionModel: snapshot.session.model,
      providerDefaultModel: provider.default_model,
    })
    if (!model) throw new Error('请先选择模型')
    const sender = _event.sender
    const messages: RuntimeMessage[] = []
    for (const event of snapshot.events) {
      if (event.type === 'message' && typeof event.data.role === 'string' && typeof event.data.content === 'string') {
        messages.push({ role: event.data.role as 'user' | 'assistant' | 'system', content: String(event.data.content) })
      } else if (event.type === 'tool-call' && !event.data.telemetry && typeof event.data.callId === 'string' && typeof event.data.name === 'string') {
        const previous = messages[messages.length - 1]
        const calls = previous?.role === 'assistant' ? previous.toolCalls || [] : []
        if (previous?.role === 'assistant') previous.toolCalls = [...calls, { callId: event.data.callId, name: event.data.name, input: event.data.input }]
        else messages.push({ role: 'assistant', content: '', toolCalls: [{ callId: event.data.callId, name: event.data.name, input: event.data.input }] })
      } else if (event.type === 'tool-result' && !event.data.telemetry && typeof event.data.callId === 'string') {
        messages.push({ role: 'tool', content: JSON.stringify(event.data.output ?? null), toolCallId: event.data.callId, name: typeof event.data.name === 'string' ? event.data.name : undefined })
      }
    }
    admission.signal.throwIfAborted()
    appendAgentSessionEvent({ sessionId, type: 'message', data: { role: 'user', content } })
    updateAgentSession({ id: sessionId, status: 'running', data: { ...(snapshot.session.data || {}), providerId: provider.id, model } })
    const sessionData = snapshot.session.data || {}
    const registry = createGrimoireToolRegistry()
    let restoreSession: RuntimeSession | undefined
    let ownsToolDefinitions = false
    let releaseManagedOpenCode: (() => Promise<void>) | undefined
    let nativeIdentity: RuntimeExecutionIdentity | undefined
    let runtimeConfig: Record<string, unknown>
    if (snapshot.session.runtime === 'openai-compatible') {
      runtimeConfig = { baseUrl: providerWithSecret.base_url || provider.base_url, apiKey: providerWithSecret.api_key || '' }
    } else if (snapshot.session.runtime === 'pi' || snapshot.session.runtime === 'opencode') {
      const prepared = await prepareNativeRuntime({ store: 'agent', sessionId, kind: snapshot.session.runtime, provider: providerWithSecret, model, metadata: sessionData, signal: admission.signal,
        history: messages, systemPrompt: composeAgentSystemPrompt(messages.filter(message => message.role === 'system').map(message => message.content).join('\n\n')), hostTools: piSdkHostTools(registry, sessionId) })
      runtimeConfig = prepared.config
      nativeIdentity = prepared.identity
      restoreSession = prepared.restoreSession
      ownsToolDefinitions = prepared.ownsToolDefinitions === true
      releaseManagedOpenCode = prepared.release
    } else {
      runtimeConfig = { endpoint: typeof sessionData.endpoint === 'string' ? sessionData.endpoint : snapshot.session.runtime === 'codex' ? 'http://127.0.0.1:17371' : 'http://127.0.0.1:4096', token: typeof sessionData.token === 'string' ? sessionData.token : '' }
    }
    let runtime!: ReturnType<typeof createAgentRuntime>
    try {
      runtime = createAgentRuntime(snapshot.session.runtime, runtimeConfig)
    } catch (error) {
      await releaseManagedOpenCode?.()
      throw error
    }
    const toolDefinitions = registry.list().map(tool => ({ type: 'function', function: { name: tool.name, description: tool.description, parameters: tool.inputSchema } }))
    let currentMessages: RuntimeMessage[] = [...messages, { role: 'user', content }]
    let textValue = ''
    const permissionMode = snapshot.session.data?.permissionMode || 'request'
    let runtimeSession: ReturnType<typeof runtime.createSession> | undefined
    let cancelled = false
    try {
      if (restoreSession) {
        if (!runtime.loadSession) throw new Error('RUNTIME_RESTORE_UNAVAILABLE')
        runtime.loadSession(restoreSession)
      }
      runtimeSession = restoreSession || runtime.createSession(model, ownsToolDefinitions ? [] : currentMessages)
      if (nativeIdentity) beginRuntimeExecutionReference('agent', sessionId, nativeIdentity)
      admission.setCancel(async () => { cancelled = true; await runtime!.interrupt?.(runtimeSession!.id) })
      admission.signal.throwIfAborted()
      const loopResult = await runAgentRuntimeLoop({
        runtime,
        runtimeSession,
        model,
        messages: currentMessages,
        tools: ownsToolDefinitions ? undefined : toolDefinitions,
        isCancelled: () => admission.signal.aborted,
        onEvent: async event => {
          if (event.type === 'session-started') { /* native checkpoint is committed only after a settled turn */ }
          // Live deltas for the compat agent page. They are NOT persisted per-delta: the
          // assistant message written at the end carries the full text, and writing every
          // chunk would multiply history size without adding information.
          if (event.type === 'text-delta') { sender.send(IPC_CHANNELS.AGENT_SESSION_STREAM, { sessionId, phase: 'text', text: event.text }); hooks?.onTextDelta?.(event.text) }
          if (event.type === 'reasoning-delta') { sender.send(IPC_CHANNELS.AGENT_SESSION_STREAM, { sessionId, phase: 'reasoning', text: event.text }); hooks?.onReasoningDelta?.(event.text) }
          // Native tool telemetry is persisted for presentation, never re-executed.
          if (event.type === 'tool-started') appendAgentSessionEvent({ sessionId, type: 'tool-call', data: { callId: event.callId, name: event.name, input: event.input, telemetry: true } })
          if (event.type === 'tool-progress' || event.type === 'tool-finished') appendAgentSessionEvent({ sessionId, type: event.type === 'tool-finished' ? 'tool-result' : 'status', data: { ...event, telemetry: true } })
          if (event.type === 'cancelled') cancelled = true
          if (event.type === 'permission-requested') {
            const host = ownsToolDefinitions ? piSdkPermission(registry, event.action, event.detail) : undefined
            if (ownsToolDefinitions && !host) throw new Error('RUNTIME_UNREGISTERED_TOOL_PERMISSION')
            const permission = host?.permission || runtimePermissionForAction(event.action)
            const detail = host?.detail || event.detail || { action: event.action }
            appendAgentSessionEvent({ sessionId, type: 'permission', data: { requestId: event.requestId, permission, detail, status: 'requested' } })
            hooks?.onPermissionRequest?.(event.requestId, { permission, detail })
            const decision = await permissions.request({ sender, sessionId, scope: 'agent:' + sessionId + ':' + (nativeIdentity?.configFingerprint || snapshot.session.runtime), permission, action: host?.action || event.action, detail, native: !ownsToolDefinitions, mode: permissionMode, signal: admission.signal, requestId: event.requestId, channel: IPC_CHANNELS.AGENT_PERMISSION_REQUEST })
            const allowed = decision === 'allowOnce' || decision === 'allowForSession'
            if (!admission.signal.aborted) {
              const approval = { requestId: event.requestId, decision: allowed ? 'accept' as const : 'decline' as const, sessionId: runtimeSession?.id, action: event.action }
              if (allowed) await runtime.approve?.(approval)
              else await runtime.reject?.(approval)
            }
            appendAgentSessionEvent({ sessionId, type: 'permission', data: { requestId: event.requestId, permission, detail: event.detail, status: decision } })
          }
        },
        onHostTool: (phase, call, result) => {
          if (phase === 'started') appendAgentSessionEvent({ sessionId, type: 'tool-call', data: { callId: call.callId, name: call.name, input: call.input } })
          else appendAgentSessionEvent({ sessionId, type: 'tool-result', data: { callId: call.callId, name: call.name, output: result } })
        },
        executeHostTool: call => registry.execute(call.name, call.input, {
          runtime: snapshot.session.runtime,
          sessionId,
          toolCallId: call.callId,
          permission: async (permission, detail) => {
            appendAgentSessionEvent({ sessionId, type: 'permission', data: { permission, detail, status: 'requested' } })
            const allowed = await requestAgentPermission(sender, sessionId, permission, detail, permissionMode, isMcpToolForcePrompt(call.name), admission.signal, 'agent:' + sessionId + ':' + (nativeIdentity?.configFingerprint || snapshot.session.runtime))
            appendAgentSessionEvent({ sessionId, type: 'permission', data: { permission, detail, status: allowed ? 'approved' : 'denied' } })
            return allowed
          },
        }),
      })
      cancelled = loopResult.cancelled
      textValue = loopResult.text
      appendAgentSessionEvent({ sessionId, type: 'message', data: { role: 'assistant', content: textValue } })
      sender.send(IPC_CHANNELS.AGENT_SESSION_STREAM, { sessionId, phase: 'done', status: cancelled ? 'paused' : 'success' })
    } catch (error) {
      if (admission.signal.aborted) {
        updateAgentSession({ id: sessionId, status: 'interrupted' })
      } else {
        updateAgentSession({ id: sessionId, status: 'failed' })
        appendAgentSessionEvent({ sessionId, type: 'error', data: { message: safeRuntimeError(error, [providerWithSecret.api_key]) } })
        sender.send(IPC_CHANNELS.AGENT_SESSION_STREAM, { sessionId, phase: 'error', message: safeRuntimeError(error, [providerWithSecret.api_key]) })
      }
      throw error
    } finally {
      try {
        try { if (runtimeSession) await runtime.interrupt?.(runtimeSession.id) } finally { await runtime.close?.() }
      } finally {
        await releaseManagedOpenCode?.()
      }
    }
    const runtimeReference = runtime.getSessionReference?.(runtimeSession!.id)
    if (!cancelled && nativeIdentity && runtimeReference) attachRuntimeExecutionReference('agent', sessionId, nativeIdentity, runtimeReference)
    const session = updateAgentSession({ id: sessionId, status: cancelled ? 'interrupted' : 'completed', data: { ...(snapshot.session.data || {}), providerId: provider.id, model } })
    return { text: textValue, session }
    } finally { admission.release() }

}
