import { useMemo, type ReactNode } from 'react'

import { useMessageActivityState } from '../../source/src/renderer/components/chat/messages/hooks/useMessageActivityState'
import { MessageListProvider } from '../../source/src/renderer/components/chat/messages/MessageListProvider'
import type {
  MessageListActions,
  MessageListItem,
  MessageListProviderValue,
  MessageRenderConfig,
  MessageListState
} from '../../source/src/renderer/components/chat/messages/types'
import { defaultMessageRenderConfig } from '../../source/src/renderer/components/chat/messages/types'
import type { CherryMessagePart } from '../../source/src/shared/data/types/message'
import type { Topic } from '../../source/src/renderer/types/topic'

/**
 * Compat message-list provider.
 *
 * The source `MessageContentProvider` is the convenience wrapper for the narrow case: it
 * builds a `MessageListState` from a handful of fields and forwards `actions`. That is
 * enough for the list to render, but it CANNOT carry the UI-selector capabilities —
 * `isToolAutoApproved` in particular — because it neither accepts them as props nor
 * forwards them into the state it builds.
 *
 * This module does what the source's own page adapters do (`agentMessageListAdapter`,
 * `homeMessageListAdapter`): mount `MessageListProvider` directly with a full state that
 * includes those capabilities. The extra fields beyond the required minimum are exactly
 * the ones the compat window can answer, and everything else keeps the same defaults the
 * narrow wrapper used, so the rendered result is unchanged apart from the capabilities
 * being present.
 *
 * `isToolAutoApproved` is the reason this exists: without it the source `MessageMcpTool`
 * always renders its approval affordance and never the auto-approved badge — and, more
 * importantly, `willAwaitApproval` cannot know that a tool is already allowed, so the
 * card would keep asking for a permission the user had permanently granted.
 */

type CompatCapabilities = {
  /** Source `isToolAutoApproved` — see `permission-actions.ts` for the rule. */
  isToolAutoApproved?: (tool: { name?: unknown; serverId?: unknown }, allowedTools?: string[]) => boolean
  getFileView?: MessageListState['getFileView']
}

type Props = {
  messages: MessageListItem[]
  partsByMessageId: Record<string, CherryMessagePart[]>
  actions?: MessageListActions
  topic?: Topic
  renderConfig?: Partial<MessageRenderConfig>
  capabilities?: CompatCapabilities
  children: ReactNode
}

/**
 * Minimal topic shape for a message list with no owning topic row. Mirrors the source
 * `MessageContentProvider`'s private `createFallbackTopic`: the id is derived from the
 * first message so the activity store keys on something stable rather than on each
 * render.
 */
function fallbackTopic(messages: MessageListItem[]): Topic {
  const first = messages[0]
  return {
    id: first?.topicId || 'standalone-message-content',
    assistantId: first?.assistantId || '',
    name: '',
    lastActivityAt: first?.updatedAt || first?.createdAt || '',
    createdAt: first?.createdAt || '',
    updatedAt: first?.updatedAt || '',
    messages: []
  } as unknown as Topic
}

const EMPTY_ACTIONS: MessageListActions = {}

export function CompatMessageListProvider({
  messages,
  partsByMessageId,
  actions,
  topic,
  renderConfig,
  capabilities,
  children
}: Props) {
  const resolvedActions = actions ?? EMPTY_ACTIONS
  const resolvedTopic = useMemo(() => topic ?? fallbackTopic(messages), [topic, messages])
  const messageActivity = useMessageActivityState(resolvedTopic.id)
  const mergedRenderConfig = useMemo(
    () => ({ ...defaultMessageRenderConfig, ...renderConfig }),
    [renderConfig]
  )

  const value = useMemo<MessageListProviderValue>(
    () => ({
      state: {
        topic: resolvedTopic,
        messages,
        partsByMessageId,
        hasOlder: false,
        messageNavigation: 'none',
        estimateSize: 0,
        overscan: 0,
        loadOlderDelayMs: 0,
        loadingResetDelayMs: 0,
        renderConfig: mergedRenderConfig,
        selection: { enabled: false, isMultiSelectMode: false, selectedMessageIds: [] },
        getMessageActivityState: messageActivity.getMessageActivityState,
        messageActivityStore: messageActivity.store,
        // The capability this wrapper exists for, plus the file-view resolver the source
        // leaf reads. Both are optional in the state type, so an absent one degrades to
        // the same behaviour the narrow wrapper had rather than to a broken UI.
        ...(capabilities?.isToolAutoApproved ? { isToolAutoApproved: capabilities.isToolAutoApproved } : {}),
        ...(capabilities?.getFileView ? { getFileView: capabilities.getFileView } : {})
      },
      actions: resolvedActions,
      meta: { selectionLayer: false }
    }),
    [capabilities, mergedRenderConfig, messageActivity, messages, partsByMessageId, resolvedActions, resolvedTopic]
  )

  return <MessageListProvider value={value}>{children}</MessageListProvider>
}
