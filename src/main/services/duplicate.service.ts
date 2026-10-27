// 重复图片检测（Hydrus duplicate 语义）：按感知哈希的汉明距离把视觉上近乎
// 相同的图片聚成组。读 image_perceptual_hashes（v30）；分组用并查集，先按
// dhash 前缀分桶预筛避免 O(n²) 全量比较。
import { hammingDistance } from './perceptual-hash.core'
import type { LegacyDatabase } from './sqlite.compat'

export interface DuplicateGroup {
  hash: string
  imageRefIds: number[]
}

const DEFAULT_MAX_DISTANCE = 6
const PREFIX_BUCKETS = 256 // 按 dhash 前 2 位十六进制（8 bit）分桶

/** dhash 前 2 个十六进制字符作为桶键（0-255）。 */
function bucketOf(dhash: string): number {
  return parseInt(dhash.slice(0, 2), 16) || 0
}

/**
 * 查找重复组。maxDistance 为汉明距离阈值（默认 6，约 90% 相似）；
 * 只返回 ≥2 张的组，按组大小降序；分页作用于组列表。
 */
export function findDuplicateGroups(
  db: LegacyDatabase,
  options: { maxDistance?: number; limit?: number; page?: number } = {},
): { groups: DuplicateGroup[]; total: number } {
  const maxDistance = Math.max(0, Math.min(16, Math.floor(Number(options.maxDistance ?? DEFAULT_MAX_DISTANCE) || DEFAULT_MAX_DISTANCE)))
  const limit = Math.max(1, Math.min(100, Math.floor(Number(options.limit) || 50)))
  const page = Math.max(0, Math.floor(Number(options.page) || 0))

  const rows = db.exec('SELECT image_ref_id, dhash FROM image_perceptual_hashes WHERE length(dhash)=16')[0]?.values || []
  const entries: Array<{ id: number; hash: string; bucket: number }> = []
  for (const row of rows) {
    const id = Number(row[0])
    const hash = String(row[1] || '').toLowerCase()
    if (!Number.isInteger(id) || !/^[0-9a-f]{16}$/.test(hash)) continue
    entries.push({ id, hash, bucket: bucketOf(hash) })
  }

  // 并查集：只在同桶或相邻桶之间比较（前 8 bit 相差 > 2 的哈希距离必然 > maxDistance*4）。
  const parent = new Map<number, number>()
  const find = (value: number): number => {
    let root = value
    while (parent.get(root) !== undefined && parent.get(root) !== root) root = parent.get(root)!
    parent.set(value, root)
    return root
  }
  const union = (a: number, b: number): void => {
    const rootA = find(a)
    const rootB = find(b)
    if (rootA !== rootB) parent.set(rootA, rootB)
  }
  for (const entry of entries) parent.set(entry.id, entry.id)

  const buckets = new Map<number, Array<{ id: number; hash: string }>>()
  for (const entry of entries) {
    const list = buckets.get(entry.bucket) || []
    list.push({ id: entry.id, hash: entry.hash })
    buckets.set(entry.bucket, list)
  }
  const bucketKeys = [...buckets.keys()].sort((a, b) => a - b)
  for (const bucket of bucketKeys) {
    const current = buckets.get(bucket)!
    // 同桶内部两两比较。
    for (let i = 0; i < current.length; i += 1) {
      for (let j = i + 1; j < current.length; j += 1) {
        if (hammingDistance(current[i].hash, current[j].hash) <= maxDistance) union(current[i].id, current[j].id)
      }
    }
    // 与相邻桶（+1、+2）比较，捕获跨桶的近邻。
    for (const offset of [1, 2]) {
      const next = buckets.get(bucket + offset)
      if (!next) continue
      for (const left of current) for (const right of next) {
        if (hammingDistance(left.hash, right.hash) <= maxDistance) union(left.id, right.id)
      }
    }
  }

  const groupsById = new Map<number, number[]>()
  for (const entry of entries) {
    const root = find(entry.id)
    const list = groupsById.get(root) || []
    list.push(entry.id)
    groupsById.set(root, list)
  }

  const groups: DuplicateGroup[] = []
  for (const ids of groupsById.values()) {
    if (ids.length < 2) continue
    const sorted = [...ids].sort((a, b) => a - b)
    const representative = entries.find(entry => entry.id === sorted[0])?.hash || ''
    groups.push({ hash: representative, imageRefIds: sorted })
  }
  groups.sort((a, b) => b.imageRefIds.length - a.imageRefIds.length || a.imageRefIds[0] - b.imageRefIds[0])
  const total = groups.length
  return { groups: groups.slice(page * limit, page * limit + limit), total }
}
