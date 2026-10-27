// Probe OpenCode 1.18.34 v2 durable prompt, event stream and finite history.
// Local fake provider only; no credentials or external requests.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'
import net from 'node:net'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const executable = process.env.GRIMOIRE_OPENCODE_EXE || path.join(root, 'resources/agent-runtimes/opencode/opencode.exe')
const isolated = fs.mkdtempSync(path.join(os.tmpdir(), 'grimoire-opencode-replay-'))
const cwd = path.join(isolated, 'workspace')
fs.mkdirSync(cwd, { recursive: true })
let provider
let server
let child
let stderr = ''
const providerRequests = []
const delay = ms => new Promise(resolve => setTimeout(resolve, ms))
async function listen(value) { await new Promise((resolve, reject) => { value.once('error', reject); value.listen(0, '127.0.0.1', resolve) }); return value.address().port }
async function waitForHealth(endpoint) { for (let i = 0; i < 120; i++) { try { const r = await fetch(endpoint + '/api/health'); if (r.ok && (await r.json()).healthy) return } catch {} await delay(250) }; throw new Error('health timeout: ' + stderr) }
async function readSse(response, limit = 30) {
  if (!response.body) return []
  const reader = response.body.getReader(); const decoder = new TextDecoder(); const records = []
  try {
    let buffer = ''
    while (records.length < limit) {
      const next = await Promise.race([reader.read(), delay(12_000).then(() => ({ timeout: true }))])
      if (next.timeout || next.done) break
      buffer += decoder.decode(next.value)
      const chunks = buffer.split(/\r?\n\r?\n/); buffer = chunks.pop() || ''
      for (const chunk of chunks) {
        const data = chunk.split(/\r?\n/).filter(line => line.startsWith('data:')).map(line => line.slice(5).trim()).join('\n')
        if (data && data !== '[DONE]') { try { records.push(JSON.parse(data)) } catch {} }
      }
    }
    return records
  } finally { await reader.cancel().catch(() => {}) }
}
try {
  provider = http.createServer(async (request, response) => {
    if (request.url === '/v1/chat/completions' && request.method === 'POST') {
      let raw = ''
      for await (const chunk of request) raw += chunk
      providerRequests.push(JSON.parse(raw))
      response.writeHead(200, { 'content-type': 'text/event-stream' })
      response.end('data: {"id":"replay","object":"chat.completion.chunk","created":1,"model":"gpt-smoke","choices":[{"index":0,"delta":{"role":"assistant","content":"replay ok"},"finish_reason":null}]}\n\ndata: {"id":"replay","object":"chat.completion.chunk","created":1,"model":"gpt-smoke","choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n')
      return
    }
    if (request.url === '/v1/models') { response.writeHead(200, { 'content-type': 'application/json' }); response.end(JSON.stringify({ data: [{ id: 'gpt-smoke' }] })); return }
    response.writeHead(404); response.end()
  })
  const providerPort = await listen(provider)
  const configDir = path.join(isolated, 'config'); fs.mkdirSync(configDir)
  const configPath = path.join(configDir, 'opencode.json')
  fs.writeFileSync(configPath, JSON.stringify({ $schema: 'https://opencode.ai/config.json', model: 'grimoire/gpt-smoke', provider: { grimoire: { npm: '@ai-sdk/openai-compatible', options: { baseURL: `http://127.0.0.1:${providerPort}/v1`, apiKey: 'local-only' }, models: { 'gpt-smoke': { id: 'gpt-smoke', name: 'gpt-smoke', tool_call: true } } } } }))
  server = net.createServer(); const port = await listen(server); await new Promise(resolve => server.close(resolve))
  child = spawn(executable, ['serve', '--pure', '--hostname=127.0.0.1', '--port=' + port], { cwd, env: { ...process.env, OPENCODE_CONFIG: configPath, OPENCODE_DISABLE_MODELS_FETCH: 'true', OPENCODE_DISABLE_AUTOUPDATE: 'true', OPENCODE_DISABLE_PROJECT_CONFIG: 'true' }, stdio: ['pipe', 'ignore', 'pipe'], windowsHide: true })
  child.stderr.on('data', chunk => { stderr = (stderr + String(chunk)).slice(-5000) })
  const endpoint = 'http://127.0.0.1:' + port
  await waitForHealth(endpoint)
  const create = await fetch(endpoint + '/api/session', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ agent: 'build', model: { providerID: 'grimoire', id: 'gpt-smoke' }, location: { directory: cwd } }) })
  const created = await create.json(); const sessionId = created.data?.id || created.id
  const initialSession = await (await fetch(endpoint + '/api/session/' + sessionId)).json()
  const labeledFetch = async (label, input, init, timeoutMs = 10_000) => {
    try {
      const signal = AbortSignal.any([init?.signal || new AbortController().signal, AbortSignal.timeout(timeoutMs)])
      return await fetch(input, { ...init, signal })
    }
    catch (error) { throw new Error(label + ': ' + (error instanceof Error ? error.message : String(error))) }
  }
  const durablePromise = labeledFetch('durable event fetch', endpoint + '/api/session/' + sessionId + '/event?after=0', { headers: { accept: 'text/event-stream' } }, 25_000)
  const prompt = await labeledFetch('v2 prompt admission', endpoint + '/api/session/' + sessionId + '/prompt', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ prompt: { text: 'reply replay ok' } }) }, 10_000)
  await delay(3000)
  const promptBody = prompt.ok ? await prompt.json() : await prompt.text()
  const activeResponse = await labeledFetch('v2 active sessions', endpoint + '/api/session/active', { headers: { accept: 'application/json' } }, 10_000)
  const activeBody = activeResponse.ok ? await activeResponse.json() : { error: await activeResponse.text() }
  const currentSession = await (await labeledFetch('v2 session state', endpoint + '/api/session/' + sessionId, { headers: { accept: 'application/json' } }, 10_000)).json()
  const eventResponse = await durablePromise
  if (!eventResponse.ok) throw new Error('v2 durable event HTTP ' + eventResponse.status)
  const durable = await readSse(eventResponse)
  const historyResponse = await labeledFetch('finite session history', endpoint + '/api/session/' + sessionId + '/history?after=0&limit=100', { headers: { accept: 'application/json' } }, 10_000)
  const historyBody = historyResponse.ok ? await historyResponse.json() : { error: await historyResponse.text() }
  const durableSeqs = durable.map(event => event.durable?.seq).filter(Number.isInteger)
  const durableTypes = durable.map(event => event.type)
  const history = historyBody.data?.data || historyBody.data || []
  const historyTypes = history.map(event => event.type)
  console.log(JSON.stringify({ passed: prompt.ok && durable.length > 0, sessionId, promptStatus: prompt.status, promptBody, initialSession, activeStatus: activeResponse.status, activeBody, currentSession, providerRequests: providerRequests.length, durableCount: durable.length, durableSeqs, durableTypes, historyStatus: historyResponse.status, historyCount: history.length, historyTypes }, null, 2))
  if (!prompt.ok || !durable.length) process.exitCode = 1
} catch (error) {
  console.error(JSON.stringify({ passed: false, error: error.stack || String(error), stderr }, null, 2)); process.exitCode = 1
} finally {
  if (child && child.exitCode === null) { child.kill(); await new Promise(resolve => child.once('exit', resolve)) }
  if (provider) { provider.closeAllConnections(); await new Promise(resolve => provider.close(resolve)) }
  for (let i = 0; i < 20; i++) { try { fs.rmSync(isolated, { recursive: true, force: true }); break } catch { await delay(250) } }
}
