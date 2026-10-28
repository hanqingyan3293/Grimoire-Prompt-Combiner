// Selection assistant IPC: the floating window asks what was captured and applies one action.
//
// The captured text lives here rather than in the window: the shortcut handler stores it, the window only
// reads it. That keeps the trust boundary in the main process — a renderer cannot invent a selection.
import { BrowserWindow, clipboard, ipcMain } from 'electron'
import { getDatabase } from '../database'
import { IPC_CHANNELS } from '../../shared/types'
import { createPromptAsset } from '../services/prompt-asset-browser'
import { applySelectionPlan, type SelectionActionId, type SelectionSink } from '../services/selection-assistant.service'

let captured = ''

// The popup opener is injected: `settings.ipc` must not import `main/index` (that would be a cycle), and the
// window factory needs the module-local preload/renderer path helpers.
let windowOpener: (() => void) | null = null

export function setSelectionWindowOpener(opener: () => void): void { windowOpener = opener }

export function openSelectionAssistant(): void {
  if (windowOpener) windowOpener()
}

export function setCapturedSelection(text: string): void { captured = text }

export function getCapturedSelection(): string { return captured }

export function selectionSink(): SelectionSink {
  return {
    // Injected here so the service never imports Electron itself.
    writeClipboard: (text: string) => { clipboard.writeText(text) },
    createPromptAsset: input => createPromptAsset(getDatabase(), input),
  }
}

export function registerSelectionAssistantIPC(): void {
  ipcMain.handle(IPC_CHANNELS.SELECTION_CURRENT, () => ({ text: captured, actions: ['copy-as-tags', 'copy-normalized', 'to-prompt-asset'] }))
  ipcMain.handle(IPC_CHANNELS.SELECTION_APPLY, (event, action: unknown) => {
    const id = String(action || '') as SelectionActionId
    if (id !== 'copy-as-tags' && id !== 'copy-normalized' && id !== 'to-prompt-asset') return { ok: false, error: 'UNKNOWN_ACTION' }
    const outcome = applySelectionPlan(id, captured, selectionSink())
    if (outcome.kind === 'empty') return { ok: false, error: 'EMPTY_SELECTION' }
    if (outcome.kind === 'failed') return { ok: false, error: outcome.message }
    const window = BrowserWindow.fromWebContents(event.sender)
    if (window && !window.isDestroyed()) window.hide()
    return { ok: true, outcome }
  })
  ipcMain.handle(IPC_CHANNELS.SELECTION_CLOSE, event => {
    const window = BrowserWindow.fromWebContents(event.sender)
    if (window && !window.isDestroyed()) window.hide()
    return true
  })
}
