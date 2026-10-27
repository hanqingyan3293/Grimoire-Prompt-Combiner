import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'

let root = ''
vi.mock('electron', () => ({ app: { getPath: () => root, isReady: () => false } }))
// 确定性阻断 Python 探测：execFileSync 抛出 => pythonAvailable=false，
// start() 必须在 spawn 之前以“Python 运行时不可用”拒绝。
const execFileSyncMock = vi.fn((..._args: unknown[]) => { throw new Error('python missing') })
const spawnMock = vi.fn((..._args: unknown[]) => undefined)
vi.mock('child_process', () => ({
  execFileSync: (...args: unknown[]) => execFileSyncMock(...args),
  spawn: (...args: unknown[]) => spawnMock(...args),
}))

import { buildClipDiagnostics, clearClipModelDirectory, clearClipPythonPath, clipWorker, configureClipModelDirectory, configureClipPythonPath, decodeClipEmbedding, parseClipHealth, requestClipWorker, resolveClipModelDirectory, resolveClipWorkerScriptPath } from './clip-worker'

function encodeVector(values: number[]): string {
  const buffer = Buffer.alloc(values.length * 4)
  values.forEach((value, index) => buffer.writeFloatLE(value, index * 4))
  return buffer.toString('base64')
}

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'grimoire-clip-'))
  execFileSyncMock.mockClear()
  spawnMock.mockClear()
})

afterEach(() => {
  clearClipModelDirectory()
  clearClipPythonPath()
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
  fs.rmSync(root, { recursive: true, force: true })
})

describe('CLIP diagnostics', () => {
  const base = {
    pythonPath: 'python.exe',
    modelDirectory: 'C:/models/clip',
    pythonAvailable: true,
    runtimeAvailable: true,
    runtimeVersion: '1.20.0',
    modelCount: 1,
  }

  it('reports the first blocking prerequisite in order', () => {
    expect(buildClipDiagnostics({ ...base, pythonAvailable: false }).blockingReason).toBe('Python 运行时不可用')
    expect(buildClipDiagnostics({ ...base, runtimeAvailable: false }).blockingReason).toBe('Python 缺少 onnxruntime')
    expect(buildClipDiagnostics({ ...base, modelCount: 0 }).blockingReason).toBe('模型目录中没有 .onnx 文件')
  })

  it('marks a complete environment as available', () => {
    expect(buildClipDiagnostics(base)).toMatchObject({
      pythonAvailable: true,
      runtimeAvailable: true,
      modelDirectoryExists: false,
      modelCount: 1,
      blockingReason: null,
    })
  })
})

describe('CLIP path resolution', () => {
  it('resolves the worker from the project root in development builds', () => {
    const worker = path.join(root, 'python', 'clip_worker.py')
    fs.mkdirSync(path.dirname(worker), { recursive: true })
    fs.writeFileSync(worker, '# worker')
    expect(resolveClipWorkerScriptPath({ resourcesPath: path.join(root, 'missing-resources'), cwd: root })).toBe(worker)
  })

  it('resolves env over the configured directory, and falls back to the userData default', () => {
    const first = path.join(root, 'models-a')
    const second = path.join(root, 'models-b')
    configureClipModelDirectory(first)
    expect(resolveClipModelDirectory()).toBe(path.normalize(first))
    vi.stubEnv('MDS_CLIP_MODEL_DIR', second)
    expect(resolveClipModelDirectory()).toBe(second)
    clearClipModelDirectory()
    expect(resolveClipModelDirectory()).toBe(second)
    vi.unstubAllEnvs()
    expect(resolveClipModelDirectory()).toBe(path.join(root, 'models', 'clip'))
  })

  it('rejects relative directories and missing python executables', () => {
    expect(() => configureClipModelDirectory('models/clip')).toThrow('绝对路径')
    expect(() => configureClipPythonPath('python.exe')).toThrow('绝对路径')
    expect(() => configureClipPythonPath(path.join(root, 'missing', 'python.exe'))).toThrow('Python 文件不存在')
  })
})

describe('CLIP health parsing', () => {
  it('parses a fully available worker', () => {
    const health = parseClipHealth({
      ok: true,
      runtime: 'onnxruntime',
      runtimeVersion: '1.20.0',
      models: [{ id: 'clip-vit-b32', name: 'clip vit b32', onnx: 'clip-vit-b32.onnx', size_mb: 350.2 }],
      modelDir: 'C:/models/clip',
    })
    expect(health).toEqual({
      ok: true,
      runtime: 'onnxruntime',
      runtimeVersion: '1.20.0',
      models: [{ id: 'clip-vit-b32', name: 'clip vit b32', onnx: 'clip-vit-b32.onnx', size_mb: 350.2 }],
      modelDir: 'C:/models/clip',
    })
  })

  it('reports a degraded worker honestly when a dependency is missing', () => {
    const health = parseClipHealth({ ok: false, runtime: null, runtimeVersion: null, models: [], modelDir: 'C:/models/clip' })
    expect(health.ok).toBe(false)
    expect(health.runtime).toBeNull()
    expect(health.models).toEqual([])
  })

  it('does not trust an ok flag that contradicts the runtime report', () => {
    expect(parseClipHealth({ ok: true, runtime: null, models: [{ id: 'm' }] }).ok).toBe(false)
    expect(parseClipHealth({ ok: true, runtime: 'onnxruntime', models: [] }).ok).toBe(false)
  })

  it('rejects a non-object payload', () => {
    expect(() => parseClipHealth(null)).toThrow('健康检查响应无效')
    expect(() => parseClipHealth('ok')).toThrow('健康检查响应无效')
  })
})

describe('CLIP embedding decoding', () => {
  it('decodes base64 little-endian float32 vectors', () => {
    const decoded = decodeClipEmbedding({ model: 'clip-vit-b32', dims: 3, vectors: [encodeVector([1, 2.5, -3])] }, 1)
    expect(decoded.model).toBe('clip-vit-b32')
    expect(decoded.dims).toBe(3)
    expect(decoded.vectors).toHaveLength(1)
    expect(decoded.vectors[0]).toBeInstanceOf(Float32Array)
    expect(Array.from(decoded.vectors[0])).toEqual([1, 2.5, -3])
  })

  it('keeps one decoded vector per requested image in order', () => {
    const decoded = decodeClipEmbedding({ model: 'm', dims: 2, vectors: [encodeVector([0, 1]), encodeVector([1, 0])] }, 2)
    expect(decoded.vectors.map(vector => Array.from(vector))).toEqual([[0, 1], [1, 0]])
  })

  it('rejects an invalid dims value', () => {
    expect(() => decodeClipEmbedding({ model: 'm', dims: 0, vectors: [] }, 0)).toThrow('维度无效')
    expect(() => decodeClipEmbedding({ model: 'm', dims: 1.5, vectors: [encodeVector([1, 2])] }, 1)).toThrow('维度无效')
  })

  it('rejects a vector count that does not match the request', () => {
    expect(() => decodeClipEmbedding({ model: 'm', dims: 2, vectors: [encodeVector([0, 1])] }, 2)).toThrow('数量与请求不一致')
  })

  it('rejects vectors whose byte length contradicts dims', () => {
    expect(() => decodeClipEmbedding({ model: 'm', dims: 3, vectors: [encodeVector([1, 2])] }, 1)).toThrow('字节长度与维度不一致')
  })

  it('rejects malformed base64 payloads and missing model identifiers', () => {
    expect(() => decodeClipEmbedding({ model: 'm', dims: 2, vectors: ['not base64!'] }, 1)).toThrow('base64')
    expect(() => decodeClipEmbedding({ model: '', dims: 2, vectors: [encodeVector([1, 2])] }, 1)).toThrow('模型标识')
    expect(() => decodeClipEmbedding(null, 1)).toThrow('嵌入数据无效')
  })
})

describe('CLIP worker error paths', () => {
  it('refuses to start when the environment is blocked and never spawns python', async () => {
    await expect(clipWorker.start()).rejects.toThrow('CLIP 环境不可用：Python 运行时不可用')
    expect(spawnMock).not.toHaveBeenCalled()
  })

  it('rejects relative image paths without touching the worker', async () => {
    await expect(clipWorker.embed(['images/relative.png'])).rejects.toThrow('绝对路径')
    await expect(clipWorker.embed([])).rejects.toThrow('图片路径无效')
    expect(spawnMock).not.toHaveBeenCalled()
  })

  it('surfaces a worker HTTP error payload verbatim', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: '模型文件未找到。请将 CLIP 视觉塔 .onnx 文件放入模型目录。' }), { status: 503, headers: { 'content-type': 'application/json' } })))
    await expect(requestClipWorker({ port: 1, token: 't', pathname: '/embed', timeoutMs: 1_000 })).rejects.toThrow('模型文件未找到')
  })

  it('reports a timeout when the worker never answers', async () => {
    vi.stubGlobal('fetch', vi.fn((_url: unknown, init?: RequestInit) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })))
    })))
    await expect(requestClipWorker({ port: 1, token: 't', pathname: '/health', timeoutMs: 20 })).rejects.toThrow('超时')
  })

  it('reports a network failure when no worker is listening', async () => {
    // 使用被立即拒绝的 fetch，避免依赖真实端口行为。
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('fetch failed') }))
    await expect(requestClipWorker({ port: 1, token: 't', pathname: '/health', timeoutMs: 1_000 })).rejects.toThrow('fetch failed')
  })
})
