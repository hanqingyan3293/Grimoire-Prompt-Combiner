import { describe, expect, it } from 'vitest'
import { diffPromptVersions } from './prompt-diff'

describe('prompt version diff (M6)', () => {
  it('reports added and removed blocks without flagging untouched ones', () => {
    const diff = diffPromptVersions('1girl, long hair, blue eyes', '1girl, long hair, red eyes, smile')
    // 'red eyes' is new, 'blue eyes' is gone, and the two shared tags are untouched.
    expect(diff.added.map(item => item.text)).toEqual(['red eyes', 'smile'])
    expect(diff.removed.map(item => item.text)).toEqual(['blue eyes'])
    expect(diff.summary).toBe('+2 / -1 / ~0 / =2')
  })

  it('treats a weight change as a reweight, not as remove+add', () => {
    const diff = diffPromptVersions('1girl, {{long hair}}', '1girl, {{long hair}}, {{long hair}}')
    expect(diff.removed).toHaveLength(0)
    expect(diff.added).toHaveLength(1)
    const weighted = diffPromptVersions('1girl, {long hair}', '1girl, {{long hair}}')
    expect(weighted.added).toHaveLength(0)
    expect(weighted.removed).toHaveLength(0)
    expect(weighted.reweighted).toHaveLength(1)
    // `{x}` is the source's +0.05 step, `{{x}}` is +0.1 — the label carries the kind and the value.
    expect(weighted.reweighted[0].before).toBe('increase:0.05')
    expect(weighted.reweighted[0].after).toBe('increase:0.1')
  })

  it('is position independent: moving a block is not a change', () => {
    const diff = diffPromptVersions('a cat, a hat', 'a hat, a cat')
    expect(diff.summary).toBe('+0 / -0 / ~0 / =2')
  })

  it('returns an empty diff for identical prompts and one-sided diffs for empty input', () => {
    expect(diffPromptVersions('1girl', '1girl').summary).toBe('+0 / -0 / ~0 / =1')
    expect(diffPromptVersions('', '1girl').added).toHaveLength(1)
    expect(diffPromptVersions('1girl', '').removed).toHaveLength(1)
  })
})
