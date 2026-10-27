import type {
  AgentRuntime,
  RuntimeEvent,
  RuntimeMessage,
  RuntimeSendInput,
  RuntimeSession,
  RuntimeToolCall,
} from '../ai/runtime/types'

export type RuntimeTurnToolPhase = 'started' | 'finished'

export type RuntimeTurnLoopOptions = {
  runtime: AgentRuntime
  runtimeSession: RuntimeSession
  model: string
  messages: RuntimeMessage[]
  tools?: unknown[]
  maxTurns?: number
  /** Host cancellation also gates tools after a runtime has already completed its model call. */
  isCancelled?: () => boolean
  /** Apply the caller's context policy immediately before each model call. */
  limitMessages?: (messages: RuntimeMessage[]) => RuntimeMessage[]
  /** Allows the AI path to wrap a send in its existing retry policy. */
  send?: (input: RuntimeSendInput) => AsyncIterable<RuntimeEvent>
  onEvent?: (event: RuntimeEvent) => void | Promise<void>
  onHostTool?: (phase: RuntimeTurnToolPhase, call: RuntimeToolCall, result?: unknown) => void | Promise<void>
  executeHostTool?: (call: RuntimeToolCall) => Promise<unknown>
}

export type RuntimeTurnLoopResult = {
  text: string
  cancelled: boolean
  turns: number
  messages: RuntimeMessage[]
}

function jsonToolResult(value: unknown): string {
  return JSON.stringify(value) ?? 'null'
}

function validateHostCalls(calls: RuntimeToolCall[], seen: Set<string>): void {
  const batch = new Set<string>()
  for (const call of calls) {
    if (!call || typeof call.callId !== 'string' || !call.callId.trim() || typeof call.name !== 'string' || !call.name.trim()) {
      throw new Error('RUNTIME_INVALID_TOOL_CALL')
    }
    if (batch.has(call.callId) || seen.has(call.callId)) throw new Error('RUNTIME_DUPLICATE_TOOL_CALL')
    batch.add(call.callId)
  }
  for (const id of batch) seen.add(id)
}

/**
 * Owns the common runtime turn loop for AI and Agent sessions.
 *
 * A runtime remains the sole owner of native tools. Only a completion explicitly
 * marked `toolOwnership: 'host'` is handed back to Grimoire's ToolRegistry.
 * Persistence, permission UI and event broadcasting stay in the caller's
 * `onEvent` hook, so AI and Agent sessions keep separate stores without keeping
 * separate execution semantics.
 */
export async function runAgentRuntimeLoop(options: RuntimeTurnLoopOptions): Promise<RuntimeTurnLoopResult> {
  const maxTurns = options.maxTurns ?? 8
  if (!Number.isSafeInteger(maxTurns) || maxTurns < 1 || maxTurns > 64) throw new Error('RUNTIME_INVALID_MAX_TURNS')
  const send = options.send || (input => options.runtime.send(input))
  let currentMessages = options.messages.map(message => ({ ...message }))
  let text = ''
  let cancelled = false
  let turns = 0
  let modelCalls = 0
  const seenHostCalls = new Set<string>()

  for (; turns < maxTurns; turns += 1) {
    if (options.isCancelled?.()) { cancelled = true; break }
    const limitedMessages = (options.limitMessages ? options.limitMessages(currentMessages) : currentMessages).map(message => ({ ...message }))
    let turnText = ''
    let terminal = false
    modelCalls = turns + 1
    const hostToolCalls: RuntimeToolCall[] = []

    for await (const rawEvent of send({
      sessionId: options.runtimeSession.id,
      model: options.model,
      messages: limitedMessages,
      tools: options.tools,
    })) {
      const event: RuntimeEvent = options.isCancelled?.() ? { type: 'cancelled', reason: 'user' } : rawEvent
      await options.onEvent?.(event)
      if (event.type === 'text-delta') turnText += event.text
      else if (event.type === 'completed') {
        terminal = true
        turnText = event.text
        if (event.toolOwnership === 'host') hostToolCalls.push(...(event.toolCalls || []))
      } else if (event.type === 'cancelled') {
        terminal = true
        cancelled = true
      } else if (event.type === 'failed') {
        terminal = true
        throw new Error(event.error)
      }
      if (terminal) break
    }

    if (options.isCancelled?.()) cancelled = true
    if (!terminal && !cancelled) throw new Error('RUNTIME_TURN_NO_TERMINAL')
    text += turnText
    if (cancelled || hostToolCalls.length === 0) break
    // Do not perform a last tool's side effects when there is no remaining model-call budget.
    if (turns + 1 >= maxTurns) throw new Error('RUNTIME_MAX_TURNS_EXCEEDED')
    if (!options.executeHostTool) throw new Error('RUNTIME_HOST_TOOL_HANDLER_UNAVAILABLE')
    validateHostCalls(hostToolCalls, seenHostCalls)
    currentMessages = [...currentMessages, { role: 'assistant', content: turnText, toolCalls: hostToolCalls }]
    for (const call of hostToolCalls) {
      if (options.isCancelled?.()) { cancelled = true; break }
      await options.onHostTool?.('started', call)
      if (options.isCancelled?.()) { cancelled = true; break }
      const result = await options.executeHostTool(call)
      await options.onHostTool?.('finished', call, result)
      currentMessages.push({ role: 'tool', content: jsonToolResult(result), toolCallId: call.callId, name: call.name })
    }
    if (cancelled) break
  }

  return { text, cancelled, turns: modelCalls, messages: currentMessages }
}
