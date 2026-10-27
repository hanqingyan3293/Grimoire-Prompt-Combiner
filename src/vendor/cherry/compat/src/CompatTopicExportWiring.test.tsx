import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'
import type { AiTopicRecord } from '../../../../shared/ai-types'
import type { ResolvedAction } from '../../source/src/renderer/components/chat/actions/actionTypes'
import type { TopicActionContext } from '../../source/src/renderer/components/chat/actions/topicContextMenuActions'
import { CompatAssistantTopicRail, type CompatAssistantTopicRailProps } from './CompatAssistantTopicRail'

type TopicItem = { id: string; name: string; pinned: boolean; topic: AiTopicRecord }

vi.mock('../../source/src/renderer/components/chat/resourceList/AssistantResourceList', () => ({
  AssistantResourceList: () => null
}))

vi.mock('../../source/src/renderer/hooks/resourceViewSources', () => ({
  useRawAssistantTopicsSource: () => ({ topics: [], error: null }),
  deriveAssistantTopicsView: () => ({ topics: [] })
}))

// Only replace list plumbing: Body MUST call the production renderItem, so the
// actual rail creates CompatTopicRow and forwards (or fails to forward) its prop.
vi.mock('../../source/src/renderer/components/chat/resourceList/TopicResourceList', async () => {
  const { createContext, useContext } = await import('react')
  const Items = createContext<TopicItem[]>([])
  return {
    TopicResourceList: ({ items, children }: { items: TopicItem[]; children: ReactNode }) => (
      <Items.Provider value={items}>{children}</Items.Provider>
    ),
    TestBody: ({ renderItem }: { renderItem: (item: TopicItem) => ReactNode }) => (
      <>{useContext(Items).map(item => <div key={item.id}>{renderItem(item)}</div>)}</>
    )
  }
})

vi.mock('../../source/src/renderer/components/chat/resourceList/base', async importOriginal => {
  const actual = await importOriginal<typeof import('../../source/src/renderer/components/chat/resourceList/base')>()
  const { TestBody } = await import('../../source/src/renderer/components/chat/resourceList/TopicResourceList') as unknown as {
    TestBody: (props: { renderItem: (item: TopicItem) => ReactNode }) => ReactNode
  }
  const Container = ({ children }: { children?: ReactNode }) => <div>{children}</div>
  return {
    ...actual,
    ResourceList: {
      Header: Container,
      Search: () => null,
      Body: TestBody,
      Item: Container,
      ItemLeadingSlot: () => null,
      RenameField: () => null,
      ItemTitle: Container,
      ItemActions: Container,
      ItemAction: Container
    },
    useResourceListActions: () => ({ startRename: vi.fn() }),
    useResourceListRowState: () => ({ renaming: false })
  }
})

// Replace the portal/menu UI, not the actions or executor. Clicking a resolved
// source action calls the real row's onAction and its captured export callback.
vi.mock('../../source/src/renderer/components/chat/actions/ResourceListActionContextMenu', async () => {
  const { useState } = await import('react')
  return {
    ResourceListActionContextMenu: ({ item, actions, onAction, children }: {
      item: { id: string }
      actions: ResolvedAction<TopicActionContext>[]
      onAction: (action: ResolvedAction<TopicActionContext>) => Promise<void>
      children: ReactNode
    }) => {
      const [open, setOpen] = useState(false)
      const renderActions = (entries: ResolvedAction<TopicActionContext>[]): ReactNode => entries.map(action => (
        <div key={action.id}>
          <button type="button" disabled={!action.availability.enabled} onClick={() => void onAction(action)}>{action.id}</button>
          {renderActions(action.children)}
        </div>
      ))
      return (
        <section aria-label={`topic-row-${item.id}`} onContextMenu={event => {
          event.preventDefault()
          setOpen(true)
        }}>
          {children}
          {open && <div role="menu">{renderActions(actions)}</div>}
        </section>
      )
    }
  }
})

function topic(id: string): AiTopicRecord {
  return {
    id, session_id: 'session', parent_id: null, title: id,
    pinned: false, archived: false, metadata: {}, owner_id: 'assistant',
    created_at: '2026-10-12T00:00:00Z', updated_at: '2026-10-12T00:00:00Z'
  }
}

function railProps(): CompatAssistantTopicRailProps {
  return {
    assistants: [], topics: [topic('active-topic'), topic('export-row-topic')],
    activeAssistantId: 'assistant', activeSessionId: 'session', activeTopicId: 'active-topic',
    assistantsLoading: false, assistantsError: '', topicsLoading: false, topicsError: '',
    includeArchived: false, manualOrder: false,
    onRetryAssistants: vi.fn(), onRetryTopics: vi.fn(), onToggleArchived: vi.fn(), onToggleManualOrder: vi.fn(),
    onSelectAssistant: vi.fn(), onSelectTopic: vi.fn(),
    onCreateAssistant: vi.fn(async () => undefined), onCreateTopic: vi.fn(),
    onRenameAssistant: vi.fn(async () => undefined), onRenameTopic: vi.fn(async () => undefined),
    onArchiveAssistant: vi.fn(async () => undefined), onRestoreAssistant: vi.fn(async () => undefined),
    onPinAssistant: vi.fn(async () => undefined), onArchiveTopic: vi.fn(async () => undefined),
    onRestoreTopic: vi.fn(async () => undefined), onPinTopic: vi.fn(async () => undefined),
    onReorderAssistant: vi.fn(async () => undefined), onReorderTopic: vi.fn(async () => undefined)
  }
}

describe('Compat topic export callback wiring', () => {
  it.each([
    ['topic.export.markdown', 'markdown'],
    ['topic.export.markdown-reason', 'markdown-reason'],
    ['topic.export.joplin', 'joplin'],
    ['topic.export.siyuan', 'siyuan'],
    ['topic.export.yuque', 'yuque']
  ] as const)('exports the context-menu ROW, not the active topic, via %s', async (actionId, kind) => {
    const props = railProps()
    const onExportTopic = vi.fn(async () => undefined)
    render(<CompatAssistantTopicRail {...props} onExportTopic={onExportTopic} />)
    expect(onExportTopic).not.toHaveBeenCalled()

    const row = screen.getByRole('region', { name: 'topic-row-export-row-topic' })
    fireEvent.contextMenu(row)
    fireEvent.click(within(row).getByRole('button', { name: actionId }))

    await waitFor(() => expect(onExportTopic).toHaveBeenCalledExactlyOnceWith(kind, 'export-row-topic'))
    expect(onExportTopic).not.toHaveBeenCalledWith(kind, props.activeTopicId)
    expect(props.onSelectTopic).not.toHaveBeenCalled()
  })

  it('renders and opens row menus safely without an export callback, exposing no export actions', () => {
    const props = railProps()
    expect(() => render(<CompatAssistantTopicRail {...props} />)).not.toThrow()

    for (const id of ['active-topic', 'export-row-topic']) {
      const row = screen.getByRole('region', { name: `topic-row-${id}` })
      expect(() => fireEvent.contextMenu(row)).not.toThrow()
      const menu = within(row).getByRole('menu')
      // Non-export entries prove the menu really opened rather than passing
      // a negative assertion against an unrendered/empty list.
      expect(within(menu).getByRole('button', { name: 'topic.rename' })).toBeVisible()
      expect(within(menu).queryByRole('button', { name: /^topic\.export/ })).toBeNull()
    }
    expect(props.onSelectTopic).not.toHaveBeenCalled()
    expect(props.onArchiveTopic).not.toHaveBeenCalled()
  })
})
