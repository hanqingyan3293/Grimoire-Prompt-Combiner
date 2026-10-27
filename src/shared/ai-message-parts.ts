export type AiMessagePartType =
  | 'text'
  | 'reasoning'
  | 'code'
  | 'tool-call'
  | 'tool-result'
  | 'permission'
  | 'image'
  | 'file'
  | 'attachment'
  | 'citation'
  | 'agent-status'
  | 'mcp'
  | 'error'
  | 'status'

export type AiMessagePart = {
  id?: string
  type: AiMessagePartType
  text?: string
  code?: string
  language?: string
  callId?: string
  name?: string
  input?: unknown
  output?: unknown
  error?: string
  status?: string
  requestId?: string
  permission?: string
  detail?: unknown
  attachmentId?: string
  assetKey?: string
  mimeType?: string
  fileName?: string
  url?: string
  title?: string
  source?: string
  metadata?: Record<string, unknown>
}

export type AiMessagePartsContent = {
  parts: AiMessagePart[]
  text?: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

export function contentText(content: unknown): string {
  if (typeof content === 'string') return content
  if (isRecord(content)) {
    if (typeof content.text === 'string') return content.text
    if (Array.isArray(content.parts)) return content.parts.map(part => contentText(part)).join('')
    if (typeof content.code === 'string') return content.code
  }
  return ''
}

export function normalizeAiMessageParts(content: unknown, role = 'assistant'): AiMessagePart[] {
  if (isRecord(content) && Array.isArray(content.parts)) {
    return content.parts.filter(isRecord).map(part => ({ ...part, type: String(part.type || 'text') as AiMessagePartType }))
  }
  if (typeof content === 'string') return content ? [{ type: 'text', text: content }] : []
  if (isRecord(content) && typeof content.text === 'string') return content.text ? [{ type: 'text', text: content.text }] : []
  if (content == null) return []
  return [{ type: role === 'tool' ? 'tool-result' : 'text', text: JSON.stringify(content) }]
}

export function toAiMessagePartsContent(content: unknown, role = 'assistant'): AiMessagePartsContent {
  const parts = normalizeAiMessageParts(content, role)
  return { parts, text: parts.filter(part => part.type === 'text').map(part => part.text || '').join('') }
}

export function appendAiMessagePart(parts: AiMessagePart[], part: AiMessagePart): AiMessagePart[] {
  return [...parts, { ...part, id: part.id || 'part_' + Math.random().toString(36).slice(2, 10) }]
}
