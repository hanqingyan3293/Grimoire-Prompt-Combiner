import { getDatabase, saveDatabase } from '../database'

/**
 * The source's prompt↔assistant/agent binding API, backed by `cherry_prompt_bindings` (v28).
 *
 * WHY A TABLE AND NOT `ai_assistants.system_prompt`: the source models a **relation** — one
 * prompt shared with several assistants, and an assistant with several prompts. Grimoire's
 * assistants carry a single free-text `system_prompt` string. Writing a bound prompt INTO that
 * field would copy the text, so editing the prompt would not affect the assistant, and unbinding
 * could not restore whatever was there before. The two are different concepts and the relation
 * needs its own storage.
 *
 * Target types match the source: `assistant` (an id in `ai_assistants`) and `agent` (opaque —
 * Grimoire has no agent table, so agent bindings are stored but resolve to no live entity,
 * which is why the list route reports them without pretending otherwise).
 */

export type PromptBindingTargetType = 'assistant' | 'agent'

/** Source `PromptBindingRelation`: `promptId, targetType, targetId`. */
export type PromptBindingRelation = {
  promptId: string
  targetType: PromptBindingTargetType
  targetId: string
}

const TARGET_TYPES = new Set<PromptBindingTargetType>(['assistant', 'agent'])

/** Every binding relation, for the page's usage summaries. */
export function listBindingRelations(): PromptBindingRelation[] {
  const rows = getDatabase().exec(
    'SELECT prompt_id, target_type, target_id FROM cherry_prompt_bindings ORDER BY created_at ASC, prompt_id ASC, target_id ASC'
  )[0]?.values || []
  return rows.map(row => ({
    promptId: String(row[0]),
    targetType: String(row[1]) as PromptBindingTargetType,
    targetId: String(row[2])
  }))
}

/** Bindings of one prompt. */
export function listBindings(promptId: string): PromptBindingRelation[] {
  return listBindingRelations().filter(relation => relation.promptId === promptId)
}

/**
 * Binds a prompt to a target, idempotently.
 *
 * Idempotent because the source's `bindToTarget` reuses an existing edge: a double-click or a
 * retried request must not fail, and the primary key would otherwise raise on the duplicate.
 * The `assistant` target is validated to exist — binding to a nonexistent assistant would
 * create an edge nothing can ever display or remove.
 *
 * Returns `false` when the target is invalid, so the caller can answer a 4xx rather than
 * reporting a success for an edge that was never written.
 */
export function bindToTarget(promptId: string, targetType: PromptBindingTargetType, targetId: string): boolean {
  if (!promptId || !targetId) return false
  if (!TARGET_TYPES.has(targetType)) return false
  const db = getDatabase()
  if (targetType === 'assistant') {
    const exists = db.exec('SELECT id FROM ai_assistants WHERE id=?', [targetId])[0]?.values?.length
    if (!exists) return false
  }
  db.run(
    'INSERT OR IGNORE INTO cherry_prompt_bindings (prompt_id, target_type, target_id, created_at) VALUES (?,?,?,?)',
    [promptId, targetType, targetId, new Date().toISOString()]
  )
  saveDatabase()
  return true
}

/** Removes a binding. Unbinding something not bound is not an error (the source's delete is a no-op). */
export function unbindFromTarget(promptId: string, targetType: PromptBindingTargetType, targetId: string): boolean {
  if (!TARGET_TYPES.has(targetType)) return false
  getDatabase().run(
    'DELETE FROM cherry_prompt_bindings WHERE prompt_id=? AND target_type=? AND target_id=?',
    [promptId, targetType, targetId]
  )
  saveDatabase()
  return true
}

/**
 * Every binding of one target — the list a `restricted` prompt is scoped to.
 *
 * The source calls this `listBindingsForTarget`; it is what "restricted" means, so a route that
 * answered it wrong would silently make a restricted prompt globally visible.
 */
export function listBindingsForTarget(targetType: PromptBindingTargetType, targetId: string): PromptBindingRelation[] {
  return listBindingRelations().filter(
    relation => relation.targetType === targetType && relation.targetId === targetId
  )
}

/** Drops every binding of a prompt — the source's `update` does this when a prompt becomes global. */
export function clearBindings(promptId: string): number {
  const result = getDatabase().run('DELETE FROM cherry_prompt_bindings WHERE prompt_id=?', [promptId])
  saveDatabase()
  return Number(result.changes || 0)
}
