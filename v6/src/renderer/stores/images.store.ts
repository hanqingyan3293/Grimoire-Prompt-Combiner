import { create } from 'zustand'

interface ImageRef {
  id: number
  file_path: string
  metadata: any
  created_at: string
}

interface ImagesState {
  refs: ImageRef[]
  activeRef: ImageRef | null

  loadRefs: () => Promise<void>
  parseImage: (filePath: string) => Promise<any>
  setActiveRef: (ref: ImageRef | null) => void
  deleteRef: (id: number) => Promise<void>
}

export const useImagesStore = create<ImagesState>((set, get) => ({
  refs: [],
  activeRef: null,

  loadRefs: async () => {
    try {
      const r = await window.electronAPI.images.getRefs()
      set({ refs: r.refs || [] })
    } catch {}
  },

  parseImage: async (filePath) => {
    const r = await window.electronAPI.images.parse(filePath)
    if (r.ok) {
      await get().loadRefs()
    }
    return r
  },

  setActiveRef: (ref) => set({ activeRef: ref }),
  deleteRef: async (id) => {
    await window.electronAPI.images.deleteRef(id)
    await get().loadRefs()
  }
}))
