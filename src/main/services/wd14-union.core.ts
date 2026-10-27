// 多模型 WD14 结果合并（BDTM AutoTagger 语义，schema 无关纯函数）。
// 从 task-runner 抽出以便单测：并集取每标签最大置信度；交集只保留全部模型
// 都命中的标签，置信度取各模型命中的最小值。rating/quality 同样参与。
import type { WD14TagResult } from './wd14-worker'

export type WD14UnionMode = 'union' | 'intersection'

const NAMESPACES = ['general', 'character', 'rating', 'quality'] as const

export function mergeWd14Results(results: WD14TagResult[], mode: WD14UnionMode = 'union'): WD14TagResult {
  if (results.length === 0) return { general: [], character: [], rating: [], quality: [] }
  if (results.length === 1) return results[0]
  const merged = {} as WD14TagResult
  for (const namespace of NAMESPACES) {
    const stats = new Map<string, { count: number; max: number; min: number }>()
    for (const result of results) {
      for (const item of result[namespace]) {
        const current = stats.get(item.name)
        if (current) {
          current.count += 1
          current.max = Math.max(current.max, item.confidence)
          current.min = Math.min(current.min, item.confidence)
        } else {
          stats.set(item.name, { count: 1, max: item.confidence, min: item.confidence })
        }
      }
    }
    merged[namespace] = [...stats.entries()]
      .filter(([, value]) => mode === 'union' || value.count === results.length)
      .map(([name, value]) => ({ name, confidence: mode === 'union' ? value.max : value.min }))
      .sort((a, b) => b.confidence - a.confidence || a.name.localeCompare(b.name))
  }
  return merged
}
