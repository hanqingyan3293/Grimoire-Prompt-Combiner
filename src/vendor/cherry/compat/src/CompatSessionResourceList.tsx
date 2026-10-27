import { Archive, GitBranch, PinIcon, PinOffIcon, Plus } from 'lucide-react'
import { useCallback, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import type { AiSessionRecord } from '../../../../shared/ai-types'
import { SessionResourceList } from '../../source/src/renderer/components/chat/resourceList/SessionResourceList'
import {
  ResourceList,
  type ResourceListItemBase,
  type ResourceListReorderPayload,
  type ResourceListStatus
} from '../../source/src/renderer/components/chat/resourceList/base'
import { useResourceListActions, useResourceListPinnedState, useResourceListRowState } from '../../source/src/renderer/components/chat/resourceList/base'
import { ResourceListActionContextMenu } from '../../source/src/renderer/components/chat/actions/ResourceListActionContextMenu'
import {
  buildCompatSessionMenuContext,
  resolveCompatSessionMenuActions,
  runCompatSessionMenuAction
} from './menu-actions'

type CompatSessionItem = ResourceListItemBase & {
  session: AiSessionRecord
}

type CompatSessionResourceListProps = {
  sessions: AiSessionRecord[]
  activeId: string | null
  loading: boolean
  error: string
  onRetry: () => void
  onSelect: (id: string) => void
  onCreate: () => void
  onRename: (id: string, title: string) => Promise<void>
  onBranch: (id: string) => void
  onArchive: (id: string) => Promise<void>
  onRestore: (id: string) => Promise<void>
  onPin: (id: string, pinned: boolean) => Promise<void>
  includeArchived: boolean
  onToggleArchived: () => void
  /** Manual sort mode: the list shows a single group and item drag persists order. */
  manualOrder: boolean
  onToggleManualOrder: () => void
  onReorder: (payload: ResourceListReorderPayload) => void
}

function sessionGroup(session: AiSessionRecord): { id: string; label: string } {
  const timestamp = Date.parse(session.updated_at)
  const now = new Date()
  const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  const time = Number.isFinite(timestamp) ? timestamp : 0
  if (time >= startToday) return { id: 'today', label: '今天' }
  if (time >= startToday - 86_400_000) return { id: 'yesterday', label: '昨天' }
  if (time >= startToday - 7 * 86_400_000) return { id: 'week', label: '本周' }
  return { id: 'older', label: '更早' }
}

function projectSession(session: AiSessionRecord): CompatSessionItem {
  return {
    id: session.id,
    name: session.title || '未命名会话',
    description: [session.runtime, session.model_id].filter(Boolean).join(' · '),
    session
  }
}

export function CompatSessionResourceList({
  sessions,
  activeId,
  loading,
  error,
  onRetry,
  onSelect,
  onCreate,
  onRename,
  onBranch,
  onArchive,
  onRestore,
  onPin,
  includeArchived,
  onToggleArchived,
  manualOrder,
  onToggleManualOrder,
  onReorder
}: CompatSessionResourceListProps) {
  const items = sessions.map(projectSession)
  const visibleItems = includeArchived ? items : items.filter(item => !item.session.archived)
  const status: ResourceListStatus = loading && visibleItems.length === 0 ? 'loading' : error && visibleItems.length === 0 ? 'error' : visibleItems.length === 0 ? 'empty' : 'idle'

  // The real source pin hook owns optimistic toggling: a per-id concurrency gate
  // (`togglingIds`, exposed to rows as a disabled state), an immediate optimistic
  // overlay, rollback on failure, and overlay reconciliation once the Host list
  // catches up. Reused as-is so pin behavior matches the source rail.
  const pinnedIds = useMemo(() => visibleItems.filter(item => item.session.pinned).map(item => item.id), [visibleItems])
  const pinState = useResourceListPinnedState({
    pinnedIds,
    onTogglePin: async id => {
      await onPin(id, !pinnedIds.includes(id))
    }
  })

  // Source semantics: item drag exists only outside time grouping (the source session
  // list rejects drops in time mode). Manual mode renders one group and enables drag.
  // Optimistic pins float immediately, matching the source pinned-first rail.
  const pinned = visibleItems.filter(item => pinState.isPinned(item.id))
  const unpinned = visibleItems.filter(item => !pinState.isPinned(item.id))
  const manualOrderedItems = [...pinned, ...unpinned]
  const manualGrouping = manualOrder && !includeArchived
  const groupSession = (item: CompatSessionItem): { id: string; label: string } =>
    manualGrouping ? { id: 'manual', label: '手动排序' } : sessionGroup(item.session)

  return (
    <SessionResourceList<CompatSessionItem>
      presentation="left-panel"
      items={manualGrouping ? manualOrderedItems : visibleItems}
      status={status}
      selectedId={activeId}
      getItemId={item => item.id}
      getItemLabel={item => item.name}
      groupBy={groupSession}
      defaultGroupVisibleCount={manualGrouping ? Number.POSITIVE_INFINITY : 8}
      groupLoadStep={8}
      groupEmptyLabel="暂无会话"
      groupShowMoreLabel="显示更多"
      groupCollapseLabel="收起"
      onSelectItem={onSelect}
      onReorder={manualGrouping ? onReorder : undefined}
      onRenameItem={(id, name) => {
        void onRename(id, name)
      }}>
      <ResourceList.Header
        title="会话"
        count={visibleItems.length}
        actions={
          <div className="flex items-center gap-0.5">
            <button
              type="button"
              className={'rounded px-1.5 py-1 text-[10px] ' + (manualOrder ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:bg-muted')}
              onClick={onToggleManualOrder}
              aria-pressed={manualOrder}
              aria-label={manualOrder ? '切换回时间分组' : '切换为手动排序'}>
              {manualOrder ? '手动' : '时间'}
            </button>
            <button
              type="button"
              className="inline-flex size-6 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              onClick={onCreate}
              aria-label="新建会话"
              title="新建会话">
              <Plus size={14} />
            </button>
          </div>
        }
      >
        <button type="button" className="sr-only" onClick={onToggleArchived} aria-label={includeArchived ? '隐藏已归档会话' : '显示已归档会话'} />
      </ResourceList.Header>
      <ResourceList.Search aria-label="搜索会话" placeholder="搜索会话、模型或 Runtime" />
      {error && visibleItems.length > 0 ? (
        <div role="alert" className="mx-1 mb-1 flex items-center gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 px-2 py-1.5 text-[10px] text-amber-700 dark:text-amber-300">
          <span className="min-w-0 flex-1 truncate">{error}</span>
          <button type="button" className="shrink-0 underline" onClick={onRetry}>重试</button>
        </div>
      ) : null}
      <ResourceList.Body<CompatSessionItem>
        ariaLabel="Cherry 会话列表"
        draggable={manualGrouping}
        renderItem={item => (
          <CompatSessionRow
            item={item}
            onBranch={onBranch}
            onArchive={onArchive}
            onRestore={onRestore}
            pinned={pinState.isPinned(item.id)}
            pinDisabled={pinState.togglingIds.has(item.id)}
            onTogglePin={() => {
              void pinState.togglePinned(item.id).catch(() => undefined)
            }}
            isActive={item.id === activeId}
            onRename={onRename}
          />
        )}
        errorFallback={
          <div role="alert" className="m-2 rounded-md border border-red-500/30 bg-red-500/10 p-3 text-xs text-red-600 dark:text-red-300">
            <div>{error || '会话加载失败'}</div>
            <button type="button" className="mt-2 underline" onClick={onRetry}>重试</button>
          </div>
        }
        emptyFallback={<div className="flex flex-col items-center justify-center px-4 py-8 text-center text-xs text-muted-foreground">暂无会话</div>}
      />
    </SessionResourceList>
  )
}

function CompatSessionRow({ item, onBranch, onArchive, onRestore, pinned, pinDisabled, onTogglePin, isActive, onRename }: { item: CompatSessionItem; onBranch: (id: string) => void; onArchive: (id: string) => Promise<void>; onRestore: (id: string) => Promise<void>; pinned: boolean; pinDisabled: boolean; onTogglePin: () => void; isActive: boolean; onRename: (id: string, title: string) => Promise<void> }) {
  const actions = useResourceListActions()
  const rowState = useResourceListRowState(item.id)
  const session = item.session
  const { t } = useTranslation()
  const status = session.status === 'running' ? '运行中' : session.status === 'failed' ? '失败' : session.status === 'interrupted' ? '已中断' : session.status === 'completed' ? '已完成' : '待机'
  const statusClass = session.status === 'failed' ? 'text-red-500' : session.status === 'running' ? 'text-amber-500' : 'text-muted-foreground'

  // Source `SessionItem.tsx` wraps the row in `ResourceListActionContextMenu`, resolving
  // the real action registry; the compat wrapper resolves the same registry and then
  // filters to the actions with real Grimoire handlers (see menu-actions.ts).
  const menuContext = useMemo(
    () => buildCompatSessionMenuContext({
      sessionName: item.name,
      pinned,
      isActiveInCurrentTab: isActive,
      isRenaming: rowState.renaming,
      isBusy: session.status === 'running',
      onRename: () => actions.startRename(item.id),
      onTogglePin: () => {
        if (!pinDisabled) onTogglePin()
      },
      onDelete: () => (session.archived ? onRestore(session.id) : onArchive(session.id)),
      t
    }),
    [actions, isActive, item.id, item.name, onArchive, onRestore, onTogglePin, pinDisabled, pinned, rowState.renaming, session.archived, session.id, session.status, t]
  )
  const menuActions = useMemo(() => resolveCompatSessionMenuActions(menuContext), [menuContext])
  const runMenuAction = useCallback(
    (action: Parameters<typeof runCompatSessionMenuAction>[0]) => runCompatSessionMenuAction(action, menuContext),
    [menuContext]
  )

  return (
    <ResourceListActionContextMenu item={item} actions={menuActions} onAction={runMenuAction}>
      <ResourceList.Item item={item} data-testid="compat-session-row" title={item.name}>
        <ResourceList.ItemLeadingSlot className="size-5 shrink-0 rounded-md border border-border-subtle bg-background-subtle" />
        <ResourceList.RenameField item={item} aria-label="重命名会话" autoFocus onClick={event => event.stopPropagation()} />
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
        {!rowState.renaming ? <span className={'max-w-28 truncate text-[10px] ' + statusClass}>{status}</span> : null}
        <ResourceList.ItemActions pinned={pinned}>
          <ResourceList.ItemAction
            aria-label="创建会话分支"
            title="创建会话分支"
            onClick={event => {
              event.stopPropagation()
              onBranch(session.id)
            }}>
            <GitBranch size={14} />
          </ResourceList.ItemAction>
          <ResourceList.ItemAction
            aria-label={pinned ? '取消置顶会话' : '置顶会话'}
            title={pinned ? '取消置顶会话' : '置顶会话'}
            disabled={pinDisabled}
            onClick={event => {
              event.stopPropagation()
              onTogglePin()
            }}>
            {pinned ? <PinOffIcon size={14} /> : <PinIcon size={14} />}
          </ResourceList.ItemAction>
          <ResourceList.ItemAction
            aria-label={session.archived ? '恢复会话' : '归档会话'}
            title={session.archived ? '恢复会话' : '归档会话'}
            disabled={session.status === 'running'}
            onClick={event => {
              event.stopPropagation()
              void (session.archived ? onRestore(session.id) : onArchive(session.id))
            }}>
            <Archive size={14} />
          </ResourceList.ItemAction>
        </ResourceList.ItemActions>
      </ResourceList.Item>
    </ResourceListActionContextMenu>
  )
}
