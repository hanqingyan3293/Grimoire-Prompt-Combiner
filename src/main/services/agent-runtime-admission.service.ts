export type RuntimeTurnOwner = {
  isDestroyed(): boolean
  once?(event: string, listener: () => void): unknown
  removeListener?(event: string, listener: () => void): unknown
}

type ActiveTurn = {
  sender: RuntimeTurnOwner
  controller: AbortController
  cancel?: () => Promise<void>
  cancellation?: Promise<void>
}
const turns = new Map<string, ActiveTurn>()

/** Reserve before provider/startup awaits so a second send cannot orphan Stop or overwrite history. */
export function admitRuntimeTurn(key: string, sender: RuntimeTurnOwner) {
  if (!sender || sender.isDestroyed()) throw new Error('RUNTIME_OWNER_UNAVAILABLE')
  if (turns.has(key)) throw new Error('RUNTIME_SESSION_BUSY')
  const turn: ActiveTurn = { sender, controller: new AbortController() }
  turns.set(key, turn)
  const destroyed = () => { void cancelRuntimeTurn(key, sender).catch(() => {}) }
  sender.once?.('destroyed', destroyed)
  return {
    signal: turn.controller.signal,
    setCancel(cancel: () => Promise<void>) {
      turn.cancel = cancel
      if (turn.controller.signal.aborted) void cancelRuntimeTurn(key, sender).catch(() => {})
    },
    release() {
      sender.removeListener?.('destroyed', destroyed)
      if (turns.get(key) === turn) turns.delete(key)
    },
  }
}

export async function cancelRuntimeTurn(key: string, sender?: RuntimeTurnOwner): Promise<boolean> {
  const turn = turns.get(key)
  if (!turn || (sender && turn.sender !== sender)) return false
  turn.controller.abort(new Error('RUNTIME_USER_CANCELLED'))
  if (turn.cancel) await (turn.cancellation ||= Promise.resolve().then(() => turn.cancel!()))
  return true
}

export async function shutdownRuntimeTurns(): Promise<void> {
  await Promise.allSettled([...turns.keys()].map(key => cancelRuntimeTurn(key)))
}
