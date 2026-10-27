import { Archive, ArchiveRestore, PinIcon, PinOffIcon, Plus } from 'lucide-react'
import { useCallback, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import type { AiAssistantRecord, AiResourceOrderAnchor, AiTopicRecord } from '../../../../shared/ai-types'
import { ResourceEntityRail, type ResourceEntityRailItem } from '../../source/src/renderer/components/chat/resourceList/ResourceEntityRail'
import { TopicResourceList } from '../../source/src/renderer/components/chat/resourceList/TopicResourceList'
// The SOURCE assistant rail. It fetches assistants/topics/pins/groups itself through the
// DataApi, so the compat no longer has to project them — the integration test proves the chain
// renders a real assistant name.
import { AssistantResourceList } from '../../source/src/renderer/components/chat/resourceList/AssistantResourceList'
import { deriveAssistantTopicsView, useRawAssistantTopicsSource } from '../../source/src/renderer/hooks/resourceViewSources'
// The source's own rail behaviour: optimistic reorder with rollback + resync, pinned-first
// float, and a stale-activation guard. Its whole closure is React plus two sibling modules,
// so it is adopted rather than reimplemented — the compat previously called `onSelect` /
// `onReorder` directly, which meant no optimistic order and no rollback on a failed move.
import { useResourceEntityRail } from '../../source/src/renderer/components/chat/resourceList/useResourceEntityRail'
import type { ResourceEntityRailReorderAnchor } from '../../source/src/renderer/components/chat/resourceList/useResourceEntityRail'
import {
  buildResourceListItemDropAnchor,
  ResourceList,
  type ResourceListItemBase,
  type ResourceListReorderPayload,
  type ResourceListStatus
} from '../../source/src/renderer/components/chat/resourceList/base'
import { useResourceListActions, useResourceListPinnedState, useResourceListRowState } from '../../source/src/renderer/components/chat/resourceList/base'
import { ResourceListActionContextMenu } from '../../source/src/renderer/components/chat/actions/ResourceListActionContextMenu'
import {
  buildCompatTopicMenuContext,
  resolveCompatTopicMenuActions,
  runCompatTopicMenuAction
} from './menu-actions'

/** Source drop payload → `ResourceListOrderAnchor`; group drops append ('last', source `buildResourceListItemDropAnchor`). */
export function dropAnchorFromPayload(payload: ResourceListReorderPayload): AiResourceOrderAnchor {
  if (payload.type !== 'item') return { position: 'last' }
  return buildResourceListItemDropAnchor(payload)
}

type TopicExportHandler = (kind: 'markdown' | 'markdown-reason' | 'joplin' | 'siyuan' | 'yuque', topicId: string) => Promise<void>

export type CompatAssistantTopicRailProps = {
  assistants: AiAssistantRecord[]
  topics: AiTopicRecord[]
  activeAssistantId: string | null
  activeSessionId: string | null
  activeTopicId: string | null
  assistantsLoading: boolean
  assistantsError: string
  topicsLoading: boolean
  topicsError: string
  includeArchived: boolean
  manualOrder: boolean
  onRetryAssistants: () => void
  onRetryTopics: () => void
  onToggleArchived: () => void
  onToggleManualOrder: () => void
  onSelectAssistant: (id: string) => void
  onSelectTopic: (topic: AiTopicRecord) => void
  onCreateAssistant: () => Promise<void>
  onCreateTopic: (ownerId: string | null) => void
  onRenameAssistant: (id: string, name: string) => Promise<void>
  onRenameTopic: (id: string, title: string) => Promise<void>
  onArchiveAssistant: (id: string) => Promise<void>
  onRestoreAssistant: (id: string) => Promise<void>
  onPinAssistant: (id: string, pinned: boolean) => Promise<void>
  onArchiveTopic: (id: string) => Promise<void>
  onRestoreTopic: (id: string) => Promise<void>
  onPinTopic: (id: string, pinned: boolean) => Promise<void>
  onReorderAssistant: (id: string, anchor: AiResourceOrderAnchor) => Promise<void>
  onReorderTopic: (id: string, anchor: AiResourceOrderAnchor) => Promise<void>
  onExportTopic?: TopicExportHandler
}

type CompatTopicItem = ResourceListItemBase & {
  /** Optimistic pin state supplied by the reused source `useResourceListPinnedState`. */
  pinned: boolean
  topic: AiTopicRecord
}


/**
 * A topic's time bucket, matching `sessionGroup`'s convention in the session rail.
 *
 * RECONSTRUCTED: an over-broad cleanup regex deleted this together with the orphaned assistant
 * helpers it was adjacent to. The buckets and their boundaries mirror the session rail's, so
 * both rails group the same way.
 */
function topicGroup(topic: AiTopicRecord): { id: string; label: string } {
  const timestamp = Date.parse(topic.updated_at)
  const now = new Date()
  const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  const time = Number.isFinite(timestamp) ? timestamp : 0
  if (time >= startToday) return { id: 'today', label: '今天' }
  if (time >= startToday - 86_400_000) return { id: 'yesterday', label: '昨天' }
  if (time >= startToday - 7 * 86_400_000) return { id: 'week', label: '本周' }
  return { id: 'older', label: '更早' }
}

/**
 * A topic row, with the optimistic pin state the source `useResourceListPinnedState` supplies.
 *
 * RECONSTRUCTED alongside `topicGroup`. `getItemLabel` reads `item.name`, so the projection
 * must carry it — a missing name renders an unlabelled row rather than failing loudly.
 */
function projectTopic(topic: AiTopicRecord, pinned: boolean): CompatTopicItem {
  return { id: topic.id, name: topic.title, pinned, topic }
}

/**
 * The rail's status from its loading/error/count inputs.
 *
 * RECONSTRUCTED after an over-broad cleanup deleted it: a regex meant to drop the orphaned
 * `assistantStatus` call also removed this definition, and the topic rail failed with
 * `resourceStatus is not defined`. The ordering below is what the call sites require — an
 * error wins over loading (a failed fetch is not "still loading"), loading wins over empty
 * (otherwise a first load flashes the empty state), and only a settled zero-row list is
 * `empty`.
 */
function resourceStatus(isLoading: boolean, error: string, count: number): ResourceListStatus {
  if (error) return 'error'
  if (isLoading) return 'loading'
  return count === 0 ? 'empty' : 'idle'
}

export function CompatAssistantTopicRail({
  assistants,
  topics,
  activeAssistantId,
  activeSessionId,
  activeTopicId,
  assistantsLoading,
  assistantsError,
  topicsLoading,
  topicsError,
  includeArchived,
  manualOrder,
  onRetryAssistants,
  onRetryTopics,
  onToggleArchived,
  onToggleManualOrder,
  onSelectAssistant,
  onSelectTopic,
  onCreateAssistant,
  onCreateTopic,
  onRenameAssistant,
  onRenameTopic,
  onArchiveAssistant,
  onRestoreAssistant,
  onPinAssistant,
  onArchiveTopic,
  onRestoreTopic,
  onPinTopic,
  onReorderAssistant,
  onReorderTopic,
  onExportTopic
}: CompatAssistantTopicRailProps) {
  // Source `Topics.tsx` routes both rails through `useResourceListPinnedState`; the hook
  // owns the per-id concurrency gate, the optimistic overlay, rollback on failure and
  // overlay reconciliation when the Host list catches up.
  const assistantPinnedIds = useMemo(() => assistants.filter(item => item.pinned === true).map(item => item.id), [assistants])
  const assistantPinState = useResourceListPinnedState({
    pinnedIds: assistantPinnedIds,
    onTogglePin: async id => {
      await onPinAssistant(id, !assistantPinnedIds.includes(id))
    }
  })
  const topicPinnedIds = useMemo(() => topics.filter(item => item.pinned === true).map(item => item.id), [topics])
  const topicPinState = useResourceListPinnedState({
    pinnedIds: topicPinnedIds,
    onTogglePin: async id => {
      await onPinTopic(id, !topicPinnedIds.includes(id))
    }
  })

  // (assistant rail items/order/selection are owned by the source
  // `AssistantResourceList` now; the compat hook that used to build them was removed with the
  // compat half it fed.)


  // The source component takes the topics source as a PROP, built from the source's own data
  // hook and projection — the same chain `CompatAssistantListIntegration.test.tsx` exercises.
  // RECONSTRUCTED: an over-broad cleanup regex removed this together with the orphaned
  // assistant helpers above it.
  const rawTopicsSource = useRawAssistantTopicsSource({ enabled: true })
  const assistantTopicsView = useMemo(() => deriveAssistantTopicsView(rawTopicsSource.topics), [rawTopicsSource.topics])
  const assistantTopicsSource = useMemo(
    () => ({ ...rawTopicsSource, ...assistantTopicsView, refreshError: rawTopicsSource.error }),
    [rawTopicsSource, assistantTopicsView]
  )

  const topicItems = topics.map(topic => projectTopic(topic, topicPinState.isPinned(topic.id)))
  const topicStatus = resourceStatus(topicsLoading, topicsError, topicItems.length)
  // Source rejects drags while any group/archive view is active; reorder is the explicit manual mode.
  const reorderMode = manualOrder && !includeArchived

  return (
    <div className="flex min-h-0 flex-col gap-2">
      {/* The SOURCE assistant rail, replacing the compat projection.
          It fetches assistants/topics/pins/groups through the DataApi itself (verified by
          `CompatAssistantListIntegration.test.tsx`), so the 48-prop wrapper this file used to
          build for the assistant half is no longer needed — the props below are the source
          component's own contract, not a compat invention.
          `assistantTopicsSource` is a PROP here (the component does not read a context; an
          earlier attempt via a provider failed with "Cannot destructure property 'topics'"). */}
      <AssistantResourceList
        activeAssistantId={activeAssistantId}
        activeTopicId={activeTopicId}
        assistantTopicsSource={assistantTopicsSource}
        onAddAssistant={onCreateAssistant}
        onSelectTopic={topic => onSelectTopic({
          id: topic.id,
          session_id: (topic as { sessionId?: string }).sessionId || activeSessionId || '',
          parent_id: null,
          title: topic.name,
          pinned: false,
          archived: false,
          metadata: {},
          created_at: topic.createdAt,
          updated_at: topic.updatedAt
        } as AiTopicRecord)}
        onClearActiveTopic={() => undefined}
        onCreateTopic={async assistantId => {
          onCreateTopic(assistantId)
          return null
        }}
        onActiveAssistantDeleted={() => onRetryAssistants()}
      />

      <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-md border border-border-subtle bg-card/40">
        <TopicResourceList<CompatTopicItem>
          presentation="left-panel"
          items={topicItems}
          status={topicStatus}
          selectedId={activeTopicId}
          getItemId={item => item.id}
          getItemLabel={item => item.name}
          groupBy={item => (reorderMode ? { id: 'manual', label: '手动排序' } : topicGroup(item.topic))}
          defaultGroupVisibleCount={reorderMode ? Number.POSITIVE_INFINITY : 6}
          groupLoadStep={6}
          groupEmptyLabel="暂无主题"
          groupShowMoreLabel="显示更多"
          groupCollapseLabel="收起"
          onSelectItem={id => {
            const topic = topicItems.find(item => item.id === id)?.topic
            if (topic) onSelectTopic(topic)
          }}
          onRenameItem={(id, name) => {
            void onRenameTopic(id, name)
          }}
          onReorder={reorderMode ? (payload: ResourceListReorderPayload) => {
            if (payload.type !== 'item') return
            void onReorderTopic(payload.activeId, dropAnchorFromPayload(payload))
          } : undefined}
          dragCapabilities={{ groups: false, items: reorderMode, itemSameGroup: reorderMode, itemCrossGroup: false }}
          canDragItem={({ item }) => reorderMode && item.topic.pinned !== true}
          canDropItem={({ overItem }) => reorderMode && overItem?.topic.pinned !== true}>
          <ResourceList.Header
            title="主题"
            count={topicItems.length}
            actions={
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  className="inline-flex size-6 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
                  aria-label="新建主题"
                  title="新建主题"
                  onClick={() => onCreateTopic(activeSessionId)}>
                  <Plus size={14} />
                </button>
                <button
                  type="button"
                  className={'rounded px-1.5 text-[10px] ' + (manualOrder ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:bg-muted hover:text-foreground')}
                  onClick={onToggleManualOrder}
                  aria-pressed={manualOrder}
                  aria-label={manualOrder ? '切换回时间排序' : '切换为手动排序'}>
                  {manualOrder ? '手动' : '时间'}
                </button>
                <button
                  type="button"
                  className="rounded px-1.5 text-[10px] text-muted-foreground hover:bg-muted hover:text-foreground"
                  onClick={onToggleArchived}
                  aria-label={includeArchived ? '隐藏已归档主题' : '显示已归档主题'}>
                  {includeArchived ? '隐藏归档' : '显示归档'}
                </button>
              </div>
            }>
            <div className="text-[10px] text-muted-foreground">主题消息仍归属于其会话</div>
          </ResourceList.Header>
          <ResourceList.Search aria-label="搜索主题" placeholder="搜索主题" />
          {topicsError && topicItems.length > 0 ? (
            <div role="alert" className="mx-1 mb-1 flex items-center gap-2 rounded border border-amber-500/30 bg-amber-500/10 px-2 py-1 text-[10px] text-amber-700">
              <span className="min-w-0 flex-1 truncate">{topicsError}</span>
              <button type="button" className="underline" onClick={onRetryTopics}>重试</button>
            </div>
          ) : null}
          <ResourceList.Body<CompatTopicItem>
            ariaLabel="Cherry 主题列表"
            draggable={reorderMode}
            renderItem={item => (
              <CompatTopicRow
                item={item}
                pinDisabled={topicPinState.togglingIds.has(item.id)}
                onTogglePin={() => {
                  void topicPinState.togglePinned(item.id).catch(() => undefined)
                }}
                onArchive={onArchiveTopic}
                onRestore={onRestoreTopic}
                isActive={item.id === activeTopicId}
                topicsLength={topicItems.length}
                onExportTopic={onExportTopic}
              />
            )}
            errorFallback={
              <div role="alert" className="m-2 rounded border border-red-500/30 bg-red-500/10 p-2 text-xs text-red-600">
                <div>{topicsError || '主题加载失败'}</div>
                <button type="button" className="mt-1 underline" onClick={onRetryTopics}>重试</button>
              </div>
            }
            emptyFallback={<div className="flex items-center justify-center px-3 py-6 text-xs text-muted-foreground">暂无主题</div>}
          />
        </TopicResourceList>
      </div>
    </div>
  )
}

function CompatTopicRow({
  item,
  pinDisabled,
  onTogglePin,
  onArchive,
  onRestore,
  isActive,
  topicsLength,
  onExportTopic
}: {
  item: CompatTopicItem
  pinDisabled: boolean
  onTogglePin: () => void
  onArchive: (id: string) => Promise<void>
  onRestore: (id: string) => Promise<void>
  isActive: boolean
  topicsLength: number
  onExportTopic?: TopicExportHandler
}) {
  const actions = useResourceListActions()
  const rowState = useResourceListRowState(item.id)
  const topic = item.topic
  const archived = topic.archived === true
  const pinned = item.pinned
  const { t } = useTranslation()

  // Source `Topics.tsx` wraps the topic row in `ResourceListActionContextMenu`; the
  // compat wrapper resolves the same registry and filters to Grimoire-backed actions.
  const menuContext = useMemo(
    () => buildCompatTopicMenuContext({
      topic: item as unknown as Parameters<typeof buildCompatTopicMenuContext>[0]['topic'],
      topicsLength,
      pinned,
      isActiveInCurrentTab: isActive,
      isRenaming: rowState.renaming,
      onRename: () => actions.startRename(item.id),
      onTogglePin: () => {
        if (!pinDisabled) onTogglePin()
      },
      onDelete: () => (archived ? onRestore(topic.id) : onArchive(topic.id)),
      // Export handlers are bound to THIS topic, so the menu entry exports the row it was
      // opened on rather than whichever topic happens to be active.
      ...(onExportTopic ? {
        onExportMarkdown: () => onExportTopic('markdown', topic.id),
        onExportMarkdownReason: () => onExportTopic('markdown-reason', topic.id),
        onExportJoplin: () => onExportTopic('joplin', topic.id),
        onExportSiyuan: () => onExportTopic('siyuan', topic.id),
        onExportYuque: () => onExportTopic('yuque', topic.id)
      } : {}),
      t
    }),
    [actions, archived, isActive, item, onArchive, onRestore, onTogglePin, onExportTopic, pinDisabled, pinned, rowState.renaming, t, topic.id, topicsLength]
  )
  const menuActions = useMemo(() => resolveCompatTopicMenuActions(menuContext), [menuContext])
  const runMenuAction = useCallback(
    (action: Parameters<typeof runCompatTopicMenuAction>[0]) => runCompatTopicMenuAction(action, menuContext),
    [menuContext]
  )

  return (
    <ResourceListActionContextMenu item={item} actions={menuActions} onAction={runMenuAction}>
      <ResourceList.Item item={item} data-testid="compat-topic-row" title={item.name}>
        <ResourceList.ItemLeadingSlot className="size-5 shrink-0 rounded-md border border-border-subtle bg-background-subtle" />
        <ResourceList.RenameField item={item} aria-label="重命名主题" autoFocus onClick={event => event.stopPropagation()} />
        {!rowState.renaming ? (
          <ResourceList.ItemTitle
            fade
            title={item.name}
            onDoubleClick={event => {
              event.stopPropagation()
              actions.startRename(item.id)
            }}>
            {item.name}
          </ResourceList.ItemTitle>
        ) : null}
        {!rowState.renaming ? <span className="max-w-20 truncate text-[10px] text-muted-foreground">{archived ? '已归档' : '主题'}</span> : null}
        <ResourceList.ItemActions pinned={pinned}>
          <ResourceList.ItemAction
            aria-label={pinned ? '取消置顶主题' : '置顶主题'}
            title={pinned ? '取消置顶主题' : '置顶主题'}
            disabled={pinDisabled}
            onClick={event => {
              event.stopPropagation()
              onTogglePin()
            }}>
            {pinned ? <PinOffIcon size={14} /> : <PinIcon size={14} />}
          </ResourceList.ItemAction>
          <ResourceList.ItemAction
            aria-label={archived ? '恢复主题' : '归档主题'}
            title={archived ? '恢复主题' : '归档主题'}
            onClick={event => {
              event.stopPropagation()
              void (archived ? onRestore(topic.id) : onArchive(topic.id))
            }}>
            {archived ? <ArchiveRestore size={14} /> : <Archive size={14} />}
          </ResourceList.ItemAction>
        </ResourceList.ItemActions>
      </ResourceList.Item>
    </ResourceListActionContextMenu>
  )
}
