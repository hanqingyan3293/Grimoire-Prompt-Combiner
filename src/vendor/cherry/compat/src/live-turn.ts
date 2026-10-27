import { compactionAnchorPart, toolStateFromStatus } from './part-projection'

type AnyRecord = Record<string, any>

/**
 * Live turn projection for one streaming assistant turn.
 *
 * The Host persists the assistant message only when the turn completes, so without
 * this overlay the compat window shows nothing until the whole answer lands. The
 * source renders a live turn as a message with `status: 'pending'` whose parts carry
 * `state: 'streaming'` — `isMessageListItemProcessing` keys off `status === 'pending'`
 * and `MainTextBlock`/`ThinkingBlock` smooth-stream from there (see
 * `useMessageActivityState.ts` and `messagePartLayouts.ts`).
 *
 * Entries keep source order so a compacted segment, tool call and text tail render
 * in the order the turn produced them.
 */
export type LiveTurnEntry =
  | { kind: 'text'; text: string }
  | { kind: 'reasoning'; text: string }
  | { kind: 'tool'; callId: string; name: string; input?: unknown; status: string; output?: unknown; error?: string }
  | { kind: 'compaction'; status: 'compacting' | 'done' }

export type LiveTurn = {
  sessionId: string
  entries: LiveTurnEntry[]
}

export function createLiveTurn(sessionId: string): LiveTurn {
  return { sessionId, entries: [] }
}

/**
 * Accumulates one Host event into the live turn, or returns the turn unchanged for
 * events the overlay does not consume (the caller decides terminal handling).
 * Returns `null` when the event is not part of a live assistant turn at all.
 */
export function applyTurnEvent(turn: LiveTurn | null, sessionId: string, event: AnyRecord): LiveTurn | null {
  const kind = String(event?.kind || '')
  const record = event?.record && typeof event.record === 'object' ? event.record : {}
  const payload = record.payload && typeof record.payload === 'object' ? record.payload : {}

  if (kind === 'delta') {
    const text = typeof event.text === 'string' ? event.text : ''
    if (!text) return turn
    return appendText(turn, sessionId, 'text', text)
  }

  if (kind !== 'event') return turn
  const eventType = String(record.event_type || '')
  if (eventType === 'reasoning-delta') {
    const text = typeof payload.text === 'string' ? payload.text : ''
    if (!text) return turn
    return appendText(turn, sessionId, 'reasoning', text)
  }
  if (eventType === 'tool-started') {
    const base = ensureTurn(turn, sessionId)
    if (!base) return turn
    return {
      ...base,
      entries: [...base.entries, {
        kind: 'tool',
        callId: String(payload.callId || 'tool'),
        name: String(payload.name || 'tool'),
        input: payload.input,
        status: 'running'
      }]
    }
  }
  if (eventType === 'tool-progress' || eventType === 'tool-finished') {
    const base = ensureTurn(turn, sessionId)
    if (!base) return turn
    const callId = String(payload.callId || 'tool')
    const status = eventType === 'tool-finished' ? (payload.error != null ? 'failed' : 'completed') : String(payload.status || 'running')
    const nextEntries: LiveTurnEntry[] = base.entries.map(entry =>
      entry.kind === 'tool' && entry.callId === callId
        ? { ...entry, status, output: payload.output !== undefined ? payload.output : entry.output, error: payload.error != null ? String(payload.error) : entry.error, name: String(payload.name || entry.name) }
        : entry
    )
    return { ...base, entries: nextEntries }
  }
  if (eventType === 'compaction-started') {
    const base = ensureTurn(turn, sessionId)
    if (!base) return turn
    return { ...base, entries: [...base.entries, { kind: 'compaction', status: 'compacting' }] }
  }
  if (eventType === 'compaction-finished') {
    const base = ensureTurn(turn, sessionId)
    if (!base) return turn
    const lastCompacting = [...base.entries].reverse().findIndex(entry => entry.kind === 'compaction' && entry.status === 'compacting')
    if (lastCompacting === -1) return { ...base, entries: [...base.entries, { kind: 'compaction', status: 'done' as const }] }
    const index = base.entries.length - 1 - lastCompacting
    const nextEntries: LiveTurnEntry[] = base.entries.map((entry, entryIndex) =>
      entryIndex === index ? { kind: 'compaction', status: 'done' as const } : entry)
    return { ...base, entries: nextEntries }
  }
  return turn
}

function ensureTurn(turn: LiveTurn | null, sessionId: string): LiveTurn | null {
  if (!sessionId) return turn
  return turn ?? createLiveTurn(sessionId)
}

function appendText(turn: LiveTurn | null, sessionId: string, kind: 'text' | 'reasoning', text: string): LiveTurn | null {
  const base = ensureTurn(turn, sessionId)
  if (!base) return turn
  const last = base.entries[base.entries.length - 1]
  if (last && last.kind === kind) {
    return { ...base, entries: [...base.entries.slice(0, -1), { kind, text: last.text + text }] }
  }
  return { ...base, entries: [...base.entries, { kind, text }] }
}

/** True when the turn has produced anything worth rendering as a pending message. */
export function liveTurnHasContent(turn: LiveTurn | null): boolean {
  return Boolean(turn && turn.entries.length > 0)
}

/**
 * Projects the live entries onto source message parts. Text/reasoning carry
 * `state: 'streaming'` (the activity layer keys the caret off the pending message,
 * and the part state keeps the reasoning visible mid-stream); tool entries reuse the
 * shared status mapping so a running tool renders as `input-available` ("invoking").
 */
export function liveTurnParts(turn: LiveTurn): AnyRecord[] {
  return turn.entries.map(entry => {
    if (entry.kind === 'text') return { type: 'text', text: entry.text, state: 'streaming' }
    if (entry.kind === 'reasoning') return { type: 'reasoning', text: entry.text, state: 'streaming' }
    if (entry.kind === 'compaction') return compactionAnchorPart({ status: entry.status })
    return {
      type: 'dynamic-tool',
      toolName: entry.name,
      toolCallId: entry.callId,
      state: toolStateFromStatus(entry.status),
      input: entry.input,
      output: entry.output,
      errorText: entry.error
    }
  })
}
