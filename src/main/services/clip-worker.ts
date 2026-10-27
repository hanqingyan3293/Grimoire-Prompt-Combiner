// 魔导书 Grimoire — CLIP 嵌入 sidecar（Wave F / schema v30）
// 结构与 wd14-worker.ts 完全对齐：惰性 spawn 本地 Python HTTP 服务、随机 token
// 授权、健康检查/模型列表/切换/嵌入请求，以及同一套 configure*/clear* 偏好
// （env > 运行时配置 > userData 默认路径的优先级链，持久化由 index.ts 读写
// settings 完成）。CLIP 模型只需 .onnx 视觉塔，没有 WD14 的 .csv 配对。
import { app } from 'electron'
import { execFileSync, spawn, type ChildProcess } from 'child_process'
import crypto from 'crypto'
import fs from 'fs'
import path from 'path'
import { logEvent } from './logger.service'

interface WorkerReadyMessage {
  ready: boolean
  port: number
}

export interface ClipModelInfo {
  id: string
  name: string
  onnx: string
  size_mb: number
}

export interface ClipHealth {
  ok: boolean
  runtime: 'onnxruntime' | null
  runtimeVersion: string | null
  models: ClipModelInfo[]
  modelDir: string
}

export interface ClipDiagnostics {
  pythonPath: string
  pythonAvailable: boolean
  runtimeAvailable: boolean
  runtimeVersion: string | null
  modelDirectory: string
  modelDirectoryExists: boolean
  modelCount: number
  blockingReason: string | null
}

export interface ClipEmbedding {
  model: string
  dims: number
  vectors: Float32Array[]
}

export interface ClipSwitchResult {
  success: boolean
  model?: string
  error?: string
}

const WORKER_START_TIMEOUT_MS = 15_000
const REQUEST_TIMEOUT_MS = 10 * 60 * 1000
const BASE64_PATTERN = /^[A-Za-z0-9+/]+={0,2}$/

export function resolveClipPythonPath(): string {
  // CLIP 专用变量优先，其次回退到 wd14 使用的共享 MDS_PYTHON，最后是内置运行时。
  const configured = process.env.MDS_CLIP_PYTHON || process.env.MDS_PYTHON
  if (configured) return configured
  if (configuredPythonPath) return configuredPythonPath
  const bundled = path.join(process.resourcesPath || '', 'python-runtime', 'python.exe')
  if (fs.existsSync(bundled)) return bundled
  const projectVenv = path.resolve(__dirname, '../../../python/.venv/Scripts/python.exe')
  if (fs.existsSync(projectVenv)) return projectVenv
  return process.platform === 'win32' ? 'python.exe' : 'python3'
}

export function resolveClipWorkerScriptPath(options: { resourcesPath?: string; cwd?: string } = {}): string {
  const resourcesRoot = options.resourcesPath ?? process.resourcesPath ?? ''
  const projectRoot = options.cwd ?? process.cwd()
  const packaged = path.join(resourcesRoot, 'python', 'clip_worker.py')
  if (resourcesRoot && fs.existsSync(packaged)) return packaged
  const projectScript = path.join(projectRoot, 'python', 'clip_worker.py')
  if (fs.existsSync(projectScript)) return projectScript
  return path.resolve(__dirname, '../../../../python/clip_worker.py')
}

function workerScriptPath(): string {
  return resolveClipWorkerScriptPath()
}

function bundledWorkerDirectory(): string {
  return path.dirname(workerScriptPath())
}

export function resolveClipModelDirectory(): string {
  return process.env.MDS_CLIP_MODEL_DIR || configuredModelDirectory || path.join(app.getPath('userData'), 'models', 'clip')
}

let configuredModelDirectory = ''
let configuredPythonPath = ''

export function configureClipModelDirectory(directory: string): void {
  if (!path.isAbsolute(directory)) throw new Error('CLIP 模型目录必须是绝对路径')
  configuredModelDirectory = path.normalize(directory)
}

export function configureClipPythonPath(pythonPath: string): void {
  if (!path.isAbsolute(pythonPath)) throw new Error('Python 路径必须是绝对路径')
  if (!fs.existsSync(pythonPath)) throw new Error('Python 文件不存在')
  configuredPythonPath = path.normalize(pythonPath)
}

export function clearClipModelDirectory(): void {
  configuredModelDirectory = ''
}

export function clearClipPythonPath(): void {
  configuredPythonPath = ''
}

export function buildClipDiagnostics(options: { pythonPath: string; modelDirectory: string; pythonAvailable: boolean; runtimeAvailable: boolean; runtimeVersion?: string | null; modelCount: number }): ClipDiagnostics {
  let blockingReason: string | null = null
  if (!options.pythonAvailable) blockingReason = 'Python 运行时不可用'
  else if (!options.runtimeAvailable) blockingReason = 'Python 缺少 onnxruntime'
  else if (!options.modelCount) blockingReason = '模型目录中没有 .onnx 文件'
  return {
    pythonPath: options.pythonPath,
    pythonAvailable: options.pythonAvailable,
    runtimeAvailable: options.runtimeAvailable,
    runtimeVersion: options.runtimeVersion || null,
    modelDirectory: options.modelDirectory,
    modelDirectoryExists: fs.existsSync(options.modelDirectory),
    modelCount: options.modelCount,
    blockingReason,
  }
}

function normalizeModelList(value: unknown): ClipModelInfo[] {
  if (!Array.isArray(value)) return []
  const models: ClipModelInfo[] = []
  for (const entry of value) {
    if (!entry || typeof entry !== 'object') continue
    const model = entry as Record<string, unknown>
    const id = typeof model.id === 'string' ? model.id : ''
    if (!id) continue
    models.push({
      id,
      name: typeof model.name === 'string' && model.name ? model.name : id,
      onnx: typeof model.onnx === 'string' ? model.onnx : '',
      size_mb: Number(model.size_mb) || 0,
    })
  }
  return models
}

/** 规范化 /health 载荷；依赖缺失时 runtime=null、models=[]，ok 反映“完全可用”。 */
export function parseClipHealth(payload: unknown): ClipHealth {
  if (!payload || typeof payload !== 'object') throw new Error('CLIP Worker 健康检查响应无效')
  const value = payload as Record<string, unknown>
  const runtime = value.runtime === 'onnxruntime' ? 'onnxruntime' : null
  const models = normalizeModelList(value.models)
  return {
    ok: value.ok === true && runtime === 'onnxruntime' && models.length > 0,
    runtime,
    runtimeVersion: typeof value.runtimeVersion === 'string' && value.runtimeVersion ? value.runtimeVersion : null,
    models,
    modelDir: typeof value.modelDir === 'string' ? value.modelDir : '',
  }
}

/**
 * 解码 /embed 响应：每个向量是 base64 的 float32 小端字节串。
 * 校验 dims 为正整数、向量数量与请求一致、逐向量字节长度 = dims * 4。
 */
export function decodeClipEmbedding(payload: unknown, expectedCount: number): ClipEmbedding {
  if (!payload || typeof payload !== 'object') throw new Error('CLIP Worker 返回的嵌入数据无效')
  const value = payload as Record<string, unknown>
  const model = typeof value.model === 'string' ? value.model : ''
  if (!model) throw new Error('CLIP Worker 未返回模型标识')
  const dims = Number(value.dims)
  if (!Number.isInteger(dims) || dims <= 0) throw new Error('CLIP 嵌入维度无效')
  const rawVectors = Array.isArray(value.vectors) ? value.vectors : null
  if (!rawVectors || rawVectors.length !== expectedCount) {
    throw new Error(`CLIP 嵌入数量与请求不一致（期望 ${expectedCount}，实际 ${rawVectors ? rawVectors.length : 0}）`)
  }
  const vectors = rawVectors.map((entry, index) => {
    if (typeof entry !== 'string' || entry.length % 4 !== 0 || !BASE64_PATTERN.test(entry)) {
      throw new Error(`第 ${index + 1} 个 CLIP 嵌入不是有效的 base64 数据`)
    }
    const buffer = Buffer.from(entry, 'base64')
    if (buffer.byteLength !== dims * 4) {
      throw new Error(`第 ${index + 1} 个 CLIP 嵌入的字节长度与维度不一致`)
    }
    // 显式按小端读取，使解码不依赖宿主平台字节序。
    const vector = new Float32Array(dims)
    for (let offset = 0; offset < dims; offset += 1) vector[offset] = buffer.readFloatLE(offset * 4)
    return vector
  })
  return { model, dims, vectors }
}

/** 单次 Worker HTTP 请求（带 token 与超时）。独立导出以便测试超时/错误路径。 */
export async function requestClipWorker<T>(options: { port: number; token: string; pathname: string; init?: RequestInit; timeoutMs: number }): Promise<T> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), options.timeoutMs)
  try {
    const response = await fetch(`http://127.0.0.1:${options.port}${options.pathname}`, {
      ...(options.init || {}),
      signal: controller.signal,
      headers: { 'X-Grimoire-Worker-Token': options.token, ...((options.init?.headers as Record<string, string>) || {}) },
    })
    const body = await response.json() as T & { error?: string }
    if (!response.ok) throw new Error(body.error || `CLIP Worker HTTP ${response.status}`)
    return body
  } catch (error) {
    const message = error instanceof Error && error.name === 'AbortError'
      ? 'CLIP Worker 请求超时'
      : error instanceof Error ? error.message : String(error)
    logEvent('error', 'clip-worker', 'Worker request failed', { context: message, errorCode: 'WORKER_REQUEST_ERROR', retryable: true })
    throw new Error(message)
  } finally {
    clearTimeout(timer)
  }
}

export class ClipWorker {
  private process: ChildProcess | null = null
  private port: number | null = null
  private token: string | null = null
  private startPromise: Promise<void> | null = null

  diagnostics(): ClipDiagnostics {
    const modelDirectory = resolveClipModelDirectory()
    const onnxFiles = fs.existsSync(modelDirectory) ? fs.readdirSync(modelDirectory).filter(file => file.toLowerCase().endsWith('.onnx')) : []
    const pythonPath = resolveClipPythonPath()
    let pythonAvailable = false
    let runtimeAvailable = false
    let runtimeVersion: string | null = null
    try {
      const probe = execFileSync(pythonPath, ['-c', "import sys; print(sys.version.split()[0]); import onnxruntime; print(onnxruntime.__version__)"], { timeout: 3000, windowsHide: true, encoding: 'utf8' })
      const lines = probe.trim().split(/\r?\n/)
      pythonAvailable = Boolean(lines[0])
      runtimeAvailable = Boolean(lines[1])
      runtimeVersion = lines[1] || null
    } catch {
      try { execFileSync(pythonPath, ['--version'], { timeout: 3000, windowsHide: true, stdio: 'ignore' }); pythonAvailable = true } catch {}
    }
    return buildClipDiagnostics({ pythonPath, modelDirectory, pythonAvailable, runtimeAvailable, runtimeVersion, modelCount: onnxFiles.length })
  }

  async start(): Promise<void> {
    if (this.process && this.port && this.token) return
    if (this.startPromise) return this.startPromise
    const diagnostics = this.diagnostics()
    if (diagnostics.blockingReason) throw new Error('CLIP 环境不可用：' + diagnostics.blockingReason)
    this.startPromise = this.startInternal().finally(() => { this.startPromise = null })
    return this.startPromise
  }

  private async startInternal(): Promise<void> {
    const token = crypto.randomBytes(32).toString('hex')
    const child = spawn(resolveClipPythonPath(), [workerScriptPath()], {
      cwd: bundledWorkerDirectory(),
      env: {
        ...process.env,
        GRIMOIRE_CLIP_PORT: '0',
        GRIMOIRE_CLIP_TOKEN: token,
        MDS_CLIP_MODEL_DIR: resolveClipModelDirectory(),
        PYTHONUNBUFFERED: '1',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    })

    this.process = child
    this.token = token
    child.stderr.on('data', chunk => {
      logEvent('debug', 'clip-worker', 'Worker stderr', { context: String(chunk).slice(0, 2000) })
    })
    child.on('error', error => {
      logEvent('error', 'clip-worker', 'Worker process error', { context: error.message, errorCode: 'WORKER_PROCESS_ERROR' })
    })
    child.on('exit', (code, signal) => {
      logEvent(code === 0 ? 'info' : 'error', 'clip-worker', 'Worker exited', { context: `code=${code ?? 'null'}, signal=${signal ?? 'null'}` })
      this.process = null
      this.port = null
      this.token = null
    })

    await new Promise<void>((resolve, reject) => {
      let buffer = ''
      const timer = setTimeout(() => {
        cleanup()
        void this.stop()
        reject(new Error('CLIP Worker 启动超时'))
      }, WORKER_START_TIMEOUT_MS)
      const cleanup = () => {
        clearTimeout(timer)
        child.stdout.off('data', onData)
        child.off('exit', onExit)
      }
      const onExit = () => {
        cleanup()
        reject(new Error('CLIP Worker 启动失败'))
      }
      const onData = (chunk: Buffer) => {
        buffer += chunk.toString('utf8')
        const lines = buffer.split(/\r?\n/)
        buffer = lines.pop() || ''
        for (const line of lines) {
          try {
            const message = JSON.parse(line) as WorkerReadyMessage
            if (message.ready && Number.isInteger(message.port) && message.port > 0) {
              this.port = message.port
              cleanup()
              resolve()
              return
            }
          } catch {
            logEvent('debug', 'clip-worker', 'Ignored worker stdout', { context: line.slice(0, 500) })
          }
        }
      }
      child.stdout.on('data', onData)
      child.once('exit', onExit)
    })
    logEvent('info', 'clip-worker', 'CLIP Worker ready', { context: 'port=' + this.port })
  }

  async stop(): Promise<void> {
    const child = this.process
    this.process = null
    this.port = null
    this.token = null
    if (!child || child.killed) return
    child.kill()
    await new Promise<void>(resolve => {
      const timer = setTimeout(() => { child.kill('SIGKILL'); resolve() }, 2_000)
      child.once('exit', () => { clearTimeout(timer); resolve() })
    })
  }

  private async request<T>(pathname: string, init: RequestInit = {}, timeoutMs = REQUEST_TIMEOUT_MS): Promise<T> {
    await this.start()
    if (!this.port || !this.token) throw new Error('CLIP Worker 未就绪')
    return requestClipWorker<T>({ port: this.port, token: this.token, pathname, init, timeoutMs })
  }

  async health(): Promise<ClipHealth> {
    const payload = await this.request<unknown>('/health', {}, 5_000)
    return parseClipHealth(payload)
  }

  async models(): Promise<{ models: ClipModelInfo[] }> {
    const payload = await this.request<unknown>('/models', {}, 30_000)
    const value = payload && typeof payload === 'object' ? payload as Record<string, unknown> : {}
    return { models: normalizeModelList(value.models) }
  }

  async switchModel(modelId: string): Promise<ClipSwitchResult> {
    const id = String(modelId || '').trim()
    if (!id) throw new Error('模型 ID 无效')
    return this.request<ClipSwitchResult>('/switch', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ model_id: id }) }, REQUEST_TIMEOUT_MS)
  }

  async embed(imagePaths: string[], model?: string): Promise<ClipEmbedding> {
    if (!Array.isArray(imagePaths) || imagePaths.length === 0) throw new Error('图片路径无效')
    const paths = imagePaths.map(value => typeof value === 'string' ? value.trim() : '')
    if (paths.some(value => !value || !path.isAbsolute(value))) throw new Error('图片路径必须是绝对路径')
    const payload = await this.request<unknown>('/embed', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ imagePaths: paths, model }) }, REQUEST_TIMEOUT_MS)
    return decodeClipEmbedding(payload, paths.length)
  }
}

export const clipWorker = new ClipWorker()
