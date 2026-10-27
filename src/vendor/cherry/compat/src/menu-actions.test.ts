import { describe, expect, it, vi } from 'vitest'
import {
  buildCompatSessionMenuContext,
  buildCompatTopicMenuContext,
  COMPAT_SESSION_MENU_ACTION_IDS,
  COMPAT_TOPIC_MENU_ACTION_IDS,
  resolveCompatSessionMenuActions,
  resolveCompatTopicMenuActions,
  runCompatSessionMenuAction
} from './menu-actions'

const t = ((key: string) => key) as never

function sessionContext(overrides: Partial<Parameters<typeof buildCompatSessionMenuContext>[0]> = {}) {
  return buildCompatSessionMenuContext({
    sessionName: '会话一',
    pinned: false,
    isActiveInCurrentTab: false,
    onRename: vi.fn(),
    onTogglePin: vi.fn(),
    onDelete: vi.fn(),
    t,
    ...overrides
  })
}

function topicContext(overrides: Partial<Parameters<typeof buildCompatTopicMenuContext>[0]> = {}) {
  return buildCompatTopicMenuContext({
    topic: { id: 't1', assistantId: '', name: '主题一', messages: [], lastActivityAt: '', createdAt: '', updatedAt: '' } as never,
    topicsLength: 1,
    pinned: false,
    isActiveInCurrentTab: true,
    onRename: vi.fn(),
    onTogglePin: vi.fn(),
    onDelete: vi.fn(),
    t,
    ...overrides
  })
}

describe('compat context-menu action allowlist', () => {
  it('resolves only Grimoire-backed session actions and keeps source labels/icons', () => {
    const actions = resolveCompatSessionMenuActions(sessionContext())
    const ids = actions.map(action => action.id).sort()
    expect(ids).toEqual([...COMPAT_SESSION_MENU_ACTION_IDS].sort())
    for (const action of actions) {
      expect(action.label).toBeTruthy()
      expect(action.icon).toBeTruthy()
    }
    // Unbacked groups never leak through.
    expect(ids).not.toContain('session.export')
    expect(ids).not.toContain('session.copy')
    expect(ids).not.toContain('session.auto-rename')
  })

  it('runs the rename command through the context startEdit callback', async () => {
    const onRename = vi.fn()
    const context = sessionContext({ onRename })
    const rename = resolveCompatSessionMenuActions(context).find(action => action.id === 'session.rename')!
    await runCompatSessionMenuAction(rename, context)
    expect(onRename).toHaveBeenCalledTimes(1)
  })

  it('routes pin and delete to their handlers and refuses unknown actions', async () => {
    const onTogglePin = vi.fn()
    const onDelete = vi.fn()
    const context = sessionContext({ onTogglePin, onDelete })
    const actions = resolveCompatSessionMenuActions(context)
    await runCompatSessionMenuAction(actions.find(action => action.id === 'session.toggle-pin')!, context)
    await runCompatSessionMenuAction(actions.find(action => action.id === 'session.delete')!, context)
    expect(onTogglePin).toHaveBeenCalledTimes(1)
    expect(onDelete).toHaveBeenCalledTimes(1)

    const forged = { ...actions[0], id: 'session.open-in-new-tab' }
    await runCompatSessionMenuAction(forged, context)
    expect(onDelete).toHaveBeenCalledTimes(1)
  })

  it('resolves only Grimoire-backed topic actions, and hides export when no handler was supplied', () => {
    // The context below provides NO export callbacks, so export must be absent even though
    // the static allowlist names it — availability is per-context, not per-list. This is the
    // behaviour the earlier version of this test could not express: it compared against the
    // static set, which said nothing about whether a handler existed.
    const actions = resolveCompatTopicMenuActions(topicContext())
    const ids = actions.map(action => action.id).sort()
    expect(ids).toEqual(['topic.delete', 'topic.pin', 'topic.rename'])
    expect(ids).not.toContain('topic.export')
    expect(ids).not.toContain('topic.clear-messages')
    expect(ids).not.toContain('topic.move-to-assistant')
    expect(ids).not.toContain('topic.copy')
  })

  it('shows exactly the export entries whose handler was supplied', () => {
    // Partial provision is the interesting case: the menu must not show an entry for a
    // callback the caller did not pass, and must not hide one it did.
    const actions = resolveCompatTopicMenuActions(topicContext({ onExportJoplin: vi.fn(), onExportMarkdown: vi.fn() }))
    const ids = actions.flatMap(action => [action.id, ...action.children.map(child => child.id)]).sort()
    expect(ids).toContain('topic.export.joplin')
    expect(ids).toContain('topic.export.markdown')
    expect(ids).not.toContain('topic.export.siyuan')
    expect(ids).not.toContain('topic.export.yuque')
    expect(ids).not.toContain('topic.export.notion')
  })

  it('drops the export parent when no export handler was supplied', () => {
    // An empty submenu is visibly broken; the parent must go with its children.
    const actions = resolveCompatTopicMenuActions(topicContext())
    expect(actions.some(action => action.id === 'topic.export')).toBe(false)
    const withExport = resolveCompatTopicMenuActions(topicContext({ onExportYuque: vi.fn() }))
    expect(withExport.some(action => action.id === 'topic.export')).toBe(true)
  })

  it('drives topic rename/pin/delete handlers', async () => {
    const onRename = vi.fn()
    const onTogglePin = vi.fn()
    const onDelete = vi.fn()
    const context = topicContext({ onRename, onTogglePin, onDelete })
    const actions = resolveCompatTopicMenuActions(context)
    const { runCompatTopicMenuAction } = await import('./menu-actions')
    await runCompatTopicMenuAction(actions.find(action => action.id === 'topic.rename')!, context)
    await runCompatTopicMenuAction(actions.find(action => action.id === 'topic.pin')!, context)
    await runCompatTopicMenuAction(actions.find(action => action.id === 'topic.delete')!, context)
    expect(onRename).toHaveBeenCalledTimes(1)
    expect(onTogglePin).toHaveBeenCalledTimes(1)
    expect(onDelete).toHaveBeenCalledTimes(1)
  })
})
