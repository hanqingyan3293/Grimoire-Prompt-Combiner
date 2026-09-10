// Grimoire v7 - Settings Store
import { create } from "zustand"
import type { AppSettings } from "@shared/types"

interface SettingsState extends AppSettings {
  shortcuts: Record<string, string>
  loading: boolean
  loadSettings: () => Promise<void>
  setSetting: (key: string, value: string) => Promise<void>
  setThemePreference: (theme: string, accent: string) => Promise<void>
  getShortcut: (key: string) => string
}

const LEGACY_UI_SCALE_VALUES: Record<string, number> = {
  small: 13,
  medium: 14,
  large: 16,
}

function normalizeUiFontSize(value: string) {
  const mapped = LEGACY_UI_SCALE_VALUES[value]
  if (mapped) return String(mapped)
  const parsed = Number.parseInt(value, 10)
  if (!Number.isFinite(parsed)) return "14"
  return String(Math.min(20, Math.max(12, parsed)))
}

function applyUiScale(value: string) {
  const fontSize = normalizeUiFontSize(value)
  document.documentElement.setAttribute("data-ui-scale", fontSize)
  document.documentElement.style.setProperty("--ui-font-size", `${fontSize}px`)
}

function applyUiDensity(density: string) {
  document.documentElement.setAttribute("data-ui-density", density)
}

let appearanceMediaCleanup: (() => void) | null = null

function normalizeAppearanceMode(value: string): "system" | "light" | "dark" {
  return value === "light" || value === "dark" ? value : "system"
}

function applyAppearanceMode(value: string) {
  appearanceMediaCleanup?.()
  appearanceMediaCleanup = null
  const mode = normalizeAppearanceMode(value)
  const media = window.matchMedia("(prefers-color-scheme: dark)")
  const apply = () => {
    document.documentElement.setAttribute("data-appearance-mode", mode)
    document.documentElement.setAttribute("data-appearance", mode === "system" ? (media.matches ? "dark" : "light") : mode)
  }
  apply()
  if (mode === "system") {
    media.addEventListener("change", apply)
    appearanceMediaCleanup = () => media.removeEventListener("change", apply)
  }
}

const COLOR_OVERRIDE_VARS = {
  custom_bg_primary: "--color-bg-primary",
  custom_bg_secondary: "--color-bg-secondary",
  custom_bg_tertiary: "--color-bg-tertiary",
  custom_border: "--color-border",
} as const

type ColorOverrideKey = keyof typeof COLOR_OVERRIDE_VARS

function adjustHexColor(hex: string, amount: number) {
  if (!/^#[0-9a-fA-F]{6}$/.test(hex)) return hex
  const next = [1, 3, 5].map(start => {
    const value = Number.parseInt(hex.slice(start, start + 2), 16)
    return Math.min(255, Math.max(0, value + amount)).toString(16).padStart(2, "0")
  })
  return `#${next.join("")}`
}

function colorLuminance(hex: string) {
  const channels = [1, 3, 5].map(start => Number.parseInt(hex.slice(start, start + 2), 16) / 255)
  const linear = channels.map(value => value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4)
  return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2]
}

function contrastRatio(first: string, second: string) {
  const a = colorLuminance(first)
  const b = colorLuminance(second)
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)
}

function findAccessibleShade(hex: string, background: string, direction: -1 | 1) {
  let shade = hex
  for (let step = 0; step < 32 && contrastRatio(shade, background) < 4.5; step += 1) {
    shade = adjustHexColor(shade, direction * 8)
  }
  return shade
}

function applyAccent(value: string) {
  if (!/^#[0-9a-fA-F]{6}$/.test(value)) return
  const fill = findAccessibleShade(value, '#ffffff', -1)
  document.documentElement.style.setProperty("--color-accent", value)
  document.documentElement.style.setProperty("--color-accent-hover", adjustHexColor(value, -22))
  document.documentElement.style.setProperty("--color-accent-fill", fill)
  document.documentElement.style.setProperty("--color-accent-fill-hover", adjustHexColor(fill, -18))
  document.documentElement.style.setProperty("--color-accent-foreground", '#ffffff')
  document.documentElement.style.setProperty("--color-accent-text-light", findAccessibleShade(value, '#ffffff', -1))
  document.documentElement.style.setProperty("--color-accent-text-dark", findAccessibleShade(value, '#191b1f', 1))
}

function isColorOverrideKey(key: string): key is ColorOverrideKey {
  return key in COLOR_OVERRIDE_VARS
}

function applyColorOverride(key: ColorOverrideKey, value: string) {
  const root = document.documentElement.style
  const cssVar = COLOR_OVERRIDE_VARS[key]
  if (/^#[0-9a-fA-F]{6}$/.test(value)) {
    root.setProperty(cssVar, value)
    if (key === "custom_border") {
      root.setProperty("--color-border-strong", adjustHexColor(value, 30))
    }
    return
  }

  root.removeProperty(cssVar)
  if (key === "custom_border") root.removeProperty("--color-border-strong")
}

function applyColorOverrides(values: Partial<Record<ColorOverrideKey, string>>) {
  Object.keys(COLOR_OVERRIDE_VARS).forEach(key => {
    applyColorOverride(key as ColorOverrideKey, values[key as ColorOverrideKey] || "")
  })
}

export const useSettingsStore = create<SettingsState>((set, get) => ({
  api_endpoint: "https://api.openai.com/v1",
  api_model: "gpt-4o",
  theme: "neon",
  appearance_mode: "system",
  language: "zh",
  custom_accent: "#a855f7",
  custom_bg_primary: "",
  custom_bg_secondary: "",
  custom_bg_tertiary: "",
  custom_border: "",
  ui_scale: "14",
  ui_density: "normal",
  max_undo_steps: 50,
  random_min: "3",
  random_max: "16",
  shortcuts: {},
  loading: false,

  loadSettings: async () => {
    set({ loading: true })
    try {
      const raw = await window.api.settings.getAll()
      const acc = raw.custom_accent || "#a855f7"
      const scale = normalizeUiFontSize(raw.ui_scale || "14")
      const density = raw.ui_density || "normal"
      const appearanceMode = normalizeAppearanceMode(raw.appearance_mode || "system")
      const colorOverrides = {
        custom_bg_primary: raw.custom_bg_primary || "",
        custom_bg_secondary: raw.custom_bg_secondary || "",
        custom_bg_tertiary: raw.custom_bg_tertiary || "",
        custom_border: raw.custom_border || "",
      }
      set({
        theme: raw.theme || "neon",
        appearance_mode: appearanceMode,
        api_endpoint: raw.api_endpoint || "https://api.openai.com/v1",
        api_model: raw.api_model || "gpt-4o",
        language: (raw.language as "zh" | "en") || "zh",
        custom_accent: acc,
        ...colorOverrides,
        ui_scale: scale,
        ui_density: density,
        max_undo_steps: Number.parseInt(String(raw.max_undo_steps), 10) || 50,
        random_min: raw.random_min || "3",
        random_max: raw.random_max || "16",
        loading: false,
      })
      // Load shortcuts
      const shortcuts: Record<string, string> = {}
      for (const [k, v] of Object.entries(raw)) {
        if (k.startsWith("shortcut_") && typeof v === "string") {
          shortcuts[k.replace("shortcut_", "")] = v
        }
      }
      set({ shortcuts })

      document.documentElement.setAttribute("data-theme", raw.theme || "neon")
      applyAppearanceMode(appearanceMode)
      document.documentElement.setAttribute("data-lang", raw.language || "zh")
      applyUiScale(scale)
      applyUiDensity(density)
      applyAccent(acc)
      applyColorOverrides(colorOverrides)
    } catch {
      set({ loading: false })
    }
  },

  setSetting: async (key, value) => {
    set({ [key]: value } as Partial<SettingsState>)
    try { await window.api.settings.set(key, value) } catch { /* ignore */ }

    if (key === "theme") document.documentElement.setAttribute("data-theme", value)
    if (key === "appearance_mode") applyAppearanceMode(value)
    if (key === "language") document.documentElement.setAttribute("data-lang", value)
    if (key === "ui_scale") applyUiScale(value)
    if (key === "ui_density") applyUiDensity(value)
    if (key === "custom_accent") applyAccent(value)
    if (isColorOverrideKey(key)) applyColorOverride(key, value)
    if (key.startsWith("shortcut_")) {
      const sk = key.replace("shortcut_", "")
      set(s => ({ shortcuts: { ...s.shortcuts, [sk]: value } }))
    }
  },

  setThemePreference: async (theme, accent) => {
    set({ theme, custom_accent: accent, custom_bg_primary: '', custom_bg_secondary: '', custom_bg_tertiary: '', custom_border: '' })
    await Promise.all(['theme', 'custom_accent', 'custom_bg_primary', 'custom_bg_secondary', 'custom_bg_tertiary', 'custom_border'].map(key => window.api.settings.set(key, key === 'theme' ? theme : key === 'custom_accent' ? accent : '')))
    document.documentElement.setAttribute('data-theme', theme)
    applyAccent(accent)
    try { if (window.parent && window.parent !== window) { window.parent.document.documentElement.setAttribute('data-theme', theme); window.parent.document.documentElement.style.setProperty('--color-accent', accent) } } catch {}
    window.dispatchEvent(new CustomEvent('grimoire:theme-changed', { detail: { theme, accent } }))
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
