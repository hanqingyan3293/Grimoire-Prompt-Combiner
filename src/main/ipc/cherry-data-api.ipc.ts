import { app, BrowserWindow, dialog, ipcMain, nativeTheme, shell } from 'electron'
import type { WebContents } from 'electron'
import crypto from 'crypto'
import fs from 'fs'
import path from 'path'
import { IPC_CHANNELS } from '../../shared/types'
import { getDatabase, saveDatabase } from '../database'
import { encryptKey } from './providers.ipc'
import { deleteMcpServer, listMcpServers, saveMcpServer } from '../services/mcp.service'
import { listSystemFonts } from '../services/system-fonts.service'
import { hasWritePermission, isPathInside, resolveUserPath } from '../services/cherry-path.service'
import { handleCherryWindowRequest } from '../services/cherry-window.service'
import { handleCherryNavigationRequest, isRegisteredCherryNavigationSender } from '../services/cherry-navigation.service'
import { isTrustedCherryMainFrame } from '../services/cherry-ipc-admission'
import { archiveAiAssistant, archiveAiTopic, getLatestAiTopic, listAiAssistants, listAiTopics, restoreAiAssistant, restoreAiTopic, saveAiAssistant, saveAiTopic } from '../services/cherry-assistant.service'
import { deleteAiSession, getAiSession, listAiSessions, restoreAiSession } from '../services/ai-session.service'
import { decideAiSessionPermission, handleAiSessionInterrupt, handleAiSessionSend } from './ai-sessions.ipc'
import { decideAgentSessionPermission, handleAgentSessionSend } from './agent.ipc'
import { createPromptAsset, deletePromptAsset, orderedPromptAssetIds, queryPromptAssets, reorderPromptAsset, updatePromptAsset } from '../services/prompt-asset-browser'
import type { PromptOrderAnchor } from '../services/prompt-asset-browser'
import { listAiUsage, listUsageTimeline, projectUsageEntry, projectUsageTotals, summarizeAiUsage } from '../services/usage.service'
import { isPreventSleepActive, readLaunchOnBoot } from '../services/app-preferences.service'
import type { PromptAssetItem } from '../../shared/prompt-asset-types'
import type { AiAssistantRecord, AiTopicRecord } from '../../shared/ai-types'
import { getActiveLogPath } from '../services/logger.service'
import { onMcpToolProgress } from '../services/mcp.service'
import { findPinById, listPins, setPin } from '../services/cherry-pin.service'
import { createGroup, deleteGroup, getGroup, listGroups, renameGroup, reorderGroup } from '../services/cherry-group.service'
import { listTopicsPage } from '../services/cherry-topic-list.service'
import { listArchives } from '../services/cherry-archive.service'
import { fileLibraryStats, findFileLibraryEntry, queryFileLibrary } from '../services/cherry-file-library.service'
import { batchCreateInternalEntries, batchGetDanglingStates, batchGetMetadata, batchGetPhysicalPaths, batchRemoveFromLibrary, renameEntry, resolveEntryPath } from '../services/cherry-file-ipc.service'
import { bindToTarget, listBindings, listBindingRelations, unbindFromTarget } from '../services/cherry-prompt-binding.service'
import type { McpServerRecord } from '../../shared/agent-types'
import type { Provider } from '../../shared/types'
import type { AgentBlueprint, ListAgentBlueprints, UpdateAgentBlueprint } from '../../shared/agent-blueprint-types'
import { createAgentBlueprint, getAgentBlueprint, listAgentBlueprints, updateAgentBlueprint } from '../services/agent-blueprint.service'
import { hasAgentRuntime } from '../ai/runtime/registry'
import { getAgentSession, listAgentSessions, normalizeAgentSessionData } from '../services/agent-session.service'
import { findOrCreateAgentWorkspace, getAgentWorkspace, listAgentWorkspaces, reorderAgentWorkspace, updateAgentWorkspace } from '../services/agent-workspace.service'
import { handleCherryFileTreeRoute } from './cherry-file-tree.ipc'
import type { AgentWorkspace, AgentWorkspaceOrder } from '../../shared/agent-workspace-types'
import { createAgentSessionReadModel, getAgentSessionReadModel, getLatestAgentSessionReadModel, listAgentSessionReadModels, reuseOrCreateAgentSessionReadModel, setAgentSessionReadModelWorkspace, updateAgentSessionReadModel } from '../services/agent-session-read-model.service'
import { CherryAgentMessageError, getCherryAgentMessage, listCherryAgentMessages } from '../services/cherry-agent-message.service'
import type { CherryAgentMessageQuery } from '../services/cherry-agent-message.service'
import type { AgentSessionReadModel, CreateAgentSessionReadModel, UpdateAgentSessionReadModel, AgentSessionWorkspaceSource, ReuseOrCreateAgentSessionReadModel } from '../../shared/agent-session-read-model'
import * as blueprintValidation from '../services/agent-blueprint.validation'
import { appendTopicMessage, readTopicBranch, selectTopicContentNode } from '../services/topic-tree.service'
import { TopicTreeError } from '../../shared/topic-tree'
import { AgentPrewarmUnavailableError, agentSessionPrewarmService } from '../services/agent-session-prewarm.service'
import type { AppendTopicMessage, TopicBranchQuery, TopicTreeMessage } from '../../shared/topic-tree'

/**
 * Grimoire-backed transport for the source Cherry DataApi (`window.api.dataApi.request`).
 *
 * The source Provider Settings page reads/writes `/providers*` through
 * `DataApiService`, which resolves `window.api.dataApi.request(request)` and expects a
 * `DataResponse` envelope (`{ id, status, data?, error? }`). This handler maps the
 * implemented subset of `/providers` routes onto Grimoire's existing providers table
 * and returns the SOURCE `Provider` shape the page's zod schemas and views read.
 *
 * Only the routes the mounted settings subtree actually calls are served; anything
 * else answers with a 404-style error envelope so a missing implementation surfaces
 * as a visible error (matching the source page's error state) instead of `undefined`
 * silently flowing into a component.
 *
 * Secrets never travel: `apiKeys` entries carry a masked placeholder key and the
 * `hasApiKey`-style signal is derived from the stored ciphertext length, never the
 * plaintext. Writing keys stays on the Grimoire `providers.save` IPC path.
 */

type DataApiRequest = {
  id?: string
  method?: string
  path?: string
  params?: Record<string, unknown>
  body?: unknown
}

const SECRET_PLACEHOLDER = '••••••••'
const MASKED_SECRET_VALUE = SECRET_PLACEHOLDER

function sourceProviderFromRow(row: unknown[]): Record<string, unknown> {
  const id = String(row[0])
  const name = String(row[1] || '')
  const accessMode = String(row[2] || 'api')
  const protocol = String(row[3] || 'chat_completions')
  const baseUrl = String(row[4] || '')
  const apiKey = String(row[5] || '')
  const defaultModel = String(row[6] || '')
  const models = (() => {
    try { const parsed = JSON.parse(String(row[9] || '[]')); return Array.isArray(parsed) ? parsed.map(String) : [] } catch { return [] }
  })()
  const isActive = Number(row[10] || 0) === 1
  const hasKey = apiKey.length > 0

  return {
    id,
    name: name || id,
    // Source `authType` union drives the settings editor branches; Grimoire's
    // `access_mode` maps login→oauth and api→api-key.
    authType: accessMode === 'login' ? 'oauth' : 'api-key',
    reportsActualCost: false,
    apiKeys: hasKey ? [{ id: 'stored', key: SECRET_PLACEHOLDER, isEnabled: true, label: '' }] : [],
    authConfig: accessMode === 'login' ? {} : null,
    isEnabled: isActive || Boolean(baseUrl),
    // The endpoint config key must match the reported `defaultChatEndpoint` — the source
    // editor reads/writes `endpointConfigs[defaultChatEndpoint]`, so a fixed 'openai' key
    // would strand a responses-protocol provider's base URL under the wrong endpoint.
    endpointConfigs: baseUrl
      ? { [protocol === 'responses' ? 'openai-response' : 'openai']: { baseUrl } }
      : {},
    defaultChatEndpoint: protocol === 'responses' ? 'openai-response' : 'openai',
    settings: { defaultModel, contextSize: row[8] == null ? null : Number(row[8]) },
    models: models.map(model => ({ id: model, name: model })),
    description: undefined,
    presetProviderId: undefined
  }
}

function listSourceProviders(): Record<string, unknown>[] {
  const rows = getDatabase().exec('SELECT * FROM providers ORDER BY created_at DESC')[0]?.values || []
  return rows.map(sourceProviderFromRow)
}

/**
 * Reads/writes a Cherry-only preference the way the compat preference shim stores it
 * (`cherry_pref.<key>` as JSON in the Grimoire settings table). Used by the routes
 * whose real behaviour depends on a stored preference (`app.adjust_zoom` →
 * `app.zoom_factor`); everything else goes through the shim itself.
 */
function readCherryPreference(key: string): unknown {
  const row = getDatabase().exec('SELECT value FROM settings WHERE key=?', ['cherry_pref.' + key])[0]?.values?.[0]
  if (!row) return undefined
  try { return JSON.parse(String(row[0])) } catch { return undefined }
}

function writeCherryPreference(key: string, value: unknown): void {
  getDatabase().run(
    'INSERT INTO settings (key, value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=?',
    ['cherry_pref.' + key, JSON.stringify(value), JSON.stringify(value)]
  )
  saveDatabase()
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) window.webContents.send('data:refresh')
  }
}

function readBodyString(body: Record<string, unknown>, key: string): string {
  const value = body[key]
  return typeof value === 'string' ? value : ''
}

/**
 * Parses the source `OrderRequestSchema` union: exactly one of `before` / `after` /
 * `{position: 'first'|'last'}`.
 *
 * Returns `null` for anything else rather than defaulting to "move to the end". The source
 * schema is `.strict()`, so an unrecognised body is a client error; silently treating it as
 * `position: last` would move the user's prompt somewhere they did not ask for and report
 * success.
 */
function parsePromptOrderAnchor(value: unknown): PromptOrderAnchor | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const record = value as Record<string, unknown>
  if (typeof record.before === 'string' && record.before) return { before: record.before }
  if (typeof record.after === 'string' && record.after) return { after: record.after }
  if (record.position === 'first' || record.position === 'last') return { position: record.position }
  return null
}

/** Applies a source `UpdateProviderDto`-shaped body onto the Grimoire providers row. */
function applyProviderUpdate(providerId: string, body: Record<string, unknown>): void {
  const db = getDatabase()
  const row = db.exec('SELECT id FROM providers WHERE id=?', [providerId])[0]?.values?.[0]
  if (!row) throw new Error('PROVIDER_NOT_FOUND: Provider 不存在')

  const patch: string[] = []
  const params: unknown[] = []
  const name = readBodyString(body, 'name')
  if (name) { patch.push('name=?'); params.push(name) }
  if (typeof body.isEnabled === 'boolean') { patch.push('is_active=?'); params.push(body.isEnabled ? 1 : 0) }

  // The deep-link import updates through this route with `defaultChatEndpoint`, so the
  // protocol column follows it the same way the create path does.
  if (body.defaultChatEndpoint !== undefined) {
    patch.push('protocol=?'); params.push(protocolForDefaultChatEndpoint(body.defaultChatEndpoint))
  }
  const baseUrl = readEndpointConfigBaseUrl(body.endpointConfigs)
  if (baseUrl) { patch.push('base_url=?'); params.push(baseUrl) }
  const settings = body.settings
  if (settings && typeof settings === 'object') {
    const defaultModel = readBodyString(settings as Record<string, unknown>, 'defaultModel')
    if (defaultModel) { patch.push('default_model=?'); params.push(defaultModel) }
  }
  // Key replacement: the source PUT sends plaintext keys here; encrypt like the
  // Grimoire save path so the ciphertext format stays uniform.
  const apiKeys = body.apiKeys
  if (Array.isArray(apiKeys) && apiKeys.length > 0) {
    const first = apiKeys[0] as Record<string, unknown>
    const key = typeof first?.key === 'string' ? first.key : ''
    if (key && key !== SECRET_PLACEHOLDER) {
      patch.push('api_key=?'); params.push(encryptKey(key))
    }
  }
  // Models: the source stores rich `Model` rows; Grimoire stores a JSON array of bare
  // string IDs. A PATCH with `models` replaces the whole array — the same semantics the
  // provider-sync flow uses when it reconciles the list after a fetch.
  if (Array.isArray(body.models)) {
    const ids = body.models.map((m: unknown) => typeof m === 'string' ? m : typeof m === 'object' && m && 'id' in m ? String((m as Record<string, unknown>).id || '') : '').filter(Boolean)
    patch.push('models=?'); params.push(JSON.stringify(ids))
  }

  if (patch.length) {
    params.push(providerId)
    db.run('UPDATE providers SET ' + patch.join(',') + ", updated_at=datetime('now','localtime') WHERE id=?", params)
    saveDatabase()
  }
}

/** Source `defaultChatEndpoint` → the Grimoire `protocol` column. */
function protocolForDefaultChatEndpoint(endpoint: unknown): string {
  return endpoint === 'openai-response' ? 'responses' : 'chat_completions'
}

/** Reads the first endpoint config's baseUrl out of a source `endpointConfigs` map. */
function readEndpointConfigBaseUrl(endpointConfigs: unknown): string {
  if (!endpointConfigs || typeof endpointConfigs !== 'object') return ''
  const first = Object.values(endpointConfigs as Record<string, unknown>)[0]
  return first && typeof first === 'object' ? readBodyString(first as Record<string, unknown>, 'baseUrl') : ''
}

function createSourceProvider(body: Record<string, unknown>): Record<string, unknown> {
  const db = getDatabase()
  const id = readBodyString(body, 'providerId') || ('pvd_' + crypto.randomUUID().slice(0, 8))
  const existing = db.exec('SELECT id FROM providers WHERE id=?', [id])[0]?.values?.[0]
  if (existing) throw new Error('PROVIDER_EXISTS: Provider 已存在')
  const name = readBodyString(body, 'name') || id
  // The deep-link import creates through this route with `defaultChatEndpoint` and
  // `endpointConfigs`; dropping them would leave the created provider without its host.
  const protocol = protocolForDefaultChatEndpoint(body.defaultChatEndpoint)
  const baseUrl = readEndpointConfigBaseUrl(body.endpointConfigs)
  db.run(
    'INSERT INTO providers (id,name,access_mode,protocol,base_url,api_key,default_model,test_model,context_size,models,config_toml,auth_json) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)',
    [id, name, 'api', protocol, baseUrl, '', '', '', null, '[]', '', '']
  )
  saveDatabase()
  const created = db.exec('SELECT * FROM providers WHERE id=?', [id])[0]?.values?.[0]
  return sourceProviderFromRow(created!)
}

/**
 * Source `McpServer` shape. Grimoire stores http/stdio transport with endpoint/command
 * plus a status/error pair; the source page reads `type`/`baseUrl`/`command`/`args`/`env`
 * plus `isActive` and a tool list, so the projection maps the pairs it can prove and
 * leaves source-only fields (registryUrl, dxt*, installSource, trust) absent.
 *
 * `type` must use the source `McpServerTypeSchema` union (`stdio | sse | streamableHttp |
 * inMemory`) — the source detail form validates against it, so emitting the raw Grimoire
 * `'http'` made the form reject every save. Grimoire's single HTTP transport maps to
 * `streamableHttp`.
 *
 * `disabledTools` is the source denylist while `enabled_tools` is a Grimoire allowlist;
 * the pair inverts exactly (a tool is disabled iff it is absent from the allowlist and
 * the deny list is non-empty). Emitting `undefined` when the allowlist is empty would
 * claim every tool is enabled, which is the opposite of what the registry registers.
 */
/**
 * A Grimoire assistant row as the source `Assistant` shape the import service reads
 * back. Field names follow the source schema (`prompt`, `emoji`, `modelId`, `groupId`),
 * not the Grimoire column names — the caller is a source consumer.
 */
function sourceAssistantFromRecord(record: AiAssistantRecord): Record<string, unknown> {
  return {
    id: record.id,
    name: record.name,
    prompt: record.system_prompt || '',
    description: record.description || '',
    emoji: record.avatar || '',
    // Grimoire stores these as non-null strings with '' meaning "unset"; the source
    // fields are optional, so an empty value is omitted rather than sent as ''.
    modelId: record.model_id || undefined,
    // `groupId` comes from the record's OWN `group_id`, not from `provider_id`.
    //
    // This previously read `groupId: record.provider_id || undefined` — a placeholder written
    // before groups existed, when the two were conflated. Now that `/groups` is real and
    // `cherry_resource_state.group_id` is written, mapping the provider onto the group field
    // would make the rail show an assistant under a group whose id is a provider's, which no
    // group lookup can resolve.
    groupId: record.group_id || undefined,
    settings: record.settings || {},
    createdAt: record.created_at,
    updatedAt: record.updated_at
  }
}

/**
 * A Grimoire topic row as the source `Topic` shape.
 *
 * `orderKey` / `lastActivityAt` / `activeNodeId` are emitted from what Grimoire actually
 * holds. `orderKey` comes from the resource-state projection (the topic's fractional
 * order), and `activeNodeId` is omitted rather than invented: Grimoire has no per-topic
 * message tree, so there is no active node to name — the same gap the matrix records for
 * topic thread parity.
 */
/**
 * The session a topic belongs to, or `null` when the topic does not exist.
 *
 * Grimoire's topic service is keyed by session (`listAiTopics(sessionId)`), and the source's
 * `/topics/:id` routes carry no session, so the row is located by scanning. Cheap at this
 * scale, and it keeps the route shape identical to the source's rather than requiring callers
 * to pass a session id the source never sends.
 */
function existingTopicSessionId(topicId: string): string | null {
  const row = getDatabase().exec('SELECT session_id FROM ai_topics WHERE id=?', [topicId])[0]?.values?.[0]?.[0]
  return row === undefined || row === null ? null : String(row)
}

/**
 * One topic by id, or `null`.
 *
 * The topic service is session-scoped, so a bare id has to be located by scan — the same
 * approach `existingTopicSessionId` uses, and adequate for the row counts involved.
 */
function findTopicById(topicId: string): AiTopicRecord | null {
  const sessionId = existingTopicSessionId(topicId)
  if (!sessionId) return null
  return listAiTopics(sessionId, true).find(topic => topic.id === topicId) || null
}

/**
 * The session a new topic for this assistant should live in.
 *
 * Grimoire topics are session-scoped; the source's are assistant-scoped. The assistant's most
 * recent session is used, and when the assistant has none (or no assistant was named) the most
 * recent session overall is used so a placeholder can still be created rather than failing.
 * Returns `null` only when there is no session at all.
 */
function resolveAssistantSessionId(assistantId: string): string | null {
  const db = getDatabase()
  if (assistantId) {
    const byAssistant = db.exec(
      "SELECT r.entity_id FROM cherry_resource_state r WHERE r.entity_type='session' AND r.owner_id=? ORDER BY r.last_activity_at DESC LIMIT 1",
      [assistantId]
    )[0]?.values?.[0]?.[0]
    if (byAssistant !== undefined && byAssistant !== null) return String(byAssistant)
  }
  const anySession = db.exec(
    "SELECT id FROM ai_sessions ORDER BY updated_at DESC LIMIT 1"
  )[0]?.values?.[0]?.[0]
  return anySession === undefined || anySession === null ? null : String(anySession)
}

function sourceTopicFromRecord(record: AiTopicRecord): Record<string, unknown> {
  const orderRow = getDatabase().exec(
    "SELECT order_key FROM cherry_resource_state WHERE entity_type='topic' AND entity_id=?",
    [record.id]
  )[0]?.values?.[0]
  return {
    id: record.id,
    name: record.title,
    isNameManuallyEdited: false,
    // `assistantId` is the topic's OWNER, which `cherry_resource_state.owner_id` records.
    // This was `undefined` — a placeholder from before topic ownership was tracked — and a
    // consumer that groups topics by assistant got an empty grouping for every row.
    assistantId: record.owner_id || undefined,
    orderKey: orderRow == null ? String(record.created_at) : String(orderRow),
    lastActivityAt: record.updated_at,
    createdAt: record.created_at,
    updatedAt: record.updated_at
  }
}

function sourceMcpServerFromRecord(record: McpServerRecord): Record<string, unknown> {
  const enabledTools = new Set(record.enabled_tools)
  // The allowlist is authoritative in Grimoire: an empty `enabled_tools` means the
  // registry registers NOTHING for this server (see `registerMcpTools`), so the
  // denylist is exactly the tools outside it — including the empty-allowlist case.
  const disabledTools = record.tools.map(tool => tool.name).filter(toolName => !enabledTools.has(toolName))
  return {
    id: record.id,
    name: record.name,
    type: record.transport === 'stdio' ? 'stdio' : 'streamableHttp',
    baseUrl: record.transport === 'http' ? record.endpoint : undefined,
    command: record.transport === 'stdio' ? record.command : undefined,
    args: record.transport === 'stdio' && record.args.length ? record.args : undefined,
    // Secret-bearing maps travel with keys visible and values masked, so the form
    // renders each stored entry without the renderer ever holding the secret.
    env: record.transport === 'stdio' ? maskSecretMap(record.env) : undefined,
    // v24 columns; omitted when empty so the form's default (empty) round-trips.
    description: record.description || undefined,
    headers: record.transport === 'http' ? maskSecretMap(record.headers) : undefined,
    timeout: record.timeout_seconds ?? undefined,
    isActive: record.enabled,
    disabledTools: disabledTools.length ? disabledTools : undefined,
    disabledAutoApproveTools: record.disabled_auto_approve_tools.length ? record.disabled_auto_approve_tools : undefined,
    // v25 columns, each with a live consumer (timeout policy / stdio launch env / list
    // search). `longRunning` is emitted explicitly rather than omitted-when-false: a
    // false value is meaningful here (the switch is off), unlike an empty string.
    longRunning: record.long_running,
    registryUrl: record.registry_url || undefined,
    tags: record.tags.length ? record.tags : undefined,
    sortOrder: 0
  }
}

/**
 * Secret-bearing maps (`env`, `headers`) never travel to the renderer: their VALUES are
 * replaced by the same placeholder the provider routes use, while the KEYS stay visible
 * so the form renders one row per stored entry. A save that echoes the placeholder back
 * restores the stored value instead of persisting the mask (see `restoreMaskedMap`).
 */
function maskSecretMap(values: Record<string, string> | undefined): Record<string, string> | undefined {
  if (!values || !Object.keys(values).length) return undefined
  return Object.fromEntries(Object.keys(values).map(key => [key, MASKED_SECRET_VALUE]))
}

/** Restores stored values wherever the submitted map still carries the placeholder. */
function restoreMaskedMap(
  submitted: Record<string, unknown>,
  stored: Record<string, string> | undefined
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(submitted).map(([key, value]) => {
      const text = String(value)
      return [key, text === MASKED_SECRET_VALUE ? (stored?.[key] ?? '') : text]
    })
  )
}

function listSourceMcpServers(): Record<string, unknown>[] {
  return listMcpServers(true).map(record => sourceMcpServerFromRecord(record))
}

/** Tool payload the source `McpTool`/detail list reads: name + JSON-schema input. */
function sourceMcpTools(serverId: string): Array<Record<string, unknown>> {
  const record = listMcpServers().find(server => server.id === serverId)
  if (!record) return []
  return record.tools.map(tool => ({
    name: tool.name,
    description: tool.description || '',
    inputSchema: tool.inputSchema ?? { type: 'object', properties: {} }
  }))
}

/**
 * Source `UpdateMcpServerDto` fields the Grimoire `mcp_servers` row can store.
 */
const MCP_STORABLE_UPDATE_FIELDS = new Set([
  'name', 'type', 'baseUrl', 'command', 'args', 'env', 'isActive', 'disabledTools', 'sortOrder',
  // Backed by the v24 columns: `description` is a server note, `headers` feeds the HTTP
  // transport, `timeout` bounds each request, `disabledAutoApproveTools` persists the
  // tools tab's per-tool auto-approve suppression.
  'description', 'headers', 'timeout', 'disabledAutoApproveTools',
  // Backed by the v25 columns, each with a live consumer: `longRunning` drives the
  // tool-call timeout policy, `registryUrl` drives the stdio launch env, `tags` feed
  // the MCP list search text.
  'longRunning', 'registryUrl', 'tags'
])

/**
 * Source fields echoed by the full-object save that Grimoire deliberately does not
 * model AND that this form cannot set as user intent (server identity/trust/package
 * metadata). Dropping an echoed value is not a fake write — the UI never offered it.
 */
const MCP_ECHOED_ONLY_FIELDS = new Set([
  'installSource', 'isTrusted', 'trustedAt', 'installedAt', 'searchKey', 'shouldConfig',
  'reference', 'configSample', 'dxtVersion', 'dxtPath', 'provider', 'providerUrl',
  'logoUrl', 'outputSchema'
])

/** A value carrying no user intent — the form's untouched default for every editable field. */
function isDefaultFieldValue(value: unknown): boolean {
  if (value === undefined || value === null || value === '' || value === false || value === 0) return true
  if (Array.isArray(value)) return value.length === 0
  if (typeof value === 'object') return Object.keys(value as Record<string, unknown>).length === 0
  return false
}

/**
 * Applies a source `UpdateMcpServerDto` onto the Grimoire row.
 *
 * The source detail page sends the WHOLE server object (`{...server, ...formFields}`),
 * so each save carries echoed fields plus every editable field at its untouched default.
 * Echoed-only fields are ignored; any remaining unrecognized field carrying a real value
 * is rejected — accepting it would persist nothing while the UI reports success.
 */
function applyMcpServerUpdate(serverId: string, body: Record<string, unknown>): McpServerRecord {
  // Read WITH secrets: the stored env/headers are what a masked-echo save restores.
  const record = listMcpServers(true).find(server => server.id === serverId)
  if (!record) throw new Error('MCP_NOT_FOUND: MCP Server 不存在')

  const unsupported = Object.keys(body).filter(
    key =>
      !MCP_STORABLE_UPDATE_FIELDS.has(key)
      && !MCP_ECHOED_ONLY_FIELDS.has(key)
      && !isDefaultFieldValue(body[key])
  )
  if (unsupported.length) {
    throw new Error('MCP_FIELD_UNSUPPORTED: 下列字段尚无 Grimoire 存储，未保存：' + unsupported.join(', '))
  }

  const next: Partial<McpServerRecord> & { id: string } = { id: serverId }
  const name = readBodyString(body, 'name')
  if (name) next.name = name
  if (typeof body.isActive === 'boolean') next.enabled = body.isActive

  // `type` selects the transport; the form sends `streamableHttp` for HTTP servers.
  const type = readBodyString(body, 'type')
  if (type === 'stdio') next.transport = 'stdio'
  else if (type === 'sse' || type === 'streamableHttp') next.transport = 'http'

  const baseUrl = readBodyString(body, 'baseUrl')
  if (baseUrl) next.endpoint = baseUrl
  const command = readBodyString(body, 'command')
  if (command) next.command = command
  if (Array.isArray(body.args)) next.args = body.args.map(String)
  if (body.env && typeof body.env === 'object') {
    next.env = restoreMaskedMap(body.env as Record<string, unknown>, record.env)
  }
  // Source denylist → Grimoire allowlist. The set is computed against the server's full
  // tool list, matching the projection, so a round-trip is stable.
  if (Array.isArray(body.disabledTools)) {
    const disabled = new Set(body.disabledTools.map(String))
    next.enabled_tools = record.tools.map(tool => tool.name).filter(toolName => !disabled.has(toolName))
  }
  // v24 columns. `description` is a note; `headers`/`timeout` are consumed by the HTTP
  // transport, so a set value changes real request behaviour, not just display.
  if (body.description !== undefined) next.description = readBodyString(body, 'description')
  if (Array.isArray(body.disabledAutoApproveTools)) {
    next.disabled_auto_approve_tools = body.disabledAutoApproveTools.map(String)
  }
  if (body.headers && typeof body.headers === 'object') {
    next.headers = restoreMaskedMap(body.headers as Record<string, unknown>, record.headers)
  }
  if (typeof body.timeout === 'number' && body.timeout > 0) next.timeout_seconds = body.timeout
  else if (body.timeout === null || body.timeout === '') next.timeout_seconds = null
  // v25 columns. `longRunning` switches the tool-call timeout policy to progress-reset
  // with a 10-minute ceiling; `registryUrl` feeds the stdio launch env; `tags` feed the
  // list search text. All three are read by real consumers, not stored for display.
  if (typeof body.longRunning === 'boolean') next.long_running = body.longRunning
  if (body.registryUrl !== undefined) next.registry_url = readBodyString(body, 'registryUrl')
  if (Array.isArray(body.tags)) next.tags = body.tags.map(String).filter(tag => tag.trim().length > 0)
  return saveMcpServer(next)
}

function createSourceMcpServer(body: Record<string, unknown>): Record<string, unknown> {
  const name = readBodyString(body, 'name')
  if (!name) throw new Error('MCP_NAME_REQUIRED: MCP Server 名称不能为空')
  // Source `McpServerType` is `stdio | sse | streamableHttp | inMemory`; the form's
  // `serverType` field is validated against that union, so a create carrying `http`
  // would never come from the mounted UI — the stdio check is the discriminating one.
  const type = readBodyString(body, 'type')
  const transport = type === 'stdio' || readBodyString(body, 'command') ? 'stdio' : 'http'
  const args = Array.isArray(body.args) ? body.args.map(String) : []
  const env = body.env && typeof body.env === 'object'
    ? Object.fromEntries(Object.entries(body.env as Record<string, unknown>).map(([key, value]) => [key, String(value)]))
    : undefined
  const headers = body.headers && typeof body.headers === 'object'
    ? Object.fromEntries(Object.entries(body.headers as Record<string, unknown>).map(([key, value]) => [key, String(value)]))
    : undefined
  const saved = saveMcpServer({
    name,
    transport,
    endpoint: readBodyString(body, 'baseUrl'),
    command: readBodyString(body, 'command'),
    args,
    ...(env ? { env } : {}),
    description: readBodyString(body, 'description'),
    ...(headers ? { headers } : {}),
    ...(typeof body.timeout === 'number' && body.timeout > 0 ? { timeout_seconds: body.timeout } : {}),
    enabled: body.isActive !== false
  })
  return sourceMcpServerFromRecord(saved)
}

function apiEnvelope(id: string, data: unknown, status = 200) {
  return { id, status, data }
}

function apiError(id: string, status: number, code: string, message: string) {
  return { id, status, error: { code, message, status, timestamp: Date.now() } }
}

/**
 * Projects a Grimoire prompt asset onto the source `Prompt` shape
 * (`shared/data/types/prompt.ts`).
 *
 * Three fields have no direct Grimoire column, and each is mapped rather than invented:
 *
 *  - `visibility` — Grimoire has no per-prompt visibility. Every asset is reported
 *    `'global'`, which is the source value meaning "usable everywhere". This is the only
 *    honest answer: Grimoire shares all prompt assets with every session, so calling them
 *    `'restricted'` would hide prompts that are in fact available.
 *  - `orderKey` — no ordering column exists on `prompt_assets`. The source uses it to sort
 *    the list; the adapter instead returns rows already ordered by the service
 *    (`created_at DESC, id ASC`) and synthesises a zero-padded key from each row's position
 *    so the renderer's own sort is stable and matches the returned order. Inventing a
 *    *meaningful* order (by name, by category) would silently reorder the user's list
 *    relative to what Grimoire's own panels show.
 *  - `id` — Grimoire ids are `builtin_<hex>` / `source`-derived, NOT UUIDs, while the source
 *    schema declares `PromptIdSchema = z.uuid()`. The renderer never runtime-validates the
 *    response (`PromptSchemas` is a TypeScript type map, not zod), so a non-UUID id is
 *    accepted — but it is passed through UNCHANGED rather than rewritten into a fake UUID,
 *    because the id is the only handle back to the real asset: a synthesised UUID would
 *    break every mutation and binding round trip while looking correct.
 *
 * `createdAt`/`updatedAt` are passed through as stored. Grimoire writes real ISO strings
 * for imported assets, which satisfies the source's `z.iso.datetime()`.
 */
function sourcePromptFromAsset(asset: PromptAssetItem, orderIndex: number, id: string): Record<string, unknown> {
  return {
    // `id` is passed EXPLICITLY because the two call paths hand this helper different things
    // and both must end up emitting the row's real stored id:
    //   - list: `UNIFIED_QUERY` aliases the column as `'asset:' || id`, so the view prefix is
    //     stripped here;
    //   - create: `createPromptAsset` returns the stored id already.
    // Emitting each verbatim was a real bug, caught by a live round trip rather than by
    // reading: a created prompt stored its id as `asset:<uuid>` (the service bakes the prefix
    // in), the union query then prefixed THAT, and the client saw `asset:asset:<uuid>` —
    // which matched neither the DELETE lookup nor the list. Verified `foundInList: false`
    // before the fix.
    id,
    title: asset.name || id,
    content: asset.prompt || '',
    // The STORED value, not a hardcoded 'global'. Hardcoding it meant a prompt the user
    // restricted was reported as globally visible — the direction that understates exposure.
    visibility: asset.visibility || 'global',
    orderKey: String(orderIndex).padStart(20, '0'),
    createdAt: asset.createdAt,
    updatedAt: asset.createdAt
  }
}

/**
 * The stored id behind a `UNIFIED_QUERY` asset alias (`'asset:' || id`).
 *
 * UNCAPPED: the union prepends the prefix unconditionally, so for the user-created rows whose
 * stored id already begins with `asset:` the view id is `asset:asset:…`. Stripping exactly one
 * occurrence recovers the stored id in both cases; stripping to the first non-prefixed form
 * (what an earlier version did) destroyed the real storable id for those rows.
 */
function assetIdFromUnionAlias(viewId: string): string {
  return viewId.startsWith('asset:') ? viewId.slice('asset:'.length) : viewId
}

/**
 * Resolves a client-supplied prompt id to a stored `prompt_assets.id`.
 *
 * Two id spaces reach this route and both must work:
 *   - the LIST id, which is the union alias — for imported/built-in rows that is
 *     `asset:<storedId>` and for user-created rows (whose stored id already carries the
 *     prefix) it is `asset:asset:<storedId>`;
 *   - the CREATE id, which `createPromptAsset` returns as the stored id itself.
 * Tried in order: as given, then with one `asset:` stripped, then with two. A direct
 * `WHERE id IN (…)` lookup would have to guess, and guessing wrong returned 404 for a row
 * that plainly exists.
 */
function resolveAssetRowId(candidate: string): string | null {
  const db = getDatabase()
  for (const form of assetIdCandidates(candidate)) {
    const hit = db.exec('SELECT id FROM prompt_assets WHERE id = ?', [form])[0]?.values?.[0]
    if (hit) return String(hit[0])
  }
  return null
}

/** Pure: the stored-id forms a client id might denote, most-likely first. */
export function assetIdCandidates(candidate: string): string[] {
  const forms = [candidate]
  if (candidate.startsWith('asset:')) forms.push(candidate.slice('asset:'.length))
  if (candidate.startsWith('asset:asset:')) forms.push(candidate.slice('asset:asset:'.length))
  return forms
}

// Checked source adapter: schemas/agents.ts is not root-main importable (source-only
// aliases and dependency closure). Do not project the service record with a spread:
// runtime and arbitrary persisted configuration metadata are main-process internals.
const sourceAgentFields = ['name', 'description', 'instructions', 'model', 'planModel', 'smallModel', 'mcps', 'knowledgeBaseIds', 'disabledTools', 'configuration'] as const
const sourceAgentConfigurationFields = ['avatar', 'slash_commands', 'permission_mode', 'reasoning_effort', 'service_tier', 'bootstrap_completed', 'scheduler_enabled', 'scheduler_type', 'scheduler_cron', 'scheduler_interval', 'scheduler_one_time_delay', 'scheduler_last_run', 'heartbeat_enabled', 'heartbeat_interval', 'language']

function sourceAgentFromBlueprint(agent: AgentBlueprint): Record<string, unknown> {
  if (agent.type === null || !['claude-code', 'pi', 'dsh'].includes(agent.type)) {
    throw new Error('AGENT_SOURCE_TYPE_UNREPRESENTABLE: This blueprint has no source AgentType representation')
  }
  const result: Record<string, unknown> = {
    id: agent.id, type: agent.type, name: agent.name, model: agent.model,
    orderKey: agent.orderKey, createdAt: agent.createdAt, updatedAt: agent.updatedAt,
    // Grimoire's provider catalog persists bare model IDs, not human-readable metadata.
    // A provider::model handle (or its suffix) is not a known model name.
    modelName: null
  }
  for (const field of sourceAgentFields) {
    if (field === 'configuration') {
      const configuration: Record<string, unknown> = {}
      for (const [key, value] of Object.entries(agent.configuration ?? {})) {
        if (!sourceAgentConfigurationFields.includes(key)) continue
        // Old/imported blobs can contain wrong-typed known keys; don't launder an
        // arbitrary nested object (or its secrets) as a source scalar/array.
        try { Object.assign(configuration, blueprintValidation.configuration({ [key]: value })) } catch {}
      }
      result.configuration = configuration
    } else if (agent[field] !== undefined) result[field] = agent[field]
  }
  if (agent.deletedAt !== undefined) result.deletedAt = agent.deletedAt
  return result
}

function sourceAgentQuery(requestParams: unknown, search: URLSearchParams): ListAgentBlueprints {
  const query = { ...blueprintValidation.object(requestParams ?? {}, 'list query') }
  for (const key of new Set(search.keys())) {
    if (Object.hasOwn(query, key)) continue
    const values = search.getAll(key)
    if (key === 'ids') query[key] = values
    else {
      if (values.length !== 1) throw new Error('AGENT_BLUEPRINT_INVALID_QUERY: duplicate query key')
      const value = values[0]
      // Only URL query scalars are coerced; typed IPC params must satisfy the source
      // strict schema (no Number(true), truthy strings or empty-string defaults).
      query[key] = (key === 'page' || key === 'limit') && /^\d+$/.test(value) ? Number(value)
        : key === 'inTrash' && (value === 'true' || value === 'false') ? value === 'true' : value
    }
  }
  return query as ListAgentBlueprints // service validates the source strict keys/limits/search/ids
}

function sourceAgentPatch(value: unknown): UpdateAgentBlueprint {
  const body = blueprintValidation.object(value, 'patch')
  const patch: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(body)) {
    if (key === 'skillUpdates') {
      if (!Array.isArray(value)) throw new Error('AGENT_BLUEPRINT_INVALID: skillUpdates must be an array')
      if (value.length) throw new Error('AGENT_SOURCE_FIELD_UNSUPPORTED: skillUpdates')
      continue // source defines [] as a no-op
    }
    if (!(sourceAgentFields as readonly string[]).includes(key)) throw new Error('AGENT_SOURCE_FIELD_UNSUPPORTED: ' + key)
    if (value === undefined) continue
    if (key === 'name') blueprintValidation.string(value, key, true)
    if (key === 'description' || key === 'instructions') blueprintValidation.string(value, key)
    if (['model', 'planModel', 'smallModel'].includes(key)) blueprintValidation.model(value, true)
    if (['mcps', 'knowledgeBaseIds', 'disabledTools'].includes(key)) {
      patch[key] = blueprintValidation.strings(value, key, key === 'knowledgeBaseIds')
    } else if (key === 'configuration') {
      const configuration = blueprintValidation.object(value, key)
      for (const field of Object.keys(configuration)) {
        if (!sourceAgentConfigurationFields.includes(field)) throw new Error('AGENT_SOURCE_FIELD_UNSUPPORTED: configuration.' + field)
      }
      patch[key] = blueprintValidation.configuration(configuration)
    } else patch[key] = value
  }
  return patch as UpdateAgentBlueprint
}

function agentPatchChanges(agent: AgentBlueprint, patch: UpdateAgentBlueprint): boolean {
  return Object.entries(patch).some(([key, value]) => {
    if (key === 'configuration') {
      return Object.entries(value as Record<string, unknown>).some(([field, item]) =>
        item === undefined ? Object.hasOwn(agent.configuration ?? {}, field)
          : JSON.stringify(agent.configuration?.[field]) !== JSON.stringify(item))
    }
    // Absent optional model tiers and null both mean no override.
    const previous = agent[key as keyof AgentBlueprint]
    if ((key === 'planModel' || key === 'smallModel') && value === null && previous === undefined) return false
    return JSON.stringify(previous) !== JSON.stringify(value)
  })
}

function createSourceAgent(value: unknown): AgentBlueprint {
  const body = blueprintValidation.object(value, 'create command')
  for (const key of Object.keys(body)) {
    if (![...sourceAgentFields, 'type', 'skillIds'].includes(key)) throw new Error('AGENT_SOURCE_FIELD_UNSUPPORTED: ' + key)
  }
  blueprintValidation.enumValue(body.type, ['claude-code', 'pi', 'dsh'], 'type')
  blueprintValidation.string(body.name, 'name', true)
  blueprintValidation.model(body.model)
  // Create uses AgentBase, not UpdateAgent: nullable tier overrides are PATCH-only.
  for (const key of ['planModel', 'smallModel']) if (body[key] !== undefined) blueprintValidation.model(body[key])
  if (body.skillIds !== undefined) {
    const ids = blueprintValidation.strings(body.skillIds, 'skillIds', true)
    if (ids.length) throw new Error('AGENT_SOURCE_FIELD_UNSUPPORTED: skillIds')
  }
  const { type, skillIds: _skillIds, ...fields } = body
  const parsed = sourceAgentPatch(fields)
  if (type !== 'pi' || !hasAgentRuntime('pi')) {
    throw new Error('AGENT_SOURCE_RUNTIME_UNAVAILABLE: Requested source AgentType has no supported registered runtime')
  }
  // Storage-only slice: explicit pi -> pi mapping. Do not infer Codex/OpenCode,
  // instantiate a runtime, create a workspace or provision source heartbeat/tools.
  return createAgentBlueprint({ ...parsed, type: 'pi', runtime: 'pi', name: body.name, model: body.model as NonNullable<AgentBlueprint['model']>,
    planModel: body.planModel as AgentBlueprint['planModel'], smallModel: body.smallModel as AgentBlueprint['smallModel'] })
}

function notifyAgentPatch(id: string, created = false): void {
  const effects = created ? [{ endpoint: '/agents', kind: 'membership', entityIds: [id] }] : [
    { endpoint: '/agents', kind: 'projection', entityIds: [id] },
    { endpoint: '/agents/:agentId', routeParams: { agentId: id }, entityIds: [id] }
  ]
  // The write has committed. A destroyed window must never turn it into a failure.
  for (const window of BrowserWindow.getAllWindows()) {
    try { if (!window.isDestroyed()) window.webContents.send('data-api:data-changed', effects) } catch {}
  }
}

function sourceRegisteredModels(providerFilter?: string): Record<string, unknown>[] {
  // Authoritative registration only: no key/auth/runtime config selected or exposed.
  const rows = getDatabase().exec('SELECT id,name,models FROM providers' + (providerFilter !== undefined ? ' WHERE id=?' : ''), providerFilter !== undefined ? [providerFilter] : [])[0]?.values ?? []
  const models: Record<string, unknown>[] = []
  for (const row of rows) {
    let ids: unknown
    try { ids = JSON.parse(String(row[2] || '[]')) } catch { continue }
    if (!Array.isArray(ids)) continue
    for (const modelId of new Set(ids.filter((value): value is string => typeof value === 'string' && value.length > 0 && !/[?#]/.test(value)))) {
      models.push({ id: String(row[0]) + '::' + modelId, providerId: String(row[0]), apiModelId: modelId,
        // Source custom-model display fallback is dto.modelId. This is a label,
        // NOT human-readable metadata for the Agent modelName resolver.
        name: modelId, group: String(row[1] || ''), capabilities: [],
        // Required source boolean, fail-closed: unknown streaming support is not
        // an affirmative capability. Optional registry metadata stays absent.
        supportsStreaming: false,
        // Registered models have no per-model disable/hide state in this store.
        // These are source custom-registration defaults, not connectivity claims.
        isEnabled: true, isHidden: false })
    }
  }
  return models
}

function sourceWorkspaceDto(workspace: AgentWorkspace): Record<string, unknown> {
  return { id: workspace.id, name: workspace.name, path: workspace.path, type: workspace.type,
    orderKey: workspace.orderKey, createdAt: workspace.createdAt, updatedAt: workspace.updatedAt }
}
function notifyWorkspaceChange(id: string, kind: 'membership' | 'projection' | 'order'): void {
  const effects = kind === 'order'
    ? [{ endpoint: '/agent-workspaces', kind, dimension: 'orderKey', entityIds: [id] }, { endpoint: '/agent-workspaces/:workspaceId', entityIds: [id] }]
    : [{ endpoint: '/agent-workspaces', kind, entityIds: [id] }, { endpoint: '/agent-workspaces/:workspaceId', entityIds: [id] }]
  for (const window of BrowserWindow.getAllWindows()) {
    try { if (!window.isDestroyed()) window.webContents.send('data-api:data-changed', effects) } catch {}
  }
}
function workspaceOrder(value: unknown): AgentWorkspaceOrder {
  const body = blueprintValidation.object(value, 'workspace order')
  if (Object.keys(body).length !== 1) throw new Error('AGENT_WORKSPACE_INVALID_ORDER')
  if (body.position === 'first' || body.position === 'last') return { position: body.position }
  for (const key of ['before', 'after'] as const) {
    if (typeof body[key] === 'string' && body[key].trim()) return { [key]: body[key] } as AgentWorkspaceOrder
  }
  throw new Error('AGENT_WORKSPACE_INVALID_ORDER')
}

type SourceSessionReadQuery = { agentId?: string; ids?: string[]; workspaceId?: string; cursor?: string; limit?: number; inTrash?: boolean }
function sourceSessionReadQuery(params: unknown, search: URLSearchParams, latest: boolean): SourceSessionReadQuery {
  const raw = { ...blueprintValidation.object(params ?? {}, 'session query') }
  for (const key of new Set(search.keys())) {
    if (Object.hasOwn(raw, key)) continue
    const values = search.getAll(key)
    if (key === 'ids') raw[key] = values
    else {
      if (values.length !== 1) throw new Error('AGENT_SESSION_SOURCE_INVALID_QUERY: duplicate query key')
      raw[key] = key === 'inTrash' && ['true', 'false'].includes(values[0]) ? values[0] === 'true' : values[0]
    }
  }
  const allowed = latest ? ['agentId'] : ['agentId', 'ids', 'workspaceId', 'cursor', 'limit', 'inTrash']
  for (const key of Object.keys(raw)) if (!allowed.includes(key)) throw new Error('AGENT_SESSION_SOURCE_INVALID_QUERY: unsupported query key')
  if (raw.agentId !== undefined) blueprintValidation.string(raw.agentId, 'agentId', latest)
  if (raw.workspaceId !== undefined) blueprintValidation.string(raw.workspaceId, 'workspaceId', true)
  if (raw.cursor !== undefined) blueprintValidation.string(raw.cursor, 'cursor')
  if (raw.ids !== undefined) {
    blueprintValidation.strings(raw.ids, 'ids', true)
    if (!(raw.ids as unknown[]).length || (raw.ids as unknown[]).length > 200) throw new Error('AGENT_SESSION_SOURCE_INVALID_QUERY: ids')
  }
  if (raw.inTrash !== undefined && typeof raw.inTrash !== 'boolean') throw new Error('AGENT_SESSION_SOURCE_INVALID_QUERY: inTrash')
  // Exact source z.coerce.number(), not the non-coercing blueprint list schema.
  if (raw.limit !== undefined) {
    let limit: number
    try { limit = Number(raw.limit) } catch { throw new Error('AGENT_SESSION_SOURCE_INVALID_QUERY: limit') }
    if (!Number.isInteger(limit) || limit <= 0 || limit > 200) throw new Error('AGENT_SESSION_SOURCE_INVALID_QUERY: limit')
    raw.limit = limit
  }
  return raw as SourceSessionReadQuery
}

function sourceSessionScopeIsEmpty(query: SourceSessionReadQuery, latest: boolean): boolean {
  // agent_sessions is the runtime store; ai_sessions are unrelated Cherry-compatible
  // chats. Never use those chats to fill an Agent session rail or latest selection.
  const mappedIds = new Set((getDatabase().exec('SELECT id FROM agent_session_read_model')[0]?.values ?? []).map(row => String(row[0])))
  for (const session of listAgentSessions()) {
    if (mappedIds.has(session.id)) continue // sidecar owns classification, trash, scope and activity
    if (query.ids && !query.ids.includes(session.id)) continue
    const namespace = normalizeAgentSessionData(session.data.agentSession)
    if (query.agentId) {
      // No namespace/owner means UNKNOWN, not a proven null/orphan owner. It cannot
      // be silently filtered out even for a newly created agent's requested scope.
      if (namespace?.agentId === undefined) throw new Error('AGENT_SESSION_SOURCE_UNREPRESENTABLE')
      const owner = namespace.agentId
      const activeOwner = owner === null ? null : getAgentBlueprint(owner)
      if (latest && query.agentId === 'unlinked') {
        if (activeOwner) continue
      } else {
        if (owner !== query.agentId) continue
        // Source active-owner filter; trashed-list reads do not apply this filter.
        if ((latest || !query.inTrash) && !activeOwner) continue
      }
    }
    if (query.workspaceId) {
      if (namespace?.workspace?.type === 'user' && namespace.workspace.workspaceId !== query.workspaceId) continue
      // A system workspace has no source workspace row/id to compare.
    }
    // The namespace only stores a workspace reference, not AgentWorkspaceEntity.
    // There is also no conversation/background discriminator, source order/pins,
    // trash state or lastActivityAt. Do not infer them from runtime status/title/
    // updated_at, fabricate a workspace, remap IDs or claim a row is background.
    // This capability fence precedes cursor pagination so an unresolved row cannot
    // disappear merely because an opaque cursor was supplied. Malformed source
    // cursors fall back to page one; an empty store truthfully has no nextCursor.
    throw new Error('AGENT_SESSION_SOURCE_UNREPRESENTABLE')
  }
  return true
}

// Source messages.ts strict branch query; IDs are validated by the v33 service.
function sourceTopicBranchQuery(params: unknown, search: URLSearchParams): TopicBranchQuery {
  const raw = { ...topicRequestObject(params ?? {}) }
  for (const key of new Set(search.keys())) {
    if (search.getAll(key).length !== 1 || Object.hasOwn(raw, key)) {
      throw new TopicTreeError('VALIDATION', 'Duplicate branch query key: ' + key)
    }
    const value = search.get(key)!
    raw[key] = key === 'limit' && /^\d+$/.test(value) ? Number(value)
      : key === 'includeSiblings' && (value === 'true' || value === 'false') ? value === 'true' : value
  }
  for (const key of Object.keys(raw)) {
    if (!['nodeId', 'cursor', 'limit', 'includeSiblings'].includes(key)) throw new TopicTreeError('VALIDATION', 'Unknown branch query key: ' + key)
  }
  if (raw.includeSiblings !== undefined && typeof raw.includeSiblings !== 'boolean') throw new TopicTreeError('VALIDATION', 'includeSiblings must be boolean')
  // Source defaults includeSiblings=true, but queries only NONZERO cohorts. v33
  // stores no cohorts (every node is group 0), so both booleans legitimately emit
  // no siblingsGroup. Never infer a cohort from a shared parent or session.
  const { includeSiblings: _includeSiblings, ...query } = raw
  return query as TopicBranchQuery
}

function topicRequestObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) {
    throw new TopicTreeError('VALIDATION', 'Plain request object required')
  }
  return value as Record<string, unknown>
}

/** Source MessageSchema requires searchableText; v33 stores only data. Adapt the
 * source message.ts searchableTextExpression as a read-only JSON projection, not
 * an invented empty field or a second search index. Reasoning/tool payloads are
 * intentionally excluded; UNION order is source order, not original part order.
 * Source-only nullable facts have no records here and remain null.
 */
function sourceTopicMessage(message: TopicTreeMessage): Record<string, unknown> {
  const searchableText = getDatabase().exec(`SELECT COALESCE(group_concat(text, ' '), '') FROM (
    SELECT json_extract(value, '$.text') AS text FROM json_each(json_extract(?, '$.parts'))
      WHERE json_extract(value, '$.type')='text' AND json_extract(value, '$.text') IS NOT NULL AND trim(json_extract(value, '$.text'))!=''
    UNION ALL
    SELECT json_extract(value, '$.data.content') FROM json_each(json_extract(?, '$.parts'))
      WHERE json_extract(value, '$.type') IN ('data-code','data-translation','data-compact') AND json_extract(value, '$.data.content') IS NOT NULL AND trim(json_extract(value, '$.data.content'))!=''
    UNION ALL
    SELECT json_extract(value, '$.data.compactedContent') FROM json_each(json_extract(?, '$.parts'))
      WHERE json_extract(value, '$.type')='data-compact' AND json_extract(value, '$.data.compactedContent') IS NOT NULL AND trim(json_extract(value, '$.data.compactedContent'))!=''
    UNION ALL
    SELECT json_extract(value, '$.data.message') FROM json_each(json_extract(?, '$.parts'))
      WHERE json_extract(value, '$.type')='data-error' AND json_extract(value, '$.data.message') IS NOT NULL AND trim(json_extract(value, '$.data.message'))!=''
  )`, Array(4).fill(JSON.stringify(message.data)))[0].values[0][0]
  return {
    id: message.id, topicId: message.topicId, parentId: message.parentId, role: message.role,
    data: message.data, searchableText: String(searchableText), status: message.status,
    siblingsGroupId: message.siblingsGroupId, modelId: null, messageSnapshot: null,
    stats: null, compactionSummary: null, createdAt: message.createdAt, updatedAt: message.updatedAt
  }
}

function notifyTopicTreeWrite(topicId: string, nodeId: string): void {
  const effects = [
    { endpoint: '/topics/:topicId/messages', kind: 'membership', routeParams: { topicId }, entityIds: [nodeId] },
    { endpoint: '/topics/:topicId/tree', routeParams: { topicId }, entityIds: [nodeId] },
    { endpoint: '/topics', kind: 'projection', entityIds: [topicId] },
    { endpoint: '/topics/:id', routeParams: { id: topicId }, entityIds: [topicId] }
  ]
  for (const window of BrowserWindow.getAllWindows()) {
    try { if (!window.isDestroyed()) window.webContents.send('data-api:data-changed', effects) } catch {}
  }
}

function sourceMessageQuery(params: unknown, search: URLSearchParams): CherryAgentMessageQuery {
  const raw = { ...blueprintValidation.object(params ?? {}, 'message query') }
  for (const key of new Set(search.keys())) {
    if (Object.hasOwn(raw, key)) continue
    const values = search.getAll(key)
    if (values.length !== 1) throw new CherryAgentMessageError(400, 'INVALID_QUERY')
    raw[key] = key === 'deferToolOutputs' && ['true', 'false'].includes(values[0]) ? values[0] === 'true' : values[0]
  }
  for (const key of Object.keys(raw)) if (!['cursor', 'messageId', 'limit', 'deferToolOutputs'].includes(key)) throw new CherryAgentMessageError(400, 'INVALID_QUERY')
  if (raw.limit !== undefined) {
    try { raw.limit = Number(raw.limit) } catch { throw new CherryAgentMessageError(400, 'INVALID_QUERY') }
  }
  // Remaining strict source scalar/limit checks are owned by the real facade.
  return raw as CherryAgentMessageQuery
}

function sourceSessionDto(session: AgentSessionReadModel): Record<string, unknown> {
  return { id: session.id, agentId: session.agentId, name: session.name, isNameManuallyEdited: session.isNameManuallyEdited,
    ...(session.description === undefined ? {} : { description: session.description }), workspaceId: session.workspaceId,
    workspace: sourceWorkspaceDto(session.workspace), orderKey: session.orderKey, lastActivityAt: session.lastActivityAt,
    createdAt: session.createdAt, updatedAt: session.updatedAt,
    ...(session.traceId === undefined ? {} : { traceId: session.traceId }),
    ...(session.deletedAt === undefined ? {} : { deletedAt: session.deletedAt }) }
}
function sourceConversation(id: string): AgentSessionReadModel {
  const classification = getDatabase().exec('SELECT type,deleted_at FROM agent_session_read_model WHERE id=?', [id])[0]?.values[0]
  if (!classification) {
    if (getAgentSession(id)) throw new Error('AGENT_SESSION_SOURCE_UNREPRESENTABLE')
    throw new Error('AGENT_SESSION_READ_MODEL_NOT_FOUND')
  }
  if (classification[0] !== 'conversation' || classification[1] != null) throw new Error('AGENT_SESSION_READ_MODEL_NOT_FOUND')
  return getAgentSessionReadModel(id) ?? (() => { throw new Error('AGENT_SESSION_SOURCE_UNREPRESENTABLE') })()
}
function notifySessionChange(id: string, kind: 'membership' | 'projection', deletedIds: string[] = []): void {
  const entityIds = [id, ...deletedIds]
  const effects = [
    { endpoint: '/agent-sessions', kind, entityIds },
    { endpoint: '/agent-sessions', kind: 'order', dimension: 'lastActivityAt', entityIds },
    { endpoint: '/agent-sessions/:sessionId', entityIds }, { endpoint: '/agent-sessions/latest' }
  ]
  for (const window of BrowserWindow.getAllWindows()) {
    try { if (!window.isDestroyed()) window.webContents.send('data-api:data-changed', effects) } catch {}
  }
}

function handleRequest(request: DataApiRequest): unknown {
  const id = String(request.id || '')
  const method = String(request.method || 'GET').toUpperCase()
  const rawPath = String(request.path || '')
  // Split the query off the path and expose it as `query`, the way the source's DataApi
  // client sends it (`GET /pins?entityType=session`).
  //
  // Without this EVERY route carrying a query string 404'd: the matchers compare against
  // `path` exactly, so `/pins?entityType=session` never equalled `/pins`. Verified live — the
  // pins POST succeeded while its GET answered `DataApi 路由未桥接`. Routes that ignore the
  // query were unaffected, which is why it went unnoticed until a query-taking route landed.
  const queryIndex = rawPath.indexOf('?')
  const path = queryIndex === -1 ? rawPath : rawPath.slice(0, queryIndex)
  const search = new URLSearchParams(queryIndex === -1 ? '' : rawPath.slice(queryIndex + 1))
  const params = request.params && typeof request.params === 'object' ? request.params : {}
  const body = request.body && typeof request.body === 'object' ? request.body as Record<string, unknown> : {}

  try {
    if (path === '/agent-workspaces' && method === 'GET') return apiEnvelope(id, listAgentWorkspaces().map(sourceWorkspaceDto))
    if (path === '/agent-workspaces' && method === 'POST') {
      const input = blueprintValidation.object(request.body, 'workspace create')
      const result = findOrCreateAgentWorkspace(input as unknown as { path: string; name?: string })
      if (result.created) notifyWorkspaceChange(result.workspace.id, 'membership')
      return apiEnvelope(id, sourceWorkspaceDto(result.workspace), result.created ? 201 : 200)
    }
    if (path === '/agent-workspaces/order:batch' && method === 'PATCH') return apiError(id, 501, 'NOT_IMPLEMENTED', 'Atomic workspace batch ordering is not supported by the repository')
    const workspaceReferences = path.match(/^\/agent-workspaces\/([^/]+)\/references$/)
    if (workspaceReferences && method === 'GET') {
      getAgentWorkspace(decodeURIComponent(workspaceReferences[1]))
      return apiError(id, 501, 'NOT_IMPLEMENTED', 'Workspace session/channel/task reference projection is not implemented')
    }
    const workspaceOrderMatch = path.match(/^\/agent-workspaces\/([^/]+)\/order$/)
    if (workspaceOrderMatch && method === 'PATCH') {
      const workspaceId = decodeURIComponent(workspaceOrderMatch[1]), order = workspaceOrder(request.body)
      const before = listAgentWorkspaces(), current = getAgentWorkspace(workspaceId)
      const ids = before.map(row => row.id), index = ids.indexOf(workspaceId)
      const anchor = 'before' in order ? order.before : 'after' in order ? order.after : undefined
      if (anchor) getAgentWorkspace(anchor)
      const noChange = anchor === workspaceId || ('position' in order && (order.position === 'first' ? index === 0 : index === ids.length - 1))
        || ('before' in order && ids[index + 1] === order.before) || ('after' in order && ids[index - 1] === order.after)
      if (!noChange) {
        reorderAgentWorkspace(current.id, order)
        notifyWorkspaceChange(workspaceId, 'order')
      }
      return apiEnvelope(id, null) // source order endpoint returns void
    }
    const workspaceMatch = path.match(/^\/agent-workspaces\/([^/]+)$/)
    if (workspaceMatch && (method === 'GET' || method === 'PATCH')) {
      const workspaceId = decodeURIComponent(workspaceMatch[1]), workspace = getAgentWorkspace(workspaceId)
      if (method === 'GET') return apiEnvelope(id, sourceWorkspaceDto(workspace))
      const input = blueprintValidation.object(request.body, 'workspace patch')
      if (Object.keys(input).length !== 1 || !Object.hasOwn(input, 'name')) throw new Error('AGENT_WORKSPACE_UNSUPPORTED_FIELD')
      if (typeof input.name !== 'string' || !input.name.trim() || /[\x00-\x1f]/.test(input.name)) throw new Error('AGENT_WORKSPACE_INVALID_NAME')
      if (workspace.name === input.name.trim()) return apiEnvelope(id, sourceWorkspaceDto(workspace))
      const updated = updateAgentWorkspace(workspaceId, { name: input.name })
      notifyWorkspaceChange(workspaceId, 'projection')
      return apiEnvelope(id, sourceWorkspaceDto(updated))
    }
    if (method === 'GET' && (path === '/agent-sessions/latest' || path === '/agent-sessions')) {
      const latest = path === '/agent-sessions/latest'
      const query = sourceSessionReadQuery(request.params, search, latest)
      sourceSessionScopeIsEmpty(query, latest) // fence unmapped legacy rows before paging
      if (latest) {
        const session = getLatestAgentSessionReadModel(query.agentId)
        return apiEnvelope(id, { session: session ? sourceSessionDto(session) : null })
      }
      const page = listAgentSessionReadModels(query)
      return apiEnvelope(id, { items: page.items.map(sourceSessionDto), ...(page.nextCursor === undefined ? {} : { nextCursor: page.nextCursor }) })
    }
    if (path === '/agent-sessions' && method === 'POST') {
      const input = blueprintValidation.object(request.body, 'session create')
      // Service validates the exact source create DTO; no caller runtime/model/snapshot.
      const session = createAgentSessionReadModel(input as unknown as CreateAgentSessionReadModel)
      notifySessionChange(session.id, 'membership')
      return apiEnvelope(id, sourceSessionDto(session), 201)
    }
    const sessionMessagesMatch = path.match(/^\/agent-sessions\/([^/]+)\/messages(?:\/([^/]+))?$/)
    if (method === 'GET' && sessionMessagesMatch) {
      const sessionId = decodeURIComponent(sessionMessagesMatch[1])
      sourceConversation(sessionId) // exact source conversation/background admission
      if (sessionMessagesMatch[2]) return apiEnvelope(id, getCherryAgentMessage(sessionId, decodeURIComponent(sessionMessagesMatch[2])))
      return apiEnvelope(id, listCherryAgentMessages(sessionId, sourceMessageQuery(request.params, search)))
    }
    const sessionWorkspaceMatch = path.match(/^\/agent-sessions\/([^/]+)\/workspace$/)
    if (method === 'PUT' && sessionWorkspaceMatch) {
      const sessionId = decodeURIComponent(sessionWorkspaceMatch[1]), current = sourceConversation(sessionId)
      const source = blueprintValidation.object(request.body, 'session workspace')
      const updated = setAgentSessionReadModelWorkspace(sessionId, source as AgentSessionWorkspaceSource)
      if (updated.workspaceId !== current.workspaceId) notifySessionChange(sessionId, 'projection')
      return apiEnvelope(id, sourceSessionDto(updated))
    }
    const sourceSessionMatch = path.match(/^\/agent-sessions\/([^/]+)$/)
    if (sourceSessionMatch && (method === 'GET' || method === 'PATCH')) {
      const sessionId = decodeURIComponent(sourceSessionMatch[1]), current = sourceConversation(sessionId)
      if (method === 'GET') return apiEnvelope(id, sourceSessionDto(current))
      const input = blueprintValidation.object(request.body, 'session patch')
      for (const [key, value] of Object.entries(input)) {
        if (!['name', 'isNameManuallyEdited', 'description', 'agentId'].includes(key)) throw new Error('AGENT_SESSION_READ_MODEL_UNSUPPORTED_FIELD')
        if (value === undefined) continue
        if (key === 'isNameManuallyEdited') {
          if (typeof value !== 'boolean') throw new Error('AGENT_SESSION_READ_MODEL_INVALID_MANUAL_FLAG')
        } else {
          blueprintValidation.string(value, key, key === 'agentId')
          if (key === 'name' && (value as string).length > 255) throw new Error('AGENT_SESSION_READ_MODEL_INVALID_NAME')
        }
      }
      const changed = Object.entries(input).some(([key, value]) => value !== undefined && value !== current[key as keyof AgentSessionReadModel])
        || (input.name !== undefined && input.isNameManuallyEdited === undefined && !current.isNameManuallyEdited)
      if (!changed) return apiEnvelope(id, sourceSessionDto(current))
      const updated = updateAgentSessionReadModel(sessionId, input as UpdateAgentSessionReadModel)
      notifySessionChange(sessionId, 'projection')
      return apiEnvelope(id, sourceSessionDto(updated))
    }
    // Source Agent blueprints, never runtime sessions. No DataApi POST/clone/lifecycle/
    // order commands; storage-only pi creation is on the separate ai.agent.create IPC.
    if (path === '/agents' && method === 'GET') {
      const page = listAgentBlueprints(sourceAgentQuery(request.params, search))
      return apiEnvelope(id, { items: page.agents.map(sourceAgentFromBlueprint), total: page.total, page: page.page })
    }
    const agentMatch = path.match(/^\/agents\/([^/]+)$/)
    if (agentMatch && (method === 'GET' || method === 'PATCH')) {
      let agentId: string
      try { agentId = decodeURIComponent(agentMatch[1]) } catch { return apiError(id, 400, 'VALIDATION_ERROR', 'Invalid agent id encoding') }
      if (!agentId.length) return apiError(id, 400, 'VALIDATION_ERROR', 'Agent id must be nonempty')
      const agent = getAgentBlueprint(agentId)
      if (!agent) return apiError(id, 404, 'NOT_FOUND', 'Agent 不存在')
      const projected = sourceAgentFromBlueprint(agent) // capability check BEFORE writes
      if (method === 'GET') return apiEnvelope(id, projected)
      const patch = sourceAgentPatch(request.body)
      if (!agentPatchChanges(agent, patch)) return apiEnvelope(id, projected)
      // Service owns the authoritative configuration shallow merge in its transaction.
      const updated = updateAgentBlueprint(agentId, patch)
      if (!updated) return apiError(id, 404, 'NOT_FOUND', 'Agent 不存在')
      const result = sourceAgentFromBlueprint(updated)
      notifyAgentPatch(agentId)
      return apiEnvelope(id, result)
    }
    // ── Prompt catalog (Settings → 提示词) ─────────────────────────────────────
    // The source `/prompts` GET reads a `PromptService` store Grimoire does not have; the
    // real Grimoire prompt library is `prompt_assets` (1,742 rows on this machine, read
    // through the same service its own panels use). Serving them here is what makes the
    // page's list real instead of empty — and the projection above records what the source
    // schema demands that Grimoire has no column for.
    if (path === '/prompts' && method === 'GET') {
      // The service bounds ONE page to 100 rows (`validatePromptAssetQuery`), and that bound
      // is respected rather than bypassed: the source route is unpaginated and the page
      // renders the whole list, so the adapter walks pages until the library is exhausted.
      // Raising the service's limit instead would change a contract Grimoire's own panels
      // depend on. The walk is capped so a pathological library cannot spin here.
      const PAGE = 100
      const MAX_ROWS = 10000
      const items: Record<string, unknown>[] = []
      for (let offset = 0; offset < MAX_ROWS; offset += PAGE) {
        const page = queryPromptAssets(getDatabase(), { source: 'all', query: '', limit: PAGE, offset })
        for (const asset of page.items) items.push(sourcePromptFromAsset(asset, items.length, assetIdFromUnionAlias(asset.id)))
        if (page.items.length < PAGE) break
      }
      // Apply the user's ordering HERE rather than in `queryPromptAssets`.
      //
      // The source `/prompts` is ordered by `orderKey`, so a reorder must be visible in the
      // list — without this, `PATCH /prompts/:id/order` returned 200 and the order visibly
      // never changed (verified: `orderChanged: false`). The sort cannot live in the shared
      // service: `queryPromptAssets` also backs Grimoire's own prompt panel, whose order is
      // existing user-visible behaviour, and it pages in SQL — sorting after a LIMIT would
      // scramble pages rather than order the collection.
      //
      // Rows without a key keep their relative position at the end, so a library nobody has
      // reordered reads exactly as before.
      // Both sides are keyed by the STORED id, so an unconditional prefix or strip would be
      // wrong here. `orderedPromptAssetIds` selects `prompt_assets.id` directly, and the list
      // above emits `assetIdFromUnionAlias(alias)` — which is that same stored id, because the
      // alias is `'asset:' || id` and one strip inverts it. (User-created ids already contain
      // the prefix, so the pair is `asset:asset:<uuid>` → `asset:<uuid>` on the list side and
      // the raw `asset:<uuid>` on the order side; a built-in row is `asset:builtin_x` →
      // `builtin_x` against the raw `builtin_x`.) Verified against both id shapes.
      const orderIndex = new Map(orderedPromptAssetIds(getDatabase()).map((assetId, index) => [assetId, index]))
      const keyed = items.filter(item => orderIndex.has(String(item.id)))
      if (keyed.length > 0) {
        keyed.sort((a, b) => (orderIndex.get(String(a.id)) ?? 0) - (orderIndex.get(String(b.id)) ?? 0))
        const unkeyed = items.filter(item => !orderIndex.has(String(item.id)))
        // Re-number `orderKey` to the FINAL positions so the client's own sort agrees with
        // the array order it was handed. Leaving the pre-sort indices would make the two
        // disagree for every row after the first move.
        const ordered = [...keyed, ...unkeyed]
        ordered.forEach((item, index) => { item.orderKey = String(index).padStart(20, '0') })
        return apiEnvelope(id, ordered)
      }
      return apiEnvelope(id, items)
    }
    // Bindings (`/prompt-bindings`, `/prompts/:id/bindings`) have NO Grimoire counterpart:
    // there is no prompt↔assistant/agent binding table. Answered as an empty list rather
    // than refused, because an empty list is TRUE here — Grimoire binds no prompt to any
    // target — and the page renders its "not bound anywhere" state from it. A refusal would
    // surface as an error banner for a feature that is simply unused.
    if (path === '/prompt-bindings' && method === 'GET') {
      return apiEnvelope(id, listBindingRelations())
    }
    if (/^\/prompts\/[^/]+\/bindings$/.test(path) && method === 'GET') {
      const promptId = decodeURIComponent(path.slice('/prompts/'.length, -'/bindings'.length))
      return apiEnvelope(id, listBindings(promptId))
    }
    // Create IS backed: `createPromptAsset` writes a real `prompt_assets` row, and the source
    // `CreatePromptSchema` needs only title/content/visibility. Its `bindingTarget` is
    // honoured only by refusing — see the bindings branch below.
    if (path === '/prompts' && method === 'POST') {
      const title = readBodyString(body, 'title')
      const content = readBodyString(body, 'content')
      if (!title) return apiError(id, 400, 'INVALID_INPUT', '提示词标题不能为空')
      if (!content) return apiError(id, 400, 'INVALID_INPUT', '提示词内容不能为空')
      // The source schema allows an initial binding only for `restricted` prompts. Grimoire
      // has no binding table at all, so a restricted prompt would be created UNBOUND — a
      // prompt the user asked to restrict would silently be globally visible. Refused rather
      // than downgraded, because the created row would misrepresent the request.
      if (readBodyString(body, 'visibility') === 'restricted' || body.bindingTarget !== undefined) {
        // Now that bindings exist, a restricted prompt can be created honestly: the row is
        // written and the initial edge created. Without a `bindingTarget` the prompt would be
        // restricted with NO target, i.e. invisible everywhere — refused rather than created.
        // Source `CreatePromptSchema` refuses this combination outright:
        // "Global prompts cannot have an initial binding target". Accepting it (as the first
        // version did) creates a global prompt that ALSO has a binding — a state the source
        // treats as invalid, and one the UI would render inconsistently.
        if (readBodyString(body, 'visibility') === 'global' && body.bindingTarget !== undefined) {
          return apiError(id, 400, 'INVALID_INPUT', '全局提示词不能同时指定初始绑定目标。')
        }
        const target = body.bindingTarget && typeof body.bindingTarget === 'object'
          ? body.bindingTarget as Record<string, unknown>
          : null
        const targetType = target ? String(target.type || '') as 'assistant' | 'agent' : ''
        const targetId = target ? String(target.id || '') : ''
        if (!target || !targetId || (targetType !== 'assistant' && targetType !== 'agent')) {
          return apiError(id, 400, 'INVALID_INPUT',
            '受限提示词必须带 bindingTarget：没有目标的受限提示词对任何助手都不可见。')
        }
        const created = createPromptAsset(getDatabase(), { name: title, prompt: content, detail: '', nsfw: false, variantCount: 0 }, 'restricted')
        const bound = bindToTarget(created.id, targetType, targetId)
        if (!bound) {
          // The prompt was written but the edge was not. Reported as a failure so the caller
          // does not believe a restricted prompt is bound when it is not.
          return apiError(id, 400, 'INVALID_INPUT', '初始绑定目标无效，受限提示词未创建绑定：' + targetType + ':' + targetId)
        }
        return apiEnvelope(id, sourcePromptFromAsset(created, 0, created.id), 201)
      }
      const created = createPromptAsset(getDatabase(), { name: title, prompt: content, detail: '', nsfw: false, variantCount: 0 })
      // `createPromptAsset` persists and returns the real row; project it the same way the
      // list route does so the client's optimistic insert matches its refreshed list.
      return apiEnvelope(id, sourcePromptFromAsset(created, 0, created.id), 201)
    }
    // Delete IS backed for user-created assets (`source='asset'`), which is exactly the set
    // `createPromptAsset` produces.
    //
    // The id plumbed through the response is the ASSET id (`asset:<uuid>`), but
    // `deletePromptAsset` matches on `source_id`, and the two differ. That asymmetry is
    // real and the existing renderer already works around it: the canvas asset store builds
    // its key from `sourceRef` (`prompt:${row.sourceRef}`) and calls
    // `promptAssets.delete(id.slice(7))`, i.e. it deletes by sourceId. This route accepts the
    // RESPONSE id (what the source client holds), so the asset row is resolved to its
    // `source_id` first rather than passing an id the WHERE clause can never match — which
    // would have returned 0 rows changed for every delete and looked like "not deletable".
    if (/^\/prompts\/[^/]+$/.test(path) && method === 'DELETE') {
      const promptId = decodeURIComponent(path.slice('/prompts/'.length))
      const rowId = resolveAssetRowId(promptId)
      if (!rowId) {
        return apiError(id, 404, 'NOT_FOUND', '提示词不存在：' + promptId)
      }
      const row = getDatabase().exec(
        "SELECT source_id, source FROM prompt_assets WHERE id = ?",
        [rowId]
      )[0]?.values?.[0]
      if (!row) {
        return apiError(id, 404, 'NOT_FOUND', '提示词不存在：' + promptId)
      }
      const sourceId = String(row[0])
      if (String(row[1]) !== 'asset') {
        // Built-in/imported rows are not user-owned; `deletePromptAsset` scopes to
        // `source='asset'` and would silently no-op, so this says why instead.
        return apiError(id, 403, 'FORBIDDEN',
          '该提示词不可删除：Grimoire 只允许删除本应用创建的提示词，内置或导入的条目不可删除。')
      }
      const deleted = deletePromptAsset(getDatabase(), sourceId)
      if (!deleted) return apiError(id, 404, 'NOT_FOUND', '提示词删除失败：记录未变更')
      // `deletePromptAsset` writes through `db.run` but does NOT persist — its own IPC
      // handler calls `saveDatabase()` itself. Omitting this would make the delete look
      // successful in-process and vanish on restart.
      saveDatabase()
      return apiEnvelope(id, undefined)
    }
    // Order: `PATCH /prompts/:id/order` (one move) and `PATCH /prompts/order:batch` (many).
    // Both back onto the shared fractional order-key machinery the session/assistant rails
    // already use, persisted in `cherry_resource_state.order_key`. The source bodies are
    // `OrderRequestSchema` (`{before}` | `{after}` | `{position:'first'|'last'}`) and
    // `{ moves: [{ id, anchor }] }`.
    // ── AI usage records (`/settings/usage`) ──────────────────────────────────
    // Backed by the v26 `ai_usage_records` table the runtime now writes to. The source
    // contract has three endpoints; the fields Grimoire cannot answer (cost, pricing, API-key
    // attribution, image modality) are emitted as `null` rather than fabricated — each is
    // nullable in the source schema, and the projections document why per field.
    // ── Pins (`/pins`) ────────────────────────────────────────────────────────
    // Backed by `cherry_resource_state.pinned`, which Grimoire has written since the
    // resource-state projection landed — pin state was already stored, only the source's
    // `/pins` API shape was missing. Implementing it is what lets source components that call
    // `usePins` work unchanged (e.g. `AssistantResourceList`), rather than each compat wrapper
    // growing its own pin list.
    if (path === '/pins' && method === 'GET') {
      const entityType = String(body.entityType || params.entityType || search.get('entityType') || '')
      if (!entityType) return apiError(id, 400, 'INVALID_INPUT', 'entityType 不能为空')
      return apiEnvelope(id, listPins(entityType))
    }
    if (path === '/pins' && method === 'POST') {
      // Source `CreatePinSchema` is `{ entityType, entityId }` and pinning is IDEMPOTENT — the
      // source's `pin()` reuses an existing row rather than duplicating. Re-pinning therefore
      // answers the existing pin, not an error.
      const entityType = String(body.entityType || '')
      const entityId = String(body.entityId || '')
      if (!entityType || !entityId) return apiError(id, 400, 'INVALID_INPUT', 'entityType 与 entityId 不能为空')
      return apiEnvelope(id, setPin(entityType, entityId, true), 201)
    }
    if (/^\/pins\/[^/]+$/.test(path) && (method === 'DELETE' || method === 'GET')) {
      const pinId = decodeURIComponent(path.slice('/pins/'.length))
      const found = findPinById(pinId)
      if (!found) return apiError(id, 404, 'NOT_FOUND', '置顶记录不存在：' + pinId)
      if (method === 'GET') return apiEnvelope(id, found)
      setPin(found.entityType, found.entityId, false)
      return apiEnvelope(id, undefined)
    }
    // ── Groups (`/groups`) ──────────────────────────────────────────────────
    // Entity-type-scoped containers for assistants/agents, backed by
    // `cherry_resource_groups` (schema v27). NOT Grimoire's pre-existing `chat_groups`,
    // which names conversation-history buckets — `AiAssistantRecord.group_id` points at
    // these, so reusing that table would misattribute assistants.
    // ── Assistants read/update (`/assistants`) ───────────────────────────────
    // The POST path already existed for conversation import; these are the reads and updates
    // the source `useAssistantsApi` / `useAssistant` hooks call, which is what lets those
    // hooks drive a real list instead of an empty one.
    // ── Topics read/update (`/topics`) ───────────────────────────────────────
    // The POST path existed for import; these are what the source `useTopic` hooks call.
    if (path === '/topics' && method === 'GET') {
      // The source `/topics` list is GLOBAL (cursor-paginated, pinned-first), NOT scoped to a
      // session — an earlier version of this route required `sessionId`, which is a different
      // contract and would have returned a subset the source's `useTopics` cannot page.
      //
      // Ordering mirrors the source's composed view: pinned topics first (ordered by their
      // resource-state order key), then the rest by that same key, with `id` as the tiebreak.
      return apiEnvelope(id, listTopicsPage({
        ids: Array.isArray(body.ids) ? body.ids.map(String) : undefined,
        q: typeof body.q === 'string' ? body.q : (search.get('q') || undefined),
        inTrash: search.get('inTrash') === 'true' || body.inTrash === true,
        cursor: String(body.cursor || search.get('cursor') || '') || undefined,
        limit: Number(body.limit || search.get('limit') || 50)
      }))
    }
    if (path === '/topics/reusable-placeholder' && method === 'POST') {
      // Source `TopicService.reuseOrCreatePlaceholder`: reuse the newest topic that is still
      // an untouched placeholder, else create one. Each reuse predicate below is load-bearing
      // — dropping any of them makes a click spawn a duplicate topic instead of reusing the
      // empty one the user is already looking at:
      //   - `title = '新主题'`: Grimoire's default title, i.e. never renamed. A topic the user
      //     named is theirs and must not be repurposed for a new placeholder.
      //   - `archived = 0`: an archived topic is in the recycle bin, not reusable.
      //   - `excludeTopicId`: the caller is switching AWAY from that topic, so reusing it would
      //     put the user back where they started.
      // The source also requires `activeNodeId IS NULL`; Grimoire has no per-topic active node
      // (see the /topics/:id/messages refusal), and its equivalent of "untouched" is the
      // default title, which is what is checked.
      const assistantId = readBodyString(body, 'assistantId')
      const excludeTopicId = readBodyString(body, 'excludeTopicId')
      const db = getDatabase()
      const clauses = ["title = '新主题'", 'archived = 0']
      const parameters: unknown[] = []
      if (excludeTopicId) { clauses.push('id <> ?'); parameters.push(excludeTopicId) }
      const reusable = db.exec(
        `SELECT id FROM ai_topics WHERE ${clauses.join(' AND ')} ORDER BY updated_at DESC, id ASC LIMIT 1`,
        parameters
      )[0]?.values?.[0]?.[0]
      if (reusable) {
        return apiEnvelope(id, { topic: sourceTopicFromRecord(findTopicById(String(reusable))!) , created: false })
      }
      // No reusable placeholder: create one. `sessionId` is required by Grimoire's service
      // (its topics are session-scoped), so the assistant's own session is resolved first.
      const sessionId = resolveAssistantSessionId(assistantId)
      if (!sessionId) return apiError(id, 400, 'INVALID_INPUT', '无法确定该助手的会话，无法创建主题')
      const created = saveAiTopic({ session_id: sessionId, title: '新主题' })
      return apiEnvelope(id, { topic: sourceTopicFromRecord(created), created: true })
    }
    if (path === '/topics/latest' && method === 'GET') {
      // Two corrections against the source contract:
      //  - the response is `{ topic: Topic | null }`, NOT a bare topic. The source's declared
      //    type is `LatestTopicResponse`, and a caller reading `.topic` would get `undefined`
      //    from a bare payload.
      //  - the query key is `assistantId`, not `sessionId`. The source sends
      //    `assistantId: 'unlinked'` to mean "the topics with no assistant", so that literal is
      //    translated rather than passed through as an id that matches nothing.
      const rawAssistantId = String(search.get('assistantId') || body.assistantId || '')
      const assistantId = rawAssistantId === 'unlinked' ? null : (rawAssistantId || undefined)
      const sessionId = assistantId === undefined
        ? undefined
        : (assistantId === null ? null : resolveAssistantSessionId(assistantId))
      const latest = getLatestAiTopic({ sessionId: sessionId ?? null })
      return apiEnvelope(id, { topic: latest ? sourceTopicFromRecord(latest) : null })
    }
    const topicTreeMatch = path.match(/^\/topics\/([^/]+)\/(messages|active-node)$/)
    if (topicTreeMatch) {
      let topicId: string
      try { topicId = decodeURIComponent(topicTreeMatch[1]) } catch { return apiError(id, 400, 'VALIDATION_ERROR', 'Invalid topic id encoding') }
      if (topicTreeMatch[2] === 'messages' && method === 'GET') {
        const branch = readTopicBranch(topicId, sourceTopicBranchQuery(request.params, search))
        return apiEnvelope(id, { ...branch, items: branch.items.map(({ message }) => ({ message: sourceTopicMessage(message) })) })
      }
      if (topicTreeMatch[2] === 'messages' && method === 'POST') {
        // Service strictly admits only the source-supported persistence subset:
        // parentId/role/data/status/setAsActive. Model/snapshot/cohort/file/runtime
        // fields refuse explicitly; never discard intent or initialize/adopt history.
        const message = appendTopicMessage(topicId, topicRequestObject(request.body) as unknown as AppendTopicMessage)
        const projected = sourceTopicMessage(message)
        notifyTopicTreeWrite(topicId, message.id) // service transaction committed
        return apiEnvelope(id, projected, 201)
      }
      if (topicTreeMatch[2] === 'active-node' && method === 'PUT') {
        const input = topicRequestObject(request.body)
        if (Object.keys(input).some(key => key !== 'nodeId') || typeof input.nodeId !== 'string' || !input.nodeId.length) {
          throw new TopicTreeError('VALIDATION', 'Expected { nodeId: nonempty string }')
        }
        const result = selectTopicContentNode(topicId, input.nodeId)
        notifyTopicTreeWrite(topicId, input.nodeId)
        return apiEnvelope(id, result)
      }
      return apiError(id, 501, 'NOT_IMPLEMENTED', 'Topic tree operation is outside the append/read/select foundation')
    }
    if (/^\/topics\/[^/]+\/(messages(?:\/.*)?|tree|path|duplicate)$/.test(path) || /^\/messages\/[^/]+(?:\/.*)?$/.test(path)) {
      // getPathThrough descends to the newest leaf; readTopicBranch does NOT.
      // Do not substitute one for the other or pretend sibling/file operations work.
      return apiError(id, 501, 'NOT_IMPLEMENTED', 'Topic siblings/duplicate/path-through/tree/message mutations are not implemented')
    }
    // The archive page calls `POST /<domain>/:id/restore` for each domain it lists. Sessions
    // had no such route, so restoring an archived SESSION from the recycle bin would 404 while
    // the other two domains worked — a partial failure the page reports per row.
    if (/^\/sessions\/[^/]+\/restore$/.test(path) && method === 'POST') {
      const sessionId = decodeURIComponent(path.slice('/sessions/'.length, -'/restore'.length))
      try {
        return apiEnvelope(id, restoreAiSession(sessionId))
      } catch (error) {
        return apiError(id, 404, 'NOT_FOUND', error instanceof Error ? error.message : String(error))
      }
    }
    // Permanent deletion from the recycle bin. `DELETE /<domain>/:id` is what the page calls,
    // and for an already-archived row that means the physical delete Grimoire's services
    // already implement — which is correct HERE (the user asked for it), unlike the DELETE
    // routes above where archiving was the honest interpretation.
    if (/^\/sessions\/[^/]+$/.test(path) && method === 'DELETE') {
      const sessionId = decodeURIComponent(path.slice('/sessions/'.length))
      const archived = listAiSessions({ includeArchived: true, limit: 500 }).find(item => item.id === sessionId)
      if (!archived) return apiError(id, 404, 'NOT_FOUND', '会话不存在：' + sessionId)
      // Only an ARCHIVED session can be permanently deleted. The live-session DELETE is the
      // archive path on the assistants/topics routes; for sessions the archive happens through
      // `ai.sessions.archive`, so an unarchived row here would be a caller mistake.
      if (!archived.archived) {
        return apiError(id, 409, 'CONFLICT', '该会话未在回收站中，无法永久删除（请先归档）')
      }
      return apiEnvelope(id, { deleted: deleteAiSession(sessionId) })
    }
    if (/^\/topics\/[^/]+\/restore$/.test(path) && method === 'POST') {
      const topicId = decodeURIComponent(path.slice('/topics/'.length, -'/restore'.length))
      try {
        return apiEnvelope(id, sourceTopicFromRecord(restoreAiTopic(topicId)))
      } catch (error) {
        return apiError(id, 404, 'NOT_FOUND', error instanceof Error ? error.message : String(error))
      }
    }
    if (/^\/topics\/[^/]+\/move$/.test(path) && method === 'POST') {
      const topicId = decodeURIComponent(path.slice('/topics/'.length, -'/move'.length))
      const targetSessionId = readBodyString(body, 'sessionId') || readBodyString(body, 'targetSessionId')
      if (!targetSessionId) return apiError(id, 400, 'INVALID_INPUT', 'move 需要目标 sessionId')
      const existing = listAiTopics(String(existingTopicSessionId(topicId) || ''), true).find(topic => topic.id === topicId)
      if (!existing) return apiError(id, 404, 'NOT_FOUND', '主题不存在：' + topicId)
      // The move re-writes the topic through the real service, which carries its
      // resource-state projection with it.
      const moved = saveAiTopic({ ...existing, id: topicId, session_id: targetSessionId })
      return apiEnvelope(id, sourceTopicFromRecord(moved))
    }
    if (/^\/topics\/[^/]+$/.test(path) && (method === 'GET' || method === 'PATCH' || method === 'DELETE')) {
      const topicId = decodeURIComponent(path.slice('/topics/'.length))
      const sessionId = existingTopicSessionId(topicId)
      const existing = sessionId ? listAiTopics(sessionId, true).find(topic => topic.id === topicId) : undefined
      if (!existing) return apiError(id, 404, 'NOT_FOUND', '主题不存在：' + topicId)
      if (method === 'GET') return apiEnvelope(id, sourceTopicFromRecord(existing))
      if (method === 'DELETE') {
        // Archive, not physical delete — same reason as assistants: the source moves topics to
        // the recycle bin, while Grimoire's `deleteAiTopic` destroys the row.
        return apiEnvelope(id, sourceTopicFromRecord(archiveAiTopic(topicId)))
      }
      const updated = saveAiTopic({
        ...existing,
        id: topicId,
        ...(body.name !== undefined ? { title: readBodyString(body, 'name') } : {})
      })
      return apiEnvelope(id, sourceTopicFromRecord(updated))
    }
    if (path === '/assistants' && method === 'GET') {
      const includeArchived = search.get('includeArchived') === 'true' || body.includeArchived === true
      const assistants = listAiAssistants(includeArchived).map(sourceAssistantFromRecord)
      // OFFSET pagination (`{items,total,page}`), not a bare array. The source's declared
      // response is `OffsetPaginationResponse<Assistant>`, and `useAssistantsApi` reads
      // `data?.items` — so a bare array made it fall back to `EMPTY_ASSISTANTS` and the rail
      // rendered no assistants at all while the request itself succeeded (200 with a body).
      // Verified against the source component: it fetches /assistants and /topics correctly
      // yet showed only the "unlinked" bucket until this envelope was corrected.
      return apiEnvelope(id, { items: assistants, total: assistants.length, page: 1 })
    }
    if (/^\/assistants\/[^/]+\/restore$/.test(path) && method === 'POST') {
      const assistantId = decodeURIComponent(path.slice('/assistants/'.length, -'/restore'.length))
      try {
        return apiEnvelope(id, sourceAssistantFromRecord(restoreAiAssistant(assistantId)))
      } catch (error) {
        return apiError(id, 404, 'NOT_FOUND', error instanceof Error ? error.message : String(error))
      }
    }
    if (/^\/assistants\/[^/]+$/.test(path) && (method === 'GET' || method === 'PATCH' || method === 'DELETE')) {
      const assistantId = decodeURIComponent(path.slice('/assistants/'.length))
      const existing = listAiAssistants(true).find(assistant => assistant.id === assistantId)
      if (!existing) return apiError(id, 404, 'NOT_FOUND', '助手不存在：' + assistantId)
      if (method === 'GET') return apiEnvelope(id, sourceAssistantFromRecord(existing))
      if (method === 'DELETE') {
        // Archive, not physical delete: the source's assistant deletion moves to the recycle
        // bin (`deleteAssistant` goes through TrashService). Grimoire's `deleteAiAssistant` is
        // a physical DELETE, so using it here would destroy data the user expects to recover.
        return apiEnvelope(id, sourceAssistantFromRecord(archiveAiAssistant(assistantId)))
      }
      const updated = saveAiAssistant({
        id: assistantId,
        ...(body.name !== undefined ? { name: readBodyString(body, 'name') } : {}),
        ...(body.prompt !== undefined ? { system_prompt: readBodyString(body, 'prompt') } : {}),
        ...(body.description !== undefined ? { description: readBodyString(body, 'description') } : {}),
        ...(body.emoji !== undefined ? { avatar: readBodyString(body, 'emoji') } : {}),
        ...(body.modelId !== undefined ? { model_id: readBodyString(body, 'modelId') } : {})
      })
      if (!updated) return apiError(id, 404, 'NOT_FOUND', '助手更新失败：' + assistantId)
      return apiEnvelope(id, sourceAssistantFromRecord(updated))
    }
    if (path === '/groups' && method === 'GET') {
      const entityType = String(body.entityType || params.entityType || search.get('entityType') || '')
      if (!entityType) return apiError(id, 400, 'INVALID_INPUT', 'entityType 不能为空')
      return apiEnvelope(id, listGroups(entityType))
    }
    if (path === '/groups' && method === 'POST') {
      const entityType = String(body.entityType || '')
      const created = createGroup(entityType, body.name)
      if (!created) return apiError(id, 400, 'INVALID_INPUT', 'group 需要合法 entityType 与非空 name')
      return apiEnvelope(id, created, 201)
    }
    if (/^\/groups\/[^/]+$/.test(path) && (method === 'GET' || method === 'PATCH' || method === 'DELETE')) {
      const groupId = decodeURIComponent(path.slice('/groups/'.length))
      if (method === 'GET') {
        const group = getGroup(groupId)
        if (!group) return apiError(id, 404, 'NOT_FOUND', '分组不存在：' + groupId)
        return apiEnvelope(id, group)
      }
      if (method === 'PATCH') {
        const renamed = renameGroup(groupId, body.name)
        if (!renamed) return apiError(id, 404, 'NOT_FOUND', '分组不存在或名称无效：' + groupId)
        return apiEnvelope(id, renamed)
      }
      if (!deleteGroup(groupId)) return apiError(id, 404, 'NOT_FOUND', '分组不存在：' + groupId)
      return apiEnvelope(id, undefined)
    }
    if (/^\/groups\/[^/]+\/order$/.test(path) && method === 'PATCH') {
      const groupId = decodeURIComponent(path.slice('/groups/'.length, -'/order'.length))
      const anchor = body && typeof body === 'object' ? body as Record<string, unknown> : {}
      // Typed explicitly: `anchor.position` is `unknown` from the body, and a bare ternary
      // widens the literal to `string`, which the service's anchor type rejects.
      let normalized: { before?: string; after?: string; position?: 'first' | 'last' } | null = null
      if (typeof anchor.before === 'string') normalized = { before: anchor.before }
      else if (typeof anchor.after === 'string') normalized = { after: anchor.after }
      else if (anchor.position === 'first' || anchor.position === 'last') normalized = { position: anchor.position }
      if (!normalized) return apiError(id, 400, 'INVALID_INPUT', 'anchor 需要 before / after / position 之一')
      if (!reorderGroup(groupId, normalized)) {
        // A stale anchor is a conflict, not a silent append.
        return apiError(id, 409, 'CONFLICT', '分组排序失败：锚点不存在或分组已删除')
      }
      return apiEnvelope(id, undefined)
    }
    // ── Recycle bin (`/archives`) ────────────────────────────────────────────
    // See `cherry-archive.service.ts`: the storage has been populated all along (every archive
    // path writes `deleted_at`, every restore clears it), so this is a projection-only route.
    if (path === '/archives' && method === 'GET') {
      const limit = Number(body.limit ?? search.get('limit') ?? 20)
      const cursor = String(body.cursor || search.get('cursor') || '') || undefined
      return apiEnvelope(id, listArchives({ limit: Number.isFinite(limit) ? limit : 20, cursor }))
    }
    if (path === '/ai-usage-records' && method === 'GET') {
      const limit = Number(body.limit ?? params.limit ?? 100)
      const records = listAiUsage(Number.isFinite(limit) ? limit : 100)
      // The source response is `CursorPaginationResponse & { total }`. Grimoire returns the
      // whole (bounded) set in one page and omits `nextCursor` — the honest "no more pages"
      // signal, rather than a cursor that would lead nowhere.
      return apiEnvelope(id, {
        items: records.map(record => projectUsageEntry(record, record.id)),
        total: summarizeAiUsage().calls
      })
    }
    if (path === '/ai-usage-records/stats' && method === 'GET') {
      // One bucket, not a top-N ranking: Grimoire records no provider/model attribution
      // granular enough to rank groups without inventing them. `buckets` therefore carries the
      // full range and `other` is empty, which is a truthful shape for "there is one group".
      return apiEnvelope(id, {
        buckets: [],
        totals: projectUsageTotals(),
        other: {
          inputTokens: 0, outputTokens: 0, totalTokens: 0, reasoningTokens: null,
          noCacheTokens: null, cacheReadTokens: 0, cacheWriteTokens: null, imageCount: null,
          totalCost: null, costCurrency: null, recordCount: 0, requestCount: 0
        }
      })
    }
    if (path === '/ai-usage-records/timeline' && method === 'GET') {
      return apiEnvelope(id, { buckets: listUsageTimeline(), costTotals: [], dailyCosts: [] })
    }
    // ── Models ───────────────────────────────────────────────────────────────
    // The source `/models` lists the per-provider model rows the settings, code and paintings
    // pages read. Grimoire stores models as a JSON array of bare string IDs in the
    // `providers.models` column, so the projection mints a source `Model` shape from each.
    //
    // WHAT IS NOT FABRICATED: capabilities, pricing, image generation support, context window,
    // max tokens, input/output modalities — Grimoire stores none of those, so they are absent
    // or empty rather than invented. A paintings page that filters on
    // `supportsImageGenerationEndpoint` will see no matches, which is the honest result: without
    // a provider registry that declares image-generation support, claiming it would be a lie.
    if (path === '/models' && method === 'GET') {
      const filter = params.providerId ?? search.get('providerId') ?? undefined
      if (filter !== undefined && typeof filter !== 'string') return apiError(id, 400, 'VALIDATION_ERROR', 'providerId must be a string')
      return apiEnvelope(id, sourceRegisteredModels(filter as string | undefined))
    }
    // Source wildcard detail accepts API IDs containing /, and splits on FIRST ::.
    if (path.startsWith('/models/') && method === 'GET') {
      const uniqueId = decodeURIComponent(path.slice('/models/'.length))
      const split = uniqueId.indexOf('::')
      if (split < 0) return apiError(id, 400, 'VALIDATION_ERROR', 'Expected providerId::modelId')
      const providerId = uniqueId.slice(0, split), modelId = uniqueId.slice(split + 2)
      const model = sourceRegisteredModels(providerId).find(item => item.apiModelId === modelId)
      return model ? apiEnvelope(id, model) : apiError(id, 404, 'NOT_FOUND', 'Model 不存在')
    }
    // ── File library (Files page) ─────────────────────────────────────────────
    // The source `/files/entries` reads one flat table; Grimoire splits the same concept across
    // `ai_attachments` (copied-in, internal) and `image_refs` (referenced-in-place, external),
    // so the service derives the union rather than a new table duplicating both. See
    // `cherry-file-library.service.ts` for what is deliberately NOT fabricated.
    if (path === '/files/entries/stats' && method === 'GET') {
      return apiEnvelope(id, fileLibraryStats())
    }
    if (path === '/files/entries' && method === 'GET') {
      // `inTrash=true` is a legitimate source query the schema allows for internal rows.
      // Grimoire has no file trash/restore, and the service already excludes soft-deleted
      // attachments, so answering it with the live list would silently return the wrong set.
      if (search.get('inTrash') === 'true') {
        return apiError(id, 400, 'NOT_IMPLEMENTED', '文件回收站尚未实现：Grimoire 无文件恢复流程')
      }
      const origin = search.get('origin')
      const fileType = search.get('fileType')
      const page = queryFileLibrary({
        ...(origin === 'internal' || origin === 'external' ? { origin } : {}),
        // The page sends this whenever a sidebar type filter is active; dropping it would return
        // the whole library under a narrowing filter.
        ...(fileType ? { fileType: fileType as never } : {}),
        ...(search.get('search') ? { search: String(search.get('search')) } : {}),
        ...(search.get('sortBy') ? { sortBy: String(search.get('sortBy')) as never } : {}),
        ...(search.get('sortOrder') ? { sortOrder: String(search.get('sortOrder')) as never } : {}),
        ...(search.get('limit') ? { limit: Number(search.get('limit')) } : {}),
        ...(search.get('cursor') ? { cursor: String(search.get('cursor')) } : {})
      })
      return apiEnvelope(id, page)
    }
    const fileEntryMatch = path.match(/^\/files\/entries\/([^/]+)$/)
    if (fileEntryMatch && method === 'GET') {
      const entryId = decodeURIComponent(fileEntryMatch[1])
      const entry = findFileLibraryEntry(entryId)
      if (!entry) return apiError(id, 404, 'NOT_FOUND', '文件不存在：' + entryId)
      return apiEnvelope(id, entry)
    }
    if (path === '/prompts/order:batch' && method === 'PATCH') {
      const moves = Array.isArray(body.moves) ? body.moves : null
      if (!moves || moves.length === 0) return apiError(id, 400, 'INVALID_INPUT', 'moves 不能为空')
      for (const move of moves) {
        const moveId = move && typeof move === 'object' ? readBodyString(move as Record<string, unknown>, 'id') : ''
        const anchor = move && typeof move === 'object' ? parsePromptOrderAnchor((move as Record<string, unknown>).anchor) : null
        if (!moveId || !anchor) return apiError(id, 400, 'INVALID_INPUT', '每个 move 需要 id 与合法的 anchor')
        const rowId = resolveAssetRowId(moveId)
        if (!rowId) return apiError(id, 404, 'NOT_FOUND', '提示词不存在：' + moveId)
        reorderPromptAsset(getDatabase(), rowId, anchor)
      }
      saveDatabase()
      return apiEnvelope(id, undefined)
    }
    if (/^\/prompts\/[^/]+\/order$/.test(path) && method === 'PATCH') {
      const promptId = decodeURIComponent(path.slice('/prompts/'.length, -'/order'.length))
      const anchor = parsePromptOrderAnchor(body)
      if (!anchor) {
        return apiError(id, 400, 'INVALID_INPUT', 'anchor 需要 before / after / position 之一')
      }
      const rowId = resolveAssetRowId(promptId)
      if (!rowId) return apiError(id, 404, 'NOT_FOUND', '提示词不存在：' + promptId)
      try {
        reorderPromptAsset(getDatabase(), rowId, anchor)
      } catch (error) {
        // The anchor names another prompt; a stale client can reference one that is gone.
        // Answered as a conflict so the client refreshes instead of assuming the move applied.
        const message = error instanceof Error ? error.message : String(error)
        if (message.startsWith('ORDER_ANCHOR_NOT_FOUND')) {
          return apiError(id, 409, 'CONFLICT', '排序锚点已不存在，请刷新后重试。')
        }
        throw error
      }
      saveDatabase()
      return apiEnvelope(id, undefined)
    }
    // Update IS backed (added alongside this route): `updatePromptAsset` changes `name` and
    // `prompt` on a user-created row and re-reads it. What it does NOT support is the
    // `visibility` transition — Grimoire stores no visibility (every asset is global) and no
    // bindings, so the source's `expectedBindings` concurrent-modification guard has nothing
    // to guard. A request that tries to CHANGE visibility is refused rather than ignored:
    // silently dropping it would report success for a state change that did not happen.
    if (/^\/prompts\/[^/]+$/.test(path) && method === 'PATCH') {
      const promptId = decodeURIComponent(path.slice('/prompts/'.length))
      const rowId = resolveAssetRowId(promptId)
      if (!rowId) return apiError(id, 404, 'NOT_FOUND', '提示词不存在：' + promptId)
      const nextVisibility = readBodyString(body, 'visibility')
      if (nextVisibility && nextVisibility !== 'global') {
        return apiError(id, 501, 'NOT_IMPLEMENTED',
          '提示词可见性未接入：Grimoire 不存储可见性（所有提示词都是全局），无法把提示词改为受限。')
      }
      const updated = updatePromptAsset(getDatabase(), rowId, {
        ...(body.title !== undefined ? { name: body.title } : {}),
        ...(body.content !== undefined ? { prompt: body.content } : {})
      })
      if (!updated) {
        return apiError(id, 403, 'FORBIDDEN',
          '该提示词不可编辑：Grimoire 只允许编辑本应用创建的提示词，内置或导入的条目不可编辑。')
      }
      return apiEnvelope(id, sourcePromptFromAsset(updated, 0, updated.id))
    }
    // `PUT`/`DELETE /prompts/:id/bindings/:targetType/:targetId` — the edges themselves.
    const bindingEdge = path.match(/^\/prompts\/([^/]+)\/bindings\/([a-z]+)\/(.+)$/)
    if (bindingEdge && (method === 'PUT' || method === 'DELETE')) {
      const promptId = decodeURIComponent(bindingEdge[1])
      const targetType = decodeURIComponent(bindingEdge[2]) as 'assistant' | 'agent'
      const targetId = decodeURIComponent(bindingEdge[3])
      const bound = method === 'PUT'
        ? bindToTarget(promptId, targetType, targetId)
        : unbindFromTarget(promptId, targetType, targetId)
      if (!bound) {
        // An invalid target is a caller error, not a silent success — a 200 here would tell the
        // UI the edge exists when nothing was written.
        return apiError(id, 400, 'INVALID_INPUT', '绑定目标无效：' + targetType + ':' + targetId)
      }
      return apiEnvelope(id, undefined)
    }
    // ── Conversation import (DataSettings → ChatGPT / Claude import) ───────────
    // The source `ImportService` writes through the DataApi rather than the Host
    // Bridge, so these two create routes are what its first writes hit. Both back onto
    // the real Grimoire services; the DTOs follow the source schemas
    // (`CreateAssistantSchema` requires `name`; `CreateTopicSchema` is all-optional).
    if (path === '/assistants' && method === 'POST') {
      // Source `CreateAssistantSchema` requires `name`; the remaining mutable fields are
      // `prompt` / `emoji` / `description` / `settings` / `modelId` / `groupId` / ….
      const name = readBodyString(body, 'name')
      if (!name) return apiError(id, 400, 'INVALID_INPUT', '助手名称不能为空')
      const saved = saveAiAssistant({
        name,
        description: readBodyString(body, 'description'),
        system_prompt: readBodyString(body, 'prompt'),
        model_id: readBodyString(body, 'modelId'),
        avatar: readBodyString(body, 'emoji'),
        settings: body.settings && typeof body.settings === 'object' ? body.settings as Record<string, unknown> : {}
      })
      return apiEnvelope(id, sourceAssistantFromRecord(saved), 201)
    }
    if (path === '/topics' && method === 'POST') {
      // Source `CreateTopicSchema` is `{ name?, assistantId? }` — all optional — and the
      // request carries the owning session as a query param on the source route. Grimoire
      // topics are always session-scoped, so a missing session is a caller error rather
      // than something to guess.
      // Body OR query: the source sends the owning session as a QUERY param on this route
      // (`assistantId`/`sessionId` on the URL), while the compat's own callers put it in the
      // body. Reading only the body made the source's shape fail with a 400.
      const sessionId = readBodyString(body, 'sessionId') || readBodyString(body, 'session_id') || String(search.get('sessionId') || '')
      if (!sessionId) return apiError(id, 400, 'INVALID_INPUT', '主题必须指定所属会话')
      const saved = saveAiTopic({
        session_id: sessionId,
        title: readBodyString(body, 'name') || readBodyString(body, 'title') || '新主题'
      })
      return apiEnvelope(id, sourceTopicFromRecord(saved), 201)
    }

    if (path === '/providers' && method === 'GET') return apiEnvelope(id, listSourceProviders())
    if (path === '/providers' && method === 'POST') return apiEnvelope(id, createSourceProvider(body), 201)

    const match = path.match(/^\/providers\/([^/]+)$/)
    if (match) {
      const providerId = decodeURIComponent(match[1])
      if (method === 'GET') {
        const row = getDatabase().exec('SELECT * FROM providers WHERE id=?', [providerId])[0]?.values?.[0]
        if (!row) return apiError(id, 404, 'NOT_FOUND', 'Provider 不存在')
        return apiEnvelope(id, sourceProviderFromRow(row))
      }
      if (method === 'PATCH') {
        applyProviderUpdate(providerId, body)
        // Source contract: PATCH returns the updated Provider (not a boolean), and the
        // editor/hooks refresh from that value.
        const updated = getDatabase().exec('SELECT * FROM providers WHERE id=?', [providerId])[0]?.values?.[0]
        return apiEnvelope(id, sourceProviderFromRow(updated!))
      }
      if (method === 'DELETE') {
        getDatabase().run('DELETE FROM providers WHERE id=?', [providerId])
        saveDatabase()
        return apiEnvelope(id, null)
      }
    }

    // Sub-resources the mounted page may probe. Reads return masked entries; a POST
    // writes through the same `encryptKey` the Grimoire save path uses, because the
    // deep-link import (`useProviderDeepLinkImport`) adds the key through this route
    // and a read-only envelope would silently discard it.
    const keysMatch = path.match(/^\/providers\/([^/]+)\/api-keys$/)
    if (keysMatch && method === 'GET') {
      const providerId = decodeURIComponent(keysMatch[1])
      const row = getDatabase().exec('SELECT api_key FROM providers WHERE id=?', [providerId])[0]?.values?.[0]
      const hasKey = String(row?.[0] || '').length > 0
      return apiEnvelope(id, { keys: hasKey ? [{ id: 'stored', key: SECRET_PLACEHOLDER, isEnabled: true, label: '' }] : [] })
    }
    if (keysMatch && method === 'POST') {
      const providerId = decodeURIComponent(keysMatch[1])
      const row = getDatabase().exec('SELECT id FROM providers WHERE id=?', [providerId])[0]?.values?.[0]
      if (!row) return apiError(id, 404, 'NOT_FOUND', 'Provider 不存在')
      const key = readBodyString(body, 'key').trim()
      if (!key) return apiError(id, 400, 'INVALID_KEY', 'API Key 不能为空')
      getDatabase().run("UPDATE providers SET api_key=?, updated_at=datetime('now','localtime') WHERE id=?", [encryptKey(key), providerId])
      saveDatabase()
      const updated = getDatabase().exec('SELECT * FROM providers WHERE id=?', [providerId])[0]?.values?.[0]
      // Source contract: POST returns the parent Provider so callers refresh in one trip.
      return apiEnvelope(id, sourceProviderFromRow(updated!), 201)
    }
    const authConfigMatch = path.match(/^\/providers\/([^/]+)\/auth-config$/)
    if (authConfigMatch && method === 'GET') {
      const providerId = decodeURIComponent(authConfigMatch[1])
      const row = getDatabase().exec('SELECT access_mode FROM providers WHERE id=?', [providerId])[0]?.values?.[0]
      if (!row) return apiError(id, 404, 'NOT_FOUND', 'Provider 不存在')
      return apiEnvelope(id, String(row[0]) === 'login' ? {} : null)
    }

    // ── MCP servers ────────────────────────────────────────────────────────────
    // Grimoire has no offset-pagination service for MCP, so the source
    // `OffsetPaginationResponse` envelope is filled with a single complete page —
    // the shape the source list reads, without pretending a pager exists. The list
    // query filters (`id`/`isActive`/`type`, source `ListMcpServersQuerySchema`) are
    // honored because `useMcpServer(id)` reads the detail through this route and
    // takes `items[0]` — ignoring `id` would show a different server's detail.
    if (path === '/mcp-servers' && method === 'GET') {
      let items = listSourceMcpServers()
      const filterId = typeof params.id === 'string' ? params.id : ''
      if (filterId) items = items.filter(item => item.id === filterId)
      if (typeof params.isActive === 'boolean' || params.isActive === 'true' || params.isActive === 'false') {
        const active = params.isActive === true || params.isActive === 'true'
        items = items.filter(item => Boolean(item.isActive) === active)
      }
      const filterType = typeof params.type === 'string' ? params.type : ''
      if (filterType) items = items.filter(item => item.type === filterType)
      return apiEnvelope(id, { items, total: items.length, offset: 0, limit: items.length })
    }
    if (path === '/mcp-servers' && method === 'POST') {
      return apiEnvelope(id, createSourceMcpServer(body), 201)
    }
    if (path === '/mcp-servers' && method === 'PATCH') {
      // Collection PATCH is the source reorder route (`{ orderedIds }`). Grimoire has
      // no MCP order column, so this answers an explicit error instead of a fake
      // success; the source hook reverts its optimistic order on rejection, which is
      // the honest outcome until an order key exists.
      return apiError(id, 400, 'NOT_IMPLEMENTED', 'MCP 排序尚无 Grimoire 存储，未桥接 PATCH /mcp-servers')
    }
    const mcpMatch = path.match(/^\/mcp-servers\/([^/]+)$/)
    if (mcpMatch) {
      const serverId = decodeURIComponent(mcpMatch[1])
      const record = listMcpServers(true).find(server => server.id === serverId)
      if (!record) return apiError(id, 404, 'NOT_FOUND', 'MCP Server 不存在')
      if (method === 'GET') return apiEnvelope(id, sourceMcpServerFromRecord(record))
      if (method === 'PATCH') return apiEnvelope(id, sourceMcpServerFromRecord(applyMcpServerUpdate(serverId, body)))
      if (method === 'DELETE') {
        deleteMcpServer(serverId)
        return apiEnvelope(id, null)
      }
    }
    const mcpToolsMatch = path.match(/^\/mcp-servers\/([^/]+)\/tools$/)
    if (mcpToolsMatch && method === 'GET') {
      const serverId = decodeURIComponent(mcpToolsMatch[1])
      const record = listMcpServers().find(server => server.id === serverId)
      if (!record) return apiError(id, 404, 'NOT_FOUND', 'MCP Server 不存在')
      return apiEnvelope(id, { tools: sourceMcpTools(serverId) })
    }
    return apiError(id, 404, 'NOT_FOUND', 'DataApi 路由未桥接：' + method + ' ' + path)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (error instanceof TopicTreeError) {
      const status = error.code === 'UNSUPPORTED' ? 501 : error.code === 'NOT_FOUND' ? 404
        : error.code === 'VALIDATION' ? 400 : error.code === 'INVALID_OPERATION' ? 409 : 500
      const code = error.code === 'UNSUPPORTED' ? 'NOT_IMPLEMENTED' : error.code === 'VALIDATION' ? 'VALIDATION_ERROR' : error.code
      return apiError(id, status, code, message)
    }
    if (error instanceof CherryAgentMessageError) return apiError(id, error.status, error.code, error.message)
    if (error instanceof URIError) return apiError(id, 400, 'VALIDATION_ERROR', 'Invalid resource id encoding')
    if (message === 'AGENT_SESSION_READ_MODEL_NOT_FOUND' || message === 'AGENT_SESSION_READ_MODEL_AGENT_NOT_FOUND') return apiError(id, 404, 'NOT_FOUND', 'Agent session or owner 不存在')
    if (message === 'AGENT_SESSION_READ_MODEL_WORKSPACE_LOCKED') return apiError(id, 409, 'INVALID_OPERATION', 'Session workspace cannot change after a message exists')
    if (message.startsWith('AGENT_SESSION_READ_MODEL_')) return apiError(id, 400, 'VALIDATION_ERROR', message)
    if (message === 'AGENT_WORKSPACE_NOT_FOUND') return apiError(id, 404, 'NOT_FOUND', 'Workspace 不存在')
    if (message.startsWith('AGENT_WORKSPACE_')) {
      const forbidden = /MANAGED_PATH|UNSAFE_SYSTEM_PATH|PATH_COLLISION/.test(message)
      return apiError(id, forbidden ? 403 : 400, forbidden ? 'FORBIDDEN' : 'VALIDATION_ERROR', message)
    }
    if (message.startsWith('AGENT_SESSION_SOURCE_UNREPRESENTABLE')) return apiError(id, 409, 'AGENT_SESSION_SOURCE_UNREPRESENTABLE', 'Runtime Agent sessions lack the source workspace/read-model and conversation/background ownership required for projection')
    if (message.startsWith('AGENT_SESSION_SOURCE_INVALID_QUERY')) return apiError(id, 400, 'VALIDATION_ERROR', message)
    if (message.startsWith('AGENT_SOURCE_TYPE_UNREPRESENTABLE')) return apiError(id, 409, 'AGENT_SOURCE_TYPE_UNREPRESENTABLE', 'This blueprint cannot be represented by the source AgentType contract')
    if (message.startsWith('AGENT_SOURCE_FIELD_UNSUPPORTED')) return apiError(id, 409, 'AGENT_SOURCE_FIELD_UNSUPPORTED', message)
    if (message.startsWith('AGENT_BLUEPRINT_')) return apiError(id, 400, 'VALIDATION_ERROR', message)
    const code = message.startsWith('PROVIDER_EXISTS') ? 'CONFLICT' : message.startsWith('PROVIDER_NOT_FOUND') ? 'NOT_FOUND' : 'INTERNAL'
    return apiError(id, code === 'INTERNAL' ? 500 : code === 'CONFLICT' ? 409 : 404, code, message)
  }
}

/**
 * Source `ipcApi.request(route, input)` routes the MCP settings subtree calls, in the
 * source `IpcResult` envelope (`{ ok: true, data }` / `{ ok: false, error }`) that the
 * renderer facade unwraps by THROWING on `ok:false` — so every failure here must use
 * the error branch; an `ok:true` on a failed connect would render as a live connection.
 *
 * Outputs follow `src/shared/ipc/schemas/mcp.ts` exactly: the `void` routes resolve to
 * `null` (nothing to render), `get_version` to `string | null`, and the prompts /
 * resources / logs reads to the raw protocol arrays the source consumes untyped
 * (`z.any()` in the source contract). Only routes with a real Grimoire service are
 * served; package upload, protocol install and DXT/npm flows answer with a typed
 * NOT_IMPLEMENTED error so the source's own error handling shows the gap.
 */
function ipcOk(data: unknown): Record<string, unknown> {
  return { ok: true, data }
}

function ipcError(code: string, message: string): Record<string, unknown> {
  return { ok: false, error: { code, message } }
}

// ── Chat stream link (source `ai.stream.*`) ──────────────────────────────────
// The source chat and agent pages open a turn through `ai.stream.open` and then consume
// `ai.stream.chunk|done|error`. Grimoire's turn already streams through AI_SESSION_EVENT
// deltas, so this layer owns only what the renderer needs to filter on — the execution
// identity — plus start/stop of the real turn. It deliberately fabricates no chunk events:
// the renderer bridge maps real Host deltas onto the protocol, so a lie here would be a
// lie the user sees.
type ChatStreamRecord = {
  topicId: string
  sessionId: string
  executionId: string
  attemptId: number
  anchorMessageId: string
  status: 'streaming' | 'success' | 'paused' | 'error'
  startedAt: number
  // Bounded replay so a reloaded/re-attached window can re-render the live turn instead of
  // staring at an empty message until the terminal row lands. Same shape the source expects
  // in `AiStreamAttachResponse.bufferedChunks`.
  chunks: Array<Record<string, unknown>>
  replayBytes: number
}
const chatStreams = new Map<string, ChatStreamRecord>()
const CHAT_STREAM_REPLAY_LIMIT = Object.freeze({ maxEvents: 512, maxBytes: 512 * 1024 })
let chatStreamAttempt = 0

function streamText(parts: unknown): string {
  if (!Array.isArray(parts)) return ''
  return parts
    .map(part => (part && typeof part === 'object' && typeof (part as Record<string, unknown>).text === 'string' ? String((part as Record<string, unknown>).text) : ''))
    .filter(Boolean)
    .join('\n')
    .trim()
}

function activeExecution(record: ChatStreamRecord) {
  return { executionId: record.executionId, attemptId: record.attemptId, anchorMessageId: record.anchorMessageId }
}

function handleApprovalRespond(input: unknown, sender: WebContents | null): Record<string, unknown> {
  if (!sender) return ipcError('OWNER_UNAVAILABLE', 'approval owner window is unavailable')
  const value = input && typeof input === 'object' ? input as Record<string, unknown> : {}
  const approvalId = typeof value.approvalId === 'string' ? value.approvalId : ''
  if (!approvalId) return ipcError('VALIDATION_ERROR', 'approvalId is required')
  const decision = value.approved === true ? 'allowOnce' as const : 'deny' as const
  // Two brokers own two session kinds; only one can recognise the id.
  const handled = decideAgentSessionPermission(sender, approvalId, decision) || decideAiSessionPermission(sender, approvalId, decision)
  return ipcOk({ ok: handled })
}

async function handleChatStreamRoute(route: string, input: unknown, sender: WebContents | null): Promise<Record<string, unknown> | null> {
  if (route === 'ai.tool.approval.respond') return handleApprovalRespond(input, sender)
  if (!route.startsWith('ai.stream.')) return null
  const value = input && typeof input === 'object' ? input as Record<string, unknown> : {}
  const topicId = typeof value.topicId === 'string' ? value.topicId : ''
  if (!topicId) return ipcError('VALIDATION_ERROR', 'topicId is required')
  if (route === 'ai.stream.attach') {
    const record = chatStreams.get(topicId)
    // A finished turn is read from SQLite by the renderer, not replayed from memory.
    if (!record || record.status !== 'streaming') return ipcOk({ status: 'not-found' })
    return ipcOk({ status: 'attached', bufferedChunks: record.chunks.slice() })
  }
  if (route === 'ai.stream.detach') return ipcOk(undefined)
  if (route === 'ai.stream.abort') {
    const record = chatStreams.get(topicId)
    if (!record || !sender) return ipcOk(undefined)
    const interrupted = await handleAiSessionInterrupt({ sender }, record.sessionId)
    if (interrupted) record.status = 'paused'
    return ipcOk(undefined)
  }
  if (route !== 'ai.stream.open') return null
  // Only a brand-new user turn is supported. Regenerate / steer / reserved-branch variants
  // would need anchor and branch semantics this adapter does not own yet; answering blocked
  // is honest and the source maps it to a user-visible reason instead of a silent no-op.
  if (value.trigger !== 'submit-message') return ipcOk({ mode: 'blocked', reason: 'paused' })
  if (!sender) return ipcError('OWNER_UNAVAILABLE', 'stream owner window is unavailable')
  const live = chatStreams.get(topicId)
  if (live && live.status === 'streaming') return ipcOk({ mode: 'injected', activeExecutions: [activeExecution(live)] })
  // Two session kinds share this route: Cherry chat topics map to `ai_sessions` via
  // `ai_topics`, while the agent page passes its agent-session id.
  const agentSession = getAgentSession(topicId)
  const sessionId = existingTopicSessionId(topicId) || (getAiSession(topicId) ? topicId : '') || (agentSession ? topicId : '')
  if (!sessionId) return ipcError('SESSION_NOT_FOUND', 'no Grimoire session backs topic ' + topicId)
  const isAgent = !!agentSession && sessionId === topicId && !getAiSession(topicId)
  const content = streamText(value.userMessageParts)
  if (!content) return ipcError('VALIDATION_ERROR', 'empty user message')
  const mentioned = Array.isArray(value.mentionedModelIds) ? value.mentionedModelIds.filter(item => typeof item === 'string') : []
  const executionId = mentioned.length ? String(mentioned[0]) : 'default'
  const record: ChatStreamRecord = {
    topicId,
    sessionId,
    executionId,
    attemptId: ++chatStreamAttempt,
    anchorMessageId: crypto.randomUUID(),
    status: 'streaming',
    startedAt: Date.now(),
    chunks: [],
    replayBytes: 0,
  }
  chatStreams.set(topicId, record)
  // Real runtime output is forwarded to the requesting window as the source protocol's
  // chunk sequence. Nothing is synthesized: a silent runtime produces no chunks.
  const textId = 'text-' + record.attemptId
  const reasoningId = 'reasoning-' + record.attemptId
  const base = { topicId, executionId, attemptId: record.attemptId, anchorMessageId: record.anchorMessageId }
  let textOpen = false
  let reasoningOpen = false
  const emit = (name: 'chunk' | 'done' | 'error', payload: Record<string, unknown>) => {
    if (name === 'chunk') {
      const size = Buffer.byteLength(JSON.stringify(payload), 'utf8')
      if (size <= CHAT_STREAM_REPLAY_LIMIT.maxBytes) {
        record.chunks.push(payload)
        record.replayBytes += size
        while (record.chunks.length > CHAT_STREAM_REPLAY_LIMIT.maxEvents || record.replayBytes > CHAT_STREAM_REPLAY_LIMIT.maxBytes) {
          const removed = record.chunks.shift()
          record.replayBytes -= removed ? Buffer.byteLength(JSON.stringify(removed), 'utf8') : 0
        }
      }
    }
    if (!sender.isDestroyed()) sender.send(IPC_CHANNELS.CHERRY_AI_STREAM_EVENT, { event: name, payload })
  }
  const hooks = {
    onTextDelta: (text: string) => {
      if (!text) return
      if (!textOpen) { textOpen = true; emit('chunk', { ...base, chunk: { type: 'text-start', id: textId } }) }
      emit('chunk', { ...base, chunk: { type: 'text-delta', id: textId, delta: text } })
    },
    onReasoningDelta: (text: string) => {
      if (!text) return
      if (!reasoningOpen) { reasoningOpen = true; emit('chunk', { ...base, chunk: { type: 'reasoning-start', id: reasoningId } }) }
      emit('chunk', { ...base, chunk: { type: 'reasoning-delta', id: reasoningId, delta: text } })
    },
    // The source renders approvals as a chunk part, not a separate channel: the card appears
    // inline in the live message and the click answers via `ai.tool.approval.respond`.
    onPermissionRequest: (requestId: string) => {
      emit('chunk', { ...base, chunk: { type: 'tool-approval-request', approvalId: requestId, toolCallId: requestId } })
    }
  }
  const closeText = () => {
    if (textOpen) emit('chunk', { ...base, chunk: { type: 'text-end', id: textId } })
    if (reasoningOpen) emit('chunk', { ...base, chunk: { type: 'reasoning-end', id: reasoningId } })
    textOpen = false
    reasoningOpen = false
  }
  // Fire-and-forget: the turn runs in the shared executor; this promise only reports the
  // terminal fact to the window and updates the registry.
  const startSend = isAgent
    ? () => handleAgentSessionSend({ sender }, { sessionId, content }, hooks)
    : () => handleAiSessionSend({ sender }, { sessionId, content, modelId: executionId === 'default' ? undefined : executionId }, hooks)
  void startSend()
    .then(result => {
      const interrupted = result && result.session && result.session.status === 'interrupted'
      const status = interrupted ? 'paused' : 'success'
      const current = chatStreams.get(topicId)
      if (current && current.attemptId === record.attemptId) current.status = status
      closeText()
      emit('done', { ...base, status, isTopicDone: true })
    })
    .catch(error => {
      const current = chatStreams.get(topicId)
      if (current && current.attemptId === record.attemptId) current.status = 'error'
      closeText()
      emit('error', { ...base, isTopicDone: true, error: { message: error instanceof Error ? error.message : String(error) } })
    })
  // `sessionId` is an additive field for the compat stream bridge (the source type does not
  // declare it and ignores it); it lets the renderer map session events back to a topic.
  return ipcOk({ mode: 'started', activeExecutions: [activeExecution(record)], reservedMessages: [], sessionId })
}
async function handleIpcApiRoute(route: string, input: unknown, sender: WebContents | null = null): Promise<Record<string, unknown>> {
  const value = input && typeof input === 'object' ? input as Record<string, unknown> : {}
  const id = typeof value.serverId === 'string' ? value.serverId : typeof value.id === 'string' ? value.id : ''
  try {
    const windowResult = handleCherryWindowRequest(route, input, sender)
    if (windowResult) return { ...windowResult }
    const navigationResult = handleCherryNavigationRequest(route, input, sender)
    if (navigationResult) return { ...(await navigationResult) }
    if (route.startsWith('file.tree.')) return handleCherryFileTreeRoute(route, input, sender)
    const streamResult = await handleChatStreamRoute(route, input, sender)
    if (streamResult) return streamResult
    if (route === 'ai.agent.session.prewarm' || route === 'ai.agent.session.close_warm') {
      if (!sender) return { ok: false, error: { code: 'AGENT_PREWARM_UNAVAILABLE', message: 'Agent session owner window is unavailable', data: { code: 'OWNER_UNAVAILABLE' } } }
      const sessionId = typeof value.sessionId === 'string' ? value.sessionId : ''
      if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(value).some(key => key !== 'sessionId') || !sessionId || /[\u0000-\u001f\u007f]/.test(sessionId)) return ipcError('VALIDATION_ERROR', 'Expected { sessionId: nonempty string }')
      if (route === 'ai.agent.session.prewarm') {
        await agentSessionPrewarmService.prewarm(sessionId, sender)
      } else {
        await agentSessionPrewarmService.release(sessionId, sender)
      }
      return ipcOk(null)
    }
    if (route === 'ai.agent.session.reuse_or_create') {
      const command = blueprintValidation.object(input, 'reuse command')
      // Service enforces exact source keys/target/exclusion in one write transaction.
      // Conservative host deviation: only idle empty placeholders are eligible and
      // system duplicate purge refuses any event/reference ambiguity; no prewarm.
      const before = new Map((getDatabase().exec('SELECT id,last_activity_at,updated_at FROM agent_session_read_model')[0]?.values ?? [])
        .map(row => [String(row[0]), [String(row[1]), String(row[2])]]))
      const result = reuseOrCreateAgentSessionReadModel(command as unknown as ReuseOrCreateAgentSessionReadModel)
      const previous = before.get(result.session.id)
      const touched = previous && (previous[0] !== result.session.lastActivityAt || previous[1] !== result.session.updatedAt)
      if (result.created || result.deletedDuplicateSessionIds.length || touched) {
        notifySessionChange(result.session.id, result.created || result.deletedDuplicateSessionIds.length ? 'membership' : 'projection', result.deletedDuplicateSessionIds)
      }
      return ipcOk({ session: sourceSessionDto(result.session), created: result.created, deletedDuplicateSessionIds: result.deletedDuplicateSessionIds })
    }
    if (route === 'ai.agent.create') {
      const agent = createSourceAgent(input)
      const projected = sourceAgentFromBlueprint(agent)
      notifyAgentPatch(agent.id, true)
      return ipcOk(projected)
    }
    // ── System routes the theme layer reads ────────────────────────────────────
    if (route === 'system.get_native_theme') {
      // Source `systemHandlers['system.get_native_theme']`: report the OS colour scheme
      // as the source `ThemeMode` union. Resolved per call (not cached here) because
      // Electron tracks OS changes itself; `nativeTheme.updated` drives the push half
      // (see `registerCherryDataApiIPC`).
      return ipcOk(nativeTheme.shouldUseDarkColors ? 'dark' : 'light')
    }
    // ── Shell routes reused by the settings pages ──────────────────────────────
    if (route === 'system.shell.open_path') {
      // Reveal in the OS file manager — the same behaviour (and the same validation)
      // as Grimoire's own `system:showItemInFolder`.
      const target = typeof input === 'string' ? input : ''
      if (!target.trim()) return ipcError('INVALID_PATH', '文件路径无效')
      const resolved = path.resolve(target)
      if (!fs.existsSync(resolved)) return ipcError('NOT_FOUND', '文件不存在：' + resolved)
      shell.showItemInFolder(resolved)
      return ipcOk(null)
    }
    if (route === 'system.shell.open_website' || route === 'system.shell.open_external_website') {
      // Same http/https-only gate as Grimoire's `system:openExternal`: a non-web scheme
      // is rejected rather than handed to the OS.
      const target = typeof input === 'string' ? input : ''
      if (!/^https?:\/\//i.test(target)) return ipcError('INVALID_URL', '仅允许打开 HTTP 或 HTTPS 地址')
      await shell.openExternal(target)
      return ipcOk(null)
    }

    // ── Appearance-settings routes ─────────────────────────────────────────────
    if (route === 'system.get_fonts') {
      // Real enumeration through the same `font-list` package and version the source
      // main process uses (see `system-fonts.service.ts`), normalized identically
      // (strip wrapping quotes, drop empties) and degrading to `[]` on failure exactly
      // as the source handler does. Memoized in the service because the Windows path
      // spawns PowerShell and the appearance page requests fonts on every mount.
      return ipcOk(await listSystemFonts())
    }
    // ── Data-settings routes ───────────────────────────────────────────────────
    if (route === 'app.get_info') {
      // Source `app.get_info`: paths + version + arch the data settings page renders.
      // Every field maps onto a real Grimoire location; none is invented.
      const userData = app.getPath('userData')
      return ipcOk({
        version: app.getVersion(),
        isPackaged: app.isPackaged,
        appPath: app.getAppPath(),
        homePath: app.getPath('home'),
        // No notes feature in Grimoire, so the notes path is the user data root rather
        // than a directory that does not exist.
        notesPath: userData,
        configPath: userData,
        appDataPath: userData,
        resourcesPath: process.resourcesPath,
        logsPath: path.dirname(getActiveLogPath()),
        arch: process.arch,
        isPortable: process.platform === 'win32' && 'PORTABLE_EXECUTABLE_DIR' in process.env,
        installPath: path.dirname(app.getPath('exe'))
      })
    }
    // Reads back the OS-level state behind the `/settings/general` switches.
    //
    // Distinct from reading the stored preference: a preference can say `true` while the OS
    // login item is absent (a failed registration, or one removed outside the app). The page
    // needs the ACTUAL state to avoid showing an effective-looking toggle that does nothing,
    // and the probe uses it to verify the consumers ran rather than trusting the handler's
    // return value.
    if (route === 'app.preferences.read') {
      const name = typeof value.name === 'string' ? value.name : ''
      if (name === 'launch_on_boot') return ipcOk(readLaunchOnBoot())
      if (name === 'prevent_sleep') return ipcOk({ active: isPreventSleepActive() })
      return ipcError('INVALID_INPUT', '未知的偏好读取名：' + name)
    }
    if (route === 'app.cache_cleanup.inspect' || route === 'app.cache_cleanup.run') {
      const { CACHE_CLEANUP_GROUPS, inspectGroup, normalizeCleanupGroups, runGroup } = await import('../services/cache-cleanup.service')
      const groups = normalizeCleanupGroups(value.groups)
      // The source schema requires at least one group; an empty list is a caller bug and
      // answering with an empty result set would hide it.
      if (!groups.length) return ipcError('INVALID_INPUT', '缓存清理分组无效：' + JSON.stringify(value.groups ?? null) + '（可选值：' + CACHE_CLEANUP_GROUPS.join(', ') + '）')
      if (route === 'app.cache_cleanup.inspect') {
        return ipcOk({ results: groups.map(group => ({ group, size: inspectGroup(group) })) })
      }
      return ipcOk({ results: groups.map(group => ({ group, status: runGroup(group) })) })
    }
    if (route === 'app.data_reset.request' || route === 'app.migration_v2.rerun') {
      // NOT IMPLEMENTED, deliberately and permanently for this surface.
      //
      // The source `app.data_reset.request` stages a marker that DELETES THE ENTIRE
      // USER-DATA DIRECTORY on next boot (`dataReset.ts` → `stageDataReset('full_reset')`):
      // every session, message, asset, tag, canvas project, provider config and stored
      // credential. The source UI asks for ONE in-app confirm dialog, which is a
      // reasonable guard in an app whose data it owns outright — and an unacceptable one
      // to expose from a compatibility window running beside Grimoire's own workspace.
      //
      // It fails loudly rather than answering `void` (a silent no-op would leave the UI
      // reporting a reset that never happens) and rather than staging anything. A real
      // reset belongs behind Grimoire's own destructive-action flow, not this bridge.
      return ipcError(
        'NOT_IMPLEMENTED',
        '数据重置未接入：该路由会清空整个用户数据目录（会话/素材/标签/画布/供应商配置与密钥）。' +
        '兼容窗口不提供此入口；如需重置请使用 Grimoire 自身的数据管理流程。'
      )
    }
    if (route === 'system.file.select_folder') {
      // Source `window.api.file.selectFolder`. A real native picker — the same
      // `dialog.showOpenDialog` Grimoire's own import/export flows use. Only the
      // directory property is honoured; a caller asking for something this window cannot
      // grant (multiple selection, files) is rejected rather than silently downgraded.
      const properties = Array.isArray(value.properties) ? value.properties.map(String) : []
      const unsupported = properties.filter(property => property !== 'openDirectory' && property !== 'createDirectory')
      if (unsupported.length) {
        return ipcError('INVALID_INPUT', '不支持的选择器属性：' + unsupported.join(', '))
      }
      const result = await dialog.showOpenDialog({
        title: typeof value.title === 'string' ? value.title : undefined,
        properties: ['openDirectory', 'createDirectory']
      })
      if (result.canceled || !result.filePaths.length) return ipcOk(null)
      return ipcOk(result.filePaths[0])
    }
    // Source `App_ResolvePath` / `App_IsPathInside` / `App_HasWritePermission`. These
    // back the three `window.api.*` path helpers the data-settings backup panels call;
    // the semantics (including equality-true containment) live in cherry-path.service.
    if (route === 'system.path.resolve') {
      if (typeof value.path !== 'string' || !value.path) {
        return ipcError('INVALID_INPUT', 'resolve 需要一个非空路径字符串')
      }
      return ipcOk(resolveUserPath(value.path))
    }
    if (route === 'system.path.is_inside') {
      const child = typeof value.child === 'string' ? value.child : ''
      const parent = typeof value.parent === 'string' ? value.parent : ''
      if (!child || !parent) {
        return ipcError('INVALID_INPUT', 'is_inside 需要 child 与 parent 两个非空路径')
      }
      return ipcOk(isPathInside(child, parent))
    }
    if (route === 'system.path.has_write_permission') {
      if (typeof value.path !== 'string' || !value.path) {
        return ipcError('INVALID_INPUT', 'has_write_permission 需要一个非空路径字符串')
      }
      return ipcOk(await hasWritePermission(value.path))
    }
    if (route === 'system.toggle_dev_tools') {
      // Source `system.toggle_dev_tools` toggles devtools on the CALLING window
      // (`WindowManager.getWindow(senderId)`). The sender is used rather than a focused
      // window so a settings page toggles its own devtools, matching upstream.
      const target = sender ? BrowserWindow.fromWebContents(sender) : null
      target?.webContents.toggleDevTools()
      return ipcOk(undefined)
    }
    if (route === 'app.updater.release_notes.get') {
      // Refused for the same reason as `check_for_update`: the source serves release notes from
      // its update channel, and Grimoire has none. Answering an empty list would render as
      // "this version has no release notes", which is a claim about the release rather than a
      // statement about this app's capabilities.
      return ipcError(
        'NOT_IMPLEMENTED',
        '更新日志未接入：源的更新日志来自其更新通道，Grimoire 没有更新通道；返回空列表会显示成"该版本没有更新日志"。'
      )
    }
    if (route === 'app.updater.check_for_update') {
      // Refused, not faked. The source route returns `void` and the page is driven entirely
      // by push events (`app.updater.available` / `not_available` / `error`); answering
      // `ok` with nothing behind it would leave the About page's update row spinning
      // forever, which is the fake-success shape this migration forbids. Grimoire has no
      // update channel wired.
      return ipcError(
        'NOT_IMPLEMENTED',
        '自动更新检查未接入：Cherry 的 About 页由 app.updater.* 推送事件驱动，Grimoire 没有更新通道，返回 ok 会让更新状态永远停留在检查中。'
      )
    }
    if (route === 'app.user_data_relocation.inspect' || route === 'app.user_data_relocation.request') {
      // Not implemented: relocating the user-data directory is a boot-time operation that
      // must move the live database and re-point every store. Grimoire has no such flow,
      // and a half-implementation would leave the app unable to find its own data.
      return ipcError(
        'NOT_IMPLEMENTED',
        '用户数据目录迁移未接入：该操作需要在启动阶段移动数据库并重定向全部存储，Grimoire 尚无可用的迁移流程。'
      )
    }
    // ── Obsidian export target discovery ───────────────────────────────────────
    if (route === 'export.obsidian.get_vaults' || route === 'export.obsidian.get_files') {
      // Reads Obsidian's OWN vault registry (see `obsidian-vault.service.ts`) rather than
      // asking the user for a folder, so the dialog offers exactly what Obsidian knows.
      const { listObsidianVaults, listObsidianVaultEntries } = await import('../services/obsidian-vault.service')
      if (route === 'export.obsidian.get_vaults') return ipcOk(listObsidianVaults())
      const vaultName = typeof value.vaultName === 'string' ? value.vaultName : ''
      if (!vaultName) return ipcError('INVALID_INPUT', '缺少 vaultName')
      return ipcOk(listObsidianVaultEntries(vaultName))
    }
    // ── Binary tool registry (dependencies settings) ───────────────────────────
    if (route === 'binary.get_tool_snapshots') {
      // Real detection from the mechanism Grimoire has (bundled root, then PATH). The
      // page's resolution uses this; nothing here is fabricated.
      const { getBinaryToolSnapshots } = await import('../services/binary-tools.service')
      return ipcOk(getBinaryToolSnapshots(value))
    }
    if (route === 'binary.install_tool' || route === 'binary.add_custom_tool' || route === 'binary.remove_tool') {
      // REFUSED: these download, install and uninstall external binaries through the
      // source's `mise` backend. Grimoire's recorded policy is
      // `local-only-no-silent-download` (`resources/agent-runtimes/runtime-manifest.json`)
      // — runtimes and tools are prepared locally and checksum-recorded, never fetched by
      // the app. Implementing an installer here would contradict that policy and put an
      // unreviewed network install behind a compatibility window.
      //
      // It fails loudly rather than resolving, so the UI cannot report a completed
      // install or a removed tool that never happened.
      return ipcError(
        'NOT_IMPLEMENTED',
        '工具安装/卸载未接入：Grimoire 采用「仅本地、不静默下载」策略（resources/agent-runtimes/runtime-manifest.json），' +
        '不通过应用下载或安装外部二进制。可用性检测已可用；如需准备工具请按该策略在本地放置。'
      )
    }
    if (route === 'binary.search_registry' || route === 'binary.get_latest_versions') {
      // Both query the package registry for versions to install. With installation
      // refused there is nothing to install, and returning version numbers would invite
      // install actions that cannot work. Refused rather than answered with empty data,
      // which would render as "no versions available" — a different, unverified claim.
      return ipcError(
        'NOT_IMPLEMENTED',
        '工具注册表查询未接入：Grimoire 不从应用内下载或安装外部二进制，因此不查询可安装版本。'
      )
    }
    if (route === 'app.adjust_zoom') {
      // Source `handleZoomFactor` semantics: `reset` sets 1, `delta: 0` is a pure read,
      // and a delta moves the factor only while it stays inside [0.5, 2.0].
      const stored = readCherryPreference('app.zoom_factor')
      const current = typeof stored === 'number' ? stored : 1
      const reset = value.reset === true
      const delta = Number(value.delta || 0)
      const next = reset ? 1 : Number((current + delta).toFixed(1))
      if (reset || (delta !== 0 && next >= 0.5 && next <= 2.0)) {
        for (const window of BrowserWindow.getAllWindows()) {
          if (!window.isDestroyed()) window.webContents.setZoomFactor(next)
        }
        writeCherryPreference('app.zoom_factor', next)
        return ipcOk(next)
      }
      return ipcOk(current)
    }

    const mcp = () => import('../services/mcp.service')
    // `connectMcpServer` throws (not returns) for an unknown id, so existence is
    // checked here to answer NOT_FOUND instead of a generic INTERNAL.
    const mcpServerExists = (serverId: string): boolean => {
      if (!serverId) return false
      return listMcpServers().some(server => server.id === serverId)
    }

    if (route === 'mcp.server.refresh_tools') {
      // `connectMcpServer` reports failure as a `failed` status record (it does not throw),
      // and the source route's output is `z.void()` with the card reading the refreshed
      // list from the server query afterwards — so an established failure must reject,
      // never resolve, or the source would show a connect that did not happen.
      const { connectMcpServer } = await mcp()
      if (!mcpServerExists(id)) return ipcError('NOT_FOUND', 'MCP Server 不存在')
      const server = await connectMcpServer(id)
      if (server.status === 'failed') return ipcError('MCP_CONNECT_FAILED', server.error_message || 'MCP Server 连接失败')
      return ipcOk(null)
    }
    if (route === 'mcp.server.stop') {
      const { disconnectMcpServer } = await mcp()
      if (!mcpServerExists(id)) return ipcError('NOT_FOUND', 'MCP Server 不存在')
      disconnectMcpServer(id)
      return ipcOk(null)
    }
    if (route === 'mcp.server.remove') {
      const { deleteMcpServer } = await mcp()
      if (!mcpServerExists(id)) return ipcError('NOT_FOUND', 'MCP Server 不存在')
      deleteMcpServer(id)
      return ipcOk(null)
    }
    if (route === 'mcp.server.restart') {
      // Source calls restart after an update while the server is active: stop, then
      // reconnect. A failed reconnect rejects like connect does.
      const { disconnectMcpServer, connectMcpServer } = await mcp()
      if (!mcpServerExists(id)) return ipcError('NOT_FOUND', 'MCP Server 不存在')
      disconnectMcpServer(id)
      const server = await connectMcpServer(id)
      if (server.status === 'failed') return ipcError('MCP_CONNECT_FAILED', server.error_message || 'MCP Server 重连失败')
      return ipcOk(null)
    }
    if (route === 'mcp.server.check_connectivity') {
      // Used after add/import to decide whether to flip `isActive`; a real probe only.
      const { connectMcpServer, disconnectMcpServer } = await mcp()
      if (!mcpServerExists(id)) return ipcOk(false)
      const server = await connectMcpServer(id)
      const connected = server.status === 'connected'
      if (!connected) disconnectMcpServer(id)
      return ipcOk(connected)
    }
    if (route === 'mcp.server.get_version') {
      // Grimoire does not version MCP servers; `null` is the source contract's
      // "unknown version" value, not a fabricated one.
      return ipcOk(null)
    }
    if (route === 'mcp.server.list_prompts' || route === 'mcp.server.list_resources') {
      // The Grimoire MCP service exposes tools, not prompts/resources. `[]` is the
      // empty protocol result the source renderers already handle, not fake data.
      return ipcOk([])
    }
    if (route === 'mcp.server.get_logs') {
      return ipcOk([])
    }
    // ── File routes (Files page) ──────────────────────────────────────────────
    // Every one of these touches the filesystem or mutates a file, which is why the source keeps
    // them on File IPC rather than DataApi; the same split applies here.
    if (route === 'file.batch_get_metadata') {
      const items = Array.isArray(value.items) ? value.items as never[] : []
      return ipcOk(batchGetMetadata(items))
    }
    if (route === 'file.batch_get_physical_paths') {
      return ipcOk(batchGetPhysicalPaths(Array.isArray(value.ids) ? value.ids.map(String) : []))
    }
    if (route === 'file.batch_get_dangling_states') {
      return ipcOk(batchGetDanglingStates(Array.isArray(value.ids) ? value.ids.map(String) : []))
    }
    if (route === 'file.batch_create_internal_entries') {
      const items = Array.isArray(value.items) ? value.items as never[] : []
      return ipcOk(await batchCreateInternalEntries(items))
    }
    if (route === 'file.batch_remove_from_library') {
      return ipcOk(batchRemoveFromLibrary(Array.isArray(value.ids) ? value.ids.map(String) : []))
    }
    if (route === 'file.rename') {
      // `{ id, newName }` per the source `fileRequestSchemas`.
      const targetId = typeof value.id === 'string' ? value.id : ''
      const newName = typeof value.newName === 'string' ? value.newName : ''
      const renamed = await renameEntry(targetId, newName)
      // A refusal is an ERROR, not an `ok:true` with a flag: the source facade unwraps `ok:true`
      // as success, so reporting a rejected rename as success would show the new name while the
      // file kept the old one.
      return renamed.ok ? ipcOk(null) : ipcError('INVALID', renamed.error)
    }
    if (route === 'file.show_in_folder') {
      // `createFileEntryHandle(id)` → `{ kind: 'entry', entryId }`.
      const handle = value.handle && typeof value.handle === 'object' ? value.handle as Record<string, unknown> : {}
      const entryId = typeof handle.entryId === 'string' ? handle.entryId : ''
      const target = entryId ? resolveEntryPath(entryId) : ''
      if (!target || !fs.existsSync(target)) return ipcError('NOT_FOUND', '文件不存在：' + entryId)
      shell.showItemInFolder(path.resolve(target))
      return ipcOk(null)
    }
    if (route === 'file.batch_trash' || route === 'file.batch_restore' || route === 'file.batch_permanent_delete_from_trash') {
      // Grimoire has NO file trash. These three are refused together rather than half-implemented:
      // the source UI offers 恢复 and 永久删除 on trashed rows, so moving files into a state the
      // app cannot list or restore would strand them while looking like it worked.
      return ipcError('NOT_IMPLEMENTED', '文件回收站尚未实现：Grimoire 没有文件恢复流程，拒绝把文件移入不可恢复的状态')
    }
    return ipcError('NOT_IMPLEMENTED', 'ipcApi 路由未桥接：' + route)
  } catch (error) {
    if (error instanceof AgentPrewarmUnavailableError) {
      return { ok: false, error: { code: 'AGENT_PREWARM_UNAVAILABLE', message: error.message, data: { code: error.code, ...error.diagnostic } } }
    }
    const message = error instanceof Error ? error.message : String(error)
    if (message === 'AGENT_SESSION_READ_MODEL_UNSAFE_PLACEHOLDER_PURGE') return ipcError('AGENT_SESSION_READ_MODEL_UNSAFE_PLACEHOLDER_PURGE', 'Placeholder cleanup has unresolved history or workspace references; no rows were removed')
    if (message === 'AGENT_SESSION_READ_MODEL_AGENT_NOT_FOUND' || message === 'AGENT_SESSION_READ_MODEL_NOT_FOUND' || message === 'AGENT_WORKSPACE_NOT_FOUND') return ipcError('NOT_FOUND', 'Agent session owner or workspace 不存在')
    if (message.startsWith('AGENT_SESSION_READ_MODEL_') || message.startsWith('AGENT_WORKSPACE_')) return ipcError('VALIDATION_ERROR', message)
    if (message.startsWith('AGENT_SOURCE_RUNTIME_UNAVAILABLE')) return ipcError('AGENT_SOURCE_RUNTIME_UNAVAILABLE', 'Requested source AgentType has no supported registered runtime')
    if (message.startsWith('AGENT_SOURCE_FIELD_UNSUPPORTED')) return ipcError('AGENT_SOURCE_FIELD_UNSUPPORTED', message)
    if (message.startsWith('AGENT_BLUEPRINT_')) return ipcError('VALIDATION_ERROR', message)
    return ipcError('INTERNAL', message)
  }
}

export function registerCherryDataApiIPC(allowedShellDocuments: readonly string[] = []): void {
  ipcMain.handle(IPC_CHANNELS.CHERRY_DATA_API_REQUEST, async (_event, request: unknown) => {
    const value = request && typeof request === 'object' ? request as DataApiRequest : {}
    return handleRequest(value)
  })
  // Source `window.api.application.relaunch` (settings pages call it after a change
  // that needs a fresh process). Grimoire reloads the windows instead of restarting
  // the process, which would also terminate unrelated windows and in-flight work.
  ipcMain.handle(IPC_CHANNELS.CHERRY_APP_RELAUNCH, () => {
    for (const window of BrowserWindow.getAllWindows()) {
      if (!window.isDestroyed()) window.webContents.reload()
    }
    return true
  })
  ipcMain.handle(IPC_CHANNELS.CHERRY_IPC_API_REQUEST, async (event, payload: unknown) => {
    const value = payload && typeof payload === 'object' ? payload as Record<string, unknown> : {}
    const route = String(value.route || '')
    if ((route.startsWith('navigation.') || route.startsWith('window.') || route.startsWith('file.tree.')) && !isTrustedCherryMainFrame(event, {
      isRegisteredSender: isRegisteredCherryNavigationSender,
      allowedDocumentPaths: allowedShellDocuments
    })) return ipcError('INVALID_SENDER', 'Cherry shell operation requires its registered trusted main frame')
    return handleIpcApiRoute(route, value.input, event.sender)
  })
  // Source `mcp.tool.call_progress` push event (broadcast to the main window by the
  // source `McpRuntimeService`). The MCP service owns the notification stream; this
  // forwards each progress event to every open window so the mounted source
  // `MessageMcpTool` can drive its progress ring. Payload is the source
  // `McpProgressEvent` shape: `{ callId, progress }` with progress in 0–1.
  onMcpToolProgress(event => {
    for (const window of BrowserWindow.getAllWindows()) {
      if (!window.isDestroyed()) window.webContents.send(IPC_CHANNELS.CHERRY_MCP_TOOL_PROGRESS, event)
    }
  })
  // Source `system.native_theme_updated`: `ThemeService` broadcasts the freshly resolved
  // ThemeMode whenever the OS scheme changes, and the source `ThemeProvider` subscribes
  // so a "follow system" window re-renders without a reload. Electron's own
  // `nativeTheme.updated` is the equivalent signal.
  nativeTheme.on('updated', () => {
    const theme = nativeTheme.shouldUseDarkColors ? 'dark' : 'light'
    for (const window of BrowserWindow.getAllWindows()) {
      if (!window.isDestroyed()) window.webContents.send(IPC_CHANNELS.CHERRY_NATIVE_THEME_UPDATED, theme)
    }
  })
}

/** Re-exported for the transport tests; not part of the IPC surface. */
export const __test = { sourceProviderFromRow, sourceMcpServerFromRecord, handleRequest, handleIpcApiRoute, assetIdFromUnionAlias, sourcePromptFromAsset, resolveAssetRowId, assetIdCandidates }

/** Reads one Grimoire provider row as the source shape (used by tests and future routes). */
export function projectGrimoireProvider(provider: Provider): Record<string, unknown> {
  return {
    id: provider.id,
    name: provider.name,
    authType: provider.access_mode === 'login' ? 'oauth' : 'api-key',
    reportsActualCost: false,
    apiKeys: provider.has_api_key ? [{ id: 'stored', key: SECRET_PLACEHOLDER, isEnabled: true, label: '' }] : [],
    isEnabled: provider.is_active || Boolean(provider.base_url),
    // Keyed by the reported `defaultChatEndpoint` (see `sourceProviderFromRow`).
    endpointConfigs: provider.base_url
      ? { [provider.protocol === 'responses' ? 'openai-response' : 'openai']: { baseUrl: provider.base_url } }
      : {},
    defaultChatEndpoint: provider.protocol === 'responses' ? 'openai-response' : 'openai',
    settings: { defaultModel: provider.default_model, contextSize: provider.context_size },
    models: provider.models.map(model => ({ id: model, name: model }))
  }
}
