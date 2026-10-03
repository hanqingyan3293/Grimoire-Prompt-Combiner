import { dialog, ipcMain } from 'electron'
import { IPC_CHANNELS } from '../../shared/types'
import { createPersistedTask } from '../services/task-repository'
import { optionalBoundedNumber, requireId } from '../services/input-validation'
import { configureWD14ModelDirectory, configureWD14PythonPath, wd14Worker } from '../services/wd14-worker'
import { clearWD14History, deleteWD14History, getWD14History, listWD14History } from '../services/wd14-history.service'

export function registerWD14IPC(): void {
  ipcMain.handle('wd14:diagnostics', async () => wd14Worker.diagnostics())
  ipcMain.handle('wd14:selectModelDirectory', async () => {
    const result = await dialog.showOpenDialog({ properties: ['openDirectory', 'createDirectory'] })
    if (result.canceled || !result.filePaths.length) return null
    const directory = result.filePaths[0]
    await wd14Worker.stop()
    configureWD14ModelDirectory(directory)
    return directory
  })
  ipcMain.handle('wd14:selectPythonPath', async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openFile'],
      filters: [{ name: 'Python', extensions: ['exe'] }],
    })
    if (result.canceled || !result.filePaths.length) return null
    const pythonPath = result.filePaths[0]
    await wd14Worker.stop()
    configureWD14PythonPath(pythonPath)
    return pythonPath
  })
  ipcMain.handle(IPC_CHANNELS.WD14_STATUS, async () => wd14Worker.status())
  ipcMain.handle(IPC_CHANNELS.WD14_MODELS, async () => wd14Worker.models())
  ipcMain.handle(IPC_CHANNELS.WD14_SWITCH_MODEL, async (_event, modelId: unknown) => {
    return wd14Worker.switchModel(requireId(modelId, '模型 ID'))
  })
  ipcMain.handle(IPC_CHANNELS.WD14_CREATE_TASK, async (_event, input: unknown) => {
    if (!input || typeof input !== 'object') throw new Error('WD14 任务参数无效')
    const value = input as Record<string, unknown>
    const imageId = Number(value.imageId)
    if (!Number.isInteger(imageId) || imageId <= 0) throw new Error('图片 ID 无效')
    const threshold = optionalBoundedNumber(value.threshold, '阈值', 0.01, 0.99)
    if (value.modelId !== undefined && value.modelId !== null) requireId(value.modelId, '模型 ID')
    return createPersistedTask({
      kind: 'wd14',
      input: { imageId, threshold: threshold ?? 0.35, modelId: value.modelId || undefined },
    })
  })
  ipcMain.handle(IPC_CHANNELS.WD14_HISTORY_LIST, async (_event, input: unknown) => {
    const value = input && typeof input === 'object' ? input as Record<string, unknown> : {}
    return listWD14History({
      query: typeof value.query === 'string' ? value.query : '',
      status: value.status === 'failed' || value.status === 'succeeded' ? value.status : undefined,
      limit: Number.isFinite(Number(value.limit)) ? Number(value.limit) : 100,
      offset: Number.isFinite(Number(value.offset)) ? Number(value.offset) : 0,
    })
  })
  ipcMain.handle(IPC_CHANNELS.WD14_HISTORY_GET, async (_event, id: unknown) => getWD14History(requireId(id, '历史记录 ID')))
  ipcMain.handle(IPC_CHANNELS.WD14_HISTORY_DELETE, async (_event, id: unknown) => deleteWD14History(requireId(id, '历史记录 ID')))
  ipcMain.handle(IPC_CHANNELS.WD14_HISTORY_CLEAR, async () => clearWD14History())
}
