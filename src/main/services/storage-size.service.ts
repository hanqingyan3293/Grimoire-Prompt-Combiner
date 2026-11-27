// 目录/文件体积统计：给「设置 → 数据存储」用。
//
// 三条实测过的约束决定了这里的形状：
//  1. userData 里 Chromium 缓存有上万文件，同步遍历会卡住主线程 → 全部走 fs/promises + 并发上限。
//  2. 用户可能把目录指向网络盘或权限受限路径 → 单条错误不能中断整次统计，记 0 并标原因。
//  3. 面板会被反复打开 → 结果按 5 分钟 TTL 缓存；同一 dir 的并发请求合并成一个 in-flight Promise。
// 超时（默认 3s）或文件数上限（默认 10 万）触发时返回 partial，由调用方在 UI 上标「≈」。

import fs from 'fs/promises'
import path from 'path'

export interface SizedPath {
  bytes: number
  files: number
  /** 命中上限或超时，数字是下限而不是精确值。 */
  truncated: boolean
  /** 有目录因权限/IO 错误被跳过（数量，不暴露路径）。 */
  skipped: number
}

const CACHE_TTL_MS = 5 * 60 * 1000
const DEFAULT_BUDGET_MS = 3000
const DEFAULT_FILE_CAP = 100_000
const CONCURRENCY = 8

const cache = new Map<string, { at: number; value: SizedPath }>()
const inFlight = new Map<string, Promise<SizedPath>>()

export function clearSizeCache(): void {
  cache.clear()
}

async function walk(root: string, budgetMs: number, fileCap: number): Promise<SizedPath> {
  const started = Date.now()
  const queue: string[] = [root]
  let bytes = 0
  let files = 0
  let skipped = 0
  let truncated = false

  const visit = async (target: string): Promise<void> => {
    let stat
    try {
      stat = await fs.lstat(target)
    } catch {
      skipped += 1
      return
    }
    // 不跟随符号链接：userData 里没有需要跟随的链接，跟随只会带来环与重复计数。
    if (stat.isSymbolicLink()) return
    if (stat.isFile()) {
      bytes += stat.size
      files += 1
      return
    }
    if (!stat.isDirectory()) return
    queue.push(target)
  }

  while (queue.length > 0 && !truncated) {
    if (Date.now() - started > budgetMs) {
      truncated = true
      break
    }
    const batch = queue.splice(0, CONCURRENCY)
    await Promise.all(batch.map(async (dir) => {
      let entries
      try {
        entries = await fs.readdir(dir, { withFileTypes: true })
      } catch {
        skipped += 1
        return
      }
      for (const entry of entries) {
        // 上限必须在文件级判断：只在目录循环开头检查的话，单个大目录会整批读完才退出。
        if (truncated) return
        if (Date.now() - started > budgetMs) {
          truncated = true
          return
        }
        const full = path.join(dir, entry.name)
        if (entry.isDirectory()) queue.push(full)
        else if (entry.isFile()) {
          try {
            const stat = await fs.stat(full)
            bytes += stat.size
            files += 1
            if (files > fileCap) {
              truncated = true
              return
            }
          } catch {
            skipped += 1
          }
        }
      }
    }))
  }

  return { bytes, files, truncated, skipped }
}

/** 统计单个路径（文件或目录）。不存在时返回全 0 且不报错——面板上「没有这个目录」是正常状态。 */
export async function sizeOfPath(
  target: string,
  options: { budgetMs?: number; fileCap?: number; force?: boolean } = {},
): Promise<SizedPath> {
  const cached = cache.get(target)
  if (!options.force && cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.value

  const pending = inFlight.get(target)
  if (!options.force && pending) return pending

  const task = (async (): Promise<SizedPath> => {
    try {
      const stat = await fs.stat(target)
      if (stat.isFile()) return { bytes: stat.size, files: 1, truncated: false, skipped: 0 }
      return await walk(target, options.budgetMs ?? DEFAULT_BUDGET_MS, options.fileCap ?? DEFAULT_FILE_CAP)
    } catch {
      return { bytes: 0, files: 0, truncated: false, skipped: 1 }
    }
  })()

  inFlight.set(target, task)
  try {
    const value = await task
    cache.set(target, { at: Date.now(), value })
    return value
  } finally {
    inFlight.delete(target)
  }
}

/** 多个路径求和（例如 Chromium 的 4 个缓存目录合成一项）。 */
export async function sizeOfPaths(targets: readonly string[], options: { force?: boolean } = {}): Promise<SizedPath> {
  const parts = await Promise.all(targets.map((target) => sizeOfPath(target, options)))
  return parts.reduce<SizedPath>(
    (total, part) => ({
      bytes: total.bytes + part.bytes,
      files: total.files + part.files,
      truncated: total.truncated || part.truncated,
      skipped: total.skipped + part.skipped,
    }),
    { bytes: 0, files: 0, truncated: false, skipped: 0 },
  )
}

/** 按文件名匹配求和（迁移备份 `grimoire.db.pre-migration-*.bak` 就靠它）。 */
export async function sizeOfMatchingFiles(directory: string, match: (name: string) => boolean): Promise<SizedPath> {
  let entries
  try {
    entries = await fs.readdir(directory, { withFileTypes: true })
  } catch {
    return { bytes: 0, files: 0, truncated: false, skipped: 1 }
  }
  let bytes = 0
  let files = 0
  for (const entry of entries) {
    if (!entry.isFile() || !match(entry.name)) continue
    try {
      const stat = await fs.stat(path.join(directory, entry.name))
      bytes += stat.size
      files += 1
    } catch {
      // 单个文件读不到不影响其余统计
    }
  }
  return { bytes, files, truncated: false, skipped: 0 }
}
