// 魔导书 Grimoire v7 — 设置 IPC 处理器
import { BrowserWindow, clipboard, globalShortcut, ipcMain, safeStorage } from "electron"
import { getDatabase, saveDatabase } from "../database"
import { IPC_CHANNELS } from "../../shared/types"
import { configureComfyUI } from "../services/comfy-client"
import { requireHttpUrl } from "../services/input-validation"
import { applyLaunchOnBoot, applyPreventSleep, applyProxy } from "../services/app-preferences.service"
import { logEvent } from "../services/logger.service"
import { isProtectedCherrySetting, redactCherrySetting } from '../../shared/cherry-settings-privacy'
import { writeCredentialPreference } from '../services/cherry-credential.service'
import { capturePrimaryScreen } from '../services/screenshot-capture.service'
import { applyScreenshotShortcut } from '../services/screenshot-shortcut.service'
import { applySelectionShortcut, planSelectionAction } from '../services/selection-assistant.service'
import { createPromptAsset } from '../services/prompt-asset-browser'

export function registerSettingsIPC(): void {
  // Default settings
  const defaults: Record<string, string> = {
    api_endpoint: "https://api.openai.com/v1",
    api_model: "gpt-4o",
    theme: "neon",
    appearance_mode: "system",
    language: "zh",
    custom_accent: "#a855f7",
    ui_scale: "14",
    ui_density: "normal",
    max_undo_steps: "50",
    random_min: "3",
    random_max: "16",
    comfyui_base_url: "http://127.0.0.1:8188",
    wd14_model_directory: "",
    wd14_python_path: "",
    clip_model_directory: "",
    clip_python_path: "",
  }

  ipcMain.handle(IPC_CHANNELS.SETTINGS_GET_ALL, async () => {
    const db = getDatabase()
    const result = db.exec("SELECT key, value FROM settings")
    const settings = { ...defaults }
    
    for (const row of result[0]?.values || []) {
      const key = row[0] as string
      const value = row[1] as string
      if (key !== "api_key") settings[key] = redactCherrySetting(key, value)
    }
    try { configureComfyUI(requireHttpUrl(settings.comfyui_base_url, 'ComfyUI 地址')) } catch { configureComfyUI(defaults.comfyui_base_url) }
    
    return settings
  })

  ipcMain.handle(IPC_CHANNELS.SETTINGS_SET, async (_event, key: string, value: string) => {
    if (isProtectedCherrySetting(key)) {
      // Dedicated path for declared credential preferences (M3): encrypted at rest, plaintext only in
      // this process. The generic branch below stays closed for them.
      writeCredentialPreference(key.slice('cherry_pref.'.length), value)
      saveDatabase()
      for (const win of BrowserWindow.getAllWindows()) {
        if (!win.isDestroyed()) win.webContents.send('data:refresh')
      }
      return true
    }
    if (key === 'comfyui_base_url') value = requireHttpUrl(value, 'ComfyUI 地址')
    const db = getDatabase()
    let storedValue = value
    
    if (key === "api_key" && value && safeStorage.isEncryptionAvailable()) {
      storedValue = safeStorage.encryptString(value).toString("base64")
    }
    
    db.run(
      "INSERT INTO settings (key, value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=?",
      [key, storedValue, storedValue]
    )
    if (key === 'comfyui_base_url') configureComfyUI(value)
    // `/settings/general` preference consumers. The compat shim persists its preferences as
    // `cherry_pref.<source key>`, so this is where a switch on that page becomes real
    // behaviour. Keys with no consumer are deliberately absent here rather than silently
    // accepted — the page stays BLOCKED until each one lands.
    applyCherryPreferenceSideEffect(key, storedValue)
    saveDatabase()
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) win.webContents.send("data:refresh")
    }
    return true
  })
}

/**
 * Turns a stored compat preference into the behaviour it promises.
 *
 * The values arrive JSON-encoded through the shim (`cherry_pref.app.proxy.mode` holds
 * `"custom"`, not `custom`), so each is parsed rather than used raw — reading
 * `'"custom"'` as a mode would fall through to the default branch and apply the wrong config
 * while reporting success.
 *
 * Every branch logs its outcome, including the platform-unsupported case: a preference that
 * could not be applied must be distinguishable from one that was, and a silent no-op is
 * exactly the fake-success shape this file exists to remove.
 */
function applyCherryPreferenceSideEffect(key: string, rawValue: string): void {
  const parse = (): unknown => {
    try { return JSON.parse(rawValue) } catch { return rawValue }
  }
  if (key === 'cherry_pref.app.launch_on_boot') {
    const result = applyLaunchOnBoot(parse() === true)
    logEvent(result.applied ? 'info' : 'warn', 'app-preferences', '开机自启偏好已应用', { context: JSON.stringify(result) })
    return
  }
  if (key === 'cherry_pref.app.power.prevent_sleep_when_busy') {
    const active = applyPreventSleep(parse() === true)
    logEvent('info', 'app-preferences', '防休眠偏好已应用', { context: JSON.stringify(active) })
    return
  }
  // Screenshot capture (M3): the switch and the accelerator are applied together from either key, so
  // toggling the feature off always releases the keys and changing the accelerator always re-registers.
  if (key === 'cherry_pref.feature.screenshot.enabled' || key === 'cherry_pref.shortcut.screenshot.capture') {
    const read = (name: string): unknown => {
      const row = getDatabase().exec('SELECT value FROM settings WHERE key=?', ['cherry_pref.' + name])[0]?.values?.[0]?.[0]
      if (typeof row !== 'string') return undefined
      try { return JSON.parse(row) } catch { return row }
    }
    const enabled = read('feature.screenshot.enabled') === true
    const accelerator = String(read('shortcut.screenshot.capture') ?? '')
    const result = applyScreenshotShortcut({
      registrar: globalShortcut,
      enabled,
      accelerator,
      handler: () => {
        void capturePrimaryScreen().then(
          outcome => logEvent('info', 'screenshot', '截图已保存', { context: JSON.stringify({ filePath: outcome.filePath, bytes: outcome.bytes }) }),
          error => logEvent('error', 'screenshot', '截图失败', { context: error instanceof Error ? error.message : String(error) }),
        )
      },
    })
    logEvent(result.registered ? 'info' : 'warn', 'screenshot', '截图快捷键已应用', { context: JSON.stringify(result) })
    return
  }
  // Selection assistant (M3): source Cherry captures a selection with the native `selection-hook` addon,
  // which this repository does not have. The fallback is a global shortcut that reads the clipboard after
  // the user copies: it needs no native code and still turns a selection into tags or a prompt asset.
  if (key === 'cherry_pref.feature.selection.enabled' || key === 'cherry_pref.shortcut.selection.assistant') {
    const readSelection = (name: string): unknown => {
      const row = getDatabase().exec('SELECT value FROM settings WHERE key=?', ['cherry_pref.' + name])[0]?.values?.[0]?.[0]
      if (typeof row !== 'string') return undefined
      try { return JSON.parse(row) } catch { return row }
    }
    const enabled = readSelection('feature.selection.enabled') === true
    const accelerator = String(readSelection('shortcut.selection.assistant') ?? 'CommandOrControl+Shift+S')
    const result = applySelectionShortcut({
      registrar: globalShortcut,
      enabled,
      accelerator,
      handler: () => {
        // The action is resolved at press time so a preference change applies without re-registering.
        const action = String(readSelection('feature.selection.action') ?? 'copy-as-tags')
        const plan = planSelectionAction(action === 'to-prompt-asset' ? 'to-prompt-asset' : action === 'copy-normalized' ? 'copy-normalized' : 'copy-as-tags', clipboard.readText())
        if (plan.kind === 'empty') {
          logEvent('warn', 'selection', '划词助手：剪贴板为空，未生成内容')
          return
        }
        if (plan.kind === 'clipboard') {
          clipboard.writeText(plan.text)
          logEvent('info', 'selection', '划词助手：已转换并写回剪贴板', { context: JSON.stringify({ chars: plan.text.length }) })
          return
        }
        try {
          const asset = createPromptAsset(getDatabase(), { name: plan.payload.slice(0, 24) || '选区', prompt: plan.payload, detail: '划词助手 · ' + new Date().toISOString() })
          logEvent('info', 'selection', '划词助手：已存为提示词素材', { context: JSON.stringify({ assetId: asset.id }) })
        } catch (error) {
          logEvent('error', 'selection', '划词助手：写入素材失败', { context: error instanceof Error ? error.message : String(error) })
        }
      },
    })
    logEvent(result.registered ? 'info' : 'warn', 'selection', '划词助手快捷键已应用', { context: JSON.stringify(result) })
    return
  }
  // Proxy needs the other two keys, so it is applied from any of the three rather than only
  // the last one the user touched — otherwise changing 仅代理地址 would never take effect.
  if (key === 'cherry_pref.app.proxy.mode' || key === 'cherry_pref.app.proxy.url' || key === 'cherry_pref.app.proxy.bypass_rules') {
    const read = (name: string): unknown => {
      const row = getDatabase().exec('SELECT value FROM settings WHERE key=?', ['cherry_pref.' + name])[0]?.values?.[0]?.[0]
      if (typeof row !== 'string') return undefined
      try { return JSON.parse(row) } catch { return row }
    }
    const mode = (read('app.proxy.mode') ?? 'system') as 'system' | 'custom' | 'none'
    const url = String(read('app.proxy.url') ?? '')
    const bypass = String(read('app.proxy.bypass_rules') ?? '')
    void applyProxy(mode, url, bypass).then(
      config => logEvent('info', 'app-preferences', '代理偏好已应用', { context: JSON.stringify(config) }),
      error => logEvent('error', 'app-preferences', '代理应用失败', { context: String(error), retryable: true })
    )
  }
}
