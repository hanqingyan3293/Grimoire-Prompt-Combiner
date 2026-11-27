// 「设置 → 数据存储」的 IPC 入口。
//
// 只做两件事：把 inventory 交给渲染层、提供一次强制重算。导出/导入/迁移/清理/诊断在 P2–P5 追加，
// 每个都走同一个 service 与同一份注册表，避免界面按钮与后端能力脱节（G13 会校验双端接线）。

import { ipcMain } from 'electron'
import { IPC_CHANNELS } from '../../shared/types'
import { buildStorageInventory } from '../services/storage-inventory.service'
import { clearSizeCache } from '../services/storage-size.service'
import { logEvent } from '../services/logger.service'

export function registerStorageIPC(): void {
  ipcMain.handle(IPC_CHANNELS.STORAGE_INVENTORY, async (_event, options?: { force?: boolean }) => {
    try {
      return await buildStorageInventory({ force: Boolean(options?.force) })
    } catch (error) {
      logEvent('error', 'storage', '读取数据面清单失败', {
        context: error instanceof Error ? error.message : String(error),
        errorCode: 'STORAGE_INVENTORY_FAILED',
        retryable: true,
      })
      throw error
    }
  })

  // 面板上的「刷新」：清掉目录体积缓存后重算，表数据走 dbstat（毫秒级）不受影响。
  ipcMain.handle(IPC_CHANNELS.STORAGE_SCAN_SIZES, async () => {
    clearSizeCache()
    return await buildStorageInventory({ force: true })
  })
}
