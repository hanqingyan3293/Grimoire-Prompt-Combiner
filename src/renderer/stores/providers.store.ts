// 魔导书 Grimoire v7 — Provider Store
import { create } from "zustand"
import type { Provider } from "@shared/types"

interface ProviderState {
  providers: Provider[]
  activeProvider: Provider | null
  loading: boolean

  loadProviders: () => Promise<void>
  saveProvider: (data: Partial<Provider> & { id?: string }) => Promise<void>
  deleteProvider: (id: string) => Promise<void>
  setActive: (id: string) => Promise<void>
  refreshActive: () => Promise<void>
}

export const useProviderStore = create<ProviderState>((set, get) => ({
  providers: [],
  activeProvider: null,
  loading: false,

  loadProviders: async () => {
    set({ loading: true })
    try {
      const list = await window.api.providers.list()
      const active = list.find(p => p.is_active) || list[0] || null
      set({ providers: list, activeProvider: active, loading: false })
    } catch {
      set({ loading: false })
    }
  },

  saveProvider: async (data) => {
    const result = await window.api.providers.save(data)
    // 如果是新记录且没有活跃供应商，自动设为活跃
    if (!data.id) {
      const { providers } = get()
      if (providers.length === 0) {
        await window.api.providers.setActive(result.id)
      }
    }
    await get().loadProviders()
  },

  deleteProvider: async (id) => {
    await window.api.providers.delete(id)
    await get().loadProviders()
  },

  setActive: async (id) => {
    await window.api.providers.setActive(id)
    await get().loadProviders()
  },

  refreshActive: async () => {
    await get().loadProviders()
  },
}))
