// 设置 → 数据存储：跨进程共享的存储清单合同。
//
// 设计约束（见 .agent/DECISIONS.md D-STO-01）：
//  * 本文件只有类型与纯函数，不 import electron / node，渲染层可安全引用。
//  * bytes=null 表示「尚未统计」，UI 必须显示「更新中」而不是 0 —— 0 与未知是两件事。
//  * 每项都带四个能力位（exportable/importable/migratable/cleanable），按钮可用性只读这些位，
//    不在组件里按 id 分支，避免「界面能点但后端没实现」。

export type StorageDomain = 'tags' | 'prompts' | 'assets' | 'media' | 'workspace' | 'ai' | 'runtime' | 'other'

export type StorageKind = 'table' | 'directory' | 'file' | 'package'

export interface StorageEntry {
  /** 稳定 id：`db.<table>` / `files.<name>` / `pkg.<name>` */
  readonly id: string
  readonly kind: StorageKind
  readonly domain: StorageDomain
  /** 三级结构的中间层，例如「别名与关系」。 */
  readonly subgroup: string
  readonly label: string
  /** 绝对路径；DB 表记作 `db:<table>`。 */
  readonly location: string
  /** null = 未统计（不是空）。 */
  readonly bytes: number | null
  readonly rows?: number
  readonly files?: number
  readonly lastWrite?: string
  readonly exportable: boolean
  readonly importable: boolean
  readonly migratable: boolean
  readonly cleanable: boolean
  readonly note?: string
}

/** 域 → 子组 → 条目 的中间层。条目多的时候（标签 13 项、AI 25 项）靠它折叠。 */
export interface StorageSubgroup {
  readonly key: string
  readonly label: string
  readonly bytes: number
  readonly complete: boolean
  readonly entries: readonly StorageEntry[]
}

export interface StorageGroup {
  readonly domain: StorageDomain
  readonly label: string
  readonly bytes: number
  /** 组内是否全部已统计；false 且 bytes=0 时 UI 必须显示「—」而不是 0 B。 */
  readonly complete: boolean
  readonly entries: readonly StorageEntry[]
  readonly subgroups: readonly StorageSubgroup[]
}

export interface StorageInventory {
  readonly generatedAt: string
  readonly totalBytes: number
  readonly groups: readonly StorageGroup[]
  /** sqlite_master 里有、注册表没映射的表：宁可显示出来，也不要悄悄漏掉。 */
  readonly unmappedTables: readonly string[]
  /** 目录大小是否被上限/时间预算截断（true 时 UI 标注「≈」）。 */
  readonly approximate: boolean
}

export const STORAGE_DOMAIN_LABELS: Record<StorageDomain, string> = {
  tags: '标签',
  prompts: '提示词',
  assets: '提示词资产',
  media: '图片与媒体',
  workspace: '工作区',
  ai: 'AI 与任务',
  runtime: '运行与环境',
  other: '其他',
}

/** 人类可读体积。null 保持「—」，不把未知说成 0。 */
export function formatStorageBytes(bytes: number | null | undefined): string {
  if (bytes === null || bytes === undefined) return '—'
  if (bytes < 1024) return `${bytes} B`
  const units = ['KB', 'MB', 'GB', 'TB']
  let value = bytes / 1024
  let index = 0
  while (value >= 1024 && index < units.length - 1) {
    value /= 1024
    index += 1
  }
  return `${value >= 100 ? value.toFixed(0) : value.toFixed(1)} ${units[index]}`
}

/** 汇总一个域的体积；未统计的项不计入，但会让 `complete` 变 false。 */
export function sumDomain(entries: readonly StorageEntry[]): { bytes: number; complete: boolean } {
  let bytes = 0
  let complete = true
  for (const entry of entries) {
    if (entry.bytes === null) complete = false
    else bytes += entry.bytes
  }
  return { bytes, complete }
}
