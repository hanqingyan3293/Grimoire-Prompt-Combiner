import { logEvent } from './logger.service'
import { requireHttpUrl } from './input-validation'
import type { ComfyWorkflow } from './comfy-workflow.core'

export interface ComfyStatus { online: boolean; comfyui_version: string | null; error?: string }
export interface ComfyModels { checkpoints: string[]; unets: string[]; loras: string[] }
export interface ComfyQueue { queue_pending: number; queue_running: number; queued: boolean; running: boolean; queue_remaining: number }
export interface ComfyResultImage { filename: string; subfolder: string; type: string; url: string }
export interface ComfyHistoryResult { status: 'running' | 'done' | 'error'; message?: string; images?: ComfyResultImage[] }
const REQUEST_TIMEOUT_MS = 30_000
const MAX_RESPONSE_BYTES = 10 * 1024 * 1024
const MAX_IMAGE_BYTES = 100 * 1024 * 1024

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

async function readBodyWithLimit(response: Response, maxBytes: number): Promise<Buffer> {
  if (!response.body) throw new Error('ComfyUI 图片响应为空')
  const reader = response.body.getReader()
  const chunks: Buffer[] = []
  let total = 0
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > maxBytes) {
      await reader.cancel()
      throw new Error('ComfyUI 图片过大')
    }
    chunks.push(Buffer.from(value))
  }
  if (total === 0) throw new Error('ComfyUI 图片大小无效')
  return Buffer.concat(chunks, total)
}

export class ComfyUIClient {
  baseUrl: string
  constructor(baseUrl = process.env.COMFYUI_API_BASE || 'http://127.0.0.1:8188') { this.baseUrl = requireHttpUrl(baseUrl, 'ComfyUI 地址') }
  setBaseUrl(baseUrl: string): void { this.baseUrl = requireHttpUrl(baseUrl, 'ComfyUI 地址') }
  private async request<T>(pathname: string, init: RequestInit = {}, timeoutMs = REQUEST_TIMEOUT_MS): Promise<T> {
    const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), timeoutMs)
    try {
      const response = await fetch(this.baseUrl + pathname, { ...init, signal: controller.signal })
      const length = Number(response.headers.get('content-length') || 0)
      if (length > MAX_RESPONSE_BYTES) throw new Error('ComfyUI 响应过大')
      const body = await response.json() as T & { error?: string }
      if (!response.ok) throw new Error(body.error || `ComfyUI HTTP ${response.status}`)
      return body
    } catch (error) {
      const message = error instanceof Error && error.name === 'AbortError' ? 'ComfyUI 请求超时' : error instanceof Error ? error.message : String(error)
      logEvent('error', 'comfyui', 'ComfyUI request failed', { context: message, errorCode: 'COMFY_REQUEST_ERROR', retryable: true })
      throw new Error(message)
    } finally { clearTimeout(timer) }
  }
  async status(): Promise<ComfyStatus> {
    try { const payload = await this.request<Record<string, unknown>>('/system_stats'); const system = payload.system as Record<string, unknown> | undefined; return { online: true, comfyui_version: typeof system?.comfyui_version === 'string' ? system.comfyui_version : null } }
    catch (error) { return { online: false, comfyui_version: null, error: error instanceof Error ? error.message : String(error) } }
  }
  async models(): Promise<ComfyModels> {
    const [checkpoint, unet, lora, loraModelOnly] = await Promise.all([
      this.request<unknown>('/object_info/CheckpointLoaderSimple').catch(() => null),
      this.request<unknown>('/object_info/UNETLoader').catch(() => null),
      this.request<unknown>('/object_info/LoraLoader').catch(() => null),
      this.request<unknown>('/object_info/LoraLoaderModelOnly').catch(() => null),
    ])
    return {
      checkpoints: extractNames(checkpoint, 'CheckpointLoaderSimple', 'ckpt_name'),
      unets: extractNames(unet, 'UNETLoader', 'unet_name'),
      loras: uniqueNames([
        ...extractNames(lora, 'LoraLoader', 'lora_name'),
        ...extractNames(loraModelOnly, 'LoraLoaderModelOnly', 'lora_name'),
      ]),
    }
  }
  async submit(workflow: ComfyWorkflow): Promise<{ prompt_id: string; number?: number }> {
    const payload = await this.request<{ prompt_id?: unknown; number?: unknown }>('/prompt', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ prompt: workflow }) })
    if (typeof payload.prompt_id !== 'string' || !payload.prompt_id) throw new Error('ComfyUI 未返回 prompt_id')
    return { prompt_id: payload.prompt_id, number: typeof payload.number === 'number' ? payload.number : undefined }
  }
  async queue(promptId = ''): Promise<ComfyQueue> {
    const queue = await this.request<Record<string, unknown>>('/queue'); const running = promptIds(queue.queue_running); const pending = promptIds(queue.queue_pending)
    return { queue_pending: pending.length, queue_running: running.length, queued: pending.includes(promptId), running: running.includes(promptId), queue_remaining: pending.length }
  }
  async history(promptId: string): Promise<ComfyHistoryResult> {
    const payload = await this.request<Record<string, unknown>>('/history/' + encodeURIComponent(promptId)); const item = payload[promptId] as Record<string, unknown> | undefined
    if (!item) return { status: 'running' }
    const status = item.status as Record<string, unknown> | undefined; if (status?.status_str === 'error') return { status: 'error', message: JSON.stringify(status.messages || []) }
    const images: ComfyResultImage[] = []; const outputs = item.outputs
    if (outputs && typeof outputs === 'object') for (const output of Object.values(outputs as Record<string, unknown>)) {
      const rawImages = output && typeof output === 'object' ? (output as Record<string, unknown>).images : null; if (!Array.isArray(rawImages)) continue
      for (const image of rawImages) { if (!image || typeof image !== 'object') continue; const value = image as Record<string, unknown>; if (typeof value.filename !== 'string') continue; const subfolder = typeof value.subfolder === 'string' ? value.subfolder : ''; const type = typeof value.type === 'string' ? value.type : 'output'; const query = new URLSearchParams({ filename: value.filename, subfolder, type }); images.push({ filename: value.filename, subfolder, type, url: this.baseUrl + '/view?' + query.toString() }) }
    }
    return { status: 'done', images }
  }
  async downloadImage(image: ComfyResultImage): Promise<Buffer> {
    const target = new URL(image.url)
    const base = new URL(this.baseUrl)
    if (target.origin !== base.origin || target.pathname !== '/view') throw new Error('ComfyUI 图片地址不在配置的服务范围内')
    const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
    try {
      const response = await fetch(target, { signal: controller.signal })
      const length = Number(response.headers.get('content-length') || 0)
      if (length > MAX_IMAGE_BYTES) throw new Error('ComfyUI 图片过大')
      if (!response.ok) throw new Error(`ComfyUI 图片下载失败：HTTP ${response.status}`)
      return readBodyWithLimit(response, MAX_IMAGE_BYTES)
    } catch (error) {
      const message = error instanceof Error && error.name === 'AbortError' ? 'ComfyUI 图片下载超时' : error instanceof Error ? error.message : String(error)
      logEvent('error', 'comfyui', 'ComfyUI image download failed', { context: message, errorCode: 'COMFY_IMAGE_DOWNLOAD_ERROR', retryable: true })
      throw new Error(message)
    } finally { clearTimeout(timer) }
  }
}

export const comfyUIClient = new ComfyUIClient()

export function configureComfyUI(baseUrl: string): void {
  comfyUIClient.setBaseUrl(baseUrl)
}

function uniqueNames(names: string[]): string[] {
  return [...new Set(names)]
}
