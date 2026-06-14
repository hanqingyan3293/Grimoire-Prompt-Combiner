// 魔导书 Grimoire v7 — 提示词状态 Store（核心）
import { create } from "zustand"
import type { PanelTag, UndoRedoEntry, Tag } from "@shared/types"
import { DEFAULT_WEIGHT, WEIGHT_MIN, WEIGHT_MAX, MAX_UNDO_STEPS } from "@shared/types"

interface PromptsState {
  positive: PanelTag[]
  negative: PanelTag[]
  undoStack: UndoRedoEntry[]
  redoStack: UndoRedoEntry[]
  maxUndo: number
  
  addPositive: (tag: Tag, category: string, subcategory: string) => void
  addNegative: (tag: Tag, category: string, subcategory: string) => void
  removePositive: (tagId: string) => void
  removeNegative: (tagId: string) => void
  updateWeight: (tagId: string, weight: number) => void
  toggleQualityWords: () => void
  
  clearPositive: () => void
  clearNegative: () => void
  clearAll: () => void
  
  undo: () => void
  redo: () => void
  canUndo: () => boolean
  canRedo: () => boolean
  
  deduplicate: () => void
  randomPick: (allTags: Tag[], minTags?: number, maxTags?: number) => void
  
  getFormattedPrompt: (lang?: "zh" | "en") => string
  getFullPrompt: (lang?: "zh" | "en") => string
  
  getPresetData: () => { positive: { tag_id: string; weight: number }[]; negative: { tag_id: string; weight: number }[] }
  loadPresetData: (data: { positive: { tag_id: string; weight: number }[]; negative: { tag_id: string; weight: number }[] }, tagMap: Map<string, Tag>) => void
}

function pushUndo(state: PromptsState): UndoRedoEntry[] {
  const entry: UndoRedoEntry = {
    positive: [...state.positive],
    negative: [...state.negative],
    timestamp: Date.now(),
  }
  const stack = [...state.undoStack, entry]
  if (stack.length > state.maxUndo) {
    return stack.slice(stack.length - state.maxUndo)
  }
  return stack
}

export const usePromptsStore = create<PromptsState>((set, get) => ({
  positive: [],
  negative: [],
  undoStack: [],
  redoStack: [],
  maxUndo: MAX_UNDO_STEPS,
  
  addPositive: (tag, category, subcategory) => {
    const state = get()
    if (state.positive.find(p => p.tag.id === tag.id)) return
    const newStack = pushUndo(state)
    set({
      positive: [...state.positive, { tag, weight: DEFAULT_WEIGHT, category, subcategory }],
      undoStack: newStack,
      redoStack: [],
    })
  },
  
  addNegative: (tag, category, subcategory) => {
    const state = get()
    if (state.negative.find(p => p.tag.id === tag.id)) return
    const newStack = pushUndo(state)
    set({
      negative: [...state.negative, { tag, weight: DEFAULT_WEIGHT, category, subcategory }],
      undoStack: newStack,
      redoStack: [],
    })
  },
  
  removePositive: (tagId) => {
    const state = get()
    const newStack = pushUndo(state)
    set({
      positive: state.positive.filter(p => p.tag.id !== tagId),
      undoStack: newStack,
      redoStack: [],
    })
  },
  
  removeNegative: (tagId) => {
    const state = get()
    const newStack = pushUndo(state)
    set({
      negative: state.negative.filter(p => p.tag.id !== tagId),
      undoStack: newStack,
      redoStack: [],
    })
  },
  
  updateWeight: (tagId, weight) => {
    const clamped = Math.min(WEIGHT_MAX, Math.max(WEIGHT_MIN, weight))
    set({
      positive: get().positive.map(p =>
        p.tag.id === tagId ? { ...p, weight: Math.round(clamped * 100) / 100 } : p
      ),
      negative: get().negative.map(p =>
        p.tag.id === tagId ? { ...p, weight: Math.round(clamped * 100) / 100 } : p
      ),
    })
  },
  
  toggleQualityWords: () => {
    // Placeholder for future quality word toggles
  },
  
  clearPositive: () => {
    const state = get()
    if (state.positive.length === 0) return
    const newStack = pushUndo(state)
    set({ positive: [], undoStack: newStack, redoStack: [] })
  },
  
  clearNegative: () => {
    const state = get()
    if (state.negative.length === 0) return
    const newStack = pushUndo(state)
    set({ negative: [], undoStack: newStack, redoStack: [] })
  },
  
  clearAll: () => {
    const state = get()
    if (state.positive.length === 0 && state.negative.length === 0) return
    const newStack = pushUndo(state)
    set({ positive: [], negative: [], undoStack: newStack, redoStack: [] })
  },
  
  undo: () => {
    const state = get()
    if (state.undoStack.length === 0) return
    const current: UndoRedoEntry = {
      positive: [...state.positive],
      negative: [...state.negative],
      timestamp: Date.now(),
    }
    const undoEntry = state.undoStack[state.undoStack.length - 1]
    set({
      positive: undoEntry.positive,
      negative: undoEntry.negative,
      undoStack: state.undoStack.slice(0, -1),
      redoStack: [...state.redoStack, current],
    })
  },
  
  redo: () => {
    const state = get()
    if (state.redoStack.length === 0) return
    const current: UndoRedoEntry = {
      positive: [...state.positive],
      negative: [...state.negative],
      timestamp: Date.now(),
    }
    const redoEntry = state.redoStack[state.redoStack.length - 1]
    set({
      positive: redoEntry.positive,
      negative: redoEntry.negative,
      undoStack: [...state.undoStack, current],
      redoStack: state.redoStack.slice(0, -1),
    })
  },
  
  canUndo: () => get().undoStack.length > 0,
  canRedo: () => get().redoStack.length > 0,
  
  deduplicate: () => {
    const state = get()
    const seenPos = new Set<string>()
    const seenNeg = new Set<string>()
    const newPositive = state.positive.filter(p => {
      if (seenPos.has(p.tag.id)) return false
      seenPos.add(p.tag.id)
      return true
    })
    const newNegative = state.negative.filter(p => {
      if (seenNeg.has(p.tag.id)) return false
      seenNeg.add(p.tag.id)
      return true
    })
    if (newPositive.length === state.positive.length && newNegative.length === state.negative.length) return
    const newStack = pushUndo(state)
    set({ positive: newPositive, negative: newNegative, undoStack: newStack, redoStack: [] })
  },
  
  randomPick: (allTags, minTags = 3, maxTags = 16) => {
    if (allTags.length === 0) return
    const state = get()
    const newStack = pushUndo(state)
    const count = Math.floor(Math.random() * (maxTags - minTags + 1)) + minTags
    const picked = allTags
      .sort(() => Math.random() - 0.5)
      .slice(0, Math.min(count, allTags.length))
      .map(tag => ({ tag, weight: DEFAULT_WEIGHT, category: "", subcategory: "" }))
    set({
      positive: picked,
      undoStack: newStack,
      redoStack: [],
    })
  },
  
  getFormattedPrompt: (lang = "zh") => {
    const { positive } = get()
    if (positive.length === 0) return ""
    return positive
      .map(p => {
        const name = lang === "zh" ? p.tag.zh : p.tag.en
        if (p.weight === DEFAULT_WEIGHT) return name
        return `(${name}:${p.weight})`
      })
      .join(", ")
  },
  
  getFullPrompt: (lang = "zh") => {
    const { positive, negative } = get()
    let result = ""
    
    if (positive.length > 0) {
      result += positive
        .map(p => {
          const name = lang === "zh" ? p.tag.zh : p.tag.en
          if (p.weight === DEFAULT_WEIGHT) return name
          return `(${name}:${p.weight})`
        })
        .join(", ")
    }
    
    if (negative.length > 0) {
      if (result) result += "\n"
      result += "--neg "
      result += negative
        .map(p => {
          const name = lang === "zh" ? p.tag.zh : p.tag.en
          if (p.weight === DEFAULT_WEIGHT) return name
          return `(${name}:${p.weight})`
        })
        .join(", ")
    }
    
    return result
  },
  
  getPresetData: () => {
    const { positive, negative } = get()
    return {
      positive: positive.map(p => ({ tag_id: p.tag.id, weight: p.weight })),
      negative: negative.map(p => ({ tag_id: p.tag.id, weight: p.weight })),
    }
  },
  
  loadPresetData: (data, tagMap) => {
    const positive: PanelTag[] = data.positive
      .map(p => {
        const tag = tagMap.get(p.tag_id)
        if (!tag) return null
        return { tag, weight: p.weight, category: "", subcategory: "" }
      })
      .filter(Boolean) as PanelTag[]
    
    const negative: PanelTag[] = data.negative
      .map(p => {
        const tag = tagMap.get(p.tag_id)
        if (!tag) return null
        return { tag, weight: p.weight, category: "", subcategory: "" }
      })
      .filter(Boolean) as PanelTag[]
    
    const newStack = pushUndo(get())
    set({ positive, negative, undoStack: newStack, redoStack: [] })
  },
}))
