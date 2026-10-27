// Grimoire message parts → source Cherry (AI SDK v6) message parts.
//
// Kept native where the source renderer supports them so the real Cherry
// blocks handle the display: `text`/`reasoning`/`file`, `data-code`,
// `data-error`, and tool parts (`tool-<name>` / `dynamic-tool`) with the
// state/input/output/errorText fields `buildToolResponseFromPart` reads.

export type AnyRecord = Record<string, any>

export function readParts(content: unknown): AnyRecord[] {
  if (content && typeof content === 'object' && Array.isArray((content as AnyRecord).parts)) {
    return (content as AnyRecord).parts as AnyRecord[]
  }
  if (typeof content === 'string' && content.trim()) return [{ type: 'text', text: content }]
  return []
}

export function toolStateFromStatus(status: unknown): string {
  const value = String(status || '')
  if (value === 'failed' || value === 'error') return 'output-error'
  if (value === 'cancelled' || value === 'canceled' || value === 'interrupted') return 'output-denied'
  if (value === 'running' || value === 'streaming' || value === 'pending' || value === 'executing' || value === 'invoking') return 'input-available'
  return 'output-available'
}

/**
 * A pending Grimoire permission becomes the AI SDK v6 approval-requested tool part
 * the source renderer expects: `findToolPartByCallId` matches on `toolCallId` and
 * `approval.id`, and `isToolPartAwaitingApproval` keys off
 * `state === 'approval-requested'`.
 *
 * `toolCallId` is the call's own id when the main process supplied one. That is what
 * lets the source approval card correlate its decision to the right call AND resolve
 * the tool it belongs to — the source `autoApprove` action persists a per-tool rule
 * (`disabledAutoApproveTools`) and no-ops without a known tool. Without a call id the
 * request id is used, which preserves the earlier behaviour: the card still renders and
 * answers, it just cannot offer "always allow".
 */
export function permissionToApprovalPart(permission: AnyRecord): AnyRecord {
  const requestId = String(permission.requestId || permission.id || 'permission')
  const detail = permission.detail && typeof permission.detail === 'object' ? permission.detail : {}
  // An empty/absent call id is not an identity — fall back to the request id rather
  // than emitting a join key that would match every other id-less part.
  const toolCallId = String((detail as AnyRecord).toolCallId || '') || requestId
  return {
    type: 'dynamic-tool',
    toolName: String(detail.tool || detail.action || permission.permission || 'permission'),
    toolCallId,
    state: 'approval-requested',
    approval: { id: requestId },
    input: detail
  }
}

export function toSourcePart(part: AnyRecord, options: { streaming?: boolean } = {}): AnyRecord {
  const type = String(part.type || 'text')
  if (type === 'text' && typeof part.text === 'string') {
    // Source `ReasoningUIPart`/`TextUIPart` carry `state`; the activity layer drives
    // the live caret, but the part state must not claim "done" mid-stream.
    return { type: 'text', text: part.text, ...(options.streaming ? { state: 'streaming' } : {}) }
  }
  if (type === 'reasoning' && typeof part.text === 'string') {
    return { type: 'reasoning', text: part.text, state: options.streaming ? 'streaming' : 'done' }
  }
  if (type === 'code') {
    return {
      type: 'data-code',
      data: {
        content: typeof part.code === 'string' ? part.code : String(part.text || ''),
        language: typeof part.language === 'string' ? part.language : ''
      }
    }
  }
  if (type === 'image' && part.source) return { type: 'file', mediaType: part.source.mediaType || 'image/*', url: part.source.url || part.source.dataUrl || '' }
  if (type === 'attachment' && part.attachmentId) return { type: 'text', text: '[附件] ' + part.attachmentId }
  if (type === 'tool-call' || type === 'tool-result') {
    // Two Grimoire parts describe one source tool part; the call carries the id
    // so the renderer groups the tool-result under it via `toolCallId`.
    const toolCallId = String(part.toolCallId || part.id || part.name || 'tool')
    const toolName = String(part.name || part.tool || 'tool')
    return {
      type: 'dynamic-tool',
      toolName,
      toolCallId,
      state: toolStateFromStatus(part.status || (type === 'tool-result' ? 'completed' : 'running')),
      input: part.input,
      output: type === 'tool-result' ? (part.output ?? part.error) : part.output,
      errorText: typeof part.error === 'string' ? part.error : undefined
    }
  }
  if (type === 'agent-status') return { type: 'text', text: 'Agent · ' + String(part.status || part.text || '') }
  if (type === 'mcp') {
    return {
      type: 'dynamic-tool',
      toolName: String(part.tool || part.name || 'mcp'),
      toolCallId: String(part.toolCallId || part.id || part.tool || 'mcp'),
      state: toolStateFromStatus(part.status),
      input: part.input ?? part.payload,
      output: part.output ?? part.payload
    }
  }
  if (type === 'permission') return { type: 'text', text: '权限请求 · ' + String(part.permission || part.status || '') }
  if (type === 'error') {
    return { type: 'data-error', data: { message: String(part.text || part.error || ''), name: 'Error' } }
  }
  if (type === 'compaction') return compactionAnchorPart(part)
  if (type === 'status') return { type: 'text', text: String(part.text || part.status || '') }
  return { type: 'text', text: String(part.text || part.content || '') }
}

/**
 * Grimoire compaction events project onto the source `data-compaction-anchor` part
 * rendered by `CompactionAnchorBlock` ("Context compacted, ~N tokens saved"). The
 * source derives saved tokens from `preTokens > postTokens`, so a compaction without
 * measurements stays a `done` rule with no count instead of inventing numbers.
 */
export function compactionAnchorPart(part: AnyRecord): AnyRecord {
  const status = String(part.status || 'done')
  const data: AnyRecord = {
    status: status === 'running' || status === 'compacting' ? 'compacting' : status === 'skipped' ? 'skipped' : 'done',
    phase: typeof part.phase === 'string' ? part.phase : 'turn-start'
  }
  if (typeof part.preTokens === 'number') data.preTokens = part.preTokens
  if (typeof part.postTokens === 'number') data.postTokens = part.postTokens
  if (typeof part.foldedCount === 'number') data.foldedCount = part.foldedCount
  if (typeof part.startedAt === 'string') data.startedAt = part.startedAt
  if (typeof part.completedAt === 'string') data.completedAt = part.completedAt
  return { type: 'data-compaction-anchor', data }
}
