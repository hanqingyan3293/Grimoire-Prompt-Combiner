import { useEffect } from 'react'
import { usePromptsStore } from '../stores/prompts.store'
import { useTagsStore } from '../stores/tags.store'

export function useGlobalShortcuts() {
  const { undo, redo } = usePromptsStore()
  const { search, searchQuery } = useTagsStore()

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const isInputFocused = ['INPUT', 'TEXTAREA', 'SELECT'].includes(
        (e.target as HTMLElement)?.tagName
      )

      // Ctrl+Z - Undo
      if (e.ctrlKey && !e.shiftKey && e.key === 'z') {
        e.preventDefault()
        undo()
        return
      }

      // Ctrl+Y - Redo
      if (e.ctrlKey && e.key === 'y') {
        e.preventDefault()
        redo()
        return
      }

      // Ctrl+K - Focus search
      if (e.ctrlKey && e.key === 'k') {
        e.preventDefault()
        const searchInput = document.querySelector('input[placeholder*="搜索"]') as HTMLInputElement
        searchInput?.focus()
        return
      }

      // Escape - Clear search
      if (e.key === 'Escape' && !isInputFocused) {
        search('')
        return
      }
    }

    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [undo, redo, search])
}
