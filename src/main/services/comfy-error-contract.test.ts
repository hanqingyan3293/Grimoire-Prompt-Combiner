import { describe, expect, it } from 'vitest'
import { ComfyUIError } from './comfy-error'
import { parseComfyWorkflow } from './comfy-workflow.core'

describe('C2 stable workflow validation error contract', () => {
  it.each([null, [], {}, { '1': { class_type: '', inputs: {} } }, { '1': { class_type: 'Fixture', inputs: [] } }])('classifies invalid API workflow %j before submission', workflow => {
    let error: unknown
    try { parseComfyWorkflow(workflow) } catch (cause) { error = cause }
    expect(error).toBeInstanceOf(ComfyUIError)
    expect(error).toMatchObject({ code: 'COMFY_WORKFLOW_INVALID', retryable: false })
  })
  it('preserves the mature API workflow and its node identifiers', () => {
    const workflow = { 'original-id': { class_type: 'CustomNode', inputs: { text: 'raw' }, _meta: { title: 'Original' } } }
    expect(parseComfyWorkflow(workflow)).toEqual(workflow)
  })
})
