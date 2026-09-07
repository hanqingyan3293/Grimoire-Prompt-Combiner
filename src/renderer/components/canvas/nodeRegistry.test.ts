import { describe, expect, it } from 'vitest'
import { canvasNodeHasCapability, getCanvasNodeDefinition, listCanvasNodeDefinitions, listCanvasPlugins, registerCanvasNode } from './nodeRegistry'

describe('canvas node registry', () => {
  it('lists all built-in node definitions', () => {
    expect(listCanvasNodeDefinitions().map(definition => definition.kind)).toEqual(['text', 'image', 'prompt', 'task', 'prompt-asset', 'wd14', 'comfyui'])
    expect(getCanvasNodeDefinition('prompt').defaultSize).toEqual({ width: 320, height: 210 })
    expect(canvasNodeHasCapability('wd14', 'wd14.createTask')).toBe(true)
    expect(canvasNodeHasCapability('text', 'wd14.createTask')).toBe(false)
    expect(listCanvasPlugins().map(plugin => plugin.id)).toEqual(['grimoire.core', 'grimoire.ai-workflows'])
  })

  it('rejects duplicate node registration', () => {
    expect(() => registerCanvasNode({ kind: 'text', title: '重复', description: '', defaultSize: { width: 1, height: 1 }, minimapColor: '#000', creatable: true })).toThrow('已注册')
  })
})
