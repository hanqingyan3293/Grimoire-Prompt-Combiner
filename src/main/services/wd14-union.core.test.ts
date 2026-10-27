import { describe, expect, it } from 'vitest'
import type { WD14TagResult } from './wd14-worker'
import { mergeWd14Results } from './wd14-union.core'

const result = (general: Array<[string, number]>, character: Array<[string, number]> = [], rating: Array<[string, number]> = []): WD14TagResult => ({
  general: general.map(([name, confidence]) => ({ name, confidence })),
  character: character.map(([name, confidence]) => ({ name, confidence })),
  rating: rating.map(([name, confidence]) => ({ name, confidence })),
  quality: [],
})

describe('mergeWd14Results 多模型合并', () => {
  it('单模型直接返回原结果（不复制不排序）', () => {
    const single = result([['b_tag', 0.9], ['a_tag', 0.5]])
    expect(mergeWd14Results([single])).toBe(single)
  })

  it('空输入返回空结构', () => {
    const merged = mergeWd14Results([])
    expect(merged).toEqual({ general: [], character: [], rating: [], quality: [] })
  })

  it('union：同名取最大置信度，不同名合并，按置信度降序', () => {
    const merged = mergeWd14Results([
      result([['1girl', 0.92], ['solo', 0.7]]),
      result([['1girl', 0.81], ['smile', 0.95]]),
    ], 'union')
    expect(merged.general.map(item => item.name)).toEqual(['smile', '1girl', 'solo'])
    expect(merged.general.find(item => item.name === '1girl')?.confidence).toBe(0.92)
    expect(merged.general.find(item => item.name === 'smile')?.confidence).toBe(0.95)
  })

  it('intersection：只保留全部模型共同命中的标签，取最小置信度', () => {
    const merged = mergeWd14Results([
      result([['1girl', 0.92], ['solo', 0.7]]),
      result([['1girl', 0.81], ['smile', 0.95]]),
    ], 'intersection')
    expect(merged.general).toEqual([{ name: '1girl', confidence: 0.81 }])
  })

  it('跨 namespace 独立合并（character/rating 不串扰）', () => {
    const merged = mergeWd14Results([
      result([['1girl', 0.9]], [['hatsune_miku', 0.88]], [['general', 0.6]]),
      result([['1girl', 0.85]], [['hatsune_miku', 0.91]], [['sensitive', 0.55]]),
    ], 'union')
    expect(merged.character).toEqual([{ name: 'hatsune_miku', confidence: 0.91 }])
    expect(merged.rating.map(item => item.name).sort()).toEqual(['general', 'sensitive'])
    expect(merged.quality).toEqual([])
  })

  it('三个模型的 intersection 要求全部命中（两两命中不算）', () => {
    const merged = mergeWd14Results([
      result([['a', 0.9], ['b', 0.8]]),
      result([['a', 0.7], ['b', 0.6]]),
      result([['a', 0.5]]),
    ], 'intersection')
    expect(merged.general).toEqual([{ name: 'a', confidence: 0.5 }])
  })

  it('置信度相同时按名称稳定排序', () => {
    const merged = mergeWd14Results([result([['zeta', 0.5]]), result([['alpha', 0.5]])], 'union')
    expect(merged.general.map(item => item.name)).toEqual(['alpha', 'zeta'])
  })
})
