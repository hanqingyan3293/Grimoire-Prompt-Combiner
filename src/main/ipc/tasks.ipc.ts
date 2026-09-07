import { BrowserWindow, ipcMain } from 'electron'
import { IPC_CHANNELS } from '../../shared/types'
import type { TaskCreateInput, TaskEvent, TaskStatus } from '../../shared/task-types'
import { cancelPersistedTask, createPersistedTask, getPersistedTask, listPersistedTasks, retryPersistedTask } from '../services/task-repository'
import { requireId } from '../services/input-validation'

function broadcastTask(task: TaskEvent): void {
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) window.webContents.send('task:updated', task)
  }
}

function validateCreateInput(value: unknown): TaskCreateInput {
  if (!value || typeof value !== 'object') throw new Error('任务参数无效')
  const input = value as Record<string, unknown>
  if (input.kind !== 'wd14' && input.kind !== 'comfyui' && input.kind !== 'ai-vision') throw new Error('任务类型无效')
  return { kind: input.kind, input: input.input, maxRetries: typeof input.maxRetries === 'number' ? input.maxRetries : undefined }
}

export function registerTasksIPC(): void {
  ipcMain.handle(IPC_CHANNELS.TASKS_CREATE, async (_event, value: unknown) => {
    const task = createPersistedTask(validateCreateInput(value))
    const event: TaskEvent = { taskId: task.id, kind: task.kind, status: task.status, progress: task.progress }
    broadcastTask(event)
    return task
  })

  ipcMain.handle(IPC_CHANNELS.TASKS_LIST, async (_event, status?: TaskStatus) => {
    if (status && !['queued', 'running', 'paused', 'cancelling', 'succeeded', 'failed', 'cancelled'].includes(status)) throw new Error('任务状态无效')
    return listPersistedTasks(status)
  })

  ipcMain.handle(IPC_CHANNELS.TASKS_GET, async (_event, id: string) => {
    const task = getPersistedTask(requireId(id, '任务 ID'))
    if (!task) throw new Error('任务不存在')
    return task
  })

  ipcMain.handle(IPC_CHANNELS.TASKS_CANCEL, async (_event, id: string) => {
    const task = cancelPersistedTask(requireId(id, '任务 ID'))
    broadcastTask({ taskId: task.id, kind: task.kind, status: task.status, progress: task.progress })
    return task
  })

  ipcMain.handle(IPC_CHANNELS.TASKS_RETRY, async (_event, id: string) => {
    const task = retryPersistedTask(requireId(id, '任务 ID'))
    broadcastTask({ taskId: task.id, kind: task.kind, status: task.status, progress: task.progress })
    return task
  })

  ipcMain.on(IPC_CHANNELS.TASKS_SUBSCRIBE, event => {
    event.sender.send('task:snapshot', listPersistedTasks())
  })
}
