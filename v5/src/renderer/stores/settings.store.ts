import { create } from 'zustand'

interface SettingsState {
  theme: string
  language: string
  aiProvider: string
  aiApiKey: string
  aiModel: string
  shortcuts: Record<string, string>

  loadSettings: () => Promise<void>
  setTheme: (theme: string) => Promise<void>
  setSetting: (key: string, value: string) => Promise<void>
}

export const useSettingsStore = create<SettingsState>((set, get) => ({
  theme: 'neon',
  language: 'zh',
  aiProvider: '',
  aiApiKey: '',
  aiModel: '',
  shortcuts: {},

  loadSettings: async () => {
    try {
      const result = await window.electronAPI.settings.getAll()
      if (result.theme) set({ theme: result.theme })
      if (result.language) set({ language: result.language })
      if (result.aiProvider) set({ aiProvider: result.aiProvider })
      if (result.aiModel) set({ aiModel: result.aiModel })
      if (result.shortcuts) {
        try { set({ shortcuts: JSON.parse(result.shortcuts) }) } catch {}
      }
    } catch {
      // Use defaults
    }
  },

  setTheme: async (theme: string) => {
    set({ theme })
    await window.electronAPI.settings.set('theme', theme)
  },

  setSetting: async (key: string, value: string) => {
    set({ [key]: value } as any)
    await window.electronAPI.settings.set(key, value)
  }
}))
