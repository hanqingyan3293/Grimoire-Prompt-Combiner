import fs from 'fs'
import { BrowserWindow } from 'electron'
import { getDatabase } from '../database'
import type { TaskEvent, TaskRecord } from '../../shared/task-types'
import { taskEvent, transitionTask } from './task-state'
import { failAndRetryPersistedTask, failInvalidExecutionTask, getComfyExecutionSnapshot, getPersistedTask, listPersistedTasks, prepareComfyExecution, requeueComfyReadTask, TaskRepositoryError, updateComfyExecution, updatePersistedTask, type ComfyExecutionSnapshot } from './task-repository'
import { logEvent } from './logger.service'
import { wd14Worker } from './wd14-worker'
import { mergeWd14Results } from './wd14-union.core'
import { comfyUIClient, ComfyUIError, createComfyUIClient, type ComfyResultImage } from './comfy-client'
import { applyComfyBindings, type ComfyWorkflow } from './comfy-workflow.core'
import { getComfyWorkflow } from './comfy-workflow.service'
import { ComfyImageImportError, importComfyImages, type ComfyImportResult } from './comfy-image-import.service'
import { buildQuickWorkflow, type ComfyQuickInput } from './comfy-quick-workflow'
import { cancelComfyExecution, waitForComfyPoll } from '../../integrations/cherry/comfy-source-adapter'
import { saveWD14History } from './wd14-history.service'
import { createTagSuggestions } from './tag-intelligence.service'
import { createMediaRelation, ensureMediaAsset, saveImageGenerationMetadata } from './media.service'
import crypto from 'crypto'

interface WD14Input {
  imageId: number
  threshold?: number
  modelId?: string
  /** Multi-model union (BDTM AutoTagger semantics): run each model, merge tags. */
  modelIds?: string[]
  /** Merge policy across models. 'union' keeps max confidence per tag name;
   *  'intersection' keeps only tags every model agreed on. Default 'union'. */
  unionMode?: 'union' | 'intersection'
}

interface ComfyInput extends ComfyQuickInput {
  workflowId?: string
  values?: Record<string, unknown>
  quick?: boolean
  /** Frozen executable API prompt, written with input_json before POST. */
  frozenWorkflow?: Record<string, unknown>
  frozenAt?: string

}

class ComfySubmitUncertainError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ComfySubmitUncertainError'
  }
}

interface PendingComfyAck {
  endpoint: string
  requestedPromptId: string | null
  promptId: string
  retryCount: number
  retryAt: number
}

interface ActiveComfyRead {
  taskId: string
  controller: AbortController
}

interface PendingComfyReadResume {
  state: ComfyExecutionSnapshot['state']
  retryCount: number
  retryAt: number
  outputJson?: string
}

class TaskReadResumePersistenceError extends Error {
  readonly code = 'TASK_READ_RESUME_PERSIST_PENDING'
  constructor(taskIds: string[]) {
    super('TASK_READ_RESUME_PERSIST_PENDING: 停止读取后的同身份恢复尚未持久化；保留原数据库及任务：' + taskIds.join(', '))
    this.name = 'TaskReadResumePersistenceError'
  }
}

class TaskResultPersistenceError extends Error {
  readonly code = 'TASK_RESULT_PERSIST_PENDING'
  constructor(taskIds: string[]) {
    super('TASK_RESULT_PERSIST_PENDING: 原任务结果尚未持久化；保留原数据库及结算记录：' + taskIds.join(', '))
    this.name = 'TaskResultPersistenceError'
  }
}

/** The POST was accepted; only the ACK write is pending. Never re-POST. */
class TaskAckPersistenceError extends Error {
  readonly code = 'TASK_ACK_PERSIST_PENDING'
  constructor(message: string) {
    super('TASK_ACK_PERSIST_PENDING: ' + message)
    this.name = 'TaskAckPersistenceError'
  }
}

function diagnosticStack(error: unknown): string | undefined {
  if (!(error instanceof Error) || !error.stack) return undefined
  return error.name + '\n' + error.stack.split('\n').filter(line => /^\s*at /.test(line)).join('\n')
}

function runningTask(taskId: string): TaskRecord {
  const current = getPersistedTask(taskId)
  if (!current) throw new TaskRepositoryError('TASK_NOT_FOUND', '任务已经移除')
  if (current.status !== 'running') throw new TaskRepositoryError('TASK_STATE_CONFLICT', '任务已取消、暂停或结束')
  return current
}

function addComfyHistory(taskId: string, input: ComfyInput & { values?: Record<string, unknown> }): string | null {
  const prompt = typeof input.prompt === 'string' ? input.prompt.trim() : ''
  const negative = typeof input.negative === 'string' ? input.negative.trim() : ''
  if (!prompt && !negative) return null
  // Deterministic per task: a finalize retry replaces its row instead of
  // appending a second history record for the same accepted prompt.
  const historyId = 'hist_' + crypto.createHash('sha256').update(taskId).digest('hex').slice(0, 20)
  const combined = prompt + (negative ? `\n--neg ${negative}` : '')
  getDatabase().run(
    'INSERT OR REPLACE INTO history (id, prompt, positive_count, negative_count, task_id) VALUES (?,?,?,?,?)',
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

/**
 * 单模型或多模型反推。多模型（modelIds.length > 1）时逐模型串行调用并合并
 * 结果（合并逻辑在 wd14-union.core，纯函数、可单测）。
 */
async function runWd14Tagging(image: Buffer, input: WD14Input, taskId: string): Promise<import('./wd14-worker').WD14TagResult> {
  const modelIds = Array.isArray(input.modelIds) ? input.modelIds.filter(value => typeof value === 'string' && value) : []
  if (modelIds.length <= 1) {
    return wd14Worker.tag(image, input.threshold, modelIds[0] ?? input.modelId)
  }
  const results: import('./wd14-worker').WD14TagResult[] = []
  for (const modelId of modelIds) {
    runningTask(taskId)
    results.push(await wd14Worker.tag(image, input.threshold, modelId))
    runningTask(taskId)
  }
  return mergeWd14Results(results, input.unionMode === 'intersection' ? 'intersection' : 'union')
}

class TaskRunner {
  private timer: ReturnType<typeof setTimeout> | null = null
  private started = false
  private activePromise: Promise<void> | null = null
  private persistenceCooldown = new Map<string, number>()
  private cancellationCooldown = new Map<string, number>()
  private pendingSettlements = new Map<string, { failure: { error_code: string; error_message: string; output_json?: string }; retryCount: number; retryAt: number }>()
  private pendingAcks = new Map<string, PendingComfyAck>()
  private pendingReadResumes = new Map<string, PendingComfyReadResume>()
  private activeRead: ActiveComfyRead | null = null

  start(): void {
    if (this.started) return
    this.started = true
    this.schedule(0)
  }

  stop(): void {
    this.started = false
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
    // This controller belongs only to reads in the exact active execution.
    // The submit POST has its own client deadline and must still yield its ACK.
    this.activeRead?.controller.abort()
  }

  /** Production cancellation entrypoint; the IPC caller persists intent first. */
  notifyCancellation(taskId: string): void {
    if (this.activeRead?.taskId === taskId) this.activeRead.controller.abort()
    this.cancellationCooldown.delete(taskId)
    this.schedule(0)
  }

  async stopAndWait(): Promise<void> {
    this.stop()
    await this.activePromise
    await this.settlePendingAcks(true)
    if (this.pendingAcks.size) throw new TaskAckPersistenceError('调度已停止，但提交确认尚未持久化；保留原数据库及任务以重试：' + [...this.pendingAcks.keys()].join(', '))
    await this.settlePendingReadResumes(true)
    if (this.pendingReadResumes.size) throw new TaskReadResumePersistenceError([...this.pendingReadResumes.keys()])
    await this.settlePending(true)
    if (this.pendingSettlements.size) throw new TaskResultPersistenceError([...this.pendingSettlements.keys()])
  }

  private async acknowledge(task: TaskRecord, snapshot: ComfyExecutionSnapshot, promptId: string): Promise<ComfyExecutionSnapshot> {
    // Capture the response before any further database access can fail. A
    // requested UUID is not a substitute for a different real response ID.
    const owner: PendingComfyAck = { endpoint: snapshot.state.endpoint, requestedPromptId: snapshot.state.requestedPromptId, promptId, retryCount: task.retry_count, retryAt: Date.now() + 5000 }
    this.pendingAcks.set(task.id, owner)
    const acknowledged = await persistAck(task.id, promptId, owner)
    this.pendingAcks.delete(task.id)
    return acknowledged
  }

  private async settlePendingAcks(force = false): Promise<void> {
    for (const [id, owner] of this.pendingAcks) {
      try {
        const task = getPersistedTask(id)
        if (!task || task.retry_count !== owner.retryCount || task.status === 'succeeded' || task.status === 'failed') {
          this.pendingAcks.delete(id)
          continue
        }
        if (!force && Date.now() < owner.retryAt) continue
        await persistAck(id, owner.promptId, owner)
        if (task.status === 'cancelling' || task.status === 'cancelled') await finishCancellation(getPersistedTask(id)!, owner.promptId)
        else broadcast(requeueComfyReadTask(id))
        this.pendingAcks.delete(id)
      } catch (error) {
        owner.retryAt = Date.now() + 5000
        logEvent('error', 'task-runner', 'Pending ComfyUI ACK persistence failed', { taskId: id, phase: 'ack-persist', context: 'promptId=' + owner.promptId + '; ' + (error instanceof Error ? error.message : String(error)).slice(0, 1200), stack: diagnosticStack(error), errorCode: 'TASK_ACK_PERSIST_PENDING', retryable: true })
      }
    }
  }

  private async settlePendingReadResumes(force = false): Promise<void> {
    for (const [id, owner] of this.pendingReadResumes) {
      if (!force && Date.now() < owner.retryAt) continue
      try {
        const current = getPersistedTask(id)
        if (!current || current.retry_count !== owner.retryCount || current.status === 'succeeded' || current.status === 'failed') {
          this.pendingReadResumes.delete(id)
          continue
        }
        // A cancel arriving during drain always wins over a queued read.
        if (current.status === 'cancelling' || current.status === 'cancelled') {
          await finishCancellation(current, owner.state.promptId, owner.outputJson)
        } else {
          broadcast(requeueComfyReadTask(id, {
            expected: { retryCount: owner.retryCount, state: owner.state },
            reconcileUnconfirmed: owner.state.phase === 'submitting' || owner.state.phase === 'submit-uncertain',
            outputJson: owner.outputJson,
          }))
          logEvent('info', 'task-runner', 'ComfyUI read parked for same-identity resume', { taskId: id, phase: 'read-park', context: 'promptId=' + String(owner.state.promptId) + '; phase=' + owner.state.phase, retryable: false })
        }
        this.pendingReadResumes.delete(id)
      } catch (error) {
        owner.retryAt = Date.now() + 5000
        logEvent('error', 'task-runner', 'Stopped ComfyUI read persistence is pending', { taskId: id, phase: 'read-park-persist', context: 'promptId=' + String(owner.state.promptId) + '; ' + (error instanceof Error ? error.message : String(error)).slice(0, 1200), stack: diagnosticStack(error), errorCode: 'TASK_READ_RESUME_PERSIST_PENDING', retryable: true })
      }
    }
  }

  private schedule(delay: number): void {
    if (!this.started || this.timer || this.activePromise) return
    this.timer = setTimeout(() => {
      this.timer = null
      this.activePromise = this.tick().catch(error => {
        logEvent('error', 'task-runner', 'Task queue read failed', { phase: 'scheduler', context: error instanceof Error ? error.message : String(error), stack: error instanceof Error ? error.stack : undefined, errorCode: 'TASK_SCHEDULER_ERROR', retryable: true })
      }).finally(() => {
        this.activePromise = null
        this.schedule(250)
      })
    }, delay)
  }

  private async settlePending(force = false): Promise<void> {
    for (const [id, pending] of this.pendingSettlements) {
      try {
        const current = getPersistedTask(id)
        if (!current || current.retry_count !== pending.retryCount || ['queued', 'succeeded', 'failed', 'cancelled'].includes(current.status)) {
          this.pendingSettlements.delete(id)
          continue
        }
        // A Comfy cancellation owns a remote request and its outcome. Do not
        // let the older failure settlement bypass that path with cancelled.
        if (current.kind === 'comfyui' && current.status === 'cancelling') {
          if (!force) continue
          await finishCancellation(current, current.execution?.promptId ?? null, pending.failure.output_json)
          this.pendingSettlements.delete(id)
          continue
        }
        if (current.status !== 'cancelling' && (current.status !== 'running' || (!force && Date.now() < pending.retryAt))) continue
        const settled = failAndRetryPersistedTask(id, pending.failure, { allowRetry: false })
        this.pendingSettlements.delete(id)
        broadcast(settled)
        logEvent('info', 'task-runner', 'Pending task result persisted', { taskId: id, phase: 'pending-settlement', context: pending.failure.error_message, errorCode: settled.error_code || pending.failure.error_code, retryable: false })
      } catch (error) {
        pending.retryAt = Date.now() + 5000
        logEvent('error', 'task-runner', 'Pending task result persistence failed', { taskId: id, phase: 'pending-settlement', context: 'persistence=' + (error instanceof Error ? error.message : String(error)).slice(0, 400) + '; ' + pending.failure.error_message, stack: diagnosticStack(error), errorCode: 'TASK_PERSISTENCE_ERROR', retryable: true })
      }
    }
  }

  private async tick(): Promise<void> {
    if (!this.started) return
    await this.settlePendingAcks()
    await this.settlePendingReadResumes()
    await this.settlePending()
    await processCancelling(() => this.started, this.cancellationCooldown, task => {
      const pending = this.pendingSettlements.get(task.id)
      return {
        promptId: this.pendingAcks.get(task.id)?.promptId ?? null,
        outputJson: pending?.retryCount === task.retry_count ? pending.failure.output_json : undefined,
        hasReadResultOwner: this.pendingReadResumes.has(task.id),
      }
    })
    const queued = listPersistedTasks('queued')
    const now = Date.now()
    for (const cooldown of [this.persistenceCooldown, this.cancellationCooldown]) {
      for (const [id, until] of cooldown) if (until <= now) cooldown.delete(id)
    }
    for (const task of queued) {
      if (!this.started) return
      if (task.next_attempt_at && Date.parse(task.next_attempt_at) > now) continue
      if ((this.persistenceCooldown.get(task.id) || 0) > now) continue
      if (this.pendingAcks.has(task.id) || this.pendingReadResumes.has(task.id)) continue
      try {
        await this.execute(task)
        return
      } catch (error) {
        // A broken queued row must not monopolize the following due tasks.
        this.persistenceCooldown.set(task.id, Date.now() + 5000)
        logEvent('error', 'task-runner', 'Task state persistence failed', { taskId: task.id, phase: 'scheduler', context: error instanceof Error ? error.message : String(error), stack: error instanceof Error ? error.stack : undefined, errorCode: 'TASK_PERSISTENCE_ERROR', retryable: true })
      }
    }
  }

  private async execute(task: TaskRecord): Promise<void> {
    let running: TaskRecord
    let submissionStarted = false
    let promptId: string | null = null
    let phase = 'prepare'
    let executionSnapshot: ComfyExecutionSnapshot | null = null
    let executionClient: ReturnType<typeof createComfyUIClient> | null = null
    let importedResult: ComfyImportResult | null = null
    let resultImages: ComfyResultImage[] = []
    const readOwner: ActiveComfyRead | null = task.kind === 'comfyui' ? { taskId: task.id, controller: new AbortController() } : null
    if (readOwner) this.activeRead = readOwner
    const checkComfyRead = () => {
      const current = runningTask(task.id)
      readOwner?.controller.signal.throwIfAborted()
      return current
    }
    try {
      running = updatePersistedTask(task.id, transitionTask(task, 'running'))
      broadcast(running)
      logEvent('info', 'task-runner', 'Task started', { taskId: task.id, phase: 'start' })

      runningTask(task.id)
      const input = JSON.parse(running.input_json) as WD14Input & ComfyInput
      if (running.kind === 'comfyui') {
        if (running.execution_error) {
          const failed = failInvalidExecutionTask(task.id)
          broadcast(failed)
          logEvent('error', 'task-runner', 'ComfyUI execution identity is invalid', { taskId: task.id, phase: 'prepare', context: running.execution_error, errorCode: 'COMFY_EXECUTION_INVALID', retryable: false })
          return
        }
        executionSnapshot = getComfyExecutionSnapshot(task.id)
        let frozenInput: ComfyInput = input
        if (!executionSnapshot) {
          phase = 'prepare'
          const workflow = resolveComfyWorkflow(input)
          if (!workflow) throw new Error('ComfyUI 工作流不存在')
          runningTask(task.id)
          // Freeze the endpoint, executable prompt graph and requested UUID in
          // one durable write before anything reaches the network.
          const frozen: ComfyInput = { ...input, frozenWorkflow: workflow, frozenAt: new Date().toISOString() }
          const prepared = prepareComfyExecution(task.id, comfyUIClient.baseUrl, frozen)
          executionSnapshot = getComfyExecutionSnapshot(task.id)
          frozenInput = JSON.parse(prepared.input_json) as ComfyInput
          executionClient = createComfyUIClient(prepared.execution!.endpoint)
        } else {
          executionClient = createComfyUIClient(executionSnapshot.state.endpoint)
        }
        if (!executionSnapshot) throw new TaskRepositoryError('TASK_EXECUTION_INVALID', '冻结执行状态缺失')
        const workflow = frozenInput.frozenWorkflow || (frozenInput as unknown as Record<string, unknown>)
        if (!workflow || typeof workflow !== 'object') throw new Error('冻结执行输入缺少工作流')
        let state = executionSnapshot.state
        if (state.phase === 'prepared') {
          phase = 'submit'
          executionSnapshot = applyExecutionSnapshot(task.id, executionSnapshot, { ...state, phase: 'submitting' })
          state = executionSnapshot.state
          // Cancellation before the first POST must send zero business requests.
          checkComfyRead()
          const requestedPromptId = state.requestedPromptId
          if (!requestedPromptId) throw new Error('ComfyUI 执行状态缺少请求 ID')
          // A failed submitting CAS still proves that no POST was attempted.
          submissionStarted = true
          try {
            const submitted = await executionClient.submit(workflow as ComfyWorkflow, { requestedPromptId })
            promptId = submitted.prompt_id
          } catch (submitError) {
            executionSnapshot = markSubmitUncertain(task.id, executionSnapshot)
            checkComfyRead()
            const verified = await verifyRequestedPrompt(executionClient, requestedPromptId, readOwner!.controller.signal)
            if (!verified) throw new ComfySubmitUncertainError('ComfyUI 提交结果不确定：服务端未证实请求的 prompt ID，未再次提交')
            promptId = verified
          }
          const ackPromptId = promptId
          if (!ackPromptId) throw new ComfySubmitUncertainError('ComfyUI 提交结果缺少响应 ID')
          executionSnapshot = await this.acknowledge(task, executionSnapshot, ackPromptId)
          state = executionSnapshot.state
          phase = 'history'
        } else if (state.phase === 'submitting' || state.phase === 'submit-uncertain') {
          // A restart between POST and ACK is never evidence that nothing was
          // submitted. Verify the requested ID, then resume the same GET.
          submissionStarted = true
          phase = 'history'
          if (state.phase === 'submitting') {
            executionSnapshot = applyExecutionSnapshot(task.id, executionSnapshot, { ...state, phase: 'submit-uncertain' })
            state = executionSnapshot.state
          }
          const requestedPromptId = state.requestedPromptId
          if (!requestedPromptId) throw new ComfySubmitUncertainError('ComfyUI 执行状态缺少请求 ID')
          checkComfyRead()
          const verified = await verifyRequestedPrompt(executionClient, requestedPromptId, readOwner!.controller.signal)
          if (!verified) throw new ComfySubmitUncertainError('ComfyUI 提交结果不确定：服务端未证实请求的 prompt ID，未再次提交')
          promptId = verified
          executionSnapshot = await this.acknowledge(task, executionSnapshot, verified)
          state = executionSnapshot.state
        } else {
          promptId = state.promptId
          // A resumed waiting/importing task is already post-submit; its GET
          // failures must never be reclassified as a preparation failure.
          submissionStarted = state.promptId !== null
          phase = state.phase === 'importing' ? 'import' : 'history'
        }
        if (!promptId) throw new ComfySubmitUncertainError('ComfyUI 任务缺少已证实的 prompt ID')
        checkComfyRead()
        const readOptions = { signal: readOwner!.controller.signal }
        let result = await executionClient.history(promptId, readOptions)
        checkComfyRead()
        while (result.status === 'running') {
          await waitForComfyPoll(1000, readOptions.signal)
          checkComfyRead()
          result = await executionClient.history(promptId, readOptions)
          checkComfyRead()
        }
        if (result.status === 'error') throw new Error(result.message || 'ComfyUI 任务失败')
        phase = 'import'
        if (executionSnapshot.state.phase === 'waiting') {
          executionSnapshot = applyExecutionSnapshot(task.id, executionSnapshot, { ...executionSnapshot.state, phase: 'importing' })
        }
        resultImages = result.images || []
        const imported = await importComfyImages(task.id, resultImages, executionClient, checkComfyRead, readOptions)
        importedResult = imported
        checkComfyRead()
        if (resultImages.length > 0 && imported.imageIds.length === 0) {
          throw new ComfyImageImportError('ComfyUI 生成的图片全部导入失败：' + imported.warnings.join('; ').slice(0, 1200), false, imported)
        }
        const generationInput = frozenInput as ComfyInput & { prompt?: string; negative?: string; seed?: number; steps?: number; cfg?: number; width?: number; height?: number; sampler?: string; scheduler?: string; model?: string; loras?: unknown[] }
        phase = 'finalize'
        const db = getDatabase()
        let done: TaskRecord
        db.exec('BEGIN IMMEDIATE')
        try {
          runningTask(task.id)
          for (const imageId of imported.imageIds) {
            const media = ensureMediaAsset(imageId, 'generated-comfy')
            saveImageGenerationMetadata({ media_asset_id: media.id, prompt: String(generationInput.prompt || ''), negative_prompt: String(generationInput.negative || ''), provider: 'comfyui', model: String(generationInput.model || ''), checkpoint: String(generationInput.model || ''), loras: Array.isArray(generationInput.loras) ? generationInput.loras : [], seed: typeof generationInput.seed === 'number' ? generationInput.seed : null, sampler: String(generationInput.sampler || ''), scheduler: String(generationInput.scheduler || ''), steps: typeof generationInput.steps === 'number' ? generationInput.steps : null, cfg: typeof generationInput.cfg === 'number' ? generationInput.cfg : null, width: typeof generationInput.width === 'number' ? generationInput.width : null, height: typeof generationInput.height === 'number' ? generationInput.height : null, raw: { workflowId: generationInput.workflowId || null } })
            createMediaRelation({ sourceType: 'image', sourceKey: 'image:' + imageId, relationType: 'uses-prompt', targetType: 'task', targetKey: task.id })
          }
          const historyId = addComfyHistory(task.id, generationInput)
          done = updatePersistedTask(task.id, transitionTask(runningTask(task.id), 'succeeded', { output_json: JSON.stringify({ version: 1, promptId, images: resultImages, imageIds: imported.imageIds, historyId, importWarnings: imported.warnings, imageResults: imported.imageResults }) }))
          db.exec('COMMIT')
        } catch (finalizeError) {
          try { db.exec('ROLLBACK') } catch (rollbackError) { console.debug('[tasks] ComfyUI rollback settled', rollbackError instanceof Error ? rollbackError.message : String(rollbackError)) }
          throw finalizeError
        }
        broadcast(done)
        logEvent('info', 'task-runner', 'ComfyUI task succeeded', { taskId: task.id, phase: 'complete' })
        return
      }
      if (running.kind !== 'wd14') throw new Error('当前任务类型尚未接入执行器')
      if (!Number.isInteger(input.imageId) || input.imageId <= 0) throw new Error('WD14 任务缺少有效图片')
      const imagePath = getImagePath(input.imageId)
      const image = await fs.promises.readFile(imagePath)
      runningTask(task.id)
      const result = await runWd14Tagging(image, input, task.id)
      runningTask(task.id)
      const db = getDatabase()
      let done: TaskRecord
      db.exec('BEGIN IMMEDIATE')
      try {
        runningTask(task.id)
        saveWD14History({ taskId: task.id, imageId: input.imageId, tags: result, modelId: input.modelId, threshold: input.threshold, status: 'succeeded' })
        const tagValues = (['general', 'character', 'rating', 'quality'] as const).flatMap(namespace => result[namespace].map(item => ({ value: item.name, confidence: item.confidence, namespace }))).filter(item => item.value)
        if (tagValues.length) createTagSuggestions(db, { assetType: 'image', assetKey: 'image:' + input.imageId, source: 'wd14', values: tagValues })
        done = updatePersistedTask(task.id, transitionTask(runningTask(task.id), 'succeeded', { output_json: JSON.stringify(result) }))
        db.exec('COMMIT')
      } catch (finalizeError) {
        try { db.exec('ROLLBACK') } catch (rollbackError) { console.debug('[tasks] WD14 rollback settled', rollbackError instanceof Error ? rollbackError.message : String(rollbackError)) }
        throw finalizeError
      }
      broadcast(done)
      logEvent('info', 'task-runner', 'Task succeeded', { taskId: task.id, phase: 'complete' })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      const partial = error instanceof ComfyImageImportError ? error.result : importedResult
      const partialOutput = partial && promptId ? JSON.stringify({ version: 1, promptId, images: resultImages, imageIds: partial.imageIds, historyId: null, importWarnings: partial.warnings, imageResults: partial.imageResults }) : undefined
      const originalCode = error instanceof ComfyUIError || error instanceof TaskRepositoryError ? error.code : 'TASK_EXECUTION_ERROR'
      if (error instanceof TaskAckPersistenceError) {
        logEvent('error', 'task-runner', 'ComfyUI ACK persistence is pending; the accepted POST is not repeated', { taskId: task.id, phase: 'ack-persist', context: message.slice(0, 1200), stack: diagnosticStack(error), errorCode: 'TASK_PERSISTENCE_ERROR', retryable: true })
        return
      }
      if (readOwner?.controller.signal.aborted && executionSnapshot) {
        // Capture only the durable park/partial write before another DB lookup
        // can fail. Local stop/cancel is not a generation failure or retry.
        this.pendingReadResumes.set(task.id, { state: executionSnapshot.state, retryCount: task.retry_count, retryAt: Date.now(), outputJson: partialOutput })
        await this.settlePendingReadResumes(true)
        return
      }
      let current: TaskRecord | null = null
      let lookupFailed = false
      try { current = getPersistedTask(task.id) } catch (lookupError) {
        lookupFailed = true
        logEvent('error', 'task-runner', 'Task catch lookup failed', { taskId: task.id, phase, context: message.slice(0, 1200) + '; lookup=' + (lookupError instanceof Error ? lookupError.message : String(lookupError)).slice(0, 400), stack: diagnosticStack(lookupError), errorCode: 'TASK_PERSISTENCE_ERROR', retryable: true })
      }
      if (current && (current.status === 'cancelling' || current.status === 'cancelled')) {
        if (partialOutput && executionSnapshot) {
          this.pendingReadResumes.set(task.id, { state: executionSnapshot.state, retryCount: task.retry_count, retryAt: Date.now(), outputJson: partialOutput })
          await this.settlePendingReadResumes(true)
          return
        }
        try {
          await finishCancellation(current, promptId)
        } catch (cancelError) {
          logEvent('error', 'task-runner', 'ComfyUI cancellation could not be settled', { taskId: task.id, phase: 'cancel', context: (cancelError instanceof Error ? cancelError.message : String(cancelError)).slice(0, 1200), stack: diagnosticStack(cancelError), errorCode: 'COMFY_CANCEL_FAILED', retryable: true })
        }
        return
      }
      const transientQuery = error instanceof ComfyUIError && error.retryable && (phase === 'history' || phase === 'import')
      const code = task.kind !== 'comfyui' ? originalCode
        : !submissionStarted ? 'COMFY_PREPARE_FAILED'
        : transientQuery ? 'COMFY_QUERY_TRANSIENT'
        : error instanceof ComfyUIError && error.code === 'COMFY_IMAGE_IMPORT_ERROR' ? error.code
        : promptId ? 'COMFY_POST_SUBMIT_FAILURE'
        : 'COMFY_SUBMIT_UNCERTAIN'
      // Identity and cause lead the bounded log context; a long server stack must not erase them.
      const prefix = `phase=${phase}; promptId=${promptId?.slice(0, 256) || 'unknown'}; cause=${originalCode}; `
      const diagnostic = prefix + message.slice(0, 1200)
      const failure: { error_code: string; error_message: string; output_json?: string } = { error_code: code, error_message: diagnostic }
      if (partialOutput) failure.output_json = partialOutput
      logEvent('warn', 'task-runner', 'Task attempt failed', { taskId: task.id, phase: 'attempt-error', context: diagnostic, stack: diagnosticStack(error), errorCode: code, retryable: false })
      let settled: TaskRecord
      try {
        if (!current && lookupFailed) {
          // A failed SELECT is not proof that ownership disappeared. Retain
          // only the result write; the business operation is never repeated.
          this.pendingSettlements.set(task.id, { failure, retryCount: task.retry_count, retryAt: Date.now() + 5000 })
          return
        }
        if (!current || ['succeeded', 'failed', 'cancelled'].includes(current.status)) { this.pendingSettlements.delete(task.id); return }
        if (task.kind === 'comfyui' && code === 'COMFY_SUBMIT_UNCERTAIN' && executionSnapshot) {
          try { executionSnapshot = markSubmitUncertain(task.id, executionSnapshot) } catch { /* cancellation already settled the row */ }
        }
        if (current.kind === 'wd14' && current.status === 'running') {
          try {
            const failedInput = JSON.parse(current.input_json) as WD14Input
            if (Number.isInteger(failedInput.imageId) && failedInput.imageId > 0) {
              saveWD14History({ taskId: task.id, imageId: failedInput.imageId, modelId: failedInput.modelId, threshold: failedInput.threshold, status: 'failed', errorMessage: diagnostic })
            }
          } catch (historyError) {
            logEvent('warn', 'task-runner', 'WD14 failure history was not persisted', { taskId: task.id, phase: 'failure-history', context: prefix + (historyError instanceof Error ? historyError.message : String(historyError)).slice(0, 1200), stack: diagnosticStack(historyError), errorCode: 'TASK_HISTORY_ERROR', retryable: false })
          }
        }
        // Only a transient GET/download of an already-admitted prompt may back
        // off and resume. Submit uncertainty stays a terminal negative result
        // until the service proves the requested identity.
        settled = failAndRetryPersistedTask(task.id, failure, { allowRetry: transientQuery })
        this.pendingSettlements.delete(task.id)
      } catch (persistError) {
        this.pendingSettlements.set(task.id, { failure, retryCount: task.retry_count, retryAt: Date.now() + 5000 })
        const persistence = (persistError instanceof Error ? persistError.message : String(persistError)).slice(0, 256)
        logEvent('error', 'task-runner', 'Task result persistence failed', { taskId: task.id, phase: 'failure-persist', context: prefix + 'persistence=' + persistence + '; ' + message.slice(0, 1200), stack: diagnosticStack(persistError), errorCode: code, retryable: false })
        throw persistError
      }
      broadcast(settled)
      logEvent(settled.status === 'cancelled' ? 'info' : 'error', 'task-runner', 'Task execution settled', { taskId: task.id, phase, context: diagnostic, stack: diagnosticStack(error), errorCode: settled.error_code || code, retryable: false })
    } finally {
      if (this.activeRead === readOwner) this.activeRead = null
    }
  }
}

async function persistAck(taskId: string, promptId: string, owner: PendingComfyAck): Promise<ComfyExecutionSnapshot> {
  let lastError: unknown
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const current = getComfyExecutionSnapshot(taskId)
      const task = getPersistedTask(taskId)
      if (!current || !task) throw new TaskRepositoryError('TASK_NOT_FOUND', '任务不存在')
      if (task.retry_count !== owner.retryCount || current.state.endpoint !== owner.endpoint || current.state.requestedPromptId !== owner.requestedPromptId) {
        throw new TaskRepositoryError('TASK_STATE_CONFLICT', '提交确认不属于当前执行身份或尝试')
      }
      if (current.state.promptId === promptId) return current
      updateComfyExecution(taskId, current.raw, { ...current.state, phase: 'waiting', promptId })
      return getComfyExecutionSnapshot(taskId)!
    } catch (error) {
      lastError = error
      try {
        const latest = getComfyExecutionSnapshot(taskId)
        if (latest && latest.state.promptId === promptId && latest.state.endpoint === owner.endpoint
          && latest.state.requestedPromptId === owner.requestedPromptId && getPersistedTask(taskId)?.retry_count === owner.retryCount) return latest
      } catch { /* keep retrying the exact-value write */ }
    }
  }
  // The POST is already accepted. Keep the in-memory owner and let the next
  // recovery/ACK attempt write the identity; never submit the workflow again.
  throw new TaskAckPersistenceError('ComfyUI prompt acknowledged but execution state persistence failed: ' + (lastError instanceof Error ? lastError.message : String(lastError)))
}

async function processCancelling(isStarted: () => boolean, cooldown: Map<string, number>, context: (task: TaskRecord) => { promptId: string | null; outputJson?: string; hasReadResultOwner: boolean }): Promise<void> {
  for (const task of listPersistedTasks('cancelling')) {
    if (!isStarted()) return
    const owner = context(task)
    // A retained cancellation result owns its partial output and settlement.
    // The ordinary scan must not write a terminal row without those facts.
    if (owner.hasReadResultOwner || (cooldown.get(task.id) || 0) > Date.now()) continue
    try {
      await finishCancellation(task, owner.promptId, owner.outputJson)
    } catch (error) {
      cooldown.set(task.id, Date.now() + 5000)
      logEvent('error', 'task-runner', 'Cancellation settlement failed', { taskId: task.id, phase: 'cancel', context: (error instanceof Error ? error.message : String(error)).slice(0, 1200), stack: diagnosticStack(error), errorCode: 'COMFY_CANCEL_FAILED', retryable: true })
    }
  }
}

async function finishCancellation(task: TaskRecord, knownPromptId: string | null, outputJson?: string): Promise<void> {
  let snapshot: ComfyExecutionSnapshot | null = null
  try { snapshot = getComfyExecutionSnapshot(task.id) } catch (error) {
    // A failed database read is not a NULL/corrupt identity. Keep the cancel
    // intent pending and retry the snapshot before sending or settling it.
    if (!(error instanceof TaskRepositoryError) || error.code !== 'TASK_EXECUTION_INVALID') throw error
    logEvent('warn', 'task-runner', 'Cancellation found an unreadable ComfyUI identity', { taskId: task.id, phase: 'cancel', context: (error instanceof Error ? error.message : String(error)).slice(0, 1200), errorCode: 'COMFY_EXECUTION_INVALID', retryable: false })
  }
  let outcome: 'remote-confirmed' | 'local-only' | 'failed' = 'local-only'
  if (snapshot) {
    const state = snapshot.state
    let confirmedPromptId = knownPromptId || state.promptId
    const target = confirmedPromptId || ((state.phase === 'submitting' || state.phase === 'submit-uncertain') ? state.requestedPromptId : null)
    if (state.cancelOutcome === 'remote-confirmed') outcome = 'remote-confirmed'
    else if (target) {
      try {
        const observed = await cancelComfyExecution({ endpoint: state.endpoint, promptId: target })
        outcome = observed.outcome
        // Strict same-id service evidence confirms a requested candidate as a
        // real identity. Absence/void/local-only must never invent that ACK.
        if (outcome === 'remote-confirmed') confirmedPromptId = target
      } catch (error) {
        outcome = 'failed'
        logEvent('warn', 'task-runner', 'ComfyUI remote cancellation threw', { taskId: task.id, phase: 'cancel', context: (error instanceof Error ? error.message : String(error)).slice(0, 1200), stack: diagnosticStack(error), errorCode: 'COMFY_CANCEL_FAILED', retryable: false })
      }
    }
    snapshot = await persistCancelOutcome(task.id, outcome, confirmedPromptId)
  }
  const current = getPersistedTask(task.id)
  if (!current) return
  if (current.status === 'cancelling') {
    const cancelled = updatePersistedTask(task.id, transitionTask(current, 'cancelled', { error_code: 'TASK_CANCELLED', error_message: '任务已取消', next_attempt_at: null, ...(outputJson !== undefined ? { output_json: outputJson } : {}) }))
    broadcast(cancelled)
    return
  }
  broadcast(current)
}

async function persistCancelOutcome(taskId: string, outcome: 'remote-confirmed' | 'local-only' | 'failed', confirmedPromptId: string | null): Promise<ComfyExecutionSnapshot> {
  let lastError: unknown
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const current = getComfyExecutionSnapshot(taskId)
      if (!current) throw new TaskRepositoryError('TASK_NOT_FOUND', '任务不存在')
      const next = { ...current.state, cancelOutcome: outcome }
      if (next.promptId === null && confirmedPromptId !== null) {
        next.promptId = confirmedPromptId
        next.phase = 'waiting'
      }
      updateComfyExecution(taskId, current.raw, next)
      return getComfyExecutionSnapshot(taskId)!
    } catch (error) {
      lastError = error
      try {
        const latest = getComfyExecutionSnapshot(taskId)
        if (latest && latest.state.cancelOutcome === outcome) return latest
      } catch { /* keep retrying the exact-value write */ }
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError))
}

function resolveComfyWorkflow(input: ComfyInput): Record<string, unknown> | null {
  if (input.quick) return buildQuickWorkflow(input) as unknown as Record<string, unknown>
  const workflowRecord = input.workflowId ? getComfyWorkflow(input.workflowId) : null
  if (!workflowRecord) return null
  return applyComfyBindings(JSON.parse(workflowRecord.raw_json), input.values || {}) as unknown as Record<string, unknown>
}

function applyExecutionSnapshot(taskId: string, snapshot: ComfyExecutionSnapshot, next: ComfyExecutionSnapshot['state']): ComfyExecutionSnapshot {
  try {
    updateComfyExecution(taskId, snapshot.raw, next)
  } catch (error) {
    if (!(error instanceof TaskRepositoryError) || error.code !== 'TASK_STATE_CONFLICT') throw error
    const current = getComfyExecutionSnapshot(taskId)
    if (!current) throw error
    const cancelOutcome = next.cancelOutcome === 'none' ? current.state.cancelOutcome : next.cancelOutcome
    updateComfyExecution(taskId, current.raw, { ...next, cancelOutcome })
  }
  return getComfyExecutionSnapshot(taskId)!
}

function markSubmitUncertain(taskId: string, snapshot: ComfyExecutionSnapshot): ComfyExecutionSnapshot {
  if (snapshot.state.phase === 'submit-uncertain') return snapshot
  if (snapshot.state.phase !== 'submitting') return snapshot
  try {
    return applyExecutionSnapshot(taskId, snapshot, { ...snapshot.state, phase: 'submit-uncertain' })
  } catch {
    return getComfyExecutionSnapshot(taskId) || snapshot
  }
}

async function verifyRequestedPrompt(client: ReturnType<typeof createComfyUIClient>, requestedPromptId: string, signal: AbortSignal): Promise<string | null> {
  try {
    const located = await client.locate(requestedPromptId, { signal })
    return located.known ? requestedPromptId : null
  } catch (error) {
    if (signal.aborted) throw error
    return null
  }
}

export const taskRunner = new TaskRunner()
