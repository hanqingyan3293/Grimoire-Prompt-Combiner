// 数据面注册表：把「哪张表 / 哪个目录属于哪个域」写成声明式映射，作为面板、导出、导入、迁移、
// 清理四处共用的单一事实源。
//
// 为什么手写而不是纯自动发现：sqlite_master 能给出表名，但给不出「这张表是标签库还是 AI 会话」，
// 而注册表既要给用户看的中文名，也要决定导出单位（一套标签组 vs 一个画布项目）。所以策略是
// **自动发现 + 手写映射**：未映射的表由主进程兜进 other 域并在开发日志告警，测试保证不会漏。
//
// 路径项只写相对基线（userData / 包内 data），绝对化在主进程完成 —— 共享层不能 import electron。

import type { StorageDomain } from './storage-types'

export interface StorageTableSpec {
  readonly table: string
  readonly label: string
  readonly domain: StorageDomain
  /** 是否支持按条导出（标签组、作品、画布项目等才为 true）。 */
  readonly exportable?: boolean
  /** 是否允许清理（仅日志类为 true）。 */
  readonly cleanable?: boolean
}

export interface StoragePathSpec {
  readonly id: string
  readonly label: string
  readonly domain: StorageDomain
  readonly kind: 'directory' | 'file' | 'package'
  readonly base: 'userData' | 'packageData'
  /** 相对基线的路径片段。 */
  readonly segments: readonly string[]
  readonly exportable: boolean
  readonly migratable: boolean
  readonly cleanable: boolean
  readonly note?: string
}

/** 面板上的域顺序：数据价值从高到低，运行与环境放最后。 */
export const STORAGE_DOMAINS_ORDER = ['tags', 'prompts', 'assets', 'media', 'workspace', 'ai', 'runtime', 'other'] as const

export const STORAGE_TABLES: readonly StorageTableSpec[] = [
  // ── 标签 ────────────────────────────────────────────────────────────────────────────────
  { table: 'tags', label: '标签', domain: 'tags', exportable: true },
  { table: 'tag_groups', label: '标签组', domain: 'tags', exportable: true },
  { table: 'categories', label: '标签大类', domain: 'tags' },
  { table: 'subcategories', label: '标签子类', domain: 'tags' },
  { table: 'tag_aliases', label: '标签别名', domain: 'tags', exportable: true },
  { table: 'tag_relations', label: '标签关系', domain: 'tags', exportable: true },
  { table: 'tag_metadata', label: '标签元数据', domain: 'tags', exportable: true },
  { table: 'tag_usage', label: '标签使用统计', domain: 'tags' },
  { table: 'tag_suggestions', label: '候选标签', domain: 'tags' },
  { table: 'tag_saved_searches', label: '保存的搜索', domain: 'tags', exportable: true },
  { table: 'favorites', label: '收藏（标签）', domain: 'tags', exportable: true },
  { table: 'sub_favorites', label: '收藏（子类）', domain: 'tags', exportable: true },
  { table: 'asset_tag_links', label: '资产标签关联', domain: 'tags' },

  // ── 提示词 ──────────────────────────────────────────────────────────────────────────────
  { table: 'presets', label: '提示词预设', domain: 'prompts', exportable: true },
  { table: 'history', label: '提示词历史', domain: 'prompts', exportable: true },
  { table: 'conversations', label: '旧版对话', domain: 'prompts' },
  { table: 'chat_messages', label: '旧版对话消息', domain: 'prompts' },
  { table: 'chat_groups', label: '旧版对话分组', domain: 'prompts' },
  { table: 'cherry_prompt_bindings', label: 'Cherry 提示词绑定', domain: 'prompts' },
  { table: 'cherry_resource_groups', label: 'Cherry 资源分组', domain: 'prompts' },
  { table: 'cherry_resource_state', label: 'Cherry 资源状态', domain: 'prompts' },
  { table: 'novelai_work', label: '提示词工作台作品', domain: 'prompts', exportable: true },
  { table: 'novelai_version', label: '作品版本', domain: 'prompts', exportable: true },
  { table: 'novelai_version_image', label: '版本关联图片', domain: 'prompts' },
  { table: 'novelai_branch_name', label: '版本分支名', domain: 'prompts' },
  { table: 'novelai_asset', label: '提示词素材', domain: 'prompts', exportable: true },
  { table: 'novelai_asset_usage', label: '素材使用记录', domain: 'prompts' },

  // ── 提示词资产 ──────────────────────────────────────────────────────────────────────────
  { table: 'prompt_assets', label: '提示词资产', domain: 'assets', exportable: true },
  { table: 'prompt_asset_categories', label: '资产分类', domain: 'assets', exportable: true },
  { table: 'prompt_asset_category_links', label: '资产分类关联', domain: 'assets', exportable: true },

  // ── 图片与媒体 ──────────────────────────────────────────────────────────────────────────
  { table: 'media_assets', label: '媒体资产', domain: 'media', exportable: true },
  { table: 'media_relations', label: '媒体关系', domain: 'media' },
  { table: 'image_refs', label: '图片引用', domain: 'media' },
  { table: 'image_derivatives', label: '图片派生版本', domain: 'media' },
  { table: 'image_perceptual_hashes', label: '感知哈希', domain: 'media' },
  { table: 'image_embeddings', label: '图片向量', domain: 'media' },
  { table: 'image_generation_metadata', label: '生成元数据', domain: 'media' },
  { table: 'task_image_refs', label: '任务图片引用', domain: 'media' },

  // ── 工作区 ──────────────────────────────────────────────────────────────────────────────
  { table: 'workspace_documents', label: '工作区布局文档', domain: 'workspace', exportable: true },
  { table: 'workspace_editor_states', label: '编辑器视图状态', domain: 'workspace' },
  { table: 'canvas_projects', label: '画布项目', domain: 'workspace', exportable: true },
  { table: 'canvas_vendor_projects', label: '原版画布项目', domain: 'workspace', exportable: true },

  // ── AI 与任务 ───────────────────────────────────────────────────────────────────────────
  { table: 'ai_sessions', label: 'AI 会话', domain: 'ai', exportable: true },
  { table: 'ai_messages', label: 'AI 消息', domain: 'ai', exportable: true },
  { table: 'ai_events', label: 'AI 事件', domain: 'ai' },
  { table: 'ai_usage_records', label: '用量记录', domain: 'ai' },
  { table: 'ai_assistants', label: 'AI 助手', domain: 'ai', exportable: true },
  { table: 'ai_topics', label: 'AI 主题', domain: 'ai', exportable: true },
  { table: 'ai_permissions', label: '权限决策', domain: 'ai' },
  { table: 'ai_attachments', label: 'AI 附件', domain: 'ai' },
  { table: 'ai_attachments_library_new', label: 'AI 附件库', domain: 'ai' },
  { table: 'agent_sessions', label: 'Agent 会话', domain: 'ai', exportable: true },
  { table: 'agent_session_events', label: 'Agent 会话事件', domain: 'ai' },
  { table: 'agent_session_read_model', label: 'Agent 读模型', domain: 'ai' },
  { table: 'agent_blueprints', label: 'Agent 蓝图', domain: 'ai', exportable: true },
  { table: 'agent_workspaces', label: 'Agent 工作区', domain: 'ai' },
  { table: 'mcp_servers', label: 'MCP 服务', domain: 'ai', exportable: true },
  { table: 'providers', label: '供应商配置', domain: 'ai', exportable: true },
  { table: 'task_jobs', label: '任务队列', domain: 'ai' },
  { table: 'comfy_workflows', label: 'ComfyUI 工作流', domain: 'ai', exportable: true },
  { table: 'browser_history', label: '浏览器历史', domain: 'ai' },
  { table: 'browser_bookmark', label: '浏览器书签', domain: 'ai', exportable: true },
  { table: 'topic_tree_messages', label: '主题树消息', domain: 'ai' },
  { table: 'topic_tree_state', label: '主题树状态', domain: 'ai' },
  { table: 'wd', label: 'WD14 反推缓存', domain: 'ai' },
  { table: 'wd14_history', label: 'WD14 历史记录', domain: 'ai', exportable: true },

  // ── 运行与环境 ──────────────────────────────────────────────────────────────────────────
  { table: 'settings', label: '应用设置', domain: 'runtime', exportable: true },
  { table: 'schema_meta', label: '数据库元信息', domain: 'runtime' },
  { table: 'migration_runs', label: '迁移记录', domain: 'runtime' },
  { table: 'error_logs', label: '错误日志（库内）', domain: 'runtime', cleanable: true },
]

export const STORAGE_PATHS: readonly StoragePathSpec[] = [
  {
    id: 'files.database',
    label: '数据库文件',
    domain: 'runtime',
    kind: 'file',
    base: 'userData',
    segments: ['grimoire.db'],
    exportable: true,
    migratable: true,
    cleanable: false,
    note: 'SQLite 主库，schema 42；迁移需冷迁移（退出后完成）',
  },
  {
    id: 'files.migration-backups',
    label: '迁移前备份',
    domain: 'runtime',
    kind: 'file',
    base: 'userData',
    segments: [],
    exportable: false,
    migratable: false,
    cleanable: true,
    note: '匹配 grimoire.db.pre-migration-*.bak；保留最近 3 份，其余可清理',
  },
  {
    id: 'files.logs',
    label: '运行日志',
    domain: 'runtime',
    kind: 'directory',
    base: 'userData',
    segments: ['logs'],
    exportable: true,
    migratable: true,
    cleanable: true,
  },
  {
    id: 'files.chromium-cache',
    label: '浏览器缓存',
    domain: 'runtime',
    kind: 'directory',
    base: 'userData',
    segments: [],
    exportable: false,
    migratable: false,
    cleanable: true,
    note: 'Cache / Code Cache / GPUCache / Partitions，可重建',
  },
  {
    id: 'files.media',
    label: '媒体文件',
    domain: 'media',
    kind: 'directory',
    base: 'userData',
    segments: ['media'],
    exportable: true,
    migratable: true,
    cleanable: false,
  },
  {
    id: 'files.models-wd14',
    label: 'WD14 模型',
    domain: 'ai',
    kind: 'directory',
    base: 'userData',
    segments: ['models', 'wd14'],
    exportable: false,
    migratable: true,
    cleanable: true,
    note: '可重新下载；迁移后需重启加载',
  },
  {
    id: 'files.models-clip',
    label: 'CLIP 模型',
    domain: 'ai',
    kind: 'directory',
    base: 'userData',
    segments: ['models', 'clip'],
    exportable: false,
    migratable: true,
    cleanable: true,
  },
  {
    id: 'files.agent-sessions',
    label: 'Agent 运行时会话',
    domain: 'ai',
    kind: 'directory',
    base: 'userData',
    segments: ['agent-runtime-sessions'],
    exportable: false,
    migratable: false,
    cleanable: true,
    note: '运行时产物，可重建；不支持迁移',
  },
  {
    id: 'files.agent-workspaces',
    label: 'Agent 运行时工作区',
    domain: 'ai',
    kind: 'directory',
    base: 'userData',
    segments: ['agent-runtime-workspaces'],
    exportable: false,
    migratable: false,
    cleanable: true,
    note: '运行时产物，可重建；不支持迁移',
  },
  {
    id: 'pkg.tags',
    label: '内置标签库',
    domain: 'tags',
    kind: 'package',
    base: 'packageData',
    segments: ['tags.json'],
    exportable: true,
    migratable: false,
    cleanable: false,
    note: '随安装包分发，只读',
  },
  {
    id: 'pkg.prompt-assets',
    label: '内置提示词资产',
    domain: 'assets',
    kind: 'package',
    base: 'packageData',
    segments: ['default-prompt-assets'],
    exportable: true,
    migratable: false,
    cleanable: false,
    note: '8 个来源、1862 条，随安装包分发，只读',
  },
]

/** 表名 → 规格。未命中返回 undefined，由调用方归入 other 并告警。 */
export function findStorageTable(table: string): StorageTableSpec | undefined {
  return STORAGE_TABLES.find((spec) => spec.table === table)
}

/** SQLite 内部表与 dbstat 里的索引行都要排除在「用户数据」之外。 */
export function isInternalTable(table: string): boolean {
  return table.startsWith('sqlite_') || table.startsWith('dbstat')
}
