import { afterEach, describe, expect, it, vi } from "vitest"
import { AnthropicRuntime, GoogleRuntime } from "./provider-adapters"

afterEach(() => { vi.unstubAllGlobals() })

function response(body: string) {
  return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } })
}

describe("standard provider runtimes", () => {
  it("normalizes Anthropic SSE text events", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => response(['data: {"delta":{"text":"你好"}}', '', 'data: {"delta":{"text":"世界"}}', ''].join(String.fromCharCode(10)))))
    const runtime = new AnthropicRuntime({ baseUrl: "http://anthropic.test/v1", apiKey: "secret" })
    const session = runtime.createSession("claude-test", [{ role: "user", content: "hi" }])
    const events = []
    for await (const event of runtime.send({ sessionId: session.id, model: "claude-test", messages: session.messages })) events.push(event)
    expect(events.filter(event => event.type === "text-delta").map(event => event.type === "text-delta" ? event.text : "").join("")).toBe("你好世界")
    expect(events.at(-1)).toMatchObject({ type: "completed", text: "你好世界" })
  })

  it("normalizes Google candidates from SSE", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => response(['data: {"candidates":[{"content":{"parts":[{"text":"Google reply"}]}}]}', ''].join(String.fromCharCode(10)))))
    const runtime = new GoogleRuntime({ baseUrl: "http://google.test/v1beta", apiKey: "secret" })
    const session = runtime.createSession("gemini-test", [{ role: "user", content: "hi" }])
    const events = []
    for await (const event of runtime.send({ sessionId: session.id, model: "gemini-test", messages: session.messages })) events.push(event)
    expect(events.at(-1)).toMatchObject({ type: "completed", text: "Google reply" })
  })
})

