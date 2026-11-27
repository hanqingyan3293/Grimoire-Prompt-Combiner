import { describe, expect, it, vi } from 'vitest'
import { analyzeComfyWorkflow, applyComfyBindings, parseComfyFrontendWorkflow, parseComfyWorkflow } from '../../main/services/comfy-workflow.core'
import { getComfyWorkflowSource } from './comfy-workflow-adapter'

const objectInfo = {
  Text: { input: { required: { text: ['STRING', {}] } } },
  Producer: { input: { required: { value: ['STRING', {}] } } },
  Consumer: { input: { required: { image: ['IMAGE'], label: ['STRING', { default: 'kept' }] } } },
  Steps: { input: { required: { steps: ['INT', {}] } } },
}
const link = (id: number, origin: number, originSlot: number, target: number, targetSlot: number) => [id, origin, originSlot, target, targetSlot]
const convert = (graph: unknown, info: unknown = objectInfo) => parseComfyFrontendWorkflow(graph, { objectInfo: info } as never)
const byType = (graph: Record<string, { class_type: string; inputs: Record<string, unknown> }>, type: string) => Object.entries(graph).find(([, node]) => node.class_type === type)!
function subgraph() {
  return {
    nodes: [{ id: 5, type: 'sub-text', inputs: [{ name: 'text', link: null, widget: { name: 'text' } }], widgets_values: ['actual instance'] }],
    links: [], definitions: { subgraphs: [{ id: 'sub-text', inputNode: { id: -10 }, inputs: [{ name: 'text', linkIds: [1] }], nodes: [{ id: 9, type: 'Text', inputs: [{ name: 'text', link: 1 }], widgets_values: ['saved definition'] }], links: [link(1, -10, 0, 9, 0)] }] },
  }
}

describe('C3 direct Cherry workflow semantics', () => {
  it('expands subgraphs and keeps promoted instance values', () => {
    const result = convert(subgraph())
    expect(byType(result.workflow, 'Text')[1].inputs.text).toBe('actual instance')
    expect(result.warnings).toEqual([])
  })
  it('rewires Reroute outputs to the genuine producer', () => {
    const result = convert({ nodes: [
      { id: 1, type: 'Producer', widgets_values: ['raw'], outputs: [{ name: 'image', type: 'IMAGE', links: [1] }] },
      { id: 2, type: 'Reroute', inputs: [{ name: '', type: 'IMAGE', link: 1 }], outputs: [{ name: 'image', type: 'IMAGE', links: [2] }] },
      { id: 3, type: 'Consumer', inputs: [{ name: 'image', type: 'IMAGE', link: 2 }] },
    ], links: [link(1, 1, 0, 2, 0), link(2, 2, 0, 3, 0)] })
    const [producerId] = byType(result.workflow, 'Producer')
    expect(byType(result.workflow, 'Consumer')[1].inputs.image).toEqual([producerId, 0])
    expect(Object.values(result.workflow).some(node => node.class_type === 'Reroute')).toBe(false)
  })
  it('writes PrimitiveNode values without submitting frontend-only nodes', () => {
    const result = convert({ nodes: [
      { id: 2, type: 'PrimitiveNode', widgets_values: [30], outputs: [{ name: 'INT', links: [1] }] },
      { id: 3, type: 'Steps', inputs: [{ name: 'steps', link: 1 }], widgets_values: [20] },
    ], links: [link(1, 2, 0, 3, 0)] })
    expect(byType(result.workflow, 'Steps')[1].inputs.steps).toBe(30)
    expect(Object.values(result.workflow)).toHaveLength(1)
  })
  it('omits muted nodes while keeping actual unrelated nodes', () => {
    const result = convert({ nodes: [{ id: 1, type: 'Text', mode: 2, widgets_values: ['muted'] }, { id: 2, type: 'Text', widgets_values: ['kept'] }], links: [] })
    expect(Object.values(result.workflow).map(node => node.inputs.text)).toEqual(['kept'])
  })
  it('passes bypassed nodes through the compatible input', () => {
    const result = convert({ nodes: [
      { id: 1, type: 'Producer', widgets_values: ['raw'], outputs: [{ name: 'image', type: 'IMAGE', links: [1] }] },
      { id: 2, type: 'Bypass', mode: 4, inputs: [{ name: 'image', type: 'IMAGE', link: 1 }], outputs: [{ name: 'image', type: 'IMAGE', links: [2] }] },
      { id: 3, type: 'Consumer', inputs: [{ name: 'image', type: 'IMAGE', link: 2 }] },
    ], links: [link(1, 1, 0, 2, 0), link(2, 2, 0, 3, 0)] })
    expect(byType(result.workflow, 'Consumer')[1].inputs.image).toEqual([byType(result.workflow, 'Producer')[0], 0])
  })
  it('keeps CURVE envelopes and selected DynamicCombo child fields', () => {
    const result = convert({ nodes: [{ id: 9, type: 'Complex', widgets_values: [{ points: [[0, 0], [1, 1]] }, 'png', '16-bit'] }], links: [] }, {
      Complex: { input: { required: { curve: ['CURVE', {}], format: ['COMFY_DYNAMICCOMBO_V3', { options: [{ key: 'png', inputs: { required: { bit_depth: [['8-bit', '16-bit'], { advanced: true }] } } }, { key: 'avif', inputs: { required: { crf: ['INT', { advanced: true }] } } }] }] } } },
    })
    const node = byType(result.workflow, 'Complex')[1]
    expect(node.inputs.curve).toEqual({ __type__: 'CURVE', __value__: { points: [[0, 0], [1, 1]] } })
    expect(node.inputs['format.bit_depth']).toBe('16-bit')
    expect(node.inputs).not.toHaveProperty('format.crf')
  })
  it('rejects recursive subgraph definitions before invoking source expansion', () => {
    const graph = subgraph(); graph.definitions.subgraphs[0].nodes[0].type = 'sub-text'
    expect(() => convert(graph)).toThrow(/循环|recursive|cycle/)
  })
  it('rejects an ambiguous positional widget mapping', () => {
    expect(() => convert({ nodes: [{ id: 1, type: 'Text', widgets_values: ['value', 'unmapped'] }], links: [] })).toThrow(/widget|映射/)
  })
  it('rejects a missing object_info class before dropping its saved widgets', () => {
    expect(() => convert({ nodes: [{ id: 1, type: 'MissingNode', widgets_values: ['saved value'] }], links: [] })).toThrow(/object_info|节点定义/)
  })
  it('rejects API reference cycles before a network submission', () => {
    expect(() => parseComfyWorkflow({ '1': { class_type: 'A', inputs: { other: ['2', 0] } }, '2': { class_type: 'B', inputs: { other: ['1', 0] } } })).toThrow(/循环|cycle/)
  })
  it('rejects invalid and missing API producer slots rather than preserving a broken link', () => {
    expect(() => parseComfyWorkflow({ '1': { class_type: 'A', inputs: { other: ['missing', 0] } } })).toThrow(/连线|reference|来源/)
    expect(() => parseComfyWorkflow({ '1': { class_type: 'A', inputs: { other: ['1', -1] } } })).toThrow(/槽位|reference/)
  })
  it('accepts the planned 5000-node API budget without renaming existing IDs', () => {
    const graph = Object.fromEntries(Array.from({ length: 5000 }, (_, index) => [String(index + 1), { class_type: 'Fixture', inputs: {} }]))
    expect(Object.keys(parseComfyWorkflow(graph))).toHaveLength(5000)
    graph['5001'] = { class_type: 'Fixture', inputs: {} }
    expect(() => parseComfyWorkflow(graph)).toThrow(/节点/)
  })
  it('follows source FLUX guider/noise paths when analyzing and applying values', () => {
    const graph = {
      '1': { class_type: 'RandomNoise', inputs: { noise_seed: 111 } },
      '2': { class_type: 'CLIPTextEncodeFlux', inputs: { t5xxl: 'actual', clip_l: 'kept' } },
      '3': { class_type: 'FluxGuidance', inputs: { conditioning: ['2', 0] } },
      '4': { class_type: 'BasicGuider', inputs: { conditioning: ['3', 0] } },
      '5': { class_type: 'RandomNoise', inputs: { noise_seed: 222 } },
      '6': { class_type: 'SamplerCustomAdvanced', inputs: { guider: ['4', 0], noise: ['5', 0], latent_image: ['7', 0] } },
      '7': { class_type: 'EmptyLatentImage', inputs: { width: 512, height: 512, batch_size: 1 } },
    }
    expect(analyzeComfyWorkflow(graph).bindings).toEqual(expect.arrayContaining([{ key: 'prompt', nodeId: '2', field: 't5xxl', label: '正面提示词', valueType: 'string', confidence: 'high' }]))
    const updated = applyComfyBindings(graph, { prompt: 'new', seed: 42 })
    expect(updated['2'].inputs).toEqual({ t5xxl: 'new', clip_l: 'kept' })
    expect(updated['5'].inputs.noise_seed).toBe(42)
    expect(updated['1'].inputs.noise_seed).toBe(111)
    expect(graph['2'].inputs.t5xxl).toBe('actual')
  })
  it('writes a shared source seed and keeps the sampler link intact', () => {
    const graph = {
      '1': { class_type: 'PrimitiveInt', inputs: { value: 7 } },
      '2': { class_type: 'CLIPTextEncode', inputs: { text: 'positive' } },
      '3': { class_type: 'KSamplerAdvanced', inputs: { positive: ['2', 0], noise_seed: ['1', 0] } },
    }
    const updated = applyComfyBindings(graph, { seed: 42 })
    expect(updated['3'].inputs.noise_seed).toEqual(['1', 0])
    expect(updated['1'].inputs.value).toBe(42)
  })

  it('does not claim an independent negative binding when the graph shares one text source', () => {
    const graph = {
      '1': { class_type: 'CLIPTextEncode', inputs: { text: 'shared' } },
      '2': { class_type: 'KSampler', inputs: { seed: 7, positive: ['1', 0], negative: ['1', 0] } },
    }
    expect(analyzeComfyWorkflow(graph).bindings.filter(binding => binding.key === 'negativePrompt')).toEqual([])
    expect(analyzeComfyWorkflow(graph).warnings.join(' ')).toContain('共用')
    expect(applyComfyBindings(graph, { prompt: 'positive', negativePrompt: 'negative' })['1'].inputs.text).toBe('positive')
  })

  it('rejects a dropped required consumer input after a muted producer', () => {
    expect(() => convert({ nodes: [
      { id: 1, type: 'Producer', mode: 2, widgets_values: ['muted'], outputs: [{ name: 'image', links: [1] }] },
      { id: 2, type: 'Consumer', inputs: [{ name: 'image', link: 1 }] },
    ], links: [link(1, 1, 0, 2, 0)] })).toThrow(/必需输入|缺少/)
  })

  it('permits a dropped optional consumer input after a muted producer with a visible source warning', () => {
    const result = convert({ nodes: [
      { id: 1, type: 'Producer', mode: 2, widgets_values: ['muted'], outputs: [{ name: 'image', links: [1] }] },
      { id: 2, type: 'Consumer', inputs: [{ name: 'image', link: 1 }] },
    ], links: [link(1, 1, 0, 2, 0)] }, { Producer: objectInfo.Producer, Consumer: { input: { required: { label: ['STRING', { default: 'kept' }] }, optional: { image: ['IMAGE'] } } } })
    expect(byType(result.workflow, 'Consumer')[1].inputs.image).toBeUndefined()
    expect(result.warnings.join(' ')).toContain('dropped input')
  })

  it('budgets all expanded subgraph instances before source conversion', () => {
    const graph = {
      nodes: Array.from({ length: 65 }, (_, id) => ({ id, type: 'large-subgraph' })), links: [],
      definitions: { subgraphs: [{ id: 'large-subgraph', nodes: Array.from({ length: 80 }, (_, id) => ({ id, type: 'Text', widgets_values: ['value'] })), links: [] }] },
    }
    expect(() => convert(graph)).toThrow(/展开后节点/)
  })

  it('rejects more than32 nested subgraph definitions while their serialized JSON is shallow', () => {
    const definitions = Array.from({ length: 33 }, (_, id) => ({ id: 'sub-' + id, nodes: [{ id, type: id === 32 ? 'Text' : 'sub-' + (id + 1), widgets_values: id === 32 ? ['value'] : undefined }], links: [] }))
    expect(() => convert(JSON.parse(JSON.stringify({ nodes: [{ id: 0, type: 'sub-0' }], links: [], definitions: { subgraphs: definitions } })))).toThrow(/深度超过32/)
  })

  it('rejects an unknown executable UI class even when it carries no saved widget values', () => {
    expect(() => convert({ nodes: [{ id: 1, type: 'MissingNode' }], links: [] }, {})).toThrow(/object_info|节点定义/)
  })

  it('does not discard a global link whose target declares a null link', () => {
    expect(() => convert({ nodes: [
      { id: 1, type: 'Producer', widgets_values: ['raw'], outputs: [{ name: 'image', links: [1] }] },
      { id: 2, type: 'Consumer', inputs: [{ name: 'image', link: null }] },
    ], links: [link(1, 1, 0, 2, 0)] })).toThrow(/声明不一致/)
  })

  it('refuses the expanded-node budget before calling the unchanged converter', () => {
    const source = getComfyWorkflowSource()
    const convertSpy = vi.spyOn(source, 'convertUiWorkflowToPrompt')
    const graph = {
      nodes: [{ id: 0, type: 'large-sub' }, { id: 1, type: 'large-sub' }, ...Array.from({ length: 2498 }, (_, id) => ({ id: id + 2, type: 'Text', widgets_values: ['value'] }))], links: [],
      definitions: { subgraphs: [{ id: 'large-sub', nodes: Array.from({ length: 2500 }, (_, id) => ({ id, type: 'Text', widgets_values: ['value'] })), links: [] }] },
    }
    try {
      expect(() => convert(graph)).toThrow(/节点/)
      expect(convertSpy).not.toHaveBeenCalled()
    } finally { convertSpy.mockRestore() }
  })

  it('maps ControlNet output1 to the genuine negative text without touching output0', () => {
    const graph = {
      '1': { class_type: 'CLIPTextEncode', inputs: { text: 'positive' } },
      '2': { class_type: 'CLIPTextEncode', inputs: { text: 'negative' } },
      '3': { class_type: 'ControlNetApplyAdvanced', inputs: { positive: ['1', 0], negative: ['2', 0] } },
      '4': { class_type: 'KSampler', inputs: { positive: ['3', 0], negative: ['3', 1], seed: 7 } },
    }
    const result = applyComfyBindings(graph, { prompt: 'new positive', negativePrompt: 'new negative' })
    expect(result['1'].inputs.text).toBe('new positive')
    expect(result['2'].inputs.text).toBe('new negative')
    expect(result['4'].inputs.negative).toEqual(['3', 1])
  })

  it('writes the terminal value source of a multi-hop seed relay without cutting links', () => {
    const graph = {
      '1': { class_type: 'PrimitiveInt', inputs: { value: 7 } },
      '2': { class_type: 'SeedRelay', inputs: { seed: ['1', 0] } },
      '3': { class_type: 'CLIPTextEncode', inputs: { text: 'prompt' } },
      '4': { class_type: 'KSampler', inputs: { positive: ['3', 0], seed: ['2', 0] } },
    }
    const result = applyComfyBindings(graph, { seed: 42 })
    expect(result['1'].inputs.value).toBe(42)
    expect(result['2'].inputs.seed).toEqual(['1', 0])
    expect(result['4'].inputs.seed).toEqual(['2', 0])
  })

  it('honors a static Switch selected negative output and ignores the discarded output', () => {
    const graph = {
      '1': { class_type: 'CLIPTextEncode', inputs: { text: 'positive' } },
      '2': { class_type: 'CLIPTextEncode', inputs: { text: 'negative' } },
      '3': { class_type: 'ControlNetApplyAdvanced', inputs: { positive: ['1', 0], negative: ['2', 0] } },
      '4': { class_type: 'ComfySwitchNode', inputs: { switch: false, on_false: ['3', 1], on_true: ['3', 0] } },
      '5': { class_type: 'KSampler', inputs: { seed: 7, positive: ['3', 0], negative: ['4', 0] } },
    }
    const result = applyComfyBindings(graph, { negativePrompt: 'new' })
    expect(result['2'].inputs.text).toBe('new')
    expect(result['1'].inputs.text).toBe('positive')
    expect(result['4'].inputs.on_true).toEqual(['3', 0])
  })

  it('does not interpret a string node mode differently from the original source', () => {
    expect(() => convert({ nodes: [{ id: 1, type: 'Text', mode: '2', widgets_values: ['muted?'] }], links: [] })).toThrow(/模式/)
  })
})
