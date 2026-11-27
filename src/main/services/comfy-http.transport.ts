/**
 * Adapted from Cherry Studio 2.1.4 remoteFetch.ts (AGPL-3.0-only).
 * Original source remains read-only under src/vendor/cherry/source.
 * Retains its direct connector, pinned lookup, headers, streaming and
 * settlement structure; Comfy adds strict all-answer DNS, POST/binary reads,
 * same-origin redirects, one owned deadline and typed domain errors.
 * See .agent/records/2026-11-06-sol-execution/C2-codex.md for reuse decisions.
 */
import { lookup } from 'node:dns/promises'
import { request as httpRequest, type IncomingHttpHeaders, type IncomingMessage, type ClientRequest } from 'node:http'
import { request as httpsRequest, type RequestOptions } from 'node:https'
import { isIP, type LookupFunction } from 'node:net'
import { classifyComfyIpAddress } from '../../integrations/cherry/comfy-source-loader'
import { requireComfyAddress, requireComfyRequestUrl } from './input-validation'
import { ComfyUIError, readComfyAbortError } from './comfy-error'

export const COMFY_REQUEST_TIMEOUT_MS = 30_000
export const COMFY_JSON_MAX_BYTES = 10 * 1024 * 1024
export const COMFY_IMAGE_MAX_BYTES = 100 * 1024 * 1024
const REDIRECT_STATUS_CODES = new Set([301, 302, 303, 307, 308])
const PERMANENT_TLS_CODES = new Set(['ERR_TLS_CERT_ALTNAME_INVALID', 'CERT_HAS_EXPIRED', 'DEPTH_ZERO_SELF_SIGNED_CERT', 'SELF_SIGNED_CERT_IN_CHAIN', 'UNABLE_TO_VERIFY_LEAF_SIGNATURE'])

type Target = { url: string; address: { address: string; family: 4 | 6 } }
type Options = { method?: string; headers?: HeadersInit; body?: string | Uint8Array; signal?: AbortSignal; timeoutMs?: number; maxBytes: number; image: boolean; allowHttpErrors?: boolean }
type BufferedResponse = { status: number; headers: Headers; body: Buffer }

// These header/lookup helpers retain the original remoteFetch structure.
function buildRequestHeaders(headers: HeadersInit | undefined, host: string): Record<string, string> {
  const resolvedHeaders = new Headers(headers)
  resolvedHeaders.set('Host', host)
  return Object.fromEntries(resolvedHeaders.entries())
}
function createLookup(target: Target): LookupFunction {
  return (_hostname, options, callback) => {
    if (options.all) { callback(null, [target.address]); return }
    callback(null, target.address.address, target.address.family)
  }
}
function getRequestHostname(hostname: string): string {
  return hostname.startsWith('[') && hostname.endsWith(']') ? hostname.slice(1, -1) : hostname
}
function isIpLiteralHostname(hostname: string): boolean {
  return hostname.startsWith('[') || /^\d+(?:\.\d+){3}$/.test(hostname)
}
function getRequestOptions(target: Target, options: Options, signal: AbortSignal): RequestOptions {
  const parsedUrl = new URL(target.url)
  const isHttps = parsedUrl.protocol === 'https:'
  return {
    protocol: parsedUrl.protocol,
    hostname: getRequestHostname(parsedUrl.hostname),
    port: parsedUrl.port || (isHttps ? 443 : 80),
    path: parsedUrl.pathname + parsedUrl.search,
    method: options.method || 'GET',
    headers: buildRequestHeaders(options.headers, parsedUrl.host),
    lookup: createLookup(target), agent: false, signal,
    servername: isHttps && !isIpLiteralHostname(parsedUrl.hostname) ? parsedUrl.hostname : undefined,
    rejectUnauthorized: true,
  }
}
function getHeaderValue(headers: IncomingHttpHeaders, name: string): string | undefined {
  const value = headers[name]
  return Array.isArray(value) ? value[0] : value
}
function parseContentLength(headers: IncomingHttpHeaders): number | undefined {
  const length = getHeaderValue(headers, 'content-length')
  if (!length) return undefined
  const parsed = Number(length)
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined
}

function addressError(): ComfyUIError {
  return new ComfyUIError('COMFY_ADDRESS_INVALID', 'ComfyUI 地址或 DNS 结果不符合已配置的网络范围', false)
}
function validateRequestUrl(endpoint: string, raw: string, image: boolean): URL {
  let target: URL
  let base: URL
  try { base = new URL(requireComfyAddress(endpoint)); target = new URL(requireComfyRequestUrl(raw)) } catch { throw addressError() }
  if (target.origin !== base.origin || target.username || target.password) throw addressError()
  if (image && target.pathname !== base.pathname.replace(/\/+$/, '') + '/view') throw new ComfyUIError('COMFY_REDIRECT_INVALID', 'ComfyUI 图片地址不在配置的 view 路由', false)
  return target
}
function abortError(signal: AbortSignal): Error {
  return signal.reason instanceof Error ? signal.reason : readComfyAbortError()
}
// Adapted from the source raceWithAbort; DNS cannot hold a cancelled reader.
function raceWithAbort<T>(operation: Promise<T>, signal: AbortSignal): Promise<T> {
  signal.throwIfAborted()
  return new Promise((resolve, reject) => {
    const cleanup = () => signal.removeEventListener('abort', onAbort)
    const onAbort = () => { cleanup(); reject(abortError(signal)) }
    signal.addEventListener('abort', onAbort, { once: true })
    operation.then(value => { cleanup(); resolve(value) }, error => { cleanup(); reject(error) })
  })
}
async function resolveTarget(url: URL, signal: AbortSignal): Promise<Target> {
  signal.throwIfAborted()
  const host = getRequestHostname(url.hostname).toLowerCase()
  const local = host === 'localhost' || host === '127.0.0.1' || host === '::1'
  const literalFamily = isIP(host)
  const addresses = literalFamily ? [{ address: host, family: literalFamily }] : await raceWithAbort(lookup(host, { all: true }), signal)
  signal.throwIfAborted()
  if (!addresses.length) throw addressError()
  for (const answer of addresses) {
    if ((answer.family !== 4 && answer.family !== 6) || isIP(answer.address) !== answer.family) throw addressError()
    let classification
    try { classification = classifyComfyIpAddress(answer.address) } catch { throw addressError() }
    if (local ? !classification.loopback : !classification.public) throw addressError()
  }
  const first = addresses[0]
  return { url: url.toString(), address: { address: first.address, family: first.family as 4 | 6 } }
}

function responseHeaders(raw: IncomingHttpHeaders): Headers {
  const headers = new Headers()
  for (const [name, value] of Object.entries(raw)) {
    if (Array.isArray(value)) for (const item of value) headers.append(name, item)
    else if (value !== undefined) headers.set(name, String(value))
  }
  return headers
}
async function readFromUrl(endpoint: string, url: URL, options: Options, signal: AbortSignal, redirectsRemaining: number): Promise<BufferedResponse> {
  const target = await resolveTarget(url, signal)
  const requestOptions = getRequestOptions(target, options, signal)
  const request = url.protocol === 'https:' ? httpsRequest : httpRequest
  return new Promise((resolve, reject) => {
    let settled = false
    let clientRequest: ClientRequest | undefined
    let incoming: IncomingMessage | undefined
    let httpFailure: ComfyUIError | undefined
    const cleanup = () => signal.removeEventListener('abort', onAbort)
    const fail = (error: Error) => {
      if (settled) return
      settled = true; cleanup(); incoming?.destroy(); clientRequest?.destroy()
      const failure = error instanceof ComfyUIError && error.code === 'COMFY_RESPONSE_TOO_LARGE' ? error : httpFailure ?? (signal.aborted ? abortError(signal) : error)
      reject(options.signal?.aborted ? readComfyAbortError() : failure)
    }
    const onAbort = () => fail(abortError(signal))
    signal.addEventListener('abort', onAbort, { once: true })
    try {
      signal.throwIfAborted()
      clientRequest = request(requestOptions, response => {
        incoming = response
        const status = response.statusCode || 0
        if (REDIRECT_STATUS_CODES.has(status)) {
          const location = getHeaderValue(response.headers, 'location')
          let next: URL
          try {
            if (!location || redirectsRemaining === 0) throw new Error('Redirect limit')
            next = new URL(location, url)
            if (next.origin !== url.origin || next.username || next.password) throw new Error('Redirect origin')
            validateRequestUrl(endpoint, next.toString(), options.image)
          } catch {
            fail(new ComfyUIError('COMFY_REDIRECT_INVALID', 'ComfyUI 重定向超出已配置的服务或路由', false, status)); return
          }
          let nextOptions = options
          if (status === 303 || ((status === 301 || status === 302) && options.method === 'POST')) {
            const headers = new Headers(options.headers); headers.delete('content-type'); headers.delete('content-length')
            nextOptions = { ...options, method: 'GET', body: undefined, headers }
          }
          settled = true; cleanup(); response.resume(); response.destroy(); clientRequest?.destroy()
          void readFromUrl(endpoint, next, nextOptions, signal, redirectsRemaining - 1).then(resolve, reject)
          return
        }
        if (status < 100 || status > 599) { fail(new ComfyUIError('COMFY_BAD_RESPONSE', 'ComfyUI HTTP 响应无效', false)); return }
        if (!options.allowHttpErrors && (status < 200 || status >= 300)) {
          httpFailure = new ComfyUIError('COMFY_HTTP_' + status, 'ComfyUI HTTP ' + status, status === 429 || status >= 500, status)
          if (!getHeaderValue(response.headers, 'content-type')?.includes('application/json')) { fail(httpFailure); return }
        }
        const length = parseContentLength(response.headers)
        if (length !== undefined && length > options.maxBytes) {
          fail(new ComfyUIError('COMFY_RESPONSE_TOO_LARGE', options.image ? 'ComfyUI 图片过大' : 'ComfyUI 响应过大', false, status)); return
        }
        const chunks: Buffer[] = []
        let totalBytes = 0
        response.on('data', (chunk: Buffer | string) => {
          if (settled) return
          const buffer = typeof chunk === 'string' ? Buffer.from(chunk) : chunk
          totalBytes += buffer.length
          if (totalBytes > options.maxBytes) { fail(new ComfyUIError('COMFY_RESPONSE_TOO_LARGE', options.image ? 'ComfyUI 图片过大' : 'ComfyUI 响应过大', false, status)); return }
          chunks.push(buffer)
        })
        response.on('end', () => {
          if (settled) return
          const body = Buffer.concat(chunks, totalBytes)
          if (httpFailure) {
            try {
              const payload: unknown = JSON.parse(body.toString('utf8'))
              if (payload && typeof payload === 'object' && 'error' in payload && typeof payload.error === 'string' && payload.error) httpFailure = new ComfyUIError(httpFailure.code, payload.error.slice(0, 2000), httpFailure.retryable, status)
            } catch { fail(httpFailure); return }
            fail(httpFailure); return
          }
          settled = true; cleanup()
          resolve({ status, headers: responseHeaders(response.headers), body })
        })
        response.on('aborted', () => fail(new Error('ComfyUI response aborted before completion')))
        response.on('close', () => fail(new Error('ComfyUI response closed before completion')))
        response.on('error', fail)
      })
      clientRequest.on('error', fail)
      clientRequest.end(options.body)
    } catch (error) { fail(error instanceof Error ? error : new Error(String(error))) }
  })
}
function normalizeError(error: unknown, options: Options, controller: AbortController): ComfyUIError {
  if (options.signal?.aborted) return readComfyAbortError()
  if (error instanceof ComfyUIError) return error
  if (controller.signal.aborted) return new ComfyUIError('COMFY_TIMEOUT', options.image ? 'ComfyUI 图片下载超时' : 'ComfyUI 请求超时', true)
  const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : ''
  return new ComfyUIError('COMFY_TRANSPORT_ERROR', error instanceof Error ? error.message : String(error), !PERMANENT_TLS_CODES.has(code))
}
async function requestAndConsume<T>(endpoint: string, raw: string, options: Options, consume: (response: BufferedResponse) => T): Promise<T> {
  if (options.signal?.aborted) throw readComfyAbortError()
  const controller = new AbortController()
  const timeoutMs = options.timeoutMs ?? COMFY_REQUEST_TIMEOUT_MS
  const deadline = Date.now() + timeoutMs
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  const signal = options.signal ? AbortSignal.any([options.signal, controller.signal]) : controller.signal
  try {
    const url = validateRequestUrl(endpoint, raw, options.image)
    const response = await readFromUrl(endpoint, url, options, signal, 3)
    signal.throwIfAborted()
    if (Date.now() >= deadline) throw new ComfyUIError('COMFY_TIMEOUT', 'ComfyUI 请求超时', true)
    const value = consume(response)
    signal.throwIfAborted()
    if (Date.now() >= deadline) throw new ComfyUIError('COMFY_TIMEOUT', 'ComfyUI 请求超时', true)
    return value
  } catch (error) { throw normalizeError(error, options, controller) }
  finally { clearTimeout(timer) }
}
function parseJson<T>(response: BufferedResponse): T {
  try { return JSON.parse(response.body.toString('utf8')) as T }
  catch { throw new ComfyUIError('COMFY_BAD_RESPONSE', 'ComfyUI 返回了无效 JSON', false, response.status) }
}
export function requestComfyJson<T>(endpoint: string, pathname: string, init: RequestInit = {}, timeoutMs = COMFY_REQUEST_TIMEOUT_MS): Promise<T> {
  if (init.body != null && typeof init.body !== 'string') throw new ComfyUIError('COMFY_REQUEST_INVALID', 'ComfyUI JSON 请求体无效', false)
  return requestAndConsume(endpoint, endpoint + pathname, { method: init.method || 'GET', headers: init.headers, body: init.body || undefined, signal: init.signal || undefined, timeoutMs, maxBytes: COMFY_JSON_MAX_BYTES, image: false }, parseJson<T>)
}
export function requestComfyImage(endpoint: string, url: string, signal?: AbortSignal): Promise<Buffer> {
  return requestAndConsume(endpoint, url, { signal, maxBytes: COMFY_IMAGE_MAX_BYTES, image: true }, response => {
    if (!response.body.length) throw new ComfyUIError('COMFY_BAD_RESPONSE', 'ComfyUI 图片响应为空', false, response.status)
    return response.body
  })
}
/** Fetch contract for the unmodified Cherry cancellation/discovery source. */
export function createComfyHttpFetch(endpoint: string): typeof fetch {
  return async (input, init) => {
    const request = new Request(input, init)
    const url = validateRequestUrl(endpoint, request.url, false)
    const image = url.pathname === new URL(endpoint).pathname.replace(/\/+$/, '') + '/view'
    const body = request.body ? new Uint8Array(await request.arrayBuffer()) : undefined
    if (body && body.byteLength > COMFY_IMAGE_MAX_BYTES) throw new ComfyUIError('COMFY_REQUEST_INVALID', 'ComfyUI 请求体超过大小限制', false)
    return requestAndConsume(endpoint, request.url, { method: request.method, headers: request.headers, body, signal: request.signal, maxBytes: image ? COMFY_IMAGE_MAX_BYTES : COMFY_JSON_MAX_BYTES, image, allowHttpErrors: true }, response => {
      if (!image && response.body.length && response.status >= 200 && response.status < 300 && (request.method === 'GET' || response.headers.get('content-type')?.includes('application/json'))) parseJson(response)
      const payload = [204, 205, 304].includes(response.status) || request.method === 'HEAD' ? null : new Uint8Array(response.body)
      return new Response(payload, { status: response.status, headers: response.headers })
    })
  }
}
