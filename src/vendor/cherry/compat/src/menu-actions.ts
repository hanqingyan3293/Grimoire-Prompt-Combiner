import type { TFunction } from 'i18next'
import {
  executeSessionMenuAction,
  resolveSessionMenuActions,
  type SessionActionContext
} from '../../source/src/renderer/components/chat/actions/sessionItemActions'
import {
  executeTopicMenuAction,
  resolveTopicMenuActions,
  type TopicActionContext
} from '../../source/src/renderer/components/chat/actions/topicContextMenuActions'
import type { ResolvedAction } from '../../source/src/renderer/components/chat/actions/actionTypes'

/**
 * Context-menu actions backed by real Grimoire services, resolved through the real
 * source registries.
 *
 * The source registries own labels, icons, ordering, groups, confirm dialogs and
 * enabled-state, but several of their commands do not gate on handler presence —
 * passing a partial context would render items that throw when picked. So the compat
 * layer passes a full-shaped context (no-op handlers) and then filters the resolved
 * tree to this allowlist, which only contains actions whose handler performs a real
 * Grimoire write. Everything else (auto-rename, copy/export, notes/knowledge, tab and
 * window actions, pane position) stays hidden until a Host service exists — the
 * matrix records those as pending rather than showing dead menu items.
 */
export const COMPAT_SESSION_MENU_ACTION_IDS = new Set(['session.rename', 'session.toggle-pin', 'session.delete'])
/**
 * Topic menu actions with a real Grimoire handler.
 *
 * Only the export ids whose whole chain is implemented are listed. The others
 * (`topic.export.image`, `.word`, `.notion`, `.obsidian`) stay OUT rather than being listed
 * with a `noop` — the menu hides anything not in this set, so listing one would render an
 * entry that does nothing when clicked, which is the fake-success shape.
 *
 * A parent id (`topic.export`) is included because the source builds the export SUBMENU from
 * `exportMenuOptions`; without the parent the children are unreachable.
 */
export const COMPAT_TOPIC_MENU_ACTION_IDS = new Set([
  'topic.rename', 'topic.pin', 'topic.delete',
  'topic.export', 'topic.export.markdown', 'topic.export.markdown-reason',
  'topic.export.joplin', 'topic.export.siyuan', 'topic.export.yuque'
])

function filterActions<TContext>(
  actions: readonly ResolvedAction<TContext>[],
  allowed: ReadonlySet<string>
): ResolvedAction<TContext>[] {
  return actions
    .filter(action => allowed.has(action.id))
    .map(action => (action.children.length ? { ...action, children: filterActions(action.children, allowed) } : action))
}

function noop(): void {}

/** Resolved + allowlist-filtered session menu actions for the compat rail. */
export function resolveCompatSessionMenuActions(context: SessionActionContext): ResolvedAction<SessionActionContext>[] {
  return filterActions(resolveSessionMenuActions(context), COMPAT_SESSION_MENU_ACTION_IDS)
}

/** Resolved + allowlist-filtered topic menu actions for the compat rail. */
/**
 * Resolves the topic menu, dropping export entries whose handler was not supplied.
 *
 * The allowlist alone was not enough: it is static, while export availability is
 * PER-CONTEXT — the shell entry passes the handlers, and a caller that does not (or a test)
 * must not see entries that do nothing. Filtering by the provided callbacks makes the menu
 * and the available behaviour derive from the same fact instead of two lists that can
 * disagree.
 */
export function resolveCompatTopicMenuActions(context: TopicActionContext): ResolvedAction<TopicActionContext>[] {
  const resolved = filterActions(resolveTopicMenuActions(context), COMPAT_TOPIC_MENU_ACTION_IDS)
  const unavailable: string[] = []
  if (context.onExportMarkdown === noop) unavailable.push('topic.export.markdown')
  if (context.onExportMarkdownReason === noop) unavailable.push('topic.export.markdown-reason')
  if (context.onExportJoplin === noop) unavailable.push('topic.export.joplin')
  if (context.onExportSiyuan === noop) unavailable.push('topic.export.siyuan')
  if (context.onExportYuque === noop) unavailable.push('topic.export.yuque')
  if (unavailable.length === 0) return resolved
  const drop = new Set(unavailable)
  const prune = (actions: readonly ResolvedAction<TopicActionContext>[]): ResolvedAction<TopicActionContext>[] =>
    actions
      .filter(action => !drop.has(action.id))
      .map(action => (action.children.length ? { ...action, children: prune(action.children) } : action))
      // A parent whose children were ALL pruned must go too, or the menu shows an empty
      // submenu — visibly broken, and worse than hiding the entry.
      .filter(action => !(action.id === 'topic.export' && action.children.length === 0))
  return prune(resolved)
}

export async function runCompatSessionMenuAction(
  action: ResolvedAction<SessionActionContext>,
  context: SessionActionContext
): Promise<void> {
  if (!COMPAT_SESSION_MENU_ACTION_IDS.has(action.id)) return
  await executeSessionMenuAction(action, context)
}

export async function runCompatTopicMenuAction(
  action: ResolvedAction<TopicActionContext>,
  context: TopicActionContext
): Promise<void> {
  if (!COMPAT_TOPIC_MENU_ACTION_IDS.has(action.id)) return
  await executeTopicMenuAction(action, context)
}

type SessionMenuInput = {
  sessionName: string
  pinned: boolean
  isActiveInCurrentTab: boolean
  isBusy?: boolean
  isRenaming?: boolean
  onRename: () => void
  onTogglePin: () => void
  onDelete: () => void | Promise<void>
  /**
   * Export handlers, supplied by the shell entry because IT owns the topic's messages.
   *
   * The rail is a pure list component with no Host access, so it cannot fetch message content
   * itself — passing the callbacks in keeps the data flow one-directional and keeps the
   * allowlist above honest (an id is listed only when its callback is actually provided).
   */
  onExportMarkdown?: () => void | Promise<void>
  onExportMarkdownReason?: () => void | Promise<void>
  onExportJoplin?: () => void | Promise<void>
  onExportSiyuan?: () => void | Promise<void>
  onExportYuque?: () => void | Promise<void>
  t: TFunction
}

/** Builds the source `SessionActionContext` from the compat callbacks. */
export function buildCompatSessionMenuContext(input: SessionMenuInput): SessionActionContext {
  return {
    isActiveInCurrentTab: input.isActiveInCurrentTab,
    isRenaming: input.isRenaming === true,
    isBusy: input.isBusy === true,
    pinned: input.pinned,
    sessionName: input.sessionName,
    startEdit: () => input.onRename(),
    onTogglePin: input.onTogglePin,
    onDelete: input.onDelete,
    // Hidden by the allowlist filter; provided so the registry can resolve a
    // full context without the optional-handler branches misfiring.
    onAutoRename: undefined,
    t: input.t
  }
}

type TopicMenuInput = {
  topic: TopicActionContext['topic']
  topicsLength: number
  pinned: boolean
  isActiveInCurrentTab: boolean
  isRenaming?: boolean
  onRename: () => void
  onTogglePin: () => void
  onDelete: () => void | Promise<void>
  /**
   * Export handlers, supplied by the shell entry because IT owns the topic's messages.
   *
   * The rail is a pure list component with no Host access, so it cannot fetch message content
   * itself — passing the callbacks in keeps the data flow one-directional and keeps the
   * allowlist above honest (an id is listed only when its callback is actually provided).
   */
  onExportMarkdown?: () => void | Promise<void>
  onExportMarkdownReason?: () => void | Promise<void>
  onExportJoplin?: () => void | Promise<void>
  onExportSiyuan?: () => void | Promise<void>
  onExportYuque?: () => void | Promise<void>
  t: TFunction
}

/** Builds the source `TopicActionContext` from the compat callbacks. */
export function buildCompatTopicMenuContext(input: TopicMenuInput): TopicActionContext {
  return {
    topic: input.topic,
    topicsLength: input.topicsLength,
    isArchiveBlocked: false,
    isActiveInCurrentTab: input.isActiveInCurrentTab,
    isRenaming: input.isRenaming === true,
    onAutoRename: noop,
    onClearMessages: noop,
    onCopyImage: noop,
    onCopyMarkdown: noop,
    onCopyPlainText: noop,
    onDelete: () => input.onDelete(),
    onExportImage: noop,
    onExportJoplin: input.onExportJoplin ?? noop,
    onExportMarkdown: input.onExportMarkdown ?? noop,
    onExportMarkdownReason: input.onExportMarkdownReason ?? noop,
    onExportNotion: noop,
    onExportObsidian: noop,
    onExportSiyuan: input.onExportSiyuan ?? noop,
    onExportWord: noop,
    onExportYuque: input.onExportYuque ?? noop,
    assistantMoveTargets: [],
    onPinTopic: () => input.onTogglePin(),
    onSaveToKnowledge: noop,
    onSaveToNotes: noop,
    onStartRename: () => input.onRename(),
    // Each flag mirrors whether the matching callback was PROVIDED. Hard-coding `false`
    // (the previous state) hid every export entry even when a handler existed; hard-coding
    // `true` would show entries with no handler. Deriving them makes the two impossible to
    // disagree.
    exportMenuOptions: {
      image: false,
      markdown: !!input.onExportMarkdown,
      markdown_reason: !!input.onExportMarkdownReason,
      docx: false,
      notion: false,
      yuque: !!input.onExportYuque,
      obsidian: false,
      joplin: !!input.onExportJoplin,
      siyuan: !!input.onExportSiyuan,
      plain_text: false
    },
    t: input.t
  }
}
