import { ipcMain } from 'electron'
import { getDatabase } from '../database'
import { IPC_CHANNELS } from '../../shared/types'
import { createPromptAsset, queryPromptAssets } from '../services/prompt-asset-browser'

export function registerPromptAssetsIPC(): void {
  ipcMain.handle(IPC_CHANNELS.PROMPT_ASSETS_LIST, async (_event, input: unknown) => queryPromptAssets(getDatabase(), input))
  ipcMain.handle(IPC_CHANNELS.PROMPT_ASSETS_CREATE, async (_event, input: unknown) => createPromptAsset(getDatabase(), input))
}
