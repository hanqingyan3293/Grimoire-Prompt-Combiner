// 系统字体枚举的 IPC 入口。
//
// 复用 `system-fonts.service`（font-list@2.0.0，与 Cherry 源同版本、带进程级缓存），
// 不新写枚举逻辑：字体选择器要的是「名字列表」，缓存与失败降级都已经在里面做好。

import { ipcMain } from 'electron'
import { IPC_CHANNELS } from '../../shared/types'
import { listSystemFonts } from '../services/system-fonts.service'
import { logEvent } from '../services/logger.service'

export function registerSystemFontsIPC(): void {
  ipcMain.handle(IPC_CHANNELS.SYSTEM_LIST_FONTS, async () => {
    try {
      return await listSystemFonts()
    } catch (error) {
      // 枚举失败返回空数组而不是拒绝：设置页要能打开，用户至少能选「跟随系统默认」。
      logEvent('warn', 'system', '系统字体枚举失败', {
        context: error instanceof Error ? error.message : String(error),
        errorCode: 'SYSTEM_FONT_ENUM_FAILED',
        retryable: true,
      })
      return []
    }
  })
}
