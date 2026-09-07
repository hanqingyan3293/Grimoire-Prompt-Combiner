import { describe, expect, it } from 'vitest'
import { analyzeComfyWorkflow, applyComfyBindings } from './comfy-workflow.core'
import { buildQuickWorkflow } from './comfy-quick-workflow'

describe('ComfyUI workflow core', () => {
  const workflow = {
    '3': { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: 'demo.safetensors' } },
    '4': { class_type: 'CLIPTextEncode', inputs: { text: 'old prompt', clip: ['3', 1] } },
    '5': { class_type: 'CLIPTextEncode', inputs: { text: 'old negative', clip: ['3', 1] }, _meta: { title: 'Negative Prompt' } },
    '6': { class_type: 'EmptyLatentImage', inputs: { width: 1024, height: 1024, batch_size: 1 } },
    '7': { class_type: 'KSampler', inputs: { seed: 1, steps: 20, cfg: 7, sampler_name: 'euler', scheduler: 'normal', positive: ['4', 0], negative: ['5', 0], latent_image: ['6', 0] } },
    '8': { class_type: 'MysteryNode', inputs: { value: 1 } },
  }
  it('analyzes common fields and preserves unknown nodes', () => {
    const result = analyzeComfyWorkflow(workflow)
    expect(result.nodeCount).toBe(6)
    expect(result.bindings.map(binding => binding.key)).toEqual(expect.arrayContaining(['prompt', 'negativePrompt', 'model', 'seed', 'steps', 'cfg', 'width', 'height']))
    expect(result.unknownNodeTypes).toEqual(['MysteryNode'])
  })
  it('applies mapped values without mutating the input', () => {
    const updated = applyComfyBindings(workflow, { prompt: 'new prompt', seed: 42, width: 768 })
    expect(updated['4'].inputs.text).toBe('new prompt')
    expect(updated['7'].inputs.seed).toBe(42)
    expect(updated['6'].inputs.width).toBe(768)
    expect(workflow['4'].inputs.text).toBe('old prompt')
  })

  it('builds an SDXL LoRA chain between the checkpoint and sampler', () => {
    const quick = buildQuickWorkflow({
      family: 'sdxl', model: 'base.safetensors', prompt: 'portrait', negative: '',
      loras: [{ name: 'detail.safetensors', strength_model: 0.8, strength_clip: 0.9 }],
    })

    expect(quick.lora_0).toMatchObject({ class_type: 'LoraLoader' })
    expect(quick.lora_0.inputs.model).toEqual(['3', 0])
    expect(quick['4'].inputs.clip).toEqual(['lora_0', 1])
    expect(quick['7'].inputs.model).toEqual(['lora_0', 0])
  })

  it('builds a model-only LoRA chain for Anima and keeps the base model without LoRAs', () => {
    const anima = buildQuickWorkflow({ family: 'anima', model: 'anima.safetensors', loras: [{ name: 'style.safetensors' }] })
    const plain = buildQuickWorkflow({ family: 'sdxl', model: 'base.safetensors' })

    expect(anima.lora_0).toMatchObject({ class_type: 'LoraLoaderModelOnly' })
    expect(anima['9'].inputs.model).toEqual(['lora_0', 0])
    expect(plain['7'].inputs.model).toEqual(['3', 0])
    expect(plain.lora_0).toBeUndefined()
  })
})
