import fs from 'fs'
import os from 'os'
import path from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

let root = ''
vi.mock('electron', () => ({ app: { getPath: () => root } }))

import { closeDatabase, initDatabase } from '../database'
import { callMcpTool, connectMcpServer, disconnectMcpServer, isMcpToolForcePrompt, listMcpServers, onMcpToolProgress, saveMcpServer, resolveRunnerRegistryEnv } from './mcp.service'

beforeEach(() => { root = fs.mkdtempSync(path.join(os.tmpdir(), 'grimoire-mcp-')) })
afterEach(() => { closeDatabase(); fs.rmSync(root, { recursive: true, force: true }); vi.unstubAllGlobals() })

describe('MCP transports', () => {
  it('connects to HTTP MCP, discovers tools, and calls an enabled tool', async () => {
    await initDatabase()
    const requests: Array<{ method: string; body: Record<string, unknown> }> = []
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body || '{}')) as Record<string, unknown>
      requests.push({ method: String(body.method), body })
      if (body.method === 'initialize') return new Response(JSON.stringify({ jsonrpc: '2.0', id: body.id, result: { protocolVersion: '2025-06-18', capabilities: {} } }), { status: 200, headers: { 'content-type': 'application/json', 'mcp-session-id': 'http-session' } })
      if (body.method === 'tools/list') return new Response(JSON.stringify({ jsonrpc: '2.0', id: body.id, result: { tools: [{ name: 'echo', description: 'Echo input', inputSchema: { type: 'object' } }] } }), { status: 200, headers: { 'content-type': 'application/json', 'mcp-session-id': 'http-session' } })
      return new Response(JSON.stringify({ jsonrpc: '2.0', id: body.id, result: { content: [{ type: 'text', text: 'ok' }] } }), { status: 200, headers: { 'content-type': 'application/json', 'mcp-session-id': 'http-session' } })
    }))
    const server = saveMcpServer({ name: 'HTTP Test', transport: 'http', endpoint: 'http://127.0.0.1:4000/mcp', enabled: true })
    const connected = await connectMcpServer(server.id)
    expect(connected.status).toBe('connected')
    expect(connected.tools).toHaveLength(1)
    const result = await callMcpTool({ serverId: server.id, name: 'echo', arguments: { value: 'hello' } })
    expect(result).toMatchObject({ content: [{ text: 'ok' }] })
    expect(requests.map(item => item.method)).toEqual(['initialize', 'notifications/initialized', 'tools/list', 'tools/call'])
  })

  it('starts a stdio MCP process, discovers tools, calls it, and cleans up', async () => {
    await initDatabase()
    const script = "const readline=require('readline');const r=readline.createInterface({input:process.stdin});r.on('line',line=>{const m=JSON.parse(line);if(!m.id)return;let result={};if(m.method==='initialize')result={protocolVersion:'2025-06-18',capabilities:{}};if(m.method==='tools/list')result={tools:[{name:'echo',inputSchema:{type:'object'}}]};if(m.method==='tools/call')result={content:[{type:'text',text:'stdio-ok'}]};process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:m.id,result})+'\\n')})"
    const server = saveMcpServer({ name: 'stdio Test', transport: 'stdio', command: process.execPath, args: ['-e', script], enabled: true })
    const connected = await connectMcpServer(server.id)
    expect(connected.status).toBe('connected')
    expect((await callMcpTool({ serverId: server.id, name: 'echo', arguments: {} })).content[0].text).toBe('stdio-ok')
    expect(disconnectMcpServer(server.id).status).toBe('disconnected')
  })

  it('maps the configured registry onto the package runner that reads it, and nothing else', () => {
    // The runner table keys on the command's leading token, mirroring the source
    // `RUNNERS` map. Asserted directly because the spawn env also inherits the parent
    // process env — where a registry variable may already be set on this machine — so a
    // child-reported value cannot distinguish "injected here" from "inherited".
    expect(resolveRunnerRegistryEnv('npx', 'https://reg.example')).toEqual({ NPM_CONFIG_REGISTRY: 'https://reg.example' })
    expect(resolveRunnerRegistryEnv('uvx', 'https://reg.example')).toEqual({ UV_DEFAULT_INDEX: 'https://reg.example', PIP_INDEX_URL: 'https://reg.example' })
    expect(resolveRunnerRegistryEnv('uv', 'https://reg.example')).toEqual({ UV_DEFAULT_INDEX: 'https://reg.example', PIP_INDEX_URL: 'https://reg.example' })
    // Whitespace around the command is tolerated (the form can carry it).
    expect(resolveRunnerRegistryEnv('  npx  ', 'https://reg.example')).toEqual({ NPM_CONFIG_REGISTRY: 'https://reg.example' })
    // Any other command — including a plain node binary — gets nothing, exactly as
    // upstream, so an unrelated registry URL cannot silently redirect a server.
    expect(resolveRunnerRegistryEnv('node', 'https://reg.example')).toEqual({})
    expect(resolveRunnerRegistryEnv('node', 'https://reg.example')).not.toHaveProperty('NPM_CONFIG_REGISTRY')
    // No URL configured means no injection at all.
    expect(resolveRunnerRegistryEnv('npx', '')).toEqual({})
  })

  it('lets the user env map override the derived registry, and injects nothing without a URL', async () => {
    await initDatabase()
    // The child reports the registry var it actually received, asserting the REAL spawn
    // env. (Spawning a runner-named shim is not portable here: on Windows a `.cmd` shim
    // cannot be spawned with `shell: false`, which is exactly why the runner TOKEN is
    // what the table keys on and the mapping itself is unit-tested above.)
    const script = "const readline=require('readline');const r=readline.createInterface({input:process.stdin});r.on('line',line=>{const m=JSON.parse(line);if(!m.id)return;let result={};if(m.method==='initialize')result={protocolVersion:'2025-06-18',capabilities:{}};if(m.method==='tools/list')result={tools:[{name:'echo',inputSchema:{type:'object'}}]};if(m.method==='tools/call')result={content:[{type:'text',text:String(process.env.NPM_CONFIG_REGISTRY)}]};process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:m.id,result})+'\\n')})"

    // A hand-set `env` entry wins over the derived registry value.
    const manual = saveMcpServer({
      name: 'Manual Env', transport: 'stdio', command: process.execPath, args: ['-e', script],
      registry_url: 'https://registry.invalid/derived', env: { NPM_CONFIG_REGISTRY: 'https://registry.invalid/manual' }, enabled: true
    })
    await connectMcpServer(manual.id)
    expect((await callMcpTool({ serverId: manual.id, name: 'echo', arguments: {} })).content[0].text)
      .toBe('https://registry.invalid/manual')
    disconnectMcpServer(manual.id)

    // No configured URL: the value can only come from the ambient environment, never
    // from a derived injection. A blank URL must not clear an inherited setting either.
    const bare = saveMcpServer({
      name: 'No Registry', transport: 'stdio', command: process.execPath, args: ['-e', script],
      registry_url: '', enabled: true
    })
    await connectMcpServer(bare.id)
    const reported = (await callMcpTool({ serverId: bare.id, name: 'echo', arguments: {} })).content[0].text as string
    expect(reported).not.toBe('https://registry.invalid/derived')
    disconnectMcpServer(bare.id)
  }, 15_000)

  it('rejects a stdio tool call once the per-request timeout elapses', async () => {
    await initDatabase()
    // A server that acknowledges initialize/tools but never answers tools/call.
    const script = "const readline=require('readline');const r=readline.createInterface({input:process.stdin});r.on('line',line=>{const m=JSON.parse(line);if(!m.id)return;if(m.method==='tools/call')return;let result={};if(m.method==='initialize')result={protocolVersion:'2025-06-18',capabilities:{}};if(m.method==='tools/list')result={tools:[{name:'echo',inputSchema:{type:'object'}}]};process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:m.id,result})+'\\n')})"
    const server = saveMcpServer({
      name: 'Timeout Test', transport: 'stdio', command: process.execPath, args: ['-e', script],
      timeout_seconds: 1, enabled: true
    })
    await connectMcpServer(server.id)
    await expect(callMcpTool({ serverId: server.id, name: 'echo', arguments: {} })).rejects.toThrow(/超时/)
    // The transport stays usable afterwards: only the call's deadline passed.
    expect(disconnectMcpServer(server.id).status).toBe('disconnected')
  }, 15_000)

  it('round-trips the per-tool "always allow" rule through the force-prompt gate', async () => {
    await initDatabase()
    const server = saveMcpServer({ name: 'Docs Server', transport: 'http', endpoint: 'https://mcp.invalid/sse', enabled: true })

    // Baseline: no rule, so the gate lets the session policy decide.
    expect(isMcpToolForcePrompt('mcp:' + server.id + ':search')).toBe(false)

    // A rule is written the way the source detail form writes one (denylist entry).
    saveMcpServer({ id: server.id, disabled_auto_approve_tools: ['search'] })
    expect(isMcpToolForcePrompt('mcp:' + server.id + ':search')).toBe(true)
    // Other tools on the same server are unaffected — the rule is per tool.
    expect(isMcpToolForcePrompt('mcp:' + server.id + ':write')).toBe(false)

    // "Always allow" GRANTS auto-approve by removing the tool from the denylist, which
    // is the write the compat action performs. Reading the server back the way that
    // action does proves the round trip end to end.
    const listed = listMcpServers().find(item => item.id === server.id)!
    expect(listed.disabled_auto_approve_tools).toEqual(['search'])
    // "Always allow" writes the denylist back WITHOUT the granted tool. (The deny-list
    // transform itself is unit-tested in the compat project, next to the action that
    // performs it; this asserts the gate flips once that write lands.)
    saveMcpServer({ id: server.id, disabled_auto_approve_tools: listed.disabled_auto_approve_tools.filter(name => name !== 'search') })
    expect(isMcpToolForcePrompt('mcp:' + server.id + ':search')).toBe(false)
  })

  it('matches a force-prompt rule by the source wire id and the server-wide wildcard', async () => {
    await initDatabase()
    // A server name with characters the slug must fold, so the wire id differs from
    // the raw name (source `buildMcpToolWireId`).
    const server = saveMcpServer({ name: 'Docs Server', transport: 'http', endpoint: 'https://mcp.invalid/sse', enabled: true })
    const slugged = 'mcp__docsServer__search'

    saveMcpServer({ id: server.id, disabled_auto_approve_tools: [slugged] })
    expect(isMcpToolForcePrompt('mcp:' + server.id + ':search')).toBe(true)

    // `mcp__<server>__*` forces every tool on that server to prompt.
    saveMcpServer({ id: server.id, disabled_auto_approve_tools: ['mcp__docsServer__*'] })
    expect(isMcpToolForcePrompt('mcp:' + server.id + ':search')).toBe(true)
    expect(isMcpToolForcePrompt('mcp:' + server.id + ':write')).toBe(true)

    // Rules never leak across servers, and a non-MCP tool name is never gated.
    const other = saveMcpServer({ name: 'Other', transport: 'http', endpoint: 'https://other.invalid/sse', enabled: true })
    expect(isMcpToolForcePrompt('mcp:' + other.id + ':search')).toBe(false)
    expect(isMcpToolForcePrompt('bash')).toBe(false)
    expect(isMcpToolForcePrompt('mcp:unknown_server:search')).toBe(false)
  })

  it('forwards stdio tool-call progress as the source McpProgressEvent, attributed by callId', async () => {
    await initDatabase()
    // The server streams `notifications/progress` twice with a `total` (ratio =
    // progress/total) and once WITHOUT one (falls back to progress/1).
    const script = `const readline=require('readline')
const r=readline.createInterface({input:process.stdin})
r.on('line',line=>{
  const m=JSON.parse(line)
  if(!m.id)return
  if(m.method==='initialize')return process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:m.id,result:{protocolVersion:'2025-06-18',capabilities:{}}})+'\\n')
  if(m.method==='tools/list')return process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:m.id,result:{tools:[{name:'report',inputSchema:{type:'object'}}]}})+'\\n')
  if(m.method==='tools/call'){
    const send=(params)=>process.stdout.write(JSON.stringify({jsonrpc:'2.0',method:'notifications/progress',params:Object.assign({requestId:m.id},params)})+'\\n')
    send({progressToken:'t1',progress:1,total:4})
    send({progressToken:'t1',progress:2,total:4})
    send({progressToken:'t1',progress:3})
    // A notification for a DIFFERENT request must not be attributed to this call.
    send({requestId:99999,progressToken:'other',progress:4,total:4})
    return process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:m.id,result:{content:[{type:'text',text:'done'}]}})+'\\n')
  }
})`
    const server = saveMcpServer({ name: 'Progress Test', transport: 'stdio', command: process.execPath, args: ['-e', script], enabled: true })
    await connectMcpServer(server.id)

    const seen: Array<{ callId: string; progress: number }> = []
    const unsubscribe = onMcpToolProgress(event => seen.push(event))
    try {
      await callMcpTool({ serverId: server.id, name: 'report', arguments: {}, callId: 'call_abc' })
    } finally {
      unsubscribe()
    }

    // Ratios are normalized like the source (`progress / (total || 1)`), then clamped
    // into 0–1 because the source renders this value directly as a percentage
    // (`progress * 100` in `MessageMcpTool`). The third notification carries no `total`
    // AND a progress of 3, so it would exceed the range — the clamp is what keeps the
    // ring honest instead of overflowing.
    expect(seen).toEqual([
      { callId: 'call_abc', progress: 0.25 },
      { callId: 'call_abc', progress: 0.5 },
      { callId: 'call_abc', progress: 1 }
    ])
    // The unrelated request id is not attributed, and no event leaks an unknown callId.
    expect(seen.every(event => event.callId === 'call_abc')).toBe(true)
    disconnectMcpServer(server.id)
  }, 15_000)

  it('does not emit progress for a call that supplied no callId', async () => {
    await initDatabase()
    const script = `const readline=require('readline')
const r=readline.createInterface({input:process.stdin})
r.on('line',line=>{
  const m=JSON.parse(line)
  if(!m.id)return
  if(m.method==='initialize')return process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:m.id,result:{protocolVersion:'2025-06-18',capabilities:{}}})+'\\n')
  if(m.method==='tools/list')return process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:m.id,result:{tools:[{name:'report',inputSchema:{type:'object'}}]}})+'\\n')
  if(m.method==='tools/call'){
    process.stdout.write(JSON.stringify({jsonrpc:'2.0',method:'notifications/progress',params:{requestId:m.id,progressToken:'t',progress:1,total:2}})+'\\n')
    return process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:m.id,result:{content:[{type:'text',text:'done'}]}})+'\\n')
  }
})`
    const server = saveMcpServer({ name: 'No CallId', transport: 'stdio', command: process.execPath, args: ['-e', script], enabled: true })
    await connectMcpServer(server.id)
    const seen: unknown[] = []
    const unsubscribe = onMcpToolProgress(event => seen.push(event))
    try {
      await callMcpTool({ serverId: server.id, name: 'report', arguments: {} })
    } finally {
      unsubscribe()
    }
    // Without a callId there is no renderer-side tool block to attribute to, so the
    // event is dropped rather than broadcast with an empty/guessed id.
    expect(seen).toEqual([])
    disconnectMcpServer(server.id)
  }, 15_000)

  it('lets Long Running Mode progress notifications keep a slow call alive past its timeout', async () => {
    await initDatabase()
    // The server streams progress on the SAME request id every 400ms and only answers
    // after ~2.4s — well past the 1s per-request budget. Without the progress reset this
    // call would be rejected at 1s; with it, each notification pushes the deadline out.
    const script = [
      "const readline=require('readline')",
      "const r=readline.createInterface({input:process.stdin})",
      "r.on('line',line=>{",
      "  const m=JSON.parse(line)",
      "  if(!m.id)return",
      "  if(m.method==='initialize')return process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:m.id,result:{protocolVersion:'2025-06-18',capabilities:{}}})+'\\n')",
      "  if(m.method==='tools/list')return process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:m.id,result:{tools:[{name:'slow',inputSchema:{type:'object'}}]}})+'\\n')",
      "  if(m.method==='tools/call'){",
      "    let ticks=0",
      "    const timer=setInterval(()=>{",
      "      ticks+=1",
      "      process.stdout.write(JSON.stringify({jsonrpc:'2.0',method:'notifications/progress',params:{requestId:m.id,progressToken:m.id,progress:ticks}})+'\\n')",
      "      if(ticks>=6){clearInterval(timer);process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:m.id,result:{content:[{type:'text',text:'slow-done'}]}})+'\\n')}",
      "    },400)",
      "    return",
      "  }",
      "})"
    ].join(';')
    const server = saveMcpServer({
      name: 'Long Running Test', transport: 'stdio', command: process.execPath, args: ['-e', script],
      timeout_seconds: 1, long_running: true, enabled: true
    })
    await connectMcpServer(server.id)
    const result = await callMcpTool({ serverId: server.id, name: 'slow', arguments: {} })
    expect(result.content[0].text).toBe('slow-done')

    // Control: the SAME server behaviour without the flag must still time out at 1s —
    // progress notifications are only allowed to extend a Long Running call.
    const strict = saveMcpServer({
      name: 'Strict Test', transport: 'stdio', command: process.execPath, args: ['-e', script],
      timeout_seconds: 1, long_running: false, enabled: true
    })
    await connectMcpServer(strict.id)
    await expect(callMcpTool({ serverId: strict.id, name: 'slow', arguments: {} })).rejects.toThrow(/超时/)
    disconnectMcpServer(server.id)
    disconnectMcpServer(strict.id)
  }, 20_000)
})
