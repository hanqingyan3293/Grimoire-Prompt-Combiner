// Production adapter acceptance: local provider, harmless native bash, real approval.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'
import net from 'node:net'
import { once } from 'node:events'
import { spawn } from 'node:child_process'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const executable = process.env.GRIMOIRE_OPENCODE_EXE || path.join(root, 'resources/agent-runtimes/opencode/opencode.exe')
const { OpenCodeRuntime } = await import(pathToFileURL(path.join(root, 'dist/main/main/ai/runtime/adapters.js')).href)
const debug = process.env.GRIMOIRE_DEBUG_APPROVAL === '1'
const approvalDecision = process.argv.includes('--deny') ? 'deny' : 'once'
const isolated = fs.mkdtempSync(path.join(os.tmpdir(), 'grimoire-opencode-approval-'))
const cwd = path.join(isolated, 'workspace')
for (const directory of ['workspace', 'home', 'config', 'data', 'cache', 'appdata', 'localappdata']) fs.mkdirSync(path.join(isolated, directory))
const runtimes = []
const events = []
const providerRequests = []
let child
let providerServer
let fixtureError
let stderr = ''
let result
const delay = ms => new Promise(resolve => setTimeout(resolve, ms))
async function bounded(promise, ms, label) {
  let timer
  try { return await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(label)), ms) })]) }
  finally { clearTimeout(timer) }
}
async function listen(server) {
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve) })
  return server.address().port
}
function reply(response, delta, finish) {
  response.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' })
  const chunk = (value, finishReason) => 'data: ' + JSON.stringify({ id: 'local-approval', object: 'chat.completion.chunk', created: 1, model: 'gpt-smoke', choices: [{ index: 0, delta: value, finish_reason: finishReason }] }) + '\n\n'
  response.end(chunk({ role: 'assistant', ...delta }, null) + chunk({}, finish) + 'data: [DONE]\n\n')
}
try {
  providerServer = http.createServer(async (request, response) => {
    try {
      if (request.method !== 'POST' || request.url !== '/v1/chat/completions') { response.writeHead(404); response.end(); return }
      let raw = ''
      for await (const bytes of request) raw += bytes
      const body = JSON.parse(raw)
      assert.equal(body.model, 'gpt-smoke')
      const definitions = body.tools || []
      const names = definitions.map(tool => tool.function?.name).filter(Boolean)
      const bash = definitions.find(tool => tool.function?.name === 'bash')
      const returnedTool = body.messages?.find(message => message.role === 'tool' && message.tool_call_id === 'call_local_approval')
      providerRequests.push({ tools: definitions.length, names, returnedTool: Boolean(returnedTool) })
      // OpenCode also calls the provider for an automatic title with no tools.
      // A tool-call response to that request never exercises the agent's policy.
      if (!definitions.length) { reply(response, { content: 'Local approval fixture' }, 'stop'); return }
      if (returnedTool) { reply(response, { content: 'permission ok' }, 'stop'); return }
      assert.ok(bash, 'Native bash definition must be offered to the agent')
      reply(response, { tool_calls: [{ index: 0, id: 'call_local_approval', type: 'function', function: { name: 'bash', arguments: JSON.stringify({ command: 'echo permission-fixture' }) } }] }, 'tool_calls')
    } catch (error) {
      fixtureError = error
      response.writeHead(500, { 'content-type': 'application/json' })
      response.end(JSON.stringify({ error: { message: 'Local fixture failed' } }))
    }
  })
  const providerPort = await listen(providerServer)
  const configPath = path.join(isolated, 'config', 'opencode.json')
  fs.writeFileSync(configPath, JSON.stringify({
    $schema: 'https://opencode.ai/config.json',
    model: 'grimoire/gpt-smoke',
    permission: { '*': 'ask' },
    provider: { grimoire: { npm: '@ai-sdk/openai-compatible', options: { baseURL: `http://127.0.0.1:${providerPort}/v1`, apiKey: 'local-fixture-only' }, models: { 'gpt-smoke': { id: 'gpt-smoke', name: 'gpt-smoke', tool_call: true } } } },
  }))
  const reservation = net.createServer()
  const port = await listen(reservation)
  await new Promise(resolve => reservation.close(resolve))
  const env = { ...process.env, HOME: path.join(isolated, 'home'), USERPROFILE: path.join(isolated, 'home'), XDG_CONFIG_HOME: path.join(isolated, 'config'), XDG_DATA_HOME: path.join(isolated, 'data'), XDG_CACHE_HOME: path.join(isolated, 'cache'), APPDATA: path.join(isolated, 'appdata'), LOCALAPPDATA: path.join(isolated, 'localappdata'), OPENCODE_CONFIG: configPath, OPENCODE_DISABLE_MODELS_FETCH: 'true', OPENCODE_DISABLE_AUTOUPDATE: 'true', OPENCODE_DISABLE_PROJECT_CONFIG: 'true' }
  delete env.OPENCODE_CONFIG_CONTENT
  delete env.OPENCODE_SERVER_PASSWORD
  child = spawn(executable, ['serve', '--pure', '--hostname=127.0.0.1', '--port=' + port], { cwd, env, stdio: ['pipe', 'ignore', 'pipe'], shell: false, windowsHide: true })
  child.stderr.on('data', bytes => { stderr = (stderr + String(bytes)).slice(-4000) })
  let spawnError
  child.on('error', error => { spawnError = error })
  const endpoint = 'http://127.0.0.1:' + port
  await bounded((async () => {
    for (;;) {
      if (spawnError) throw spawnError
      if (child.exitCode !== null) throw new Error('OpenCode exited during startup')
      try { const response = await fetch(endpoint + '/api/health', { signal: AbortSignal.timeout(1000) }); if (response.ok && (await response.json()).healthy) return } catch {}
      await delay(200)
    }
  })(), 30_000, 'OpenCode health timeout')
  const runtime = new OpenCodeRuntime({ endpoint, directory: cwd, model: 'grimoire/gpt-smoke', nativeToolPolicy: 'ask' })
  runtimes.push(runtime)
  const session = runtime.createSession('grimoire/gpt-smoke', [{ role: 'user', content: 'Write the local approval fixture once, then reply permission ok.' }])
  let approved = false
  let permissionDetail
  if (debug) {
    const originalFetch = globalThis.fetch
    globalThis.fetch = async (input, init) => {
      const response = await originalFetch(input, init)
      if (String(input).includes('/event')) {
        void (async () => {
          const reader = response.clone().body?.getReader()
          const decoder = new TextDecoder()
          while (reader) {
            const next = await Promise.race([reader.read(), delay(10_000).then(() => ({ timeout: true }))])
            if (next?.timeout || next.done) break
            console.error('[approval raw event]', decoder.decode(next.value))
          }
          await reader?.cancel().catch(() => {})
        })()
      }
      return response
    }
  }
  await bounded((async () => {
    for await (const event of runtime.send({ sessionId: session.id, model: session.model, messages: session.messages })) {
      events.push(event)
      if (event.type === 'permission-requested') {
        assert.equal(event.action, 'bash')
        permissionDetail = event.detail
        if (approvalDecision === 'deny') await runtime.reject({ requestId: event.requestId, decision: 'decline' })
        else await runtime.approve({ requestId: event.requestId, decision: 'accept' })
        approved = true
      }
    }
  })(), 20_000, 'Approval must arrive while the model turn is running')
  if (fixtureError) throw fixtureError
  assert.ok(approved, 'Real native permission event must be consumed')
  if (approvalDecision === 'deny') {
    assert.equal(events.at(-1)?.type, 'completed', JSON.stringify(events))
    assert.equal(events.some(event => event.type === 'text-delta'), false)
    assert.ok(events.some(event => event.type === 'tool-finished' && event.error))
    assert.equal(providerRequests.some(request => request.returnedTool), false)
    result = { passed: true, approval: 'deny', events: events.length, providerRequests }
  } else {
    assert.equal(events.at(-1)?.type, 'completed')
    assert.equal(events.filter(event => event.type === 'text-delta').map(event => event.text).join(''), 'permission ok')
    assert.ok(events.some(event => event.type === 'tool-finished' && event.ownership === 'runtime'))
    result = { passed: true, approval: 'once', text: 'permission ok', events: events.length, providerRequests }
  }
} catch (error) {
  process.exitCode = 1
  result = { passed: false, error: error.stack || String(error), fixtureError: fixtureError ? String(fixtureError) : undefined, eventTypes: events.map(event => event.type), providerRequests, stderr: stderr.replaceAll('local-fixture-only', '<redacted>') }
} finally {
  for (const runtime of runtimes) await runtime.close().catch(() => {})
  if (child && child.exitCode === null && child.signalCode === null) { const exited = once(child, 'exit'); child.kill(); await bounded(exited, 5000, 'Owned child cleanup timeout').catch(error => { process.exitCode = 1; result.cleanupError = String(error) }) }
  if (providerServer) { providerServer.closeAllConnections(); await new Promise(resolve => providerServer.close(resolve)) }
  for (let attempt = 0; attempt < 20; attempt++) {
    try { fs.rmSync(isolated, { recursive: true, force: true }); break }
    catch (error) { if (attempt === 19) { process.exitCode = 1; result.cleanupError = String(error) } else await delay(250) }
  }
}
console.log(JSON.stringify(result, null, 2))
