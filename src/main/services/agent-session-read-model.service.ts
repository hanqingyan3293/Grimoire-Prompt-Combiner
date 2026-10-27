import crypto from 'node:crypto'
import type {
  AgentSessionReadModel,
  AgentSessionReadModelPage,
  CreateAgentSessionReadModel,
  ListAgentSessionReadModels,
  ReuseOrCreateAgentSessionReadModel,
  ReusableAgentSessionReadModelResult,
  UpdateAgentSessionReadModel
} from '../../shared/agent-session-read-model'
import type { AgentWorkspace } from '../../shared/agent-workspace-types'
import type { AgentRuntimeKind } from '../../shared/agent-types'
import { getDatabase, saveDatabase } from '../database'
import { getAgentBlueprint } from './agent-blueprint.service'
import { createAgentSessionTx } from './agent-session.service'
import { model as validateModel } from './agent-blueprint.validation'
import {
  allocateSystemAgentWorkspaceTx,
  deleteSystemAgentWorkspaceTx,
  validateUserAgentWorkspaceInternal
} from './agent-workspace.service'
import { evenlySpacedKeys, hasRoomBetween, orderKeyBetween } from './resource-order'

/** ADAPTER + PARTIAL_EXTRACTION, Cherry Studio 2.1.4 (AGPL-3.0).
 * Source AgentSessionService.createTx/rowToSession/listByCursor/getLatestActive/
 * updateTx/setWorkspaceTx/advanceLastActivityAtTx and shared schemas are the
 * behavior authority. Direct reuse/wrapper cannot redirect its private Drizzle,
 * application container, message, pin, channel and task repositories to existing
 * Grimoire execution rows. Vendor closure is preserved; adapt its DB-only create,
 * joined DTO, tuple entity cursor and monotonic activity on ONE Grimoire DB.
 * Pins, task relations, background creation, fork, history/file ownership and
 * transport are deliberately NOT claimed. No new snapshot or legacy adoption.
 */
const MAX_LIMIT = 200
const columns = 'id,type,agent_id,name,is_name_manually_edited,description,workspace_id,order_key,last_activity_at,trace_id,deleted_at,created_at,updated_at'

type RawWorkspace = [unknown, unknown, unknown, unknown, unknown, unknown, unknown]
type RawModel = [unknown, ...unknown[]]
function fail(code: string): never { throw new Error(`AGENT_SESSION_READ_MODEL_${code}`) }
function text(value: unknown, field: string, empty = false): string {
  if (typeof value !== 'string' || (!empty && !value.length)) fail(`INVALID_${field}`)
  if (field === 'NAME' && value.length > 255) fail('INVALID_NAME')
  return value
}
function strictObject(value: unknown, keys: string[]): void {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) fail('INVALID_INPUT')
  if (Object.keys(value).some(key => !keys.includes(key))) fail('UNSUPPORTED_FIELD')
}
function validateWorkspaceSource(value: CreateAgentSessionReadModel['workspace']): void {
  strictObject(value, value?.type === 'user' ? ['type', 'workspaceId'] : ['type'])
  if (value.type !== 'user' && value.type !== 'system') fail('INVALID_WORKSPACE')
  if (value.type === 'user') text(value.workspaceId, 'WORKSPACE_ID')
}
function tx<T>(work: () => T): T {
  const db = getDatabase(); db.exec('BEGIN IMMEDIATE')
  try { const result = work(); db.exec('COMMIT'); saveDatabase(); return result } catch (error) { try { db.exec('ROLLBACK') } catch {} throw error }
}
function workspace(row: RawWorkspace): AgentWorkspace {
  return { id: String(row[0]), name: String(row[1]), path: String(row[2]), type: row[3] as AgentWorkspace['type'], orderKey: String(row[4]), createdAt: String(row[5]), updatedAt: String(row[6]) }
}
function project(row: RawModel, ws: RawWorkspace): AgentSessionReadModel {
  return {
    id: String(row[0]), agentId: row[2] == null ? null : String(row[2]), name: String(row[3]), isNameManuallyEdited: Boolean(row[4]),
    description: String(row[5]), workspaceId: String(row[6]), workspace: workspace(ws), orderKey: String(row[7]),
    lastActivityAt: String(row[8]), ...(row[9] == null ? {} : { traceId: String(row[9]) }), createdAt: String(row[11]), updatedAt: String(row[12]),
    ...(row[10] == null ? {} : { deletedAt: String(row[10]) })
  }
}
function joined(id: string, includeTrash = false): AgentSessionReadModel | null {
  const row = getDatabase().exec(`SELECT r.${columns.replaceAll(',', ',r.')} ,w.id AS workspace_join_id,w.name AS workspace_join_name,w.path AS workspace_join_path,w.type AS workspace_join_type,w.order_key AS workspace_join_order_key,w.created_at AS workspace_join_created_at,w.updated_at AS workspace_join_updated_at FROM agent_session_read_model r JOIN agent_workspaces w ON w.id=r.workspace_id WHERE r.id=?${includeTrash ? '' : ' AND r.deleted_at IS NULL'}`, [id])[0]?.values[0]
  return row ? project(row.slice(0, 13) as RawModel, row.slice(13, 20) as RawWorkspace) : null
}
function validateCreate(input: CreateAgentSessionReadModel): void {
  strictObject(input, ['agentId', 'name', 'description', 'workspace'])
  text(input.agentId, 'AGENT_ID'); text(input.name, 'NAME', true)
  if (input.description !== undefined) text(input.description, 'DESCRIPTION', true)
  validateWorkspaceSource(input.workspace)
}
function activeBlueprint(agentId: string): { runtime: AgentRuntimeKind; providerId: string; model: string } {
  const blueprint = getAgentBlueprint(agentId)
  if (!blueprint) fail('AGENT_NOT_FOUND')
  if (!blueprint.model) fail('MODEL_REQUIRED')
  validateModel(blueprint.model)
  const split = blueprint.model.indexOf('::')
  return { runtime: blueprint.runtime, providerId: blueprint.model.slice(0, split), model: blueprint.model.slice(split + 2) }
}
function nextOrderKey(): string {
  const db = getDatabase()
  let first = db.exec('SELECT order_key FROM agent_session_read_model ORDER BY order_key,id LIMIT 1')[0]?.values[0]?.[0]
  if (!hasRoomBetween(null, first == null ? null : String(first))) {
    const rows = db.exec('SELECT id FROM agent_session_read_model ORDER BY order_key,id')[0]?.values ?? []
    const keys = evenlySpacedKeys(rows.length)
    rows.forEach((row, index) => db.run('UPDATE agent_session_read_model SET order_key=? WHERE id=?', [keys[index], row[0]]))
    first = keys[0]
  }
  return orderKeyBetween(null, first == null ? null : String(first))
}

/** Main-owned one-to-one projection create. Runtime identity/config is derived
 * from the active blueprint; the caller cannot supply a second model snapshot.
 */
export function createAgentSessionReadModel(input: CreateAgentSessionReadModel): AgentSessionReadModel {
  validateCreate(input)
  return tx(() => createAgentSessionReadModelTx(input))
}
/** Source createTx adaptation: DB-only, caller owns BEGIN/COMMIT/save. No
 * runtime launch, directory preparation, snapshot, permission or prewarm.
 */
export function createAgentSessionReadModelTx(input: CreateAgentSessionReadModel): AgentSessionReadModel {
  validateCreate(input)
  const id = 'agent_session_' + crypto.randomUUID().replaceAll('-', '').slice(0, 24)
  const createdAt = new Date().toISOString()
  const db = getDatabase()
  const runtime = activeBlueprint(input.agentId)
  const workspace = input.workspace.type === 'user'
    ? validateUserAgentWorkspaceInternal(input.workspace.workspaceId)
    : allocateSystemAgentWorkspaceTx({ sessionId: id, createdAt: Date.parse(createdAt) })
  const orderKey = nextOrderKey()
  createAgentSessionTx({ runtime: runtime.runtime, providerId: runtime.providerId, model: runtime.model, title: input.name, agentId: input.agentId, workspace: { type: workspace.type, workspaceId: workspace.id } }, { id, createdAt })
  db.run(`INSERT INTO agent_session_read_model (${columns}) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`, [id, 'conversation', input.agentId, input.name, 0, input.description ?? '', workspace.id, orderKey, createdAt, null, null, createdAt, createdAt])
  return joined(id, true)!
}

/** Cherry AgentSessionService.reuseOrCreatePlaceholderWithImpact adaptation.
 * Preserve exact owner/workspace, trim(name), manual-name and no-message rules,
 * updatedAt DESC/id ASC selection, monotonic touch and system-only duplicates.
 * Host deviations are intentional: active blueprint MODEL is required even on
 * reuse (no runnable configuration can be guessed); only runtime status=idle is
 * eligible. Running/interrupted/failed/completed rows are retained, not asserted
 * settled. System duplicate purge additionally requires ZERO event history,
 * because this host has no source task/channel/delivery/active-run ownership
 * repositories to cascade safely. Refuse ambiguous purge atomically instead of
 * inventing task IDs, launch cancellation, delivery results or FS deletion.
 */
export function reuseOrCreateAgentSessionReadModel(input: ReuseOrCreateAgentSessionReadModel): ReusableAgentSessionReadModelResult {
  strictObject(input, ['agentId', 'workspace', 'excludeSessionId'])
  text(input.agentId, 'AGENT_ID'); validateWorkspaceSource(input.workspace)
  if (input.excludeSessionId !== undefined) text(input.excludeSessionId, 'EXCLUDE_SESSION_ID')
  return tx(() => {
    activeBlueprint(input.agentId)
    const db = getDatabase(), args: string[] = [input.agentId]
    const scope = input.workspace.type === 'system' ? "w.type='system'" : "w.type='user' AND r.workspace_id=?"
    if (input.workspace.type === 'user') args.push(validateUserAgentWorkspaceInternal(input.workspace.workspaceId).id)
    const exclude = input.excludeSessionId === undefined ? '' : ' AND r.id!=?'
    if (input.excludeSessionId !== undefined) args.push(input.excludeSessionId)
    const candidates = db.exec(`SELECT r.id,r.workspace_id FROM agent_session_read_model r
      JOIN agent_sessions s ON s.id=r.id JOIN agent_workspaces w ON w.id=r.workspace_id
      WHERE r.type='conversation' AND r.deleted_at IS NULL AND r.agent_id=? AND ${scope}${exclude}
        AND r.is_name_manually_edited=0 AND trim(r.name)='' AND s.status='idle'
        AND NOT EXISTS(SELECT 1 FROM agent_session_events e WHERE e.session_id=r.id AND e.type='message')
      ORDER BY r.updated_at DESC,r.id ASC`, args)[0]?.values ?? []
    if (!candidates.length) {
      return { session: createAgentSessionReadModelTx({ agentId: input.agentId, name: '', workspace: input.workspace }), created: true, deletedDuplicateSessionIds: [] }
    }
    const selectedId = String(candidates[0][0]), duplicateIds: string[] = []
    if (input.workspace.type === 'system') {
      for (const candidate of candidates.slice(1)) {
        const id = String(candidate[0]), workspaceId = String(candidate[1])
        // Recheck inside the serialized transaction before destructive row cleanup.
        if (!db.exec("SELECT 1 FROM agent_sessions WHERE id=? AND status='idle'", [id])[0]?.values.length
          || db.exec('SELECT 1 FROM agent_session_events WHERE session_id=? LIMIT 1', [id])[0]?.values.length) fail('UNSAFE_PLACEHOLDER_PURGE')
        const referenced = db.exec("SELECT 1 FROM agent_sessions WHERE id!=? AND (NOT json_valid(data_json) OR json_extract(data_json,'$.agentSession.workspace.workspaceId')=?) LIMIT 1", [id, workspaceId])[0]?.values.length
        if (referenced) fail('UNSAFE_PLACEHOLDER_PURGE')
        // Existing Grimoire resource state is the actual pin authority; no second
        // source pin store. Drop only the deleted execution session's projection.
        db.run("DELETE FROM cherry_resource_state WHERE entity_type='session' AND entity_id=?", [id])
        db.run('DELETE FROM agent_sessions WHERE id=?', [id]) // FK cascades sidecar.
        deleteSystemAgentWorkspaceTx(workspaceId) // RESTRICT protects other mapped references.
        duplicateIds.push(id)
      }
    }
    const now = new Date().toISOString()
    db.run('UPDATE agent_session_read_model SET last_activity_at=max(last_activity_at,?),updated_at=max(updated_at,?) WHERE id=? AND deleted_at IS NULL', [now, now, selectedId])
    return { session: joined(selectedId) ?? fail('NOT_FOUND'), created: false, deletedDuplicateSessionIds: duplicateIds }
  })
}

/** Unmapped legacy execution rows require explicit 409 at the future coordinator.
 * A null projection is NOT permission to synthesize or infer a source session.
 */
export function getAgentSessionReadModel(id: string): AgentSessionReadModel | null { return joined(text(id, 'ID')) }

/** Source setWorkspaceTx: only before any message, registration-only cleanup. */
export function setAgentSessionReadModelWorkspace(id: string, source: CreateAgentSessionReadModel['workspace']): AgentSessionReadModel {
  text(id, 'ID'); validateWorkspaceSource(source)
  return tx(() => {
    const current = joined(id, false) ?? fail('NOT_FOUND')
    if (getDatabase().exec("SELECT 1 FROM agent_session_events WHERE session_id=? AND type='message' LIMIT 1", [id])[0]?.values.length) fail('WORKSPACE_LOCKED')
    if (source.type === 'system' && current.workspace.type === 'system') return current
    const next = source.type === 'user' ? validateUserAgentWorkspaceInternal(source.workspaceId) : allocateSystemAgentWorkspaceTx({ sessionId: id, createdAt: Date.parse(current.createdAt) })
    if (next.id === current.workspaceId) return current
    getDatabase().run('UPDATE agent_session_read_model SET workspace_id=?,updated_at=? WHERE id=?', [next.id, new Date().toISOString(), id])
    if (current.workspace.type === 'system') deleteSystemAgentWorkspaceTx(current.workspaceId)
    return joined(id)!
  })
}
export function listAgentSessionReadModels(query: ListAgentSessionReadModels = {}): AgentSessionReadModelPage {
  strictObject(query, ['ids', 'agentId', 'workspaceId', 'cursor', 'limit', 'inTrash'])
  const limit = query.limit ?? 50
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > MAX_LIMIT || (query.inTrash !== undefined && typeof query.inTrash !== 'boolean')) fail('INVALID_QUERY')
  const where: string[] = ["r.type='conversation'", query.inTrash ? 'r.deleted_at IS NOT NULL' : 'r.deleted_at IS NULL']; const args: (string | number)[] = []
  if (query.agentId) { where.push('r.agent_id=?'); if (!query.inTrash) where.push('a.id IS NOT NULL'); args.push(text(query.agentId, 'AGENT_ID')) }
  if (query.agentId !== undefined) text(query.agentId, 'AGENT_ID', true)
  if (query.workspaceId !== undefined) { where.push('r.workspace_id=?'); args.push(text(query.workspaceId, 'WORKSPACE_ID')) }
  if (query.ids !== undefined) { if (!Array.isArray(query.ids) || !query.ids.length || query.ids.length > 200) fail('INVALID_IDS'); where.push(`r.id IN (${query.ids.map(() => '?').join(',')})`); args.push(...query.ids.map(id => text(id, 'ID'))) }
  if (query.cursor !== undefined) {
    text(query.cursor, 'CURSOR', true)
    // Source entity-section wire codec. No pin store is invented by this slice;
    // absent/malformed/stale pin cursors fall through to the entity first page.
    const match = /^entity:([^:]+):(.+)$/.exec(query.cursor)
    if (match) { where.push('(r.order_key>? OR (r.order_key=? AND r.id>?))'); args.push(match[1], match[1], match[2]) }
  }
  const rows = getDatabase().exec(`SELECT r.${columns.replaceAll(',', ',r.')} ,w.id AS workspace_join_id,w.name AS workspace_join_name,w.path AS workspace_join_path,w.type AS workspace_join_type,w.order_key AS workspace_join_order_key,w.created_at AS workspace_join_created_at,w.updated_at AS workspace_join_updated_at FROM agent_session_read_model r JOIN agent_workspaces w ON w.id=r.workspace_id LEFT JOIN agent_blueprints a ON a.id=r.agent_id AND a.deleted_at IS NULL WHERE ${where.join(' AND ')} ORDER BY r.order_key,r.id LIMIT ?`, [...args, limit + 1])[0]?.values ?? []
  const pageRows = rows.slice(0, limit); return { items: pageRows.map(row => project(row.slice(0, 13) as RawModel, row.slice(13, 20) as RawWorkspace)), ...(rows.length > limit ? { nextCursor: `entity:${String(pageRows.at(-1)![7])}:${String(pageRows.at(-1)![0])}` } : {}) }
}
export function getLatestAgentSessionReadModel(agentId?: string): AgentSessionReadModel | null {
  const args: string[] = []
  const filter = agentId === 'unlinked' ? ' AND a.id IS NULL' : agentId ? ' AND a.id=?' : ''
  if (agentId !== undefined) { text(agentId, 'AGENT_ID'); if (agentId !== 'unlinked') args.push(agentId) }
  const row = getDatabase().exec(`SELECT r.${columns.replaceAll(',', ',r.')} ,w.id AS workspace_join_id,w.name AS workspace_join_name,w.path AS workspace_join_path,w.type AS workspace_join_type,w.order_key AS workspace_join_order_key,w.created_at AS workspace_join_created_at,w.updated_at AS workspace_join_updated_at FROM agent_session_read_model r JOIN agent_workspaces w ON w.id=r.workspace_id LEFT JOIN agent_blueprints a ON a.id=r.agent_id AND a.deleted_at IS NULL WHERE r.type='conversation' AND r.deleted_at IS NULL${filter} ORDER BY r.last_activity_at DESC,r.id ASC LIMIT 1`, args)[0]?.values[0]
  return row ? project(row.slice(0, 13) as RawModel, row.slice(13, 20) as RawWorkspace) : null
}
export function updateAgentSessionReadModel(id: string, patch: UpdateAgentSessionReadModel): AgentSessionReadModel {
  text(id, 'ID'); strictObject(patch, ['name', 'isNameManuallyEdited', 'description', 'agentId'])
  if (patch.isNameManuallyEdited !== undefined && typeof patch.isNameManuallyEdited !== 'boolean') fail('INVALID_MANUAL_FLAG')
  const fields: string[] = [], args: (string | number)[] = []
  if (patch.name !== undefined) { fields.push('name=?','is_name_manually_edited=?'); args.push(text(patch.name, 'NAME', true), patch.isNameManuallyEdited ?? true ? 1 : 0) }
  else if (patch.isNameManuallyEdited !== undefined) { fields.push('is_name_manually_edited=?'); args.push(patch.isNameManuallyEdited ? 1 : 0) }
  if (patch.description !== undefined) { fields.push('description=?'); args.push(text(patch.description, 'DESCRIPTION', true)) }
  if (patch.agentId !== undefined) { fields.push('agent_id=?'); args.push(text(patch.agentId, 'AGENT_ID')) }
  if (!fields.length) return joined(id, false) ?? fail('NOT_FOUND')
  return tx(() => {
    if (patch.agentId !== undefined && !getAgentBlueprint(patch.agentId)) fail('AGENT_NOT_FOUND')
    // Owner changes are metadata, never retroactive execution/model/snapshot edits.
    const result = getDatabase().run(`UPDATE agent_session_read_model SET ${fields.join(',')},updated_at=? WHERE id=? AND deleted_at IS NULL`, [...args, new Date().toISOString(), id])
    if (!Number(result.changes)) fail('NOT_FOUND')
    return getAgentSessionReadModel(id)!
  })
}
