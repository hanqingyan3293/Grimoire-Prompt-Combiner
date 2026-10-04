import { ipcMain, type WebContents } from 'electron'
import crypto from 'crypto'
import { IPC_CHANNELS } from '../../shared/types'
import type { AgentRuntimeKind, AgentSessionEventType, AgentSessionStatus } from '../../shared/agent-types'
import { requireId } from '../services/input-validation'
import { appendAgentSessionEvent, branchAgentSession, createAgentSession, deleteAgentSession, getAgentSession, listAgentSessions, updateAgentSession } from '../services/agent-session.service'
import { callMcpTool, connectMcpServer, deleteMcpServer, disconnectMcpServer, listMcpServers, saveMcpServer } from '../services/mcp.service'
import { getActiveProvider } from './providers.ipc'
import { createAgentRuntime } from '../ai/runtime/registry'
import type { ToolPermission } from '../ai/runtime/tools'
import type { RuntimeMessage } from '../ai/runtime/types'
import { createGrimoireToolRegistry } from '../ai/runtime/grimoire-tools'

type PermissionDecision = 'allowOnce' | 'allowForSession' | 'deny' | 'cancel'
const pendingPermissions = new Map<string, { sessionId: string; permission: ToolPermission; resolve: (decision: PermissionDecision) => void; timer: ReturnType<typeof setTimeout> }>()
const sessionPermissionGrants = new Map<string, Set<ToolPermission>>()

function requestAgentPermission(sender: WebContents, sessionId: string, permission: ToolPermission, detail: unknown, mode: unknown): Promise<boolean> {
  if (mode === 'full') return Promise.resolve(true)
  if (mode === 'automatic' && permission === 'read') return Promise.resolve(true)
  if (sessionPermissionGrants.get(sessionId)?.has(permission)) return Promise.resolve(true)
  const requestId = 'permission_' + crypto.randomUUID().replaceAll('-', '').slice(0, 20)
  return new Promise(resolve => {
    const timer = setTimeout(() => {
      pendingPermissions.delete(requestId)
      resolve(false)
    }, 5 * 60_000)
    pendingPermissions.set(requestId, { sessionId, permission, resolve: decision => { clearTimeout(timer); resolve(decision === 'allowOnce' || decision === 'allowForSession') }, timer })
    if (sender.isDestroyed()) {
      clearTimeout(timer)
      pendingPermissions.delete(requestId)
      resolve(false)
      return
    }
    sender.send(IPC_CHANNELS.AGENT_PERMISSION_REQUEST, { requestId, sessionId, permission, detail })
  })
}

export function registerAgentIPC(): void {
  ipcMain.handle(IPC_CHANNELS.AGENT_PERMISSION_DECISION, async (_event, value: unknown) => {
    if (!value || typeof value !== 'object') throw new Error('权限决定参数无效')
    const input = value as Record<string, unknown>
    const requestId = typeof input.requestId === 'string' ? input.requestId : ''
    const decision = input.decision as PermissionDecision
    if (!requestId || !['allowOnce', 'allowForSession', 'deny', 'cancel'].includes(decision)) throw new Error('权限决定无效')
    const pending = pendingPermissions.get(requestId)
    if (!pending) return false
    pendingPermissions.delete(requestId)
    clearTimeout(pending.timer)
    if (decision === 'allowForSession') {
      const grants = sessionPermissionGrants.get(pending.sessionId) || new Set<ToolPermission>()
      grants.add(pending.permission)
      sessionPermissionGrants.set(pending.sessionId, grants)
    }
    pending.resolve(decision)
    return true
  })
  ipcMain.handle(IPC_CHANNELS.AGENT_SESSION_LIST, async () => listAgentSessions())
  ipcMain.handle(IPC_CHANNELS.AGENT_SESSION_GET, async (_event, id: unknown) => getAgentSession(requireId(id, '会话 ID')))
  ipcMain.handle(IPC_CHANNELS.AGENT_SESSION_CREATE, async (_event, value: unknown) => {
    if (!value || typeof value !== 'object') throw new Error('会话参数无效')
    const input = value as Record<string, unknown>
    const runtime = String(input.runtime || 'openai-compatible') as AgentRuntimeKind
    if (!['openai-compatible', 'codex', 'opencode', 'pi'].includes(runtime)) throw new Error('Runtime 类型无效')
    return createAgentSession({ runtime, providerId: typeof input.providerId === 'string' ? input.providerId : undefined, model: typeof input.model === 'string' ? input.model : undefined, title: typeof input.title === 'string' ? input.title : undefined, parentId: typeof input.parentId === 'string' ? input.parentId : undefined })
  })
  ipcMain.handle(IPC_CHANNELS.AGENT_SESSION_APPEND_EVENT, async (_event, value: unknown) => {
    if (!value || typeof value !== 'object') throw new Error('会话事件参数无效')
    const input = value as Record<string, unknown>
    const type = String(input.type || 'status') as AgentSessionEventType
    if (!['message', 'tool-call', 'tool-result', 'permission', 'status', 'error'].includes(type)) throw new Error('会话事件类型无效')
    return appendAgentSessionEvent({ sessionId: requireId(input.sessionId, '会话 ID'), type, data: input.data && typeof input.data === 'object' ? input.data as Record<string, unknown> : {} })
  })
  ipcMain.handle(IPC_CHANNELS.AGENT_SESSION_SEND, async (_event, value: unknown) => {
    if (!value || typeof value !== 'object') throw new Error('Agent 消息参数无效')
    const input = value as Record<string, unknown>
    const sessionId = requireId(input.sessionId, '会话 ID')
    const content = typeof input.content === 'string' ? input.content.trim() : ''
    if (!content) throw new Error('消息内容不能为空')
    const snapshot = getAgentSession(sessionId)
    if (!snapshot) throw new Error('Agent 会话不存在')
    const provider = await getActiveProvider()
    if (!provider) throw new Error('请先配置 API 供应商')
    const providerWithSecret = provider as typeof provider & { api_key?: string; base_url?: string }
    const model = typeof input.model === 'string' && input.model.trim() ? input.model.trim() : snapshot.session.model || provider.default_model
    if (!model) throw new Error('请先选择模型')
    const sender = _event.sender
    const messages: RuntimeMessage[] = []
    for (const event of snapshot.events) {
      if (event.type === 'message' && typeof event.data.role === 'string' && typeof event.data.content === 'string') {
        messages.push({ role: event.data.role as 'user' | 'assistant' | 'system', content: String(event.data.content) })
      } else if (event.type === 'tool-call' && typeof event.data.callId === 'string' && typeof event.data.name === 'string') {
        const previous = messages[messages.length - 1]
        const calls = previous?.role === 'assistant' ? previous.toolCalls || [] : []
        if (previous?.role === 'assistant') previous.toolCalls = [...calls, { callId: event.data.callId, name: event.data.name, input: event.data.input }]
        else messages.push({ role: 'assistant', content: '', toolCalls: [{ callId: event.data.callId, name: event.data.name, input: event.data.input }] })
      } else if (event.type === 'tool-result' && typeof event.data.callId === 'string') {
        messages.push({ role: 'tool', content: JSON.stringify(event.data.output ?? null), toolCallId: event.data.callId, name: typeof event.data.name === 'string' ? event.data.name : undefined })
      }
    }
    appendAgentSessionEvent({ sessionId, type: 'message', data: { role: 'user', content } })
    updateAgentSession({ id: sessionId, status: 'running', data: { ...(snapshot.session.data || {}), providerId: provider.id, model } })
    const sessionData = snapshot.session.data || {}
    const runtimeConfig: Record<string, unknown> = snapshot.session.runtime === 'openai-compatible'
      ? { baseUrl: providerWithSecret.base_url || provider.base_url, apiKey: providerWithSecret.api_key || '' }
      : snapshot.session.runtime === 'pi'
        ? { command: typeof sessionData.command === 'string' ? sessionData.command : 'pi', args: Array.isArray(sessionData.args) ? sessionData.args : [] }
        : { endpoint: typeof sessionData.endpoint === 'string' ? sessionData.endpoint : snapshot.session.runtime === 'codex' ? 'http://127.0.0.1:17371' : 'http://127.0.0.1:4096', token: typeof sessionData.token === 'string' ? sessionData.token : '' }
    const runtime = createAgentRuntime(snapshot.session.runtime, runtimeConfig)
    const registry = createGrimoireToolRegistry()
    const toolDefinitions = registry.list().map(tool => ({ type: 'function', function: { name: tool.name, description: tool.description, parameters: tool.inputSchema } }))
    let currentMessages: RuntimeMessage[] = [...messages, { role: 'user', content }]
    let textValue = ''
    const permissionMode = snapshot.session.data?.permissionMode || 'request'
    try {
      for (let turn = 0; turn < 8; turn += 1) {
        const runtimeSession = runtime.createSession(model, currentMessages)
        let turnText = ''
        const toolCalls: Array<{ callId: string; name: string; input: unknown }> = []
        for await (const event of runtime.send({ sessionId: runtimeSession.id, model, messages: runtimeSession.messages, tools: toolDefinitions })) {
          if (event.type === 'text-delta') turnText += event.text
          if (event.type === 'tool-started') toolCalls.push({ callId: event.callId, name: event.name, input: event.input })
          if (event.type === 'completed' && event.toolCalls?.length && !toolCalls.length) toolCalls.push(...event.toolCalls)
          if (event.type === 'permission-requested') {
            const action = event.action.toLowerCase()
            const permission = action.includes('network') || action.includes('http') ? 'network' : action.includes('command') || action.includes('execute') ? 'execute' : action.includes('write') || action.includes('file') ? 'write' : 'read'
            appendAgentSessionEvent({ sessionId, type: 'permission', data: { requestId: event.requestId, permission, detail: event.detail, status: 'requested' } })
            const allowed = await requestAgentPermission(sender, sessionId, permission, event.detail || { action: event.action }, permissionMode)
            if (allowed) await runtime.approve?.({ requestId: event.requestId, decision: 'accept' })
            else await runtime.reject?.({ requestId: event.requestId, decision: 'decline' })
            appendAgentSessionEvent({ sessionId, type: 'permission', data: { requestId: event.requestId, permission, detail: event.detail, status: allowed ? 'approved' : 'denied' } })
            if (!allowed) throw new Error('Agent 权限请求被拒绝：' + event.action)
          }
          if (event.type === 'failed') throw new Error(event.error)
        }
        textValue += turnText
        if (!toolCalls.length) break
        currentMessages = [...currentMessages, { role: 'assistant', content: turnText, toolCalls }]
        for (const call of toolCalls) {
          appendAgentSessionEvent({ sessionId, type: 'tool-call', data: { callId: call.callId, name: call.name, input: call.input } })
          const result = await registry.execute(call.name, call.input, {
            runtime: snapshot.session.runtime,
            sessionId,
            permission: async (permission, detail) => {
              appendAgentSessionEvent({ sessionId, type: 'permission', data: { permission, detail, status: 'requested' } })
              const allowed = await requestAgentPermission(sender, sessionId, permission, detail, permissionMode)
              appendAgentSessionEvent({ sessionId, type: 'permission', data: { permission, detail, status: allowed ? 'approved' : 'denied' } })
              return allowed
            },
          })
          appendAgentSessionEvent({ sessionId, type: 'tool-result', data: { callId: call.callId, name: call.name, output: result } })
          currentMessages = [...currentMessages, { role: 'tool', content: JSON.stringify(result), toolCallId: call.callId, name: call.name }]
        }
      }
      appendAgentSessionEvent({ sessionId, type: 'message', data: { role: 'assistant', content: textValue } })
    } catch (error) {
      updateAgentSession({ id: sessionId, status: 'failed' })
      appendAgentSessionEvent({ sessionId, type: 'error', data: { message: error instanceof Error ? error.message : String(error) } })
      throw error
    } finally {
      await runtime.close?.()
    }
    const session = updateAgentSession({ id: sessionId, status: 'completed', data: { ...(snapshot.session.data || {}), providerId: provider.id, model } })
    return { text: textValue, session }
  })
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
  ipcMain.handle(IPC_CHANNELS.AGENT_SESSION_DELETE, async (_event, id: unknown) => deleteAgentSession(requireId(id, '会话 ID')))

  ipcMain.handle(IPC_CHANNELS.MCP_SERVER_LIST, async () => listMcpServers())
  ipcMain.handle(IPC_CHANNELS.MCP_SERVER_SAVE, async (_event, value: unknown) => {
    if (!value || typeof value !== 'object') throw new Error('MCP 配置无效')
    const input = value as Record<string, unknown>
    if (input.transport !== undefined && input.transport !== 'http' && input.transport !== 'stdio') throw new Error('MCP 传输类型无效')
    return saveMcpServer({ id: typeof input.id === 'string' ? input.id : undefined, name: typeof input.name === 'string' ? input.name : undefined, transport: input.transport as 'http' | 'stdio' | undefined, endpoint: typeof input.endpoint === 'string' ? input.endpoint : undefined, command: typeof input.command === 'string' ? input.command : undefined, args: Array.isArray(input.args) ? input.args.map(String) : undefined, env: input.env && typeof input.env === 'object' ? Object.fromEntries(Object.entries(input.env).map(([key, val]) => [key, String(val)])) : undefined, enabled: input.enabled !== false })
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
