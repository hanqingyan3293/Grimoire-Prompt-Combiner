import http from 'node:http'
import crypto from 'node:crypto'

import { chatStream, createClient } from '../ai/client'
import { getActiveProvider } from '../ipc/providers.ipc'

// Local OpenAI-compatible gateway (M3).
//
// Why this exists: the `/settings/api-gateway` page publishes an endpoint other tools can point at
// (``base_url = http://127.0.0.1:<port>/v1``). Until now the page was read-only because nothing
// listened. This server forwards to the ACTIVE provider through the same client the app uses, so
// there is one request path, one credential store, and no second copy of provider settings.
export type GatewayStatus = { running: boolean; host: string; port: number; apiKeyConfigured: boolean; error?: string }

export interface GatewayConfig { readonly host: string; readonly port: number; readonly apiKey: string }

let server: http.Server | null = null
let current: GatewayStatus = { running: false, host: '127.0.0.1', port: 0, apiKeyConfigured: false }

export function getGatewayStatus(): GatewayStatus { return { ...current } }

function unauthorized(res: http.ServerResponse): void {
  res.writeHead(401, { 'content-type': 'application/json' })
  res.end(JSON.stringify({ error: { message: 'invalid api key', type: 'authentication_error' } }))
}

function json(res: http.ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json' })
  res.end(JSON.stringify(body))
}

async function readBody(req: http.IncomingMessage, limit = 1_000_000): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    let size = 0
    const chunks: Buffer[] = []
    req.on('data', chunk => {
      size += chunk.length
      if (size > limit) { reject(new Error('payload too large')); req.destroy(); return }
      chunks.push(chunk)
    })
    req.on('end', () => {
      try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}) }
      catch (error) { reject(error instanceof Error ? error : new Error(String(error))) }
    })
    req.on('error', reject)
  })
}

function messagesOf(body: Record<string, unknown>): Array<{ role: string; content: string }> {
  const raw = Array.isArray(body.messages) ? body.messages : []
  return raw
    .filter((item): item is Record<string, unknown> => !!item && typeof item === 'object')
    .map(item => ({ role: String(item.role ?? 'user'), content: typeof item.content === 'string' ? item.content : JSON.stringify(item.content ?? '') }))
}

export async function handleGatewayRequest(req: http.IncomingMessage, res: http.ServerResponse, config: GatewayConfig): Promise<void> {
  const header = String(req.headers.authorization || '')
  const token = header.startsWith('Bearer ') ? header.slice(7) : ''
  if (!config.apiKey || token !== config.apiKey) return unauthorized(res)
  if (req.method === 'GET' && (req.url === '/health' || req.url === '/v1/health')) return json(res, 200, { ok: true })
  if (req.method === 'GET' && req.url === '/v1/models') {
    const provider = await getActiveProvider()
    const models = Array.isArray(provider?.models) ? provider!.models : provider?.default_model ? [provider.default_model] : []
    return json(res, 200, { object: 'list', data: models.map(id => ({ id, object: 'model', owned_by: 'grimoire' })) })
  }
  if (req.method !== 'POST' || req.url !== '/v1/chat/completions') return json(res, 404, { error: { message: 'not found' } })
  const provider = await getActiveProvider()
  if (!provider) return json(res, 503, { error: { message: 'no active provider configured', type: 'unavailable' } })
  let body: Record<string, unknown>
  try { body = await readBody(req) } catch (error) { return json(res, 400, { error: { message: String(error) } }) }
  const model = typeof body.model === 'string' && body.model ? body.model : provider.default_model || ''
  if (!model) return json(res, 400, { error: { message: 'model is required' } })
  // `getActiveProvider` returns the decrypted key at runtime even though `Provider` types it as
  // `has_api_key`; the send path casts the same way.
  const withSecret = provider as typeof provider & { api_key?: string }
  const client = createClient({ base_url: provider.base_url, api_key: withSecret.api_key || '', protocol: provider.protocol })
  const messages = messagesOf(body)
  try {
    if (body.stream === true) {
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' })
      for await (const chunk of chatStream(client, model, messages)) {
        if (!chunk.text) continue
        res.write('data: ' + JSON.stringify({ id: 'chatcmpl-grimoire', object: 'chat.completion.chunk', created: Math.floor(Date.now() / 1000), model, choices: [{ index: 0, delta: { content: chunk.text }, finish_reason: null }] }) + '\n\n')
      }
      res.write('data: [DONE]\n\n')
      res.end()
      return
    }
    const completion = await client.chat.completions.create({ model, messages: messages as never })
    return json(res, 200, { ...completion, grimoire: { gateway: true } })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    // A streaming response may already have sent headers; writing a JSON body now would throw and
    // hide the real upstream error behind an ERR_HTTP_HEADERS_SENT stack.
    if (res.headersSent) { res.end(); return }
    return json(res, 502, { error: { message, type: 'upstream_error' } })
  }
}

export async function startGateway(input: { host?: string; port?: number; apiKey?: string }): Promise<GatewayStatus> {
  if (server) return getGatewayStatus()
  const host = input.host || '127.0.0.1'
  const port = Number.isInteger(input.port) && Number(input.port) > 0 ? Number(input.port) : 0
  const config: GatewayConfig = { host, port, apiKey: input.apiKey || crypto.randomUUID().replaceAll('-', '') }
  const created = http.createServer((req, res) => { void handleGatewayRequest(req, res, config) })
  await new Promise<void>((resolve, reject) => {
    created.once('error', error => reject(error))
    created.listen(port, host, () => resolve())
  })
  const address = created.address()
  const boundPort = typeof address === 'object' && address ? address.port : port
  server = created
  current = { running: true, host, port: boundPort, apiKeyConfigured: Boolean(config.apiKey) }
  return getGatewayStatus()
}

export async function stopGateway(): Promise<GatewayStatus> {
  const active = server
  server = null
  current = { ...current, running: false }
  if (active) await new Promise<void>(resolve => active.close(() => resolve()))
  return getGatewayStatus()
}

export async function restartGateway(input: { host?: string; port?: number; apiKey?: string }): Promise<GatewayStatus> {
  await stopGateway()
  return startGateway(input)
}
