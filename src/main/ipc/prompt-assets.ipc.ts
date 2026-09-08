import { ipcMain } from 'electron'
import { getDatabase } from '../database'
import { saveDatabase } from '../database'
import { IPC_CHANNELS } from '../../shared/types'
import { createPromptAsset, deletePromptAsset, queryPromptAssets } from '../services/prompt-asset-browser'

export function registerPromptAssetsIPC(): void {
  ipcMain.handle(IPC_CHANNELS.PROMPT_ASSETS_LIST, async (_event, input: unknown) => queryPromptAssets(getDatabase(), input))
  ipcMain.handle(IPC_CHANNELS.PROMPT_ASSETS_CREATE, async (_event, input: unknown) => createPromptAsset(getDatabase(), input))
  ipcMain.handle(IPC_CHANNELS.PROMPT_ASSETS_DELETE, async (_event, sourceId: unknown) => {
    const deleted = deletePromptAsset(getDatabase(), sourceId)
    if (deleted) saveDatabase()
    return deleted
  })
}
