import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { app } from 'electron'
import type { AgentWorkspace, AgentWorkspaceOrder, CreateAgentWorkspace, FindOrCreateAgentWorkspaceResult, UpdateAgentWorkspace } from '../../shared/agent-workspace-types'
import { getDatabase, saveDatabase } from '../database'
import { evenlySpacedKeys, hasRoomBetween, orderKeyBetween } from './resource-order'

/** ADAPTER + PARTIAL_EXTRACTION, Cherry (AGPL-3.0):
 * main/data/services/AgentWorkspaceService.ts + db/schemas/agentWorkspace.ts.
 * Preserve seven-field entity, idempotent registration (never rename), user-only
 * projection/mutation, UTC system path and row-only deletion. Direct reuse/wrapper
 * cannot replace its private Drizzle/application/session/channel/task repositories.
 * main/utils/file/path.ts pure helpers are not safely importable here: runtime
 * @main/core/platform and @shared/types/file aliases require source container/config.
 * Adapt its relative-segment containment rule below; use realpath for user identity
 * and fail-closed lstat component checks for system writes (not source's allowMissing).
 * No source ORM/container copied, no second database. Existing fractional keys reused.
 * Source background/channel/task visibility awaits those actual repositories.
 */
const columns = 'id,name,path,type,order_key,created_at,updated_at'
function fail(reason: string): never { throw new Error(`AGENT_WORKSPACE_${reason}`) }
function text(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim() || /[\x00-\x1f]/.test(value)) fail(`INVALID_${field}`)
  return value.trim()
}
function strictObject(value: unknown, allowed: string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('INVALID_INPUT')
  const result = value as Record<string, unknown>
  for (const key of Object.keys(result)) if (!allowed.includes(key)) fail('UNSUPPORTED_FIELD')
  return result
}
/** Canonical key IS the persisted path: realpath + normalize + root-safe trailing
 * separator removal, then locale-independent lowercase on Windows. POSIX stays
 * case-sensitive. No Unicode normalization (distinct filesystem names stay distinct).
 */
export function agentWorkspacePathKey(value: string, platform: NodeJS.Platform = process.platform): string {
  const api = platform === 'win32' ? path.win32 : path.posix
  let result = api.normalize(value)
  const root = api.parse(result).root
  while (result.length > root.length && /[\\/]$/.test(result)) result = result.slice(0, -1)
  return platform === 'win32' ? result.toLowerCase() : result
}
function absolute(value: unknown): string {
  const result = text(value, 'PATH')
  if (!path.isAbsolute(result)) fail('INVALID_PATH')
  // Reject drive-relative/current-drive and Windows device namespaces/ADS/ambiguous names.
  if (process.platform === 'win32') {
    if (!/^(?:[a-z]:[\\/]|[\\/]{2}[^\\/]+[\\/][^\\/]+)/i.test(result) || /^[\\/]{2}[?.]/.test(result)) fail('INVALID_PATH')
    const parts = result.slice(path.parse(result).root.length).split(/[\\/]/).filter(Boolean)
    if (parts.some(p => p !== '.' && p !== '..' && (/[<>:"|?*]/.test(p) || /[. ]$/.test(p) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(p)))) fail('INVALID_PATH')
  }
  return path.normalize(result)
}
function sameOrInside(candidate: string, container: string): boolean {
  const relative = path.relative(agentWorkspacePathKey(container), agentWorkspacePathKey(candidate))
  return relative === '' || (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative))
}
function directory(value: string): string {
  try {
    const real = fs.realpathSync.native(value)
    if (!fs.statSync(real).isDirectory()) fail('NOT_DIRECTORY')
    fs.accessSync(real, fs.constants.R_OK | fs.constants.X_OK)
    return agentWorkspacePathKey(real)
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('AGENT_WORKSPACE_')) throw error
    return fail('DIRECTORY_UNAVAILABLE')
  }
}
function managedRoot(): string { return absolute(app.getPath('userData')) }
function project(row: unknown[]): AgentWorkspace {
  if (row[3] !== 'user' && row[3] !== 'system') fail('CORRUPT_ROW')
  return { id: String(row[0]), name: String(row[1]), path: String(row[2]), type: row[3], orderKey: String(row[4]), createdAt: String(row[5]), updatedAt: String(row[6]) }
}
function rows(includeSystem = false): AgentWorkspace[] {
  return (getDatabase().exec(`SELECT ${columns} FROM agent_workspaces${includeSystem ? '' : " WHERE type='user'"} ORDER BY order_key,id`)[0]?.values ?? []).map(project)
}
function lookup(id: string, includeSystem = false): AgentWorkspace {
  const row = getDatabase().exec(`SELECT ${columns} FROM agent_workspaces WHERE id=?${includeSystem ? '' : " AND type='user'"}`, [text(id, 'ID')])[0]?.values[0]
  if (!row) fail('NOT_FOUND')
  return project(row)
}
function transaction<T>(work: () => T): T {
  const db = getDatabase(); db.exec('BEGIN IMMEDIATE')
  try { const result = work(); db.exec('COMMIT'); saveDatabase(); return result }
  catch (error) { try { db.exec('ROLLBACK') } catch {} throw error }
}
function insert(name: string, location: string, type: AgentWorkspace['type']): AgentWorkspace {
  const id = crypto.randomUUID(), now = new Date().toISOString()
  const scope = rows(true)
  let first = scope[0]?.orderKey ?? null
  if (!hasRoomBetween(null, first)) {
    const keys = evenlySpacedKeys(scope.length)
    scope.forEach((row, index) => getDatabase().run('UPDATE agent_workspaces SET order_key=? WHERE id=?', [keys[index], row.id]))
    first = keys[0] ?? null
  }
  getDatabase().run(`INSERT INTO agent_workspaces (${columns}) VALUES (?,?,?,?,?,?,?)`, [id, name, location, type, orderKeyBetween(null, first), now, now])
  return lookup(id, true)
}
export function listAgentWorkspaces(): AgentWorkspace[] { return rows() }
export function getAgentWorkspace(id: string): AgentWorkspace { return lookup(id) }
// Main-internal only. Not exposed by IPC/API/preload.
export function listAgentWorkspacesInternal(): AgentWorkspace[] { return rows(true) }
export function getAgentWorkspaceInternal(id: string): AgentWorkspace { return lookup(id, true) }
export function findOrCreateAgentWorkspace(request: CreateAgentWorkspace): FindOrCreateAgentWorkspaceResult {
  const input = strictObject(request, ['path', 'name'])
  const lexical = absolute(input.path)
  const name = input.name === undefined ? undefined : text(input.name, 'NAME')
  const location = directory(lexical), managed = managedRoot(), realManaged = directory(managed)
  if (sameOrInside(lexical, managed) || sameOrInside(location, realManaged)) fail('MANAGED_PATH')
  return transaction(() => {
    const existing = rows(true).find(row => agentWorkspacePathKey(row.path) === location)
    if (existing) {
      if (existing.type !== 'user') fail('PATH_COLLISION')
      return { workspace: existing, created: false }
    }
    return { workspace: insert(name ?? (path.basename(location) || location), location, 'user'), created: true }
  })
}
export function updateAgentWorkspace(id: string, request: UpdateAgentWorkspace): AgentWorkspace {
  const input = strictObject(request, ['name']), name = text(input.name, 'NAME')
  return transaction(() => {
    lookup(id)
    getDatabase().run("UPDATE agent_workspaces SET name=?,updated_at=? WHERE id=? AND type='user'", [name, new Date().toISOString(), id])
    return lookup(id)
  })
}
export function reorderAgentWorkspace(id: string, request: AgentWorkspaceOrder): AgentWorkspace {
  const input = strictObject(request, ['before', 'after', 'position'])
  if (Object.keys(input).length !== 1) fail('INVALID_ORDER')
  if ('position' in input && input.position !== 'first' && input.position !== 'last') fail('INVALID_ORDER')
  const anchor = 'before' in input ? text(input.before, 'ID') : 'after' in input ? text(input.after, 'ID') : undefined
  return transaction(() => {
    lookup(id); if (anchor) lookup(anchor)
    if (anchor === id) return lookup(id)
    const scope = rows().filter(row => row.id !== id)
    const index = anchor ? scope.findIndex(row => row.id === anchor) + ('after' in input ? 1 : 0) : input.position === 'first' ? 0 : scope.length
    let before = scope[index - 1]?.orderKey ?? null, after = scope[index]?.orderKey ?? null
    if (!hasRoomBetween(before, after)) {
      const keys = evenlySpacedKeys(scope.length)
      scope.forEach((row, i) => { row.orderKey = keys[i]; getDatabase().run('UPDATE agent_workspaces SET order_key=? WHERE id=?', [keys[i], row.id]) })
      before = scope[index - 1]?.orderKey ?? null; after = scope[index]?.orderKey ?? null
    }
    getDatabase().run('UPDATE agent_workspaces SET order_key=?,updated_at=? WHERE id=?', [orderKeyBetween(before, after), new Date().toISOString(), id])
    return lookup(id)
  })
}
export function deleteAgentWorkspace(id: string): void {
  transaction(() => {
    lookup(id)
    // Existing owned metadata is an explicit reference, NOT evidence to infer rows.
    // Malformed JSON fails closed rather than permitting deletion through ambiguity.
    const db = getDatabase()
    if (db.exec('SELECT 1 FROM agent_sessions WHERE NOT json_valid(data_json) LIMIT 1')[0]?.values.length) fail('REFERENCES_UNREADABLE')
    if (db.exec("SELECT 1 FROM agent_sessions WHERE json_extract(data_json,'$.agentSession.workspace.workspaceId')=? LIMIT 1", [id])[0]?.values.length) fail('REFERENCED')
    db.run("DELETE FROM agent_workspaces WHERE id=? AND type='user'", [id])
    // No filesystem deletion, ever. FK references also reject this statement.
  })
}
/** Reject symlinks/junctions in EVERY existing component, including userData ancestors.
 * Missing components are allowed for allocation only; no write here.
 */
function checkComponents(target: string, allowMissing: boolean): void {
  const root = path.parse(target).root
  let current = root
  for (const part of ['', ...target.slice(root.length).split(path.sep).filter(Boolean)]) {
    if (part) current = path.join(current, part)
    try {
      const stat = fs.lstatSync(current)
      if (stat.isSymbolicLink() || !stat.isDirectory()) fail('UNSAFE_SYSTEM_PATH')
    } catch (error) {
      if (allowMissing && (error as NodeJS.ErrnoException).code === 'ENOENT') continue
      throw error
    }
  }
}
function systemPath(sessionId: unknown, createdAt: unknown): string {
  const id = text(sessionId, 'SESSION_ID')
  if (!/^[a-zA-Z0-9_-]+$/.test(id) || id.length > 128 || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(id)) fail('INVALID_SESSION_ID')
  if (typeof createdAt !== 'number' || !Number.isFinite(createdAt)) fail('INVALID_DATE')
  const date = new Date(createdAt)
  if (!Number.isFinite(date.getTime()) || date.getUTCFullYear() < 1000 || date.getUTCFullYear() > 9999) fail('INVALID_DATE')
  const managed = managedRoot(), root = path.join(managed, 'agent-workspaces')
  const target = path.join(root, date.toISOString().slice(0, 10), id)
  if (!sameOrInside(target, root) || target === root) fail('UNSAFE_SYSTEM_PATH')
  checkComponents(target, true)
  return agentWorkspacePathKey(target)
}
/** Main-derived allocation ONLY. Does not create a directory or attach a session. */
export function allocateSystemAgentWorkspace(input: { sessionId: string; createdAt: number }): AgentWorkspace {
  return transaction(() => allocateSystemAgentWorkspaceTx(input))
}
/** Main-internal DB-only source createSystemWorkspaceForSessionTx adaptation.
 * Caller owns BEGIN/COMMIT/save; never mkdir or open a nested transaction.
 */
export function allocateSystemAgentWorkspaceTx(input: { sessionId: string; createdAt: number }): AgentWorkspace {
  const request = strictObject(input, ['sessionId', 'createdAt'])
  const target = systemPath(request.sessionId, request.createdAt)
  if (rows(true).some(row => agentWorkspacePathKey(row.path) === target)) fail('PATH_COLLISION')
  return insert(path.basename(target), target, 'system')
}
/** Revalidate the real user directory at session binding, not just registration. */
export function validateUserAgentWorkspaceInternal(id: string): AgentWorkspace {
  const row = lookup(id)
  if (directory(row.path) !== agentWorkspacePathKey(row.path)) fail('DIRECTORY_CHANGED')
  const managed = managedRoot()
  if (sameOrInside(row.path, managed) || sameOrInside(row.path, directory(managed))) fail('MANAGED_PATH')
  return row
}
/** Main-internal caller-owned transaction; drop registration only, NEVER files. */
export function deleteSystemAgentWorkspaceTx(id: string): void {
  const row = lookup(id, true)
  if (row.type !== 'system') fail('SYSTEM_REQUIRED')
  getDatabase().run("DELETE FROM agent_workspaces WHERE id=? AND type='system'", [id])
}
/** Explicit prerequisite for future runtime launch, not called automatically anywhere. */
export function prepareSystemAgentWorkspace(id: string): AgentWorkspace {
  const row = lookup(id, true)
  if (row.type !== 'system') fail('SYSTEM_REQUIRED')
  const relative = path.relative(agentWorkspacePathKey(path.join(managedRoot(), 'agent-workspaces')), row.path)
  const parts = relative.split(path.sep)
  if (parts.length !== 2 || !/^\d{4}-\d{2}-\d{2}$/.test(parts[0])) fail('UNSAFE_SYSTEM_PATH')
  const expected = systemPath(parts[1], Date.parse(parts[0] + 'T00:00:00.000Z'))
  if (expected !== row.path) fail('UNSAFE_SYSTEM_PATH')
  checkComponents(row.path, true)
  const root = path.parse(row.path).root
  let current = root
  for (const part of row.path.slice(root.length).split(path.sep).filter(Boolean)) {
    current = path.join(current, part)
    // Only create below userData, never repair/create its ancestors.
    if (!fs.existsSync(current)) {
      if (!sameOrInside(current, path.join(managedRoot(), 'agent-workspaces'))) fail('UNSAFE_SYSTEM_PATH')
      checkComponents(path.dirname(current), false)
      try { fs.mkdirSync(current) } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error }
    }
    checkComponents(current, false)
  }
  directory(row.path)
  return row
}
