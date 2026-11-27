export interface ShutdownOperations {
  stopTasksAndWait(): void | Promise<void>
  stopWorker(): void | Promise<void>
  shutdownSessions(): void | Promise<void>
  closeDatabase(): void
  quit(): void
}

/** Compose the existing owners' shutdowns. All must settle before closing the
 * database; a task/ACK drain rejection is preserved, not swallowed by cleanup. */
export async function drainAndQuit(operations: ShutdownOperations): Promise<void> {
  const invoke = (stop: () => void | Promise<void>) => {
    try { return Promise.resolve(stop()) } catch (error) { return Promise.reject(error) }
  }
  const settled = await Promise.allSettled([
    invoke(() => operations.stopTasksAndWait()),
    invoke(() => operations.stopWorker()),
    invoke(() => operations.shutdownSessions()),
  ])
  // Task drain is first so its exact ACK/persistence owner diagnostic survives
  // even when another shutdown fails in the same attempt.
  for (const result of settled) if (result.status === 'rejected') throw result.reason
  operations.closeDatabase()
  operations.quit()
}
