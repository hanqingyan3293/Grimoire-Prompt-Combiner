import { dialog, ipcMain } from 'electron'
import fs from 'fs'
import path from 'path'
import { IPC_CHANNELS } from '../../shared/types'
import { createPersistedTask } from '../services/task-repository'
import { optionalText, optionalBoundedNumber, requireId, requireNonEmptyText, requireText } from '../services/input-validation'
import { comfyUIClient } from '../services/comfy-client'
import { ComfyUIError } from '../services/comfy-error'
import { COMFY_MAX_JSON_BYTES } from '../services/comfy-workflow-validation'
import type { ComfyPublicWorkflow } from '../../shared/comfy-workflow-types'
import { isComfyFrontendWorkflow, parseComfyFrontendWorkflow, parseComfyWorkflow, type ComfyWorkflow } from '../services/comfy-workflow.core'
import { deleteComfyWorkflow, getComfyWorkflow, importComfyWorkflow, listComfyWorkflows } from '../services/comfy-workflow.service'

function publicWorkflow(item: ReturnType<typeof listComfyWorkflows>[number]): ComfyPublicWorkflow {
  const analysis = JSON.parse(item.analysis_json) as ComfyPublicWorkflow['analysis']
  const raw = JSON.parse(item.raw_json) as Record<string, { inputs?: Record<string, unknown> }>
  const defaults: Record<string, unknown> = {}
  for (const binding of analysis.bindings || []) {
    const value = raw[binding.nodeId]?.inputs?.[binding.field]
    if (value !== undefined && defaults[binding.key] === undefined) defaults[binding.key] = value
  }
  return {
    id: item.id,
    name: item.name,
    analysis,
    bindings: JSON.parse(item.bindings_json),
    defaults,
    source: item.source,
    created_at: item.created_at,
    updated_at: item.updated_at,
  }
}

async function importGraph(raw: unknown, name: string, source: string) {
  const warnings: string[] = []
  let workflow: ComfyWorkflow
  if (isComfyFrontendWorkflow(raw)) {
    const objectInfo = await comfyUIClient.objectInfo()
    const conversion = parseComfyFrontendWorkflow(raw, { objectInfo })
    workflow = conversion.workflow
    warnings.push(...conversion.warnings)
  } else workflow = parseComfyWorkflow(raw)
  return publicWorkflow(importComfyWorkflow(name, workflow, source, warnings))
}

export function registerComfyIPC(): void {
  ipcMain.handle(IPC_CHANNELS.COMFY_STATUS, async () => comfyUIClient.status())
  ipcMain.handle(IPC_CHANNELS.COMFY_MODELS, async () => comfyUIClient.models())
  ipcMain.handle(IPC_CHANNELS.COMFY_QUEUE, async (_event, promptId: unknown) => {
    return comfyUIClient.queue(optionalText(promptId, 'ComfyUI 任务 ID', 200) ?? '')
  })
  ipcMain.handle(IPC_CHANNELS.COMFY_HISTORY, async (_event, promptId: unknown) => {
    return comfyUIClient.history(requireNonEmptyText(promptId ?? '', 'ComfyUI 任务 ID', 200))
  })
  ipcMain.handle(IPC_CHANNELS.COMFY_WORKFLOWS_LIST, async () => listComfyWorkflows().map(publicWorkflow))
  ipcMain.handle(IPC_CHANNELS.COMFY_OBJECT_INFO, async () => comfyUIClient.objectInfo())
  ipcMain.handle(IPC_CHANNELS.COMFY_REMOTE_WORKFLOWS_LIST, async () => comfyUIClient.remoteWorkflows())
  ipcMain.handle(IPC_CHANNELS.COMFY_REMOTE_WORKFLOW_IMPORT, async (_event, value: unknown) => {
    const handle = requireNonEmptyText(value, '远端工作流路径', 2048)
    return importGraph(await comfyUIClient.readRemoteWorkflow(handle), handle, 'remote')
  })

  ipcMain.handle(IPC_CHANNELS.COMFY_WORKFLOW_IMPORT, async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openFile'],
      filters: [{ name: 'ComfyUI 工作流 JSON', extensions: ['json'] }],
    })
    if (result.canceled || !result.filePaths.length) return null

    const filePath = path.resolve(result.filePaths[0])
    const stat = fs.statSync(filePath)
    if (!stat.isFile() || stat.size > COMFY_MAX_JSON_BYTES) throw new ComfyUIError('COMFY_WORKFLOW_INVALID', '工作流 JSON 过大或不是文件', false)
    const text = fs.readFileSync(filePath, 'utf8')
    if (Buffer.byteLength(text, 'utf8') > COMFY_MAX_JSON_BYTES) throw new ComfyUIError('COMFY_WORKFLOW_INVALID', '工作流 JSON 过大', false)
    let raw: unknown
    try { raw = JSON.parse(text) } catch { throw new ComfyUIError('COMFY_WORKFLOW_INVALID', '工作流 JSON 格式无效', false) }
    return importGraph(raw, path.basename(filePath, path.extname(filePath)), 'imported')
  })

  ipcMain.handle(IPC_CHANNELS.COMFY_WORKFLOW_DELETE, async (_event, id: unknown) => {
    return deleteComfyWorkflow(requireId(id, '工作流 ID'))
  })

  ipcMain.handle(IPC_CHANNELS.COMFY_CREATE_TASK, async (_event, value: unknown) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('ComfyUI 任务参数无效')
    const input = value as Record<string, unknown>
    const workflowId = requireId(input.workflowId, '工作流 ID')
    const workflow = getComfyWorkflow(workflowId)
    if (!workflow) throw new Error('工作流不存在')
    const values = input.values && typeof input.values === 'object' && !Array.isArray(input.values) ? input.values : {}
    return createPersistedTask({ kind: 'comfyui', input: { workflowId, values } })
  })

  ipcMain.handle(IPC_CHANNELS.COMFY_QUICK_GENERATE, async (_event, value: unknown) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('快捷生成参数无效')
    const input = value as Record<string, unknown>
    const family = requireText(input.family, '模型家族', 40).toLowerCase()
    if (!['sdxl', 'krea2', 'anima'].includes(family)) throw new Error('不支持的模型家族')
    const model = requireText(input.model, '模型', 500)
    const prompt = requireText(input.prompt || '', '正面提示词', 100_000)
    const negative = typeof input.negative === 'string' ? input.negative.slice(0, 100_000) : ''
    const width = Number(input.width || 1024)
    const height = Number(input.height || 1024)
    const batch = Number(input.batch || 1)
    if (![width, height, batch].every(Number.isInteger) || width < 64 || height < 64 || width > 4096 || height > 4096 || batch < 1 || batch > 16) throw new Error('生成尺寸或批量参数无效')
    const seed = Number(input.seed ?? -1)
    const steps = Number(input.steps || 25)
    const cfg = Number(input.cfg || 7)
    if (!Number.isInteger(seed) || seed < -1 || !Number.isInteger(steps) || steps < 1 || steps > 200 || !Number.isFinite(cfg) || cfg < 0 || cfg > 50) throw new Error('生成参数无效')
    const sampler = optionalText(input.sampler, '采样器', 100)
    const scheduler = optionalText(input.scheduler, '调度器', 100)
    const loras = Array.isArray(input.loras) ? input.loras.slice(0, 50).map((value, index) => {
      if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`LoRA ${index + 1} 参数无效`)
      const lora = value as Record<string, unknown>
      const name = requireText(lora.name, `LoRA ${index + 1} 名称`, 500)
      const strengthModel = optionalBoundedNumber(lora.strength_model, `LoRA ${index + 1} 模型强度`, -10, 10) ?? 1
      const strengthClip = optionalBoundedNumber(lora.strength_clip, `LoRA ${index + 1} CLIP 强度`, -10, 10) ?? 1
      return { name, strength_model: strengthModel, strength_clip: strengthClip }
    }) : []
    return createPersistedTask({ kind: 'comfyui', input: { quick: true, family, model, prompt, negative, seed, steps, cfg, sampler, scheduler, width, height, batch, loras } })
  })
}
