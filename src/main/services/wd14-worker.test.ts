import { describe, expect, it } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { buildWD14Diagnostics, resolveWorkerScriptPath } from './wd14-worker'

describe('WD14 diagnostics', () => {
  const base = {
    pythonPath: 'python.exe',
    modelDirectory: 'C:/models/wd14',
    pythonAvailable: true,
    runtimeAvailable: true,
    runtimeVersion: '1.20.0',
    modelCount: 1,
    pairedModelCount: 1,
  }

  it('reports the first blocking prerequisite in order', () => {
    expect(buildWD14Diagnostics({ ...base, pythonAvailable: false }).blockingReason).toBe('Python 运行时不可用')
    expect(buildWD14Diagnostics({ ...base, runtimeAvailable: false }).blockingReason).toBe('Python 缺少 onnxruntime')
    expect(buildWD14Diagnostics({ ...base, modelCount: 0, pairedModelCount: 0 }).blockingReason).toBe('模型目录中没有 .onnx 文件')
    expect(buildWD14Diagnostics({ ...base, modelCount: 2, pairedModelCount: 0 }).blockingReason).toBe('没有找到同时存在的 .onnx 与 .csv 模型对')
  })

  it('marks a complete environment as available', () => {
    expect(buildWD14Diagnostics(base)).toMatchObject({
      pythonAvailable: true,
      runtimeAvailable: true,
      modelDirectoryExists: false,
      modelCount: 1,
      pairedModelCount: 1,
      blockingReason: null,
    })
  })

  it('keeps the diagnostic message actionable for a broken virtual environment', () => {
    const result = buildWD14Diagnostics({
      ...base,
      pythonPath: 'C:/missing/Python311/python.exe',
      pythonAvailable: false,
      runtimeAvailable: false,
      modelCount: 1,
      pairedModelCount: 1,
    })
    expect(result.blockingReason).toContain('Python')
    expect(result.modelCount).toBe(1)
    expect(result.pairedModelCount).toBe(1)
  })

  it('resolves the worker from the project root in development builds', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'grimoire-worker-path-'))
    const worker = path.join(root, 'python', 'wd14_worker.py')
    fs.mkdirSync(path.dirname(worker), { recursive: true })
    fs.writeFileSync(worker, '# worker')
    expect(resolveWorkerScriptPath({ resourcesPath: path.join(root, 'missing-resources'), cwd: root })).toBe(worker)
    fs.rmSync(root, { recursive: true, force: true })
  })
})
