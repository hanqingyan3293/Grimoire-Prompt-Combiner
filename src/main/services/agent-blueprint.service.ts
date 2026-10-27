import crypto from 'crypto'
import type { AgentBlueprint, AgentBlueprintPage, CreateAgentBlueprint, ListAgentBlueprints, UpdateAgentBlueprint } from '../../shared/agent-blueprint-types'
import { getDatabase, saveDatabase } from '../database'
import { orderKeyBetween } from './resource-order'
import * as validate from './agent-blueprint.validation'

// Storage only. MCP/knowledge IDs are inert references, not grants, connected servers or
// runnable skills. Knowledge/workspace/skill execution and source lifecycle effects are unsupported.
const columns = 'id,source_type,runtime,name,description,instructions,model,plan_model,small_model,configuration_json,disabled_tools_json,mcp_ids_json,knowledge_base_ids_json,order_key,deleted_at,created_at,updated_at'
function rawRow(id: string, includeDeleted = false): unknown[] | undefined {
  validate.string(id, 'id', true)
  return getDatabase().exec(`SELECT ${columns} FROM agent_blueprints WHERE id=?${includeDeleted ? '' : ' AND deleted_at IS NULL'}`, [id])[0]?.values[0]
}
function project(row: unknown[]): AgentBlueprint {
  return {
    id: String(row[0]), type: row[1] as AgentBlueprint['type'], runtime: row[2] as AgentBlueprint['runtime'],
    name: String(row[3]), description: String(row[4]), instructions: String(row[5]), model: row[6] as AgentBlueprint['model'],
    ...(row[7] == null ? {} : { planModel: row[7] as NonNullable<AgentBlueprint['planModel']> }),
    ...(row[8] == null ? {} : { smallModel: row[8] as NonNullable<AgentBlueprint['smallModel']> }),
    configuration: validate.readConfiguration(JSON.parse(String(row[9]))),
    disabledTools: JSON.parse(String(row[10])), mcps: JSON.parse(String(row[11])), knowledgeBaseIds: JSON.parse(String(row[12])),
    orderKey: String(row[13]), ...(row[14] == null ? {} : { deletedAt: String(row[14]) }), createdAt: String(row[15]), updatedAt: String(row[16]),
  }
}
function transaction<T>(work: () => T): T {
  const db = getDatabase()
  db.exec('BEGIN IMMEDIATE')
  try { const result = work(); db.exec('COMMIT'); saveDatabase(); return result }
  catch (error) { try { db.exec('ROLLBACK') } catch {} throw error }
}
const fields = ['name', 'description', 'instructions', 'model', 'planModel', 'smallModel', 'configuration', 'disabledTools', 'mcps', 'knowledgeBaseIds', 'runtime']
function input(value: unknown, create: boolean): Record<string, unknown> {
  const raw = validate.object(value, 'blueprint')
  for (const key of Object.keys(raw)) if (![...fields, ...(create ? ['type'] : [])].includes(key)) {
    throw new Error(`AGENT_BLUEPRINT_UNSUPPORTED_FIELD: ${key} (skills/workspace execution is not implemented)`)
  }
  if (create) {
    validate.string(raw.name, 'name', true)
    validate.model(raw.model)
    validate.enumValue(raw.type, validate.sourceTypes, 'type')
    validate.enumValue(raw.runtime, validate.runtimes, 'runtime')
  }
  const result = { ...raw }
  for (const [key, value] of Object.entries(raw)) {
    if (value === undefined) continue
    if (key === 'name') validate.string(value, key, true)
    if (key === 'description' || key === 'instructions') validate.string(value, key)
    if (['model', 'planModel', 'smallModel'].includes(key)) validate.model(value, !create)
    if (key === 'runtime') validate.enumValue(value, validate.runtimes, key)
    if (key === 'configuration') result[key] = validate.configuration(value)
    if (['mcps', 'disabledTools', 'knowledgeBaseIds'].includes(key)) result[key] = validate.strings(value, key, key === 'knowledgeBaseIds')
  }
  return result
}
export function createAgentBlueprint(request: CreateAgentBlueprint): AgentBlueprint {
  const data = input(request, true)
  return transaction(() => {
    const id = crypto.randomUUID(), now = new Date().toISOString()
    // Source create inserts first; ordering is main-owned, never caller-supplied.
    const first = getDatabase().exec('SELECT order_key FROM agent_blueprints ORDER BY order_key,id LIMIT 1')[0]?.values[0]?.[0]
    const key = orderKeyBetween(null, first == null ? null : String(first))
    getDatabase().run(`INSERT INTO agent_blueprints (${columns}) VALUES (${Array(17).fill('?').join(',')})`, [
      id, data.type as string | null, String(data.runtime), String(data.name), String(data.description ?? ''), String(data.instructions ?? 'You are a helpful assistant.'),
      String(data.model), data.planModel == null ? null : String(data.planModel), data.smallModel == null ? null : String(data.smallModel),
      JSON.stringify(data.configuration ?? {}), JSON.stringify(data.disabledTools ?? []), JSON.stringify(data.mcps ?? []), JSON.stringify(data.knowledgeBaseIds ?? []), key, null, now, now,
    ])
    return project(rawRow(id)!)
  })
}
export function getAgentBlueprint(id: string, includeDeleted = false): AgentBlueprint | null {
  const row = rawRow(id, includeDeleted)
  return row ? project(row) : null
}
export function updateAgentBlueprint(id: string, request: UpdateAgentBlueprint): AgentBlueprint | null {
  const data = input(request, false)
  return transaction(() => {
    const row = rawRow(id)
    if (!row) return null
    const mapping: Record<string, number> = { name: 3, description: 4, instructions: 5, model: 6, planModel: 7, smallModel: 8, runtime: 2 }
    for (const [field, index] of Object.entries(mapping)) if (data[field] !== undefined) row[index] = data[field]
    for (const [field, index] of [['disabledTools', 10], ['mcps', 11], ['knowledgeBaseIds', 12]] as const) {
      if (data[field] !== undefined) row[index] = JSON.stringify(data[field])
    }
    if (data.configuration !== undefined) {
      // Read the authoritative blob IN the write tx; never merge a redacted renderer snapshot.
      const persisted = validate.object(JSON.parse(String(row[9])), 'stored configuration')
      const next = { ...persisted }
      for (const [key, value] of Object.entries(data.configuration as Record<string, unknown>)) {
        if (value === undefined) delete next[key]
        else next[key] = value
      }
      row[9] = JSON.stringify(next)
    }
    row[16] = new Date().toISOString()
    getDatabase().run(`UPDATE agent_blueprints SET ${columns.split(',').slice(1).map(column => column + '=?').join(',')} WHERE id=?`, [...row.slice(1), id] as (string | number | null)[])
    return project(rawRow(id)!)
  })
}
export function archiveAgentBlueprint(id: string): boolean {
  return transaction(() => {
    const row = rawRow(id)
    if (!row) return false
    getDatabase().run('UPDATE agent_blueprints SET deleted_at=? WHERE id=?', [new Date().toISOString(), id])
    return true
  })
}
export function restoreAgentBlueprint(id: string): AgentBlueprint | null {
  return transaction(() => {
    const row = rawRow(id, true)
    if (!row || row[14] == null) return null
    getDatabase().run('UPDATE agent_blueprints SET deleted_at=NULL WHERE id=?', [id])
    return project(rawRow(id)!)
  })
}
export function listAgentBlueprints(request: ListAgentBlueprints = {}): AgentBlueprintPage {
  const query = validate.object(request, 'list query')
  for (const key of Object.keys(query)) if (!['ids', 'inTrash', 'search', 'page', 'limit'].includes(key)) throw new Error(`AGENT_BLUEPRINT_INVALID_QUERY: ${key}`)
  const page = request.page ?? 1, limit = request.limit ?? 100
  if (!Number.isSafeInteger(page) || page < 1 || !Number.isSafeInteger(limit) || limit < 1 || limit > 500 || !Number.isSafeInteger((page - 1) * limit)) throw new Error('AGENT_BLUEPRINT_INVALID_QUERY: pagination')
  if (request.inTrash !== undefined && typeof request.inTrash !== 'boolean') throw new Error('AGENT_BLUEPRINT_INVALID_QUERY: inTrash')
  const where = [request.inTrash === true ? 'deleted_at IS NOT NULL' : 'deleted_at IS NULL']
  const params: (string | number)[] = []
  if (request.ids !== undefined) {
    const ids = validate.strings(request.ids, 'ids', true)
    if (!ids.length || request.ids.length > 500) throw new Error('AGENT_BLUEPRINT_INVALID_QUERY: ids')
    where.push(`id IN (${ids.map(() => '?').join(',')})`); params.push(...ids)
  }
  if (request.search !== undefined) {
    validate.string(request.search, 'search')
    const search = request.search.trim()
    if (!search.length) throw new Error('AGENT_BLUEPRINT_INVALID_QUERY: search')
    where.push("(name LIKE ? ESCAPE '\\' OR description LIKE ? ESCAPE '\\')")
    const pattern = `%${search.replace(/[\\%_]/g, '\\$&')}%`; params.push(pattern, pattern)
  }
  const filter = where.join(' AND '), db = getDatabase()
  const total = Number(db.exec(`SELECT count(*) FROM agent_blueprints WHERE ${filter}`, params)[0].values[0][0])
  const rows = db.exec(`SELECT ${columns} FROM agent_blueprints WHERE ${filter} ORDER BY order_key,id LIMIT ? OFFSET ?`, [...params, limit, (page - 1) * limit])[0]?.values ?? []
  return { agents: rows.map(project), total, page, limit }
}
