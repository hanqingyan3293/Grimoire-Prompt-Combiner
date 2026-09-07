import { dialog, ipcMain } from 'electron'
import { IPC_CHANNELS } from '../../shared/types'
import type { CanvasDocument } from '../../shared/canvas-types'
import { createCanvasProject, deleteCanvasProject, getCanvasProject, listCanvasProjects, saveCanvasProject } from '../services/canvas.service'
import { requireId, requireText } from '../services/input-validation'
import { exportProjectPackage, importProjectPackage } from '../services/project-package.service'

export function registerCanvasIPC(): void {
  ipcMain.handle(IPC_CHANNELS.CANVAS_LIST, async () => listCanvasProjects().map(project => ({ id: project.id, name: project.name, created_at: project.created_at, updated_at: project.updated_at })))
  ipcMain.handle(IPC_CHANNELS.CANVAS_GET, async (_event, id: unknown) => {
    const project = getCanvasProject(requireId(id, '画布 ID'))
    if (!project) throw new Error('画布项目不存在')
    return project
  })
  ipcMain.handle(IPC_CHANNELS.CANVAS_CREATE, async (_event, name?: unknown) => createCanvasProject(typeof name === 'string' ? name : undefined))
  ipcMain.handle(IPC_CHANNELS.CANVAS_SAVE, async (_event, id: unknown, name: unknown, document: unknown) => {
    if (!document || typeof document !== 'object') throw new Error('画布文档无效')
    return saveCanvasProject(requireId(id, '画布 ID'), requireText(name, '画布名称', 200), document as CanvasDocument)
  })
  ipcMain.handle(IPC_CHANNELS.CANVAS_DELETE, async (_event, id: unknown) => deleteCanvasProject(requireId(id, '画布 ID')))
  ipcMain.handle(IPC_CHANNELS.CANVAS_EXPORT_PACKAGE, async (_event, id: unknown, format: unknown) => {
    const projectId = requireId(id, '画布 ID')
    const selectedFormat = format === 'zip' ? 'zip' : 'json'
    const result = await dialog.showSaveDialog({ defaultPath: selectedFormat === 'zip' ? 'grimoire-project.zip' : 'grimoire-project.json', filters: [{ name: '魔导书项目包', extensions: [selectedFormat] }] })
    if (result.canceled || !result.filePath) return false
    await exportProjectPackage(projectId, result.filePath, selectedFormat)
    return true
  })
  ipcMain.handle(IPC_CHANNELS.CANVAS_IMPORT_PACKAGE, async () => {
    const result = await dialog.showOpenDialog({ properties: ['openFile'], filters: [{ name: '魔导书项目包', extensions: ['json', 'zip'] }] })
    if (result.canceled || !result.filePaths.length) return null
    return importProjectPackage(result.filePaths[0])
  })
}
