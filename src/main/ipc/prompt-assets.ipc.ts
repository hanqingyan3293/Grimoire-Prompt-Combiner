import { ipcMain } from 'electron'
import { getDatabase } from '../database'
import { saveDatabase } from '../database'
import { IPC_CHANNELS } from '../../shared/types'
import { assignPromptAssetCategory, createPromptAsset, createPromptAssetCategory, deletePromptAsset, deletePromptAssetCategory, listPromptAssetCategories, movePromptAssetCategory, queryPromptAssets, renamePromptAssetCategory } from '../services/prompt-asset-browser'

export function registerPromptAssetsIPC(): void {
  ipcMain.handle(IPC_CHANNELS.PROMPT_ASSETS_LIST, async (_event, input: unknown) => queryPromptAssets(getDatabase(), input))
  ipcMain.handle(IPC_CHANNELS.PROMPT_ASSETS_CREATE, async (_event, input: unknown) => createPromptAsset(getDatabase(), input))
  ipcMain.handle(IPC_CHANNELS.PROMPT_ASSETS_DELETE, async (_event, sourceId: unknown) => {
    const deleted = deletePromptAsset(getDatabase(), sourceId)
    if (deleted) saveDatabase()
    return deleted
  })
  ipcMain.handle(IPC_CHANNELS.PROMPT_ASSET_CATEGORIES_LIST, async () => listPromptAssetCategories(getDatabase()))
  ipcMain.handle(IPC_CHANNELS.PROMPT_ASSET_CATEGORIES_CREATE, async (_event, input: unknown) => createPromptAssetCategory(getDatabase(), input))
  ipcMain.handle(IPC_CHANNELS.PROMPT_ASSET_CATEGORIES_RENAME, async (_event, input: unknown) => renamePromptAssetCategory(getDatabase(), input))
  ipcMain.handle(IPC_CHANNELS.PROMPT_ASSET_CATEGORIES_DELETE, async (_event, id: unknown) => deletePromptAssetCategory(getDatabase(), id))
  ipcMain.handle(IPC_CHANNELS.PROMPT_ASSET_CATEGORIES_MOVE, async (_event, input: unknown) => movePromptAssetCategory(getDatabase(), input))
  ipcMain.handle(IPC_CHANNELS.PROMPT_ASSET_CATEGORIES_ASSIGN, async (_event, input: unknown) => assignPromptAssetCategory(getDatabase(), input))
}
