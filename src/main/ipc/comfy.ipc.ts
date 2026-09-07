import { dialog, ipcMain } from 'electron'
import fs from 'fs'
import path from 'path'
import { IPC_CHANNELS } from '../../shared/types'
import { createPersistedTask } from '../services/task-repository'
import { optionalText, optionalBoundedNumber, requireId, requireText } from '../services/input-validation'
import { comfyUIClient } from '../services/comfy-client'
import { parseComfyWorkflow } from '../services/comfy-workflow.core'
import { deleteComfyWorkflow, getComfyWorkflow, importComfyWorkflow, listComfyWorkflows } from '../services/comfy-workflow.service'

function publicWorkflow(item: ReturnType<typeof listComfyWorkflows>[number]) {
  const analysis = JSON.parse(item.analysis_json) as { bindings?: Array<{ key: string; nodeId: string; field: string }> }
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

export function registerComfyIPC(): void {
  ipcMain.handle(IPC_CHANNELS.COMFY_STATUS, async () => comfyUIClient.status())
  ipcMain.handle(IPC_CHANNELS.COMFY_MODELS, async () => comfyUIClient.models())
  ipcMain.handle(IPC_CHANNELS.COMFY_WORKFLOWS_LIST, async () => listComfyWorkflows().map(publicWorkflow))

  ipcMain.handle(IPC_CHANNELS.COMFY_WORKFLOW_IMPORT, async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openFile'],
      filters: [{ name: 'ComfyUI API 工作流', extensions: ['json'] }],
    })
    if (result.canceled || !result.filePaths.length) return null

    const filePath = path.resolve(result.filePaths[0])
    const raw = fs.readFileSync(filePath, 'utf8')
    const workflow = parseComfyWorkflow(JSON.parse(raw))
    const name = path.basename(filePath, path.extname(filePath))
    return publicWorkflow(importComfyWorkflow(name, workflow, 'imported'))
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
