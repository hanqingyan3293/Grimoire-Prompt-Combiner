import type { ComponentProps } from 'react'
import type { McpTool } from '../../source/src/shared/types/mcp'
import type { Topic } from '../../source/src/renderer/types/topic'
import type { MessageListState } from '../../source/src/renderer/components/chat/messages/types'
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { useMessageListUiSelectors } from '../../source/src/renderer/components/chat/messages/MessageListProvider'
import { CompatMessageListProvider } from './CompatMessageListProvider'

/**
 * These assert through the source's OWN reader (`useMessageListUiSelectors`) rather than
 * by inspecting the provider value. That is the whole point: the capability previously
 * had no path into `MessageListUiSelectorsContext`, so a test that inspected props would
 * have passed while the source consumers saw nothing.
 */
function Probe({ onRead }: { onRead: (selectors: ReturnType<typeof useMessageListUiSelectors>) => void }) {
  onRead(useMessageListUiSelectors())
  return <div data-testid="probe" />
}

const topic: Topic = {
  id: 'topic-1', assistantId: undefined, name: '', messages: [],
  lastActivityAt: '', createdAt: '', updatedAt: ''
}

function tool(name: string): McpTool {
  return { id: `s1-${name}`, name, type: 'mcp', serverId: 's1', serverName: 'Fixture server', inputSchema: { type: 'object' } }
}

function renderWith(capabilities: ComponentProps<typeof CompatMessageListProvider>['capabilities']) {
  const captured: { value?: ReturnType<typeof useMessageListUiSelectors> } = {}
  render(
    <CompatMessageListProvider
      messages={[]}
      partsByMessageId={{}}
      capabilities={capabilities}
      actions={{}}
      topic={topic}>
      <Probe onRead={(value) => { captured.value = value }} />
    </CompatMessageListProvider>
  )
  expect(screen.getByTestId('probe')).toBeTruthy()
  if (!captured.value) throw new Error('Source UI selectors were not captured')
  return captured.value
}

describe('CompatMessageListProvider', () => {
  it('exposes isToolAutoApproved to the source UI-selector consumers', () => {
    const isToolAutoApproved: NonNullable<ComponentProps<typeof CompatMessageListProvider>['capabilities']>['isToolAutoApproved'] = (tool) => tool.name === 'allowed'
    const selectors = renderWith({ isToolAutoApproved })
    // The capability must be reachable where the source leaf reads it.
    expect(selectors.isToolAutoApproved).toBe(isToolAutoApproved)
    expect(selectors.isToolAutoApproved?.(tool('allowed'))).toBe(true)
    expect(selectors.isToolAutoApproved?.(tool('other'))).toBe(false)
  })

  it('degrades to an absent capability rather than a throwing stub when not supplied', () => {
    const selectors = renderWith(undefined)
    // Absent — the source checks for the function before using it, so this renders the
    // honest "no capability" state instead of a control that does nothing.
    expect(selectors.isToolAutoApproved).toBeUndefined()
  })

  it('forwards getFileView alongside the tool capability', () => {
    const getFileView: NonNullable<MessageListState['getFileView']> = (file) => ({ displayName: file.origin_name })
    const selectors = renderWith({ getFileView })
    expect(selectors.getFileView).toBe(getFileView)
    expect(selectors.isToolAutoApproved).toBeUndefined()
  })
})
