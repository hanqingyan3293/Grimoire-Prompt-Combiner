export type ComfyExecutionPhase = 'prepared' | 'submitting' | 'waiting' | 'importing' | 'submit-uncertain'
export type ComfyCancelOutcome = 'none' | 'remote-confirmed' | 'local-only' | 'failed'

export interface ComfyExecutionState {
  version: 1
  endpoint: string
  phase: ComfyExecutionPhase
  requestedPromptId: string | null
  promptId: string | null
  cancelOutcome: ComfyCancelOutcome
}

const PHASES = new Set<ComfyExecutionPhase>(['prepared', 'submitting', 'waiting', 'importing', 'submit-uncertain'])
const CANCEL_OUTCOMES = new Set<ComfyCancelOutcome>(['none', 'remote-confirmed', 'local-only', 'failed'])
const FIELDS = ['version', 'endpoint', 'phase', 'requestedPromptId', 'promptId', 'cancelOutcome'] as const
const CANONICAL_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
const MAX_ENDPOINT_LENGTH = 2048
const MAX_PROMPT_ID_LENGTH = 200

export function requireComfyExecutionEndpoint(value: unknown): string {
  if (typeof value !== 'string' || !value || value.length > MAX_ENDPOINT_LENGTH) throw new Error('Comfy execution endpoint 无效')
  if (value !== value.trim() || /\s/.test(value)) throw new Error('Comfy execution endpoint 不能包含空白')
  if (value.includes('?') || value.includes('#')) throw new Error('Comfy execution endpoint 不能包含 query 或 hash')
  let url: URL
  try { url = new URL(value) } catch { throw new Error('Comfy execution endpoint 格式无效') }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('Comfy execution endpoint 必须使用 HTTP 或 HTTPS')
  if (!url.hostname) throw new Error('Comfy execution endpoint 缺少主机')
  if (url.username || url.password) throw new Error('Comfy execution endpoint 不能包含 credentials')
  if (url.search) throw new Error('Comfy execution endpoint 不能包含 query')
  if (url.hash) throw new Error('Comfy execution endpoint 不能包含 hash')
  return value
}

export function parseComfyExecution(raw: string | null | undefined): ComfyExecutionState | null {
  if (raw == null) return null
  if (typeof raw !== 'string') throw new Error('Comfy execution JSON 必须是文本')
  let value: unknown
  try { value = JSON.parse(raw) } catch { throw new Error('Comfy execution JSON 无效') }
  return validateComfyExecution(value)
}

export function validateComfyExecution(value: unknown): ComfyExecutionState {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Comfy execution 必须是对象')
  const record = value as Record<string, unknown>
  const keys = Object.keys(record)
  if (keys.length !== FIELDS.length || keys.some(key => !FIELDS.includes(key as (typeof FIELDS)[number]))) throw new Error('Comfy execution 字段不匹配')
  if (record.version !== 1) throw new Error('Comfy execution version 必须为 1')
  const endpoint = requireComfyExecutionEndpoint(record.endpoint)
  if (typeof record.phase !== 'string' || !PHASES.has(record.phase as ComfyExecutionPhase)) throw new Error('Comfy execution phase 无效')
  if (typeof record.requestedPromptId !== 'string' || !CANONICAL_UUID.test(record.requestedPromptId)) throw new Error('Comfy execution requestedPromptId 必须是 canonical UUID')
  const promptId = validatePromptId(record.promptId)
  if (typeof record.cancelOutcome !== 'string' || !CANCEL_OUTCOMES.has(record.cancelOutcome as ComfyCancelOutcome)) throw new Error('Comfy execution cancelOutcome 无效')
  const phase = record.phase as ComfyExecutionPhase
  const cancelOutcome = record.cancelOutcome as ComfyCancelOutcome
  if (phase === 'prepared' && promptId !== null) throw new Error('Comfy execution phase prepared 的 promptId 必须为 null')
  if ((phase === 'waiting' || phase === 'importing') && promptId === null) throw new Error('Comfy execution phase ' + phase + ' 的 promptId 不能为空')
  if (cancelOutcome === 'remote-confirmed' && promptId === null) throw new Error('Comfy execution cancelOutcome remote-confirmed 需要真实 promptId')
  return { version: 1, endpoint, phase, requestedPromptId: record.requestedPromptId, promptId, cancelOutcome }
}

export function serializeComfyExecution(state: ComfyExecutionState): string {
  return JSON.stringify(validateComfyExecution(state))
}

function validatePromptId(value: unknown): string | null {
  if (value === null) return null
  if (typeof value !== 'string') throw new Error('Comfy execution promptId 必须是文本或 null')
  if (!value || value.length > MAX_PROMPT_ID_LENGTH || value !== value.trim()) throw new Error('Comfy execution promptId 无效')
  if (/[\u0000-\u001f\u007f]/.test(value)) throw new Error('Comfy execution promptId 含控制字符')
  return value
}
