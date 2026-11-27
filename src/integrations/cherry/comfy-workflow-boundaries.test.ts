import { describe, expect, it } from 'vitest'
import { parseComfyWorkflow } from '../../main/services/comfy-workflow.core'

// Protect the public API workflow contract as the mature source converter is wired.
describe('C3 workflow resource and semantic boundaries', () => {
  it('limits actual UTF-8 JSON bytes rather than UTF-16 text length', () => {
    const graph = { '1': { class_type: 'Text', inputs: { text: '界'.repeat(3_600_000) } } }
    expect(() => parseComfyWorkflow(graph)).toThrow(/JSON.*过大/)
  })
  it('rejects deep JSON values before a recursive parser can exhaust its stack', () => {
    let value: unknown = 'raw'
    for (let depth = 0; depth < 40; depth++) value = { nested: value }
    expect(() => parseComfyWorkflow({ '1': { class_type: 'Fixture', inputs: { data: value } } })).toThrow(/嵌套|深度/)
  })
  it('rejects undefined, nonfinite and cyclic values without dropping them', () => {
    expect(() => parseComfyWorkflow({ '1': { class_type: 'Fixture', inputs: { value: Infinity } } })).toThrow()
    const cycle: Record<string, unknown> = {}; cycle.self = cycle
    expect(() => parseComfyWorkflow({ '1': { class_type: 'Fixture', inputs: { value: cycle } } })).toThrow(/循环/)
  })
  it('rejects unsafe record keys rather than assigning through an object prototype', () => {
    expect(() => parseComfyWorkflow(JSON.parse('{"__proto__":{"class_type":"Fixture","inputs":{}}}'))).toThrow(/不安全|ID/)
  })
})
