// Selection assistant (M3) — the part that does not need the native `selection-hook` addon.
//
// Source Cherry installs global mouse/keyboard hooks (native `selection-hook`) to capture a selection in
// ANY application. That addon is not in this repository and cannot be vendored as TypeScript, so this
// module implements the fallback that needs no native code: a global shortcut reads the CURRENT CLIPBOARD
// (the user copies, then presses the shortcut), normalizes the text into Grimoire tag syntax, and hands it
// to a caller-supplied sink (clipboard, prompt asset, agent draft).
//
// Everything here is pure: the clipboard, the shortcut registrar and the sink are injected, so the policy is
// testable without a display and the module cannot reach into Electron on its own.

export type SelectionActionId = 'copy-as-tags' | 'copy-normalized' | 'to-prompt-asset'

export interface SelectionAction {
  readonly id: SelectionActionId
  readonly label: string
  readonly description: string
}

export const SELECTION_ACTIONS: readonly SelectionAction[] = [
  { id: 'copy-as-tags', label: '复制为标签语法', description: '逗号分隔的文本 → 逗号分隔的标签，权重括号保持不变' },
  { id: 'copy-normalized', label: '复制为单行', description: '折叠换行与多余空白，保留原措辞' },
  { id: 'to-prompt-asset', label: '存为提示词素材', description: '把选区文本写入提示词素材库' },
]

export interface SelectionShortcutRegistrar {
  register(accelerator: string, handler: () => void): boolean
  unregister(accelerator: string): void
  isRegistered(accelerator: string): boolean
}

export interface ApplyShortcutResult {
  readonly registered: boolean
  readonly accelerator: string | null
  readonly reason?: 'DISABLED' | 'NO_ACCELERATOR' | 'CONFLICT' | 'ERROR'
}

let current: { accelerator: string; handler: () => void; registrar: SelectionShortcutRegistrar } | null = null

export function applySelectionShortcut(input: { registrar: SelectionShortcutRegistrar; enabled: boolean; accelerator: string; handler: () => void }): ApplyShortcutResult {
  const accelerator = (input.accelerator || '').trim()
  if (current) {
    try { current.registrar.unregister(current.accelerator) } catch { /* the old binding is already gone */ }
    current = null
  }
  if (!input.enabled) return { registered: false, accelerator: null, reason: 'DISABLED' }
  if (!accelerator) return { registered: false, accelerator: null, reason: 'NO_ACCELERATOR' }
  try {
    if (!input.registrar.register(accelerator, input.handler)) return { registered: false, accelerator: null, reason: 'CONFLICT' }
    current = { accelerator, handler: input.handler, registrar: input.registrar }
    return { registered: true, accelerator }
  } catch {
    return { registered: false, accelerator: null, reason: 'ERROR' }
  }
}

export function currentSelectionShortcut(): string | null { return current?.accelerator ?? null }

export function resetSelectionShortcutForTests(): void { current = null }

// A captured selection is a single text blob; the assistant refuses to invent content for nothing but
// whitespace, which is what an empty clipboard copy looks like.
export function normalizeSelection(text: string): string {
  return String(text ?? '').replace(/\r\n?/g, '\n').replace(/[ \t]+/g, ' ').split('\n').map(line => line.trim()).filter(Boolean).join('\n')
}

export function selectionToTags(text: string): string {
  const normalized = normalizeSelection(text)
  if (!normalized) return ''
  const pieces = normalized
    .split(/\n|,|、|;|，/)
    .map(piece => piece.trim())
    .filter(Boolean)
    // Weight syntax must survive: `(x:1.2)`, `{x}`, `[x]` are prompt grammar, not punctuation to strip.
    .map(piece => piece.replace(/\s{2,}/g, ' '))
  return pieces.join(', ')
}

export type SelectionPlan =
  | { readonly kind: 'clipboard'; readonly text: string }
  | { readonly kind: 'prompt-asset'; readonly payload: string }
  | { readonly kind: 'empty' }

export function planSelectionAction(action: SelectionActionId, raw: string): SelectionPlan {
  const normalized = normalizeSelection(raw)
  if (!normalized) return { kind: 'empty' }
  if (action === 'copy-as-tags') {
    const tags = selectionToTags(raw)
    return tags ? { kind: 'clipboard', text: tags } : { kind: 'empty' }
  }
  if (action === 'copy-normalized') return { kind: 'clipboard', text: normalized }
  return { kind: 'prompt-asset', payload: normalized }
}

// The sink is injected too: the service decides what the action MEANS, the caller decides where it lands
// (clipboard, prompt asset, agent draft). One implementation is shared by the shortcut path and by the
// floating window, so both cannot drift apart.
export interface SelectionSink {
  writeClipboard(text: string): void
  createPromptAsset(input: { name: string; prompt: string; detail: string }): { id: string }
}

export type SelectionOutcome =
  | { readonly kind: 'clipboard'; readonly text: string }
  | { readonly kind: 'prompt-asset'; readonly assetId: string }
  | { readonly kind: 'empty' }
  | { readonly kind: 'failed'; readonly message: string }

export function applySelectionPlan(action: SelectionActionId, raw: string, sink: SelectionSink): SelectionOutcome {
  const plan = planSelectionAction(action, raw)
  if (plan.kind === 'empty') return { kind: 'empty' }
  if (plan.kind === 'clipboard') {
    try {
      sink.writeClipboard(plan.text)
      return { kind: 'clipboard', text: plan.text }
    } catch (error) {
      return { kind: 'failed', message: error instanceof Error ? error.message : String(error) }
    }
  }
  try {
    const asset = sink.createPromptAsset({ name: plan.payload.slice(0, 24) || '选区', prompt: plan.payload, detail: '划词助手 · ' + new Date().toISOString() })
    return { kind: 'prompt-asset', assetId: asset.id }
  } catch (error) {
    return { kind: 'failed', message: error instanceof Error ? error.message : String(error) }
  }
}
