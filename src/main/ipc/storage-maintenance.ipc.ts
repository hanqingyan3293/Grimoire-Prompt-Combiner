// 清理 / 待清理区 / 自动备份的 IPC。
//
// 全部是「用户点一下」的低频操作，不需要流式进度；但每个 handler 都必须把失败原因原样带回渲染层，
// 而不是把错误吞成 false——"点了没反应"是这类管理面板最常见的差评来源。

import { ipcMain, session } from 'electron'
import { IPC_CHANNELS } from '../../shared/types'
import { listTrash, moveToTrash, planCleanup, purgeTrash, restoreTrash } from '../services/storage-cleanup.service'
import { createBackup, listBackups, pruneBackups, restoreBackup } from '../services/storage-backup.service'
import { clearSizeCache } from '../services/storage-size.service'

export function registerStorageMaintenanceIPC(): void {
  ipcMain.handle(IPC_CHANNELS.STORAGE_CLEANUP_PLAN, async () => await planCleanup())

  ipcMain.handle(IPC_CHANNELS.STORAGE_CLEANUP_APPLY, async (_event, ids: unknown) => {
    const wanted = Array.isArray(ids) ? ids.filter((id): id is string => typeof id === 'string') : []
    if (wanted.length === 0) throw new Error('没有选择要清理的项')
    const candidates = await planCleanup()
    const moved: unknown[] = []
    for (const candidate of candidates) {
      if (!wanted.includes(candidate.id)) continue
      if (candidate.id === 'cleanup.browser-cache') {
        // Chromium 缓存由 session 自己管，直接删目录会和正在运行的进程抢文件。
        await session.defaultSession.clearCache()
        continue
      }
      moved.push(...await moveToTrash(candidate))
    }
    clearSizeCache()
    return { moved: moved.length }
  })

  ipcMain.handle(IPC_CHANNELS.STORAGE_TRASH_LIST, async () => await listTrash())
  ipcMain.handle(IPC_CHANNELS.STORAGE_TRASH_RESTORE, async (_event, id: unknown) => {
    if (typeof id !== 'string' || !id.trim()) throw new Error('待清理项无效')
    await restoreTrash(id)
    clearSizeCache()
    return true
  })
  ipcMain.handle(IPC_CHANNELS.STORAGE_TRASH_PURGE, async (_event, id: unknown) => {
    const result = typeof id === 'string' && id.trim() ? await purgeTrash(id) : await purgeTrash()
    clearSizeCache()
    return result
  })

  ipcMain.handle(IPC_CHANNELS.STORAGE_BACKUPS_LIST, async () => await listBackups())
  ipcMain.handle(IPC_CHANNELS.STORAGE_BACKUPS_CREATE, async () => await createBackup('manual'))
  ipcMain.handle(IPC_CHANNELS.STORAGE_BACKUPS_RESTORE, async (_event, filePath: unknown) => {
    if (typeof filePath !== 'string' || !filePath.trim()) throw new Error('备份路径无效')
    await restoreBackup(filePath)
    return { restartRequired: true }
  })
  ipcMain.handle(IPC_CHANNELS.STORAGE_BACKUPS_PRUNE, async () => await pruneBackups())
}
