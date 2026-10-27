// Bounded real Pi prompt smoke. Uses only a loopback fake OpenAI-compatible provider.
// No external credentials or network requests are permitted.
import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import readline from 'node:readline'
import { spawn, execFileSync } from 'node:child_process'
import http from 'node:http'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const executable = process.env.GRIMOIRE_PI_EXE || path.join(root, 'resources', 'agent-runtimes', 'pi', 'pi.exe')
const isolated = fs.mkdtempSync(path.join(os.tmpdir(), 'grimoire-pi-prompt-smoke-'))
const agentDir = path.join(isolated, 'agent')
const sessionDir = path.join(isolated, 'sessions')
const cwd = path.join(isolated, 'workspace')
for (const dir of [agentDir, sessionDir, cwd]) fs.mkdirSync(dir, { recursive: true })
let child
let server
let stderr = ''
try {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'resources/agent-runtimes/runtime-manifest.json'), 'utf8'))
  const entry = manifest.runtimes.find(item => item.id === 'pi')
  const digest = crypto.createHash('sha256').update(fs.readFileSync(executable)).digest('hex')
  assert.equal(digest.toUpperCase(), entry.sha256.toUpperCase(), 'Pi artifact digest differs from manifest')
  assert.equal(execFileSync(executable, ['--version'], { encoding: 'utf8', windowsHide: true }).trim(), entry.version)

  server = http.createServer(async (request, response) => {
    if (request.url === '/v1/models' && request.method === 'GET') {
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end(JSON.stringify({ data: [{ id: 'gpt-smoke', object: 'model' }] }))
      return
    }
    if (request.url === '/v1/chat/completions' && request.method === 'POST') {
      let body = ''
      for await (const chunk of request) body += chunk
      assert.match(body, /gpt-smoke/)
      response.writeHead(200, { 'content-type': 'text/event-stream', connection: 'keep-alive', 'cache-control': 'no-cache' })
      response.write('data: {"id":"pi-smoke","object":"chat.completion.chunk","created":1,"model":"gpt-smoke","choices":[{"index":0,"delta":{"role":"assistant","content":"pi"},"finish_reason":null}]}\n\n')
      response.write('data: {"id":"pi-smoke","object":"chat.completion.chunk","created":1,"model":"gpt-smoke","choices":[{"index":0,"delta":{"content":" ok"},"finish_reason":null}]}\n\n')
      response.write('data: {"id":"pi-smoke","object":"chat.completion.chunk","created":1,"model":"gpt-smoke","choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}\n\n')
      response.end('data: [DONE]\n\n')
      return
    }
    response.writeHead(404)
    response.end()
  })
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve) })
  const address = server.address()
  const port = typeof address === 'object' && address ? address.port : 0
  const provider = 'grimoire'
  fs.writeFileSync(path.join(agentDir, 'models.json'), JSON.stringify({ providers: { [provider]: {
    name: 'Grimoire local smoke provider', api: 'openai-completions', baseUrl: `http://127.0.0.1:${port}/v1`,
    models: [{ id: 'gpt-smoke', name: 'gpt-smoke', api: 'openai-completions', baseUrl: `http://127.0.0.1:${port}/v1`, reasoning: false, input: ['text'], contextWindow: 128000, maxTokens: 128, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } }],
  } } }), { mode: 0o600 })
  fs.writeFileSync(path.join(agentDir, 'auth.json'), JSON.stringify({ [provider]: { type: 'api_key', key: 'local-pi-smoke-only' } }), { mode: 0o600 })

  child = spawn(executable, ['--mode', 'rpc', '--provider', provider, '--model', 'gpt-smoke', '--session-id', 'grimoire-pi-smoke', '--session-dir', sessionDir, '--no-tools', '--no-extensions', '--no-skills', '--no-prompt-templates', '--no-themes', '--no-context-files'], {
    cwd,
    env: { ...process.env, PI_CODING_AGENT_DIR: agentDir, PI_CODING_AGENT_SESSION_DIR: sessionDir, PI_OFFLINE: '1' },
    stdio: 'pipe', windowsHide: true, shell: false,
  })
  child.stderr.on('data', chunk => { stderr = (stderr + String(chunk)).slice(-8000) })
  const lines = readline.createInterface({ input: child.stdout })
  const records = []
  const waitFor = (predicate, timeoutMs = 30000) => new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Pi smoke timeout')), timeoutMs)
    const onLine = line => {
      let record
      try { record = JSON.parse(line) } catch { return }
      records.push(record)
      if (predicate(record)) { clearTimeout(timer); lines.off('line', onLine); resolve(record) }
    }
    lines.on('line', onLine)
  })
  const send = (value) => child.stdin.write(JSON.stringify(value) + '\n')
  send({ id: 'state', type: 'get_state' })
  const initial = await waitFor(record => record.type === 'response' && record.id === 'state')
  assert.equal(initial.success, true)
  send({ id: 'prompt', type: 'prompt', message: 'Reply with exactly: pi ok' })
  const promptAck = await waitFor(record => record.type === 'response' && record.id === 'prompt')
  assert.equal(promptAck.success, true)
  await waitFor(record => record.type === 'agent_settled')
  const assistantText = records.flatMap(record => record.messages || []).filter(message => message?.role === 'assistant').flatMap(message => message.content || []).map(part => typeof part === 'string' ? part : part?.text || '').join('')
  assert.equal(assistantText, 'pi ok')
  assert.ok(fs.readdirSync(sessionDir).length > 0, 'Pi session directory must contain native execution state')
  console.log(JSON.stringify({ passed: true, version: entry.version, sha256: digest, records: records.length, assistantText, persisted: true }, null, 2))
} catch (error) {
  console.error(JSON.stringify({ passed: false, error: error.stack || String(error), stderr: stderr.replaceAll('local-pi-smoke-only', '<redacted>') }, null, 2))
  process.exitCode = 1
} finally {
  if (child && child.exitCode === null) {
    try { child.stdin.end() } catch {}
    try { child.kill() } catch {}
    await new Promise(resolve => child.once('exit', resolve))
  }
  if (server) await new Promise(resolve => server.close(resolve))
  fs.rmSync(isolated, { recursive: true, force: true })
}
