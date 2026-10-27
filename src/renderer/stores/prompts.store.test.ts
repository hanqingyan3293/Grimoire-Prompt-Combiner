import { afterEach, describe, expect, it } from 'vitest'
import type { Tag } from '@shared/types'
import { usePromptsStore } from './prompts.store'

const tags: Tag[] = [
  { id: 'tag_1', subcategory_id: 'sub_1', en: 'masterpiece', zh: '杰作', sort_order: 0, source: 'builtin', created_at: '' },
  { id: 'tag_2', subcategory_id: 'sub_1', en: 'blue eyes', zh: '蓝眼睛', sort_order: 1, source: 'builtin', created_at: '' },
  { id: 'tag_3', subcategory_id: 'sub_1', en: 'low quality', zh: '低质量', sort_order: 2, source: 'builtin', created_at: '' },
]

afterEach(() => {
  usePromptsStore.getState().clearAll()
  usePromptsStore.setState({ impliedExcluded: [] })
})

describe('prompt text bridge', () => {
  it('loads positive and negative tags with weights', () => {
    const result = usePromptsStore.getState().replaceFromPromptText('(masterpiece:1.2), blue eyes\n--neg low quality', tags)

    expect(result).toEqual({ matched: 3, unknown: [] })
    expect(usePromptsStore.getState().positive.map(item => [item.tag.id, item.weight])).toEqual([['tag_1', 1.2], ['tag_2', 1]])
    expect(usePromptsStore.getState().negative.map(item => item.tag.id)).toEqual(['tag_3'])
  })

  it('reports unknown entries without discarding matched tags', () => {
    const result = usePromptsStore.getState().replaceFromPromptText('masterpiece, unknown tag', tags)

    expect(result).toEqual({ matched: 1, unknown: ['unknown tag'] })
    expect(usePromptsStore.getState().positive.map(item => item.tag.id)).toEqual(['tag_1'])
  })

  it('does not replace the current prompt when nothing matches', () => {
    usePromptsStore.getState().replaceFromPromptText('masterpiece', tags)
    const result = usePromptsStore.getState().replaceFromPromptText('missing', tags)

    expect(result).toEqual({ matched: 0, unknown: ['missing'] })
    expect(usePromptsStore.getState().positive.map(item => item.tag.id)).toEqual(['tag_1'])
  })

  it('parses bracket weights and BREAK segments through the shared core', () => {
    const result = usePromptsStore.getState().replaceFromPromptText('(masterpiece), BREAK, [blue eyes]', tags)

    expect(result).toEqual({ matched: 2, unknown: [] })
    expect(usePromptsStore.getState().positive.map(item => [item.tag.id, item.weight])).toEqual([
      ['tag_1', 1.1],
      ['tag_2', 0.91],
    ])
    expect(usePromptsStore.getState().getFullPrompt('en')).toBe('(masterpiece:1.1), BREAK, (blue eyes:0.91)')
  })

  it('merges duplicate resolved tags by delta sum', () => {
    usePromptsStore.getState().replaceFromPromptText('(masterpiece:1.2), (杰作:1.3)', tags)

    expect(usePromptsStore.getState().positive.map(item => [item.tag.id, item.weight])).toEqual([['tag_1', 1.5]])
  })

  it('steps weights by one bracket level and clamps', () => {
    usePromptsStore.getState().replaceFromPromptText('masterpiece', tags)
    usePromptsStore.getState().stepWeight('tag_1', 1)
    expect(usePromptsStore.getState().positive[0].weight).toBe(1.1)
    usePromptsStore.getState().stepWeight('tag_1', 1)
    expect(usePromptsStore.getState().positive[0].weight).toBe(1.21)
    usePromptsStore.getState().stepWeight('tag_1', -1)
    expect(usePromptsStore.getState().positive[0].weight).toBe(1.1)
  })

  it('tracks implied exclusions', () => {
    usePromptsStore.getState().excludeImplied('tag_1')
    expect(usePromptsStore.getState().impliedExcluded).toEqual(['tag_1'])
    usePromptsStore.getState().includeImplied('tag_1')
    expect(usePromptsStore.getState().impliedExcluded).toEqual([])
  })

  it('serializes full prompts byte-identically for both languages', () => {
    usePromptsStore.getState().replaceFromPromptText('(masterpiece:1.2), blue eyes\n--neg low quality', tags)

    expect(usePromptsStore.getState().getFullPrompt('en')).toBe('(masterpiece:1.2), blue eyes\n--neg low quality')
    expect(usePromptsStore.getState().getFullPrompt('zh')).toBe('(杰作:1.2), 蓝眼睛\n--neg 低质量')
    expect(usePromptsStore.getState().getFormattedPrompt('en')).toBe('(masterpiece:1.2), blue eyes')
  })
})
