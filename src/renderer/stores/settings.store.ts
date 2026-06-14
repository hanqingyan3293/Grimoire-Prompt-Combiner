// Grimoire v7 - Settings Store
import { create } from "zustand"
import type { AppSettings } from "@shared/types"

interface SettingsState extends AppSettings {
  shortcuts: Record<string, string>
  loading: boolean
  loadSettings: () => Promise<void>
  setSetting: (key: string, value: string) => Promise<void>
  getShortcut: (key: string) => string
}

export const useSettingsStore = create<SettingsState>((set, get) => ({
  theme: "neon",
  language: "zh",
  custom_accent: "#a855f7",
  ui_scale: "medium",
  max_undo_steps: 50,
  random_min: "3",
  random_max: "16",
  shortcuts: {},
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
      // Load shortcuts
      const shortcuts: Record<string, string> = {}
      for (const [k, v] of Object.entries(raw)) {
        if (k.startsWith("shortcut_")) {
          shortcuts[k.replace("shortcut_", "")] = v
        }
      }
      set({ shortcuts })

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
    if (key.startsWith("shortcut_")) {
      const sk = key.replace("shortcut_", "")
      set(s => ({ shortcuts: { ...s.shortcuts, [sk]: value } }))
    }
  },

  getShortcut: (key: string) => {
    const defaults: Record<string, string> = {
      "chat.send": "Enter",
      "chat.newline": "Shift+Enter",
      "global.search": "Ctrl+F",
      "global.undo": "Ctrl+Z",
      "global.redo": "Ctrl+Shift+Z",
      "global.copy": "Ctrl+C",
      "global.close": "Escape",
    }
    return get().shortcuts[key] || defaults[key] || ""
  },
}))
