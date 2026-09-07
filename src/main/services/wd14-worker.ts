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

export interface WD14ModelInfo {
  id: string
  name: string
  onnx: string
  csv: string | null
  size_mb: number
  tag_count: number
  has_csv: boolean
}

export interface WD14Status {
  available: boolean
  loaded: boolean
  active_model: string | null
  active_model_name: string | null
  tag_count: number
  models: WD14ModelInfo[]
  diagnostics?: WD14Diagnostics
}

export interface WD14Diagnostics {
  pythonPath: string
  pythonAvailable: boolean
  runtimeAvailable: boolean
  runtimeVersion: string | null
  modelDirectory: string
  modelDirectoryExists: boolean
  modelCount: number
  pairedModelCount: number
  blockingReason: string | null
}

export interface WD14TagResult {
  general: Array<{ name: string; confidence: number }>
  character: Array<{ name: string; confidence: number }>
  rating: Array<{ name: string; confidence: number }>
  quality: Array<{ name: string; confidence: number }>
}

const WORKER_START_TIMEOUT_MS = 15_000
const REQUEST_TIMEOUT_MS = 10 * 60 * 1000

export function resolvePythonPath(): string {
  const configured = process.env.MDS_PYTHON
  if (configured) return configured
  if (configuredPythonPath) return configuredPythonPath
  const bundled = path.join(process.resourcesPath || '', 'python-runtime', 'python.exe')
  if (fs.existsSync(bundled)) return bundled
  const projectVenv = path.resolve(__dirname, '../../../python/.venv/Scripts/python.exe')
  if (fs.existsSync(projectVenv)) return projectVenv
  return process.platform === 'win32' ? 'python.exe' : 'python3'
}

export function resolveWorkerScriptPath(options: { resourcesPath?: string; cwd?: string } = {}): string {
  const resourcesRoot = options.resourcesPath ?? process.resourcesPath ?? ''
  const projectRoot = options.cwd ?? process.cwd()
  const packaged = path.join(resourcesRoot, 'python', 'wd14_worker.py')
  if (resourcesRoot && fs.existsSync(packaged)) return packaged
  const projectScript = path.join(projectRoot, 'python', 'wd14_worker.py')
  if (fs.existsSync(projectScript)) return projectScript
  return path.resolve(__dirname, '../../../../python/wd14_worker.py')
}

function workerScriptPath(): string {
  return resolveWorkerScriptPath()
}

function bundledWorkerDirectory(): string {
  return path.dirname(workerScriptPath())
}

export function resolveModelDirectory(): string {
  return process.env.MDS_WD14_MODEL_DIR || configuredModelDirectory || path.join(app.getPath('userData'), 'models', 'wd14')
}

let configuredModelDirectory = ''
let configuredPythonPath = ''

export function configureWD14ModelDirectory(directory: string): void {
  if (!path.isAbsolute(directory)) throw new Error('WD14 模型目录必须是绝对路径')
  configuredModelDirectory = path.normalize(directory)
}

export function configureWD14PythonPath(pythonPath: string): void {
  if (!path.isAbsolute(pythonPath)) throw new Error('Python 路径必须是绝对路径')
  if (!fs.existsSync(pythonPath)) throw new Error('Python 文件不存在')
  configuredPythonPath = path.normalize(pythonPath)
}

export function clearWD14ModelDirectory(): void {
  configuredModelDirectory = ''
}

export function clearWD14PythonPath(): void {
  configuredPythonPath = ''
}

export function buildWD14Diagnostics(options: { pythonPath: string; modelDirectory: string; pythonAvailable: boolean; runtimeAvailable: boolean; runtimeVersion?: string | null; modelCount: number; pairedModelCount: number }): WD14Diagnostics {
  let blockingReason: string | null = null
  if (!options.pythonAvailable) blockingReason = 'Python 运行时不可用'
  else if (!options.runtimeAvailable) blockingReason = 'Python 缺少 onnxruntime'
  else if (!options.modelCount) blockingReason = '模型目录中没有 .onnx 文件'
  else if (!options.pairedModelCount) blockingReason = '没有找到同时存在的 .onnx 与 .csv 模型对'
  return {
    pythonPath: options.pythonPath,
    pythonAvailable: options.pythonAvailable,
    runtimeAvailable: options.runtimeAvailable,
    runtimeVersion: options.runtimeVersion || null,
    modelDirectory: options.modelDirectory,
    modelDirectoryExists: fs.existsSync(options.modelDirectory),
    modelCount: options.modelCount,
    pairedModelCount: options.pairedModelCount,
    blockingReason,
  }
}

export class WD14Worker {
  private process: ChildProcess | null = null
  private port: number | null = null
  private token: string | null = null
  private startPromise: Promise<void> | null = null

  diagnostics(): WD14Diagnostics {
    const modelDirectory = resolveModelDirectory()
    const onnxFiles = fs.existsSync(modelDirectory) ? fs.readdirSync(modelDirectory).filter(file => file.toLowerCase().endsWith('.onnx')) : []
    const pairedModelCount = onnxFiles.filter(file => fs.existsSync(path.join(modelDirectory, path.basename(file, path.extname(file)) + '.csv'))).length
    const pythonPath = resolvePythonPath()
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
    return buildWD14Diagnostics({ pythonPath, modelDirectory, pythonAvailable, runtimeAvailable, runtimeVersion, modelCount: onnxFiles.length, pairedModelCount })
  }

  async start(): Promise<void> {
    if (this.process && this.port && this.token) return
    if (this.startPromise) return this.startPromise
    const diagnostics = this.diagnostics()
    if (diagnostics.blockingReason) throw new Error('WD14 环境不可用：' + diagnostics.blockingReason)
    this.startPromise = this.startInternal().finally(() => { this.startPromise = null })
    return this.startPromise
  }

  private async startInternal(): Promise<void> {
    const token = crypto.randomBytes(32).toString('hex')
    const child = spawn(resolvePythonPath(), [workerScriptPath()], {
      cwd: bundledWorkerDirectory(),
      env: {
        ...process.env,
        GRIMOIRE_WD14_PORT: '0',
        GRIMOIRE_WD14_TOKEN: token,
        MDS_WD14_MODEL_DIR: resolveModelDirectory(),
        PYTHONUNBUFFERED: '1',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    })

    this.process = child
    this.token = token
    child.stderr.on('data', chunk => {
      logEvent('debug', 'wd14-worker', 'Worker stderr', { context: String(chunk).slice(0, 2000) })
    })
    child.on('error', error => {
      logEvent('error', 'wd14-worker', 'Worker process error', { context: error.message, errorCode: 'WORKER_PROCESS_ERROR' })
    })
    child.on('exit', (code, signal) => {
      logEvent(code === 0 ? 'info' : 'error', 'wd14-worker', 'Worker exited', { context: `code=${code ?? 'null'}, signal=${signal ?? 'null'}` })
      this.process = null
      this.port = null
      this.token = null
    })

    await new Promise<void>((resolve, reject) => {
      let buffer = ''
      const timer = setTimeout(() => {
        cleanup()
        void this.stop()
        reject(new Error('WD14 Worker 启动超时'))
      }, WORKER_START_TIMEOUT_MS)
      const cleanup = () => {
        clearTimeout(timer)
        child.stdout.off('data', onData)
        child.off('exit', onExit)
      }
      const onExit = () => {
        cleanup()
        reject(new Error('WD14 Worker 启动失败'))
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
            logEvent('debug', 'wd14-worker', 'Ignored worker stdout', { context: line.slice(0, 500) })
          }
        }
      }
      child.stdout.on('data', onData)
      child.once('exit', onExit)
    })
    logEvent('info', 'wd14-worker', 'WD14 Worker ready', { context: 'port=' + this.port })
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
    if (!this.port || !this.token) throw new Error('WD14 Worker 未就绪')
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    try {
      const response = await fetch(`http://127.0.0.1:${this.port}${pathname}`, {
        ...init,
        signal: controller.signal,
        headers: { 'X-Grimoire-Worker-Token': this.token, ...(init.headers || {}) },
      })
      const body = await response.json() as T & { error?: string }
      if (!response.ok) throw new Error(body.error || `WD14 Worker HTTP ${response.status}`)
      return body
    } catch (error) {
      const message = error instanceof Error && error.name === 'AbortError' ? 'WD14 推理超时' : error instanceof Error ? error.message : String(error)
      logEvent('error', 'wd14-worker', 'Worker request failed', { context: message, errorCode: 'WORKER_REQUEST_ERROR', retryable: true })
      throw new Error(message)
    } finally {
      clearTimeout(timer)
    }
  }

  health(): Promise<{ ok: boolean; service: string }> { return this.request('/health', {}, 5_000) }
  models(): Promise<{ models: WD14ModelInfo[] }> { return this.request('/models', {}, 30_000) }
  status(): Promise<WD14Status> { return this.request('/status', {}, 30_000) }
  switchModel(modelId: string): Promise<Record<string, unknown>> {
    return this.request('/switch', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ model_id: modelId }) }, 10 * 60 * 1000)
  }
  tag(image: Buffer, threshold = 0.35, modelId?: string): Promise<WD14TagResult> {
    return this.request('/tag', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ image_base64: image.toString('base64'), threshold, model_id: modelId }) }, REQUEST_TIMEOUT_MS)
  }
}

export const wd14Worker = new WD14Worker()
