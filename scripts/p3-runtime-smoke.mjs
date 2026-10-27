// Bounded real-binary smoke. Never sends a prompt, credentials, or a provider request.
// Usage: node scripts/p3-runtime-smoke.mjs --opencode-source <local-source-root>
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'
import net from 'node:net'
import readline from 'node:readline'
import { spawn, execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const sourceIndex = process.argv.indexOf('--opencode-source')
assert(sourceIndex >= 0 && process.argv[sourceIndex + 1], '--opencode-source is required; routes are checked before starting HTTP')
const source = path.resolve(process.argv[sourceIndex + 1])
const output = path.join(root, 'artifacts', 'p3-runtime-smoke.json')
const isolated = fs.mkdtempSync(path.join(os.tmpdir(), 'grimoire-p3-smoke-'))
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'resources/agent-runtimes/runtime-manifest.json'), 'utf8'))
const evidence = { at: new Date().toISOString(), scope: 'No prompt/provider/tool execution; idle RPC and health only', wire: [], processes: [], permission: 'Pi permission RPC unsupported: no proven approval command', source: {}, passed: false }
const children = []
const env = {}
for (const key of ['PATH', 'Path', 'SystemRoot', 'WINDIR', 'COMSPEC', 'PATHEXT', 'PROCESSOR_ARCHITECTURE', 'NUMBER_OF_PROCESSORS']) if (process.env[key]) env[key] = process.env[key]
for (const [key, dir] of Object.entries({ HOME: 'home', USERPROFILE: 'home', APPDATA: 'roaming', LOCALAPPDATA: 'local', XDG_CONFIG_HOME: 'config', XDG_DATA_HOME: 'data', XDG_CACHE_HOME: 'cache', XDG_STATE_HOME: 'state', TEMP: 'temp', TMP: 'temp', PI_CODING_AGENT_DIR: 'pi-agent', PI_CODING_AGENT_SESSION_DIR: 'pi-sessions' })) {
  env[key] = path.join(isolated, dir); fs.mkdirSync(env[key], { recursive: true })
}
Object.assign(env, { OPENCODE_DISABLE_AUTOUPDATE: 'true', OPENCODE_DISABLE_MODELS_FETCH: 'true', OPENCODE_DISABLE_DEFAULT_PLUGINS: 'true', OPENCODE_DISABLE_PROJECT_CONFIG: 'true', OPENCODE_DISABLE_EXTERNAL_SKILLS: 'true', OPENCODE_DISABLE_CLAUDE_CODE: 'true', OPENCODE_DISABLE_LSP_DOWNLOAD: 'true' })
const cwd = path.join(isolated, 'workspace'); fs.mkdirSync(cwd)
function binary(id) {
  const entry = manifest.runtimes.find(item => item.id === id)
  const executable = path.join(root, entry.artifact)
  const digest = crypto.createHash('sha256').update(fs.readFileSync(executable)).digest('hex')
  assert.equal(digest.toUpperCase(), entry.sha256.toUpperCase(), id + ' artifact digest differs from manifest')
  const version = execFileSync(executable, ['--version'], { cwd, env, windowsHide: true, timeout: 10000, encoding: 'utf8' }).trim()
  assert.equal(version, entry.version)
  evidence[id] = { executable, version, sha256: digest }
  return executable
}
function start(executable, args) {
  const child = spawn(executable, args, { cwd, env, stdio: 'pipe', windowsHide: true, shell: false })
  const item = { pid: child.pid, executable, args, stdout: '', stderr: '', exited: false }
  child.stdout.on('data', data => { item.stdout += data.toString() })
  child.stderr.on('data', data => { item.stderr += data.toString() })
  child.on('error', error => { item.error = error.message })
  child.once('exit', (code, signal) => { item.exited = true; item.code = code; item.signal = signal })
  children.push(child); evidence.processes.push(item)
  return child
}
async function close(child) {
  if (child.exitCode !== null || child.signalCode !== null) return
  const exited = new Promise(resolve => child.once('exit', resolve))
  child.stdin.end()
  const timer = setTimeout(() => child.kill(), 1000)
  try { await Promise.race([exited, new Promise((_, reject) => setTimeout(() => reject(new Error('Child cleanup timeout')), 6000).unref())]) } finally { clearTimeout(timer) }
  assert(child.exitCode !== null || child.signalCode !== null, 'child must exit')
}
async function freePort() {
  const server = net.createServer()
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve) })
  const port = server.address().port
  await new Promise(resolve => server.close(resolve))
  return port
}
try {
  const pi = binary('pi')
  const child = start(pi, ['--mode', 'rpc', '--no-session', '--no-extensions', '--no-skills', '--no-prompt-templates', '--no-themes'])
  const pending = new Map()
  const lines = readline.createInterface({ input: child.stdout })
  lines.on('line', line => {
    evidence.wire.push({ runtime: 'pi', direction: 'stdout', raw: line })
    let record; try { record = JSON.parse(line) } catch { return }
    if (record.type === 'response' && pending.has(record.id)) { const request = pending.get(record.id); pending.delete(record.id); clearTimeout(request.timer); request.resolve(record) }
  })
  const request = command => new Promise((resolve, reject) => {
    const timer = setTimeout(() => { pending.delete(command.id); reject(new Error('Pi RPC timeout: ' + command.type)) }, 15000)
    pending.set(command.id, { resolve, timer })
    const raw = JSON.stringify(command)
    evidence.wire.push({ runtime: 'pi', direction: 'stdin', raw })
    child.stdin.write(raw + '\n')
  })
  const state = await request({ id: 'p3_state_before', type: 'get_state' })
  assert.equal(state.success, true); assert.equal(state.command, 'get_state')
  assert.equal(state.data.isStreaming, false); assert.equal(state.data.isCompacting, false)
  assert.equal(state.data.messageCount, 0); assert.equal(state.data.pendingMessageCount, 0)
  assert.equal(typeof state.data.sessionId, 'string')
  const abort = await request({ id: 'p3_abort_idle', type: 'abort' })
  assert.equal(abort.success, true); assert.equal(abort.command, 'abort')
  const after = await request({ id: 'p3_state_after', type: 'get_state' })
  assert.equal(after.success, true); assert.equal(after.data.sessionId, state.data.sessionId); assert.equal(after.data.messageCount, 0)
  evidence.pi.state = state.data; evidence.pi.abort = abort
  await close(child); lines.close()

  const sourcePackage = JSON.parse(fs.readFileSync(path.join(source, 'packages/opencode/package.json'), 'utf8'))
  assert.equal(sourcePackage.version, '1.18.34')
  const routeFile = path.join(source, 'packages/protocol/src/groups/health.ts')
  const route = fs.readFileSync(routeFile, 'utf8')
  assert(route.includes('"/api/health"') && route.includes('healthy: Schema.Literal(true)'), 'source health route/payload must match')
  evidence.source = { packageVersion: sourcePackage.version, healthRouteFile: routeFile, healthRouteSource: route, gitIdentity: 'not available' }
  try { evidence.source.gitIdentity = execFileSync('git', ['-C', source, 'rev-parse', 'HEAD'], { encoding: 'utf8', timeout: 3000, windowsHide: true }).trim() } catch {}
  const opencode = binary('opencode')
  const port = await freePort()
  const server = start(opencode, ['serve', '--hostname=127.0.0.1', '--port=' + port])
  const url = 'http://127.0.0.1:' + port + '/api/health'
  const deadline = Date.now() + 30000
  let healthy = false
  while (Date.now() < deadline && server.exitCode === null && server.signalCode === null) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(1500) })
      const raw = await response.text()
      evidence.wire.push({ runtime: 'opencode', method: 'GET', url, status: response.status, raw })
      if (response.ok && JSON.parse(raw).healthy === true) { healthy = true; break }
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 250))
  }
  assert(healthy, 'OpenCode source-backed /api/health handshake failed')
  await close(server)
  evidence.passed = true
} catch (error) {
  evidence.error = error.stack || String(error)
  process.exitCode = 1
} finally {
  for (const child of children) { try { await close(child) } catch (error) { evidence.cleanupError = String(error); process.exitCode = 1; evidence.passed = false } }
  fs.mkdirSync(path.dirname(output), { recursive: true })
  fs.writeFileSync(output, JSON.stringify(evidence, null, 2))
  fs.rmSync(isolated, { recursive: true, force: true })
  console.log(JSON.stringify({ passed: evidence.passed, evidence: output, pi: evidence.pi?.version, opencode: evidence.opencode?.version, processesExited: evidence.processes.every(item => item.exited), error: evidence.error, cleanupError: evidence.cleanupError }, null, 2))
}
