import { useCallback, useEffect, useMemo, useState, Suspense, lazy } from 'react'
import { CompatOutletProvider } from './shims/tanstack-router'
import type { AiAssistantRecord, AiSessionRecord, AiTopicRecord } from '../../../../shared/ai-types'
import { ChatAppShell } from '../../source/src/renderer/components/chat/shell/ChatAppShell'
import { useLanguageSync } from '../../source/src/renderer/hooks/useLanguageSync'
import { showRecycleBinUndo } from '../../source/src/renderer/services/recycleBinFeedback'
import { toast } from '../../source/src/renderer/services/toast'
import { CommandProvider } from '../../source/src/renderer/components/command'
import { CommandContextKeyProvider } from '../../source/src/renderer/components/command/CommandContextKeyProvider'
import { CodeStyleProvider } from '../../source/src/renderer/components/CodeStyleProvider'
import { ThemeProvider } from '../../source/src/renderer/components/ThemeProvider'
import PopupHost from '../../source/src/renderer/components/PopupHost/PopupHost'
import ToastHost from '../../source/src/renderer/components/ToastHost'
import { QuickPanelProvider } from '../../source/src/renderer/components/QuickPanel'
import { ComposerToolRuntimeProvider } from '../../source/src/renderer/components/composer/ComposerToolRuntime'
import MessageList from '../../source/src/renderer/components/chat/messages/MessageList'
// The source's own markdown conversion and network exporters. Reused rather than
// reimplemented: their chain (renderer-side fetch + compat preference config) was verified
// end to end, and a second implementation would drift from the source's formatting.
import {
  exportMarkdownToJoplin,
  exportMarkdownToSiyuan,
  exportMarkdownToYuque,
  messageToMarkdown,
  messageToMarkdownWithReasoning,
  messagesToMarkdown
} from '../../source/src/renderer/services/ExportService'
import { saveMarkdownExport } from './markdown-save'
import { CompatMessageListProvider } from './CompatMessageListProvider'
import { CompatRemainingSettings } from './CompatRemainingSettings'
import { CompatSourceSettings, isCompatSourceSettingsRoute } from './CompatSourceSettings'
import { getSettingsDiagnostic } from './settings-route-descriptors'
import { ModelSelector } from '../../source/src/renderer/components/ModelSelector'
import ComposerSurface from '../../source/src/renderer/components/composer/ComposerSurface'
import { CompatAssistantTopicRail } from './CompatAssistantTopicRail'
import { CompatProviderMcpPanel } from './CompatProviderMcpPanel'

// Lazy so the source settings subtree (and its DataApi/SWR closure) stays out of the
// chat bundle path until the settings route is actually opened.
const ProviderSettingsPage = lazy(() => import('../../source/src/renderer/pages/settings/ProviderSettings/ProviderSettingsPage'))
const SettingsPageLayout = lazy(() => import('../../source/src/renderer/pages/settings/SettingsPage'))
const SettingsSearchResults = lazy(() => import('../../source/src/renderer/pages/settings/settingsSearch/SearchResultsPage').then(module => ({ default: module.SearchResultsPage })))
const ProcessingSettings = lazy(() => import('./CompatProcessingSettings').then(module => ({ default: module.CompatProcessingSettings })))
const LocalModelsSettings = lazy(() => import('./CompatLocalModelsSettings').then(module => ({ default: module.CompatLocalModelsSettings })))
const McpSettingsLayout = lazy(() => import('../../source/src/renderer/pages/settings/McpSettings/McpSettingsPage'))
const McpServersList = lazy(() => import('../../source/src/renderer/pages/settings/McpSettings/McpServersList'))
const McpServerDetail = lazy(() => import('../../source/src/renderer/pages/settings/McpSettings/McpSettings'))
const BuiltinMcpServerList = lazy(() => import('../../source/src/renderer/pages/settings/McpSettings/BuiltinMcpServerList'))
const McpMarketList = lazy(() => import('../../source/src/renderer/pages/settings/McpSettings/McpMarketList'))
const NpxSearch = lazy(() => import('../../source/src/renderer/pages/settings/McpSettings/NpxSearch'))
const McpInstallDependencies = lazy(() => import('../../source/src/renderer/pages/settings/DependenciesSettings/EnvironmentDependencies'))
const CompatModelSettings = lazy(() => import('./CompatModelSettings').then(module => ({ default: module.CompatModelSettings })))
const AppearanceSettings = lazy(() => import('../../source/src/renderer/pages/settings/AppearanceSettings').then(module => ({ default: module.AppearanceSettings })))
const DataSettings = lazy(() => import('../../source/src/renderer/pages/settings/DataSettings/DataSettings'))
const EnvironmentDependencies = lazy(() => import('../../source/src/renderer/pages/settings/DependenciesSettings/EnvironmentDependencies'))
const NotificationSettings = lazy(() => import('../../source/src/renderer/pages/settings/NotificationSettings/NotificationSettings'))
const AboutSettings = lazy(() => import('../../source/src/renderer/pages/settings/AboutSettings/AboutSettings'))
const PromptSettings = lazy(() => import('../../source/src/renderer/pages/settings/PromptSettings').then(module => ({ default: module.PromptSettings })))
const UsageSettings = lazy(() => import('../../source/src/renderer/pages/settings/UsageSettings').then(module => ({ default: module.UsageSettings })))
const ShortcutSettings = lazy(() => import('../../source/src/renderer/pages/settings/ShortcutSettings'))
const ArchiveSettings = lazy(() => import('../../source/src/renderer/pages/settings/ArchiveSettings/ArchiveSettings'))
// Registered because the About page's 更新日志 action navigates here (`useOpenReleaseNotes`
// shim). Without it that click landed on the "route not implemented" fallback — a dangling
// navigation the shim introduced.
const ReleaseNotesPage = lazy(() => import('../../source/src/renderer/pages/releaseNotes/ReleaseNotesPage'))
// App-domain pages. Each was verified to IMPORT and RENDER (with the shell's real provider
// chain and a complete `window.api` surface) before being registered here — a registration
// without that check is how a route audit ends up reporting a page that paints nothing.
// `mini-app` is deliberately absent: it is tab-hosted in the source (`MiniAppsPage` calls
// `useTabs().openTab('/app/mini-app/<id>')`; `MiniAppPage` reads its id from route params,
// but still depends on tab identity/activity). Compat has no tab shell — see C4.
const LaunchpadPage = lazy(() => import('../../source/src/renderer/pages/launchpad/LaunchpadPage'))
// NAMED export (the source route file imports `{ BrowserPage }`), unlike the other pages here.
// The source route also validates `?url=` through `normalizeBrowserEntryUrl` before passing it
// as `initialUrl`; the compat registry has no search-param validation, so the same normalizer is
// applied at the call site rather than the raw value being handed to the page.
const BrowserPage = lazy(() => import('./CompatBrowserPage'))
const KnowledgePage = lazy(() => import('./CompatKnowledgePage'))
const NotesPage = lazy(() => import('../../source/src/renderer/pages/notes/NotesPage'))
const CodeCliPage = lazy(() => import('../../source/src/renderer/pages/code/CodeCliPage'))
const TranslatePage = lazy(() => import('../../source/src/renderer/pages/translate/TranslatePage'))
const PaintingPage = lazy(() => import('../../source/src/renderer/pages/paintings/PaintingPage'))
// Mounted with its data gap VISIBLE. `/files/entries` and `/files/entries/stats` are not bridged,
// so the page's own error state renders rather than an empty library that would read as "you have
// no files". The launchpad's 文件 tile navigates here, so it must not be 路由未实现.
const FilesPage = lazy(() => import('../../source/src/renderer/pages/files/FilesPage'))
const FilePreviewPage = lazy(() => import('./CompatFilePreviewPage'))
// The source GeneralSettings page is NOT mounted: its controls (tray, launch-on-boot,
// hardware acceleration, proxy, prevent-sleep, retry policy, context management) each
// promise a main-process behaviour Grimoire does not implement, so mounting it would
// render working-looking switches whose effects never happen. Blocked until those
// services exist; see MIGRATION_MATRIX.md.
import { CompatSessionResourceList } from './CompatSessionResourceList'
import { permissionToApprovalPart, readParts, toSourcePart } from './part-projection'
import { approvalIdFromInput, decisionForApproval, isToolAutoApproved, parseMcpToolIdentity, withoutToolFromDenylist } from './permission-actions'
import { applyTurnEvent, liveTurnHasContent, liveTurnParts, type LiveTurn } from './live-turn'
import { pickResourceReplacement } from './resource-replacement'
import {
  COMPAT_APP_ROUTE_IDS,
  COMPAT_BLOCKED_NOTES,
  COMPAT_ROUTE_PATHS,
  COMPAT_SUPPORTED_PATHS,
  DEFAULT_COMPAT_ROUTE,
  ensureDefaultCompatRoute,
  isCompatSettingsRoute,
  navigateCompatRoute,
  subscribeCompatRoute,
  type CompatRoute
} from './route-registry'
import { archiveExts, audioExts, documentExts, imageExts, textExts, videoExts } from '@shared/utils/file'
import PermissionRequestComposer, { findNextPendingPermissionRequest } from '../../source/src/renderer/components/composer/variants/PermissionRequestComposer'
import { CherryHostProvider, useCherryHost } from './shims/cherry-host-provider'

type AnyRecord = Record<string, any>

function toSourceMessage(message: AnyRecord, topicId: string): AnyRecord {
  // Source `MessageStatusSchema` is `pending | success | error | paused`
  // (shared/data/types/message.ts); `pending` is the live/streaming placeholder that
  // drives `isMessageListItemProcessing`, so a Grimoire streaming row maps to `pending`.
  const status = message.status === 'failed' ? 'error'
    : message.status === 'streaming' || message.status === 'pending' ? 'pending'
      : message.status === 'cancelled' ? 'paused'
        : 'success'
  return {
    id: String(message.id),
    role: message.role === 'user' ? 'user' : 'assistant',
    topicId,
    parentId: message.parent_id ?? null,
    createdAt: message.created_at || new Date().toISOString(),
    updatedAt: message.created_at || new Date().toISOString(),
    status,
    modelId: message.model_id || undefined,
  }
}

function modelIdForSession(model: AnyRecord | undefined): string {
  if (!model) return ''
  const raw = String(model.apiModelId || model.id || '')
  return raw.includes('::') ? raw.slice(raw.indexOf('::') + 2) : raw
}

/**
 * The source computes this from model modality capabilities
 * (`useComposerFileCapabilities`); the compat entry has no model-modality service, so
 * it offers the union of the source extension groups (the same `ALL_FILE_EXTS` shape)
 * and lets the Host attachment gate (mime/size/type) reject what it cannot store.
 * An empty array (the previous value) rejected every drop/paste, so this is the
 * minimum truthful set rather than a capability claim.
 */
const COMPOSER_SUPPORTED_EXTS: string[] = [...imageExts, ...audioExts, ...videoExts, ...documentExts, ...textExts, ...archiveExts]

/**
 * Local mirror of the post-drop order for the rail optimistic update: pinned first,
 * then fractional order key with un-keyed rows last (`compareOrderKeysEmptyLast`).
 * The Host list on the next refresh remains the source of truth.
 */
function sortRailItems<T extends { pinned?: boolean; order_key?: string }>(items: T[]): T[] {
  return [...items].sort((a, b) => {
    const pinned = Number(b.pinned === true) - Number(a.pinned === true)
    if (pinned !== 0) return pinned
    const keyA = a.order_key || ''
    const keyB = b.order_key || ''
    if (keyA === keyB) return 0
    if (keyA === '') return 1
    if (keyB === '') return -1
    return keyA < keyB ? -1 : 1
  })
}

function CherryChatShellContent() {
  // Source window runtime: keep i18next in sync with the `app.language` preference so
  // a language change applies without reload. Grimoire settings writes land through
  // the preference shim's `db.onRefresh` subscription, which notifies
  // `subscribeChange` and re-renders this hook.
  useLanguageSync()
  const [paneOpen, setPaneOpen] = useState(true)
  const [sessions, setSessions] = useState<AnyRecord[]>([])
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null)
  const [snapshot, setSnapshot] = useState<AnyRecord | null>(null)
  const [models, setModels] = useState<AnyRecord[]>([])
  const [selectedModel, setSelectedModel] = useState<AnyRecord | undefined>()
  const [composerText, setComposerText] = useState('')
  const [files, setFiles] = useState<any[]>([])
  const [composerExpanded, setComposerExpanded] = useState(false)
  const [loading, setLoading] = useState(false)
  const [sessionsLoading, setSessionsLoading] = useState(true)
  const [sessionsError, setSessionsError] = useState('')
  const [includeArchivedSessions, setIncludeArchivedSessions] = useState(false)
  const [includeArchivedEntities, setIncludeArchivedEntities] = useState(false)
  const [activeTopicId, setActiveTopicId] = useState<string | null>(null)
  const [assistants, setAssistants] = useState<AiAssistantRecord[]>([])
  const [topics, setTopics] = useState<AiTopicRecord[]>([])
  const [assistantsLoading, setAssistantsLoading] = useState(true)
  const [topicsLoading, setTopicsLoading] = useState(false)
  const [assistantsError, setAssistantsError] = useState('')
  const [topicsError, setTopicsError] = useState('')
  const [activeAssistantId, setActiveAssistantId] = useState<string | null>(null)
  // Grimoire-owned hash route registry replaces the local panel state so deep links,
  // back/forward and refresh-on-route work (the full Cherry route tree is not in the
  // vendored closure). Panel views map onto the four implemented source paths.
  const [route, setRoute] = useState<CompatRoute>(() => ensureDefaultCompatRoute())
  useEffect(() => subscribeCompatRoute(setRoute), [])
  // Preserve the source settings redirects instead of letting their paths fall into
  // the generic unknown route. The redirect is observable in history/hash semantics;
  // no source page is claimed for the parent/alias route itself.
  useEffect(() => {
    if (route.id === 'settings-root') navigateCompatRoute({ id: 'settings-provider', path: COMPAT_ROUTE_PATHS['settings-provider'] })
    else if (route.id === 'settings-system') navigateCompatRoute({ id: 'settings-general', path: COMPAT_ROUTE_PATHS['settings-general'] })
    else if (route.id === 'settings-code-execution') navigateCompatRoute({ id: 'settings-appearance', path: COMPAT_ROUTE_PATHS['settings-appearance'] })
  }, [route.id])
  // Every settings surface renders full-page in the shell's main slot (see
  // `settingsSurface`), so each new route is added in exactly one place.
  const settingsRoute = isCompatSettingsRoute(route)
  const resourcePanel: 'sessions' | 'entities' | 'provider-mcp' =
    route.id === 'agents' ? 'entities' : settingsRoute ? 'provider-mcp' : 'sessions'
  const [manualOrder, setManualOrder] = useState(false)
  // The source stores the session sort mode and the assistant/topic display mode as
  // separate preferences (`SessionListOptionsMenu` / `TopicListOptionsMenu`), so the
  // two rail modes track independently here as well.
  const [manualEntityOrder, setManualEntityOrder] = useState(false)
  const [pendingPermission, setPendingPermission] = useState<AnyRecord | null>(null)
  // MCP servers, for the message-list `isToolAutoApproved` capability. The rule reads
  // each server's force-prompt denylist, which the "always allow" action mutates — so
  // this must be RELOADED after such a write, not read once.
  const [mcpServers, setMcpServers] = useState<AnyRecord[]>([])
  // Live assistant turn accumulated from Host stream events. The Host persists the
  // assistant message only on completion, so without this overlay the window shows
  // nothing until the whole answer lands (source renders it as a pending message).
  const [liveTurn, setLiveTurn] = useState<LiveTurn | null>(null)

  const host = useCherryHost()
  const hostSessions = host.sessions as AnyRecord
  const hostModels = host.models as AnyRecord
  const hostAssistants = host.assistants as AnyRecord
  const hostTopics = host.topics as AnyRecord

  const loadModels = useCallback(async () => {
    const result = await hostModels.list({ limit: 5000 })
    const next = Array.isArray(result) ? result : []
    setModels(next)
    setSelectedModel(current => current || next[0])
  }, [hostModels])

  const loadSessions = useCallback(async () => {
    setSessionsLoading(true)
    try {
      const result = await hostSessions.list({ kind: 'chat', limit: 100, includeArchived: includeArchivedSessions, manualOrder })
      const next = Array.isArray(result) ? result : []
      setSessions(next)
      // Source resume rule (`/agent-sessions/latest`): never resolve the active session
      // from the pinned-first list head. Keep a surviving selection; an empty selection
      // is filled by the dedicated latest query in the effect below.
      setActiveSessionId(current => current && next.some(session => session.id === current) ? current : null)
      setSessionsError('')
    } catch (cause) {
      setSessionsError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setSessionsLoading(false)
    }
  }, [hostSessions, includeArchivedSessions, manualOrder])

  const loadAssistants = useCallback(async () => {
    setAssistantsLoading(true)
    try {
      const result = await hostAssistants.list({ includeArchived: includeArchivedEntities, manualOrder: manualEntityOrder })
      const next = Array.isArray(result) ? result : []
      setAssistants(next)
      setActiveAssistantId(current => current && next.some(item => item.id === current) ? current : next[0]?.id || null)
      setAssistantsError('')
    } catch (cause) {
      setAssistantsError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setAssistantsLoading(false)
    }
  }, [hostAssistants, includeArchivedEntities, manualEntityOrder])

  /**
   * Loads MCP servers for the `isToolAutoApproved` capability. Deliberately silent on
   * failure: the capability degrades to "not auto-approved" (the card asks for
   * permission), which is the safe direction, so a load error must not surface as a
   * message-list error.
   */
  const loadMcpServers = useCallback(async () => {
    try {
      const result = await host.mcp.list()
      setMcpServers(Array.isArray(result) ? result : [])
    } catch {
      setMcpServers([])
    }
  }, [host])

  const loadTopics = useCallback(async (sessionId: string | null) => {
    if (!sessionId) {
      setTopics([])
      setTopicsError('')
      setTopicsLoading(false)
      return
    }
    setTopicsLoading(true)
    try {
      const result = await hostTopics.list({ sessionId, includeArchived: includeArchivedEntities, manualOrder: manualEntityOrder })
      const next = Array.isArray(result) ? result : []
      setTopics(next)
      // Keep a surviving selection; a fresh one resolves through `/topics/latest` below
      // so the pinned-first list order never decides which topic resumes.
      setActiveTopicId(current => current && next.some(topic => topic.id === current) ? current : null)
      setTopicsError('')
    } catch (cause) {
      setTopicsError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setTopicsLoading(false)
    }
  }, [hostTopics, includeArchivedEntities, manualEntityOrder])

  // Source `/topics/latest` fallback for the active topic of the loaded session.
  useEffect(() => {
    if (topicsLoading || !activeSessionId || activeTopicId) return
    let cancelled = false
    void hostTopics.latest({ sessionId: activeSessionId }).then((latest: AnyRecord | null) => {
      if (!cancelled && latest?.id) setActiveTopicId(String(latest.id))
    }).catch(() => undefined)
    return () => { cancelled = true }
  }, [activeSessionId, activeTopicId, hostTopics, topicsLoading])

  const refreshAssistantTopics = useCallback(async () => {
    await Promise.all([loadAssistants(), loadTopics(activeSessionId)])
  }, [activeSessionId, loadAssistants, loadTopics])

  const loadSnapshot = useCallback(async (sessionId: string | null) => {
    if (!sessionId) {
      setSnapshot(null)
      return
    }
    const next = await hostSessions.get(sessionId)
    setSnapshot(next || null)
    if (next?.session?.model_id) {
      setSelectedModel(current => current || models.find(model => model.id === next.session.model_id || model.apiModelId === next.session.model_id))
    }
  }, [models])

  useEffect(() => {
    void Promise.all([loadModels(), loadSessions(), loadAssistants(), loadMcpServers()])
  }, [loadModels, loadSessions, loadAssistants, loadMcpServers])

  // Source resume fallback: with no surviving active session, resume the last-touched
  // conversation through the dedicated latest query (activity order, not list order).
  useEffect(() => {
    if (sessionsLoading || activeSessionId) return
    let cancelled = false
    void host.latest.session({ kind: 'chat' }).then((latest: AnyRecord | null) => {
      if (!cancelled && latest?.id) setActiveSessionId(String(latest.id))
    }).catch(() => undefined)
    return () => { cancelled = true }
  }, [activeSessionId, host.latest, sessionsLoading])

  useEffect(() => {
    void loadSnapshot(activeSessionId)
    void loadTopics(activeSessionId)
  }, [activeSessionId, loadSnapshot, loadTopics])

  useEffect(() => {
    const unsubscribe = host.chat.onEvent((event: AnyRecord) => {
      // Resource mutations for assistants/topics do not carry a sessionId. Refresh
      // those projections independently, while session-scoped events still avoid
      // disturbing an unrelated active conversation.
      if (event.kind === 'resource' || event.record?.name !== undefined) {
        void loadAssistants()
        void loadTopics(activeSessionId)
      }
      if (!activeSessionId || event.sessionId !== activeSessionId) return
      const eventType = event.record?.event_type
      // The live overlay consumes stream events locally; terminal events drop it and
      // the persisted snapshot takes over (source `useTopicOverlayHandoffOnTerminal`
      // does the same: refresh, then drop the overlay).
      if (eventType === 'completed' || eventType === 'failed' || eventType === 'interrupted') {
        setLiveTurn(null)
      } else {
        setLiveTurn(current => applyTurnEvent(current, activeSessionId, event))
      }
      // A resolved/expired permission (or any terminal turn event) clears the card.
      if (eventType === 'permission-resolved' || eventType === 'completed' || eventType === 'failed' || eventType === 'interrupted') {
        setPendingPermission(null)
      }
      // Deltas are consumed by the overlay; reloading the snapshot on every chunk
      // would issue one IPC round trip per token.
      if (event.kind !== 'delta') {
        void loadSnapshot(activeSessionId)
        void loadSessions()
        void loadTopics(activeSessionId)
      }
    })
    return typeof unsubscribe === 'function' ? unsubscribe : undefined
  }, [activeSessionId, host, loadAssistants, loadSessions, loadSnapshot, loadTopics])

  useEffect(() => {
    const unsubscribe = host.permissions.onRequest((request: AnyRecord) => {
      setPendingPermission(request)
    })
    return typeof unsubscribe === 'function' ? unsubscribe : undefined
  }, [host])

  const createSession = useCallback(async () => {
    const selected = selectedModel || models[0]
    const providerId = String(selected?.providerId || selected?.id || '').split('::')[0]
    const created = await hostSessions.create({ kind: 'chat', runtime: 'openai-compatible', providerId, modelId: modelIdForSession(selected), title: '新对话' })
    setSessions(current => [created, ...current.filter(item => item.id !== created.id)])
    setActiveSessionId(created.id)
    setSnapshot({ session: created, messages: [], events: [] })
  }, [models, selectedModel])

  const sendDraft = useCallback(async (draft: AnyRecord) => {
    const content = String(draft?.text || '').trim()
    if (!content || loading) return
    let sessionId = activeSessionId
    if (!sessionId) {
      const selected = selectedModel || models[0]
      const providerId = String(selected?.providerId || selected?.id || '').split('::')[0]
      const created = await hostSessions.create({ kind: 'chat', runtime: 'openai-compatible', providerId, modelId: modelIdForSession(selected), title: content.slice(0, 30) })
      sessionId = created.id
      setSessions(current => [created, ...current])
      setActiveSessionId(sessionId)
    }
    setLoading(true)
    // The turn's stream events begin arriving before `send` resolves; start from a
    // clean overlay so a previous turn's tail never blends into this one.
    setLiveTurn(null)
    try {
      // Source composer attachments are path-backed descriptors; the Host stores
      // attachments itself (renderer never reads the file), so each path is imported
      // through the attachment service first and the returned ids travel with the send.
      const attachments: AnyRecord[] = []
      for (const file of files) {
        const filePath = typeof file?.path === 'string' ? file.path : ''
        if (!filePath) continue
        try {
          const record = await host.attachments.import({ sessionId, filePath, sourceType: file?.type === 'image' ? 'image' : undefined }) as AnyRecord
          if (record?.id) attachments.push({
            attachmentId: String(record.id),
            name: String(record.original_name || file?.name || ''),
            size: Number(record.size || file?.size || 0),
            type: String(file?.type || 'file')
          })
        } catch {
          // An unreadable/oversized file is skipped; the message text still sends.
        }
      }
      await host.chat.send({ sessionId, content, modelId: modelIdForSession(selectedModel) || undefined, attachments })
      setComposerText('')
      setFiles([])
      await loadSnapshot(sessionId)
      await loadSessions()
    } finally {
      // Post-turn reconciliation: the terminal event usually cleared the overlay
      // already; this covers a send that fails before any event arrives.
      setLiveTurn(current => current && current.sessionId === sessionId ? null : current)
      setLoading(false)
    }
  }, [activeSessionId, files, loadSessions, loadSnapshot, loading, models, selectedModel])


  /**
   * Exports one topic's conversation.
   *
   * Grimoire stores one message list per SESSION, not per topic (the topic-message-tree gap
   * recorded in MIGRATION_MATRIX), so a topic export is its owning session's messages rendered
   * with the topic's title. That is why the topic id is resolved to a session id first rather
   * than assumed to be one.
   *
   * The markdown conversion and the three exporters are the SOURCE's own functions
   * (`messagesToMarkdown`, `exportMarkdownToJoplin` / `Siyuan` / `Yuque`), not reimplementations
   * — this session verified their chain works end to end (renderer-side fetch to a
   * user-supplied URL, config through the compat preference shim).
   *
   * `markdown` writes through the same save dialog the source uses; the three network targets
   * report their own toasts. An unconfigured target answers with the source's own error toast
   * rather than a silent no-op.
   */
  const exportTopic = useCallback(async (
    kind: 'markdown' | 'markdown-reason' | 'joplin' | 'siyuan' | 'yuque',
    topicId: string
  ) => {
    const topic = topics.find(item => item.id === topicId)
    const sessionId = topic?.session_id || activeSessionId
    if (!sessionId) return
    // Load the messages belonging to the topic's session — the snapshot may be showing another.
    let sessionMessages: AnyRecord[] = snapshot?.messages || []
    if (sessionId !== activeSessionId) {
      const loaded = await host.sessions.get(sessionId) as AnyRecord | null
      sessionMessages = (loaded?.messages as AnyRecord[]) || []
    }
    // The exporter reads `message.parts` (`utils/message/find.ts: getParts`), NOT a
    // content string — `toSourceMessage` alone produces the envelope without parts, so an
    // export built from it renders the role headings with EMPTY bodies. A test caught this:
    // messagesToMarkdown returned the two role headings with no text between them. The parts
    // are projected with the same `readParts`/`toSourcePart` pair the renderer uses, so the
    // exported body matches what the user sees on screen.
    const sourceMessages = sessionMessages.map((message: AnyRecord) => ({
      ...toSourceMessage(message, sessionId),
      parts: readParts(message.content).map(part => toSourcePart(part))
    }))
    const title = topic?.title || '新对话'
    const withReasoning = kind === 'markdown-reason'
    try {
      const markdown = await messagesToMarkdown(sourceMessages as never, withReasoning)
      if (kind === 'joplin') {
        await exportMarkdownToJoplin(title, markdown)
      } else if (kind === 'siyuan') {
        await exportMarkdownToSiyuan(title, markdown)
      } else if (kind === 'yuque') {
        await exportMarkdownToYuque(title, markdown)
      } else {
        // Preserve the source Markdown payload, but use the real Grimoire native save IPC.
        // The source file.save surface is not present in this sandboxed preload.
        const result = await saveMarkdownExport(title, markdown)
        if (!result) return
      }
    } catch (error) {
      console.error('[cherry topic export] 导出失败', error)
    }
  }, [activeSessionId, host, snapshot, topics])

  const messages = useMemo(() => {
    const sourceMessages = (snapshot?.messages || []).map((message: AnyRecord) => toSourceMessage(message, activeSessionId || 'cherry-topic'))
    const partsByMessageId: Record<string, AnyRecord[]> = {}
    for (const message of snapshot?.messages || []) {
      partsByMessageId[String(message.id)] = readParts(message.content).map(part => toSourcePart(part))
    }
    // Live turn overlay: the persisted assistant message does not exist yet, so append
    // a synthetic `pending` message carrying the accumulated parts. The source renders
    // its placeholder/spinner while `status === 'pending'` and streams the text tail.
    if (liveTurn && liveTurn.sessionId === activeSessionId && liveTurnHasContent(liveTurn)) {
      const liveId = 'cherry-live-assistant'
      sourceMessages.push({
        id: liveId,
        role: 'assistant',
        topicId: activeSessionId || 'cherry-topic',
        parentId: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        status: 'pending'
      })
      partsByMessageId[liveId] = liveTurnParts(liveTurn)
    }
    // A pending Grimoire permission has no tool call of its own; attach the synthetic
    // approval part to the newest assistant message so the source renderer and the
    // approval composer both find it through `findToolPartByCallId`.
    if (pendingPermission) {
      const owner = liveTurn && liveTurnHasContent(liveTurn)
        ? { id: 'cherry-live-assistant' }
        : [...sourceMessages].reverse().find((message: AnyRecord) => message.role === 'assistant')
      if (owner) {
        partsByMessageId[owner.id] = [...(partsByMessageId[owner.id] || []), permissionToApprovalPart(pendingPermission)]
      } else {
        const fallbackId = 'cherry-permission-message'
        sourceMessages.push({ id: fallbackId, role: 'assistant', topicId: activeSessionId || 'cherry-topic', parentId: null, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), status: 'success' })
        partsByMessageId[fallbackId] = [permissionToApprovalPart(pendingPermission)]
      }
    }
    return { sourceMessages, partsByMessageId }
  }, [activeSessionId, liveTurn, pendingPermission, snapshot])

  const pendingRequest = useMemo(
    () => (pendingPermission ? findNextPendingPermissionRequest(messages.partsByMessageId as never) : null),
    [messages, pendingPermission]
  )
  const selectedModelView = selectedModel || models[0]
  const modelLabel = selectedModelView?.name || selectedModelView?.apiModelId || selectedModelView?.id || '选择模型'

  const pane = (
    <aside className="flex h-full w-full flex-col border-r border-border-subtle bg-card/70 p-3">
      <div className="mb-3 flex items-center justify-between gap-2">
        <div className="min-w-0">
          <div className="text-sm font-semibold">魔导书</div>
          <div className="text-[11px] text-muted-foreground">智能工作区 · {route.path}</div>
        </div>
        <div className="flex shrink-0 rounded-md border border-border-subtle p-0.5 text-[10px]">
          <button
            type="button"
            className={'rounded px-2 py-1 ' + (resourcePanel === 'sessions' ? 'bg-muted text-foreground' : 'text-muted-foreground')}
            onClick={() => navigateCompatRoute({ id: 'chat', path: COMPAT_ROUTE_PATHS.chat })}>会话</button>
          <button
            type="button"
            className={'rounded px-2 py-1 ' + (resourcePanel === 'entities' ? 'bg-muted text-foreground' : 'text-muted-foreground')}
            onClick={() => navigateCompatRoute({ id: 'agents', path: COMPAT_ROUTE_PATHS.agents })}>助手 / 主题</button>
          <button
            type="button"
            className={'rounded px-2 py-1 ' + (resourcePanel === 'provider-mcp' ? 'bg-muted text-foreground' : 'text-muted-foreground')}
            onClick={() => navigateCompatRoute({ id: 'settings-provider', path: COMPAT_ROUTE_PATHS['settings-provider'] })}>Provider / MCP</button>
          <button
            type="button"
            className={'rounded px-2 py-1 ' + (route.id === 'settings-appearance' ? 'bg-muted text-foreground' : 'text-muted-foreground')}
            onClick={() => navigateCompatRoute({ id: 'settings-appearance', path: COMPAT_ROUTE_PATHS['settings-appearance'] })}>外观</button>
          <button
            type="button"
            className={'rounded px-2 py-1 ' + (route.id === 'settings-general' ? 'bg-muted text-foreground' : 'text-muted-foreground')}
            onClick={() => navigateCompatRoute({ id: 'settings-general', path: COMPAT_ROUTE_PATHS['settings-general'] })}>常规</button>
          <button
            type="button"
            className={'rounded px-2 py-1 ' + (route.id === 'settings-data' ? 'bg-muted text-foreground' : 'text-muted-foreground')}
            onClick={() => navigateCompatRoute({ id: 'settings-data', path: COMPAT_ROUTE_PATHS['settings-data'] })}>数据</button>
          <button
            type="button"
            className={'rounded px-2 py-1 ' + (route.id === 'settings-dependencies' ? 'bg-muted text-foreground' : 'text-muted-foreground')}
            onClick={() => navigateCompatRoute({ id: 'settings-dependencies', path: COMPAT_ROUTE_PATHS['settings-dependencies'] })}>依赖</button>
          <button
            type="button"
            className={'rounded px-2 py-1 ' + (route.id === 'settings-notifications' ? 'bg-muted text-foreground' : 'text-muted-foreground')}
            onClick={() => navigateCompatRoute({ id: 'settings-notifications', path: COMPAT_ROUTE_PATHS['settings-notifications'] })}>通知</button>
          <button
            type="button"
            className={'rounded px-2 py-1 ' + (route.id === 'settings-about' ? 'bg-muted text-foreground' : 'text-muted-foreground')}
            onClick={() => navigateCompatRoute({ id: 'settings-about', path: COMPAT_ROUTE_PATHS['settings-about'] })}>关于</button>
          <button
            type="button"
            className={'rounded px-2 py-1 ' + (route.id === 'settings-prompts' ? 'bg-muted text-foreground' : 'text-muted-foreground')}
            onClick={() => navigateCompatRoute({ id: 'settings-prompts', path: COMPAT_ROUTE_PATHS['settings-prompts'] })}>提示词</button>
          <button
            type="button"
            className={'rounded px-2 py-1 ' + (route.id === 'settings-usage' ? 'bg-muted text-foreground' : 'text-muted-foreground')}
            onClick={() => navigateCompatRoute({ id: 'settings-usage', path: COMPAT_ROUTE_PATHS['settings-usage'] })}>用量</button>
          <button
            type="button"
            className={'rounded px-2 py-1 ' + (route.id === 'settings-shortcut' ? 'bg-muted text-foreground' : 'text-muted-foreground')}
            onClick={() => navigateCompatRoute({ id: 'settings-shortcut', path: COMPAT_ROUTE_PATHS['settings-shortcut'] })}>快捷键</button>
          <button
            type="button"
            className={'rounded px-2 py-1 ' + (route.id === 'settings-archive' ? 'bg-muted text-foreground' : 'text-muted-foreground')}
            onClick={() => navigateCompatRoute({ id: 'settings-archive', path: COMPAT_ROUTE_PATHS['settings-archive'] })}>回收站</button>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-hidden">
        {route.id === 'mini-app-blocked' ? (
          <div role="alert" className="m-4 rounded border border-amber-500/30 bg-amber-500/10 p-4 text-xs text-amber-700">
            <div className="font-medium">小程序尚未接入（BLOCKED）</div>
            <div className="mt-2 space-y-1 text-[11px] leading-5">
              <div>
                源架构里小程序<span className="font-medium">就是标签页承载</span>的：<code>MiniAppsPage</code> 调 <code>useTabs().openTab('/app/mini-app/&lt;id&gt;')</code>，
                而 <code>MiniAppPage</code> 从 <code>useParams</code> 读取 appId，同时依赖标签页身份、激活状态和元数据更新。
                兼容窗口目前只有路由注册表，尚未提供这些标签页生命周期能力。
              </div>
              <div className="pt-1">
                挂载需要先给兼容窗口一个<span className="font-medium">具备真实语义</span>的 <code>TabsContext</code>（不能是空实现——21 个源文件使用
                <code>useTabs</code>，空实现会让那些入口静默失效）。在此之前不挂载，避免渲染一个看似可用、
                实际点击无效的小程序列表。
              </div>
            </div>
          </div>
        ) : route.id === 'unknown' ? (
          <div role="alert" className="m-2 rounded border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-700">
            <div className="font-medium">路由未实现：{route.path}</div>
            <div className="mt-1 text-[10px]">
              兼容窗口目前支持 {COMPAT_SUPPORTED_PATHS.join('、')}
              {COMPAT_BLOCKED_NOTES.length ? '（' + COMPAT_BLOCKED_NOTES.join('；') + '）' : ''}。
            </div>
            <button
              type="button"
              className="mt-2 underline"
              onClick={() => navigateCompatRoute(DEFAULT_COMPAT_ROUTE)}>
              返回会话
            </button>
          </div>
        ) : resourcePanel === 'sessions' ? (
          <CompatSessionResourceList
            sessions={sessions as AiSessionRecord[]}
            activeId={activeSessionId}
            loading={sessionsLoading}
            error={sessionsError}
            onRetry={() => void loadSessions()}
            onSelect={setActiveSessionId}
            onCreate={() => void createSession()}
            onRename={async (id, title) => {
              await hostSessions.update({ id, title })
              await loadSessions()
            }}
            onBranch={id => {
              void hostSessions.branch({ sessionId: id }).then((branch: AnyRecord) => {
                setSessions(current => [branch, ...current.filter(item => item.id !== branch.id)])
                setActiveSessionId(branch.id)
              })
            }}
            onArchive={async id => {
              // Source delete selection policy: when the archived row was active, move to
              // the next display neighbour (else previous, else latest active) before refresh.
              const replacement = activeSessionId === id ? pickResourceReplacement(sessions as Array<{ id: string; last_activity_at?: string }>, id) : null
              const name = sessions.find((session: AnyRecord) => session.id === id)?.title || '会话'
              await hostSessions.archive(id)
              if (activeSessionId === id) setActiveSessionId(replacement?.id || null)
              await loadSessions()
              // Source `showRecycleBinUndo`: a toast with an Undo action that restores.
              showRecycleBinUndo({
                itemName: name,
                onUndo: async () => {
                  await hostSessions.restore(id)
                  await loadSessions()
                }
              })
            }}
            onRestore={async id => {
              await hostSessions.restore(id)
              await loadSessions()
            }}
            onPin={async (id, pinned) => {
              const updated = await hostSessions.pin(id, pinned)
              setSessions(current => current.map(item => item.id === updated.id ? updated : item))
            }}
            includeArchived={includeArchivedSessions}
            onToggleArchived={() => {
              setIncludeArchivedSessions(value => !value)
              void loadSessions()
            }}
            manualOrder={manualOrder}
            onToggleManualOrder={() => {
              setManualOrder(value => !value)
            }}
            onReorder={payload => {
              if (payload.type !== 'item') return
              const overId = payload.overType === 'group' ? '' : payload.overId
              const position = payload.overType === 'group' ? 'last' : payload.position
              void hostSessions.reorder({ id: payload.activeId, overId, position }).then(() => loadSessions())
            }}
          />
        ) : resourcePanel === 'entities' ? (
          <CompatAssistantTopicRail
            assistants={assistants}
            topics={topics}
            activeAssistantId={activeAssistantId}
            activeSessionId={activeSessionId}
            activeTopicId={activeTopicId}
            assistantsLoading={assistantsLoading}
            assistantsError={assistantsError}
            topicsLoading={topicsLoading}
            topicsError={topicsError}
            includeArchived={includeArchivedEntities}
            manualOrder={manualEntityOrder}
            onRetryAssistants={() => void loadAssistants()}
            onRetryTopics={() => void loadTopics(activeSessionId)}
            onToggleArchived={() => {
              setIncludeArchivedEntities(value => !value)
              void refreshAssistantTopics()
            }}
            onToggleManualOrder={() => {
              setManualEntityOrder(value => !value)
            }}
            onSelectAssistant={id => {
              setActiveAssistantId(id)
            }}
            onSelectTopic={topic => {
              setActiveSessionId(topic.session_id)
              setActiveTopicId(topic.id)
              void loadTopics(topic.session_id)
            }}
            onCreateAssistant={async () => {
              const created = await hostAssistants.save({ name: '新助手' })
              setAssistants(current => [created, ...current])
              setActiveAssistantId(created.id)
            }}
            onCreateTopic={sessionId => {
              if (sessionId) void hostTopics.save({ session_id: sessionId, title: '新主题' }).then((topic: AiTopicRecord) => {
                setTopics(current => [topic, ...current])
              })
            }}
            onRenameAssistant={async (id, name) => {
              const next = window.prompt('重命名助手', name)
              if (!next?.trim()) return
              await hostAssistants.save({ id, name: next.trim() })
              await loadAssistants()
            }}
            onRenameTopic={async (id, title) => {
              const topic = topics.find(item => item.id === id)
              if (!topic) return
              await hostTopics.save({ ...topic, id, title })
              await loadTopics(topic.session_id)
            }}
            onArchiveAssistant={async id => {
              const name = assistants.find(item => item.id === id)?.name || '助手'
              await hostAssistants.archive(id)
              await loadAssistants()
              showRecycleBinUndo({
                itemName: name,
                onUndo: async () => {
                  await hostAssistants.restore(id)
                  await loadAssistants()
                }
              })
            }}
            onRestoreAssistant={async id => {
              await hostAssistants.restore(id)
              await loadAssistants()
            }}
            onPinAssistant={async (id, pinned) => {
              const updated = await hostAssistants.pin(id, pinned)
              setAssistants(current => current.map(item => item.id === updated.id ? updated : item))
            }}
            onArchiveTopic={async id => {
              // Source `pickNeighbourAfterRemoval` policy for the active topic.
              const replacement = activeTopicId === id ? pickResourceReplacement(topics, id) : null
              const name = topics.find(item => item.id === id)?.title || '主题'
              const ownerId = topics.find(item => item.id === id)?.session_id
              await hostTopics.archive(id)
              if (activeTopicId === id) setActiveTopicId(replacement?.id || null)
              await loadTopics(activeSessionId)
              showRecycleBinUndo({
                itemName: name,
                onUndo: async () => {
                  await hostTopics.restore(id)
                  await loadTopics(ownerId || activeSessionId)
                }
              })
            }}
            onRestoreTopic={async id => {
              await hostTopics.restore(id)
              await loadTopics(activeSessionId)
            }}
            onPinTopic={async (id, pinned) => {
              const updated = await hostTopics.pin(id, pinned)
              setTopics(current => current.map(item => item.id === updated.id ? updated : item))
            }}
            onReorderAssistant={async (id, anchor) => {
              const updated = await hostAssistants.reorder({ id, anchor })
              setAssistants(current => sortRailItems(current.map(item => item.id === updated.id ? updated : item)))
            }}
            onReorderTopic={async (id, anchor) => {
              const updated = await hostTopics.reorder({ id, anchor })
              setTopics(current => sortRailItems(current.map(item => item.id === updated.id ? updated : item)))
            }}
            onExportTopic={(kind, topicId) => exportTopic(kind, topicId)}
          />
        ) : (
          <CompatProviderMcpPanel onProviderSettings={() => void host.windows.openSettings()} />
        )}
      </div>
    </aside>
  )

  const topBar = (
    <div className="flex h-12 shrink-0 items-center justify-between gap-3 border-b border-border-subtle bg-card px-4">
      <div className="min-w-0">
        <div className="truncate text-sm font-semibold">{route.id === 'settings-provider' ? 'Provider 设置' : route.id === 'settings-mcp' ? 'MCP 设置' : route.id === 'settings-mcp-detail' ? 'MCP 服务详情' : route.id === 'settings-appearance' ? '外观设置' : route.id === 'settings-general' ? '常规设置' : route.id === 'settings-data' ? '数据设置' : route.id === 'settings-dependencies' ? '依赖' : route.id === 'settings-notifications' ? '通知设置' : route.id === 'settings-about' ? '关于' : route.id === 'settings-prompts' ? '提示词' : route.id === 'settings-usage' ? '用量' : route.id === 'settings-shortcut' ? '快捷键' : route.id === 'settings-archive' ? '回收站' : snapshot?.session?.title || '新对话'}</div>
        <div className="text-[10px] text-muted-foreground">真实 Cherry 源组件 · {loading ? '生成中' : '就绪'}</div>
      </div>
      {/* The model selector belongs to the chat surface; on the settings route it would
          imply the settings page is scoped to the chat's model. */}
      {settingsRoute ? null : (
        <ModelSelector
          multiple={false}
          selectionType="model"
          value={selectedModelView as never}
          onSelect={(model: AnyRecord | undefined) => setSelectedModel(model)}
          trigger={<button type="button" className="max-w-64 truncate rounded-md border px-3 py-1.5 text-xs">{modelLabel}</button>}
        />
      )}
    </div>
  )

  // Message leaf capabilities the mounted source subtree reads off context. Both are
  // supplied through `CompatMessageListProvider`, which mounts the source
  // `MessageListProvider` directly so the UI-selector capabilities reach
  // `MessageListUiSelectorsContext` — the narrow `MessageContentProvider` wrapper cannot
  // carry them.
  //
  // `subscribeToolProgress` is a one-line bridge to the `mcp.tool.call_progress` push
  // event the main process emits (see `mcp.service.ts`); the source owns it on a hook
  // this entry does not mount (`useMessageLeafCapabilities`, which also pulls
  // attachment, clipboard and preview capabilities needing services the compat window
  // lacks).
  const messageCapabilities = useMemo(() => ({
    /**
     * Source `isToolAutoApproved`. Without it `MessageMcpTool.willAwaitApproval` cannot
     * know a tool is already allowed, so the card would keep asking for a permission the
     * user had permanently granted — and the auto-approved badge would never render.
     */
    isToolAutoApproved: (tool: AnyRecord, allowedTools?: string[]) => {
      // The source's own server-id allowlist short-circuit, kept for the same reason it
      // exists there: an explicitly allowed tool is approved regardless of the denylist.
      const name = String(tool?.name || '')
      if (Array.isArray(allowedTools) && allowedTools.includes(String(tool?.id || name))) return true
      return isToolAutoApproved(tool as never, mcpServers as never)
    }
  }), [mcpServers])

  const messageActions = useMemo(() => ({
    subscribeToolProgress: (toolId: string, onProgress: (progress: number) => void) => {
      const bridge = (window as AnyRecord).api?.ipcApi
      if (!bridge || typeof bridge.on !== 'function') return undefined
      return bridge.on('mcp.tool.call_progress', (payload: AnyRecord) => {
        if (!payload || payload.callId !== toolId) return
        const value = Number(payload.progress)
        if (Number.isFinite(value)) onProgress(value)
      })
    },
    notifyError: (message: string) => { void toast.error(message) },
    /**
     * Source `respondToolApproval` — the answer path for a pending tool approval. The
     * source sends `{ match, approved, reason }`, where `match.approvalId` is the
     * approval to settle and `match.toolCallId` identifies the call it belongs to.
     *
     * `allowForSession` is deliberately NOT used here: Grimoire's session grant is
     * keyed by PERMISSION KIND (`execute`/`network`/…), so answering "always allow"
     * through it would silently authorise every future tool of that kind — far broader
     * than the source's action, which persists a rule for THIS tool only via the MCP
     * server's `disabledAutoApproveTools`. The per-tool rule is a separate, explicit
     * capability (`setToolAutoApprove` below); until a card offers it, an approval
     * answers for this call only.
     */
    respondToolApproval: async (input: AnyRecord) => {
      const approvalId = approvalIdFromInput(input)
      if (!approvalId) throw new Error('权限审批缺少 approvalId，无法回应')
      await host.permissions.decide({ requestId: approvalId, decision: decisionForApproval(input?.approved) })
    },
    /**
     * Source `useToolApproval.autoApprove` ("always allow"): approve this call AND
     * persist a per-tool rule so the tool stops prompting.
     *
     * Follows the source `persistAutoApprove` exactly — read the owning MCP server,
     * drop the tool from its `disabledAutoApproveTools` denylist, save it back. It is
     * implemented here rather than in main because it is a read-modify-write over the
     * ordinary MCP save path the compat window already has, and because the source
     * implements it in the renderer for the same reason.
     *
     * Grimoire registers MCP tools as `mcp:<serverId>:<toolName>`, so the owning server
     * is recoverable from the tool name. A name in any other shape is not an MCP tool —
     * the source exposes this action only for MCP tools, since nothing else has a
     * per-tool auto-approve store — and it throws rather than approving without
     * persisting the rule the user asked for.
     */
    setToolAutoApprove: async (input: AnyRecord) => {
      const approvalId = approvalIdFromInput(input)
      if (!approvalId) throw new Error('权限审批缺少 approvalId，无法回应')
      const registeredName = String(input?.toolName || '')
      const identity = parseMcpToolIdentity(registeredName)
      if (!identity) throw new Error('“始终允许”仅适用于 MCP 工具，无法持久化：' + (registeredName || '(未知工具)'))
      await host.permissions.decide({ requestId: approvalId, decision: 'allowOnce' })
      const servers = (await host.mcp.list()) as AnyRecord[]
      const server = Array.isArray(servers) ? servers.find(item => item?.id === identity.serverId) : undefined
      if (!server) throw new Error('MCP Server 不存在：' + identity.serverId)
      const nextDenylist = withoutToolFromDenylist(server.disabled_auto_approve_tools, identity.toolName)
      // Already auto-approved server-side — nothing to persist, matching the source's
      // early return instead of writing an unchanged value.
      if (!nextDenylist) return
      await host.mcp.save({ id: identity.serverId, disabled_auto_approve_tools: nextDenylist })
      // The capability reads this state, so the badge must actually flip after the write.
      await loadMcpServers()
    },
    /**
     * Per-message export, the same chain the topic export uses.
     *
     * `MessageExportView.parts` is what the exporter reads (`utils/message/find.ts: getParts`),
     * so the view's own parts are passed straight through rather than re-derived — the source
     * hands the block its own render-time view, which already carries them.
     */
    exportMessageAsMarkdown: async (message: AnyRecord, includeReasoning?: boolean) => {
      const title = String(message?.id || 'message')
      const markdown = includeReasoning
        ? await messageToMarkdownWithReasoning(message as never)
        : await messageToMarkdown(message as never)
      await saveMarkdownExport(title, markdown)
    },
    exportToJoplin: async (message: AnyRecord) => {
      const markdown = await messagesToMarkdown([message] as never)
      await exportMarkdownToJoplin(String(message?.id || 'message'), markdown)
    },
    exportToSiyuan: async (message: AnyRecord) => {
      const markdown = await messagesToMarkdown([message] as never)
      await exportMarkdownToSiyuan(String(message?.id || 'message'), markdown)
    },
    exportToYuque: async (message: AnyRecord) => {
      const markdown = await messagesToMarkdown([message] as never)
      await exportMarkdownToYuque(String(message?.id || 'message'), markdown)
    }
  }), [host, loadMcpServers])

  const main = (
    <div className="flex h-full min-h-0 flex-col bg-background">
      <div className="min-h-0 flex-1">
        <CompatMessageListProvider
          messages={messages.sourceMessages as never}
          partsByMessageId={messages.partsByMessageId as never}
          actions={messageActions as never}
          capabilities={messageCapabilities as never}>
          <MessageList />
        </CompatMessageListProvider>
      </div>
      <div className="shrink-0 border-t border-border-subtle bg-card/70 px-3 pt-2">
        {pendingRequest ? (
          <PermissionRequestComposer
            request={pendingRequest as never}
            // One answer path: the same `respondToolApproval` the message actions expose,
            // so the composer and any tool-card approval control cannot diverge.
            onRespond={async input => {
              try {
                await messageActions.respondToolApproval(input as never)
              } finally {
                setPendingPermission(null)
              }
            }}
          />
        ) : null}
        <ComposerSurface
          text={composerText}
          onTextChange={setComposerText}
          tokens={[]}
          draftTokens={[]}
          managedTokenKinds={[]}
          onTokensChange={() => undefined}
          placeholder="发送消息给魔导书"
          sendDisabled={loading || !composerText.trim()}
          isLoading={loading}
          onSendDraft={(draft: AnyRecord) => void sendDraft(draft)}
          onPause={() => activeSessionId ? host.chat.interrupt(activeSessionId) : undefined}
          supportedExts={COMPOSER_SUPPORTED_EXTS}
          setFiles={setFiles as never}
          filesCount={files.length}
          isExpanded={composerExpanded}
          onExpandedChange={setComposerExpanded}
          quickPanelEnabled={false}
          enableDragDrop={true}
          enableSpellCheck={true}
          fontSize={14}
          narrowMode={false}
          renderLeftControls={() => <span className="px-2 text-[10px] text-muted-foreground">Markdown · CodeBlock · Host Bridge</span>}
          showAiDisclaimer={false}
        />
      </div>
    </div>
  )

  // The source Provider Settings page is a full-page surface (provider list + detail
  // pane), not a chat-side panel, so the settings route renders it in the shell's main
  // slot instead of the narrow resource pane where it was first mounted and cramped.
  // Absorbed into `appSurface` below when the other `/app/*` routes were registered; it stayed a
  // separate constant only while it was the sole one.
  //
  // `/app/*` surfaces other than chat. Each renders its source page in the shell's main
  // slot, the same way the source's own route files do; they are NOT folded into
  // `settingsSurface`, which renders a settings header and back-affordance that would
  // mislabel them (the release-notes route established that split).
  //
  // `BrowserPage` requires `initialUrl` — the source route supplies it from the search
  // params, and without it the page throws reading `initialUrl.startsWith`. Passed
  // explicitly rather than left undefined.
  // Every member of `COMPAT_APP_ROUTE_IDS` renders through `appSurface`; kept as a set so
  // adding a route cannot leave the shell treating it as the chat main slot.
  const appRoute = COMPAT_APP_ROUTE_IDS.has(route.id)
  const appSurface = (
    <Suspense fallback={<div className="p-4 text-xs text-muted-foreground">加载中…</div>}>
    {route.id === 'launchpad' ? <LaunchpadPage />
      : route.id === 'browser' ? <BrowserPage />
        : route.id === 'knowledge' ? <KnowledgePage />
          : route.id === 'notes' ? <NotesPage />
            : route.id === 'code' ? <CodeCliPage />
              : route.id === 'translate' ? <TranslatePage />
                : route.id === 'file-preview' ? <FilePreviewPage />
                : route.id === 'files' ? <FilesPage />
                : route.id === 'paintings' || route.id === 'paintings-splat' ? <PaintingPage />
                  : <ReleaseNotesPage />}
    </Suspense>
  )

  // The source MCP page is a layout route: its sidebar is always mounted and the
  // selected child is supplied by TanStack's Outlet. The compat registry owns the
  // outer hash navigation, so provide that child through the narrow outlet seam rather
  // than mounting a child directly and silently dropping the source layout.
  const mcpChild = route.id === 'settings-mcp' ? <McpServersList />
    : route.id === 'settings-mcp-builtin' ? <BuiltinMcpServerList />
      : route.id === 'settings-mcp-marketplaces' ? <McpMarketList />
        : route.id === 'settings-mcp-install' ? <McpInstallDependencies />
          : route.id === 'settings-mcp-npx-search' ? <NpxSearch />
            : route.id === 'settings-mcp-provider' ? <div role="alert" className="m-4 rounded border border-amber-500/30 bg-amber-500/10 p-4 text-xs text-amber-700">该 MCP 服务商页面需要 source provider-discovery adapter；当前只提供 MCP 服务器列表和内置服务。</div>
              : route.id === 'settings-mcp-detail' ? <McpServerDetail />
                : null

  const settingsChild = mcpChild ? (
    <CompatOutletProvider outlet={mcpChild}>
      <McpSettingsLayout />
    </CompatOutletProvider>
  ) : null

  const settingsContent = (
    <div className="h-full min-h-0 w-full overflow-auto bg-background">
      {route.id === 'settings-local-models' ? (
        <Suspense fallback={<div role="status" className="p-4">加载本地模型设置…</div>}><LocalModelsSettings /></Suspense>
      ) : route.id === 'settings-file-processing' || route.id === 'settings-ocr' ? (
        <Suspense fallback={<div role="status" className="p-4">加载处理设置…</div>}><ProcessingSettings kind={route.id === 'settings-ocr' ? 'ocr' : 'document'} /></Suspense>
      ) : route.id === 'settings-search' ? (
        <Suspense fallback={<div role="status" className="p-4">加载设置搜索…</div>}><SettingsSearchResults /></Suspense>
      ) : route.id === 'settings-model' ? (
        <Suspense fallback={<div className="p-4 text-xs text-muted-foreground">加载模型设置…</div>}><CompatModelSettings /></Suspense>
      ) : isCompatSourceSettingsRoute(route.id) ? (
        <CompatSourceSettings route={route} />
      ) : getSettingsDiagnostic(route.id) || route.id === 'settings-invalid' ? (
        <CompatRemainingSettings route={route} />
      ) : route.id === 'settings-root' || route.id === 'settings-system' || route.id === 'settings-code-execution' ? (
        <div role="status" className="m-4 rounded border border-border bg-muted/20 p-4 text-xs text-muted-foreground">
          正在打开源设置页面…
        </div>
      ) : (
        <Suspense fallback={<div className="p-4 text-xs text-muted-foreground">加载设置…</div>}>
          {settingsChild
            ? settingsChild
            : route.id === 'settings-appearance' ? <AppearanceSettings />
                : route.id === 'settings-data' ? <DataSettings />
                  : route.id === 'settings-notifications' ? <NotificationSettings />
                  : route.id === 'settings-about' ? <AboutSettings />
                  : route.id === 'settings-prompts' ? <PromptSettings />
                  : route.id === 'settings-usage' ? <UsageSettings />
                  : route.id === 'settings-shortcut' ? <ShortcutSettings />
                  : route.id === 'settings-archive' ? <ArchiveSettings />
                  : route.id === 'settings-dependencies' ? <EnvironmentDependencies /> : <ProviderSettingsPage />}
        </Suspense>
      )}
    </div>
  )

  const settingsSurface = (
    <Suspense fallback={<div role="status" className="p-4">加载设置布局…</div>}>
      <CompatOutletProvider outlet={settingsContent}>
        <SettingsPageLayout />
      </CompatOutletProvider>
    </Suspense>
  )

  // Source window composition (`windows/main/MainApp.tsx`): ThemeProvider → CodeStyleProvider
  // → CommandContextKeyProvider → CommandProvider, with PopupHost/ToastHost as leaf hosts.
  // The compat entry originally mounted only CommandProvider, which left `useCodeStyle`
  // throwing whenever a message rendered a code block; adopting the source order fixes the
  // real bug visual capture surfaced. QuickPanelProvider/ComposerToolRuntimeProvider stay
  // where the compat content needs them, inside the command runtime.
  return (
    <div data-cherry-root="true" className="h-screen w-screen bg-background text-foreground">
        <ThemeProvider>
          <CodeStyleProvider>
            <CommandContextKeyProvider>
              <CommandProvider>
                <QuickPanelProvider>
                  <ComposerToolRuntimeProvider
                    actions={{
                      addNewTopic: () => undefined,
                      onTextChange: updater => setComposerText(previous => typeof updater === 'function' ? updater(previous) : updater)
                    }}>
                    <ChatAppShell paneOpen={paneOpen} pane={pane} topBar={topBar} main={appRoute ? appSurface : settingsRoute ? settingsSurface : main} onPaneCollapse={() => setPaneOpen(false)} />
                  </ComposerToolRuntimeProvider>
                </QuickPanelProvider>
                <PopupHost />
                <ToastHost />
              </CommandProvider>
            </CommandContextKeyProvider>
          </CodeStyleProvider>
        </ThemeProvider>
      </div>
  )
}

export default function CherryChatShellEntry() {
  return (
    <CherryHostProvider>
      <CherryChatShellContent />
    </CherryHostProvider>
  )
}
