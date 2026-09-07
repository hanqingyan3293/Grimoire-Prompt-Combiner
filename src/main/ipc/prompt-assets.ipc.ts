import { ipcMain } from 'electron'
import { getDatabase } from '../database'
import { IPC_CHANNELS } from '../../shared/types'
import { queryPromptAssets } from '../services/prompt-asset-browser'

export function registerPromptAssetsIPC(): void {
  ipcMain.handle(IPC_CHANNELS.PROMPT_ASSETS_LIST, async (_event, input: unknown) => queryPromptAssets(getDatabase(), input))
}
