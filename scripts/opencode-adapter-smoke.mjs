// Production OpenCodeRuntime adapter smoke against the bundled 1.18.34 binary.
// Uses only a loopback fake OpenAI-compatible provider and no user credentials.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'
import net from 'node:net'
import { spawn } from 'node:child_process'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const executable = process.env.GRIMOIRE_OPENCODE_EXE || path.join(root, 'resources/agent-runtimes/opencode/opencode.exe')
const adapters = await import(pathToFileURL(path.join(root, 'dist/main/main/ai/runtime/adapters.js')).href)
const isolated = fs.mkdtempSync(path.join(os.tmpdir(), 'grimoire-opencode-adapter-'))
const cwd = path.join(isolated, 'workspace')
fs.mkdirSync(cwd, { recursive: true })
let providerServer
let openCode
let stderr = ''
function listen(server) { return new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve) }) }
async function waitForHealth(endpoint) {
  const deadline = Date.now() + 30_000
  while (Date.now() < deadline) {
    if (openCode.exitCode !== null) throw new Error('OpenCode exited: ' + openCode.exitCode + ' ' + stderr)
    try { const response = await fetch(endpoint + '/api/health'); if (response.ok && (await response.json()).healthy === true) return } catch {}
    await new Promise(resolve => setTimeout(resolve, 250))
  }
  throw new Error('health timeout: ' + stderr)
}
try {
  providerServer = http.createServer(async (request, response) => {
    if (request.url === '/v1/models' && request.method === 'GET') { response.writeHead(200, { 'content-type': 'application/json' }); response.end(JSON.stringify({ data: [{ id: 'gpt-smoke' }] })); return }
    if (request.url === '/v1/chat/completions' && request.method === 'POST') {
      for await (const _chunk of request) {}
      response.writeHead(200, { 'content-type': 'text/event-stream', connection: 'keep-alive' })
      response.write('data: {"id":"adapter-smoke","object":"chat.completion.chunk","created":1,"model":"gpt-smoke","choices":[{"index":0,"delta":{"role":"assistant","content":"adapter"},"finish_reason":null}]}\n\n')
      response.write('data: {"id":"adapter-smoke","object":"chat.completion.chunk","created":1,"model":"gpt-smoke","choices":[{"index":0,"delta":{"content":" ok"},"finish_reason":null}]}\n\n')
      response.end('data: {"id":"adapter-smoke","object":"chat.completion.chunk","created":1,"model":"gpt-smoke","choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n')
      return
    }
    response.writeHead(404); response.end()
  })
  await listen(providerServer)
  const providerPort = providerServer.address().port
  const config = {
    $schema: 'https://opencode.ai/config.json', model: 'grimoire/gpt-smoke',
    provider: { grimoire: { name: 'local adapter smoke', npm: '@ai-sdk/openai-compatible', api: `http://127.0.0.1:${providerPort}/v1`, options: { baseURL: `http://127.0.0.1:${providerPort}/v1`, apiKey: 'local-only' }, models: { 'gpt-smoke': { id: 'gpt-smoke', name: 'gpt-smoke', tool_call: true } } } },
  }
  const server = net.createServer(); await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve) }); const port = server.address().port; await new Promise(resolve => server.close(resolve))
  const runtimeEnv = { ...process.env, OPENCODE_CONFIG_CONTENT: JSON.stringify(config), OPENCODE_DISABLE_MODELS_FETCH: 'true', OPENCODE_DISABLE_AUTOUPDATE: 'true', OPENCODE_DISABLE_PROJECT_CONFIG: 'true', OPENCODE_DISABLE_EXTERNAL_SKILLS: 'true' }
  delete runtimeEnv.OPENCODE_CONFIG
  delete runtimeEnv.OPENCODE_CONFIG_DIR
  openCode = spawn(executable, ['serve', '--pure', '--hostname=127.0.0.1', '--port=' + port], { cwd, env: runtimeEnv, stdio: ['pipe', 'ignore', 'pipe'], windowsHide: true, shell: false })
  openCode.stderr.on('data', chunk => { stderr = (stderr + String(chunk)).slice(-12000) })
  const endpoint = 'http://127.0.0.1:' + port
  await waitForHealth(endpoint)
  const runtime = new adapters.OpenCodeRuntime({ endpoint, model: 'grimoire/gpt-smoke', directory: cwd })
  const session = runtime.createSession('grimoire/gpt-smoke', [{ role: 'user', content: 'Reply with exactly adapter ok' }])
  const collectTurn = async (messages) => {
    const events = []
    for await (const event of runtime.send({ sessionId: session.id, model: session.model, messages })) events.push(event)
    assert.equal(events.at(-1)?.type, 'completed', JSON.stringify(events))
    const text = events.filter(event => event.type === 'text-delta').map(event => event.text).join('')
    assert.equal(text, 'adapter ok', JSON.stringify(events))
    return { events, text }
  }
  const first = await collectTurn(session.messages)
  const second = await collectTurn([...session.messages, { role: 'user', content: 'Reply with exactly adapter ok again' }])
  const remoteSessionId = runtime.getSessionReference(session.id)
  assert.match(remoteSessionId || '', /^ses/, 'OpenCode native session reference must be persisted')
  const reopenedRuntime = new adapters.OpenCodeRuntime({ endpoint, model: 'grimoire/gpt-smoke', directory: cwd, remoteSessionId })
  const reopenedSession = reopenedRuntime.createSession('grimoire/gpt-smoke', [...session.messages, { role: 'user', content: 'Reply with exactly adapter ok after reopen' }])
  const reopened = []
  for await (const event of reopenedRuntime.send({ sessionId: reopenedSession.id, model: reopenedSession.model, messages: reopenedSession.messages })) reopened.push(event)
  assert.equal(reopened.at(-1)?.type, 'completed', JSON.stringify(reopened))
  assert.equal(reopened.filter(event => event.type === 'text-delta').map(event => event.text).join(''), 'adapter ok', JSON.stringify(reopened))
  await reopenedRuntime.close()
  await runtime.close()
  console.log(JSON.stringify({ passed: true, remoteSessionId, turns: [first.events.length, second.events.length, reopened.length], text: first.text }, null, 2))
} catch (error) {
  console.error(JSON.stringify({ passed: false, error: error.stack || String(error), stderr }, null, 2))
  process.exitCode = 1
} finally {
  if (openCode && openCode.exitCode === null) { openCode.kill(); await new Promise(resolve => openCode.once('exit', resolve)) }
  if (providerServer) await new Promise(resolve => providerServer.close(resolve))
  // Windows can release the terminated Bun server's cwd handle a moment after
  // the child exit event. Retry the owned fixture root instead of leaving a
  // profile behind or reporting a false-clean smoke.
  for (let attempt = 0; attempt < 20; attempt += 1) {
    try { fs.rmSync(isolated, { recursive: true, force: true }); break }
    catch (error) {
      if (attempt === 19) { console.error(JSON.stringify({ cleanup: 'failed', path: isolated, error: String(error) })); process.exitCode = 1 }
      await new Promise(resolve => setTimeout(resolve, 250))
    }
  }
}
