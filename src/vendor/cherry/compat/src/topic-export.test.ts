import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Verifies the topic-export path end to end at the level that matters: the payload that
 * reaches the destination.
 *
 * The wiring is `shell exportTopic` -> source `messagesToMarkdown` -> source
 * `exportMarkdownToJoplin/Siyuan/Yuque`. A CDP click test was attempted first and abandoned:
 * the route audit's throwaway profile has no sessions, so the rail renders 暂无会话 and there
 * is no menu to click. Driving the functions directly verifies MORE than the click would — the
 * click proves a menu entry exists, this proves the exported body is the conversation.
 *
 * `fetch` is stubbed, so no network is involved and nothing leaves the machine.
 */

const settings = new Map<string, unknown>()

vi.mock('@data/PreferenceService', () => ({
  preferenceService: {
    getMultiple: async (keys: Record<string, string>) => {
      const out: Record<string, unknown> = {}
      for (const [local, key] of Object.entries(keys)) out[local] = settings.get(key)
      return out
    },
    get: async (key: string) => settings.get(key),
    set: async (key: string, value: unknown) => { settings.set(key, value) },
    getCachedValue: (key: string) => settings.get(key),
    isCached: (key: string) => settings.has(key),
    preloadAll: async () => undefined,
    subscribeChange: () => () => undefined,
    subscribeAllChanges: () => () => undefined
  }
}))

const fetchMock = vi.fn()
vi.stubGlobal('fetch', fetchMock)

// The source's toast utility needs a mounted ToastHost; without one it throws while
// RENDERING the success message — i.e. AFTER the export already reached the destination.
// That would fail these tests for a reason unrelated to what they assert, so the toasts are
// stubbed. The export's own return value is what carries success/failure here.
vi.mock('@renderer/services/toast', () => ({
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() }
}))

import { exportMarkdownToJoplin, exportMarkdownToSiyuan, messagesToMarkdown } from '../../source/src/renderer/services/ExportService'

// The exporter reads `message.parts` — a `content` string is NOT what it consumes.
// Constructing these with `content` first (which looked equivalent) is exactly the shape the
// shell was passing, and the assertion below caught that it produced empty bodies.
const MESSAGES = [
  { id: 'm1', role: 'user', parts: [{ type: 'text', text: '第一个问题' }] },
  { id: 'm2', role: 'assistant', parts: [{ type: 'text', text: '第一个回答' }] }
] as never

beforeEach(() => {
  settings.clear()
  fetchMock.mockReset()
})
afterEach(() => { settings.clear() })

describe('topic export payloads', () => {
  it('converts the conversation to markdown containing both turns', async () => {
    const markdown = await messagesToMarkdown(MESSAGES)
    expect(markdown).toContain('第一个问题')
    expect(markdown).toContain('第一个回答')
  })

  it('posts the conversation body to Joplin at the configured URL with the token', async () => {
    settings.set('data.integration.joplin.url', 'http://127.0.0.1:41184')
    settings.set('data.integration.joplin.token', 'tok-123')
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ id: 'note-1' }) })

    const result = await exportMarkdownToJoplin('我的主题', MESSAGES)

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]
    // The trailing slash is normalised, and the token travels as the query param the Joplin
    // clipper API expects.
    expect(url).toBe('http://127.0.0.1:41184/notes?token=tok-123')
    expect(init.method).toBe('POST')
    const body = JSON.parse(init.body)
    expect(body.title).toBe('我的主题')
    // The BODY is the conversation — this is the assertion a click test could not make.
    expect(body.body).toContain('第一个问题')
    expect(body.body).toContain('第一个回答')
    expect(result).toEqual({ id: 'note-1' })
  })

  it('does NOT call fetch when Joplin is unconfigured, and answers null', async () => {
    // The source shows its own "no config" toast and returns null. The important part here is
    // that nothing is sent: a half-configured export must not post to a guessed URL.
    const result = await exportMarkdownToJoplin('标题', MESSAGES)
    expect(fetchMock).not.toHaveBeenCalled()
    expect(result).toBeUndefined()
  })

  it('does NOT call fetch for Siyuan when unconfigured', async () => {
    const result = await exportMarkdownToSiyuan('标题', '内容')
    expect(fetchMock).not.toHaveBeenCalled()
    expect(result).toBe(false)
  })

  it('tests the Siyuan connection first, then creates the document', async () => {
    settings.set('data.integration.siyuan.api_url', 'http://127.0.0.1:6806')
    settings.set('data.integration.siyuan.token', 'sytok')
    settings.set('data.integration.siyuan.box_id', 'box1')
    settings.set('data.integration.siyuan.root_path', 'CherryStudio')
    fetchMock.mockImplementation(async (url: string) => {
      if (String(url).includes('lsNotebooks')) return { ok: true, json: async () => ({ code: 0, data: { notebooks: [] } }) }
      if (String(url).includes('renderSprig')) return { ok: true, json: async () => ({ code: 0, data: '/CherryStudio' }) }
      return { ok: true, json: async () => ({ code: 0, data: 'doc-1' }) }
    })

    const ok = await exportMarkdownToSiyuan('思源主题', '正文内容')

    expect(ok).toBe(true)
    const urls = fetchMock.mock.calls.map(call => String(call[0]))
    // The source validates the connection before writing — a failed check must not create a doc.
    expect(urls[0]).toContain('/api/notebook/lsNotebooks')
    expect(urls.some(u => u.includes('/api/filetree/createDocWithMd'))).toBe(true)
    const createCall = fetchMock.mock.calls.find(call => String(call[0]).includes('createDocWithMd'))
    const body = JSON.parse(createCall![1].body)
    expect(body.notebook).toBe('box1')
    expect(body.markdown).toContain('正文内容')
  })

  it('reports failure rather than success when the destination rejects the write', async () => {
    settings.set('data.integration.joplin.url', 'http://127.0.0.1:41184')
    settings.set('data.integration.joplin.token', 'tok-123')
    fetchMock.mockResolvedValue({ ok: false, json: async () => ({}) })

    // A non-ok response must NOT be reported as a successful export.
    expect(await exportMarkdownToJoplin('标题', MESSAGES)).toBeNull()
  })
})

describe('per-message export', () => {
  // The compat `messageActions.exportTo*` handlers call `messagesToMarkdown([message])` — a
  // SINGLE message wrapped in an array. These assert that shape works, because the parts bug
  // proved the exporter's input shape is not obvious from the call site.
  const ONE = { id: 'm1', role: 'assistant', parts: [{ type: 'text', text: '单条消息正文' }] } as never

  it('renders a single message body, not just its role heading', async () => {
    const markdown = await messagesToMarkdown([ONE])
    expect(markdown).toContain('单条消息正文')
  })

  it('posts that single-message body to Joplin', async () => {
    settings.set('data.integration.joplin.url', 'http://127.0.0.1:41184')
    settings.set('data.integration.joplin.token', 'tok')
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ id: 'n' }) })

    await exportMarkdownToJoplin('m1', await messagesToMarkdown([ONE]))

    const body = JSON.parse(fetchMock.mock.calls[0][1].body)
    expect(body.body).toContain('单条消息正文')
  })

  it('sends nothing when the target is unconfigured', async () => {
    await exportMarkdownToJoplin('m1', await messagesToMarkdown([ONE]))
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
