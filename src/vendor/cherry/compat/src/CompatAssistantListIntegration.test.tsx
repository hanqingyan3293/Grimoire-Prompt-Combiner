import { render, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { AssistantResourceList } from '../../source/src/renderer/components/chat/resourceList/AssistantResourceList'
import { useRawAssistantTopicsSource, deriveAssistantTopicsView } from '../../source/src/renderer/hooks/resourceViewSources'

// Integration proof: the SOURCE component fed by the SOURCE's own data hook.
//
// `AssistantResourceList` takes `assistantTopicsSource` as a PROP, not from context — an
// earlier attempt supplied it through a context provider and the component failed with
// "Cannot destructure property 'topics' of 'assistantTopicsSource'". The prop is the contract.
//
// The value is built here from the SOURCE's `useRawAssistantTopicsSource` +
// `deriveAssistantTopicsView`, so this asserts the real chain end to end:
// DataApi -> source hook -> source projection -> the source component's list.
let requested: string[] = []

beforeEach(() => {
  requested = []
  Object.defineProperty(window, 'api', {
    configurable: true,
    writable: true,
    value: {
      dataApi: {
        request: vi.fn(async (req: { path?: string }) => {
          const path = String(req?.path || '')
          requested.push(path.split('?')[0])
          if (path.startsWith('/topics')) {
            return { id: 'p', status: 200, data: { items: [
              { id: 't1', name: '主题一', assistantId: 'a1', orderKey: 'k1', lastActivityAt: '2026-01-01', createdAt: '2026-01-01', updatedAt: '2026-01-01' }
            ] } }
          }
          if (path.startsWith('/assistants')) {
            // The source's `useAssistantsApi` reads `data?.items`, so the OFFSET envelope is
            // what it consumes — a bare array makes it silently return EMPTY_ASSISTANTS.
            return { id: 'p', status: 200, data: {
              items: [
                { id: 'a1', name: '写作助手', prompt: '', description: '', emoji: '✍️', groupId: null, orderKey: 'k0', createdAt: '2026-01-01', updatedAt: '2026-01-01' }
              ],
              total: 1,
              page: 1
            } }
          }
          if (path.startsWith('/groups')) return { id: 'p', status: 200, data: [] }
          if (path.startsWith('/pins')) return { id: 'p', status: 200, data: [] }
          return { id: 'p', status: 200, data: [] }
        })
      },
      ipcApi: { request: vi.fn(async () => ({ ok: true, data: null })), on: () => () => undefined }
    }
  })
})

describe('source AssistantResourceList over the compat provider', () => {
  it('fetches assistants AND topics, then renders the assistant name', async () => {
    const errors: string[] = []
    const original = console.error
    console.error = (...args: unknown[]) => { errors.push(args.map(String).join(' ').slice(0, 200)) }

    function Harness() {
      const raw = useRawAssistantTopicsSource({ enabled: true })
      const view = deriveAssistantTopicsView(raw.topics)
      return (
        <AssistantResourceList
          activeAssistantId="a1"
          activeTopicId={null}
          assistantTopicsSource={{ ...raw, ...view, refreshError: raw.error }}
          onSelectTopic={() => true}
          onClearActiveTopic={() => undefined}
          onCreateTopic={async () => null}
        />
      )
    }
    const { container } = render(<Harness />)

    await waitFor(() => expect(requested.some(p => p === '/assistants')).toBe(true), { timeout: 5000 })
    await waitFor(() => expect(requested.some(p => p === '/topics')).toBe(true), { timeout: 5000 })
    // Wait for the ASSISTANT NAME, not a fixed delay: the first render happens before the
    // fetches resolve (observed `RAW=0` then `RAW=1`), so a fixed sleep is a race — it passed or
    // failed depending on timing rather than on behaviour.
    await waitFor(() => expect(container.textContent || '').toContain('写作助手'), { timeout: 8000 })
    console.error = original

    // The assistant name comes from the /assistants response, so its presence proves the whole
    // chain: DataApi -> useAssistantsApi -> the component's list.
    expect(container.textContent || '').toContain('写作助手')
    expect(errors.join(' ')).not.toContain('must be used within')
  }, 30000)
})
