import type { AiAssistantRecord, AiAttachmentRecord, AiEventRecord, AiMessageRecord, AiResourceOrderAnchor, AiResourceRecord, AiRuntimeKind, AiSessionKind, AiSessionRecord, AiTopicRecord } from './ai-types'
import type { Provider, ProviderSaveInput } from './types'
import type { RuntimeSelectionContract } from './runtime-contract'

export type CherryCapabilityState = 'available' | 'partial' | 'blocked' | 'unsupported'

export type CherryCapabilityStatus = {
  id: string
  state: CherryCapabilityState
  message: string
  nextAction?: string
}

export type CherrySessionSnapshot = {
  session: AiSessionRecord
  messages: AiMessageRecord[]
  events: AiEventRecord[]
}

export type CherrySessionListQuery = {
  query?: string
  kind?: AiSessionKind
  limit?: number
  includeArchived?: boolean
  latestOnly?: boolean
  manualOrder?: boolean
}

export type CherrySessionCreateInput = {
  kind?: AiSessionKind
  runtime?: AiRuntimeKind
  providerId?: string
  modelId?: string
  title?: string
  parentId?: string
  metadata?: Record<string, unknown>
}

export type CherrySessionSendInput = {
  sessionId: string
  content: string
  modelId?: string
  attachments?: unknown[]
  context?: unknown[]
}

export type CherryModelRecord = {
  id: string
  name?: string
  providerId?: string
  capabilities?: string[]
  contextWindow?: number
  maxOutputTokens?: number
  status?: CherryCapabilityState
  message?: string
}

export type CherryRuntimeStatus = {
  kind: AiRuntimeKind | string
  available: boolean
  source: string
  /** Main-process driver selected for this runtime; used for diagnostics, not UI branching. */
  driver?: string
  executable: string | null
  version: string | null
  message: string
  checkedAt?: string
  contract: RuntimeSelectionContract
}

export interface CherryChatEngine {
  send(input: CherrySessionSendInput): Promise<{ text: string; session: AiSessionRecord }>
  interrupt(sessionId: string): Promise<boolean>
  retry(input: string | { sessionId: string; messageId?: string }): Promise<{ session: AiSessionRecord; content: string; attachments?: unknown[] } | null>
  compact(sessionId: string): Promise<AiSessionRecord>
  onEvent(callback: (value: { kind: 'message' | 'message-deleted' | 'event' | 'delta' | 'resource'; sessionId?: string; messageId?: string; text?: string; record?: AiMessageRecord | AiEventRecord | AiResourceRecord }) => void): () => void
}

export interface CherryMediaApi {
  vision(input: { providerId: string; model: string; imageBase64: string; prompt?: string }): Promise<{ success?: boolean; text?: string; error?: string }>
  generateImage(input: { providerId: string; model: string; prompt: string }): Promise<{ success?: boolean; url?: string; error?: string }>
}

export interface CherrySessionApi {
  list(input?: CherrySessionListQuery): Promise<AiSessionRecord[]>
  search(input?: CherrySessionListQuery): Promise<AiSessionRecord[]>
  get(id: string): Promise<CherrySessionSnapshot | null>
  create(input?: CherrySessionCreateInput): Promise<AiSessionRecord>
  import(input: unknown): Promise<AiSessionRecord>
  update(input: Record<string, unknown>): Promise<AiSessionRecord>
  archive(id: string): Promise<AiSessionRecord>
  restore(id: string): Promise<AiSessionRecord>
  pin(id: string, pinned: boolean): Promise<AiSessionRecord>
  reorder(input: { id: string; overId: string; position: 'before' | 'after' | 'last' }): Promise<AiSessionRecord>
  delete(id: string): Promise<boolean>
  branch(input: { sessionId: string; title?: string }): Promise<AiSessionRecord>
  appendMessage(input: Record<string, unknown>): Promise<AiMessageRecord>
  updateMessage(input: Record<string, unknown>): Promise<AiMessageRecord>
  deleteMessage(id: string): Promise<boolean>
  appendEvent(input: Record<string, unknown>): Promise<AiEventRecord>
  runtimes: {
    list(): Promise<CherryRuntimeStatus[]>
    prepare(kind: string): Promise<CherryRuntimeStatus>
  }
}

export interface CherryAssistantApi {
  list(input?: { includeArchived?: boolean; manualOrder?: boolean }): Promise<AiAssistantRecord[]>
  save(input: Partial<AiAssistantRecord> & { id?: string }): Promise<AiAssistantRecord>
  delete(id: string): Promise<boolean>
  archive(id: string): Promise<AiAssistantRecord>
  restore(id: string): Promise<AiAssistantRecord>
  pin(id: string, pinned: boolean): Promise<AiAssistantRecord>
  reorder(input: { id: string; anchor: AiResourceOrderAnchor }): Promise<AiAssistantRecord>
}

export interface CherryLatestApi {
  /** Source `/agent-sessions/latest`: last-touched session by activity, not list order. */
  session(input?: { kind?: AiSessionKind }): Promise<AiSessionRecord | null>
  /** Source `/topics/latest`: `sessionId` scopes to one owner, `null` is the 'unlinked' scope, omitted is global. */
  topic(input?: { sessionId?: string | null }): Promise<AiTopicRecord | null>
}

export interface CherryTopicApi {
  list(input: { sessionId: string; includeArchived?: boolean; manualOrder?: boolean }): Promise<AiTopicRecord[]>
  save(input: Partial<AiTopicRecord> & { session_id: string; id?: string }): Promise<AiTopicRecord>
  delete(id: string): Promise<boolean>
  archive(id: string): Promise<AiTopicRecord>
  restore(id: string): Promise<AiTopicRecord>
  pin(id: string, pinned: boolean): Promise<AiTopicRecord>
  reorder(input: { id: string; anchor: AiResourceOrderAnchor; ownerId?: string }): Promise<AiTopicRecord>
  latest(input: { sessionId: string }): Promise<AiTopicRecord | null>
}

export interface CherryProviderApi {
  list(): Promise<Provider[]>
  save(input: ProviderSaveInput): Promise<{ id: string }>
  delete(id: string): Promise<boolean>
  setActive(id: string): Promise<boolean>
  fetchModels(baseUrl: string, apiKey: string): Promise<{ success?: boolean; models?: string[]; error?: string }>
  fetchModelsForProvider(input: { providerId: string; apiKey?: string }): Promise<{ success?: boolean; models?: string[]; error?: string }>
  test(baseUrl: string, apiKey: string, model: string, protocol?: 'chat_completions' | 'responses'): Promise<{ success: boolean; message?: string; error?: string }>
  testProvider(input: { providerId: string; apiKey?: string; model?: string; protocol?: 'chat_completions' | 'responses' }): Promise<{ success: boolean; message?: string; error?: string }>
}

export interface CherryModelApi {
  list(input?: { query?: string; providerId?: string; capability?: string; limit?: number }): Promise<CherryModelRecord[]>
  providers(input?: { query?: string }): Promise<unknown[]>
}

export interface CherryMcpApi {
  list(): Promise<unknown[]>
  save(input: Record<string, unknown>): Promise<unknown>
  delete(id: string): Promise<boolean>
  connect(id: string): Promise<unknown>
  disconnect(id: string): Promise<unknown>
  callTool(input: { serverId: string; name: string; arguments?: Record<string, unknown> }): Promise<unknown>
}

export interface CherrySettingsApi {
  getAll(): Promise<Record<string, unknown>>
  set(key: string, value: string): Promise<boolean>
}

export interface CherryAttachmentApi {
  select(): Promise<string | null>
  list(sessionId: string): Promise<AiAttachmentRecord[]>
  import(input: { sessionId: string; filePath: string; sourceType?: string; messageId?: string | null }): Promise<AiAttachmentRecord>
  delete(id: string): Promise<boolean>
  read(id: string): Promise<{ id: string; mimeType: string; originalName: string; status: 'available' | 'missing' | 'deleted'; dataUrl?: string; text?: string }>
}

export interface CherryContextApi {
  images: {
    list(): Promise<Array<{ id: number; original_name: string | null }>>
    readData(id: number): Promise<string>
  }
  prompts: {
    list(input?: Record<string, unknown>): Promise<unknown>
  }
  tags: {
    search(input?: { query?: string; limit?: number }): Promise<unknown[]>
  }
  canvases: {
    list(): Promise<unknown[]>
  }
  wd14: {
    history: {
      list(input?: Record<string, unknown>): Promise<unknown[]>
    }
  }
}

export interface CherryPermissionApi {
  onRequest(callback: (value: { requestId: string; sessionId: string; permission: 'read' | 'write' | 'execute' | 'network'; detail?: unknown }) => void): () => void
  decide(value: { requestId: string; decision: 'allowOnce' | 'allowForSession' | 'deny' | 'cancel' }): Promise<boolean>
}

export interface CherryWindowApi {
  openSettings(): Promise<void>
  openAI(): Promise<void>
  openCherry(): Promise<void>
  open(kind: 'main' | 'settings' | 'ai' | 'cherry' | 'quickAssistant' | 'selectionToolbar' | 'selectionAction' | 'subWindow' | 'screenshot'): Promise<CherryCapabilityStatus>
}

export interface CherryDomainApi {
  status(): Promise<CherryCapabilityStatus>
  list?(input?: Record<string, unknown>): Promise<unknown[]>
  get?(id: string): Promise<unknown>
  invoke?(operation: string, input?: unknown): Promise<unknown>
}

export interface CherryHostBridge {
  chat: CherryChatEngine
  media: CherryMediaApi
  sessions: CherrySessionApi
  assistants: CherryAssistantApi
  topics: CherryTopicApi
  latest: CherryLatestApi
  providers: CherryProviderApi
  models: CherryModelApi
  mcp: CherryMcpApi
  settings: CherrySettingsApi
  attachments: CherryAttachmentApi
  context: CherryContextApi
  permissions: CherryPermissionApi
  windows: CherryWindowApi
  domains: {
    browser: CherryDomainApi
    knowledge: CherryDomainApi
    files: CherryDomainApi
    code: CherryDomainApi
    paintings: CherryDomainApi
    notes: CherryDomainApi
    translate: CherryDomainApi
    selection: CherryDomainApi
    scheduledTasks: CherryDomainApi
    skills: CherryDomainApi
  }
}
