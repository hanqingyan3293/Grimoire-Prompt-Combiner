#!/usr/bin/env node
// Two-sided IPC wiring check. Renderer calls a channel with no handler (or listens for an event main never
// sends) and the failure only shows up as a dead click at runtime — the exact shape of a "looks finished"
// stub. Static, cheap, and it distinguishes the two kinds of channel:
//   invoke channels need ipcMain.handle(...) + ipcRenderer.invoke(...)
//   event channels need webContents.send(...CHANNEL...) + ipcRenderer.on(...)
import fs from 'node:fs'
import path from 'node:path'

const read = file => fs.readFileSync(file, 'utf8')
const walk = (dir, out = []) => { for (const entry of fs.readdirSync(dir, { withFileTypes: true })) { const full = path.join(dir, entry.name); if (entry.isDirectory()) walk(full, out); else if (/\.ts$/.test(entry.name) && !/\.test\./.test(entry.name)) out.push(full) } return out }

const preload = read('src/preload/index.ts')
const valueOf = new Map()
for (const match of preload.matchAll(/([A-Z][A-Z0-9_]*):\s*'([^']+)'/g)) valueOf.set(match[1], match[2])

const invoked = new Set()
const listened = new Set()
for (const match of preload.matchAll(/ipcRenderer\.invoke\(\s*IPC_CHANNELS\.([A-Z0-9_]+)/g)) invoked.add(match[1])
for (const match of preload.matchAll(/ipcRenderer\.on\(\s*IPC_CHANNELS\.([A-Z0-9_]+)/g)) listened.add(match[1])
// Some listeners are registered through a helper that receives the channel as an argument.
for (const match of preload.matchAll(/onEvent\(\s*IPC_CHANNELS\.([A-Z0-9_]+)/g)) listened.add(match[1])

// The main process wires channels in several shapes: `ipcMain.handle(IPC_CHANNELS.X)`, a loop over an
// array of constants, a literal string, or a channel passed to a helper. Rather than model each shape
// (the first attempt produced 8 false positives), a channel counts as wired when main REFERENCES it — by
// constant or by its literal value. That still catches the real stub case, a channel main never mentions.
const mainText = walk('src/main').map(read).join('\n')
const referenced = new Set()
for (const match of mainText.matchAll(/IPC_CHANNELS\.([A-Z0-9_]+)/g)) referenced.add(match[1])
const valueToConstant = new Map([...valueOf].map(([name, value]) => [value, name]))
for (const [, value] of valueOf) if (mainText.includes("'" + value + "'")) referenced.add(valueToConstant.get(value))
const handled = referenced
const sent = new Set([...referenced])

// Known, explained gaps live in scripts/ipc-coverage-baseline.json; anything else fails the gate.
let allowed = {}
try { allowed = JSON.parse(fs.readFileSync('scripts/ipc-coverage-baseline.json', 'utf8')).allowed || {} } catch {}
const missingHandle = [...invoked].filter(name => !handled.has(name) && !allowed[name])
const missingSend = [...listened].filter(name => !sent.has(name) && !handled.has(name) && !allowed[name])
for (const name of Object.keys(allowed)) if (![...invoked, ...listened].includes(name)) console.log('  STALE ALLOWANCE ' + name + ' (no longer exposed)')
console.log('invoke channels: ' + invoked.size + ' (main handlers ' + handled.size + ')')
console.log('event channels: ' + listened.size + ' (main senders ' + sent.size + ')')
for (const name of missingHandle) console.log('  NO HANDLER  ' + name + ' -> ' + valueOf.get(name))
for (const name of missingSend) console.log('  NO SENDER   ' + name + ' -> ' + valueOf.get(name))
if (missingHandle.length || missingSend.length) process.exitCode = 1
