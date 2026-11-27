// 数据存储的备份 / 恢复 IPC。
//
// 三个原则：
//  1. 选文件的对话框放在主进程（`dialog`），渲染层只传"要做什么"，不传任意路径 ——
//     否则渲染层一旦被注入就能读写任意文件。
//  2. 导入前一定先 inspect（识别格式、版本、条目），确认后再 apply。
//  3. 进度通过 `storage:transferProgress` 事件推给渲染层，不阻塞 UI。

import { BrowserWindow, dialog, ipcMain, type OpenDialogOptions, type SaveDialogOptions } from 'electron'
import path from 'path'
import { IPC_CHANNELS } from '../../shared/types'
import { applyImport, exportDiagnostics, exportFullBackup, inspectImport } from '../services/storage-transfer.service'
import { logEvent } from '../services/logger.service'
import type { TransferProgress } from '../../shared/storage-transfer-types'

// Electron 42 的签名是 (window, options) 或 (options)：不能混成一个 { window } 对象。
function saveDialog(owner: BrowserWindow | undefined, options: SaveDialogOptions) {
  return owner ? dialog.showSaveDialog(owner, options) : dialog.showSaveDialog(options)
}

function openDialog(owner: BrowserWindow | undefined, options: OpenDialogOptions) {
  return owner ? dialog.showOpenDialog(owner, options) : dialog.showOpenDialog(options)
}

// 自动化缝合点：CI / 验收脚本没有人类点对话框，设了这个环境变量就把导出目标固定到该目录。
// 只有主进程读环境变量，渲染层无法影响它，因此不构成新的任意写路径。
function automationExportDir(): string | null {
  const dir = process.env.GRIMOIRE_TRANSFER_DIR
  return dir && dir.trim() ? dir.trim() : null
}

function progressSender(event: Electron.IpcMainInvokeEvent) {
  return (progress: TransferProgress) => {
    if (!event.sender.isDestroyed()) event.sender.send(IPC_CHANNELS.STORAGE_TRANSFER_PROGRESS, progress)
  }
}

export function registerStorageTransferIPC(): void {
  ipcMain.handle(IPC_CHANNELS.STORAGE_EXPORT_BACKUP, async (event, options?: { includeMedia?: boolean }) => {
    const owner = BrowserWindow.fromWebContents(event.sender) ?? undefined
    const automatedDir = automationExportDir()
    const result = automatedDir
      ? { canceled: false, filePath: path.join(automatedDir, `grimoire-backup-${Date.now()}.zip`) }
      : await saveDialog(owner, {
      title: '导出完整备份',
      defaultPath: `grimoire-backup-${new Date().toISOString().slice(0, 10)}.zip`,
      filters: [{ name: 'Grimoire 备份包', extensions: ['zip'] }],
    })
    if (result.canceled || !result.filePath) return null
    const manifest = await exportFullBackup(result.filePath, { includeMedia: Boolean(options?.includeMedia) }, progressSender(event))
    logEvent('info', 'storage', 'Full backup exported', { context: `${result.filePath} (${manifest.totals.bytes}B)` })
    return { path: result.filePath, manifest }
  })

  ipcMain.handle(IPC_CHANNELS.STORAGE_EXPORT_DIAGNOSTICS, async (event) => {
    const owner = BrowserWindow.fromWebContents(event.sender) ?? undefined
    const automatedDir = automationExportDir()
    const result = automatedDir
      ? { canceled: false, filePath: path.join(automatedDir, `grimoire-diagnostics-${Date.now()}.zip`) }
      : await saveDialog(owner, {
      title: '导出诊断包',
      defaultPath: `grimoire-diagnostics-${new Date().toISOString().slice(0, 10)}.zip`,
      filters: [{ name: 'Grimoire 诊断包', extensions: ['zip'] }],
    })
    if (result.canceled || !result.filePath) return null
    const manifest = await exportDiagnostics(result.filePath, progressSender(event))
    return { path: result.filePath, manifest }
  })

  ipcMain.handle(IPC_CHANNELS.STORAGE_INSPECT_IMPORT, async (event) => {
    const owner = BrowserWindow.fromWebContents(event.sender) ?? undefined
    const result = await openDialog(owner, {
      title: '选择要导入的备份',
      properties: ['openFile'],
      filters: [
        { name: 'Grimoire 备份包 / 数据库', extensions: ['zip', 'db'] },
        { name: '全部文件', extensions: ['*'] },
      ],
    })
    if (result.canceled || !result.filePaths.length) return null
    try {
      return await inspectImport(result.filePaths[0])
    } catch (error) {
      logEvent('warn', 'storage', 'Import inspection failed', {
        context: error instanceof Error ? error.message : String(error),
        errorCode: 'STORAGE_IMPORT_INSPECT_FAILED',
        retryable: true,
      })
      throw error
    }
  })

  ipcMain.handle(IPC_CHANNELS.STORAGE_INSPECT_IMPORT_PATH, async (_event, filePath: unknown) => {
    if (typeof filePath !== 'string' || !filePath.trim()) throw new Error('导入文件路径无效')
    return await inspectImport(filePath)
  })

  ipcMain.handle(IPC_CHANNELS.STORAGE_APPLY_IMPORT, async (event, filePath: unknown) => {
    if (typeof filePath !== 'string' || !filePath.trim()) throw new Error('导入文件路径无效')
    return await applyImport(filePath, {}, progressSender(event))
  })

  ipcMain.handle(IPC_CHANNELS.STORAGE_DEFAULT_EXPORT_NAME, async () => `grimoire-backup-${new Date().toISOString().slice(0, 10)}.zip`)
}
