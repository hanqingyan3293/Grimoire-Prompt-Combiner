#!/usr/bin/env node
/** Local, fake-provider gate for the actual compiled SDK adapter; no real keys. */
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdtemp, mkdir, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const require = createRequire(import.meta.url)
const messageText = message => typeof message?.content === 'string' ? message.content
  : Array.isArray(message?.content) ? message.content.filter(part => part.type === 'text').map(part => part.text).join('') : ''

export async function runPiSdkRuntimeSmoke() {
  const { PiSdkRuntime } = require(join(root, 'dist/main/main/ai/runtime/pi-sdk.runtime.js'))
  const { buildPiProviderInjection } = require(join(root, 'dist/main/integrations/pi/modelInjection.js'))
  const fixtureKey = 'pi-sdk-fixture-not-a-real-secret-101'
  const temp = await realpath(await mkdtemp(join(tmpdir(), 'grimoire-pi-sdk-')))
  const cwd = join(temp, 'workspace')
  const state = join(temp, 'execution')
  await mkdir(cwd)
  await mkdir(state)
  // Prove the loader does not read project instructions or execute extensions.
  await mkdir(join(cwd, '.pi'))
  await writeFile(join(cwd, 'AGENTS.md'), 'FORBIDDEN_CONTEXT_SENTINEL')
  await writeFile(join(cwd, '.pi', 'settings.json'), JSON.stringify({
    extensions: ['./must-not-load.mjs'], packages: ['must-not-install'],
    skills: ['./must-not-read'], prompts: ['./must-not-read'],
  }))
  await writeFile(join(cwd, '.pi', 'must-not-load.mjs'), 'throw new Error("FORBIDDEN_EXTENSION_SENTINEL")')
  const requests = []
  const sockets = new Set()
  let blockedResolve
  const blocked = new Promise(resolve => { blockedResolve = resolve })
  let calls = 0
  const server = createServer(async (req, res) => {
    try {
      if (req.method !== 'POST' || req.url !== '/v1/chat/completions') {
        res.writeHead(404).end()
        return
      }
      const chunks = []
      for await (const chunk of req) chunks.push(chunk)
      const body = JSON.parse(Buffer.concat(chunks).toString())
      assert.equal(req.headers.authorization, `Bearer ${fixtureKey}`)
      assert.ok(!JSON.stringify(body).includes('FORBIDDEN_CONTEXT_SENTINEL'))
      if (body.tools?.length) assert.deepEqual(body.tools.map(tool => tool.function.name), ['grimoire_echo'])
      requests.push(body)
      const users = body.messages.filter(message => message.role === 'user')
      const userText = messageText(users.at(-1))
      if (userText === 'hold-for-cancel') {
        blockedResolve()
        res.writeHead(200, { 'Content-Type': 'text/event-stream' })
        res.flushHeaders()
        return
      }
      if (userText === 'provider-error') {
        res.writeHead(400, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: { message: `provider must redact ${fixtureKey}`, type: 'invalid_request_error' } }))
        return
      }
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' })
      const push = (delta, finish_reason = null, usage) => res.write(`data: ${JSON.stringify({
        id: `fixture-${requests.length}`, object: 'chat.completion.chunk', created: 1,
        model: 'fixture-model', choices: [{ index: 0, delta, finish_reason }], ...(usage ? { usage } : {}),
      })}\n\n`)
      push({ role: 'assistant' })
      if (userText?.startsWith('tool:') && body.messages.at(-1)?.role !== 'tool') {
        push({ tool_calls: [{ index: 0, id: `fixture-call-${++calls}`, type: 'function',
          function: { name: 'grimoire_echo', arguments: JSON.stringify({ value: userText.slice(5) }) } }] })
        push({}, 'tool_calls', { prompt_tokens: 12, completion_tokens: 4, total_tokens: 16 })
      } else {
        const output = !body.tools?.length ? `summary ${fixtureKey}` : body.messages.at(-1)?.role === 'tool'
          ? `tool-result:${body.messages.at(-1).content}`
          : userText === 'echo-key' ? `provider echo ${fixtureKey}` : `answer-${users.length}`
        const split = output.includes(fixtureKey) ? output.indexOf(fixtureKey) + Math.floor(fixtureKey.length / 2) : output.length
        push({ content: output.slice(0, split) })
        if (split < output.length) push({ content: output.slice(split) })
        push({}, 'stop', { prompt_tokens: 12, completion_tokens: 4, total_tokens: 16 })
      }
      res.end('data: [DONE]\n\n')
    } catch {
      res.writeHead(500).end('fixture failure')
    }
  })
  server.on('connection', socket => { sockets.add(socket); socket.on('close', () => sockets.delete(socket)) })
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve) })
  const address = server.address()
  const injection = buildPiProviderInjection({
    id: 'grimoire-fixture', name: 'Fixture', baseUrl: `http://127.0.0.1:${address.port}/v1`,
    api: 'openai-completions', route: 'direct-api-key',
  }, {
    id: 'grimoire-fixture::fixture-model', providerId: 'grimoire-fixture', apiModelId: 'fixture-model',
    name: 'Fixture model', capabilities: [], contextWindow: 128_000, maxOutputTokens: 256,
  }, fixtureKey)
  let executed = 0
  const config = {
    enabled: true, ownerId: 'smoke-owner', cwd, model: 'grimoire-fixture::fixture-model', injection,
    executionStateDir: state, toolAllowlist: ['grimoire_echo'],
    turnTimeoutMs: 15_000, permissionTimeoutMs: 5_000, enableFork: true, enableCompaction: true,
    customTools: [{ name: 'grimoire_echo', description: 'Return a fixture value only',
      parameters: { type: 'object', properties: { value: { type: 'string' } }, required: ['value'], additionalProperties: false },
      execute: async input => { executed++; return { echo: input.value } },
    }],
  }
  const runtimes = []
  const runtime = new PiSdkRuntime(config)
  runtimes.push(runtime)
  const transcriptEvents = []
  async function prompt(runtime, session, text, decision) {
    const input = [...session.messages, { role: 'user', content: text }]
    const events = []
    for await (const event of runtime.send({ sessionId: session.id, model: session.model, messages: input })) {
      events.push(event)
      if (event.type === 'permission-requested') {
        assert.ok(decision, 'unexpected permission request')
        await assert.rejects(runtime.approve({ requestId: event.requestId, decision, sessionId: 'foreign-session' }))
        await runtime.approve({ requestId: event.requestId, decision, sessionId: session.id,
          callId: event.detail.toolCallId, action: event.action })
        await assert.rejects(runtime.approve({ requestId: event.requestId, decision, sessionId: session.id }))
      }
    }
    transcriptEvents.push(...events)
    const terminal = events.filter(event => ['completed', 'failed', 'cancelled'].includes(event.type))
    assert.equal(terminal.length, 1, 'exactly one terminal event required')
    assert.equal(terminal[0].type, 'completed', JSON.stringify(terminal))
    session.messages = [...input, { role: 'assistant', content: terminal[0].text }]
    assert.ok(!events.some(event => event.type === 'completed' && event.toolOwnership === 'host'))
    return events
  }
  try {
    const session = runtime.createSession(config.model)
    await prompt(runtime, session, 'first')
    await prompt(runtime, session, 'second')
    assert.equal(requests.length, 2)
    assert.ok(requests[1].messages.some(message => message.role === 'assistant' && message.content === 'answer-1'))
    const reference = runtime.getNativeSessionReference(session.id)
    assert.ok(reference?.checkpointId && reference.nativeSessionId)
    assert.ok(!JSON.stringify(reference).includes(fixtureKey))
    assert.ok(!JSON.stringify(runtime).includes(fixtureKey))
    await runtime.close()
    const resumed = new PiSdkRuntime({ ...config, sessionReferences: { [session.id]: reference } })
    runtimes.push(resumed)
    resumed.loadSession(session)
    await prompt(resumed, session, 'third-after-resume')
    assert.ok(requests.at(-1).messages.some(message => message.role === 'user' && messageText(message) === 'first'))
    assert.equal(resumed.getNativeSessionReference(session.id).nativeSessionId, reference.nativeSessionId)
    const fork = await resumed.forkSession(session.id)
    const forkReference = resumed.getNativeSessionReference(fork.id)
    assert.notEqual(forkReference.nativeSessionId, reference.nativeSessionId)
    assert.equal(forkReference.parentSessionFile, reference.sessionFile)
    await prompt(resumed, fork, 'fork-independent')
    assert.equal(resumed.getNativeSessionReference(session.id).nativeSessionId, reference.nativeSessionId)
    await prompt(resumed, fork, 'compaction-context '.repeat(6000))
    const compactionEvents = []
    for await (const event of resumed.compactSession(fork.id)) compactionEvents.push(event)
    assert.deepEqual(compactionEvents.map(event => event.type), ['compaction-started', 'compaction-finished'])
    assert.ok((await readFile(resumed.getNativeSessionReference(fork.id).sessionFile, 'utf8')).includes('"type":"compaction"'))

    const once = await prompt(resumed, session, 'tool:once', 'accept')
    assert.equal(executed, 1)
    assert.equal(once.filter(event => event.type === 'permission-requested').length, 1)
    await prompt(resumed, session, 'tool:once', 'decline')
    assert.equal(executed, 1, 'allow-once must not persist a grant')
    await prompt(resumed, session, 'tool:session', 'acceptForSession')
    const granted = await prompt(resumed, session, 'tool:session')
    assert.equal(granted.filter(event => event.type === 'permission-requested').length, 0)
    assert.equal(executed, 3)
    await prompt(resumed, session, 'tool:different-input', 'decline')
    assert.equal(executed, 3, 'session grant must not authorize other tool input')
    const echoEvents = await prompt(resumed, session, 'echo-key')
    assert.ok(!echoEvents.filter(event => event.type === 'text-delta').map(event => event.text).join('').includes(fixtureKey), 'split secret escaped in text deltas')
    assert.ok(!JSON.stringify(echoEvents).includes(fixtureKey))
    const validRef = resumed.getNativeSessionReference(session.id)
    const badResume = new PiSdkRuntime({ ...config, sessionReferences: { [session.id]: { ...validRef, nativeStateDigest: '0'.repeat(64) } } })
    runtimes.push(badResume)
    badResume.loadSession(session)
    const rejected = []
    const beforeRejected = requests.length
    for await (const event of badResume.send({ sessionId: session.id, model: config.model,
      messages: [...session.messages, { role: 'user', content: 'must-not-contact-provider' }] })) rejected.push(event)
    assert.equal(rejected.at(-1).type, 'failed')
    assert.equal(requests.length, beforeRejected, 'tampered native digest must fail before model invocation')

    const cancelledSession = resumed.createSession(config.model)
    const cancelEvents = []
    const cancelled = (async () => {
      for await (const event of resumed.send({ sessionId: cancelledSession.id, model: config.model,
        messages: [{ role: 'user', content: 'hold-for-cancel' }] })) cancelEvents.push(event)
    })()
    await Promise.race([blocked, new Promise((_, reject) => setTimeout(() => reject(new Error('cancel fixture admission timeout')), 10_000).unref())])
    await resumed.interrupt(cancelledSession.id)
    await cancelled
    assert.deepEqual(cancelEvents.filter(event => ['completed', 'failed', 'cancelled'].includes(event.type)).map(event => event.type), ['cancelled'])

    const errorSession = resumed.createSession(config.model)
    const errorEvents = []
    for await (const event of resumed.send({ sessionId: errorSession.id, model: config.model,
      messages: [{ role: 'user', content: 'provider-error' }] })) errorEvents.push(event)
    assert.equal(errorEvents.at(-1).type, 'failed')
    assert.ok(!JSON.stringify(errorEvents).includes(fixtureKey))
    // The source pre-persistence message_end replacement must redact provider
    // errors too, not just renderer events or success completions.
    async function nativeFiles(path) {
      for (const item of await readdir(path, { withFileTypes: true })) {
        const file = join(path, item.name)
        if (item.isDirectory()) await nativeFiles(file)
        else assert.ok(!(await readFile(file, 'utf8')).includes(fixtureKey), 'fixture key persisted in native JSONL')
      }
    }
    await nativeFiles(state)
    assert.ok(transcriptEvents.some(event => event.type === 'tool-started' && event.ownership === 'runtime'))
    return { sdk: '1.0.1', prompts: 2, resume: true, fullHistoryFork: true, customToolAllowOnce: true,
      deny: true, exactInputSessionGrant: true, cancellation: true, providerErrorRedactedBeforePersistence: true,
      splitSecretDeltaRedacted: true, nativeStateDigestMismatchRejected: true, summarySecretRedacted: true,
      externalResources: false, nativeTools: false, requests: requests.length, executedTools: executed,
      compaction: true, cleanup: true }
  } finally {
    await Promise.all(runtimes.map(runtime => runtime.close()))
    for (const socket of sockets) socket.destroy()
    await new Promise(resolve => server.close(resolve))
    await rm(temp, { recursive: true, force: true })
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const deadline = setTimeout(() => { process.stderr.write('Pi SDK smoke exceeded its bounded deadline\n'); process.exit(1) }, 90_000)
  try {
    process.stdout.write(`${JSON.stringify(await runPiSdkRuntimeSmoke())}\n`)
  } catch (error) {
    // All credentials are fixture-only, but do not print opaque provider objects.
    process.stderr.write(`Pi SDK runtime smoke failed: ${error instanceof Error ? error.message : 'unknown failure'}\n`)
    process.exitCode = 1
  } finally {
    clearTimeout(deadline)
  }
}
