// 备份包（.zip）的格式合同：主进程写出、导入时校验、渲染层展示都用这一份。
//
// 设计要点：
//  * `format` 是显式版本串，不用 schemaVersion 兼作格式版本 —— 包格式与数据库结构是两件事，
//    将来 schema 42 → 43 时旧包仍然可读，只要 format 没变。
//  * 每个文件都有 sha256；导入前逐个校验，避免半个包把库换掉。
//  * `kind` 决定导入路径：`full` 会替换整库（需要重启），`partial` 只写选中条目。

export type BackupKind = 'full' | 'partial' | 'diagnostics'

export const BACKUP_FORMAT = 'grimoire-backup/1'

export interface BackupItem {
  /** 与数据面注册表一致的 id（`db.tags` / `files.media`），导入时靠它定位。 */
  readonly id: string
  readonly label: string
  readonly domain: string
  readonly rows?: number
  /** 该条目在包内的相对路径（partial 才有）。 */
  readonly payload?: string
}

export interface BackupFile {
  readonly path: string
  readonly bytes: number
  readonly sha256: string
}

export interface BackupManifest {
  readonly format: typeof BACKUP_FORMAT
  readonly kind: BackupKind
  readonly appVersion: string
  readonly schemaVersion: number
  readonly createdAt: string
  readonly platform: string
  readonly items: readonly BackupItem[]
  readonly files: readonly BackupFile[]
  readonly totals: { readonly bytes: number; readonly entries: number }
}

export type ImportKind = 'full' | 'partial' | 'database'

export interface ImportInspection {
  readonly path: string
  readonly kind: ImportKind
  readonly appVersion?: string
  readonly schemaVersion?: number
  readonly createdAt?: string
  /** 能否直接导入；false 时 reason 说明原因。 */
  readonly compatible: boolean
  readonly reason?: string
  readonly items: readonly BackupItem[]
  readonly files: readonly BackupFile[]
  readonly totals: { readonly bytes: number; readonly entries: number }
}

export interface ImportApplyResult {
  readonly kind: ImportKind
  /** full / database 会替换整库，必须重启才能让所有服务重新打开。 */
  readonly restartRequired: boolean
  /** 替换前的当前库备份路径。 */
  readonly previousBackup?: string
  readonly restoredEntries: number
}

export interface TransferProgress {
  readonly phase: 'preparing' | 'compressing' | 'verifying' | 'writing' | 'done' | 'failed'
  readonly current?: string
  readonly processedBytes?: number
  readonly totalBytes?: number
  readonly message?: string
}
