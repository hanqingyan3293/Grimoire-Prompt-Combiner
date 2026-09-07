import type { ComfyNode, ComfyWorkflow } from './comfy-workflow.core'

export interface ComfyQuickInput {
  family?: 'sdxl' | 'krea2' | 'anima'
  model?: string
  prompt?: string
  negative?: string
  seed?: number
  steps?: number
  cfg?: number
  sampler?: string
  scheduler?: string
  width?: number
  height?: number
  batch?: number
  loras?: unknown[]
}

export function buildQuickWorkflow(input: ComfyQuickInput): ComfyWorkflow {
  const family = input.family || 'sdxl'
  const width = input.width || 1024
  const height = input.height || 1024
  const batch = input.batch || 1
  const model = input.model || ''
  const seed = input.seed === undefined || input.seed === -1 ? Math.floor(Math.random() * 2 ** 32) : input.seed
  const steps = input.steps || (family === 'krea2' ? 8 : 25)
  const cfg = input.cfg === undefined ? (family === 'krea2' ? 1 : family === 'anima' ? 6 : 7) : input.cfg
  const sampler = input.sampler || (family === 'anima' ? 'euler_ancestral' : family === 'krea2' ? 'er_sde' : 'euler')
  const scheduler = input.scheduler || (family === 'anima' ? 'sgm_uniform' : family === 'krea2' ? 'simple' : 'normal')
  const loras = Array.isArray(input.loras)
    ? input.loras.filter(value => value && typeof value === 'object').slice(0, 50) as Array<Record<string, unknown>>
    : []

  if (family === 'sdxl') {
    const loraNodes = buildLoraChain(loras, 'LoraLoader')
    const finalModel = loras.length ? `lora_${loras.length - 1}` : '3'
    return {
      '3': { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: model } },
      ...loraNodes,
      '4': { class_type: 'CLIPTextEncode', inputs: { clip: [finalModel, 1], text: input.prompt || '' } },
      '5': { class_type: 'CLIPTextEncode', inputs: { clip: [finalModel, 1], text: input.negative || '' }, _meta: { title: 'Negative Prompt' } },
      '6': { class_type: 'EmptyLatentImage', inputs: { width, height, batch_size: batch } },
      '7': { class_type: 'KSampler', inputs: { model: [finalModel, 0], positive: ['4', 0], negative: ['5', 0], latent_image: ['6', 0], seed, steps, cfg, sampler_name: sampler, scheduler, denoise: 1 } },
      '8': { class_type: 'VAEDecode', inputs: { samples: ['7', 0], vae: ['3', 2] } },
      '9': { class_type: 'SaveImage', inputs: { images: ['8', 0], filename_prefix: 'Grimoire' } },
    }
  }

  const clip = family === 'krea2' ? 'qwen3vl_4b_bf16.safetensors' : 'qwen_3_06b_base.safetensors'
  const clipType = family === 'krea2' ? 'krea2' : 'qwen_image'
  const loraNodes = buildLoraChain(loras, 'LoraLoaderModelOnly')
  const finalModel = loras.length ? `lora_${loras.length - 1}` : '3'
  return {
    '3': { class_type: 'UNETLoader', inputs: { unet_name: model, weight_dtype: 'default' } },
    ...loraNodes,
    '4': { class_type: 'CLIPLoader', inputs: { clip_name: clip, type: clipType } },
    '5': { class_type: 'VAELoader', inputs: { vae_name: 'qwen_image_vae.safetensors' } },
    '6': { class_type: 'EmptyLatentImage', inputs: { width, height, batch_size: batch } },
    '7': { class_type: 'CLIPTextEncode', inputs: { clip: ['4', 0], text: input.prompt || '' } },
    '8': { class_type: 'CLIPTextEncode', inputs: { clip: ['4', 0], text: input.negative || '' }, _meta: { title: 'Negative Prompt' } },
    '9': { class_type: 'KSampler', inputs: { model: [finalModel, 0], positive: ['7', 0], negative: ['8', 0], latent_image: ['6', 0], seed, steps, cfg, sampler_name: sampler, scheduler, denoise: 1 } },
    '10': { class_type: 'VAEDecode', inputs: { samples: ['9', 0], vae: ['5', 0] } },
    '11': { class_type: 'SaveImage', inputs: { images: ['10', 0], filename_prefix: family === 'krea2' ? 'Krea2' : 'Anima' } },
  }
}

function buildLoraChain(loras: Array<Record<string, unknown>>, classType: 'LoraLoader' | 'LoraLoaderModelOnly'): Record<string, ComfyNode> {
  const nodes: Record<string, ComfyNode> = {}
  loras.forEach((lora, index) => {
    const previous = index === 0 ? '3' : `lora_${index - 1}`
    const inputs: ComfyNode['inputs'] = {
      model: [previous, 0],
      lora_name: String(lora.name || ''),
      strength_model: Number(lora.strength_model ?? 1),
    }
    if (classType === 'LoraLoader') {
      inputs.clip = [previous, 1]
      inputs.strength_clip = Number(lora.strength_clip ?? 1)
    }
    nodes[`lora_${index}`] = { class_type: classType, inputs }
  })
  return nodes
}
