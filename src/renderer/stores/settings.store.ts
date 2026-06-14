// 魔导书 Grimoire v7 — 设置 Store
import { create } from "zustand"
import type { AppSettings } from "@shared/types"

interface SettingsState extends AppSettings {
  loading: boolean
  loadSettings: () => Promise<void>
  setSetting: (key: string, value: string) => Promise<void>
}

export const useSettingsStore = create<SettingsState>((set, get) => ({
  theme: "neon",
  language: "zh",
  custom_accent: "#a855f7",
  ui_scale: "medium",
  max_undo_steps: 50,
  random_min: "3",
  random_max: "16",
  loading: false,
  
  loadSettings: async () => {
    set({ loading: true })
    try {
      const raw = await window.api.settings.getAll() as Record<string, string>
      const acc = raw.custom_accent || "#a855f7"
      const scale = raw.ui_scale || "medium"
      set({
        theme: raw.theme || "neon",
        language: (raw.language as "zh" | "en") || "zh",
        custom_accent: acc,
        ui_scale: scale,
        max_undo_steps: parseInt(raw.max_undo_steps) || 50,
        random_min: raw.random_min || "3",
        random_max: raw.random_max || "16",
        loading: false,
      })
      
      document.documentElement.setAttribute("data-theme", raw.theme || "neon")
      document.documentElement.setAttribute("data-lang", raw.language || "zh")
      document.documentElement.setAttribute("data-ui-scale", scale)
      document.documentElement.style.setProperty("--color-accent", acc)
    } catch {
      set({ loading: false })
    }
  },
  
  setSetting: async (key, value) => {
    set({ [key]: value } as Partial<SettingsState>)
    try { await window.api.settings.set(key, value) } catch { /* ignore */ }
    
    if (key === "theme") document.documentElement.setAttribute("data-theme", value)
    if (key === "language") document.documentElement.setAttribute("data-lang", value)
    if (key === "ui_scale") document.documentElement.setAttribute("data-ui-scale", value)
    if (key === "custom_accent") document.documentElement.style.setProperty("--color-accent", value)
  },
}))
