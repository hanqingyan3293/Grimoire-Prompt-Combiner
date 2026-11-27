// Production adapter acceptance: local provider, harmless native read, real approval.
// Default: one allow-once or deny. --grant: real permission.asked payload -> main
// RuntimePermissionBroker -> exact session grant -> adapter native once/reject.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'
import net from 'node:net'
import { EventEmitter, once } from 'node:events'
import { spawn } from 'node:child_process'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const executable = process.env.GRIMOIRE_OPENCODE_EXE || path.join(root, 'resources/agent-runtimes/opencode/opencode.exe')
const { OpenCodeRuntime } = await import(pathToFileURL(path.join(root, 'dist/main/main/ai/runtime/adapters.js')).href)
const grantMode = process.argv.includes('--grant')
const approvalDecision = process.argv.includes('--deny') ? 'deny' : 'once'
const mode = grantMode ? 'grant' : approvalDecision
const debug = process.env.GRIMOIRE_DEBUG_APPROVAL === '1'
const startedAt = new Date().toISOString()
const startedMs = Date.now()
const isolated = fs.mkdtempSync(path.join(os.tmpdir(), 'grimoire-opencode-approval-'))
const cwd = path.join(isolated, 'workspace')
for (const directory of ['workspace', 'home', 'config', 'data', 'cache', 'appdata', 'localappdata']) fs.mkdirSync(path.join(isolated, directory))
const runtimes = []
const events = []
const providerRequests = []
const fileA = 'grant-a.txt'
const fileB = 'grant-b.txt'
const onceFile = 'permission-fixture.txt'
const contentA = 'M4_GRANT_READ_A_OK'
const contentB = 'M4_GRANT_READ_B_MUST_NOT_BE_READ'
const onceContent = 'M4_PERMISSION_READ_OK'
if (grantMode) {
  fs.writeFileSync(path.join(cwd, fileA), contentA + '\n')
  fs.writeFileSync(path.join(cwd, fileB), contentB + '\n')
} else {
  fs.writeFileSync(path.join(cwd, onceFile), onceContent + '\n')
}
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
const toolQueue = grantMode
  ? [
      { name: 'read', args: { filePath: fileA }, text: 'grant first ok' },
      { name: 'read', args: { filePath: fileA }, text: 'grant second ok' },
      { name: 'read', args: { filePath: fileB }, text: 'grant denied ok' },
    ]
  : [{ name: 'read', args: { filePath: onceFile }, text: 'permission ok' }]
let queueIndex = 0
let pendingCall = null
const permissionPrompts = []
let promptCount = 0
const grantDecisions = []
let broker
let sender
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
      const serialized = JSON.stringify(body)
      // OpenCode also calls the provider for an automatic title with no tools.
      if (!definitions.length) { reply(response, { content: 'Local approval fixture' }, 'stop'); return }
      const hasResult = pendingCall && body.messages?.some(message => message.role === 'tool' && message.tool_call_id === pendingCall.id)
      providerRequests.push({
        tools: definitions.length, names, returnedTool: Boolean(hasResult),
        hasFileA: serialized.includes(contentA), hasFileB: serialized.includes(contentB),
        hasOnceContent: serialized.includes(onceContent),
      })
      if (hasResult) {
        const completed = pendingCall
        pendingCall = null
        reply(response, { content: completed.text }, 'stop')
        return
      }
      if (pendingCall) throw new Error('Provider received a new turn before the previous tool result')
      const next = toolQueue[queueIndex]
      if (!next) throw new Error('Provider tool queue exhausted')
      assert.ok(names.includes(next.name), 'Native ' + next.name + ' definition must be offered to the agent')
      const id = 'call_grant_' + (queueIndex + 1)
      queueIndex++
      pendingCall = { id, text: next.text }
      reply(response, { tool_calls: [{ index: 0, id, type: 'function', function: { name: next.name, arguments: JSON.stringify(next.args) } }] }, 'tool_calls')
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
  const runtime = new OpenCodeRuntime({ endpoint, directory: cwd, model: 'grimoire/gpt-smoke', nativeToolPolicy: 'ask', hostPermissionBroker: grantMode })
  runtimes.push(runtime)
  const session = runtime.createSession('grimoire/gpt-smoke', [{ role: 'user', content: 'Read the local permission fixture.' }])
  if (grantMode) {
    const imported = await import(pathToFileURL(path.join(root, 'dist/main/main/services/agent-runtime-permission.service.js')).href)
    broker = new imported.RuntimePermissionBroker()
    sender = Object.assign(new EventEmitter(), {
      isDestroyed: () => false,
      send: (_channel, value) => {
        promptCount++
        permissionPrompts.push({ requestId: value.requestId, permission: value.permission, detail: value.detail })
        queueMicrotask(() => {
          const decision = promptCount === 1 ? 'allowForSession' : 'deny'
          if (!broker.decide(sender, value.requestId, decision)) throw new Error('Broker rejected the scripted decision')
        })
      },
    })
  }
  let approved = false
  async function answerPermission(event) {
    assert.equal(event.action, 'read')
    if (!grantMode) {
      if (approvalDecision === 'deny') await runtime.reject({ requestId: event.requestId, decision: 'decline' })
      else await runtime.approve({ requestId: event.requestId, decision: 'accept' })
      approved = true
      return
    }
    const decision = await broker.request({
      sender, sessionId: session.id, scope: 'm4:grant:' + session.id, requestId: event.requestId,
      permission: event.action, detail: event.detail, action: event.action, native: true,
      channel: 'permission', timeoutMs: 15_000,
    })
    grantDecisions.push(decision)
    if (decision === 'deny' || decision === 'cancel') await runtime.reject({ requestId: event.requestId, decision: 'decline' })
    else await runtime.approve({ requestId: event.requestId, decision: 'accept' })
    approved = true
  }
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
  const turnEvents = []
  const turns = grantMode ? 3 : 1
  for (let turn = 0; turn < turns; turn++) {
    const current = []
    turnEvents.push(current)
    await bounded((async () => {
      for await (const event of runtime.send({ sessionId: session.id, model: session.model, messages: [{ role: 'user', content: 'Turn ' + (turn + 1) + ': apply the local read fixture.' }] })) {
        events.push(event)
        current.push(event)
        if (event.type === 'permission-requested') await answerPermission(event)
      }
    })(), 30_000, 'Approval must arrive while the model turn is running')
  }
  if (fixtureError) throw fixtureError
  assert.ok(approved, 'Real native permission event must be consumed')
  const resolved = events.filter(event => event.type === 'permission-resolved').map(event => String(event.decision))
  if (!grantMode) {
    const current = turnEvents[0]
    if (approvalDecision === 'deny') {
      assert.equal(current.at(-1)?.type, 'completed', JSON.stringify(current))
      assert.equal(current.some(event => event.type === 'text-delta'), false)
      assert.ok(current.some(event => event.type === 'tool-finished' && event.error))
      assert.equal(providerRequests.some(request => request.returnedTool), false)
      assert.deepEqual(resolved, ['reject'])
      result = { passed: true, mode: 'deny', tool: 'read', events: current.length, permissionReplies: resolved, providerRequests }
    } else {
      const finished = current.find(event => event.type === 'tool-finished' && event.callId === 'call_grant_1')
      assert.equal(current.at(-1)?.type, 'completed')
      assert.equal(current.filter(event => event.type === 'text-delta').map(event => event.text).join(''), 'permission ok')
      assert.ok(finished, 'Read tool must finish')
      assert.equal(finished?.error, undefined, 'Allowed read must not report a tool error')
      assert.equal(current.some(event => event.type === 'failed'), false)
      assert.deepEqual(resolved, ['once'])
      assert.ok(providerRequests.some(request => request.hasOnceContent), 'Read content must reach the provider as a tool result')
      result = { passed: true, mode: 'once', tool: 'read', text: 'permission ok', events: current.length, permissionReplies: resolved, providerRequests }
    }
  } else {
    const [first, second, third] = turnEvents
    for (const [index, current] of turnEvents.entries()) assert.equal(current.at(-1)?.type, 'completed', 'turn ' + (index + 1) + ': ' + JSON.stringify(current))
    const finished = (list, callId) => list.find(event => event.type === 'tool-finished' && event.callId === callId)
    assert.ok(finished(first, 'call_grant_1'), 'First granted read must emit tool-finished')
    assert.ok(finished(second, 'call_grant_2'), 'Second granted read must emit tool-finished')
    assert.equal(finished(first, 'call_grant_1')?.error, undefined, 'First granted read must not report an error')
    assert.equal(finished(second, 'call_grant_2')?.error, undefined, 'Second read in the same exact pattern must not report an error')
    assert.ok(finished(third, 'call_grant_3')?.error, 'Denied read must report a tool error')
    assert.deepEqual(grantDecisions, ['allowForSession', 'allowOnce', 'deny'])
    assert.equal(promptCount, 2, 'Only the first and the different-pattern request may prompt')
    assert.deepEqual(resolved, ['once', 'once', 'reject'])
    assert.ok(resolved.every(reply => reply !== 'always'), 'Native process-wide always must never be emitted')
    assert.ok(providerRequests.some(request => request.hasFileA), 'Allowed file content must reach the provider')
    assert.equal(providerRequests.some(request => request.hasFileB), false, 'Denied file must never be read')
    result = {
      passed: true, mode: 'grant', tool: 'read', files: [fileA, fileB], grantDecisions,
      permissionPrompts: permissionPrompts.map(item => ({ requestId: item.requestId, permission: item.permission, patterns: Array.isArray(item.detail?.patterns) ? item.detail.patterns : undefined })),
      promptCount, permissionReplies: resolved, firstReadError: finished(first, 'call_grant_1')?.error ?? null,
      samePatternReadError: finished(second, 'call_grant_2')?.error ?? null, deniedReadError: finished(third, 'call_grant_3')?.error ?? null,
      fileAReachedProvider: providerRequests.some(request => request.hasFileA), fileBReachedProvider: providerRequests.some(request => request.hasFileB),
      events: events.length, providerRequests,
    }
  }
} catch (error) {
  process.exitCode = 1
  result = { passed: false, mode, error: error.stack || String(error), fixtureError: fixtureError ? String(fixtureError) : undefined, eventTypes: events.map(event => event.type), providerRequests, permissionPrompts, grantDecisions, stderr: stderr.replaceAll('local-fixture-only', '<redacted>') }
} finally {
  for (const runtime of runtimes) await runtime.close().catch(() => {})
  if (broker) broker.shutdown()
  if (child && child.exitCode === null && child.signalCode === null) { const exited = once(child, 'exit'); child.kill(); await bounded(exited, 5000, 'Owned child cleanup timeout').catch(error => { process.exitCode = 1; result.cleanupError = String(error) }) }
  if (providerServer) { providerServer.closeAllConnections(); await new Promise(resolve => providerServer.close(resolve)) }
  for (let attempt = 0; attempt < 20; attempt++) {
    try { fs.rmSync(isolated, { recursive: true, force: true }); break }
    catch (error) { if (attempt === 19) { process.exitCode = 1; result.cleanupError = String(error) } else await delay(250) }
  }
  result.startedAt = startedAt
  result.finishedAt = new Date().toISOString()
  result.durationMs = Date.now() - startedMs
  const artifactDir = path.join(root, 'artifacts', 'm4')
  fs.mkdirSync(artifactDir, { recursive: true })
  const stamp = startedAt.replace(/[:.]/g, '-')
  const artifactPath = path.join(artifactDir, 'opencode-permission-' + mode + '-' + stamp + '.json')
  fs.writeFileSync(artifactPath, JSON.stringify(result, null, 2))
  result.artifactPath = artifactPath
}
console.log(JSON.stringify(result, null, 2))
