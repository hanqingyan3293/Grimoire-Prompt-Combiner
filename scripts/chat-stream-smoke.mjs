#!/usr/bin/env node
// End-to-end evidence for M2: a real Electron window, a real fake provider over SSE, and the
// source `ai.stream` protocol driven through the compat bridge. Asserts the assembled text and
// the chunk sequence, and prints one JSON line. Requires a prior `npm run build` (the window
// loads the compiled main + compat bundles).
import { spawn, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { buildFingerprint } from './journey-evidence.mjs'

const root = process.cwd()
const walkFiles = dir => {
  const files = []
  const walk = current => {
    if (!fs.existsSync(current)) return
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const file = path.join(current, entry.name)
      if (entry.isDirectory()) walk(file)
      else files.push(file)
    }
  }
  walk(dir)
  return files.sort()
}
const compiledFiles = walkFiles(path.join(root, 'dist'))
const shellFile = path.join(root, 'src/vendor/cherry/compat/dist-source-shell/source-shell.html')
const build = buildFingerprint([...compiledFiles, ...(fs.existsSync(shellFile) ? [shellFile] : [])], { root })
const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'grimoire-stream-'))
const port = 18000 + Math.floor(Math.random() * 900)
const debugPort = 9300 + Math.floor(Math.random() * 90)
const EXPECTED = '你好，世界'
const TOOL_ANSWER = '工具已完成'
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

const server = http.createServer((req, res) => {
  if (req.method === 'POST' && req.url.startsWith('/v1/chat/completions')) {
    let body = ''
    req.on('data', chunk => { body += chunk })
    req.on('end', () => {
      const payload = (() => { try { return JSON.parse(body) } catch { return {} } })()
      const messages = Array.isArray(payload.messages) ? payload.messages : []
      const sawToolResult = messages.some(message => message && message.role === 'tool')
      // Vision/other one-shot calls are non-streaming; answer them as plain JSON.
      if (payload.stream !== true) {
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ id: 'smoke', object: 'chat.completion', created: 0, model: 'smoke-model', choices: [{ index: 0, message: { role: 'assistant', content: '看到图片' }, finish_reason: 'stop' }], usage: { prompt_tokens: 1, completion_tokens: 4, total_tokens: 5 } }))
        return
      }
      // Only the approval scenario asks for a tool; the plain turns must stream text.
      const lastUser = [...messages].reverse().find(message => message && message.role === 'user')
      const wantsTool = !!lastUser && JSON.stringify(lastUser.content || '').toLowerCase().includes('tool')
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' })
      const frame = (delta, finish) => 'data: ' + JSON.stringify({ id: 'smoke', object: 'chat.completion.chunk', created: 0, model: 'smoke-model', choices: [{ index: 0, delta, finish_reason: finish || null }] }) + '\n\n'
      if (wantsTool && !sawToolResult) {
        // Request a permission-gated tool so the turn exercises the approval loop.
        res.write(frame({ role: 'assistant', content: '' }))
        res.write(frame({ tool_calls: [{ index: 0, id: 'call_smoke', type: 'function', function: { name: 'grimoire.prompt.create', arguments: JSON.stringify({ name: 'smoke-prompt', prompt: 'smoke' }) } }] }))
        res.write(frame({}, 'tool_calls'))
        res.write('data: [DONE]\n\n')
        res.end()
        return
      }
      const answer = sawToolResult ? TOOL_ANSWER : EXPECTED
      res.write(frame({ role: 'assistant', content: '' }))
      for (const char of answer) res.write(frame({ content: char }))
      res.write(frame({}, 'stop'))
      res.write('data: [DONE]\n\n')
      res.end()
    })
    return
  }
  if (req.url.startsWith('/v1/models')) {
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ object: 'list', data: [{ id: 'smoke-model', object: 'model', owned_by: 'smoke' }] }))
    return
  }
  res.writeHead(404)
  res.end()
})
await new Promise(resolve => server.listen(port, '127.0.0.1', resolve))

function teardown() {
  if (process.platform === 'win32') {
    const ps = ['-NoProfile', '-Command', "Get-CimInstance Win32_Process -Filter \"Name='electron.exe'\" | Where-Object { $_.CommandLine -like '*" + userData + "*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }"]
    spawnSync('powershell.exe', ps, { stdio: 'ignore' })
  }
}

const child = spawn(process.platform === 'win32' ? 'npx.cmd' : 'npx', ['electron', '.', '--user-data-dir=' + userData, '--remote-debugging-address=127.0.0.1', '--remote-debugging-port=' + debugPort], {
  cwd: root,
  env: { ...process.env, ELECTRON_RUN_AS_NODE: undefined, GRIMOIRE_OPEN_CHERRY: '1' },
  stdio: 'ignore',
  shell: process.platform === 'win32'
})

let target = null
for (let i = 0; i < 90 && !target; i += 1) {
  await sleep(1000)
  try {
    const list = await (await fetch('http://127.0.0.1:' + debugPort + '/json/list')).json()
     target = list.find(entry => entry.type === 'page' && /cherry[\\/-].*\/index\.html/.test(entry.url))
  } catch {}
}
if (!target) { console.log(JSON.stringify({ ok: false, error: 'NO_CHERRY_WINDOW' })); teardown(); server.close(); process.exit(1) }

const socket = new WebSocket(target.webSocketDebuggerUrl)
await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject })
let nextId = 1
const pending = new Map()
socket.onmessage = event => {
  let message
  try { message = JSON.parse(event.data) } catch { return }
  const settle = pending.get(message.id)
  if (!settle) return
  pending.delete(message.id)
  settle(message.result)
}
const send = (method, params) => new Promise(resolve => { const id = nextId++; pending.set(id, resolve); socket.send(JSON.stringify({ id, method, params })) })
await send('Runtime.enable', {})
async function evaluate(expression) {
  const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, timeout: 30000 })
  if (result?.exceptionDetails) throw new Error(result.exceptionDetails.text + ' ' + (result.exceptionDetails.exception?.description || ''))
  return result?.result?.value
}

const pageScript = `(async () => {
  const api = window.api
  const diagnostics = { hasApi: !!api, hasIpcApi: !!(api && api.ipcApi), hasProviders: !!(api && api.providers), href: location.href }
  let providerId
  if (api?.providers) {
    const saved = await api.providers.save({ name: 'Smoke', access_mode: 'api', protocol: 'chat_completions', base_url: 'http://127.0.0.1:${port}/v1', api_key: 'smoke-key', default_model: 'smoke-model', models: ['smoke-model'] })
    providerId = saved && saved.id ? saved.id : (await api.providers.list())[0].id
    await api.providers.setActive(providerId)
  } else if (api?.dataApi) {
    const response = await api.dataApi.request({ id: 'stream-smoke-provider', method: 'POST', path: '/providers', body: { name: 'Smoke', endpointConfigs: { openai: { baseUrl: 'http://127.0.0.1:${port}/v1' } }, defaultChatEndpoint: 'openai', settings: { defaultModel: 'smoke-model' }, models: [{ id: 'smoke-model', name: 'smoke-model' }], apiKeys: [{ key: 'smoke-key', isEnabled: true }] } })
    const created = response && response.data ? response.data : response
    providerId = created && created.id ? created.id : (await api.dataApi.request({ id: 'stream-smoke-provider-list', method: 'GET', path: '/providers' })).data[0].id
  } else {
    throw new Error('provider bridge unavailable: ' + JSON.stringify(diagnostics))
  }
  const runTurn = async (topicId, options = {}) => {
    const chunks = []
    let terminal = null
    const offChunk = api.ipcApi.on('ai.stream.chunk', payload => { if (payload.topicId === topicId) chunks.push(payload.chunk) })
    const offDone = api.ipcApi.on('ai.stream.done', payload => { if (payload.topicId === topicId) terminal = payload })
    const offErr = api.ipcApi.on('ai.stream.error', payload => { if (payload.topicId === topicId) terminal = { error: payload.error } })
    const approvals = []
    const offApproval = api.ipcApi.on('ai.stream.chunk', payload => {
      if (payload.topicId !== topicId) return
      if (payload.chunk && payload.chunk.type === 'tool-approval-request') {
        approvals.push(payload.chunk.approvalId)
        if (options.decision) void api.ipcApi.request('ai.tool.approval.respond', { approvalId: payload.chunk.approvalId, approved: options.decision === 'allow' })
      }
    })
    const prompt = options.content || 'hi'
    const ack = await api.ipcApi.request('ai.stream.open', { topicId, trigger: 'submit-message', userMessageParts: [{ type: 'text', text: prompt }] })
    const deadline = Date.now() + 25000
    while (!terminal && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 100))
    offChunk(); offDone(); offErr(); offApproval()
    const text = chunks.filter(chunk => chunk.type === 'text-delta').map(chunk => chunk.delta).join('')
    return { ack, terminal, text, approvals, chunkTypes: chunks.map(chunk => chunk.type) }
  }
  // Chat surface: an AI session is its own topic.
  const session = await api.ai.sessions.create({ runtime: 'openai-compatible', providerId, modelId: 'smoke-model', title: 'stream smoke' })
  const topicId = session.id
  const chatTurn = await runTurn(topicId)
  const ack = chatTurn.ack
  const terminal = chatTurn.terminal
  const chunks = chatTurn.chunkTypes.map(type => ({ type }))
  const text = chatTurn.text
  // Persistence check: the turn must exist in Grimoire's own history, not only on screen.
  const snapshot = await api.ai.sessions.get(topicId)
  const messages = (snapshot && snapshot.messages) || []
  const assistant = messages.filter(message => message.role === 'assistant').pop()
  const persisted = assistant ? { role: assistant.role, status: assistant.status, text: assistant.content } : null
  // Agent surface: the agent-session id doubles as the topic and streams on its own feed.
  const agentSession = await api.agent.sessions.create({ runtime: 'openai-compatible', providerId, model: 'smoke-model', title: 'agent smoke' })
  const agentTurn = await runTurn(agentSession.id)
  // Approval loop: the provider asks for a permission-gated tool, the page approves via
  // ai.tool.approval.respond, and the turn must finish with the post-tool answer.
  const toolSession = await api.ai.sessions.create({ runtime: 'openai-compatible', providerId, modelId: 'smoke-model', title: 'approval smoke' })
  const toolTurn = await runTurn(toolSession.id, { decision: 'allow', content: 'please call tool' })
  const denySession = await api.ai.sessions.create({ runtime: 'openai-compatible', providerId, modelId: 'smoke-model', title: 'deny smoke' })
  const denyTurn = await runTurn(denySession.id, { decision: 'deny', content: 'please call tool' })
  const vision = await api.ai.vision({ providerId, model: 'smoke-model', imageBase64: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', prompt: 'describe' })
  return {
    ack, terminal, text, vision,
    chunkTypes: chunks.map(chunk => chunk.type),
    persisted,
    agent: { ack: agentTurn.ack, terminal: agentTurn.terminal, text: agentTurn.text, chunkTypes: agentTurn.chunkTypes },
    vision: vision,
    approval: { approvalIds: toolTurn.approvals, terminal: toolTurn.terminal, text: toolTurn.text },
    denial: { approvalIds: denyTurn.approvals, terminal: denyTurn.terminal, text: denyTurn.text },
    toolSession: toolSession.id,
    diagnostics
  }
})()`

let report
try {
  const readinessDeadline = Date.now() + 30000
  let readiness
  do {
    readiness = await evaluate(`({ href: location.href, ready: location.href !== 'about:blank' && typeof window.api?.ipcApi?.request === 'function' && typeof window.api?.ai?.sessions?.create === 'function' })`)
    if (readiness?.ready) break
    await sleep(200)
  } while (Date.now() < readinessDeadline)
  if (!readiness?.ready) throw new Error('PRELOAD_NOT_READY: ' + JSON.stringify({ targetUrl: target.url, ...readiness }))
  report = await evaluate(pageScript)
} catch (error) {
  report = { error: String(error) }
}
const text = report && typeof report.text === 'string' ? report.text : ''
const persistedText = report && report.persisted ? JSON.stringify(report.persisted.text || '').includes(EXPECTED) : false
const agentOk = !!report && !!report.agent && report.agent.text === EXPECTED && !!report.agent.terminal && report.agent.terminal.status === 'success'
const approvalOk = !!report && !!report.approval && report.approval.approvalIds.length > 0 && !!report.approval.terminal && report.approval.terminal.status === 'success' && report.approval.text === TOOL_ANSWER
// A denial must settle the turn too: no hang, no phantom success text.
// A denial must settle the turn deterministically. Grimoire's runtime treats a refused tool as
// a failed turn and surfaces the reason; the smoke asserts that terminal fact, not a hang.
const denialOk = !!report && !!report.denial && report.denial.approvalIds.length > 0 && !!report.denial.terminal && !!report.denial.terminal.error && String(report.denial.terminal.error.message).includes('权限被拒绝')
const ok = text === EXPECTED && !!report && !!report.terminal && report.terminal.status === 'success' && persistedText && agentOk && approvalOk && denialOk && !!report && !!report.vision && report.vision.success === true && report.vision.text === '看到图片'
const json = JSON.stringify({ ok, buildSha256: build.combinedSha256, build, expected: EXPECTED, chat: { text, persisted: report?.persisted, ack: report?.ack, terminal: report?.terminal, chunkTypes: report?.chunkTypes }, agent: report?.agent, approval: report?.approval, denial: report?.denial, toolSession: report?.toolSession, vision: report?.vision,  diagnostics: report?.diagnostics, error: report?.error }, null, 2)
const outArg = process.argv.find(arg => arg.startsWith('--out='))?.slice('--out='.length)
if (outArg) fs.writeFileSync(path.resolve(outArg), json + String.fromCharCode(10))
console.log(json)
socket.close()
teardown()
server.close()
process.exit(ok ? 0 : 1)
