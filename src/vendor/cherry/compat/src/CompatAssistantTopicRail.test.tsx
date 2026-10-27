import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { CompatAssistantTopicRail, dropAnchorFromPayload } from './CompatAssistantTopicRail'

vi.mock('../../source/src/renderer/components/chat/resourceList/ResourceEntityRail', () => ({
  ResourceEntityRail: ({ items, onSelect, onAdd, headerActions, emptyFallback, onReorder, reorderEnabled }: any) => (
    <section aria-label="assistant-rail" data-reorder={String(Boolean(reorderEnabled))} data-has-reorder={String(Boolean(onReorder))}>
      <button type="button" onClick={onAdd}>new-assistant</button>
      {headerActions}
      {items.length ? items.map((item: any) => (
        <div key={item.id}>
          <button type="button" onClick={() => onSelect(item)}>{item.name}</button>
          {item.trailingAction}
        </div>
      )) : emptyFallback}
    </section>
  )
}))

vi.mock('../../source/src/renderer/components/chat/resourceList/TopicResourceList', () => ({
  TopicResourceList: ({ children, items = [], onSelectItem, onReorder, dragCapabilities }: any) => (
    <section aria-label="topic-list" data-has-reorder={String(Boolean(onReorder))} data-items-drag={String(Boolean(dragCapabilities?.items))}>
      {children}
      <div>
        {items.map((item: any) => (
          <button key={item.id} type="button" onClick={() => onSelectItem(item.id)}>{item.name}</button>
        ))}
      </div>
    </section>
  )
}))

vi.mock('../../source/src/renderer/components/chat/resourceList/base', async importOriginal => {
  // Keep the real reorder helpers (payload→anchor contract stays under test); only the
  // heavy render surface and list actions are stubbed for this rail-level test.
  const actual = await importOriginal<typeof import('../../source/src/renderer/components/chat/resourceList/base')>()
  return {
    ...actual,
    ResourceList: {
      Header: ({ children, actions, title, count }: any) => <header>{title}{count}{actions}{children}</header>,
      Search: ({ 'aria-label': ariaLabel }: any) => <input aria-label={ariaLabel} />,
      Body: ({ renderItem }: any) => <div />,
      Item: ({ children }: any) => <div>{children}</div>,
      ItemLeadingSlot: () => null,
      RenameField: () => null,
      ItemTitle: ({ children }: any) => <span>{children}</span>,
      ItemActions: ({ children }: any) => <div>{children}</div>,
      ItemAction: ({ children, ...props }: any) => <button {...props}>{children}</button>
    },
    useResourceListActions: () => ({ startRename: vi.fn() }),
    useResourceListRowState: () => ({ renaming: false })
  }
})

describe('CompatAssistantTopicRail', () => {
  const baseProps = () => ({
    assistants: [{ id: 'a1', name: '写作助手', description: '', system_prompt: '', provider_id: '', model_id: '', avatar: '', settings: {}, sort_order: 0, created_at: '', updated_at: '', pinned: false, archived: false }],
    topics: [{ id: 't1', session_id: 's1', parent_id: null, title: '主题一', pinned: false, archived: false, metadata: {}, owner_id: 'a1', created_at: '', updated_at: '' }],
    activeAssistantId: 'a1',
    activeSessionId: 's1',
    activeTopicId: 't1',
    assistantsLoading: false,
    assistantsError: '',
    topicsLoading: false,
    topicsError: '',
    includeArchived: false,
    manualOrder: false,
    onRetryAssistants: vi.fn(),
    onRetryTopics: vi.fn(),
    onToggleArchived: vi.fn(),
    onToggleManualOrder: vi.fn(),
    onSelectAssistant: vi.fn(),
    onSelectTopic: vi.fn(),
    onCreateAssistant: vi.fn(),
    onCreateTopic: vi.fn(),
    onRenameAssistant: vi.fn(async () => undefined),
    onRenameTopic: vi.fn(async () => undefined),
    onArchiveAssistant: vi.fn(async () => undefined),
    onRestoreAssistant: vi.fn(async () => undefined),
    onPinAssistant: vi.fn(async () => undefined),
    onArchiveTopic: vi.fn(async () => undefined),
    onRestoreTopic: vi.fn(async () => undefined),
    onPinTopic: vi.fn(async () => undefined),
    onReorderAssistant: vi.fn(async () => undefined),
    onReorderTopic: vi.fn(async () => undefined)
  })

  it('routes topic selection through the compat callback', async () => {
    // The ASSISTANT half is the source component now (it renders its own rows and its own
    // add button, both covered by `CompatAssistantListIntegration.test.tsx`). What this file
    // still owns is the TOPIC half and the callbacks the shell passes in.
    const props = baseProps()
    render(<CompatAssistantTopicRail {...props} />)
    expect(screen.getByText('主题一')).toBeTruthy()

    fireEvent.click(screen.getByText('主题一'))
    await waitFor(() => expect(props.onSelectTopic).toHaveBeenCalledWith(props.topics[0]))
    // Selecting a topic must not touch the assistant selection — they are separate rails.
    expect(props.onSelectAssistant).not.toHaveBeenCalled()
  })

  it('keeps stale data visible with a refresh error and exposes retry for the TOPIC rail', () => {
    // The assistant error banner was part of the compat half that the source component
    // replaced; the source component renders its own error state.
    const props = { ...baseProps(), topicsError: '主题刷新失败' }
    render(<CompatAssistantTopicRail {...props} />)
    expect(screen.getByText('主题刷新失败')).toBeTruthy()
    fireEvent.click(screen.getAllByText('重试')[0])
    expect(props.onRetryTopics).toHaveBeenCalledOnce()
  })

  it('exposes the topic rail reorder handler only in manual mode, and never while archiving', () => {
    // The ASSISTANT half is now the source `AssistantResourceList`, which owns its own reorder
    // behaviour and is covered by `CompatAssistantListIntegration.test.tsx`. The assertions
    // that used to live here read `ResourceEntityRail`'s mock — a component the source half
    // does not use — so they were asserting wiring that no longer exists.
    const time = render(<CompatAssistantTopicRail {...baseProps()} />)
    expect(screen.getByLabelText('topic-list').getAttribute('data-has-reorder')).toBe('false')
    time.unmount()

    const manual = render(<CompatAssistantTopicRail {...baseProps()} manualOrder />)
    expect(screen.getByLabelText('topic-list').getAttribute('data-has-reorder')).toBe('true')
    expect(screen.getByLabelText('topic-list').getAttribute('data-items-drag')).toBe('true')
    manual.unmount()

    // Source rejects drag while archived rows are mixed into the list.
    render(<CompatAssistantTopicRail {...baseProps()} manualOrder includeArchived />)
    expect(screen.getByLabelText('topic-list').getAttribute('data-has-reorder')).toBe('false')
  })

  it('forwards the manual-order toggle through the TOPIC rail header', () => {
    // This used to expect TWO toggles — one per rail. The source `AssistantResourceList` keeps
    // its grouping control in the entity context menu (`assistant-entity.toggle-grouping`) and
    // drives it through the `assistant.tab.sort_type` preference, so there is only one header
    // toggle now. Asserted as exactly one rather than `>= 1`, so a second one reappearing
    // (a sign the compat half was restored by accident) fails.
    const props = { ...baseProps(), manualOrder: true }
    render(<CompatAssistantTopicRail {...props} />)
    const toggles = screen.getAllByRole('button', { name: '切换回时间排序' })
    expect(toggles).toHaveLength(1)
    fireEvent.click(toggles[0])
    expect(props.onToggleManualOrder).toHaveBeenCalledTimes(1)
  })

  it('maps source drop payloads to the anchor contract instead of array indices', () => {
    expect(dropAnchorFromPayload({
      type: 'item', activeId: 'a1', overId: 'a2', position: 'before', overType: 'item',
      sourceGroupId: 'g', targetGroupId: 'g', sourceIndex: 3, targetIndex: 0
    })).toEqual({ before: 'a2' })
    expect(dropAnchorFromPayload({
      type: 'item', activeId: 'a1', overId: 'a2', position: 'after', overType: 'item',
      sourceGroupId: 'g', targetGroupId: 'g', sourceIndex: 0, targetIndex: 3
    })).toEqual({ after: 'a2' })
    expect(dropAnchorFromPayload({
      type: 'item', activeId: 'a1', overId: 'g1', position: 'before', overType: 'group',
      sourceGroupId: 'g', targetGroupId: 'g2', sourceIndex: 0, targetIndex: 0
    })).toEqual({ position: 'last' })
  })
})
