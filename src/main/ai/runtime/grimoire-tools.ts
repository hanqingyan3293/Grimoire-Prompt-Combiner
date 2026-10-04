import { getDatabase } from '../../database'
import { getCanvasVendorProject, listCanvasVendorProjects, saveCanvasVendorProject } from '../../services/canvas-vendor.service'
import { createPromptAsset, listPromptAssetCategories, queryPromptAssets } from '../../services/prompt-asset-browser'
import { listWD14History } from '../../services/wd14-history.service'
import { createPersistedTask } from '../../services/task-repository'
import { registerMcpTools } from '../../services/mcp.service'
import { ToolRegistry } from './tools'

function objectInput(input: unknown): Record<string, unknown> {
  return input && typeof input === 'object' && !Array.isArray(input) ? input as Record<string, unknown> : {}
}

function textInput(input: Record<string, unknown>, key: string, fallback = ''): string {
  return typeof input[key] === 'string' ? String(input[key]).trim() : fallback
}

function numberInput(input: Record<string, unknown>, key: string, fallback: number): number {
  const value = Number(input[key])
  return Number.isFinite(value) ? value : fallback
}

function register(registry: ToolRegistry, tool: Parameters<ToolRegistry['register']>[0]) {
  registry.register(tool)
}

export function registerGrimoireTools(registry: ToolRegistry): void {
  register(registry, {
    name: 'grimoire.tags.search',
    description: '搜索本地标签库，返回标签及其分类信息。',
    permission: 'read',
    inputSchema: { type: 'object', properties: { query: { type: 'string' }, limit: { type: 'integer', minimum: 1, maximum: 100 } } },
    execute: async (raw) => {
      const input = objectInput(raw)
      const query = textInput(input, 'query').toLowerCase()
      const limit = Math.min(100, Math.max(1, Math.floor(numberInput(input, 'limit', 50))))
      const rows = getDatabase().exec(`SELECT t.id,t.en,t.zh,s.zh AS subcategory,c.zh AS category
        FROM tags t JOIN subcategories s ON s.id=t.subcategory_id JOIN categories c ON c.id=s.category_id
        WHERE ?='' OR lower(t.en) LIKE ? OR t.zh LIKE ? OR s.zh LIKE ? OR c.zh LIKE ?
        ORDER BY c.sort_order,s.sort_order,t.sort_order LIMIT ?`, [query, `%${query}%`, `%${query}%`, `%${query}%`, `%${query}%`, limit])[0]?.values || []
      return rows.map(row => ({ id: String(row[0]), en: String(row[1]), zh: String(row[2]), subcategory: String(row[3]), category: String(row[4]) }))
    },
  })

  register(registry, {
    name: 'grimoire.prompt.search',
    description: '搜索本地提示词、历史、预设和收藏资产。',
    permission: 'read',
    inputSchema: { type: 'object', properties: { query: { type: 'string' }, source: { type: 'string' }, limit: { type: 'integer' }, offset: { type: 'integer' } } },
    execute: async (raw) => {
      const input = objectInput(raw)
      return queryPromptAssets(getDatabase(), { query: textInput(input, 'query'), source: textInput(input, 'source', 'all') || 'all', limit: Math.min(100, Math.max(1, Math.floor(numberInput(input, 'limit', 40)))), offset: Math.max(0, Math.floor(numberInput(input, 'offset', 0))) })
    },
  })

  register(registry, {
    name: 'grimoire.prompt.categories',
    description: '读取提示词资产分类树。',
    permission: 'read',
    inputSchema: { type: 'object', properties: {} },
    execute: async () => listPromptAssetCategories(getDatabase()),
  })

  register(registry, {
    name: 'grimoire.prompt.create',
    description: '创建本地提示词资产。',
    permission: 'write',
    inputSchema: { type: 'object', required: ['name', 'prompt'], properties: { name: { type: 'string' }, prompt: { type: 'string' }, detail: { type: 'string' }, sourceId: { type: 'string' } } },
    execute: async (raw) => {
      const input = objectInput(raw)
      return createPromptAsset(getDatabase(), { name: textInput(input, 'name'), prompt: textInput(input, 'prompt'), detail: textInput(input, 'detail'), sourceId: textInput(input, 'sourceId') || undefined })
    },
  })

  register(registry, {
    name: 'grimoire.canvas.list',
    description: '列出无限画布项目。',
    permission: 'read',
    inputSchema: { type: 'object', properties: {} },
    execute: async () => listCanvasVendorProjects(),
  })

  register(registry, {
    name: 'grimoire.canvas.get',
    description: '读取指定无限画布项目的完整文档。',
    permission: 'read',
    inputSchema: { type: 'object', required: ['projectId'], properties: { projectId: { type: 'string' } } },
    execute: async (raw) => getCanvasVendorProject(textInput(objectInput(raw), 'projectId')) || (() => { throw new Error('无限画布项目不存在') })(),
  })

  register(registry, {
    name: 'grimoire.canvas.update',
    description: '修改无限画布项目文档，必须提供最新 revision。',
    permission: 'write',
    inputSchema: { type: 'object', required: ['projectId', 'document'], properties: { projectId: { type: 'string' }, document: { type: 'object' } } },
    execute: async (raw) => {
      const input = objectInput(raw)
      const projectId = textInput(input, 'projectId')
      const document = input.document
      if (!projectId || !document || typeof document !== 'object' || Array.isArray(document)) throw new Error('画布更新参数无效')
      return saveCanvasVendorProject(projectId, document)
    },
  })

  register(registry, {
    name: 'grimoire.wd14.history',
    description: '搜索 WD14 反推历史记录。',
    permission: 'read',
    inputSchema: { type: 'object', properties: { query: { type: 'string' }, status: { type: 'string' }, limit: { type: 'integer' } } },
    execute: async (raw) => {
      const input = objectInput(raw)
      const status = textInput(input, 'status')
      return listWD14History({ query: textInput(input, 'query'), status: status === 'failed' || status === 'succeeded' ? status : undefined, limit: Math.min(500, Math.max(1, Math.floor(numberInput(input, 'limit', 100)))) })
    },
  })

  register(registry, {
    name: 'grimoire.wd14.create',
    description: '创建 WD14 图片反推任务。',
    permission: 'execute',
    inputSchema: { type: 'object', required: ['imageId'], properties: { imageId: { type: 'integer' }, modelId: { type: 'string' }, threshold: { type: 'number' } } },
    execute: async (raw) => {
      const input = objectInput(raw)
      const imageId = Math.floor(numberInput(input, 'imageId', 0))
      if (imageId <= 0) throw new Error('图片 ID 无效')
      return createPersistedTask({ kind: 'wd14', input: { imageId, modelId: textInput(input, 'modelId') || undefined, threshold: Math.min(0.99, Math.max(0.01, numberInput(input, 'threshold', 0.35))) } })
    },
  })

  register(registry, {
    name: 'grimoire.providers.list',
    description: '列出本地 AI Provider 的非敏感配置。',
    permission: 'read',
    inputSchema: { type: 'object', properties: {} },
    execute: async () => {
      const rows = getDatabase().exec('SELECT id,name,base_url,default_model,models,is_active,updated_at FROM providers ORDER BY updated_at DESC')[0]?.values || []
      return rows.map(row => ({ id: String(row[0]), name: String(row[1]), baseUrl: String(row[2]), defaultModel: String(row[3]), models: (() => { try { return JSON.parse(String(row[4] || '[]')) } catch { return [] } })(), active: Number(row[5]) === 1, updatedAt: String(row[6]) }))
    },
  })

  register(registry, {
    name: 'grimoire.workspace.get',
    description: '读取 Workspace 持久化布局文档。',
    permission: 'read',
    inputSchema: { type: 'object', properties: { workspaceId: { type: 'string' } } },
    execute: async (raw) => {
      const workspaceId = textInput(objectInput(raw), 'workspaceId', 'grimoire-main')
      const row = getDatabase().exec('SELECT workspace_id,revision,data_json,updated_at FROM workspace_documents WHERE workspace_id=?', [workspaceId])[0]?.values?.[0]
      if (!row) return null
      let document: unknown = {}
      try { document = JSON.parse(String(row[2])) } catch { throw new Error('Workspace 文档 JSON 损坏') }
      return { workspaceId: String(row[0]), revision: Number(row[1]), document, updatedAt: String(row[3]) }
    },
  })

  registerMcpTools(registry)
}

export function createGrimoireToolRegistry(): ToolRegistry {
  const registry = new ToolRegistry()
  registerGrimoireTools(registry)
  return registry
}
