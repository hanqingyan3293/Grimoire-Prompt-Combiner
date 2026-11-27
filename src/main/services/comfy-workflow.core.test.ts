import { describe, expect, it } from 'vitest'
import { analyzeComfyWorkflow, applyComfyBindings, buildComfyWidgetSchemas, isComfyFrontendWorkflow, parseComfyFrontendWorkflow } from './comfy-workflow.core'
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

const frontendSchemas = {
  CheckpointLoaderSimple: { positions: ['ckpt_name'] },
  CLIPTextEncode: { positions: ['text'] },
  EmptyLatentImage: { positions: ['width', 'height', 'batch_size'] },
  KSampler: { positions: ['seed', null, 'steps', 'cfg', 'sampler_name', 'scheduler', 'denoise'] },
  SaveImage: { positions: ['filename_prefix'] },
}

const link = (id: number, origin: number, originSlot: number, target: number, targetSlot: number) => [id, origin, originSlot, target, targetSlot]

function minimalFrontendGraph() {
  return {
    nodes: [
      { id: 3, type: 'CheckpointLoaderSimple', widgets_values: ['demo.safetensors'] },
      { id: 4, type: 'CLIPTextEncode', title: 'Positive', inputs: [{ name: 'clip', type: 'CLIP', link: 1 }], widgets_values: ['old prompt'] },
      { id: 5, type: 'CLIPTextEncode', title: 'Negative', inputs: [{ name: 'clip', type: 'CLIP', link: 2 }], widgets_values: ['old negative'] },
      { id: 6, type: 'EmptyLatentImage', widgets_values: [1024, 1024, 1] },
      {
        id: 7,
        type: 'KSampler',
        inputs: [
          { name: 'model', type: 'MODEL', link: 3 },
          { name: 'positive', type: 'CONDITIONING', link: 4 },
          { name: 'negative', type: 'CONDITIONING', link: 5 },
          { name: 'latent_image', type: 'LATENT', link: 6 },
        ],
        widgets_values: [42, 'fixed', 20, 7, 'euler', 'normal', 1],
      },
      { id: 8, type: 'SaveImage', inputs: [{ name: 'images', type: 'IMAGE', link: 7 }], widgets_values: ['out'] },
    ],
    links: [link(1, 3, 0, 4, 0), link(2, 3, 0, 5, 0), link(3, 3, 0, 7, 0), link(4, 4, 0, 7, 1), link(5, 5, 0, 7, 2), link(6, 6, 0, 7, 3), link(7, 7, 0, 8, 0)],
  }
}

describe('ComfyUI frontend graph conversion', () => {
  it('converts node links to references and widgets to declared input order', () => {
    const { workflow, warnings } = parseComfyFrontendWorkflow(minimalFrontendGraph(), { schemas: frontendSchemas })

    expect(warnings).toEqual([])
    expect(workflow['2']).toEqual({ class_type: 'CLIPTextEncode', inputs: { text: 'old prompt', clip: ['1', 0] }, _meta: { title: 'Positive' } })
    expect(workflow['5'].inputs).toEqual({
      model: ['1', 0],
      positive: ['2', 0],
      negative: ['3', 0],
      latent_image: ['4', 0],
      seed: 42,
      steps: 20,
      cfg: 7,
      sampler_name: 'euler',
      scheduler: 'normal',
      denoise: 1,
    })
    expect(workflow['3']._meta).toEqual({ title: 'Negative' })
  })

  it('keeps unknown node types and reports them as warnings', () => {
    const result = parseComfyFrontendWorkflow({ nodes: [{ id: 9, type: 'MysteryNode' }], links: [] })

    expect(result.workflow['1']).toEqual({ class_type: 'MysteryNode', inputs: {}, _meta: { title: 'MysteryNode' } })
    expect(result.warnings.join(' ')).toContain('MysteryNode')
  })

  it('maps values declared explicitly on the node without a schema', () => {
    const result = parseComfyFrontendWorkflow({
      nodes: [{ id: 1, type: 'CustomText', inputs: [{ name: 'text', type: 'STRING', link: null, widget: { name: 'text' } }], widgets_values: ['hello'] }],
      links: [],
    })

    expect(result.workflow['1'].inputs).toEqual({ text: 'hello' })
  })

  it('prefers named widget values over positional values', () => {
    const result = parseComfyFrontendWorkflow({
      nodes: [{ id: 1, type: 'CLIPTextEncode', widgets_values: ['stale'], widgets_values_named: { text: 'fresh' } }],
      links: [],
    })

    expect(result.workflow['1'].inputs).toEqual({ text: 'fresh' })
    expect(result.warnings.join(' ')).toContain('命名')
  })

  it('lets a link override a widget slot without shifting later values', () => {
    const result = parseComfyFrontendWorkflow({
      nodes: [
        { id: 1, type: 'SeedSource', outputs: [{ name: 'INT', type: 'INT' }], widgets_values: [] },
        { id: 2, type: 'KSampler', inputs: [{ name: 'seed', type: 'INT', link: 1 }], widgets_values: [7, 'fixed', 20, 7, 'euler', 'normal', 1] },
      ],
      links: [link(1, 1, 0, 2, 0)],
    }, { schemas: frontendSchemas })

    expect(result.workflow['2'].inputs).toMatchObject({ seed: ['1', 0], steps: 20, cfg: 7, sampler_name: 'euler', scheduler: 'normal', denoise: 1 })
  })

  it('wraps array widget values so they are not read as node references', () => {
    const result = parseComfyFrontendWorkflow({
      nodes: [{ id: 1, type: 'ArrayWidget', widgets_values: [['a', 'b']] }],
      links: [],
    }, { schemas: { ArrayWidget: { positions: ['tags'] } } })

    expect(result.workflow['1'].inputs.tags).toEqual({ __value__: ['a', 'b'] })
  })

  it('refuses duplicate node ids', () => {
    expect(() => parseComfyFrontendWorkflow({ nodes: [{ id: 1, type: 'A' }, { id: 1, type: 'B' }], links: [] })).toThrow('节点 ID 重复')
  })

  it('refuses duplicate link ids', () => {
    expect(() => parseComfyFrontendWorkflow({ nodes: [{ id: 1, type: 'A' }, { id: 2, type: 'B', inputs: [{ name: 'x', link: 1 }] }], links: [link(1, 1, 0, 2, 0), link(1, 1, 0, 2, 0)] })).toThrow('连线 ID 重复')
  })

  it('refuses links with unknown endpoints', () => {
    expect(() => parseComfyFrontendWorkflow({ nodes: [{ id: 1, type: 'A' }], links: [link(1, 2, 0, 1, 0)] })).toThrow('来源节点')
  })

  it('refuses an input that references a missing link', () => {
    expect(() => parseComfyFrontendWorkflow({ nodes: [{ id: 1, type: 'A', inputs: [{ name: 'x', link: 9 }] }], links: [] })).toThrow('不存在的连线')
  })

  it('refuses links targeting a missing input slot', () => {
    expect(() => parseComfyFrontendWorkflow({ nodes: [{ id: 1, type: 'A' }, { id: 2, type: 'B', inputs: [{ name: 'x', link: 1 }] }], links: [link(1, 1, 0, 2, 3)] })).toThrow('槽位')
  })

  it('refuses two links targeting the same input slot', () => {
    expect(() => parseComfyFrontendWorkflow({ nodes: [{ id: 1, type: 'A' }, { id: 2, type: 'B' }, { id: 3, type: 'C', inputs: [{ name: 'x' }] }], links: [link(1, 1, 0, 3, 0), link(2, 2, 0, 3, 0)] })).toThrow(/多个连线|声明不一致/)
  })

  it('refuses widget values when their order cannot be determined', () => {
    expect(() => parseComfyFrontendWorkflow({ nodes: [{ id: 1, type: 'KSampler', widgets_values: [1, 2] }], links: [] })).toThrow('widget 值')
  })

  it('refuses widget values whose count does not match the declared order', () => {
    expect(() => parseComfyFrontendWorkflow({ nodes: [{ id: 1, type: 'KSampler', widgets_values: [1, 2] }], links: [] }, { schemas: frontendSchemas })).toThrow('数量')
  })

  it('refuses duplicate widget names in an explicit declaration', () => {
    expect(() => parseComfyFrontendWorkflow({
      nodes: [{ id: 1, type: 'Widgets', inputs: [{ name: 'a', link: null, widget: { name: 'x' } }, { name: 'b', link: null, widget: { name: 'x' } }], widgets_values: [1, 2] }],
      links: [],
    })).toThrow('重复')
  })

  it('refuses malformed subgraphs and a graph whose only node is bypassed', () => {
    expect(() => parseComfyFrontendWorkflow({ nodes: [], links: [], definitions: { subgraphs: [{ id: 'sub' }] } })).toThrow('节点')
    expect(() => parseComfyFrontendWorkflow({ nodes: [{ id: 1, type: 'KSampler', mode: 4 }], links: [] })).toThrow('节点')
  })

  it('refuses an empty reroute-only graph instead of submitting an empty prompt', () => {
    expect(() => parseComfyFrontendWorkflow({ nodes: [{ id: 1, type: 'Reroute' }], links: [] })).toThrow('节点')
  })

  it('drops inert note nodes with a warning', () => {
    const result = parseComfyFrontendWorkflow({ nodes: [{ id: 1, type: 'Note', widgets_values: ['remember'] }, { id: 2, type: 'MysteryNode' }], links: [] })

    expect(result.workflow['1']).toBeUndefined()
    expect(result.warnings.join(' ')).toContain('注释')
  })

  it('builds widget order from object_info input_order and control_after_generate', () => {
    const schemas = buildComfyWidgetSchemas({
      OrderedSampler: {
        input: { required: { '2': ['INT', {}], '1': ['STRING', {}] } },
        input_order: { required: ['1', '2'] },
      },
      KSampler: {
        input: { required: { seed: ['INT', { control_after_generate: true }], steps: ['INT', {}], model: ['MODEL'] } },
      },
      Styled: {
        input: { required: { image: ['IMAGE'], strength: ['FLOAT', { forceInput: true }], palette: ['PAINTER', { widgetType: 'PAINTER' }] } },
      },
    })

    expect(schemas.OrderedSampler).toEqual({ positions: ['1', '2'] })
    expect(schemas.KSampler).toEqual({ positions: ['seed', null, 'steps'] })
    expect(schemas.Styled).toEqual({ positions: ['palette'] })
  })

  it('exposes explicit detection for frontend graph JSON', () => {
    expect(isComfyFrontendWorkflow({ nodes: [], links: [] })).toBe(true)
    expect(isComfyFrontendWorkflow({ '1': { class_type: 'A', inputs: {} } })).toBe(false)
    expect(isComfyFrontendWorkflow(null)).toBe(false)
  })
})
