import React, { useEffect, useMemo, useState } from "react"
import { Bot, Download, Eye, FileText, GitBranch, ImagePlus, MessageSquare, MonitorPlay, Plus, Settings2, ShieldAlert, Upload, Wrench } from "lucide-react"
import type { AiAssistantRecord, AiAttachmentRecord, AiEventRecord, AiMessageRecord, AiRuntimeKind, AiSessionKind, AiSessionRecord, AiTopicRecord } from "@shared/ai-types"
import type { AiMessagePart } from "@shared/ai-message-parts"
import type { CherryRuntimeStatus } from "@shared/cherry-host-types"
import { runtimeModelFallback, runtimeUsesGrimoireProvider, transitionRuntimeSelection, type RuntimeModelMemory } from "@shared/runtime-contract"
import { useProviderStore } from "../../stores/providers.store"
import { Button, IconButton } from "../ui/Button"
import { EmptyState, StatusBadge } from "../ui/Feedback"
import { McpPanel } from "./McpPanel"
import { ChatLayout } from "./ChatLayout"
import { WorkspaceLogsPanel } from "../workspace/WorkspaceSystemPanels"
import { CherryComposer } from "../../vendor/cherry/ComposerSurface"
import { CherryMessageList } from "../../vendor/cherry/MessageParts"
import { initialAiMessagePartState, reduceAiMessageParts } from "@shared/ai-message-reducer"
import { CherryContextPicker, type AgentContextRef } from "../../vendor/cherry/ContextPicker"
import { CherryProviderModelSelector } from "../../vendor/cherry/ProviderModelSelector"
import { CherryAgentShell } from "../../vendor/cherry/AgentShell"
import { CherryConversationHeader } from "../../vendor/cherry/ConversationHeader"
import { CherrySessionSidebar } from "../../vendor/cherry/SessionSidebar"
import { useUnifiedAgentStore } from '../../stores/unified-agent.store'
import { getCherryHostBridge } from '../../services/cherry-host-bridge'
import { CherryHostProvider } from '../../services/cherry-host-provider'

type AgentMode = "chat" | "vision" | "drawing" | "canvas" | "sessions" | "mcp" | "logs"

type RuntimeStatus = CherryRuntimeStatus

const RUNTIMES: Array<{ id: AiRuntimeKind; label: string }> = [
  { id: "openai-compatible", label: "OpenAI 兼容" },
  { id: "anthropic", label: "Anthropic" },
  { id: "google", label: "Google" },
  { id: "codex", label: "Codex" },
  { id: "opencode", label: "OpenCode" },
  { id: "pi", label: "Pi" },
]

const MODES: Array<{ id: AgentMode; label: string; icon: React.ElementType }> = [
  { id: "chat", label: "对话", icon: MessageSquare },
  { id: "vision", label: "识图", icon: Eye },
  { id: "drawing", label: "绘图", icon: ImagePlus },
  { id: "canvas", label: "画布", icon: MonitorPlay },
  { id: "sessions", label: "会话", icon: Bot },
  { id: "mcp", label: "MCP", icon: Wrench },
  { id: "logs", label: "日志", icon: ShieldAlert },
]

function contentText(content: unknown): string {
  if (typeof content === "string") return content
  if (content && typeof content === "object" && "text" in content) return String((content as { text?: unknown }).text || "")
  return JSON.stringify(content ?? "")
}

function toBase64(data: string) {
  const comma = data.indexOf(",")
  return comma >= 0 ? data.slice(comma + 1) : data
}

export function AgentWorkspacePanel({ variant = "workspace", initialMode }: { variant?: "workspace" | "compact"; initialMode?: AgentMode }) {
  const { providers, activeProvider, loadProviders } = useProviderStore()
  const cherry = useMemo(() => getCherryHostBridge(), [])
  const setActiveProvider = useProviderStore(state => state.setActive)
  const [mode, setMode] = useState<AgentMode>(initialMode || "chat")
  const [sessions, setSessions] = useState<AiSessionRecord[]>([])
  const [assistants, setAssistants] = useState<AiAssistantRecord[]>([])
  const [topics, setTopics] = useState<AiTopicRecord[]>([])
  const activeId = useUnifiedAgentStore(state => state.activeSessionId)
  const setActiveId = useUnifiedAgentStore(state => state.setActiveSessionId)
  const [activeData, setActiveData] = useState<{ session: AiSessionRecord; messages: AiMessageRecord[]; events: AiEventRecord[] } | null>(null)
  const [message, setMessage] = useState("")
  const [error, setError] = useState("")
  const [busy, setBusy] = useState(false)
  const [images, setImages] = useState<Array<{ id: number; original_name: string | null }>>([])
  const [selectedImageId, setSelectedImageId] = useState("")
  const [visionPrompt, setVisionPrompt] = useState("请分析这张图片，并给出可确认的中文和英文标签。")
  const [drawingPrompt, setDrawingPrompt] = useState("")
  const [drawingResult, setDrawingResult] = useState("")
  const [streamingState, setStreamingState] = useState(initialAiMessagePartState)
  const [catalogModels, setCatalogModels] = useState<Array<{ id: string; name?: string; capabilities?: string[]; contextWindow?: number; maxOutputTokens?: number }>>([])
  const [runtimeStatuses, setRuntimeStatuses] = useState<RuntimeStatus[]>([])
  const [selectedRuntime, setSelectedRuntime] = useState<AiRuntimeKind>("openai-compatible")
  const [modelOverride, setModelOverride] = useState("")
  const [runtimeModelMemory, setRuntimeModelMemory] = useState<RuntimeModelMemory>({})
  const [permissionRequests, setPermissionRequests] = useState<Array<{ requestId: string; sessionId: string; permission: 'read' | 'write' | 'execute' | 'network'; detail?: unknown }>>([])
  const [sessionQuery, setSessionQuery] = useState("")
  const [attachments, setAttachments] = useState<AiAttachmentRecord[]>([])
  const [legacyUi, setLegacyUi] = useState(false)
  const [contexts, setContexts] = useState<AgentContextRef[]>([])
  const [bridgeWarning, setBridgeWarning] = useState('')

  const selectedProvider = activeProvider || providers[0]
  const selectedRuntimeStatus = runtimeStatuses.find(item => item.kind === selectedRuntime)
  const runtimeReady = !!selectedRuntimeStatus?.available && !!selectedRuntimeStatus.contract
  const providerRuntime = runtimeUsesGrimoireProvider(selectedRuntimeStatus?.contract)
  const sessionModel = activeData?.session.runtime === selectedRuntime ? activeData.session.model_id : ""
  const model = runtimeModelFallback({
    contract: selectedRuntimeStatus?.contract,
    explicitModel: modelOverride,
    sessionModel,
    providerDefaultModel: activeProvider?.default_model || providers[0]?.default_model,
  })
  const messages = activeData?.messages || []
  const streamingParts = streamingState.parts

  const loadSessions = async () => {
    try {
      const list = await cherry.sessions.list({ query: sessionQuery || undefined, limit: 100 })
      setSessions(list)
      if (!activeId && list[0]) setActiveId(list[0].id)
    } catch (cause) { setError(cause instanceof Error ? cause.message : "读取 Agent 会话失败") }
  }

  const loadActive = async (id: string | null) => {
    if (!id) { setActiveData(null); return }
    try {
      const value = await cherry.sessions.get(id)
      if (!value) {
        setActiveData(null)
        setModelOverride("")
        return
      }
      setActiveData({ session: value.session, messages: value.messages, events: value.events })
      setSelectedRuntime(value.session.runtime)
      setModelOverride(value.session.model_id)
      setRuntimeModelMemory(current => value.session.model_id ? { ...current, [value.session.runtime]: value.session.model_id } : current)
    } catch (cause) { setError(cause instanceof Error ? cause.message : "读取 Agent 会话失败") }
  }

  useEffect(() => { void loadProviders(); void loadSessions() }, [loadProviders, sessionQuery])
  useEffect(() => { void cherry.assistants.list().then(setAssistants).catch(() => setAssistants([])) }, [cherry])
  useEffect(() => { void cherry.settings.getAll().then(settings => { const value = settings['dev.aiLegacyUi'] ?? settings.dev_aiLegacyUi; setLegacyUi(value === 'true' || value === '1') }).catch(() => setLegacyUi(false)) }, [])
  useEffect(() => {
    const capabilities = window.api?.meta?.capabilities
    if (!capabilities) {
      setBridgeWarning('当前 Electron preload 版本过旧。请完全关闭 Grimoire 后使用启动脚本重新启动。')
    } else if (!capabilities.attachments || !capabilities.unifiedSessions || !capabilities.catalog) {
      setBridgeWarning('当前 Agent API 能力不完整，请完全关闭旧窗口后重新启动。')
    } else {
      setBridgeWarning('')
    }
  }, [])
  useEffect(() => { void loadActive(activeId) }, [activeId])
  useEffect(() => { if (!activeId) { setTopics([]); return }; void cherry.topics.list({ sessionId: activeId }).then(setTopics).catch(() => setTopics([])) }, [activeId, cherry])
  useEffect(() => {
    if (!activeId) { setAttachments([]); return }
    void cherry.attachments.list(activeId).then(setAttachments).catch(() => setAttachments([]))
  }, [activeId])
  useEffect(() => {
    const unsubscribe = cherry.chat.onEvent(value => {
      const sessionId = value.sessionId || (value.record as { session_id?: string } | undefined)?.session_id
      if (sessionId && sessionId !== activeId) return
      if (value.kind === "event" && value.record) {
        setStreamingState(current => reduceAiMessageParts(current, { type: 'event', event: value.record as AiEventRecord }))
      }
      if (value.kind === "message-deleted" && value.sessionId === activeId) void loadActive(activeId)
      if (value.kind === "message" && (value.record as { session_id?: string } | undefined)?.session_id === activeId) {
        if ((value.record as AiMessageRecord).role === 'assistant') setStreamingState(initialAiMessagePartState)
        void loadActive(activeId)
      }
    })
    return typeof unsubscribe === 'function' ? unsubscribe : undefined
  }, [activeId])
  useEffect(() => {
    return cherry.permissions.onRequest(request => {
      setPermissionRequests(current => current.some(item => item.requestId === request.requestId) ? current : [...current, request])
    })
  }, [])
  useEffect(() => {
    void cherry.models.list({ providerId: selectedProvider?.id, limit: 200 }).then(value => setCatalogModels(value)).catch(() => setCatalogModels([]))
  }, [selectedProvider?.id])
  useEffect(() => {
    void cherry.sessions.runtimes.list().then(value => setRuntimeStatuses(value)).catch(() => setRuntimeStatuses([]))
  }, [])
  useEffect(() => {
    if (mode === "vision") void cherry.context.images.list().then(setImages).catch(() => setImages([]))
  }, [mode])

  const createSession = async (kind: AiSessionKind = mode === "chat" ? "chat" : mode === "vision" ? "vision" : mode === "drawing" ? "drawing" : "agent"): Promise<AiSessionRecord | null> => {
    const runtimeStatus = runtimeStatuses.find(item => item.kind === selectedRuntime)
    if (!runtimeStatus?.available || !runtimeStatus.contract) {
      setError(runtimeStatus?.message || 'Runtime 状态尚未就绪')
      return null
    }
    const providerId = runtimeUsesGrimoireProvider(runtimeStatus.contract) ? selectedProvider?.id || "" : ""
    const session = await cherry.sessions.create({ kind, runtime: selectedRuntime, providerId, modelId: model, title: MODES.find(item => item.id === mode)?.label || "Agent 会话", metadata: assistants[0] ? { assistantId: assistants[0].id } : {} })
    setSessions(current => [session, ...current.filter(item => item.id !== session.id)])
    setActiveId(session.id)
    return session
  }

  const ensureSession = async () => {
    if (activeId) {
      const existing = await cherry.sessions.get(activeId)
      if (existing) return existing.session
    }
    return createSession()
  }

  const refreshActive = async (id: string) => {
    setActiveId(id)
    await loadActive(id)
  }

  const changeRuntime = async (runtime: AiRuntimeKind) => {
    const status = runtimeStatuses.find(item => item.kind === runtime)
    if (!status || !status.contract || !status.available) {
      setError(status?.message || 'Runtime 状态尚未就绪')
      return
    }
    if (runtime === selectedRuntime) return
    setError("")
    const transition = transitionRuntimeSelection({
      fromRuntime: selectedRuntime,
      toRuntime: runtime,
      contract: status.contract,
      current: { providerId: selectedProvider?.id || '', model },
      activeProviderId: selectedProvider?.id,
      providerDefaultModel: selectedProvider?.default_model,
      providerModels: [...(selectedProvider?.models || []), ...catalogModels.map(item => item.id)],
      memory: runtimeModelMemory,
    })
    setRuntimeModelMemory(transition.memory)
    setSelectedRuntime(runtime)
    setModelOverride(transition.selection.model)
    if (activeId) {
      try {
        const session = await cherry.sessions.update({ id: activeId, runtime, providerId: transition.selection.providerId, modelId: transition.selection.model })
        setActiveData(current => current ? { ...current, session } : current)
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : "切换 Runtime 失败")
      }
    }
  }

  const changeProvider = async (providerId: string) => {
    if (!runtimeUsesGrimoireProvider(selectedRuntimeStatus?.contract)) return
    await setActiveProvider(providerId)
    const nextProvider = useProviderStore.getState().providers.find(item => item.id === providerId) || null
    if (!nextProvider) return
    const nextModel = nextProvider.default_model || nextProvider.models[0] || ''
    setModelOverride(nextModel)
    setRuntimeModelMemory(current => ({ ...current, [selectedRuntime]: nextModel }))
    if (activeId) {
      try {
        const session = await cherry.sessions.update({ id: activeId, providerId, modelId: nextModel })
        setActiveData(current => current ? { ...current, session } : current)
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : '切换 Provider 失败')
      }
    }
  }

  const decidePermission = async (requestId: string, decision: 'allowOnce' | 'allowForSession' | 'deny' | 'cancel') => {
    await cherry.permissions.decide({ requestId, decision })
    setPermissionRequests(current => current.filter(item => item.requestId !== requestId))
  }

  const refreshRuntimes = async () => {
    try { setRuntimeStatuses(await cherry.sessions.runtimes.list()) }
    catch { setRuntimeStatuses([]) }
  }

  const attachFile = async () => {
    if (attachments.length >= 10) { setError('单条消息最多添加 10 个附件'); return }
    const attachmentApi = cherry.attachments
    const session = await ensureSession()
    if (!session) return
    const filePath = await attachmentApi.select()
    if (!filePath) return
    try {
      const attachment = await attachmentApi.import({ sessionId: session.id, filePath })
      setAttachments(current => current.some(item => item.id === attachment.id) ? current : [...current, attachment])
      setError('')
    } catch (cause) { setError(cause instanceof Error ? cause.message : '导入附件失败') }
  }

  const removeAttachment = async (id: string) => {
    await cherry.attachments.delete(id).catch(() => false)
    setAttachments(current => current.filter(item => item.id !== id))
  }

  const deleteSession = async (id: string) => {
    if (!window.confirm('确定删除这个 Agent 会话吗？')) return
    await cherry.sessions.delete(id)
    if (activeId === id) { setActiveId(null); setActiveData(null) }
    await loadSessions()
  }

  const editMessage = async (id: string, text: string) => {
    if (!text.trim()) { setError('消息内容不能为空'); return }
    await cherry.sessions.updateMessage({ id, content: text.trim(), status: 'completed' })
    if (activeId) await loadActive(activeId)
  }

  const deleteMessage = async (id: string) => {
    await cherry.sessions.deleteMessage(id)
    if (activeId) await loadActive(activeId)
  }

  const branchSession = async () => {
    if (!activeId) return
    const branch = await cherry.sessions.branch({ sessionId: activeId })
    setSessions(current => [branch, ...current.filter(item => item.id !== branch.id)])
    setActiveId(branch.id)
  }

  const activeAssistantId = typeof activeData?.session.metadata.assistantId === 'string' ? activeData.session.metadata.assistantId : ''
  const changeAssistant = async (assistantId: string) => {
    if (!activeId || !activeData) return
    const session = await cherry.sessions.update({ id: activeId, metadata: { ...activeData.session.metadata, assistantId: assistantId || undefined } })
    setActiveData(current => current ? { ...current, session } : current)
  }

  const createTopic = async () => {
    if (!activeId) return
    const title = window.prompt('新建主题', '新主题')?.trim()
    if (!title) return
    const topic = await cherry.topics.save({ session_id: activeId, title })
    setTopics(current => [topic, ...current.filter(item => item.id !== topic.id)])
  }

  const selectTopic = async (topicId: string) => {
    if (!activeId || !activeData) return
    const session = await cherry.sessions.update({ id: activeId, metadata: { ...activeData.session.metadata, topicId } })
    setActiveData(current => current ? { ...current, session } : current)
  }

  const exportSession = async (format: 'json' | 'md') => {
    if (!activeData) return
    const safeAttachments = attachments.map(item => ({ id: item.id, sourceType: item.source_type, name: item.original_name, mimeType: item.mime_type, size: item.size, sha256: item.sha256, status: item.status }))
    if (format === 'json') {
      const payload = JSON.stringify({ session: activeData.session, messages: activeData.messages, events: activeData.events, attachments: safeAttachments }, null, 2)
      await window.api.dialog.save(payload, (activeData.session.title || 'Agent 会话').replace(/[<>:"/\\|?*]/g, '_') + '.json')
      return
    }
    const lines = ['# ' + (activeData.session.title || 'Agent 会话'), '', '- Runtime: ' + activeData.session.runtime, '- Model: ' + (activeData.session.model_id || '未选择模型'), '']
    for (const item of activeData.messages) lines.push('## ' + item.role, '', contentText(item.content), '')
    await window.api.dialog.save(lines.join('\\n'), (activeData.session.title || 'Agent 会话').replace(/[<>:"/\\|?*]/g, '_') + '.md')
  }

  const importSession = async () => {
    try {
      const raw = await window.api.dialog.open()
      if (!raw) return
      const data = JSON.parse(raw) as unknown
      const imported = await cherry.sessions.import(data)
      setSessions(current => [imported, ...current.filter(item => item.id !== imported.id)])
      setActiveId(imported.id)
      const importedAttachments = await cherry.attachments.list(imported.id)
      setAttachments(importedAttachments)
      const missing = importedAttachments.filter(item => item.status !== 'available').length
      setError(missing > 0 ? '会话已导入，但有 ' + missing + ' 个附件没有随导出文件提供，已保留为缺失引用。' : '')
    } catch (cause) { setError(cause instanceof Error ? cause.message : '导入 Agent 会话失败') }
  }

  const interruptSession = async () => {
    if (!activeId) return
    await cherry.chat.interrupt(activeId)
    setBusy(false)
    await loadActive(activeId)
  }

  const retrySession = async (messageId?: string) => {
    if (!activeId || busy) return
    const retry = await cherry.chat.retry({ sessionId: activeId, messageId })
    if (!retry?.content) return
    setBusy(true)
    try {
      await cherry.chat.send({ sessionId: activeId, modelId: retry.session.model_id || model, content: retry.content, attachments: retry.attachments })
      await loadSessions()
      await loadActive(activeId)
    } finally { setBusy(false) }
  }

  const sendChat = async () => {
    if (!runtimeReady) { setError('Runtime 状态尚未就绪，发送暂停'); return }
    const text = message.trim()
    if (!text || busy) return
    if (providerRuntime && !selectedProvider) { setError("请先在设置中配置 AI Provider"); return }
    setBusy(true); setError(""); setStreamingState(initialAiMessagePartState)
    try {
      const session = await ensureSession()
      if (!session) return
      await cherry.chat.send({ sessionId: session.id, modelId: session.model_id || model, content: text, attachments: attachments.map(item => ({ attachmentId: item.id, name: item.original_name, mimeType: item.mime_type, size: item.size })), context: contexts })
      setMessage("")
      setAttachments([])
      setContexts([])
      await loadSessions(); await loadActive(session.id)
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Agent 请求失败") }
    finally { setBusy(false) }
  }

  const analyzeImage = async () => {
    if (!selectedImageId || !selectedProvider || busy) return
    setBusy(true); setError("")
    try {
      const session = await ensureSession()
      if (!session) return
      const data = await cherry.context.images.readData(Number(selectedImageId))
      await cherry.sessions.appendMessage({ sessionId: session.id, role: "user", content: { text: visionPrompt }, attachments: [{ type: "image", imageId: Number(selectedImageId) }] })
      const result = await cherry.media.vision({ providerId: selectedProvider.id, model: session.model_id || model, imageBase64: toBase64(data), prompt: visionPrompt })
      if (!result.success) throw new Error(result.error || "识图失败")
      await cherry.sessions.appendMessage({ sessionId: session.id, role: "assistant", content: { text: result.text || "" } })
      await loadSessions(); await loadActive(session.id)
    } catch (cause) { setError(cause instanceof Error ? cause.message : "识图失败") }
    finally { setBusy(false) }
  }

  const generateImage = async () => {
    if (!drawingPrompt.trim() || !selectedProvider || busy) return
    setBusy(true); setError("")
    try {
      const session = await ensureSession()
      if (!session) return
      const result = await cherry.media.generateImage({ providerId: selectedProvider.id, model: session.model_id || model, prompt: drawingPrompt.trim() })
      if (!result.success) throw new Error(result.error || "绘图失败")
      setDrawingResult(result.url || "已提交绘图请求")
      await cherry.sessions.appendMessage({ sessionId: session.id, role: "user", content: { text: drawingPrompt.trim() } })
      await cherry.sessions.appendMessage({ sessionId: session.id, role: "assistant", content: { text: result.url || "绘图任务已完成" } })
      await loadSessions(); await loadActive(session.id)
    } catch (cause) { setError(cause instanceof Error ? cause.message : "绘图失败") }
    finally { setBusy(false) }
  }

  const modeContent = useMemo(() => {
    if (mode === "mcp") return <McpPanel />
    if (mode === "logs") return <WorkspaceLogsPanel />
    if (mode === "sessions") return <SessionList sessions={sessions} activeId={activeId} query={sessionQuery} onQueryChange={setSessionQuery} onSelect={refreshActive} onCreate={() => void createSession("agent")} onDelete={deleteSession} onRename={async (id, title) => { const session = await cherry.sessions.update({ id, title }); setSessions(current => current.map(item => item.id === id ? session : item)); if (activeId === id) setActiveData(current => current ? { ...current, session } : current) }} onBranch={() => void branchSession()} onExport={exportSession} onImport={() => void importSession()} />
    if (mode === "vision") return <div className="space-y-3 p-4"><select className="ui-field w-full" value={selectedImageId} onChange={event => setSelectedImageId(event.target.value)}><option value="">选择图片资产</option>{images.map(image => <option key={image.id} value={image.id}>{image.original_name || "图片 " + image.id}</option>)}</select><textarea className="ui-field min-h-24 w-full resize-y" value={visionPrompt} onChange={event => setVisionPrompt(event.target.value)} /><Button variant="primary" icon={Eye} onClick={() => void analyzeImage()} disabled={!selectedImageId || busy}>{busy ? "识别中" : "分析图片"}</Button></div>
    if (mode === "drawing") return <div className="space-y-3 p-4"><textarea className="ui-field min-h-32 w-full resize-y" value={drawingPrompt} onChange={event => setDrawingPrompt(event.target.value)} placeholder="输入绘图提示词" /><Button variant="primary" icon={ImagePlus} onClick={() => void generateImage()} disabled={!drawingPrompt.trim() || busy}>{busy ? "生成中" : "生成图片"}</Button>{drawingResult && <div className="ui-inline-note ui-inline-note-info break-all text-xs">{drawingResult}</div>}</div>
    if (mode === "canvas") return <div className="flex h-full items-center justify-center p-6 text-center text-sm text-[var(--color-text-secondary)]">画布 Agent 将使用当前项目、选区、节点和资产作为上下文。请从无限画布打开 Agent 模式。</div>
    return <CherryChatView messages={messages} events={activeData?.events || []} streamingParts={streamingParts} value={message} onChange={setMessage} onSend={() => void sendChat()} onStop={() => void interruptSession()} busy={busy} attachments={attachments} onAttach={() => void attachFile()} onRemoveAttachment={removeAttachment} onOpenContext={() => document.querySelector('[data-agent-context-picker]')?.scrollIntoView({ behavior: 'smooth', block: 'center' })} onOpenTools={() => setMode('mcp')} modelLabel={model} onEdit={editMessage} onDelete={deleteMessage} onRetry={messageId => void retrySession(messageId)} onQuote={text => setMessage(current => current ? current + '\\n\\n> ' + text.replace(/\\n/g, '\\n> ') + '\\n' : '> ' + text.replace(/\\n/g, '\\n> ') + '\\n')} />
  }, [mode, sessions, activeId, sessionQuery, images, selectedImageId, visionPrompt, drawingPrompt, drawingResult, message, messages, streamingParts, busy, selectedProvider, model, selectedRuntime, runtimeStatuses, attachments])

  const header = <header className="flex min-h-14 shrink-0 flex-wrap items-center gap-3 border-b border-[var(--color-border)] bg-[var(--color-bg-primary)] px-4 py-2 shadow-sm">
        <div className="flex min-w-[7.5rem] shrink-0 items-center gap-2">
          <div className="grid size-8 shrink-0 place-items-center rounded-xl bg-[var(--color-accent)]/15 text-[var(--color-accent-text)]"><Bot size={17} /></div>
          <div className="min-w-0"><div className="truncate text-sm font-semibold text-[var(--color-text-primary)]">Agent 工作台</div><div className="truncate text-[10px] text-[var(--color-text-secondary)]">{activeData?.session.title || '统一 AI 会话、工具与上下文'}</div></div>
        </div>
        <div className="hidden shrink-0 items-center gap-2 text-[10px] text-[var(--color-text-secondary)]"><span className="rounded-md border border-[var(--color-border)] px-2 py-1">{selectedRuntime}</span><span className="max-w-32 truncate">{model || '未选择模型'}</span></div>
      </header>
  const notice = <>{permissionRequests.length > 0 && <div className="shrink-0 space-y-2 border-b border-amber-500/30 bg-amber-500/10 p-3">{permissionRequests.map(request => <div key={request.requestId} className="rounded-lg border border-amber-500/30 bg-[var(--color-bg-primary)] p-2 text-xs"><div className="font-semibold text-amber-700 dark:text-amber-300">等待权限确认：{request.permission}</div>{request.detail !== undefined && <pre className="mt-1 max-h-20 overflow-auto whitespace-pre-wrap text-[10px] text-[var(--color-text-secondary)]">{JSON.stringify(request.detail, null, 2)}</pre>}<div className="mt-2 flex flex-wrap gap-1"><Button size="sm" variant="primary" onClick={() => void decidePermission(request.requestId, 'allowOnce')}>允许一次</Button><Button size="sm" variant="secondary" onClick={() => void decidePermission(request.requestId, 'allowForSession')}>本会话允许</Button><Button size="sm" variant="ghost" onClick={() => void decidePermission(request.requestId, 'deny')}>拒绝</Button></div></div>)}</div>}{bridgeWarning && <div className="shrink-0 border-b border-amber-500/30 bg-amber-500/10 px-4 py-2 text-xs text-amber-700 dark:text-amber-300" role="alert">{bridgeWarning}</div>}</>
  // Modes live on their own wrapping row, not inside the panel header: the header has a fixed height, so a
  // wrapped row there is clipped and the last modes become unreachable (measured at a 351px panel).
  const modeRow = (
    <div className='flex flex-wrap items-center gap-1 px-2 pb-1.5' role='tablist' aria-label='Agent 模式'>
      {MODES.map(item => {
        const Icon = item.icon
        return (
          <button
            key={item.id}
            type='button'
            role='tab'
            aria-selected={mode === item.id}
            onClick={() => setMode(item.id)}
            className={'flex shrink-0 items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs transition-colors ' + (mode === item.id ? 'bg-[var(--color-accent)]/15 font-medium text-[var(--color-accent-text)]' : 'text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-tertiary)] hover:text-[var(--color-text-primary)]')}
          >
            <Icon size={14} aria-hidden='true' />
            {item.label}
          </button>
        )
      })}
    </div>
  )
  // The header keeps the title/runtime/model only: its height is fixed, so the mode switcher moved to its
  // own wrapping row above the conversation body.
  const conversationHeader = <CherryConversationHeader title="Agent 工作台" subtitle={activeData?.session.title || '统一 AI 会话、工具与上下文'} mode={mode} modes={[]} runtime={selectedRuntime} model={model} onModeChange={() => {}} />
  const sessionSidebar = <CherrySessionSidebar sessions={sessions} activeId={activeId} query={sessionQuery} onQueryChange={setSessionQuery} onSelect={refreshActive} onCreate={() => void createSession()} onDelete={deleteSession} onRename={async (id, title) => { const session = await cherry.sessions.update({ id, title }); setSessions(current => current.map(item => item.id === id ? session : item)); if (activeId === id) setActiveData(current => current ? { ...current, session } : current) }} onBranch={() => void branchSession()} onExport={exportSession} onImport={() => void importSession()} assistants={assistants} topics={topics} activeAssistantId={activeAssistantId} onAssistantChange={id => void changeAssistant(id)} onTopicCreate={() => void createTopic()} onTopicSelect={id => void selectTopic(id)} />
  const context = <><ContextPanel providers={providers} provider={selectedProvider} model={model} catalogModels={catalogModels} runtimeStatuses={runtimeStatuses} runtime={selectedRuntime} onRuntimeChange={changeRuntime} onRefreshRuntimes={refreshRuntimes} onProviderChange={changeProvider} onModelChange={async nextModel => { setModelOverride(nextModel); setRuntimeModelMemory(current => ({ ...current, [selectedRuntime]: nextModel })); if (activeId) { const session = await cherry.sessions.update({ id: activeId, modelId: nextModel }); setActiveData(current => current ? { ...current, session } : current) } }} session={activeData?.session || null} events={activeData?.events || []} onInterrupt={() => void interruptSession()} onRetry={() => void retrySession()} busy={busy} onOpenSettings={() => void cherry.windows.openSettings()} /><CherryContextPicker contexts={contexts} onChange={setContexts} /></>
  const errorView = error ? <div className="shrink-0 border-t border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-500" role="alert">{error}</div> : null
  const body = <CherryAgentShell header={conversationHeader} notice={notice} toolbar={variant === 'compact' ? <CompactRuntimeBar runtime={selectedRuntime} runtimeStatuses={runtimeStatuses} onRuntimeChange={changeRuntime} onRefresh={refreshRuntimes} onOpenWorkspace={() => void cherry.windows.openAI()} /> : undefined} compact={variant === 'compact'} center={<div className="flex h-full min-h-0 flex-col">{modeRow}{modeContent}</div>} sidebar={sessionSidebar} context={context} error={errorView} />
  if (legacyUi && variant === 'workspace') return <ChatLayout />
  return variant === "compact" ? body : <CherryHostProvider bridge={cherry}><div className="h-full min-h-0 overflow-hidden bg-[var(--color-bg-secondary)]">{body}</div></CherryHostProvider>
}

function SessionList({ sessions, activeId, query, onQueryChange, onSelect, onCreate, onDelete, onRename, onBranch, onExport, onImport }: { sessions: AiSessionRecord[]; activeId: string | null; query: string; onQueryChange: (value: string) => void; onSelect: (id: string) => void; onCreate: () => void; onDelete: (id: string) => void; onRename: (id: string, title: string) => Promise<void>; onBranch: () => void; onExport: (format: 'json' | 'md') => void; onImport: () => void }) {
  const groups = sessions.reduce<Record<string, AiSessionRecord[]>>((result, session) => {
    const date = new Date(session.updated_at)
    const today = new Date()
    const startToday = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime()
    const sessionTime = Number.isNaN(date.getTime()) ? 0 : date.getTime()
    const key = sessionTime >= startToday ? '今天' : sessionTime >= startToday - 86400000 ? '昨天' : sessionTime >= startToday - 7 * 86400000 ? '本周' : '更早'
    ;(result[key] ||= []).push(session)
    return result
  }, {})
  const rename = async (session: AiSessionRecord) => {
    const next = window.prompt('重命名会话', session.title || '未命名会话')
    if (next && next.trim() && next.trim() !== session.title) await onRename(session.id, next.trim())
  }
  return <div className="space-y-3"><div className="flex items-center justify-between"><div><div className="text-xs font-semibold text-[var(--color-text-primary)]">会话</div><div className="mt-0.5 text-[10px] text-[var(--color-text-secondary)]">对话、识图、绘图和画布 Agent 共用</div></div><div className="flex items-center gap-1"><IconButton icon={Plus} label="新建会话" onClick={onCreate} /><IconButton icon={GitBranch} label="复制当前会话分支" onClick={onBranch} disabled={!activeId} /><IconButton icon={Download} label="导出当前会话 JSON" onClick={() => onExport('json')} disabled={!activeId} /><IconButton icon={FileText} label="导出当前会话 Markdown" onClick={() => onExport('md')} disabled={!activeId} /></div></div><div className="flex gap-1"><input className="ui-field min-w-[8rem] flex-1 text-xs" value={query} onChange={event => onQueryChange(event.target.value)} placeholder="搜索会话、模型或 Runtime" aria-label="搜索会话" /><button type="button" className="ui-toolbar-button" onClick={onImport} aria-label="导入 Agent 会话" title="导入 JSON 会话"><Upload size={14} /></button></div>{sessions.length === 0 ? <EmptyState icon={MessageSquare} title="暂无会话" description="创建一个 Agent 会话" /> : Object.entries(groups).map(([group, items]) => <section key={group} className="space-y-1.5"><div className="px-1 text-[10px] font-semibold uppercase tracking-wide text-[var(--color-text-secondary)]">{group}</div>{items.map(session => <div key={session.id} className={'group w-full rounded-xl border p-2.5 transition-colors ' + (activeId === session.id ? 'border-[var(--color-accent)] bg-[var(--color-accent)]/10' : 'border-[var(--color-border)] hover:border-[var(--color-border-strong)]')}><button type="button" onClick={() => onSelect(session.id)} className="w-full text-left"><div className="truncate text-xs font-medium text-[var(--color-text-primary)]">{session.title || '未命名会话'}</div><div className="mt-1 flex items-center justify-between gap-2 text-[10px] text-[var(--color-text-secondary)]"><span className="min-w-0 truncate">{session.runtime} · {session.model_id || '未选择模型'}</span><StatusBadge tone={session.status === 'failed' ? 'danger' : session.status === 'running' ? 'warning' : 'success'}>{session.status}</StatusBadge></div></button><div className="mt-1 flex justify-end gap-2 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100"><button type="button" className="text-[10px] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]" onClick={() => void rename(session)}>重命名</button><button type="button" className="text-[10px] text-red-500" onClick={() => onDelete(session.id)}>删除</button></div></div>)}</section>)}</div>
}

function CherryChatView({ messages, events, streamingParts, value, onChange, onSend, onStop, busy, attachments, onAttach, onRemoveAttachment, onOpenContext, onOpenTools, modelLabel, onEdit, onDelete, onRetry, onQuote }: { messages: AiMessageRecord[]; events: AiEventRecord[]; streamingParts: AiMessagePart[]; value: string; onChange: (value: string) => void; onSend: () => void; onStop: () => void; busy: boolean; attachments: AiAttachmentRecord[]; onAttach: () => void; onRemoveAttachment: (id: string) => void; onOpenContext: () => void; onOpenTools: () => void; modelLabel: string; onEdit: (id: string, text: string) => Promise<void>; onDelete: (id: string) => Promise<void>; onRetry: (id: string) => void; onQuote: (text: string) => void }) {
  return <div className="flex h-full min-h-0 flex-col"><CherryMessageList messages={messages} events={events} streamingParts={streamingParts} attachments={attachments} onCopy={text => { void navigator.clipboard?.writeText(text) }} onEdit={onEdit} onDelete={onDelete} onRetry={onRetry} onQuote={onQuote} /><CherryComposer value={value} onChange={onChange} onSend={onSend} onStop={onStop} busy={busy} attachments={attachments} onAttach={onAttach} onRemoveAttachment={onRemoveAttachment} onOpenContext={onOpenContext} onOpenTools={onOpenTools} modelLabel={modelLabel} /></div>
}

function ContextPanel({ providers, provider, model, catalogModels, runtimeStatuses, runtime, onRuntimeChange, onRefreshRuntimes, onProviderChange, onModelChange, session, events, onInterrupt, onRetry, busy, onOpenSettings }: { providers: Array<{ id: string; name: string; default_model: string; models: string[] }>; provider?: { id: string; name: string; default_model: string; models: string[] } | null; model: string; catalogModels: Array<{ id: string; name?: string; capabilities?: string[]; contextWindow?: number; maxOutputTokens?: number }>; runtimeStatuses: RuntimeStatus[]; runtime: AiRuntimeKind; onRuntimeChange: (runtime: AiRuntimeKind) => Promise<void>; onRefreshRuntimes: () => Promise<void>; onProviderChange: (id: string) => Promise<void>; onModelChange: (model: string) => Promise<void>; session: AiSessionRecord | null; events: AiEventRecord[]; onInterrupt: () => void; onRetry: () => void; busy: boolean; onOpenSettings: () => void }) {
  const selectedStatus = runtimeStatuses.find(item => item.kind === runtime)
  return <div className="space-y-3">
    <div className="flex items-center justify-between"><div className="text-xs font-semibold text-[var(--color-text-secondary)]">上下文与模型</div><div className="flex items-center gap-1"><IconButton icon={Settings2} label="打开 AI 设置" onClick={onOpenSettings} /><button type="button" className="text-[10px] text-[var(--color-accent-text)]" onClick={() => void onRefreshRuntimes()}>刷新 Runtime</button></div></div>
    <div className="ui-list-card space-y-2 p-3 text-xs"><label className="block"><span className="mb-1 block text-[var(--color-text-secondary)]">Runtime</span><select aria-label="Runtime" className="ui-field w-full" value={runtime} onChange={event => void onRuntimeChange(event.target.value as AiRuntimeKind)}>{RUNTIMES.map(item => { const status = runtimeStatuses.find(value => value.kind === item.id); return <option key={item.id} value={item.id} disabled={Boolean(status && !status.available)}>{item.label}{status && !status.available ? '（不可用）' : ''}</option> })}</select>{selectedStatus && <div className={'mt-1 text-[10px] leading-4 ' + (selectedStatus.available ? 'text-emerald-500' : 'text-amber-500')}>{selectedStatus.available ? (selectedStatus.version || selectedStatus.message) : selectedStatus.message}</div>}</label></div>
    <CherryProviderModelSelector providers={providers} provider={provider} catalogModels={catalogModels} model={model} runtime={runtime} contract={selectedStatus?.contract} ready={selectedStatus?.available === true} onProviderChange={onProviderChange} onModelChange={onModelChange} />
    {session && <div className="ui-list-card flex items-center justify-between gap-3 p-3 text-xs"><span className="min-w-0 truncate text-[var(--color-text-secondary)]">{session.title || session.id}</span><div className="flex shrink-0 gap-2"><button type="button" className="text-[10px] text-amber-600" onClick={onRetry} disabled={busy}>重试</button><button type="button" className="text-[10px] text-red-500" onClick={onInterrupt} disabled={!busy}>停止</button></div></div>}
    <div className="ui-list-card space-y-2 p-3 text-xs"><div className="font-semibold text-[var(--color-text-secondary)]">Runtime 状态</div>{runtimeStatuses.map(item => <div key={item.kind} className="flex items-start justify-between gap-2"><span className="text-[var(--color-text-primary)]">{RUNTIMES.find(value => value.id === item.kind)?.label || item.kind}</span><span className={item.available ? 'text-emerald-500' : 'text-amber-500'}>{item.available ? (item.version || item.source) : '不可用'}</span></div>)}</div>
    {events.length > 0 && <div className="ui-list-card space-y-1 p-3 text-[10px]"><div className="font-semibold text-[var(--color-text-secondary)]">最近事件</div>{events.slice(-8).reverse().map(event => <div key={event.id} className="truncate text-[var(--color-text-secondary)]">{event.event_type} · {JSON.stringify(event.payload)}</div>)}</div>}
    <div className="ui-list-card p-3 text-xs text-[var(--color-text-secondary)]">工具、MCP、权限和画布资产会通过右侧上下文 Chip 按需注入。</div>
  </div>
}

function CompactRuntimeBar({ runtime, runtimeStatuses, onRuntimeChange, onRefresh, onOpenWorkspace }: { runtime: AiRuntimeKind; runtimeStatuses: RuntimeStatus[]; onRuntimeChange: (runtime: AiRuntimeKind) => Promise<void>; onRefresh: () => Promise<void>; onOpenWorkspace: () => void }) {
  const status = runtimeStatuses.find(item => item.kind === runtime)
  return <div className="flex shrink-0 items-center gap-2 border-b border-[var(--color-border)] px-3 py-2 text-xs"><span className="text-[var(--color-text-secondary)]">Runtime</span><select aria-label="Runtime" className="ui-field min-w-0 flex-1 py-1 text-xs" value={runtime} onChange={event => void onRuntimeChange(event.target.value as AiRuntimeKind)}>{RUNTIMES.map(item => { const itemStatus = runtimeStatuses.find(value => value.kind === item.id); return <option key={item.id} value={item.id} disabled={Boolean(itemStatus && !itemStatus.available)}>{item.label}{itemStatus && !itemStatus.available ? '（不可用）' : ''}</option> })}</select><span className={status?.available ? 'text-emerald-500' : 'text-amber-500'}>{status?.available ? '可用' : '需准备'}</span><button type="button" className="text-[var(--color-accent-text)]" onClick={() => void onRefresh()}>刷新</button><button type="button" className="text-[var(--color-accent-text)]" onClick={onOpenWorkspace}>完整工作台</button></div>
}
