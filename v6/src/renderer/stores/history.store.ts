import { create } from 'zustand'

interface HistoryState {
  items: any[]
  snapshots: any[]
  loadHistory: () => Promise<void>
  loadSnapshots: () => Promise<void>
  addHistory: (data: any) => Promise<void>
  saveSnapshot: (name: string, data: any) => Promise<void>
  deleteSnapshot: (id: string) => Promise<void>
}

export const useHistoryStore = create<HistoryState>((set, get) => ({
  items: [],
  snapshots: [],

  loadHistory: async () => {
    const r = await window.electronAPI.history.getAll(50)
    set({ items: r.items || [] })
  },

  loadSnapshots: async () => {
    const r = await window.electronAPI.snapshots.getAll()
    set({ snapshots: r.snapshots || [] })
  },

  addHistory: async (data) => {
    await window.electronAPI.history.add(data)
  },

  saveSnapshot: async (name, data) => {
    await window.electronAPI.snapshots.save({ name, data })
    await get().loadSnapshots()
  },

  deleteSnapshot: async (id) => {
    await window.electronAPI.snapshots.delete(id)
    await get().loadSnapshots()
  }
}))
