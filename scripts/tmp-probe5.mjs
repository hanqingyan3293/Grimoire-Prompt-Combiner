import { spawn, spawnSync } from 'node:child_process'
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path'
const devPort = 5422, devUrl = 'http://localhost:' + devPort
const vite = spawn('npx.cmd', ['vite', '--port', String(devPort), '--strictPort'], { cwd: process.cwd(), stdio: 'ignore', shell: true })
await new Promise(r => setTimeout(r, 9000))
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'probe5-'))
const el = spawn('npx.cmd', ['electron', '.', '--user-data-dir=' + tmp, '--remote-debugging-port=0'], { cwd: process.cwd(), env: { ...process.env, ELECTRON_RUN_AS_NODE: undefined, VITE_DEV_SERVER_URL: devUrl }, stdio: 'ignore', shell: true })
await new Promise(r => setTimeout(r, 25000))
const port = Number(fs.readFileSync(path.join(tmp, 'DevToolsActivePort'), 'utf8').trim().split(/\r?\n/)[0])
const list = await (await fetch('http://127.0.0.1:' + port + '/json/list')).json()
console.log('TARGETS', JSON.stringify(list.map(t => ({ id: t.id.slice(0, 8), url: t.url, type: t.type, title: t.title }))))
const { WebSocket } = await import('ws')
for (const target of list) {
  const ws = new WebSocket(target.webSocketDebuggerUrl)
  await new Promise((resolve, reject) => { ws.on('open', resolve); ws.on('error', reject) })
  let id = 1; const pending = new Map()
  ws.on('message', raw => { const m = JSON.parse(raw); const s = pending.get(m.id); if (s) { pending.delete(m.id); s(m.result) } })
  const call = (method, params) => new Promise(r => { const i = id++; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })) })
  await call('Runtime.enable', {})
  const res = await call('Runtime.evaluate', { expression: 'location.href + "|" + document.readyState + "|" + document.body.innerText.length', returnByValue: true })
  console.log('EVAL', target.type, JSON.stringify(res.result?.value))
  ws.close()
}
el.kill(); vite.kill()
spawnSync('powershell.exe', ['-NoProfile', '-Command', "Get-CimInstance Win32_Process -Filter \"Name='electron.exe'\" | Where-Object { $_.CommandLine -like '*probe5-*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }"], { stdio: 'ignore' })
process.exit(0)
