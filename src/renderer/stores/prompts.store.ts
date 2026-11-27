// 魔导书 Grimoire v7 — 提示词状态 Store（核心）
import { create } from "zustand"
import type { PanelTag, UndoRedoEntry, Tag } from "@shared/types"
import { DEFAULT_WEIGHT, WEIGHT_MIN, WEIGHT_MAX, MAX_UNDO_STEPS } from "@shared/types"
import { bracketStep, parsePromptText, serializePrompt, type PromptToken } from "@shared/tag-prompt-core"

interface PromptsState {
  editingLocked: boolean
  positive: PanelTag[]
  negative: PanelTag[]
  undoStack: UndoRedoEntry[]
  redoStack: UndoRedoEntry[]
  maxUndo: number
  /** Tag ids whose implied (auto-derived) state was explicitly excluded by the user. */
  impliedExcluded: string[]

  addPositive: (tag: Tag, category: string, subcategory: string) => void
  addNegative: (tag: Tag, category: string, subcategory: string) => void
  removePositive: (tagId: string) => void
  removeNegative: (tagId: string) => void
  updateWeight: (tagId: string, weight: number) => void
  /** BDTM-style bracket stepping: one gesture = one bracket level (×1.1 / ÷1.1). */
  stepWeight: (tagId: string, direction: 1 | -1) => void
  excludeImplied: (tagId: string) => void
  includeImplied: (tagId: string) => void
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
  replaceFromPromptText: (text: string, tags: Tag[]) => { matched: number; unknown: string[] }
  
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

function panelTagsToTokens(items: PanelTag[], lang: "zh" | "en", negative: boolean): PromptToken[] {
  return items.map(item => ({
    text: lang === "zh" ? item.tag.zh : item.tag.en,
    weight: item.weight,
    depth: 0,
    negative,
    explicit: item.weight !== DEFAULT_WEIGHT,
    breakBefore: item.breakBefore === true,
  }))
}

export const usePromptsStore = create<PromptsState>((set, get) => ({
  editingLocked: false,
  positive: [],
  negative: [],
  undoStack: [],
  redoStack: [],
  maxUndo: MAX_UNDO_STEPS,
  impliedExcluded: [],
  
  addPositive: (tag, category, subcategory) => {
    if (get().editingLocked) return
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
    if (get().editingLocked) return
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
    if (get().editingLocked) return
    const state = get()
    const newStack = pushUndo(state)
    set({
      positive: state.positive.filter(p => p.tag.id !== tagId),
      undoStack: newStack,
      redoStack: [],
    })
  },
  
  removeNegative: (tagId) => {
    if (get().editingLocked) return
    const state = get()
    const newStack = pushUndo(state)
    set({
      negative: state.negative.filter(p => p.tag.id !== tagId),
      undoStack: newStack,
      redoStack: [],
    })
  },
  
  updateWeight: (tagId, weight) => {
    if (get().editingLocked) return
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

  stepWeight: (tagId, direction) => {
    if (get().editingLocked) return
    const apply = (list: PanelTag[]) =>
      list.map(p => (p.tag.id === tagId ? { ...p, weight: bracketStep(p.weight, direction) } : p))
    set({ positive: apply(get().positive), negative: apply(get().negative) })
  },

  excludeImplied: (tagId) => {
    if (get().editingLocked) return
    const list = get().impliedExcluded
    if (list.includes(tagId)) return
    set({ impliedExcluded: [...list, tagId] })
  },

  includeImplied: (tagId) => {
    if (get().editingLocked) return
    const list = get().impliedExcluded
    if (!list.includes(tagId)) return
    set({ impliedExcluded: list.filter(id => id !== tagId) })
  },

  toggleQualityWords: () => {
    // Placeholder for future quality word toggles
  },
  
  clearPositive: () => {
    if (get().editingLocked) return
    const state = get()
    if (state.positive.length === 0) return
    const newStack = pushUndo(state)
    set({ positive: [], undoStack: newStack, redoStack: [] })
  },
  
  clearNegative: () => {
    if (get().editingLocked) return
    const state = get()
    if (state.negative.length === 0) return
    const newStack = pushUndo(state)
    set({ negative: [], undoStack: newStack, redoStack: [] })
  },
  
  clearAll: () => {
    if (get().editingLocked) return
    const state = get()
    if (state.positive.length === 0 && state.negative.length === 0) return
    const newStack = pushUndo(state)
    set({ positive: [], negative: [], undoStack: newStack, redoStack: [] })
  },
  
  undo: () => {
    if (get().editingLocked) return
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
    if (get().editingLocked) return
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
    if (get().editingLocked) return
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
    if (get().editingLocked) return
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
    return serializePrompt(panelTagsToTokens(positive, lang, false), token => token.text)
  },

  getFullPrompt: (lang = "zh") => {
    const { positive, negative } = get()
    // Serialization delegates to the shared core; output stays byte-identical
    // to the historical implementation (bare name at weight 1, (name:weight)
    // otherwise, ", " joins, "--neg " prefix, "\n" between segments).
    const tokens = [
      ...panelTagsToTokens(positive, lang, false),
      ...panelTagsToTokens(negative, lang, true),
    ]
    return serializePrompt(tokens, token => token.text)
  },

  replaceFromPromptText: (text, tags) => {
    if (get().editingLocked) return { matched: 0, unknown: [] }
    const positive: PanelTag[] = []
    const negative: PanelTag[] = []
    const unknown: string[] = []
    const tagMap = new Map<string, Tag>()
    for (const tag of tags) {
      tagMap.set(tag.en.trim().toLowerCase(), tag)
      tagMap.set(tag.zh.trim(), tag)
    }
    // Richer parsing via the shared core: bracket multipliers, explicit
    // weights, BREAK and --neg segments; duplicates of one resolved tag merge
    // their weight deltas (BDTM parity) instead of being silently skipped.
    const { tokens } = parsePromptText(text)
    for (const token of tokens) {
      const label = token.text
      const tag = tagMap.get(label.toLowerCase()) || tagMap.get(label)
      if (!tag) { unknown.push(label); continue }
      const target = token.negative ? negative : positive
      const existing = target.find(item => item.tag.id === tag.id)
      if (existing) {
        existing.weight = Math.min(WEIGHT_MAX, Math.max(WEIGHT_MIN, Math.round((existing.weight + token.weight - 1) * 100) / 100))
        continue
      }
      target.push({ tag, weight: token.weight, category: "", subcategory: "", breakBefore: token.breakBefore })
    }
    const state = get()
    if (!positive.length && !negative.length) return { matched: 0, unknown }
    set({ positive, negative, undoStack: pushUndo(state), redoStack: [] })
    return { matched: positive.length + negative.length, unknown }
  },
  
  getPresetData: () => {
    const { positive, negative } = get()
    return {
      positive: positive.map(p => ({ tag_id: p.tag.id, weight: p.weight })),
      negative: negative.map(p => ({ tag_id: p.tag.id, weight: p.weight })),
    }
  },
  
  loadPresetData: (data, tagMap) => {
    if (get().editingLocked) return
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
