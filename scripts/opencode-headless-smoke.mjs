import http from "node:http"
import net from "node:net"
import path from "node:path"
import { once } from "node:events"
import { spawn } from "node:child_process"

const root = path.resolve(process.cwd())
const executable = process.env.GRIMOIRE_OPENCODE_EXE || path.join(root, "resources", "agent-runtimes", "opencode", "opencode.exe")

function listen(server, host = "127.0.0.1") {
  return new Promise((resolve, reject) => {
    server.once("error", reject)
    server.listen(0, host, () => {
      const address = server.address()
      if (!address || typeof address === "string") return reject(new Error("无法取得本地测试端口"))
      resolve(address.port)
    })
  })
}

function reservePort() {
  const server = net.createServer()
  return listen(server).then(() => {
    const address = server.address()
    const port = typeof address === "object" && address ? address.port : 0
    return new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve(port)))
  })
}

async function waitForHealth(endpoint, child, stderr) {
  const deadline = Date.now() + 30_000
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error("OpenCode 提前退出：" + child.exitCode + "；" + stderr())
    try {
      const response = await fetch(endpoint + "/api/health", { signal: AbortSignal.timeout(1_000) })
      const body = await response.json().catch(() => ({}))
      if (response.ok && body.healthy === true) return
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  throw new Error("OpenCode 健康检查超时；" + stderr())
}

async function collectEvents(response) {
  if (!response.body) throw new Error("OpenCode 事件流没有响应体")
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  const events = []
  let buffer = ""
  try {
    while (true) {
      const chunk = await reader.read()
      if (chunk.done) break
      buffer += decoder.decode(chunk.value, { stream: true })
      const records = buffer.split(/\r?\n\r?\n/)
      buffer = records.pop() || ""
      for (const record of records) {
        const data = record.split(/\r?\n/).filter((line) => line.startsWith("data:")).map((line) => line.slice(5).trim()).join("\n")
        if (!data || data === "[DONE]") continue
        const event = JSON.parse(data)
        events.push(event)
        const status = event?.properties?.status
        if (event.type === "session.status" && status?.type === "idle") return events
        if (event.type === "session.next.step.ended") return events
      }
    }
    return events
  } finally {
    await reader.cancel().catch(() => {})
  }
}

const fakeServer = http.createServer(async (request, response) => {
  if (request.url === "/v1/models" && request.method === "GET") {
    response.writeHead(200, { "content-type": "application/json" })
    response.end(JSON.stringify({ data: [{ id: "gpt-smoke", object: "model" }] }))
    return
  }
  if (request.url === "/v1/chat/completions" && request.method === "POST") {
    let body = ""
    for await (const chunk of request) body += chunk
    if (!body.includes("gpt-smoke")) {
      response.writeHead(400, { "content-type": "application/json" })
      response.end(JSON.stringify({ error: { message: "测试请求没有使用 gpt-smoke" } }))
      return
    }
    response.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive" })
    response.write('data: {"id":"chatcmpl-smoke","object":"chat.completion.chunk","created":1,"model":"gpt-smoke","choices":[{"index":0,"delta":{"role":"assistant","content":"mock"},"finish_reason":null}]}\n\n')
    response.write('data: {"id":"chatcmpl-smoke","object":"chat.completion.chunk","created":1,"model":"gpt-smoke","choices":[{"index":0,"delta":{"content":" ok"},"finish_reason":null}]}\n\n')
    response.write('data: {"id":"chatcmpl-smoke","object":"chat.completion.chunk","created":1,"model":"gpt-smoke","choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}\n\n')
    response.end("data: [DONE]\n\n")
    return
  }
  response.writeHead(404)
  response.end()
})

let openCode
let stderrText = ""
try {
  const fakePort = await listen(fakeServer)
  const openCodePort = await reservePort()
  const fakeBaseUrl = "http://127.0.0.1:" + fakePort + "/v1"
  const config = {
    $schema: "https://opencode.ai/config.json",
    model: "grimoire/gpt-smoke",
    provider: {
      grimoire: {
        name: "Grimoire local smoke provider",
        npm: "@ai-sdk/openai-compatible",
        api: fakeBaseUrl,
        options: { baseURL: fakeBaseUrl, apiKey: "local-smoke-only" },
        models: { "gpt-smoke": { id: "gpt-smoke", name: "gpt-smoke", tool_call: true } },
      },
    },
  }
  openCode = spawn(executable, ["serve", "--hostname=127.0.0.1", "--port=" + openCodePort], {
    cwd: root,
    stdio: ["pipe", "ignore", "pipe"],
    windowsHide: true,
    shell: false,
    env: {
      ...process.env,
      OPENCODE_CONFIG_CONTENT: JSON.stringify(config),
      OPENCODE_DISABLE_MODELS_FETCH: "true",
      OPENCODE_DISABLE_AUTOUPDATE: "true",
      OPENCODE_DISABLE_PROJECT_CONFIG: "true",
    },
  })
  openCode.stderr.on("data", (chunk) => { stderrText = (stderrText + String(chunk)).slice(-12_000) })
  const stderr = () => stderrText.trim().replaceAll(/local-smoke-only/g, "<redacted>")
  const endpoint = "http://127.0.0.1:" + openCodePort
  await waitForHealth(endpoint, openCode, stderr)
  const providersResponse = await fetch(endpoint + "/config/providers")
  const providersText = await providersResponse.text()
  const configuredProviders = JSON.parse(providersText)
  const grimoireProvider = (configuredProviders.providers || []).find((provider) => provider.id === "grimoire")
  const grimoireModel = grimoireProvider?.models?.["gpt-smoke"]

  const createdResponse = await fetch(endpoint + "/api/session", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ model: { id: "gpt-smoke", providerID: "grimoire" }, agent: "build", title: "Grimoire smoke" }),
  })
  const createdText = await createdResponse.text()
  if (!createdResponse.ok) throw new Error("创建 OpenCode Session 失败：HTTP " + createdResponse.status + " " + createdText)
  const created = JSON.parse(createdText)
  const sessionId = created.id || created.data?.id
  if (!sessionId) throw new Error("OpenCode 没有返回 Session ID")

  const eventResponse = await fetch(endpoint + "/event?directory=" + encodeURIComponent(root), {
    headers: { accept: "text/event-stream" },
  })
  if (!eventResponse.ok) throw new Error("订阅 OpenCode 事件失败：HTTP " + eventResponse.status)
  const eventPromise = collectEvents(eventResponse)
  const promptRequest = fetch(endpoint + "/session/" + encodeURIComponent(sessionId) + "/message", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ agent: "build", model: { providerID: "grimoire", modelID: "gpt-smoke" }, parts: [{ type: "text", text: "hello" }] }),
  }).then((response) => {
    return response
  })
  const [promptResponse, events] = await Promise.all([
    promptRequest,
    eventPromise,
  ])
  const promptText = await promptResponse.text()
  if (!promptResponse.ok) throw new Error("OpenCode Prompt 失败：HTTP " + promptResponse.status + " " + promptText)
  const text = events.filter((event) => event.type === "message.part.delta" && event.properties?.field === "text").map((event) => event.properties?.delta || "").join("")
  if (text !== "mock ok") throw new Error("事件文本不匹配：" + JSON.stringify(text))
  console.log("OpenCode smoke passed: session=" + sessionId + ", events=" + events.length + ", text=" + text)
} finally {
  if (openCode && openCode.exitCode === null) {
    openCode.kill()
    await Promise.race([once(openCode, "exit"), new Promise((resolve) => setTimeout(resolve, 5_000))])
  }
  await new Promise((resolve) => fakeServer.close(() => resolve()))
}
