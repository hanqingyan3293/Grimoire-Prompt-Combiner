import { BrowserWindow, ipcMain } from "electron"
import crypto from "crypto"
import { IPC_CHANNELS } from "../../shared/types"
import { getDatabase } from "../database"
import type { AiMessageRole, AiMessageStatus, AiRuntimeKind, AiSessionKind, AiSessionStatus } from "../../shared/ai-types"
import { appendAiEvent, appendAiMessage, archiveAiSession, branchAiSession, createAiPermission, createAiSession, deleteAiMessage, deleteAiSession, getAiMessage, getAiSession, getLatestAiSession, importAiSessionSnapshot, listAiSessions, pinAiSession, reorderAiSession, resolveAiPermission, restoreAiSession, updateAiMessage, updateAiSession } from "../services/ai-session.service"
import { getActiveProvider } from "./providers.ipc"
import { createAgentRuntime, getAgentRuntimeCapabilities } from "../ai/runtime/registry"
import type { AgentRuntime, RuntimeMessage, RuntimeSession } from "../ai/runtime/types"
import { contentText, toAiMessagePartsContent } from "../../shared/ai-message-parts"
import { listModelCatalog, listProviderCatalog } from "../ai/provider-catalog"
import { runtimePermissionForAction, type ToolPermission } from "../ai/runtime/tools"
import { createGrimoireToolRegistry } from "../ai/runtime/grimoire-tools"
import { AI_MESSAGE_MAX_ATTACHMENTS, AI_MESSAGE_MAX_TOTAL_BYTES, getAiAttachment, linkAiAttachment, readAiAttachment } from '../services/ai-attachment.service'
import { readRetryPolicy, withRetry } from '../ai/runtime/retry-policy'
import { applyMessageLimit, readContextSettings } from '../ai/runtime/context-settings'
import { recordAiUsage } from '../services/usage.service'
import { agentRuntimeSessionDirectory, inspectAgentRuntime, inspectAgentRuntimes, resolveAgentRuntimeCommand, shutdownAgentRuntimes, startOpenCodeRuntime } from "../services/agent-runtime-manager"
import { isMcpToolForcePrompt } from "../services/mcp.service"
import { runAgentRuntimeLoop } from "../services/agent-runtime-turn.service"
import { admitRuntimeTurn, cancelRuntimeTurn, shutdownRuntimeTurns } from '../services/agent-runtime-admission.service'
import { RuntimePermissionBroker } from '../services/agent-runtime-permission.service'
import { prepareNativeRuntime } from '../services/agent-runtime-preparation.service'
import { attachRuntimeExecutionReference, beginRuntimeExecutionReference, type RuntimeExecutionIdentity } from '../services/agent-runtime-reference.service'
import { safeRuntimeError } from '../services/agent-runtime-safety.service'
import { piSdkHostTools, piSdkPermission } from '../services/pi-sdk-tool-bridge.service'
import { readRuntimeFeatureFlags, RuntimeCapabilityUnavailableError } from '../ai/runtime/features'

const runningRuntimes = new Map<string, { interrupt?: (sessionId: string) => Promise<void>; close?: () => Promise<void> }>()
const permissions = new RuntimePermissionBroker()

const RUNTIME_KINDS: AiRuntimeKind[] = ["openai-compatible", "anthropic", "google", "codex", "opencode", "pi"]
const PROVIDER_RUNTIMES = new Set<AiRuntimeKind>(["openai-compatible", "anthropic", "google"])

function broadcast(value: unknown) {
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) window.webContents.send(IPC_CHANNELS.AI_SESSION_EVENT, value)
  }
}

function broadcastResource(record: unknown): void {
  broadcast({ kind: 'resource', record })
}

function broadcastPermissionRequest(value: { requestId: string; sessionId: string; permission: ToolPermission; detail: unknown }) {
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) window.webContents.send(IPC_CHANNELS.AI_PERMISSION_REQUEST, value)
  }
}

async function requestPermission(sender: Electron.WebContents, sessionId: string, permission: ToolPermission, detail: unknown, mode: unknown, requestIdOverride?: string, forcePrompt = false, signal?: AbortSignal, scope = 'ai:' + sessionId): Promise<boolean> {
  const decision = await permissions.request({ sender, sessionId, scope, permission, detail, mode, requestId: requestIdOverride, forcePrompt, signal, channel: IPC_CHANNELS.AI_PERMISSION_REQUEST })
  return decision === 'allowOnce' || decision === 'allowForSession'
}

// Source `ai.tool.approval.respond` lands here through the compat route: one approval id, one
// boolean. The broker is the authority — an unknown or already-resolved id simply returns false.
export function decideAiSessionPermission(sender: Electron.WebContents, requestId: string, decision: 'allowOnce' | 'allowForSession' | 'deny' | 'cancel'): boolean {
  if (!requestId || !['allowOnce', 'allowForSession', 'deny', 'cancel'].includes(decision)) return false
  if (!permissions.decide(sender, requestId, decision)) return false
  resolveAiPermission({ requestId, decision })
  return true
}

export function registerAiSessionsIPC(): void {
  ipcMain.handle(IPC_CHANNELS.AI_RUNTIME_STATUS, async () => inspectAgentRuntimes())
  ipcMain.handle(IPC_CHANNELS.AI_RUNTIME_CAPABILITIES, async (_event, kind: unknown) => getAgentRuntimeCapabilities(String(kind || '') as AiRuntimeKind))
  ipcMain.handle(IPC_CHANNELS.AI_RUNTIME_PREPARE, async (_event, kind: unknown) => inspectAgentRuntime(String(kind || "") as AiRuntimeKind))
  ipcMain.handle(IPC_CHANNELS.AI_PERMISSION_DECISION, async (_event, input: unknown) => {
    const value = input && typeof input === "object" ? input as Record<string, unknown> : {}
    const requestId = String(value.requestId || "")
    const decision = String(value.decision || "")
    if (!permissions.decide(_event.sender, requestId, decision)) return false
    resolveAiPermission({ requestId, decision: decision as 'allowOnce' | 'allowForSession' | 'cancel' | 'deny' })
    return true
  })
  ipcMain.handle(IPC_CHANNELS.AI_CATALOG_PROVIDERS, async (_event, input?: unknown) => {
    const value = input && typeof input === "object" ? input as Record<string, unknown> : {}
    return listProviderCatalog(typeof value.query === "string" ? value.query : "")
  })
  ipcMain.handle(IPC_CHANNELS.AI_CATALOG_MODELS, async (_event, input?: unknown) => {
    const value = input && typeof input === "object" ? input as Record<string, unknown> : {}
    return listModelCatalog({ query: typeof value.query === "string" ? value.query : undefined, providerId: typeof value.providerId === "string" ? value.providerId : undefined, capability: typeof value.capability === "string" ? value.capability : undefined, limit: typeof value.limit === "number" ? value.limit : undefined })
  })
  ipcMain.handle(IPC_CHANNELS.AI_SESSION_LIST, async (_event, input?: unknown) => {
    const value = input && typeof input === "object" ? input as Record<string, unknown> : {}
    return listAiSessions({ query: typeof value.query === "string" ? value.query : undefined, kind: typeof value.kind === "string" ? value.kind as AiSessionKind : undefined, limit: typeof value.limit === "number" ? value.limit : undefined, includeArchived: value.includeArchived === true, manualOrder: value.manualOrder === true })
  })
  ipcMain.handle(IPC_CHANNELS.AI_SESSION_ARCHIVE, async (_event, id: unknown) => {
    const sessionId = String(id || '')
    const result = archiveAiSession(sessionId)
    permissions.clearScopes('ai:' + sessionId)
    broadcastResource(result)
    return result
  })
  ipcMain.handle(IPC_CHANNELS.AI_SESSION_RESTORE, async (_event, id: unknown) => {
    const result = restoreAiSession(String(id || ''))
    broadcastResource(result)
    return result
  })
  ipcMain.handle(IPC_CHANNELS.AI_SESSION_PIN, async (_event, input: unknown) => {
    const value = input && typeof input === 'object' ? input as Record<string, unknown> : {}
    const result = pinAiSession(String(value.id || ''), value.pinned === true)
    broadcastResource(result)
    return result
  })
  ipcMain.handle(IPC_CHANNELS.AI_SESSION_REORDER, async (_event, input: unknown) => {
    const value = input && typeof input === 'object' ? input as Record<string, unknown> : {}
    const position = value.position === 'after' || value.position === 'last' ? value.position : 'before'
    const result = reorderAiSession({ id: String(value.id || ''), overId: String(value.overId || ''), position })
    broadcastResource(result)
    return result
  })
  ipcMain.handle(IPC_CHANNELS.AI_SESSION_SEARCH, async (_event, input?: unknown) => {
    const value = input && typeof input === "object" ? input as Record<string, unknown> : {}
    return listAiSessions({ query: typeof value.query === "string" ? value.query : undefined, kind: typeof value.kind === "string" ? value.kind as AiSessionKind : undefined, limit: typeof value.limit === "number" ? value.limit : undefined })
  })
  ipcMain.handle(IPC_CHANNELS.AI_SESSION_GET, async (_event, id: unknown) => getAiSession(String(id || "")))
  ipcMain.handle(IPC_CHANNELS.AI_SESSION_LATEST, async (_event, input?: unknown) => {
    const value = input && typeof input === "object" ? input as Record<string, unknown> : {}
    return getLatestAiSession({ kind: typeof value.kind === "string" ? value.kind as AiSessionKind : undefined })
  })
  ipcMain.handle(IPC_CHANNELS.AI_SESSION_CREATE, async (_event, input: unknown) => {
    const value = input && typeof input === "object" ? input as Record<string, unknown> : {}
    const runtime = typeof value.runtime === "string" && RUNTIME_KINDS.includes(value.runtime as AiRuntimeKind) ? value.runtime as AiRuntimeKind : "openai-compatible"
    return createAiSession({ kind: typeof value.kind === "string" ? value.kind as AiSessionKind : undefined, runtime, providerId: typeof value.providerId === "string" ? value.providerId : undefined, modelId: typeof value.modelId === "string" ? value.modelId : undefined, title: typeof value.title === "string" ? value.title : undefined, parentId: typeof value.parentId === "string" ? value.parentId : undefined, metadata: value.metadata && typeof value.metadata === "object" ? value.metadata as Record<string, unknown> : undefined })
  })
  ipcMain.handle(IPC_CHANNELS.AI_SESSION_IMPORT, async (_event, input: unknown) => {
    if (!input || typeof input !== 'object') throw new Error('AI 会话导入数据无效')
    const value = input as Record<string, unknown>
    return importAiSessionSnapshot({ session: value.session as any, messages: Array.isArray(value.messages) ? value.messages as any : [], events: Array.isArray(value.events) ? value.events as any : [], attachments: Array.isArray(value.attachments) ? value.attachments as any : [] })
  })
  ipcMain.handle(IPC_CHANNELS.AI_SESSION_UPDATE, async (_event, input: unknown) => {
    const value = input && typeof input === "object" ? input as Record<string, unknown> : {}
    return updateAiSession({ id: String(value.id || ""), title: typeof value.title === "string" ? value.title : undefined, status: typeof value.status === "string" ? value.status as AiSessionStatus : undefined, runtime: typeof value.runtime === "string" && RUNTIME_KINDS.includes(value.runtime as AiRuntimeKind) ? value.runtime as AiRuntimeKind : undefined, providerId: typeof value.providerId === "string" ? value.providerId : undefined, modelId: typeof value.modelId === "string" ? value.modelId : undefined, metadata: value.metadata && typeof value.metadata === "object" ? value.metadata as Record<string, unknown> : undefined })
  })
  ipcMain.handle(IPC_CHANNELS.AI_SESSION_DELETE, async (_event, id: unknown) => {
    const sessionId = String(id || '')
    const result = deleteAiSession(sessionId)
    permissions.clearScopes('ai:' + sessionId)
    return result
  })
  ipcMain.handle(IPC_CHANNELS.AI_SESSION_BRANCH, async (_event, input: unknown) => {
    const value = input && typeof input === "object" ? input as Record<string, unknown> : {}
    return branchAiSession({ sessionId: String(value.sessionId || ""), title: typeof value.title === "string" ? value.title : undefined })
  })
  ipcMain.handle(IPC_CHANNELS.AI_SESSION_SEND, handleAiSessionSend)
  ipcMain.handle(IPC_CHANNELS.AI_SESSION_INTERRUPT, handleAiSessionInterrupt)
  ipcMain.handle(IPC_CHANNELS.AI_SESSION_COMPACT, async (_event, id: unknown) => {
    const sessionId = String(id || "")
    const snapshot = getAiSession(sessionId)
    if (!snapshot) throw new Error("AI 会话不存在")
    const metadata = { ...snapshot.session.metadata, compactedAt: new Date().toISOString(), compactedMessageCount: snapshot.messages.length }
    appendAiEvent({ sessionId, eventType: "compaction-finished", payload: { messageCount: snapshot.messages.length } })
    return updateAiSession({ id: sessionId, metadata })
  })
  ipcMain.handle(IPC_CHANNELS.AI_SESSION_RETRY, async (_event, input: unknown) => {
    const value = input && typeof input === 'object' ? input as Record<string, unknown> : {}
    const sessionId = typeof input === 'string' ? input : String(value.sessionId || '')
    const messageId = typeof input === 'object' && input !== null ? String(value.messageId || '') : ''
    const snapshot = getAiSession(sessionId)
    if (!snapshot) return null
    const lastUser = messageId ? snapshot.messages.find(message => message.id === messageId && message.role === 'user') : [...snapshot.messages].reverse().find(message => message.role === "user")
    if (!lastUser) return { session: snapshot.session, content: "" }
    const content = lastUser.content && typeof lastUser.content === "object" && "text" in (lastUser.content as Record<string, unknown>) ? String((lastUser.content as Record<string, unknown>).text || "") : String(lastUser.content || "")
    return { session: snapshot.session, content, attachments: lastUser.attachments }
  })
  ipcMain.handle(IPC_CHANNELS.AI_SESSION_APPEND_MESSAGE, async (_event, input: unknown) => {
    const value = input && typeof input === "object" ? input as Record<string, unknown> : {}
    const result = appendAiMessage({ sessionId: String(value.sessionId || ""), role: String(value.role || "user") as AiMessageRole, content: value.content, attachments: Array.isArray(value.attachments) ? value.attachments : [], status: typeof value.status === "string" ? value.status as AiMessageStatus : undefined, id: typeof value.id === "string" ? value.id : undefined })
    broadcast({ kind: "message", record: result })
    return result
  })
  ipcMain.handle(IPC_CHANNELS.AI_MESSAGE_UPDATE, async (_event, input: unknown) => {
    const value = input && typeof input === 'object' ? input as Record<string, unknown> : {}
    const content = value.content
    const result = updateAiMessage({ id: String(value.id || ''), content, attachments: Array.isArray(value.attachments) ? value.attachments : undefined, status: typeof value.status === 'string' ? value.status as AiMessageStatus : undefined })
    broadcast({ kind: 'message', record: result })
    return result
  })
  ipcMain.handle(IPC_CHANNELS.AI_MESSAGE_DELETE, async (_event, id: unknown) => {
    const messageId = String(id || '')
    const current = getAiMessage(messageId)
    const deleted = deleteAiMessage(messageId)
    if (deleted && current) broadcast({ kind: 'message-deleted', sessionId: current.session_id, messageId })
    return deleted
  })
  ipcMain.handle(IPC_CHANNELS.AI_SESSION_APPEND_EVENT, async (_event, input: unknown) => {
    const value = input && typeof input === "object" ? input as Record<string, unknown> : {}
    const result = appendAiEvent({ sessionId: String(value.sessionId || ""), eventType: String(value.eventType || "status"), payload: value.payload && typeof value.payload === "object" ? value.payload as Record<string, unknown> : {}, id: typeof value.id === "string" ? value.id : undefined })
    broadcast({ kind: "event", record: result })
    return result
  })
}

export async function shutdownAiSessions(): Promise<void> {
  permissions.shutdown()
  await shutdownRuntimeTurns()
  const runtimes = Array.from(runningRuntimes.values())
  runningRuntimes.clear()
  await Promise.allSettled(runtimes.map(runtime => runtime.close ? runtime.close() : Promise.resolve()))
  await shutdownAgentRuntimes()
}


/**
 * Reads the `chat.retry.*` preferences the compat shim persisted.
 *
 * The shim stores them JSON-encoded under `cherry_pref.<source key>`, so each value is parsed
 * before use — reading `"true"` as a boolean would leave retry permanently off while the UI
 * showed the switch on.
 *
 * Missing rows are left `undefined` rather than defaulted here; `readRetryPolicy` owns the
 * defaults, so this function cannot drift from it.
 */
function readRetryPolicyFromSettings() {
  const read = (key: string): unknown => {
    try {
      const row = getDatabase().exec('SELECT value FROM settings WHERE key=?', ['cherry_pref.' + key])[0]?.values?.[0]?.[0]
      if (typeof row !== 'string') return undefined
      try { return JSON.parse(row) } catch { return row }
    } catch {
      return undefined
    }
  }
  return readRetryPolicy({
    enabled: read('chat.retry.enabled'),
    maxAttempts: read('chat.retry.max_attempts'),
    backoffEnabled: read('chat.retry.backoff_enabled')
  })
}

/**
 * Reads the `chat.context_settings.*` preferences the compat shim persisted.
 *
 * Same JSON-encoded `cherry_pref.<key>` storage as the retry keys; parsing is shared in
 * shape so a stored `"true"` cannot read as enabled. Defaults live in `readContextSettings`
 * alone, so this reader cannot drift from them.
 */
function readContextSettingsFromSettings() {
  const read = (key: string): unknown => {
    try {
      const row = getDatabase().exec('SELECT value FROM settings WHERE key=?', ['cherry_pref.' + key])[0]?.values?.[0]?.[0]
      if (typeof row !== 'string') return undefined
      try { return JSON.parse(row) } catch { return row }
    } catch {
      return undefined
    }
  }
  return readContextSettings({
    enabled: read('chat.context_settings.enabled'),
    maxMessages: read('chat.context_settings.max_messages')
  })
}

export type AiStreamHooks = {
  onTextDelta?: (text: string) => void
  onReasoningDelta?: (text: string) => void
}

export async function handleAiSessionSend(_event: { sender: Electron.WebContents }, input: unknown, hooks?: AiStreamHooks) {

    const value = input && typeof input === "object" ? input as Record<string, unknown> : {}
    const sessionId = String(value.sessionId || "")
    const content = typeof value.content === "string" ? value.content.trim() : ""
    if (!sessionId || !content) throw new Error("AI 消息不能为空")
    const admission = admitRuntimeTurn('ai:' + sessionId, _event.sender)
    try {
    const snapshot = getAiSession(sessionId)
    if (!snapshot) throw new Error("AI 会话不存在")
    const runtimeKind = RUNTIME_KINDS.includes(snapshot.session.runtime) ? snapshot.session.runtime : "openai-compatible"
    const provider = await getActiveProvider()
    if ((PROVIDER_RUNTIMES.has(runtimeKind) || runtimeKind === 'pi') && !provider) throw new Error("当前 Runtime 需要先配置 AI Provider")
    const providerWithSecret = provider as (typeof provider & { api_key?: string; base_url?: string; protocol?: 'chat_completions' | 'responses' }) | null
    const metadata = snapshot.session.metadata || {}
    const model = typeof value.modelId === "string" && value.modelId.trim()
      ? value.modelId.trim()
      : snapshot.session.model_id || provider?.default_model || (typeof metadata.model === "string" ? metadata.model : "") || (PROVIDER_RUNTIMES.has(runtimeKind) ? "" : "default")
    if (!model) throw new Error("请先选择模型")
    const inputAttachments = Array.isArray(value.attachments) ? value.attachments : []
    const inputContext = Array.isArray(value.context) ? value.context.slice(0, 20) : []
    if (runtimeKind === 'pi' && readRuntimeFeatureFlags().piSdk && (inputAttachments.length || inputContext.length)) throw new RuntimeCapabilityUnavailableError('pi.sdk.attachments', 'Pi SDK bounded text adapter does not accept attachments or ephemeral context')
    if (inputAttachments.length > AI_MESSAGE_MAX_ATTACHMENTS) throw new Error('单条消息最多添加 10 个附件')
    const totalAttachmentBytes = inputAttachments.reduce((total, item) => total + (item && typeof item === 'object' && typeof (item as Record<string, unknown>).size === 'number' ? Number((item as Record<string, unknown>).size) : 0), 0)
    if (totalAttachmentBytes > AI_MESSAGE_MAX_TOTAL_BYTES) throw new Error('单条消息附件总大小不能超过 200MB')
    admission.signal.throwIfAborted()
    const userParts = [{ type: 'text' as const, text: content }, ...(inputContext.length ? [{ type: 'status' as const, text: '已附加 Grimoire 上下文', status: 'context', metadata: { context: inputContext } }] : [])]
    const userMessage = appendAiMessage({ sessionId, role: "user", content: toAiMessagePartsContent({ parts: userParts }, 'user'), attachments: inputAttachments })
    for (const attachment of inputAttachments) {
      if (attachment && typeof attachment === 'object' && typeof (attachment as Record<string, unknown>).attachmentId === 'string') {
        try { linkAiAttachment(String((attachment as Record<string, unknown>).attachmentId), userMessage.id) } catch {}
      }
    }
    broadcast({ kind: "message", record: userMessage })
    updateAiSession({ id: sessionId, status: "running", runtime: runtimeKind, providerId: provider?.id || snapshot.session.provider_id, modelId: model })
    const sender = _event.sender
    const registry = createGrimoireToolRegistry()
    const toolDefinitions = registry.list().map(tool => ({ type: "function", function: { name: tool.name, description: tool.description, parameters: tool.inputSchema } }))
    const messages: RuntimeMessage[] = snapshot.messages.map(message => ({ role: message.role, content: contentText(message.content) }))
    const contextText = inputContext.length ? '\\n\\n[Grimoire 上下文，仅供本次请求使用]\\n' + inputContext.map(item => JSON.stringify(item)).join('\\n') : ''
    const runtimeUserParts: Array<Record<string, unknown>> = [{ type: 'text', text: content + contextText }]
    for (const attachment of inputAttachments) {
      if (!attachment || typeof attachment !== 'object') continue
      const attachmentId = typeof (attachment as Record<string, unknown>).attachmentId === 'string' ? String((attachment as Record<string, unknown>).attachmentId) : ''
      if (!attachmentId) continue
      const record = getAiAttachment(attachmentId)
      if (!record) continue
      if (record.source_type === 'image' || record.mime_type.startsWith('image/')) {
        try {
          const preview = await readAiAttachment(attachmentId)
          if (preview.dataUrl) runtimeUserParts.push({ type: 'image_url', image_url: { url: preview.dataUrl } })
        } catch {}
      } else {
        runtimeUserParts.push({ type: 'text', text: '[附件：' + record.original_name + '，类型 ' + record.mime_type + ']' })
      }
    }
    messages.push({ role: "user", content: runtimeUserParts.length > 1 ? runtimeUserParts : content + contextText })
    let currentMessages: RuntimeMessage[] = messages
    let textValue = ""
    const permissionMode = metadata.permissionMode || "request"
    let runtime: AgentRuntime | null = null
    let releaseManagedOpenCode: (() => Promise<void>) | undefined
    let nativeIdentity: RuntimeExecutionIdentity | undefined
    let restoreSession: RuntimeSession | undefined
    let ownsToolDefinitions = false
    let cleanupRuntime: (() => Promise<void>) | undefined
    let cancelled = false
    try {
      let runtimeConfig: Record<string, unknown>
      if (runtimeKind === "openai-compatible" || runtimeKind === "anthropic" || runtimeKind === "google") {
        runtimeConfig = { baseUrl: providerWithSecret?.base_url || provider?.base_url, apiKey: providerWithSecret?.api_key || "", protocol: providerWithSecret?.protocol || provider?.protocol || 'chat_completions' }
      } else if (runtimeKind === 'pi' || runtimeKind === 'opencode') {
        const prepared = await prepareNativeRuntime({ store: 'ai', sessionId, kind: runtimeKind, provider: providerWithSecret, model, metadata, signal: admission.signal,
          history: currentMessages.slice(0, -1), systemPrompt: currentMessages.filter(message => message.role === 'system').map(message => message.content).join('\n\n'), hostTools: piSdkHostTools(registry, sessionId) })
        releaseManagedOpenCode = prepared.release
        nativeIdentity = prepared.identity
        restoreSession = prepared.restoreSession
        ownsToolDefinitions = prepared.ownsToolDefinitions === true
        runtimeConfig = prepared.config
      } else {
        runtimeConfig = { endpoint: typeof metadata.endpoint === "string" ? metadata.endpoint : runtimeKind === "codex" ? "http://127.0.0.1:17371" : "http://127.0.0.1:4096", token: typeof metadata.token === "string" ? metadata.token : "" }
      }
      runtime = createAgentRuntime(runtimeKind, runtimeConfig)
      if (restoreSession) {
        if (!runtime.loadSession) throw new Error('RUNTIME_RESTORE_UNAVAILABLE')
        runtime.loadSession(restoreSession)
      }
      const runtimeSession = restoreSession || runtime.createSession(model, ownsToolDefinitions ? [] : applyMessageLimit(currentMessages, readContextSettingsFromSettings()) as RuntimeMessage[])
      if (nativeIdentity) beginRuntimeExecutionReference('ai', sessionId, nativeIdentity)
      let interruptPromise: Promise<void> | undefined
      let closePromise: Promise<void> | undefined
      // Shared by Stop, shutdown and finally: each lifecycle operation is invoked once.
      const interrupt = () => interruptPromise ||= Promise.resolve().then(() => runtime?.interrupt?.(runtimeSession.id))
      const close = () => closePromise ||= Promise.resolve().then(() => runtime?.close?.())
      admission.setCancel(async () => { cancelled = true; await interrupt() })
      admission.signal.throwIfAborted()
      runningRuntimes.set(sessionId, { interrupt: runtime.interrupt ? async () => { cancelled = true; await interrupt() } : undefined, close })
      cleanupRuntime = async () => { try { await interrupt() } finally { await close() } }
      const loopResult = await runAgentRuntimeLoop({
        runtime,
        runtimeSession,
        model,
        messages: currentMessages,
        tools: ownsToolDefinitions ? undefined : toolDefinitions,
        isCancelled: () => admission.signal.aborted,
        limitMessages: ownsToolDefinitions ? undefined : messages => applyMessageLimit(messages, readContextSettingsFromSettings()) as RuntimeMessage[],
        // Model-call retry is retained at the adapter send boundary. It retries only before
        // observable output, so it cannot duplicate content already shown to the user.
        send: (input: import('../ai/runtime/types').RuntimeSendInput) => withRetry(readRetryPolicyFromSettings(), () => runtime!.send(input)),
        onEvent: async event => {
          if (event.type === "session-started") {
            const record = appendAiEvent({ sessionId, eventType: "session-started", payload: { runtimeSessionId: event.sessionId, runtime: runtimeKind } })
            broadcast({ kind: "event", record })
          } else if (event.type === "text-delta") {
            const record = appendAiEvent({ sessionId, eventType: "text-delta", payload: { text: event.text } })
            broadcast({ kind: "event", record })
            broadcast({ kind: "delta", sessionId, text: event.text })
            hooks?.onTextDelta?.(event.text)
          } else if (event.type === "reasoning-delta") {
            const record = appendAiEvent({ sessionId, eventType: "reasoning-delta", payload: { text: event.text } })
            broadcast({ kind: "event", record })
            hooks?.onReasoningDelta?.(event.text)
          } else if (event.type === "tool-started") {
            const record = appendAiEvent({ sessionId, eventType: "tool-started", payload: { callId: event.callId, name: event.name, input: event.input } })
            broadcast({ kind: "event", record })
          } else if (event.type === "tool-progress") {
            const record = appendAiEvent({ sessionId, eventType: "tool-progress", payload: { callId: event.callId, name: event.name, status: event.status, output: event.output, error: event.error } })
            broadcast({ kind: "event", record })
          } else if (event.type === "tool-finished") {
            const record = appendAiEvent({ sessionId, eventType: "tool-finished", payload: { callId: event.callId, output: event.output, error: event.error } })
            broadcast({ kind: "event", record })
          } else if (event.type === "agent-status") {
            const record = appendAiEvent({ sessionId, eventType: "agent-status", payload: { status: event.status, detail: event.detail, text: event.status } })
            broadcast({ kind: "event", record })
          } else if (event.type === "mcp") {
            const record = appendAiEvent({ sessionId, eventType: "mcp-event", payload: { serverId: event.serverId, tool: event.tool, payload: event.payload, error: event.error, status: event.error ? "error" : "running" } })
            broadcast({ kind: "event", record })
          } else if (event.type === "permission-requested") {
            const record = appendAiEvent({ sessionId, eventType: "permission-requested", payload: { requestId: event.requestId, action: event.action, detail: event.detail } })
            broadcast({ kind: "event", record })
            const host = ownsToolDefinitions ? piSdkPermission(registry, event.action, event.detail) : undefined
            if (ownsToolDefinitions && !host) throw new Error('RUNTIME_UNREGISTERED_TOOL_PERMISSION')
            const permission = host?.permission || runtimePermissionForAction(event.action)
            const detail = host?.detail || event.detail || { action: event.action }
            createAiPermission({ sessionId, requestId: event.requestId, permission, detail })
            const decision = await permissions.request({ sender, sessionId, scope: 'ai:' + sessionId + ':' + (nativeIdentity?.configFingerprint || runtimeKind), permission, action: host?.action || event.action, detail, native: !ownsToolDefinitions,
              mode: permissionMode, forcePrompt: host ? isMcpToolForcePrompt(host.action) : false, signal: admission.signal, requestId: event.requestId, channel: IPC_CHANNELS.AI_PERMISSION_REQUEST })
            resolveAiPermission({ requestId: event.requestId, decision })
            const allowed = decision === 'allowOnce' || decision === 'allowForSession'
            if (!admission.signal.aborted) {
              const approval = { requestId: event.requestId, decision: allowed ? 'accept' as const : 'decline' as const, sessionId: runtimeSession.id, action: event.action }
              // Keep native reply scoped to once: session grants live in the main broker,
              // not OpenCode's process-global 'always' ruleset.
              if (allowed) await runtime!.approve?.(approval)
              else await runtime!.reject?.(approval)
            }
            const resolved = appendAiEvent({ sessionId, eventType: "permission-resolved", payload: { requestId: event.requestId, permission, detail: event.detail, decision } })
            broadcast({ kind: "event", record: resolved })
          } else if (event.type === "permission-resolved") {
            const record = appendAiEvent({ sessionId, eventType: "permission-resolved", payload: { requestId: event.requestId, decision: event.decision, detail: event.detail } })
            broadcast({ kind: "event", record })
          } else if (event.type === "compaction-started" || event.type === "compaction-finished") {
            const record = appendAiEvent({ sessionId, eventType: event.type, payload: { detail: event.detail } })
            broadcast({ kind: "event", record })
          } else if (event.type === "recovery") {
            const eventType = event.phase === "started" ? "recovery-started" : "recovery-finished"
            const record = appendAiEvent({ sessionId, eventType, payload: { detail: event.detail } })
            broadcast({ kind: "event", record })
          } else if (event.type === "usage") {
            // Providers that report no usage do not create a phantom zero-token record.
            const stored = recordAiUsage({ sessionId, runtime: runtimeKind, modelId: model, inputTokens: event.inputTokens, outputTokens: event.outputTokens, cachedTokens: event.cachedTokens })
            if (stored) {
              const record = appendAiEvent({ sessionId, eventType: "usage", payload: { inputTokens: stored.inputTokens, outputTokens: stored.outputTokens, cachedTokens: stored.cachedTokens, usageId: stored.id } })
              broadcast({ kind: "event", record })
            }
          } else if (event.type === "completed") {
            const record = appendAiEvent({ sessionId, eventType: "completed", payload: { text: event.text, toolCalls: event.toolCalls || [] } })
            broadcast({ kind: "event", record })
          } else if (event.type === "cancelled") {
            const record = appendAiEvent({ sessionId, eventType: "cancelled", payload: { reason: event.reason || "user" } })
            broadcast({ kind: "event", record })
            cancelled = true
          }
        },
        onHostTool: async (phase, call, result) => {
          if (phase === 'started') {
            const callRecord = appendAiEvent({ sessionId, eventType: "tool-progress", payload: { ...call, status: "executing" } })
            broadcast({ kind: "event", record: callRecord })
            return
          }
          const resultRecord = appendAiEvent({ sessionId, eventType: "tool-finished", payload: { callId: call.callId, name: call.name, output: result } })
          broadcast({ kind: "event", record: resultRecord })
        },
        executeHostTool: call => registry.execute(call.name, call.input, {
          runtime: runtimeKind,
          sessionId,
          toolCallId: call.callId,
          permission: async (permission, detail) => {
            const requested = appendAiEvent({ sessionId, eventType: "permission-requested", payload: { permission, detail, tool: call.name } })
            const requestId = 'ai_permission_' + crypto.randomUUID().replaceAll('-', '').slice(0, 18)
            createAiPermission({ sessionId, requestId, permission, detail })
            broadcast({ kind: "event", record: requested })
            const allowed = await requestPermission(sender, sessionId, permission, detail, permissionMode, requestId, isMcpToolForcePrompt(call.name), admission.signal, 'ai:' + sessionId + ':' + (nativeIdentity?.configFingerprint || runtimeKind))
            const resolved = appendAiEvent({ sessionId, eventType: "permission-resolved", payload: { permission, detail, tool: call.name, decision: allowed ? "allow" : "deny" } })
            resolveAiPermission({ requestId, decision: allowed ? 'allowOnce' : 'deny' })
            broadcast({ kind: "event", record: resolved })
            return allowed
          },
        }),
      })
      cancelled = loopResult.cancelled
      textValue = loopResult.text
      const assistant = appendAiMessage({ sessionId, role: "assistant", content: toAiMessagePartsContent({ parts: [{ type: 'text', text: textValue }] }), status: cancelled ? "cancelled" : "completed" })
      const reference = runtime.getSessionReference?.(runtimeSession.id)
      if (!cancelled && nativeIdentity && reference) attachRuntimeExecutionReference('ai', sessionId, nativeIdentity, reference)
      broadcast({ kind: "message", record: assistant })
      const session = updateAiSession({ id: sessionId, status: cancelled ? "interrupted" : "completed", runtime: runtimeKind, providerId: provider?.id || snapshot.session.provider_id, modelId: model })
      return { text: textValue, session }
    } catch (error) {
      if (admission.signal.aborted) {
        const session = updateAiSession({ id: sessionId, status: 'interrupted' })
        return { text: textValue, session }
      }
      const rawMessage = safeRuntimeError(error, [providerWithSecret?.api_key])
      const providerName = provider?.name || runtimeKind
      const providerProtocol = provider?.protocol || 'runtime'
      const providerEndpoint = typeof provider?.base_url === 'string' ? provider.base_url : undefined
      const message = providerEndpoint
        ? providerName + '（' + providerProtocol + '）请求失败：' + rawMessage + '；Endpoint: ' + providerEndpoint + '；Model: ' + model
        : providerName + '（' + providerProtocol + '）请求失败：' + rawMessage + '；Model: ' + model
      const record = appendAiEvent({ sessionId, eventType: "failed", payload: { message, rawMessage, provider: providerName, protocol: providerProtocol, endpoint: providerEndpoint, model } })
      broadcast({ kind: "event", record })
      updateAiSession({ id: sessionId, status: "failed", runtime: runtimeKind, providerId: provider?.id || snapshot.session.provider_id, modelId: model })
      throw new Error(message)
    } finally {
      runningRuntimes.delete(sessionId)
      try {
        if (cleanupRuntime) await cleanupRuntime()
        else await runtime?.close?.()
      } finally {
        await releaseManagedOpenCode?.()
      }
    }
    } finally { admission.release() }

}

export async function handleAiSessionInterrupt(_event: { sender: Electron.WebContents }, id: unknown) {

    const sessionId = String(id || "")
    if (!(await cancelRuntimeTurn('ai:' + sessionId, _event.sender))) return false
    const record = appendAiEvent({ sessionId, eventType: 'interrupted', payload: { reason: 'user' } })
    broadcast({ kind: 'event', record })
    updateAiSession({ id: sessionId, status: "interrupted" })
    return true

}
