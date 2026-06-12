import { create } from 'zustand'

export interface PanelTag {
  tag: {
    id: string
    subcategory_id: string
    en: string
    zh: string
    sort_order: number
    source: string
    created_at: string
  }
  weight: number
  category: string
  subcategory: string
}

interface UndoEntry {
  positive: PanelTag[]
  negative: PanelTag[]
}

interface PromptsState {
  positive: PanelTag[]
  negative: PanelTag[]
  qualityWords: boolean
  undoStack: UndoEntry[]
  redoStack: UndoEntry[]
  maxUndo: number

  addPositive: (tag: PanelTag) => void
  removePositive: (tagId: string) => void
  addNegative: (tag: PanelTag) => void
  removeNegative: (tagId: string) => void
  updateWeight: (tagId: string, weight: number, list: 'positive' | 'negative') => void
  toggleQualityWords: () => void
  clearPositive: () => void
  clearNegative: () => void
  undo: () => void
  redo: () => void
  deduplicate: () => void
  getFormattedPrompt: (lang: 'en' | 'zh') => { positive: string; negative: string }
  getFullPrompt: () => string
}

function pushUndo(state: PromptsState): Partial<PromptsState> {
  const entry: UndoEntry = {
    positive: state.positive.map(t => ({ ...t, tag: { ...t.tag } })),
    negative: state.negative.map(t => ({ ...t, tag: { ...t.tag } }))
  }
  return {
    undoStack: [...state.undoStack, entry].slice(-state.maxUndo),
    redoStack: []
  }
}

export const usePromptsStore = create<PromptsState>((set, get) => ({
  positive: [],
  negative: [],
  qualityWords: true,
  undoStack: [],
  redoStack: [],
  maxUndo: 50,

  addPositive: (tag) => {
    const state = get()
    if (state.positive.some(t => t.tag.id === tag.tag.id)) return
    try { window.electronAPI?.tags?.addUsage(tag.tag.id) } catch {}
    set(s => ({ ...pushUndo(s), positive: [...s.positive, tag] }))
  },

  removePositive: (tagId) => {
    set(s => ({ ...pushUndo(s), positive: s.positive.filter(t => t.tag.id !== tagId) }))
  },

  addNegative: (tag) => {
    const state = get()
    if (state.negative.some(t => t.tag.id === tag.tag.id)) return
    set(s => ({ ...pushUndo(s), negative: [...s.negative, tag] }))
  },

  removeNegative: (tagId) => {
    set(s => ({ ...pushUndo(s), negative: s.negative.filter(t => t.tag.id !== tagId) }))
  },

  updateWeight: (tagId, weight, list) => {
    const key = list
    set(s => {
      const arr = s[key] as PanelTag[]
      const idx = arr.findIndex(t => t.tag.id === tagId)
      if (idx === -1) return {}
      const newArr = [...arr]
      newArr[idx] = { ...newArr[idx], weight }
      return { [key]: newArr } as any
    })
  },

  toggleQualityWords: () => set(s => ({ qualityWords: !s.qualityWords })),

  clearPositive: () => set(s => ({ ...pushUndo(s), positive: [] })),
  clearNegative: () => set(s => ({ ...pushUndo(s), negative: [] })),

  undo: () => {
    const { undoStack } = get()
    if (!undoStack.length) return
    const prev = undoStack[undoStack.length - 1]
    set(s => ({
      undoStack: s.undoStack.slice(0, -1),
      redoStack: [...s.redoStack, { positive: [...s.positive], negative: [...s.negative] }],
      positive: prev.positive,
      negative: prev.negative
    }))
  },

  redo: () => {
    const { redoStack } = get()
    if (!redoStack.length) return
    const next = redoStack[redoStack.length - 1]
    set(s => ({
      redoStack: s.redoStack.slice(0, -1),
      undoStack: [...s.undoStack, { positive: [...s.positive], negative: [...s.negative] }],
      positive: next.positive,
      negative: next.negative
    }))
  },

  deduplicate: () => {
    const { positive, negative } = get()
    const seen = new Set<string>()
    const dedupedPos = positive.filter(t => {
      const key = t.tag.id
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
    const dedupedNeg = negative.filter(t => {
      const key = t.tag.id
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
    if (dedupedPos.length !== positive.length || dedupedNeg.length !== negative.length) {
      set(s => ({ ...pushUndo(s), positive: dedupedPos, negative: dedupedNeg }))
    }
  },

  getFormattedPrompt: (lang) => {
    const { positive, negative, qualityWords } = get()
    const formatTag = (t: PanelTag) => {
      const name = lang === 'en' ? t.tag.en : (t.tag.zh || t.tag.en)
      return t.weight === 1.0 ? name : `(${name}:${t.weight})`
    }

    const posTags = [...positive]
    if (qualityWords) {
      posTags.unshift(
        { tag: { id: 'qw1', subcategory_id: '', en: 'masterpiece', zh: '杰作', sort_order: 0, source: 'builtin', created_at: '' }, weight: 1.0, category: '', subcategory: '' },
        { tag: { id: 'qw2', subcategory_id: '', en: 'best_quality', zh: '最高质量', sort_order: 0, source: 'builtin', created_at: '' }, weight: 1.0, category: '', subcategory: '' }
      )
    }

    return {
      positive: posTags.map(formatTag).join(', '),
      negative: negative.map(formatTag).join(', ')
    }
  },

  getFullPrompt: () => {
    const { positive, negative, qualityWords } = get()
    const formatTag = (t: PanelTag) => t.weight === 1.0 ? t.tag.en : `(${t.tag.en}:${t.weight})`

    const posTags = [...positive]
    if (qualityWords) {
      posTags.unshift(
        { tag: { id: 'qw1', subcategory_id: '', en: 'masterpiece', zh: '杰作', sort_order: 0, source: 'builtin', created_at: '' }, weight: 1.0, category: '', subcategory: '' },
        { tag: { id: 'qw2', subcategory_id: '', en: 'best_quality', zh: '最高质量', sort_order: 0, source: 'builtin', created_at: '' }, weight: 1.0, category: '', subcategory: '' }
      )
    }

    const pos = posTags.map(formatTag).join(', ')
    const neg = negative.length ? `\nNegative: ${negative.map(formatTag).join(', ')}` : ''
    return pos + neg
  }
}))
