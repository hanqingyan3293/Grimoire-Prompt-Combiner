import { useEffect, useMemo, useRef, type ReactNode } from 'react'
import { usePromptsStore } from '../../stores/prompts.store'
import { useOptionalWorkspaceEditorState } from './WorkspaceEditorHost'
import { captureLegacyPromptEditor, validateLegacyPromptEditor } from './legacy-prompt-transfer'

const frozenPromptViews = new Set<object>()
let promptAccessGeneration = 0
const setPromptEditingLocked = (locked: boolean) => usePromptsStore.setState({ editingLocked: locked || frozenPromptViews.size > 0 })

/** Existing singleton prompt operations stay in their mature store. */
export function LegacyPromptTransferAdapter({ children }: { children: ReactNode }) {
  const editor = useOptionalWorkspaceEditorState()
  const editorRef = useRef(editor); editorRef.current = editor
  const scope = useMemo(() => ({ initialized: false, hydrating: false, frozen: false, touched: false, alive: true, accessSequence: 0 }), [editor?.stateKey])
  const restore = (state: unknown) => {
    const saved = validateLegacyPromptEditor(state)
    scope.hydrating = true
    try { usePromptsStore.setState({ positive: saved.positive, negative: saved.negative, undoStack: saved.undoStack, redoStack: saved.redoStack, impliedExcluded: saved.impliedExcluded }); scope.initialized = true }
    finally { scope.hydrating = false }
  }
  const refreshAccess = async () => {
    const api = window.api?.workspace
    if (!editorRef.current) return
    if (typeof api?.getEditorAccess !== 'function') { setPromptEditingLocked(scope.frozen || editorRef.current.status === 'loading'); return }
    const sequence = ++scope.accessSequence
    const generation = promptAccessGeneration
    try {
      const access = await api.getEditorAccess(editorRef.current.stateKey)
      if (scope.alive && sequence === scope.accessSequence && generation === promptAccessGeneration) setPromptEditingLocked(scope.frozen || !access.writable || editorRef.current?.status === 'loading')
    } catch (error) { if (scope.alive && sequence === scope.accessSequence && generation === promptAccessGeneration) { setPromptEditingLocked(true); console.warn('Legacy editor access failed', error instanceof Error ? error.message : String(error)) } }
  }
  useEffect(() => {
    scope.alive = true
    if (typeof window.api?.workspace?.getEditorAccess === 'function') setPromptEditingLocked(true)
    const unsubscribe = usePromptsStore.subscribe((state, previous) => {
      if (scope.hydrating || !scope.initialized || state.editingLocked || editorRef.current?.frozen) return
      if (state.positive !== previous.positive || state.negative !== previous.negative || state.impliedExcluded !== previous.impliedExcluded) scope.touched = true
      try { editorRef.current?.setState(captureLegacyPromptEditor(state)) }
      catch (error) { window.dispatchEvent(new CustomEvent('grimoire:toast', { detail: { type: 'error', message: error instanceof Error ? error.message : '提示词草稿保存失败，当前输入已保留' } })) }
    })
    void refreshAccess()
    const accessChanged = window.api?.workspace?.onEditorAccessChanged?.(event => { if (event.editorKey.endsWith(':prompt-workbench')) void refreshAccess() })
    const closed = window.api?.workspace?.onPopoutClosed?.(() => { void refreshAccess() })
    return () => { scope.alive = false; scope.accessSequence++; if (scope.frozen) promptAccessGeneration++; frozenPromptViews.delete(scope); unsubscribe(); accessChanged?.(); closed?.() }
  }, [scope])
  useEffect(() => {
    if (!editor || editor.transferTarget || editor.status === 'loading' || scope.initialized) return
    const live = usePromptsStore.getState()
    if (scope.touched || live.positive.length || live.negative.length || live.undoStack.length || live.impliedExcluded.length) { scope.initialized = true; if (!live.editingLocked) editor.setState(captureLegacyPromptEditor(live)); return }
    if ((editor.state as { kind?: string } | null)?.kind === 'legacy-prompts') restore(editor.state)
    else scope.initialized = true
  }, [editor?.state, editor?.status, editor?.transferTarget, scope])
  useEffect(() => { if (editor?.status !== 'loading') void refreshAccess() }, [editor?.status, scope])
  useEffect(() => {
    if (!editor?.registerTransferAdapter) return
    return editor.registerTransferAdapter({
      freeze: async () => {
        const key = editorRef.current?.stateKey, sequence = ++scope.accessSequence
        if (!scope.alive || !key) throw new Error('EDITOR_TRANSFER_ABORTED: 原提示词视图已卸载')
        if (typeof window.api?.workspace?.getEditorAccess === 'function') { const access = await window.api.workspace.getEditorAccess(key); if (!access.writable) throw new Error('EDIT_LOCKED: 这份提示词正在另一窗口编辑') }
        if (!scope.alive || key !== editorRef.current?.stateKey || sequence !== scope.accessSequence) throw new Error('EDITOR_TRANSFER_ABORTED: 原提示词视图或编辑权已改变')
        if (document.activeElement instanceof HTMLElement && document.activeElement.closest('.ui-prompt-chip')) document.activeElement.blur()
        scope.frozen = true; promptAccessGeneration++; frozenPromptViews.add(scope); setPromptEditingLocked(true)
        await new Promise<void>(resolve => setTimeout(resolve, 0))
      },
      thaw: () => { if (!scope.alive) { scope.frozen = false; frozenPromptViews.delete(scope); return }; scope.frozen = false; promptAccessGeneration++; frozenPromptViews.delete(scope); setPromptEditingLocked(true); void refreshAccess() },
      capture: async () => captureLegacyPromptEditor(usePromptsStore.getState()),
      hydrate: async state => {
        restore(state)
        await new Promise<void>(resolve => setTimeout(resolve, 0))
      },
      ready: () => true,
    })
  }, [editor?.registerTransferAdapter, scope])
  return children
}
