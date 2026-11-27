import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Import the real main entrypoint, but hold whenReady and stub unrelated IPC /
// services. These tests exercise the actual before-quit wiring without opening
// a window, spawning a worker/runtime, or reading a user database.
const io = vi.hoisted(() => ({ on: vi.fn(), whenReady: vi.fn(), quit: vi.fn(), window: Object.assign(vi.fn(), { getAllWindows: () => [] }), legacyStop: vi.fn(), drain: vi.fn(), worker: vi.fn(), sessions: vi.fn(), close: vi.fn(), log: vi.fn(), errorBox: vi.fn(), boot: vi.fn(), privileges: vi.fn() }))
vi.mock('electron', () => ({ app: { requestSingleInstanceLock: () => true, on: io.on, whenReady: io.whenReady, quit: io.quit, getPath: () => 'r6-isolated-fixture', disableHardwareAcceleration: vi.fn() }, BrowserWindow: io.window, WebContentsView: vi.fn(), ipcMain: { handle: vi.fn(), on: vi.fn() }, Menu: {}, dialog: { showErrorBox: io.errorBox }, shell: {}, nativeTheme: {}, screen: {} }))
vi.mock('../database', () => ({ initDatabase: vi.fn(), closeDatabase: io.close, getDatabase: vi.fn(), importDefaultTags: vi.fn(), saveDatabase: vi.fn(), exportDatabase: vi.fn(), importDatabase: vi.fn() }))
vi.mock('./task-runner', () => ({ taskRunner: { stop: io.legacyStop, stopAndWait: io.drain, start: vi.fn() } }))
vi.mock('./wd14-worker', () => ({ wd14Worker: { stop: io.worker }, clearWD14ModelDirectory: vi.fn(), clearWD14PythonPath: vi.fn(), configureWD14ModelDirectory: vi.fn(), configureWD14PythonPath: vi.fn() }))
vi.mock('../ipc/ai-sessions.ipc', () => ({ registerAiSessionsIPC: vi.fn(), shutdownAiSessions: io.sessions }))
vi.mock('./logger.service', () => ({ logError: vi.fn(), logEvent: io.log, getErrorLogs: vi.fn() }))
vi.mock('./boot-config.service', () => ({ applyBootConfig: io.boot, defaultDatabasePathFor: () => 'r6-isolated-fixture.db' }))
vi.mock('./local-asset-protocol.service', () => ({ registerLocalAssetProtocol: vi.fn(), registerLocalAssetSchemePrivileges: io.privileges }))
vi.mock('./file-bridge.service', () => ({ assertNotManagedTarget: vi.fn() }))
vi.mock('./open-link.service', () => ({ openWebLink: vi.fn() }))
vi.mock('./cherry-navigation.service', () => ({ registerCherryNavigationWindow: vi.fn() }))
vi.mock('./mcp-cache-bridge.service', () => ({ registerMcpCacheBridgeIPC: vi.fn() }))
vi.mock('./default-prompt-assets.service', () => ({ defaultPromptAssetRoot: vi.fn(), importDefaultPromptAssets: vi.fn(), seedDefaultPromptAssetCategories: vi.fn() }))
vi.mock('./comfy-client', () => ({ configureComfyUI: vi.fn() }))
vi.mock('./clip-worker', () => ({ configureClipModelDirectory: vi.fn(), configureClipPythonPath: vi.fn() }))
vi.mock('./task-repository', () => ({ markInterruptedTasks: vi.fn() }))
vi.mock('../ipc/tags.ipc', () => ({ registerTagsIPC: vi.fn() }))
vi.mock('../ipc/presets.ipc', () => ({ registerPresetsIPC: vi.fn() }))
vi.mock('../ipc/history.ipc', () => ({ registerHistoryIPC: vi.fn() }))
vi.mock('../ipc/settings.ipc', () => ({ registerSettingsIPC: vi.fn() }))
vi.mock('../ipc/selection.ipc', () => ({ registerSelectionAssistantIPC: vi.fn(), setSelectionWindowOpener: vi.fn() }))
vi.mock('../ipc/theme.ipc', () => ({ registerThemeIPC: vi.fn() }))
vi.mock('../ipc/images.ipc', () => ({ registerImagesIPC: vi.fn() }))
vi.mock('../ipc/favorites.ipc', () => ({ registerFavoritesIPC: vi.fn() }))
vi.mock('../ipc/providers.ipc', () => ({ registerProvidersIPC: vi.fn() }))
vi.mock('../ipc/tagGroups.ipc', () => ({ registerTagGroupsIPC: vi.fn() }))
vi.mock('../ipc/ai.ipc', () => ({ registerAIIPC: vi.fn() }))
vi.mock('../ipc/chat.ipc', () => ({ registerChatIPC: vi.fn() }))
vi.mock('../ipc/migration.ipc', () => ({ registerMigrationIPC: vi.fn() }))
vi.mock('../ipc/tasks.ipc', () => ({ registerTasksIPC: vi.fn() }))
vi.mock('../ipc/wd14.ipc', () => ({ registerWD14IPC: vi.fn() }))
vi.mock('../ipc/comfy.ipc', () => ({ registerComfyIPC: vi.fn() }))
vi.mock('../ipc/canvas.ipc', () => ({ registerCanvasIPC: vi.fn() }))
vi.mock('../ipc/prompt-assets.ipc', () => ({ registerPromptAssetsIPC: vi.fn() }))
vi.mock('../ipc/workspace.ipc', () => ({ registerWorkspaceIPC: vi.fn() }))
vi.mock('../ipc/agent.ipc', () => ({ registerAgentIPC: vi.fn() }))
vi.mock('../ipc/novelai.ipc', () => ({ registerNovelaiIPC: vi.fn() }))
vi.mock('../ipc/screenshot.ipc', () => ({ registerScreenshotIPC: vi.fn() }))
vi.mock('../ipc/tag-intelligence.ipc', () => ({ registerTagIntelligenceIPC: vi.fn() }))
vi.mock('../ipc/media.ipc', () => ({ registerMediaIPC: vi.fn() }))
vi.mock('../ipc/ai-attachments.ipc', () => ({ registerAiAttachmentsIPC: vi.fn() }))
vi.mock('../ipc/cherry-assistant.ipc', () => ({ registerCherryAssistantIPC: vi.fn() }))
vi.mock('../ipc/file-bridge.ipc', () => ({ registerFileBridgeIPC: vi.fn() }))
vi.mock('../ipc/cherry-data-api.ipc', () => ({ registerCherryDataApiIPC: vi.fn() }))

function barrier() {
  let resolve!: () => void; let reject!: (error: unknown) => void
  const promise = new Promise<void>((yes, no) => { resolve = yes; reject = no })
  void promise.catch(() => undefined) // Test-owned operation may be unused by the RED main entry.
  return { promise, resolve, reject }
}
let tasks = barrier(); let worker = barrier(); let sessions = barrier(); let quit = barrier(); let reported = barrier()
let order: string[] = []; let finalQuitPrevented = true
const processEvents = ['uncaughtException', 'unhandledRejection'] as const
let ownedListeners: Array<{ event: typeof processEvents[number]; listener: (...args: any[]) => void }> = []
function requestQuit() {
  const event = { preventDefault: vi.fn() }
  const handler = io.on.mock.calls.find(([name]) => name === 'before-quit')![1] as (event: { preventDefault(): void }) => void
  handler(event)
  return event
}
beforeEach(async () => {
  vi.resetModules(); vi.clearAllMocks()
  tasks = barrier(); worker = barrier(); sessions = barrier(); quit = barrier(); reported = barrier(); order = []; finalQuitPrevented = true
  io.whenReady.mockReturnValue(new Promise<void>(() => {})); io.boot.mockReturnValue({ databasePath: 'r6-isolated-fixture.db' })
  io.drain.mockImplementation(() => { order.push('tasks-start'); return tasks.promise.then(() => { order.push('tasks-drained') }) })
  io.worker.mockImplementation(() => { order.push('worker-start'); return worker.promise.then(() => { order.push('worker-stopped') }) })
  io.sessions.mockImplementation(() => { order.push('sessions-start'); return sessions.promise.then(() => { order.push('sessions-stopped') }) })
  io.close.mockImplementation(() => { order.push('database-close') })
  io.errorBox.mockImplementation(() => { reported.resolve() })
  io.quit.mockImplementation(() => { order.push('app-quit'); finalQuitPrevented = requestQuit().preventDefault.mock.calls.length !== 0; quit.resolve() })
  const before = new Map(processEvents.map(event => [event, new Set(process.listeners(event))]))
  await import('../index')
  ownedListeners = processEvents.flatMap(event => process.listeners(event).filter(listener => !before.get(event)!.has(listener)).map(listener => ({ event, listener })))
})
afterEach(async () => {
  tasks.resolve(); worker.resolve(); sessions.resolve()
  await Promise.allSettled([tasks.promise, worker.promise, sessions.promise])
  for (const { event, listener } of ownedListeners) process.removeListener(event, listener)
  ownedListeners = []; vi.restoreAllMocks()
})

describe('real main before-quit / tested shutdown coordinator (C1 R6)', () => {
  it('waits for task drain as well as worker and session shutdown before database close and app.quit', async () => {
    expect(requestQuit().preventDefault).toHaveBeenCalledOnce()
    expect(io.drain).toHaveBeenCalledOnce()
    expect(io.worker).toHaveBeenCalledOnce(); expect(io.sessions).toHaveBeenCalledOnce()
    worker.resolve(); sessions.resolve(); await Promise.all([worker.promise, sessions.promise])
    expect(io.close).not.toHaveBeenCalled(); expect(io.quit).not.toHaveBeenCalled()
    tasks.resolve(); await quit.promise
    expect(order.indexOf('tasks-drained')).toBeLessThan(order.indexOf('database-close'))
    expect(order.indexOf('worker-stopped')).toBeLessThan(order.indexOf('database-close'))
    expect(order.indexOf('sessions-stopped')).toBeLessThan(order.indexOf('database-close'))
    expect(order.indexOf('database-close')).toBeLessThan(order.indexOf('app-quit'))
    expect(finalQuitPrevented).toBe(false)
  })

  it('prevents a second quit during drain instead of letting isQuitting bypass the unfinished task', () => {
    requestQuit()
    expect(requestQuit().preventDefault).toHaveBeenCalledOnce()
    expect(io.drain).toHaveBeenCalledOnce(); expect(io.worker).toHaveBeenCalledOnce(); expect(io.sessions).toHaveBeenCalledOnce()
    expect(io.close).not.toHaveBeenCalled(); expect(io.quit).not.toHaveBeenCalled()
  })

  it('keeps the original database and reports the exact ACK drain rejection, then permits a later retry', async () => {
    requestQuit(); expect(io.drain).toHaveBeenCalledOnce()
    const error = Object.assign(new Error('TASK_ACK_PERSIST_PENDING: real ACK owner fixture'), { code: 'TASK_ACK_PERSIST_PENDING' })
    tasks.reject(error); worker.resolve(); sessions.resolve(); await reported.promise
    expect(io.close).not.toHaveBeenCalled(); expect(io.quit).not.toHaveBeenCalled()
    expect(io.log).toHaveBeenCalledWith('error', 'application', expect.any(String), expect.objectContaining({ errorCode: error.code, context: error.message }))
    expect(io.errorBox).toHaveBeenCalledWith(expect.any(String), error.message)
    io.drain.mockResolvedValue(undefined)
    expect(requestQuit().preventDefault).toHaveBeenCalledOnce(); await quit.promise
    expect(io.drain).toHaveBeenCalledTimes(2); expect(io.close).toHaveBeenCalledOnce(); expect(io.quit).toHaveBeenCalledOnce()
  })

  it.each(['worker', 'sessions'] as const)('still drains every owner and keeps the database when %s stop throws synchronously', async boundary => {
    const error = new Error(boundary + ' synchronous stop fixture')
    io[boundary].mockImplementation(() => { throw error })
    expect(() => requestQuit()).not.toThrow()
    expect(io.drain).toHaveBeenCalledOnce(); expect(io.sessions).toHaveBeenCalledOnce(); expect(io.worker).toHaveBeenCalledOnce()
    tasks.resolve(); worker.resolve(); sessions.resolve(); await reported.promise
    expect(io.close).not.toHaveBeenCalled(); expect(io.quit).not.toHaveBeenCalled()
    expect(io.errorBox).toHaveBeenCalledWith(expect.any(String), error.message)
  })

  it('preserves task/ACK rejection priority when another shutdown also rejects', async () => {
    requestQuit(); expect(io.drain).toHaveBeenCalledOnce()
    const ackError = Object.assign(new Error('real ACK persistence owner'), { code: 'TASK_ACK_PERSIST_PENDING' })
    tasks.reject(ackError); worker.reject(new Error('worker shutdown fixture')); sessions.resolve(); await reported.promise
    expect(io.close).not.toHaveBeenCalled(); expect(io.quit).not.toHaveBeenCalled()
    expect(io.errorBox).toHaveBeenCalledWith(expect.any(String), ackError.message)
  })

  it('keeps the single-instance boot context and defers createWindow until whenReady', () => {
    expect(io.boot).toHaveBeenCalledWith(expect.objectContaining({ databasePath: 'r6-isolated-fixture.db', apply: expect.any(Function) }))
    expect(io.privileges).toHaveBeenCalledOnce(); expect(io.whenReady).toHaveBeenCalledOnce(); expect(io.window).not.toHaveBeenCalled()
    expect(io.on.mock.calls.map(([event]) => event)).toEqual(expect.arrayContaining(['second-instance', 'before-quit', 'window-all-closed', 'activate']))
  })
})
