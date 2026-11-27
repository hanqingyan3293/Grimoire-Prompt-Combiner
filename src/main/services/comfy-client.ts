import { logEvent } from './logger.service'
import { requireComfyAddress } from './input-validation'
import { ComfyUIError, readComfyAbortError as readAbortError } from './comfy-error'
import { requestComfyJson, requestComfyImage, COMFY_REQUEST_TIMEOUT_MS as REQUEST_TIMEOUT_MS } from './comfy-http.transport'
import { discoverComfyWorkflows, requireComfyWorkflowHandle } from '../../integrations/cherry/comfy-workflow-adapter'
import type { ComfyHistoryResult, ComfyQueue, ComfyResultImage } from '../../shared/types'
import type { ComfyWorkflow } from './comfy-workflow.core'

export type { ComfyHistoryResult, ComfyQueue, ComfyResultImage } from '../../shared/types'
export { ComfyUIError } from './comfy-error'

export interface ComfyStatus { online: boolean; comfyui_version: string | null; error?: string }
export interface ComfyModels { checkpoints: string[]; unets: string[]; loras: string[] }
export interface ComfyReadOptions { signal?: AbortSignal }


function extractNames(payload: unknown, className: string, field: string): string[] {
  if (!payload || typeof payload !== 'object') return []
  const node = (payload as Record<string, unknown>)[className]
  if (!node || typeof node !== 'object') return []
  const input = (node as Record<string, unknown>).input
  const required = input && typeof input === 'object' ? (input as Record<string, unknown>).required : null
  const values = required && typeof required === 'object' ? (required as Record<string, unknown>)[field] : null
  if (!Array.isArray(values) || !Array.isArray(values[0])) return []
  return values[0].filter((value): value is string => typeof value === 'string').slice(0, 10000)
}

function promptIds(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.map(item => Array.isArray(item) ? item[1] : item && typeof item === 'object' ? (item as Record<string, unknown>).prompt_id : null).filter((id): id is string => typeof id === 'string')
}

function historyRecord(value: unknown, context = '历史响应'): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ComfyUIError('COMFY_BAD_RESPONSE', 'ComfyUI ' + context + '结构无效', false)
  return value as Record<string, unknown>
}

function queueRecord(value: unknown): Record<string, unknown> {
  const queue = historyRecord(value, '队列响应')
  if (!Array.isArray(queue.queue_running) || !Array.isArray(queue.queue_pending)) throw new ComfyUIError('COMFY_BAD_RESPONSE', 'ComfyUI 队列响应列表无效', false)
  return queue
}

/** Match the source outcome rules, while validating the one owned history key. */
function parseHistory(endpoint: string, promptId: string, payload: unknown): { known: boolean; history: ComfyHistoryResult } {
  const records = historyRecord(payload)
  if (!Object.hasOwn(records, promptId)) return { known: false, history: { status: 'running' } }
  const entry = historyRecord(records[promptId])
  const status = entry.status === undefined ? undefined : historyRecord(entry.status)
  if (entry.prompt !== undefined && (!Array.isArray(entry.prompt) || entry.prompt[1] !== promptId)) throw new ComfyUIError('COMFY_BAD_RESPONSE', 'ComfyUI 历史中的 prompt 身份不匹配', false)
  if (status?.status_str === 'error') return { known: true, history: { status: 'error', message: JSON.stringify(status.messages || []) } }
  const known = status?.status_str === 'success' || Array.isArray(entry.prompt)
  if (entry.outputs === undefined) return { known, history: { status: 'running' } }
  const outputs = historyRecord(entry.outputs)
  if (Object.keys(outputs).length === 0) return { known, history: { status: 'running' } }
  const images: ComfyResultImage[] = []
  for (const value of Object.values(outputs)) {
    const output = historyRecord(value)
    if (output.images === undefined) continue
    if (!Array.isArray(output.images)) throw new ComfyUIError('COMFY_BAD_RESPONSE', 'ComfyUI 历史图片列表无效', false)
    for (const raw of output.images) {
      const image = historyRecord(raw)
      if (typeof image.filename !== 'string' || !image.filename
        || (image.subfolder !== undefined && typeof image.subfolder !== 'string')
        || (image.type !== undefined && typeof image.type !== 'string')) throw new ComfyUIError('COMFY_BAD_RESPONSE', 'ComfyUI 历史图片来源无效', false)
      const filename = image.filename
      const subfolder = typeof image.subfolder === 'string' ? image.subfolder : ''
      const type = typeof image.type === 'string' ? image.type : 'output'
      images.push({ filename, subfolder, type, url: endpoint + '/view?' + new URLSearchParams({ filename, subfolder, type }).toString() })
    }
  }
  if (images.length === 0) throw new ComfyUIError('COMFY_EXECUTION_FAILED', 'ComfyUI 工作流有输出但没有可导入的图片', false)
  return { known: true, history: { status: 'done', images } }
}

export class ComfyUIClient {
  baseUrl: string
  constructor(baseUrl = process.env.COMFYUI_API_BASE || 'http://127.0.0.1:8188') { this.baseUrl = requireComfyAddress(baseUrl, 'ComfyUI 地址') }
  setBaseUrl(baseUrl: string): void { this.baseUrl = requireComfyAddress(baseUrl, 'ComfyUI 地址') }
  private async request<T>(pathname: string, init: RequestInit = {}, timeoutMs = REQUEST_TIMEOUT_MS): Promise<T> {
    if (init.signal?.aborted) throw readAbortError()
    try {
      return await requestComfyJson<T>(this.baseUrl, pathname, init, timeoutMs)
    } catch (error) {
      if (init.signal?.aborted || (error instanceof Error && error.name === 'AbortError')) throw readAbortError()
      const typed = error instanceof ComfyUIError ? error : new ComfyUIError('COMFY_TRANSPORT_ERROR', error instanceof Error ? error.message : String(error), true)
      logEvent('error', 'comfyui', 'ComfyUI request failed', { context: typed.message, errorCode: typed.code, retryable: typed.retryable })
      throw typed
    }
  }
  async status(): Promise<ComfyStatus> {
    try { const payload = await this.request<Record<string, unknown>>('/system_stats'); const system = payload.system as Record<string, unknown> | undefined; return { online: true, comfyui_version: typeof system?.comfyui_version === 'string' ? system.comfyui_version : null } }
    catch (error) { return { online: false, comfyui_version: null, error: error instanceof Error ? error.message : String(error) } }
  }
  async models(): Promise<ComfyModels> {
    const catalog = await this.objectInfo()
    return {
      checkpoints: extractNames(catalog, 'CheckpointLoaderSimple', 'ckpt_name'),
      unets: extractNames(catalog, 'UNETLoader', 'unet_name'),
      loras: uniqueNames([
        ...extractNames(catalog, 'LoraLoader', 'lora_name'),
        ...extractNames(catalog, 'LoraLoaderModelOnly', 'lora_name'),
      ]),
    }
  }
  async objectInfo(): Promise<Record<string, unknown>> {
    const payload = await this.request<unknown>('/object_info')
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new ComfyUIError('COMFY_BAD_RESPONSE', 'ComfyUI 节点定义无效', false)
    return payload as Record<string, unknown>
  }
  async remoteWorkflows(options: ComfyReadOptions = {}): Promise<string[]> {
    return discoverComfyWorkflows(this.baseUrl, options.signal)
  }
  async readRemoteWorkflow(handle: string, options: ComfyReadOptions = {}): Promise<unknown> {
    const safeHandle = requireComfyWorkflowHandle(handle)
    return this.request<unknown>('/userdata/' + encodeURIComponent('workflows/' + safeHandle + '.json'), options)
  }
  async submit(workflow: ComfyWorkflow, options: { requestedPromptId?: string; signal?: AbortSignal } = {}): Promise<{ prompt_id: string; number?: number }> {
    const body: Record<string, unknown> = { prompt: workflow }
    if (options.requestedPromptId) body.prompt_id = options.requestedPromptId
    const payload = historyRecord(await this.request<unknown>('/prompt', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: options.signal }), '提交响应')
    if (typeof payload.prompt_id !== 'string' || !payload.prompt_id || payload.prompt_id !== payload.prompt_id.trim()
      || payload.prompt_id.length > 200 || /[\u0000-\u001f\u007f]/.test(payload.prompt_id)) throw new ComfyUIError('COMFY_BAD_RESPONSE', 'ComfyUI 未返回有效 prompt_id', false)
    return { prompt_id: payload.prompt_id, number: typeof payload.number === 'number' ? payload.number : undefined }
  }
  async queue(promptId = '', options: ComfyReadOptions = {}): Promise<ComfyQueue> {
    const queue = queueRecord(await this.request<unknown>('/queue', options)); const running = promptIds(queue.queue_running); const pending = promptIds(queue.queue_pending)
    return { queue_pending: pending.length, queue_running: running.length, queued: pending.includes(promptId), running: running.includes(promptId), queue_remaining: pending.length }
  }
  async history(promptId: string, options: ComfyReadOptions = {}): Promise<ComfyHistoryResult> {
    return parseHistory(this.baseUrl, promptId, await this.request<unknown>('/history/' + encodeURIComponent(promptId), options)).history
  }
  /** Verify a requested ID without assuming it became the response ID. */
  async locate(promptId: string, options: ComfyReadOptions = {}): Promise<{ known: boolean; stage: 'pending' | 'running' | 'history' | 'none'; history: ComfyHistoryResult | null }> {
    let queueError: unknown
    try {
      const queue = queueRecord(await this.request<unknown>('/queue', options))
      const running = promptIds(queue.queue_running)
      const pending = promptIds(queue.queue_pending)
      if (pending.includes(promptId)) return { known: true, stage: 'pending', history: null }
      if (running.includes(promptId)) return { known: true, stage: 'running', history: null }
    } catch (error) {
      if (options.signal?.aborted) throw readAbortError()
      queueError = error
    }
    const observed = parseHistory(this.baseUrl, promptId, await this.request<unknown>('/history/' + encodeURIComponent(promptId), options))
    if (observed.known) return { known: true, stage: 'history', history: observed.history }
    if (queueError) throw queueError
    return { known: false, stage: 'none', history: null }
  }
  async downloadImage(image: ComfyResultImage, options: ComfyReadOptions = {}): Promise<Buffer> {
    if (options.signal?.aborted) throw readAbortError()
    try {
      const target = new URL(image.url)
      const base = new URL(requireComfyAddress(this.baseUrl, 'ComfyUI 地址'))
      if (target.origin !== base.origin || target.pathname !== base.pathname.replace(/\/+$/, '') + '/view') throw new ComfyUIError('COMFY_ADDRESS_INVALID', 'ComfyUI 图片地址不在配置的服务范围内', false)
      return await requestComfyImage(this.baseUrl, target.toString(), options.signal)
    } catch (error) {
      if (options.signal?.aborted || (error instanceof Error && error.name === 'AbortError')) throw readAbortError()
      const typed = error instanceof ComfyUIError ? error : new ComfyUIError('COMFY_ADDRESS_INVALID', error instanceof Error ? error.message : String(error), false)
      logEvent('error', 'comfyui', 'ComfyUI image download failed', { context: typed.message, errorCode: typed.code, retryable: typed.retryable })
      throw typed
    }
  }
}

export const comfyUIClient = new ComfyUIClient()

/** Fixed-endpoint client for one persisted execution; never the mutable global. */
export function createComfyUIClient(baseUrl: string): ComfyUIClient {
  return new ComfyUIClient(baseUrl)
}

export function configureComfyUI(baseUrl: string): void {
  comfyUIClient.setBaseUrl(baseUrl)
}

function uniqueNames(names: string[]): string[] {
  return [...new Set(names)]
}
