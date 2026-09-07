import { describe, expect, it } from 'vitest'
import { AI_CANVAS_PLUGIN, CORE_CANVAS_PLUGIN, validateCanvasPluginManifest } from './canvas-plugin'

describe('canvas plugin manifest', () => {
  it('accepts the static built-in manifests', () => {
    expect(validateCanvasPluginManifest(CORE_CANVAS_PLUGIN).nodes).toHaveLength(4)
    expect(validateCanvasPluginManifest(AI_CANVAS_PLUGIN).nodes.map(node => node.kind)).toEqual(['prompt-asset', 'wd14', 'comfyui'])
  })

  it('rejects remote and over-privileged manifests', () => {
    expect(() => validateCanvasPluginManifest({ ...CORE_CANVAS_PLUGIN, builtin: false })).toThrow('内置静态')
    expect(() => validateCanvasPluginManifest({ ...CORE_CANVAS_PLUGIN, nodes: [{ ...CORE_CANVAS_PLUGIN.nodes[0], capabilities: ['comfyui.createTask'] }] })).toThrow('未声明')
  })

  it('rejects incompatible API versions', () => {
    expect(() => validateCanvasPluginManifest({ ...CORE_CANVAS_PLUGIN, apiVersion: 2 })).toThrow('版本')
  })
})
