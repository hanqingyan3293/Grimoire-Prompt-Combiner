import fs from 'fs'
import os from 'os'
import path from 'path'
import { BrowserWindow } from 'electron'
import { getDatabase } from '../database'
import type { TaskEvent, TaskRecord } from '../../shared/task-types'
import { taskEvent, transitionTask } from './task-state'
import { getPersistedTask, listPersistedTasks, updatePersistedTask } from './task-repository'
import { logEvent } from './logger.service'
import { wd14Worker } from './wd14-worker'
import { comfyUIClient } from './comfy-client'
import { applyComfyBindings } from './comfy-workflow.core'
import { getComfyWorkflow } from './comfy-workflow.service'
import { registerManagedImage } from './image-asset.service'
import { buildQuickWorkflow, type ComfyQuickInput } from './comfy-quick-workflow'
import crypto from 'crypto'

interface WD14Input {
  imageId: number
  threshold?: number
  modelId?: string
}

interface ComfyInput extends ComfyQuickInput {
  workflowId?: string
  values?: Record<string, unknown>
  quick?: boolean
}

async function importComfyImages(taskId: string, images: NonNullable<Awaited<ReturnType<typeof comfyUIClient.history>>['images']>): Promise<{ imageIds: number[]; warnings: string[] }> {
  const imageIds: number[] = []
  const seenImageIds = new Set<number>()
  const warnings: string[] = []
  const tempRoot = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'grimoire-comfy-'))
  try {
    for (const [index, image] of images.slice(0, 64).entries()) {
      try {
        const data = await comfyUIClient.downloadImage(image)
        const tempPath = path.join(tempRoot, `${index}.image`)
        await fs.promises.writeFile(tempPath, data)
        const asset = await registerManagedImage(tempPath, image.filename)
        getDatabase().run('INSERT OR IGNORE INTO task_image_refs (task_id, image_id, source_filename) VALUES (?,?,?)', [taskId, asset.id, image.filename.slice(0, 500)])
        if (!seenImageIds.has(asset.id)) {
          seenImageIds.add(asset.id)
          imageIds.push(asset.id)
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        warnings.push(`${image.filename}: ${message}`)
        logEvent('warn', 'task-runner', 'ComfyUI image import skipped', { taskId, phase: 'asset-import', context: message, errorCode: 'COMFY_IMAGE_IMPORT_ERROR', retryable: false })
      }
    }
  } finally {
    await fs.promises.rm(tempRoot, { recursive: true, force: true })
  }
  return { imageIds, warnings }
}

function addComfyHistory(taskId: string, input: ComfyInput & { values?: Record<string, unknown> }): string | null {
  const prompt = typeof input.prompt === 'string' ? input.prompt.trim() : ''
  const negative = typeof input.negative === 'string' ? input.negative.trim() : ''
  if (!prompt && !negative) return null
  const historyId = 'hist_' + crypto.randomUUID().replaceAll('-', '').slice(0, 20)
  const combined = prompt + (negative ? `\n--neg ${negative}` : '')
  getDatabase().run(
    'INSERT INTO history (id, prompt, positive_count, negative_count, task_id) VALUES (?,?,?,?,?)',
    [historyId, combined.slice(0, 200_000), prompt ? 1 : 0, negative ? 1 : 0, taskId]
  )
  return historyId
}

function broadcast(task: TaskRecord): void {
  const event: TaskEvent = taskEvent(task)
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) window.webContents.send('task:updated', event)
  }
}

function getImagePath(imageId: number): string {
  const result = getDatabase().exec('SELECT file_path, available FROM image_refs WHERE id=?', [imageId])
  const row = result[0]?.values?.[0]
  if (!row) throw new Error('图片资产不存在')
  const filePath = String(row[0])
  if (row[1] === 0 || !fs.existsSync(filePath)) throw new Error('图片文件不可用，请重新定位或导入图片')
  return filePath
}

class TaskRunner {
  private timer: ReturnType<typeof setTimeout> | null = null
  private active = false
  private started = false
  private activePromise: Promise<void> | null = null

  start(): void {
    if (this.started) return
    this.started = true
    this.schedule(0)
  }

  stop(): void {
    this.started = false
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
  }

  async stopAndWait(): Promise<void> {
    this.stop()
    await this.activePromise
  }

  private schedule(delay: number): void {
    if (!this.started) return
    this.timer = setTimeout(() => {
      this.timer = null
      void this.tick()
    }, delay)
  }

  private async tick(): Promise<void> {
    if (!this.started) return
    if (!this.active) {
      const queued = listPersistedTasks('queued')
      const next = queued[0]
      if (next) {
        this.active = true
        this.activePromise = this.execute(next)
        await this.activePromise.finally(() => {
          this.active = false
          this.activePromise = null
        })
      }
    }
    this.schedule(this.active ? 500 : 250)
  }

  private async execute(task: TaskRecord): Promise<void> {
    let running: TaskRecord
    try {
      running = updatePersistedTask(task.id, transitionTask(task, 'running'))
      broadcast(running)
      logEvent('info', 'task-runner', 'Task started', { taskId: task.id, phase: 'start' })

      const input = JSON.parse(running.input_json) as WD14Input & ComfyInput
      if (running.kind === 'comfyui') {
        const workflowRecord = input.workflowId ? getComfyWorkflow(input.workflowId) : null
        const workflow = input.quick ? buildQuickWorkflow(input) : workflowRecord ? applyComfyBindings(JSON.parse(workflowRecord.raw_json), input.values || {}) : null
        if (!workflow) throw new Error('ComfyUI 工作流不存在')
        const submitted = await comfyUIClient.submit(workflow)
        let result = await comfyUIClient.history(submitted.prompt_id)
        while (result.status === 'running') {
          const latest = getPersistedTask(task.id)
          if (latest?.status === 'cancelling') {
            const cancelled = updatePersistedTask(task.id, transitionTask(latest, 'cancelled', { error_code: 'TASK_CANCELLED', error_message: '任务已取消' }))
            broadcast(cancelled)
            return
          }
          await new Promise(resolve => setTimeout(resolve, 1000))
          result = await comfyUIClient.history(submitted.prompt_id)
        }
        if (result.status === 'error') throw new Error(result.message || 'ComfyUI 任务失败')
        const imported = await importComfyImages(task.id, result.images || [])
        const historyId = addComfyHistory(task.id, input)
        const done = updatePersistedTask(task.id, transitionTask(running, 'succeeded', { output_json: JSON.stringify({ promptId: submitted.prompt_id, images: result.images || [], imageIds: imported.imageIds, historyId, importWarnings: imported.warnings }) }))
        broadcast(done)
        logEvent('info', 'task-runner', 'ComfyUI task succeeded', { taskId: task.id, phase: 'complete' })
        return
      }
      if (running.kind !== 'wd14') throw new Error('当前任务类型尚未接入执行器')
      if (!Number.isInteger(input.imageId) || input.imageId <= 0) throw new Error('WD14 任务缺少有效图片')
      const imagePath = getImagePath(input.imageId)
      const image = await fs.promises.readFile(imagePath)
      const result = await wd14Worker.tag(image, input.threshold, input.modelId)
      const latest = getPersistedTask(task.id) || running
      if (latest.status === 'cancelling') {
        const done = updatePersistedTask(task.id, transitionTask(latest, 'cancelled', { error_code: 'TASK_CANCELLED', error_message: '任务已取消' }))
        broadcast(done)
        return
      }
      const done = updatePersistedTask(task.id, transitionTask(running, 'succeeded', { output_json: JSON.stringify(result) }))
      broadcast(done)
      logEvent('info', 'task-runner', 'Task succeeded', { taskId: task.id, phase: 'complete' })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      const current = getPersistedTask(task.id)
      if (!current || current.status === 'succeeded' || current.status === 'cancelled') return
      if (current.status === 'cancelling') {
        const cancelled = updatePersistedTask(task.id, transitionTask(current, 'cancelled', { error_code: 'TASK_CANCELLED', error_message: '任务已取消' }))
        broadcast(cancelled)
        return
      }
      const source = current.status === 'running' ? current : transitionTask(task, 'running')
      const failed = updatePersistedTask(task.id, transitionTask(source, 'failed', { error_code: 'TASK_EXECUTION_ERROR', error_message: message }))
      broadcast(failed)
      logEvent('error', 'task-runner', 'Task failed', { taskId: task.id, phase: 'execute', errorCode: 'TASK_EXECUTION_ERROR', context: message, retryable: true })
    }
  }
}

export const taskRunner = new TaskRunner()
