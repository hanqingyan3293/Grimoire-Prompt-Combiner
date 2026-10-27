import crypto from 'node:crypto'
import type { PiSdkHostTool } from '../ai/runtime/pi-sdk.runtime'
import type { ToolPermission, ToolRegistry } from '../ai/runtime/tools'

function alias(name: string): string { return 'grimoire_' + crypto.createHash('sha256').update(name).digest('hex').slice(0, 48) }

/** Register only the existing main-owned ToolRegistry, never Pi's native tool set. */
export function piSdkHostTools(registry: ToolRegistry, sessionId: string): PiSdkHostTool[] {
  return registry.list().map(tool => ({
    name: alias(tool.name), description: tool.description,
    parameters: tool.inputSchema as PiSdkHostTool['parameters'],
    execute: async (input, context) => {
      context.signal.throwIfAborted()
      return registry.execute(tool.name, input, {
        runtime: 'pi', sessionId, toolCallId: context.callId,
        // PiSdkRuntime invokes this callback only after its native custom-tool
        // permission event was answered by the main broker. Recheck the exact
        // registry identity here; never ask or execute the same call twice.
        permission: async (permission, detail) => {
          context.signal.throwIfAborted()
          const request = detail as { tool?: string; toolCallId?: string } | undefined
          return permission === tool.permission && request?.tool === tool.name && request.toolCallId === context.callId
        },
      })
    },
  }))
}

export function piSdkPermission(registry: ToolRegistry, action: string, detail: unknown): { action: string; permission: ToolPermission; detail: Record<string, unknown> } | undefined {
  const tool = registry.list().find(entry => alias(entry.name) === action)
  if (!tool || !detail || typeof detail !== 'object' || Array.isArray(detail)) return undefined
  const request = detail as Record<string, unknown>
  return { action: tool.name, permission: tool.permission, detail: { tool: tool.name, toolCallId: request.toolCallId, input: request.input, scope: 'exact-tool-and-input' } }
}
