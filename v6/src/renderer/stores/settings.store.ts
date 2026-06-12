import { create } from 'zustand'

interface SettingsState {
  theme: string; language: string; fontSize: string
  customAccent: string; randomMin: number; randomMax: number
  workspace: string; panelSizes: string
  aiProvider: string; aiApiKey: string; aiEndpoint: string; aiModel: string
  shortcuts: Record<string, string>

  loadSettings: () => Promise<void>
  setTheme: (theme: string) => Promise<void>
  setSetting: (key: string, value: string) => Promise<void>
}

export const useSettingsStore = create<SettingsState>((set, get) => ({
  theme: 'dark', language: 'zh', fontSize: '14',
  customAccent: '#4b9cd3', randomMin: 3, randomMax: 8,
  workspace: 'three-col', panelSizes: '25:50:25',
  aiProvider: '', aiApiKey: '', aiEndpoint: '', aiModel: '',
  shortcuts: {},

  loadSettings: async () => {
    try {
      const result = await window.electronAPI.settings.getAll()
      const keys: (keyof SettingsState)[] = [
        'theme','language','fontSize','customAccent',
        'randomMin','randomMax','workspace','panelSizes',
        'aiProvider','aiApiKey','aiEndpoint','aiModel',
      ]
      const updates: any = {}
      for (const k of keys) {
        if (result[k] !== undefined && result[k] !== null) {
          updates[k] = k==='randomMin'||k==='randomMax'
            ? parseInt(result[k])
            : result[k]
        }
      }
      if (Object.keys(updates).length) set(updates)
    } catch {}
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
