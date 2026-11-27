// Launch the built renderer (dist/renderer) exactly as the gate snapshots measured it.
//
// Why not `electron .` alone: this app is unpackaged, so main/index.ts falls back to
// http://localhost:5173 when VITE_DEV_SERVER_URL is unset. Without Vite you get a blank window.
// This script serves dist/renderer on an ephemeral port and points the app at it.
//
// It also recovers from the known intermittent first navigation that leaves the window on
// about:blank (tracked as an S2/V2 investigation item in .agent/STATE.md): if the page never
// commits, it re-navigates once through the DevTools protocol. Any recovery is printed.
//
// Usage:
//   node scripts/launch-dist.mjs                        # real user profile (your normal data)
//   node scripts/launch-dist.mjs --profile=D:/tmp/x     # isolated userData, never touches real DB
//   node scripts/launch-dist.mjs --port=5180 -- --remote-debugging-port=9333
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import http from 'node:http'
import net from 'node:net'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const rendererRoot = path.join(root, 'dist/renderer')
const entry = path.join(root, 'dist/main/main/index.js')
if (!fs.existsSync(entry) || !fs.existsSync(path.join(rendererRoot, 'index.html'))) {
  console.error('[launch-dist] dist is missing. Run `npm run build` first.')
  process.exit(1)
}

const argv = process.argv.slice(2)
const option = (name) => argv.find((value) => value.startsWith(`--${name}=`))?.slice(name.length + 3)
const passthroughIndex = argv.indexOf('--')
const passthrough = passthroughIndex >= 0 ? argv.slice(passthroughIndex + 1) : []
const profile = option('profile')
const requestedPort = Number(option('port') ?? '0')

const mime = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.wasm': 'application/wasm',
  '.map': 'application/json; charset=utf-8',
}

const server = http.createServer((request, response) => {
  try {
    const name = decodeURIComponent(new URL(request.url, 'http://127.0.0.1').pathname)
    const file = path.resolve(rendererRoot, `.${name === '/' ? '/index.html' : name}`)
    if (!file.startsWith(rendererRoot + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
      response.writeHead(404)
      response.end('not found')
      return
    }
    response.setHeader('content-type', mime[path.extname(file)] ?? 'application/octet-stream')
    fs.createReadStream(file).pipe(response)
  } catch {
    response.writeHead(400)
    response.end('bad request')
  }
})

await new Promise((resolve, reject) => {
  server.once('error', reject)
  server.listen(requestedPort, '127.0.0.1', resolve)
})
const rendererUrl = `http://127.0.0.1:${server.address().port}`
console.log(`[launch-dist] renderer ${rendererUrl} -> ${path.relative(root, rendererRoot)}`)

async function freePort() {
  return await new Promise((resolve, reject) => {
    const probe = net.createServer()
    probe.once('error', reject)
    probe.listen(0, '127.0.0.1', () => {
      const port = probe.address().port
      probe.close(() => resolve(port))
    })
  })
}

const explicitDebug = passthrough.some((value) => value.startsWith('--remote-debugging-port'))
const debugPort = explicitDebug ? null : await freePort()
const env = { ...process.env, VITE_DEV_SERVER_URL: rendererUrl }
delete env.ELECTRON_RUN_AS_NODE
const args = [
  '.',
  ...(profile ? [`--user-data-dir=${path.resolve(profile)}`] : []),
  ...(debugPort ? [`--remote-debugging-port=${debugPort}`] : []),
  ...passthrough,
]
if (profile) console.log(`[launch-dist] isolated profile ${path.resolve(profile)}`)
console.log(`[launch-dist] electron ${args.join(' ')}`)

const electron = spawn(path.join(root, 'node_modules/electron/dist/electron.exe'), args, {
  cwd: root,
  env,
  stdio: 'inherit',
  windowsHide: false,
})

// First-navigation recovery. Give the app time to boot (a fresh profile imports built-in
// assets and can take ~20s before the window exists), then only act when the page is blank.
async function recoverWhenBlank() {
  if (!debugPort) return
  const { WebSocket } = await import('ws')
  const deadline = Date.now() + 120000
  let ws = null
  let call = null
  const connect = async (url) => {
    ws = new WebSocket(url)
    await new Promise((resolve, reject) => {
      ws.once('open', resolve)
      ws.once('error', reject)
    })
    let serial = 0
    const pending = new Map()
    ws.on('message', (bytes) => {
      const message = JSON.parse(bytes.toString())
      const waiter = pending.get(message.id)
      if (!waiter) return
      pending.delete(message.id)
      message.error ? waiter.reject(new Error(JSON.stringify(message.error))) : waiter.resolve(message.result)
    })
    call = (method, params = {}) => new Promise((resolve, reject) => {
      const id = ++serial
      pending.set(id, { resolve, reject })
      ws.send(JSON.stringify({ id, method, params }))
    })
    await call('Page.enable')
  }
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 1200))
    if (electron.exitCode !== null) return
    let targets = []
    try {
      targets = (await (await fetch(`http://127.0.0.1:${debugPort}/json/list`)).json()).filter((item) => item.type === 'page')
    } catch {
      continue
    }
    if (!targets.length) continue
    if (!ws || ws.readyState !== 1) {
      try { await connect(targets[0].webSocketDebuggerUrl) } catch { continue }
    }
    let state = null
    try {
      // A page with no committed document has no execution context yet, so evaluating throws here.
      // That IS the blank-window case, so navigate instead of silently looping until the deadline.
      state = (await call('Runtime.evaluate', {
        expression: 'JSON.stringify({ href: location.href, title: document.title, root: document.getElementById("root")?.childElementCount ?? null })',
        returnByValue: true,
      })).result.value
    } catch {
      try {
        await call('Page.navigate', { url: rendererUrl })
        console.log('[launch-dist] no execution context yet (blank page); forced navigation sent')
      } catch {
        console.log('[launch-dist] could not navigate yet; retrying')
      }
      continue
    }
    const parsed = JSON.parse(state ?? '{}')
    if (parsed.href && parsed.href !== 'about:blank' && parsed.root > 0) {
      console.log(`[launch-dist] window ready: ${parsed.href} "${parsed.title}"`)
      ws.close()
      return
    }
    try {
      const result = await call('Page.navigate', { url: rendererUrl })
      console.log(`[launch-dist] first navigation had not committed (${parsed.href || 'empty'}); forced navigation ${result.frameId ? 'sent' : 'attempted'}`)
    } catch {
      console.log('[launch-dist] forced navigation failed; press Ctrl+R in the window if it stays blank')
    }
  }
  ws?.close()
}

void recoverWhenBlank().catch(() => {})

electron.on('exit', (code, signal) => {
  server.close()
  console.log(`[launch-dist] electron exited code=${code} signal=${signal ?? ''}`)
  process.exit(code ?? 0)
})
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => electron.kill(signal))
