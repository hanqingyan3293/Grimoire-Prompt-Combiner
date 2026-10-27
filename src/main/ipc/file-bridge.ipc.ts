import { BrowserWindow, ipcMain } from 'electron'
import { IPC_CHANNELS } from '../../shared/types'
import {
  createBridgeTempFile,
  getBridgeFileInfo,
  getBridgePhysicalMetadata,
  readBridgeTextFile,
  openBridgePath,
  saveBridgeFile,
  writeBridgeTempFile
} from '../services/file-bridge.service'

/**
 * File bridge IPC for the Cherry compat composer. Mirrors the subset of the source
 * `window.api.file` / `window.api.fs` / `ipcApi.request('file.get_metadata')` surface
 * the composer drop/paste path uses. Everything resolves paths inside the main
 * process; the renderer only ever passes path strings it received from the OS drop
 * event via `webUtils.getPathForFile`.
 */
export function registerFileBridgeIPC(): void {
  ipcMain.handle(IPC_CHANNELS.FILE_BRIDGE_OPEN_PATH, async (_event, inputPath: unknown) => openBridgePath(inputPath))
  ipcMain.handle(IPC_CHANNELS.FILE_BRIDGE_SAVE, async (event, fileName: unknown, content: unknown, options?: unknown) => {
    const parent = BrowserWindow.fromWebContents(event.sender)
    if (!parent || parent.isDestroyed()) throw new Error('FILE_SAVE_NO_CALLER_WINDOW')
    return saveBridgeFile(parent, fileName, content, options)
  })
  ipcMain.handle(IPC_CHANNELS.FILE_BRIDGE_GET, async (_event, inputPath: unknown) => getBridgeFileInfo(String(inputPath || '')))
  ipcMain.handle(IPC_CHANNELS.FILE_BRIDGE_METADATA, async (_event, inputPath: unknown) => getBridgePhysicalMetadata(String(inputPath || '')))
  ipcMain.handle(IPC_CHANNELS.FILE_BRIDGE_READ_TEXT, async (_event, inputPath: unknown) => readBridgeTextFile(String(inputPath || '')))
  ipcMain.handle(IPC_CHANNELS.FILE_BRIDGE_TEMP_CREATE, async (_event, name: unknown) => createBridgeTempFile(String(name || 'pasted')))
  ipcMain.handle(IPC_CHANNELS.FILE_BRIDGE_TEMP_WRITE, async (_event, input: unknown) => {
    const value = input && typeof input === 'object' ? input as Record<string, unknown> : {}
    const data = value.data
    writeBridgeTempFile(String(value.path || ''), typeof data === 'string' ? data : data instanceof Uint8Array ? data : new Uint8Array())
    return true
  })
}
