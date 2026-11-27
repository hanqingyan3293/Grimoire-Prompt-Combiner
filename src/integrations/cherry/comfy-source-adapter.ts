import { logEvent } from '../../main/services/logger.service'
import { requireComfyAddress } from '../../main/services/input-validation'
import { createComfyHttpFetch } from '../../main/services/comfy-http.transport'
import { ComfyUIError, readComfyAbortError } from '../../main/services/comfy-error'
import { loadComfySourceBundle } from './comfy-source-loader'
import { setComfySourceBridge, type ComfySourceLogLevel } from './comfy-source-bridge'

export type ComfyCancelOutcome = 'remote-confirmed' | 'local-only' | 'failed'

export interface ComfyCancelWrite {
  path: string
  method: string
  ok: boolean
  status: number | null
  promptId?: string
  error?: string
}

export interface ComfyCancelResult {
  outcome: ComfyCancelOutcome
  targetedInterrupt: boolean
  version: string | null
  evidence: 'execution_interrupted' | 'completed' | 'none'
  writes: ComfyCancelWrite[]
}

interface ComfySourceTransport {
  cancel(taskId: string): Promise<void>
}

interface ComfySourceModule {
  createComfyuiTransport(settings: { baseURL: string; fetch: typeof fetch; headers?: Record<string, string> }): ComfySourceTransport
  parseVersion(value: string): [number, number, number] | null
  waitWithSignal(delayMs: number, signal?: AbortSignal): Promise<void>
}

export function loadComfySource(): ComfySourceModule {
  configureSourceBridge()
  return loadComfySourceBundle<ComfySourceModule>()
}

/** Original Cherry polling wait, exported by the bundle-only source boundary. */
export function waitForComfyPoll(delayMs: number, signal?: AbortSignal): Promise<void> {
  return loadComfySource().waitWithSignal(delayMs, signal)
}

function configureSourceBridge(): void {
  setComfySourceBridge({
    log(level: ComfySourceLogLevel, context: string, message: string) {
      logEvent(level === 'error' ? 'error' : level === 'info' ? 'info' : level === 'debug' ? 'debug' : 'warn', 'comfyui-cancel', context + ': ' + message, { errorCode: 'COMFY_CANCEL_SOURCE', retryable: false })
    },
    t(key: string, params: Record<string, string | number> = {}) {
      return key + (Object.keys(params).length ? ' ' + JSON.stringify(params) : '')
    },
  })
}

interface ObservedWrite extends ComfyCancelWrite {
  apiPath: string | null
  requestBody: Record<string, unknown> | null
}

/**
 * Cancel one owned prompt through the read-only Cherry transport.
 *
 * The source intentionally swallows non-OK/exception results from its
 * cancellation writes. Grimoire therefore observes the injected fetch and
 * classifies the outcome from what the service actually answered:
 *   - remote-confirmed needs a same-id execution_interrupted history record,
 *   - a 200/void write or a missing queue/history entry is not proof,
 *   - an old/unknown/rc/build version never receives an interrupt.
 */
export async function cancelComfyExecution(input: {
  endpoint: string
  promptId: string
  fetchImpl?: typeof fetch
}): Promise<ComfyCancelResult> {
  const endpoint = requireComfyAddress(input.endpoint, 'ComfyUI 地址')
  const promptId = String(input.promptId || '').trim()
  if (!promptId || promptId.length > 200) throw new Error('ComfyUI 取消需要真实 prompt ID')
  const source = loadComfySource()
  const doFetch = input.fetchImpl ?? createComfyHttpFetch(endpoint)
  const base = new URL(endpoint)
  const prefix = base.pathname.replace(/\/+$/, '')
  const observation: { version: string | null } = { version: null }
  const writes: ObservedWrite[] = []
  const controller = new AbortController()
  const active = new Set<Promise<Response>>()
  let closed = false

  const observeResponse: typeof fetch = async (request, init = {}) => {
    const url = new URL(typeof request === 'string' ? request : request instanceof URL ? request.toString() : request.url)
    const apiPath = url.origin === base.origin && url.pathname.startsWith(prefix + '/') ? url.pathname.slice(prefix.length) : null
    const method = String(init.method || 'GET').toUpperCase()
    const body = parseJsonBody(init.body)
    try {
      const callerSignal = init.signal || (request instanceof Request ? request.signal : undefined)
      const signal = callerSignal ? AbortSignal.any([callerSignal, controller.signal]) : controller.signal
      const response = await doFetch(request, { ...init, signal })
      writes.push({
        path: url.pathname,
        apiPath,
        method,
        ok: response.ok,
        status: response.status,
        promptId: body && typeof body.prompt_id === 'string' ? body.prompt_id : undefined,
        requestBody: body,
      })
      if (method === 'GET' && apiPath === '/system_stats' && response.ok) {
        // Observe the exact response used by the source gate, not a second
        // version probe that could refer to a different server revision.
        try {
          const payload = await response.clone().json() as { system?: { comfyui_version?: unknown } } | null
          observation.version = typeof payload?.system?.comfyui_version === 'string' ? payload.system.comfyui_version : null
        } catch (error) {
          logEvent('warn', 'comfyui-cancel', 'Cancellation version observation failed', { context: error instanceof Error ? error.message : String(error), errorCode: 'COMFY_CANCEL_VERSION_UNKNOWN', retryable: false })
        }
      }
      return response
    } catch (error) {
      writes.push({
        path: url.pathname,
        apiPath,
        method,
        ok: false,
        status: error instanceof ComfyUIError ? error.status ?? null : null,
        promptId: body && typeof body.prompt_id === 'string' ? body.prompt_id : undefined,
        error: error instanceof Error ? error.message : String(error),
        requestBody: body,
      })
      throw error
    }
  }

  const observedFetch: typeof fetch = (request, init) => {
    if (closed) return Promise.reject(readComfyAbortError())
    const operation = observeResponse(request, init)
    active.add(operation)
    void operation.then(() => active.delete(operation), () => active.delete(operation))
    return operation
  }

  const transport = source.createComfyuiTransport({ baseURL: endpoint, fetch: observedFetch })
  let cancelError: string | null = null
  let evidence: 'execution_interrupted' | 'completed' | 'none' = 'none'
  try {
    try { await transport.cancel(promptId) }
    catch (error) { cancelError = error instanceof Error ? error.message : String(error) }
    evidence = await readHistoryEvidence(observedFetch, endpoint, promptId)
  } finally {
    // Source cancelAction starts a diagnostic GET after its writes settle.
    // Keep its genuine source behavior, then abort and drain this operation's
    // remaining requests so stopAndWait cannot leave a background reader.
    closed = true
    controller.abort(readComfyAbortError())
    while (active.size) await Promise.allSettled([...active])
  }

  const version = observation.version
  const parsedVersion = version ? source.parseVersion(version) : null
  const targetedInterrupt = parsedVersion ? atLeast(parsedVersion, [0, 3, 57]) : false
  const interrupt = writes.find(write => write.method === 'POST' && write.apiPath === '/interrupt' && write.promptId === promptId)
  const dequeue = writes.find(write => write.method === 'POST' && write.apiPath === '/queue' && ownsDelete(write.requestBody, promptId))

  const publicWrites: ComfyCancelWrite[] = writes
    .filter(write => write.method === 'POST' && (write.apiPath === '/queue' || write.apiPath === '/interrupt'))
    .map(write => ({ path: write.path, method: write.method, ok: write.ok, status: write.status, promptId: write.promptId, error: write.error }))

  let outcome: ComfyCancelOutcome
  if (targetedInterrupt && interrupt?.ok && evidence === 'execution_interrupted') outcome = 'remote-confirmed'
  else if (cancelError || (dequeue && !dequeue.ok) || (interrupt && !interrupt.ok)) outcome = 'failed'
  else outcome = 'local-only'

  logEvent(outcome === 'remote-confirmed' ? 'info' : 'warn', 'comfyui-cancel', 'ComfyUI cancellation observed', {
    errorCode: 'COMFY_CANCEL_' + outcome.toUpperCase().replaceAll('-', '_'),
    context: 'endpoint=' + endpoint + '; promptId=' + promptId + '; version=' + String(version) + '; targeted=' + targetedInterrupt + '; evidence=' + evidence + '; writes=' + JSON.stringify(publicWrites),
    retryable: false,
  })
  return { outcome, targetedInterrupt, version, evidence, writes: publicWrites }
}

function atLeast(value: [number, number, number], minimum: readonly [number, number, number]): boolean {
  for (let index = 0; index < 3; index++) {
    if (value[index] > minimum[index]) return true
    if (value[index] < minimum[index]) return false
  }
  return true
}

function parseJsonBody(body: BodyInit | null | undefined): Record<string, unknown> | null {
  if (typeof body !== 'string') return null
  try {
    const value = JSON.parse(body)
    return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
  } catch { return null }
}

function ownsDelete(body: Record<string, unknown> | null, promptId: string): boolean {
  return Array.isArray(body?.delete) && body.delete.includes(promptId)
}

async function readHistoryEvidence(doFetch: typeof fetch, endpoint: string, promptId: string): Promise<'execution_interrupted' | 'completed' | 'none'> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 3000)
  try {
    const response = await doFetch(endpoint + '/history/' + encodeURIComponent(promptId), { signal: controller.signal })
    if (!response.ok) return 'none'
    const payload = await response.json() as Record<string, unknown>
    const entry = payload[promptId]
    if (!entry || typeof entry !== 'object') return 'none'
    const record = entry as Record<string, unknown>
    if (containsInterrupted(record.status, promptId)) return 'execution_interrupted'
    if (record.status && typeof record.status === 'object' && (record.status as Record<string, unknown>).status_str === 'success'
      && record.outputs && typeof record.outputs === 'object' && !Array.isArray(record.outputs) && Object.keys(record.outputs as Record<string, unknown>).length > 0) return 'completed'
    return 'none'
  } catch {
    return 'none'
  } finally {
    clearTimeout(timer)
  }
}

function containsInterrupted(value: unknown, promptId: string): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const status = value as Record<string, unknown>
  if (status.status_str !== 'error' || !Array.isArray(status.messages)) return false
  return status.messages.some(event => {
    if (!Array.isArray(event) || event.length !== 2 || event[0] !== 'execution_interrupted') return false
    const payload = event[1]
    return payload != null && typeof payload === 'object' && !Array.isArray(payload)
      && (payload as Record<string, unknown>).prompt_id === promptId
  })
}
