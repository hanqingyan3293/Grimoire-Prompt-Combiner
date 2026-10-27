import crypto from 'node:crypto'
import { getDatabase, saveDatabase } from '../database'

export const RUNTIME_REFERENCE_KEY = '__runtimeExecution'
export type RuntimeExecutionIdentity = {
  runtime: 'pi' | 'opencode'
  driver: 'pi-rpc' | 'pi-sdk' | 'opencode-legacy'
  owner: string
  directory: string
  binaryVersion: string
  configFingerprint: string
}
export type RuntimeExecutionReference = RuntimeExecutionIdentity & { version: 1; nativeId?: string; state: 'settled' | 'running' }
export type RuntimeReferenceStore = 'ai' | 'agent'

export function runtimeConfigFingerprint(input: Record<string, unknown>): string {
  const sorted = Object.fromEntries(Object.entries(input).sort(([a], [b]) => a.localeCompare(b)))
  return crypto.createHash('sha256').update(JSON.stringify(sorted)).digest('hex')
}

export function publicRuntimeMetadata(data: Record<string, unknown>): Record<string, unknown> {
  const next = { ...data }
  delete next[RUNTIME_REFERENCE_KEY]
  return next
}

export function preserveRuntimeMetadata(current: Record<string, unknown>, replacement: Record<string, unknown>): Record<string, unknown> {
  if (Object.hasOwn(replacement, RUNTIME_REFERENCE_KEY)) throw new Error('RUNTIME_REFERENCE_MAIN_OWNED')
  return Object.hasOwn(current, RUNTIME_REFERENCE_KEY) ? { ...replacement, [RUNTIME_REFERENCE_KEY]: current[RUNTIME_REFERENCE_KEY] } : replacement
}

function location(store: RuntimeReferenceStore) {
  return store === 'ai' ? { table: 'ai_sessions', column: 'metadata_json' } : { table: 'agent_sessions', column: 'data_json' }
}
function read(store: RuntimeReferenceStore, id: string): { data: Record<string, unknown>; runtime: string } {
  const { table, column } = location(store)
  const row = getDatabase().exec(`SELECT ${column},runtime FROM ${table} WHERE id=?`, [id])[0]?.values?.[0]
  if (!row) throw new Error('RUNTIME_REFERENCE_SESSION_NOT_FOUND')
  let data: Record<string, unknown> = {}
  try { const value = JSON.parse(String(row[0] || '{}')); if (value && typeof value === 'object' && !Array.isArray(value)) data = value } catch {}
  return { data, runtime: String(row[1]) }
}

function validNativeId(identity: RuntimeExecutionIdentity, nativeId: unknown): nativeId is string {
  if (typeof nativeId !== 'string' || !nativeId || /[\u0000-\u001f\u007f]/.test(nativeId)) return false
  if (identity.driver === 'pi-sdk') {
    if (nativeId.length > 32_768) return false
    try {
      const value = JSON.parse(nativeId) as Record<string, unknown>
      return value.schema === 1 && value.ownerId === identity.owner && typeof value.localSessionId === 'string' && typeof value.checkpointId === 'string'
    } catch { return false }
  }
  return nativeId.length <= 256 && !/[/\\]/.test(nativeId)
}

function writeReference(store: RuntimeReferenceStore, id: string, identity: RuntimeExecutionIdentity, nativeId: string | undefined, state: 'settled' | 'running'): void {
  const { data, runtime } = read(store, id)
  if (runtime !== identity.runtime || identity.owner !== store + ':' + id) throw new Error('RUNTIME_REFERENCE_OWNER_MISMATCH')
  if (nativeId !== undefined && !validNativeId(identity, nativeId)) throw new Error('RUNTIME_REFERENCE_INVALID_NATIVE_ID')
  const reference: RuntimeExecutionReference = { ...identity, version: 1, ...(nativeId ? { nativeId } : {}), state }
  const { table, column } = location(store)
  getDatabase().run(`UPDATE ${table} SET ${column}=?,updated_at=? WHERE id=?`, [JSON.stringify({ ...data, [RUNTIME_REFERENCE_KEY]: reference }), new Date().toISOString(), id])
  saveDatabase()
}

/** Only a settled runtime and committed host history may publish a resumable checkpoint. */
export function attachRuntimeExecutionReference(store: RuntimeReferenceStore, id: string, identity: RuntimeExecutionIdentity, nativeId: string): void {
  writeReference(store, id, identity, nativeId, 'settled')
}

/** A crash/abort cannot silently reuse the last checkpoint after native history changed. */
export function beginRuntimeExecution(store: RuntimeReferenceStore, id: string, identity: RuntimeExecutionIdentity): void {
  writeReference(store, id, identity, undefined, 'running')
}

export function beginRuntimeExecutionReference(store: RuntimeReferenceStore, id: string, identity: RuntimeExecutionIdentity): void {
  const { data, runtime } = read(store, id)
  if (runtime !== identity.runtime || identity.owner !== store + ':' + id) throw new Error('RUNTIME_REFERENCE_OWNER_MISMATCH')
  const raw = data[RUNTIME_REFERENCE_KEY]
  if (!raw) {
    writeReference(store, id, identity, undefined, 'running')
    return
  }
  if (typeof raw !== 'object' || Array.isArray(raw)) throw new Error('RUNTIME_REFERENCE_INVALID')
  const reference = raw as RuntimeExecutionReference
  if (reference.version !== 1 || reference.owner !== identity.owner || reference.configFingerprint !== identity.configFingerprint) throw new Error('RUNTIME_REFERENCE_CONFIG_CHANGED')
  writeReference(store, id, identity, reference.nativeId, 'running')
}

export function resolveRuntimeExecutionReference(store: RuntimeReferenceStore, id: string, identity: RuntimeExecutionIdentity): string | undefined {
  const { data, runtime } = read(store, id)
  const raw = data[RUNTIME_REFERENCE_KEY]
  if (!raw) return undefined // Legacy bare runtimeSessionId is not provenance and is never adopted.
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('RUNTIME_REFERENCE_INVALID')
  const reference = raw as RuntimeExecutionReference
  if (reference.version !== 1 || runtime !== identity.runtime || identity.owner !== store + ':' + id) throw new Error('RUNTIME_REFERENCE_OWNER_MISMATCH')
  for (const field of ['runtime', 'driver', 'owner', 'directory', 'binaryVersion', 'configFingerprint'] as const) {
    if (reference[field] !== identity[field]) throw new Error('RUNTIME_REFERENCE_CONFIG_CHANGED')
  }
  if (reference.state !== 'settled') throw new Error('RUNTIME_REFERENCE_UNSETTLED')
  if (!validNativeId(identity, reference.nativeId)) throw new Error('RUNTIME_REFERENCE_INVALID')
  return reference.nativeId
}

export function clearRuntimeExecutionReference(store: RuntimeReferenceStore, id: string): void {
  const { data } = read(store, id)
  const { table, column } = location(store)
  getDatabase().run(`UPDATE ${table} SET ${column}=? WHERE id=?`, [JSON.stringify(publicRuntimeMetadata(data)), id])
  saveDatabase()
}
