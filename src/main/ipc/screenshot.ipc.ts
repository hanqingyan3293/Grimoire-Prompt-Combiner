import { ipcMain } from 'electron'

import { IPC_CHANNELS } from '../../shared/types'
import { capturePrimaryScreen } from '../services/screenshot-capture.service'

export function registerScreenshotIPC(): void {
  ipcMain.handle(IPC_CHANNELS.SCREENSHOT_CAPTURE, async () => {
    try {
      return { ok: true as const, data: await capturePrimaryScreen() }
    } catch (error) {
      const code = (error as { code?: string }).code || 'CAPTURE_FAILED'
      return { ok: false as const, error: { code, message: error instanceof Error ? error.message : String(error) } }
    }
  })
}
