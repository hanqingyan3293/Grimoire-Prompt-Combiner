import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawn } from 'node:child_process'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm'
const environment = { ...process.env, GRIMOIRE_OPEN_CHERRY: '1' }
const children = []
let stopping = false

function start(args) {
  const child = spawn(npm, args, { cwd: root, env: environment, stdio: 'inherit', shell: process.platform === 'win32' })
  children.push(child)
  child.on('exit', code => {
    if (stopping) return
    stopping = true
    for (const other of children) if (other !== child && !other.killed) other.kill()
    process.exit(code || 0)
  })
}

start(['run', 'dev:renderer'])
start(['run', 'dev:electron'])

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    if (stopping) return
    stopping = true
    for (const child of children) if (!child.killed) child.kill(signal)
  })
}
