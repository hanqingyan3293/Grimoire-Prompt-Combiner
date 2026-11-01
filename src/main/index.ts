// 魔导书 Grimoire v7 — Electron 主进程入口
import { app, BrowserWindow, WebContentsView, ipcMain, Menu, dialog, shell, nativeTheme, screen } from "electron"
import { assertNotManagedTarget } from './services/file-bridge.service'
import path from "path"
import fs from "fs"
import { initDatabase, closeDatabase, getDatabase, importDefaultTags, saveDatabase, exportDatabase, importDatabase } from "./database"
import { registerTagsIPC } from "./ipc/tags.ipc"
import { registerPresetsIPC } from "./ipc/presets.ipc"
import { registerHistoryIPC } from "./ipc/history.ipc"
import { registerSettingsIPC } from "./ipc/settings.ipc"
import { registerSelectionAssistantIPC, setSelectionWindowOpener } from "./ipc/selection.ipc"
import { registerThemeIPC } from "./ipc/theme.ipc"
import { registerImagesIPC } from "./ipc/images.ipc"
import { registerFavoritesIPC } from "./ipc/favorites.ipc"
import { registerProvidersIPC } from "./ipc/providers.ipc"
import { registerTagGroupsIPC } from "./ipc/tagGroups.ipc"
import { registerAIIPC } from "./ipc/ai.ipc"
import { registerChatIPC } from "./ipc/chat.ipc"
import { registerMigrationIPC } from "./ipc/migration.ipc"
import { registerTasksIPC } from "./ipc/tasks.ipc"
import { registerWD14IPC } from "./ipc/wd14.ipc"
import { registerComfyIPC } from "./ipc/comfy.ipc"
import { registerCanvasIPC } from "./ipc/canvas.ipc"
import { registerPromptAssetsIPC } from "./ipc/prompt-assets.ipc"
import { registerWorkspaceIPC } from "./ipc/workspace.ipc"
import { registerAgentIPC } from "./ipc/agent.ipc"
import { registerNovelaiIPC } from "./ipc/novelai.ipc"
import { registerScreenshotIPC } from "./ipc/screenshot.ipc"
import { applyBootConfig, defaultDatabasePathFor } from "./services/boot-config.service"
import { openWebLink } from "./services/open-link.service"
import { registerAiSessionsIPC, shutdownAiSessions } from "./ipc/ai-sessions.ipc"
import { registerTagIntelligenceIPC } from './ipc/tag-intelligence.ipc'
import { registerMediaIPC } from './ipc/media.ipc'
import { registerAiAttachmentsIPC } from './ipc/ai-attachments.ipc'
import { registerCherryAssistantIPC } from './ipc/cherry-assistant.ipc'
import { registerFileBridgeIPC } from './ipc/file-bridge.ipc'
import { registerCherryDataApiIPC } from './ipc/cherry-data-api.ipc'
import { registerCherryNavigationWindow } from './services/cherry-navigation.service'
import { registerMcpCacheBridgeIPC } from './services/mcp-cache-bridge.service'
import { importDefaultPromptAssets, seedDefaultPromptAssetCategories } from './services/default-prompt-assets.service'
import { configureComfyUI } from './services/comfy-client'
import { requireHttpUrl } from './services/input-validation'
import { taskRunner } from "./services/task-runner"
import { clearWD14ModelDirectory, clearWD14PythonPath, configureWD14ModelDirectory, configureWD14PythonPath, wd14Worker } from "./services/wd14-worker"
import { configureClipModelDirectory, configureClipPythonPath } from "./services/clip-worker"
import { markInterruptedTasks } from "./services/task-repository"
import { logError, logEvent, getErrorLogs } from "./services/logger.service"
import { IPC_CHANNELS } from "../shared/types"
import { isWorkspacePopoutType } from '../shared/workspace-panels'

let mainWindow: BrowserWindow | null = null
let settingsWindow: BrowserWindow | null = null
let aiWindow: BrowserWindow | null = null
let cherryWindow: BrowserWindow | null = null
const workspacePopouts = new Map<string, BrowserWindow>()
const hasSingleInstanceLock = app.requestSingleInstanceLock()

if (!hasSingleInstanceLock) {
  app.quit()
}


function getPreloadPath(): string {
  return path.join(__dirname, "../preload/index.js")
}

function getRendererURL(hash: string): string {
  const devServerUrl = process.env.VITE_DEV_SERVER_URL || (!app.isPackaged ? 'http://localhost:5173' : '')
  if (devServerUrl) {
    return devServerUrl.replace(/\/$/, '') + "/#" + hash
  }
  return "file://" + path.join(__dirname, "../../renderer/index.html") + "#" + hash
}

// Selection assistant popup (M3): frameless, always-on-top, positioned next to the cursor. Created lazily
// and hidden on blur rather than destroyed, so pressing the shortcut repeatedly stays instant.
let selectionWindow: BrowserWindow | null = null

function openSelectionAssistantWindow(): void {
  const cursor = screen.getCursorScreenPoint()
  if (!selectionWindow || selectionWindow.isDestroyed()) {
    selectionWindow = new BrowserWindow({
      width: 380, height: 240, frame: false, alwaysOnTop: true, skipTaskbar: true, resizable: false, show: false,
      webPreferences: { preload: getPreloadPath(), contextIsolation: true, nodeIntegration: false, sandbox: true },
    })
    selectionWindow.setAlwaysOnTop(true, 'screen-saver')
    configureWindowSecurity(selectionWindow)
    void selectionWindow.loadURL(getRendererURL('selection-assistant')).catch(error => {
      logEvent('error', 'selection', '划词助手窗口加载失败', { context: error instanceof Error ? error.message : String(error) })
    })
    selectionWindow.on('blur', () => { if (selectionWindow && !selectionWindow.isDestroyed()) selectionWindow.hide() })
  }
  const display = screen.getDisplayNearestPoint(cursor)
  const area = display.workArea
  const x = Math.min(Math.max(cursor.x - 190, area.x + 8), area.x + area.width - 388)
  const y = Math.min(Math.max(cursor.y + 16, area.y + 8), area.y + area.height - 248)
  selectionWindow.setBounds({ x, y, width: 380, height: 240 })
  selectionWindow.showInactive()
}

function configureWindowSecurity(window: BrowserWindow): void {
  const rendererDevUrl = process.env.VITE_DEV_SERVER_URL || (!app.isPackaged ? 'http://localhost:5173' : '')
  const developmentOrigin = rendererDevUrl ? new URL(rendererDevUrl).origin : null
  const isAllowedRendererUrl = (url: string): boolean => {
    if (url.startsWith('file://')) return true
    return developmentOrigin !== null && (url === developmentOrigin || url.startsWith(developmentOrigin + '/'))
  }

  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  window.webContents.on('will-navigate', (event, url) => {
    if (!isAllowedRendererUrl(url)) {
      event.preventDefault()
      if (/^https?:\/\//i.test(url)) void shell.openExternal(url).catch(() => {})
    }
  })
}

function registerSystemIPC(): void {
  ipcMain.handle(IPC_CHANNELS.OPEN_EXTERNAL, async (_event, url: unknown) => {
    if (typeof url !== 'string') throw new Error('外部地址无效')
    const parsed = new URL(url)
    if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('仅允许打开 HTTP 或 HTTPS 地址')
    await shell.openExternal(parsed.toString())
    return true
  })
  ipcMain.handle(IPC_CHANNELS.SHELL_SHOW_ITEM, async (_event, filePath: unknown) => {
    if (typeof filePath !== 'string' || !filePath.trim()) throw new Error('文件路径无效')
    const resolved = path.resolve(filePath)
    if (!fs.existsSync(resolved)) throw new Error('文件不存在')
    shell.showItemInFolder(resolved)
    return true
  })
}

function broadcastDatabaseReload(): void {
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) {
      window.webContents.send('db:reloaded')
      window.webContents.send('data:refresh')
    }
  }
}

function applyPersistedIntegrationSettings(): void {
  const database = getDatabase()
  configureComfyUI('http://127.0.0.1:8188')
  clearWD14ModelDirectory()
  clearWD14PythonPath()
  const comfySetting = database.exec("SELECT value FROM settings WHERE key='comfyui_base_url'")
  const savedComfyUrl = comfySetting[0]?.values?.[0]?.[0]
  if (typeof savedComfyUrl === 'string') {
    try { configureComfyUI(requireHttpUrl(savedComfyUrl, 'ComfyUI 地址')) } catch (error) { logEvent('warn', 'comfyui', 'Saved ComfyUI address ignored', { context: error instanceof Error ? error.message : String(error), errorCode: 'COMFY_CONFIG_INVALID', retryable: false }) }
  }
  const wd14Setting = database.exec("SELECT value FROM settings WHERE key='wd14_model_directory'")
  const savedWD14Directory = wd14Setting[0]?.values?.[0]?.[0]
  if (typeof savedWD14Directory === 'string' && savedWD14Directory.trim()) {
    try { configureWD14ModelDirectory(savedWD14Directory) } catch (error) { logEvent('warn', 'wd14', 'Saved WD14 model directory ignored', { context: error instanceof Error ? error.message : String(error), errorCode: 'WD14_CONFIG_INVALID', retryable: false }) }
  }
  const wd14PythonSetting = database.exec("SELECT value FROM settings WHERE key='wd14_python_path'")
  const savedWD14PythonPath = wd14PythonSetting[0]?.values?.[0]?.[0]
  if (typeof savedWD14PythonPath === 'string' && savedWD14PythonPath.trim()) {
    try { configureWD14PythonPath(savedWD14PythonPath) } catch (error) { logEvent('warn', 'wd14', 'Saved WD14 Python path ignored', { context: error instanceof Error ? error.message : String(error), errorCode: 'WD14_PYTHON_CONFIG_INVALID', retryable: false }) }
  }
  // CLIP sidecar 配置沿用 wd14 的持久化模式（相似图语义检索用）。
  const clipSetting = database.exec("SELECT value FROM settings WHERE key='clip_model_directory'")
  const savedClipDirectory = clipSetting[0]?.values?.[0]?.[0]
  if (typeof savedClipDirectory === 'string' && savedClipDirectory.trim()) {
    try { configureClipModelDirectory(savedClipDirectory) } catch (error) { logEvent('warn', 'clip', 'Saved CLIP model directory ignored', { context: error instanceof Error ? error.message : String(error), errorCode: 'CLIP_CONFIG_INVALID', retryable: false }) }
  }
  const clipPythonSetting = database.exec("SELECT value FROM settings WHERE key='clip_python_path'")
  const savedClipPythonPath = clipPythonSetting[0]?.values?.[0]?.[0]
  if (typeof savedClipPythonPath === 'string' && savedClipPythonPath.trim()) {
    try { configureClipPythonPath(savedClipPythonPath) } catch (error) { logEvent('warn', 'clip', 'Saved CLIP Python path ignored', { context: error instanceof Error ? error.message : String(error), errorCode: 'CLIP_PYTHON_CONFIG_INVALID', retryable: false }) }
  }
}

async function replaceDatabase(importPath: string): Promise<void> {
  await taskRunner.stopAndWait()
  try {
    await wd14Worker.stop()
    importDatabase(importPath)
    applyPersistedIntegrationSettings()
    markInterruptedTasks()
    broadcastDatabaseReload()
  } finally {
    taskRunner.start()
  }
}

function createSettingsWindow(): void {
  if (settingsWindow && !settingsWindow.isDestroyed()) {
    settingsWindow.focus()
    return
  }
  settingsWindow = new BrowserWindow({
    width: 900, height: 680, minWidth: 680, minHeight: 520,
    title: "设置 - 魔导书",
    parent: mainWindow || undefined,
    autoHideMenuBar: true,
    webPreferences: {
      preload: getPreloadPath(),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })
  configureWindowSecurity(settingsWindow)
  settingsWindow.loadURL(getRendererURL("settings"))
  settingsWindow.on("closed", () => { settingsWindow = null })
  settingsWindow.on('focus', () => {
    settingsWindow?.webContents.send('window:focused')
  })
}

function createAIWindow(): void {
  if (aiWindow && !aiWindow.isDestroyed()) {
    aiWindow.focus()
    return
  }
  aiWindow = new BrowserWindow({
    width: 1000, height: 700, minWidth: 700, minHeight: 500,
    title: "AI 助手 - 魔导书",
    parent: mainWindow || undefined,
    autoHideMenuBar: true,
    webPreferences: {
      preload: getPreloadPath(),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })
  configureWindowSecurity(aiWindow)
  aiWindow.loadURL(getRendererURL("ai"))
  aiWindow.on("closed", () => { aiWindow = null })
  aiWindow.on('focus', () => {
    aiWindow?.webContents.send('window:focused')
  })
}

function getCherryCompatPath(): string {
  if (app.isPackaged) return path.join(__dirname, '../../cherry-compat/index.html')
  if (process.env.GRIMOIRE_CHERRY_ENTRY === 'source-shell') {
    return path.join(process.cwd(), 'src/vendor/cherry/compat/dist-source-shell/source-shell.html')
  }
  return path.join(process.cwd(), 'src/vendor/cherry/compat/dist/index.html')
}

// Filled by the visual-capture seeding block; read by `runVisualCapture` so its state frames
// can navigate to the seeded sessions. Declared here because the seeding happens inside the
// boot routine while the capture runs later, from the window's load completion.
let visualStateSessionIds: Record<string, string> | undefined
let visualStateSessionTitles: Record<string, string> | undefined

function createCherryWindow(): void {
  if (cherryWindow && !cherryWindow.isDestroyed()) {
    cherryWindow.focus()
    return
  }
  cherryWindow = new BrowserWindow({
    width: 1280, height: 800, minWidth: 960, minHeight: 640,
    title: '魔导书 · 智能工作区',
    parent: mainWindow || undefined,
    autoHideMenuBar: true,
    webPreferences: {
      preload: getPreloadPath(),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })
  configureWindowSecurity(cherryWindow)
  // Register the authentic source-shell sender before loadFile so navigation readiness
  // and open-route requests are scoped to this exact BrowserWindow/WebContents pair.
  registerCherryNavigationWindow(cherryWindow)
  cherryWindow.webContents.on('console-message', (_event, level, message, line, sourceId) => {
    logEvent('debug', 'cherry-renderer', message, { context: 'level=' + level + ' line=' + line + ' source=' + sourceId })
  })
  cherryWindow.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL) => {
    logEvent('error', 'cherry-renderer', 'Cherry page failed to load', { context: validatedURL, errorCode: String(errorCode) + ':' + errorDescription, retryable: true })
  })
  cherryWindow.webContents.on('render-process-gone', (_event, details) => {
    logEvent('error', 'cherry-renderer', 'Cherry renderer process exited', { context: details.reason, errorCode: String(details.exitCode), retryable: true })
  })
  void cherryWindow.loadFile(getCherryCompatPath()).catch(error => {
    logEvent('error', 'cherry-renderer', 'Cherry page load rejected', { context: error instanceof Error ? error.message : String(error), errorCode: 'CHERRY_LOAD_REJECTED', retryable: true })
  })
  if (process.env.GRIMOIRE_VISUAL_CAPTURE === '1') {
    // Visual-baseline run: the fixture was seeded before the window loaded (see
    // `GRIMOIRE_VISUAL_CAPTURE_EMPTY` below); capture the matrix, then quit.
    void import('./visual-capture').then(async ({ runVisualCapture }) => {
      try {
        const files = await runVisualCapture(cherryWindow!, { empty: process.env.GRIMOIRE_VISUAL_CAPTURE_EMPTY === '1', stateSessionIds: visualStateSessionIds, stateSessionTitles: visualStateSessionTitles })
        logEvent('info', 'cherry-visual', 'Visual capture finished', { context: files.length + ' files' })
        setTimeout(() => app.quit(), 300)
      } catch (error) {
        // A failed capture must FAIL THE PROCESS, not just write a log line.
        //
        // This previously logged and quit with code 0, so a blank page — a route that
        // threw into an error boundary, or rendered nothing at all — reached the driver
        // script as a successful run. The error is still logged (the log is the detailed
        // record); the exit code is what makes it actionable, because the driver and CI
        // only observe that.
        logEvent('error', 'cherry-visual', 'Visual capture failed', { context: String(error), retryable: false })
        setTimeout(() => app.exit(1), 300)
      }
    }).catch(error => {
      logEvent('error', 'cherry-visual', 'Visual capture module rejected', { context: String(error), retryable: false })
      app.exit(1)
    })
  }
  cherryWindow.on('closed', () => { cherryWindow = null })
  cherryWindow.on('focus', () => {
    cherryWindow?.webContents.send('window:focused')
  })
}

function createWorkspacePopout(popoutId: string, panelType: string, title: string, parent?: BrowserWindow | null, requestedBounds?: { x?: number; y?: number; width?: number; height?: number }): boolean {
  if (!isWorkspacePopoutType(panelType)) throw new Error('不支持的 Workspace 面板类型')
  const existing = workspacePopouts.get(popoutId)
  if (existing && !existing.isDestroyed()) {
    if (existing.isMinimized()) existing.restore()
    existing.show()
    existing.focus()
    return true
  }
  const width = Math.max(560, Math.round(requestedBounds?.width || 1100))
  const height = Math.max(360, Math.round(requestedBounds?.height || 760))
  const popout = new BrowserWindow({
    // Anti-flash: the window stays hidden until its content is ready and its initial
    // background matches the current appearance, so detaching a panel never shows a white
    // rectangle first.
    show: false,
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#0f1115' : '#f5f6f8',
    x: typeof requestedBounds?.x === 'number' ? Math.round(requestedBounds.x) : undefined,
    y: typeof requestedBounds?.y === 'number' ? Math.round(requestedBounds.y) : undefined,
    width,
    height,
    minWidth: 560,
    minHeight: 360,
    title: title || 'Grimoire Workspace',
    parent: parent && !parent.isDestroyed() ? parent : undefined,
    autoHideMenuBar: true,
    webPreferences: {
      preload: getPreloadPath(),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })
  workspacePopouts.set(popoutId, popout)
  popout.once('ready-to-show', () => { if (!popout.isDestroyed()) popout.show() })
  configureWindowSecurity(popout)
  const hash = 'workspace-popout?popoutId=' + encodeURIComponent(popoutId) + '&panelType=' + encodeURIComponent(panelType) + '&title=' + encodeURIComponent(title || panelType)
  popout.loadURL(getRendererURL(hash))
  let lastBounds = popout.getBounds()
  const rememberBounds = () => { if (!popout.isDestroyed()) lastBounds = popout.getBounds() }
  popout.on('move', rememberBounds)
  popout.on('resize', rememberBounds)
  popout.on('closed', () => {
    workspacePopouts.delete(popoutId)
    for (const window of BrowserWindow.getAllWindows()) {
      if (!window.isDestroyed()) window.webContents.send(IPC_CHANNELS.WORKSPACE_POPOUT_CLOSED, { popoutId, bounds: lastBounds })
    }
  })
  return true
}

function closeWorkspacePopout(popoutId: string): boolean {
  const popout = workspacePopouts.get(popoutId)
  if (!popout || popout.isDestroyed()) return false
  popout.close()
  return true
}

function focusWorkspacePopout(popoutId: string): boolean {
  const popout = workspacePopouts.get(popoutId)
  if (!popout || popout.isDestroyed()) return false
  if (popout.isMinimized()) popout.restore()
  popout.show()
  popout.focus()
  return true
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    show: false,
    width: 1400, height: 900, minWidth: 1024, minHeight: 700,
    title: "魔导书 Grimoire",
    icon: path.join(__dirname, "../../../resources/icons/icon.png"),
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "../preload/index.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })
  configureWindowSecurity(mainWindow)

  const devServerUrl = process.env.VITE_DEV_SERVER_URL || (!app.isPackaged ? 'http://localhost:5173' : '')
  if (devServerUrl) {
    mainWindow.loadURL(devServerUrl)
  } else {
    mainWindow.loadFile(path.join(__dirname, "../../renderer/index.html"))
  }

  // Focus-based cross-window sync
  mainWindow.on('focus', () => {
    mainWindow?.webContents.send('window:focused')
  })
  mainWindow.show()

  const menuTemplate: Electron.MenuItemConstructorOptions[] = [
    {
      label: "文件",
      submenu: [
        { label: "导出数据库", click: async () => {
            const r = await dialog.showSaveDialog({ filters: [{ name: "数据库", extensions: ["db"] }], defaultPath: "grimoire-backup.db" })
            if (!r.canceled && r.filePath) {
              try { exportDatabase(r.filePath) }
              catch (error) {
                const message = error instanceof Error ? error.message : String(error)
                logEvent('error', 'database', 'Database export failed', { context: message, errorCode: 'DB_EXPORT_FAILED', retryable: true })
                dialog.showErrorBox('数据库导出失败', message)
              }
            }
        }},
        { label: "导入数据库", click: async () => {
            const r = await dialog.showOpenDialog({ filters: [{ name: "数据库", extensions: ["db"] }] })
            if (!r.canceled && r.filePaths.length) {
              try { await replaceDatabase(r.filePaths[0]) }
              catch (error) {
                const message = error instanceof Error ? error.message : String(error)
                logEvent('error', 'database', 'Database import failed', { context: message, errorCode: 'DB_IMPORT_FAILED', retryable: true })
                dialog.showErrorBox('数据库导入失败', message)
              }
            }
        }},
        { type: "separator" },
        { label: "退出", role: "quit" },
      ],
    },
    { label: "视图", submenu: [
        { label: "开发者工具", role: "toggleDevTools" },
        { label: "重新加载", role: "reload" },
    ]},
    { label: "帮助", submenu: [
        { label: "GitHub", click: () => shell.openExternal("https://github.com/hanqingyan3293/Grimoire-Prompt-Combiner") },
    ]},
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(menuTemplate))
  mainWindow.setMenuBarVisibility(false)
  // 捕获渲染进程控制台
  mainWindow.webContents.on('console-message', (_e, level, message) => {
    logEvent('debug', 'renderer', message, { context: 'console-level=' + level })
  })
  // 捕获渲染进程崩溃
  mainWindow.webContents.on('render-process-gone', (_e, details) => {
    logEvent('error', 'renderer', 'Renderer process exited', { context: 'reason=' + details.reason, errorCode: String(details.exitCode) })
  })
  // 捕获页面加载失败
  mainWindow.webContents.on('did-fail-load', (_e, errorCode, errorDescription) => {
    logEvent('error', 'renderer', 'Renderer page failed to load', { errorCode: String(errorCode), context: errorDescription })
  })
  mainWindow.on("closed", () => { mainWindow = null })
}


/** 将旧的 settings 表 api_key/api_endpoint/api_model 迁移为默认供应商 */
async function migrateOldSettings(): Promise<void> {
  const db = getDatabase()
  // 检查 providers 是否已有数据
  const hasProviders = db.exec("SELECT COUNT(*) as c FROM providers")
  if ((hasProviders[0]?.values?.[0]?.[0] as number) > 0) return

  // 读取旧 settings
  const old = db.exec("SELECT key, value FROM settings WHERE key IN ('api_key','api_endpoint','api_model')")
  const oldSettings: Record<string, string> = {}
  for (const row of old[0]?.values || []) {
    oldSettings[row[0] as string] = (row[1] as string) || ''
  }

  const apiKey = oldSettings.api_key || ''
  const apiEndpoint = oldSettings.api_endpoint || 'https://api.openai.com/v1'
  const apiModel = oldSettings.api_model || 'gpt-4o'

  // 只有有 key 或 endpoint 被修改过才迁移
  if (!apiKey && apiEndpoint === 'https://api.openai.com/v1') return

  const { safeStorage } = await import('electron')
  let encryptedKey = apiKey
  if (apiKey && safeStorage.isEncryptionAvailable()) {
    try {
      encryptedKey = safeStorage.encryptString(apiKey).toString('base64')
    } catch { /* keep raw */ }
  }

  const id = 'pvd_migrated'
  const name = '默认供应商'
  db.run(
    `INSERT INTO providers (id,name,access_mode,protocol,base_url,api_key,default_model,test_model,models,is_active,config_toml,auth_json)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
    [id, name, 'api', 'chat_completions', apiEndpoint, encryptedKey, apiModel, apiModel, JSON.stringify([apiModel]), 1, '', '']
  )
  getDatabase()
}

async function registerAllIPC(): Promise<void> {
  // tags.ipc.ts already registers all tag + category + subcategory handlers
  registerTagsIPC()
  registerTagIntelligenceIPC()
  registerMediaIPC()
  registerAiAttachmentsIPC()
  registerCherryAssistantIPC()
  registerFileBridgeIPC()
  registerCherryDataApiIPC([
    getCherryCompatPath(),
    ...(app.isPackaged ? [] : [path.join(process.cwd(), 'src/vendor/cherry/compat/dist-source-shell/source-shell.html')])
  ])
  registerMcpCacheBridgeIPC()
  registerPresetsIPC()
  registerHistoryIPC()
  setSelectionWindowOpener(openSelectionAssistantWindow)
  registerSettingsIPC()
  registerSelectionAssistantIPC()
  registerThemeIPC()
  registerImagesIPC()
  registerFavoritesIPC()
  registerProvidersIPC()
  registerTagGroupsIPC()
  registerAIIPC()
  registerChatIPC()
  registerMigrationIPC()
  registerTasksIPC()
  registerWD14IPC()
  registerComfyIPC()
  registerCanvasIPC()
  registerPromptAssetsIPC()
  registerWorkspaceIPC()
  registerAgentIPC()
  registerNovelaiIPC()
  registerScreenshotIPC()
  registerAiSessionsIPC()
  registerSystemIPC()
  applyPersistedIntegrationSettings()
  markInterruptedTasks()
  taskRunner.start()
  // 迁移旧 settings 到 providers 表
  await migrateOldSettings()
  // 确保默认标签组存在
  const db2 = getDatabase(); const hasGrp = db2.exec('SELECT COUNT(*) as c FROM tag_groups'); if ((hasGrp[0]?.values?.[0]?.[0] as number)===0) { db2.run('INSERT INTO tag_groups (id,name,is_active) VALUES (?,?,?)',['default','默认标签库',1]); saveDatabase() }

  // 窗口管理
  ipcMain.handle("window:openSettings", async () => { createSettingsWindow() })
  ipcMain.handle("window:openAI", async () => { createAIWindow() })
  ipcMain.handle("window:openCherry", async () => { createCherryWindow() })
  ipcMain.handle(IPC_CHANNELS.WORKSPACE_OPEN_POPOUT, async (event, input: unknown) => {
    if (!input || typeof input !== 'object') throw new Error('Workspace 弹出窗口参数无效')
    const value = input as Record<string, unknown>
    const popoutId = typeof value.popoutId === 'string' ? value.popoutId.trim() : ''
    const panelType = typeof value.panelType === 'string' ? value.panelType.trim() : ''
    const title = typeof value.title === 'string' ? value.title.trim() : panelType
    const rawBounds = value.bounds && typeof value.bounds === 'object' ? value.bounds as Record<string, unknown> : {}
    const bounds = {
      x: typeof rawBounds.x === 'number' ? rawBounds.x : undefined,
      y: typeof rawBounds.y === 'number' ? rawBounds.y : undefined,
      width: typeof rawBounds.width === 'number' ? rawBounds.width : undefined,
      height: typeof rawBounds.height === 'number' ? rawBounds.height : undefined,
    }
    if (!popoutId || !panelType) throw new Error('Workspace 弹出窗口参数缺失')
    return createWorkspacePopout(popoutId, panelType, title, BrowserWindow.fromWebContents(event.sender), bounds)
  })
  ipcMain.handle(IPC_CHANNELS.WORKSPACE_CLOSE_POPOUT, async (_event, popoutId: unknown) => closeWorkspacePopout(String(popoutId || '')))
  ipcMain.handle(IPC_CHANNELS.WORKSPACE_FOCUS_POPOUT, async (_event, popoutId: unknown) => focusWorkspacePopout(String(popoutId || '')))


  ipcMain.handle(IPC_CHANNELS.ERROR_GET_ALL, async () => getErrorLogs(50))
  ipcMain.handle(IPC_CHANNELS.ERROR_LOG, async (_event, message: string, stack: string, context: string) => { logError(message, stack, context) })

  ipcMain.handle(IPC_CHANNELS.DB_EXPORT, async () => {
    const r = await dialog.showSaveDialog({ filters: [{ name: "数据库", extensions: ["db"] }], defaultPath: "grimoire-backup.db" })
    if (!r.canceled && r.filePath) { exportDatabase(r.filePath); return true }
    return false
  })
  ipcMain.handle(IPC_CHANNELS.DB_IMPORT, async () => {
    const r = await dialog.showOpenDialog({ filters: [{ name: "数据库", extensions: ["db"] }] })
    if (!r.canceled && r.filePaths.length) { await replaceDatabase(r.filePaths[0]); return true }
    return false
  })

  ipcMain.handle(IPC_CHANNELS.DIALOG_SAVE_TEXT, async (_event, content: string, defaultName: string) => {
    const r = await dialog.showSaveDialog({
      defaultPath: defaultName,
      filters: [
        { name: "JSON 文件", extensions: ["json"] },
        { name: "文本文件", extensions: ["txt"] },
        { name: "所有文件", extensions: ["*"] },
      ],
    })
    if (r.canceled || !r.filePath) return false
    // Same invariant as the file bridge: a text export must not overwrite files inside the app's own data
    // directory. This handler predates the guard and had no check at all.
    assertNotManagedTarget(r.filePath)
    fs.writeFileSync(r.filePath, content, "utf-8")
    return true
  })

  ipcMain.handle(IPC_CHANNELS.DIALOG_OPEN_TEXT, async () => {
    const r = await dialog.showOpenDialog({
      properties: ["openFile"],
      filters: [
        { name: "JSON / 文本文件", extensions: ["json", "txt"] },
        { name: "所有文件", extensions: ["*"] },
      ],
    })
    if (r.canceled || r.filePaths.length === 0) return null
    return fs.readFileSync(r.filePaths[0], "utf-8")
  })

  // 目录选择（文件夹扫描导入用）：返回绝对路径，取消返回 null。
  ipcMain.handle(IPC_CHANNELS.DIALOG_OPEN_DIRECTORY, async () => {
    const r = await dialog.showOpenDialog({ properties: ["openDirectory"] })
    if (r.canceled || r.filePaths.length === 0) return null
    return r.filePaths[0]
  })
}

async function initDefaultTags(): Promise<void> {
  const db = getDatabase()
  const count = db.exec("SELECT COUNT(*) as c FROM tags WHERE group_id='default'")
  const tagCount = count[0]?.values?.[0]?.[0] as number || 0
  if (tagCount === 0) {
    const devPath = path.join(__dirname, "../../../data/tags.json")
    const prodPath = path.join(process.resourcesPath || "", "data/tags.json")
    let tagsPath = devPath
    if (!fs.existsSync(tagsPath)) tagsPath = prodPath
    if (fs.existsSync(tagsPath)) {
      await importDefaultTags(fs.readFileSync(tagsPath, "utf-8"))
    }
  }
}

process.on("uncaughtException", (err) => { logError("未捕获异常: " + err.message, err.stack || ""); console.error(err) })
process.on("unhandledRejection", (reason) => { logError("未处理的 Promise: " + String(reason), reason instanceof Error ? reason.stack : "") })

if (hasSingleInstanceLock) {
let isQuitting = false
  app.on('second-instance', () => {
    if (!mainWindow || mainWindow.isDestroyed()) return
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.show()
    mainWindow.focus()
  })

// Must run before `whenReady`: Electron ignores the GPU switch afterwards.
const bootConfig = applyBootConfig({ databasePath: defaultDatabasePathFor(app.getPath('userData')), apply: () => app.disableHardwareAcceleration() })

app.whenReady().then(async () => {
  try {
    logEvent('info', 'application', 'Application startup', { context: JSON.stringify(bootConfig) })
    await initDatabase()
    await registerAllIPC()
    await initDefaultTags()
    createWindow()
    if ((process.env.GRIMOIRE_VISUAL_CAPTURE === '1' || process.env.GRIMOIRE_UI_CATALOG_CAPTURE === '1') && process.env.GRIMOIRE_VISUAL_CAPTURE_EMPTY !== '1') {
      // Seed before the Cherry window loads so the renderer's initial fetch sees the
      // fixture. A non-empty database means this user-data-dir was already captured;
      // re-seeding would duplicate rows, so the fixture is skipped then.
      const { seedVisualFixture, findVisualStateSessionIds } = await import('./visual-capture')
      const { listAiSessions } = await import('./services/ai-session.service')
      if (listAiSessions({ includeArchived: true, limit: 1 }).length === 0) {
        const seeded = seedVisualFixture()
        visualStateSessionIds = seeded.stateSessionIds
        visualStateSessionTitles = seeded.stateSessionTitles
      } else {
        // Re-capture against an existing fixture: the ids are recovered by TITLE rather than
        // re-seeding (which would duplicate rows). Without this the state frames silently
        // disappeared on every run after the first — the capture would still succeed and
        // report 12 frames, so the loss would be invisible.
        visualStateSessionIds = findVisualStateSessionIds()
        visualStateSessionTitles = { failed: '失败的会话', running: '运行中的会话', tool: '长列表与消息块基线' }
      }
    }
    if (process.env.GRIMOIRE_OPEN_CHERRY === '1' || process.env.GRIMOIRE_VISUAL_CAPTURE === '1' || process.env.GRIMOIRE_UI_CATALOG_CAPTURE === '1') {
      setTimeout(() => createCherryWindow(), 700)
    }
    const defaultPromptAssetDirectory = process.env.VITE_DEV_SERVER_URL
      ? path.join(__dirname, '../../../data/default-prompt-assets')
      : path.join(process.resourcesPath, 'data', 'default-prompt-assets')
    void importDefaultPromptAssets(defaultPromptAssetDirectory).then((added) => {
      const linked = seedDefaultPromptAssetCategories()
      if (added > 0) {
        logEvent('info', 'prompt-assets', 'Imported ' + added + ' built-in prompt assets')
        broadcastDatabaseReload()
      }
      if (linked > 0) broadcastDatabaseReload()
    }).catch((error) => {
      console.warn('Built-in prompt asset import deferred:', error)
    })
    logEvent('info', 'application', 'Application ready')
  } catch (err) {
    logError("启动失败: " + (err instanceof Error ? err.message : "未知错误"), err instanceof Error ? err.stack || "" : "")
    console.error("启动失败:", err)
    dialog.showErrorBox("启动失败", err instanceof Error ? err.message : "未知错误")
  }
})

app.on("before-quit", (event) => {
  if (isQuitting) return
  isQuitting = true
  event.preventDefault()
  taskRunner.stop()
  void Promise.allSettled([wd14Worker.stop(), shutdownAiSessions()]).finally(() => {
    closeDatabase()
    app.quit()
  })
})
app.on("window-all-closed", () => { if (BrowserWindow.getAllWindows().length === 0) app.quit() })
app.on("activate", () => { if (BrowserWindow.getAllWindows().length === 0) createWindow() })
}
