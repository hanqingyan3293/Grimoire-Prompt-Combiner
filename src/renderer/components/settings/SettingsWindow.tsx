// 魔导书 Grimoire v7 — 设置窗口（独立窗口版）
import React, { useState, useEffect, useRef } from "react"
import { useSettingsStore } from "../../stores/settings.store"
import { useProviderStore } from "../../stores/providers.store"
import { ProviderEditor } from "./ProviderEditor"
import type { Provider } from "@shared/types"

const THEMES = [
  { key: "neon", zh: "霓虹", color: "#a855f7", bg: "#0f0f1a", panel: "#1a1a2e", border: "#414166" },
  { key: "clean", zh: "简洁", color: "#3b82f6", bg: "#f8fafc", panel: "#ffffff", border: "#cbd5e1" },
  { key: "gold", zh: "金色", color: "#f59e0b", bg: "#1a1a0f", panel: "#2a2a1a", border: "#666241" },
  { key: "midnight", zh: "暗夜", color: "#6366f1", bg: "#0f172a", panel: "#1e293b", border: "#64748b" },
  { key: "sakura", zh: "樱花", color: "#ec4899", bg: "#1a0f15", panel: "#2a1a25", border: "#65495e" },
  { key: "forest", zh: "森林", color: "#22c55e", bg: "#0f1a12", panel: "#1a2a1e", border: "#4b6651" },
  { key: "sunset", zh: "日落", color: "#f97316", bg: "#1a100f", panel: "#2a1a18", border: "#664936" },
]

type Section = "general" | "appearance" | "api" | "shortcuts" | "data" | "about"

const DEFAULT_SHORTCUTS: Record<string, string> = {
  "chat.send": "Enter",
  "chat.newline": "Shift+Enter",
  "global.search": "Ctrl+F",
  "global.undo": "Ctrl+Z",
  "global.redo": "Ctrl+Shift+Z",
  "global.copy": "Ctrl+C",
  "global.close": "Escape",
}

export function SettingsWindow({ onClose }: { onClose: () => void }) {
  const {
    theme,
    language,
    custom_accent,
    custom_bg_primary,
    custom_bg_secondary,
    custom_bg_tertiary,
    custom_border,
    ui_scale,
    ui_density,
    random_min,
    random_max,
    setSetting,
  } = useSettingsStore()
  const { providers, activeProvider, loadProviders, saveProvider, deleteProvider, setActive } = useProviderStore()
  const [section, setSection] = useState<Section>("general")
  const [accentInput, setAccentInput] = useState(custom_accent)
  const [shortcuts, setShortcuts] = useState<Record<string, string>>({})
  const [editingShortcut, setEditingShortcut] = useState<string | null>(null)
  const initialized = useRef(false)

  const [editingProvider, setEditingProvider] = useState<Provider | null>(null)
  const [showProviderEditor, setShowProviderEditor] = useState(false)

  useEffect(() => {
    if (!initialized.current) {
      initialized.current = true
      setAccentInput(custom_accent)
      loadProviders()
      // Load shortcuts
      loadShortcuts()
    }
  }, [])

  const loadShortcuts = async () => {
    try {
      const raw = await window.api.settings.getAll() as Record<string, string>
      const saved: Record<string, string> = {}
      for (const [k, v] of Object.entries(DEFAULT_SHORTCUTS)) {
        saved[k] = raw["shortcut_" + k] || v
      }
      setShortcuts(saved)
    } catch { setShortcuts({ ...DEFAULT_SHORTCUTS }) }
  }

  const saveShortcut = async (key: string, value: string) => {
    const updated = { ...shortcuts, [key]: value }
    setShortcuts(updated)
    await setSetting("shortcut_" + key, value)
    setEditingShortcut(null)
  }

  const sections: { key: Section; label: string; icon: string }[] = [
    { key: "general", label: "通用", icon: "⚙" },
    { key: "appearance", label: "外观", icon: "🎨" },
    { key: "api", label: "API 配置", icon: "🔌" },
    { key: "shortcuts", label: "快捷键", icon: "⌨" },
    { key: "data", label: "数据", icon: "💾" },
    { key: "about", label: "关于", icon: "ℹ" },
  ]

  const shortcutLabels: Record<string, string> = {
    "chat.send": "发送消息", "chat.newline": "换行",
    "global.search": "搜索", "global.undo": "撤销",
    "global.redo": "重做", "global.copy": "复制", "global.close": "关闭窗口",
  }

  const currentTheme = THEMES.find(tm => tm.key === theme) || THEMES[0]
  const colorControls = [
    { key: "custom_bg_primary", label: "页面背景", value: custom_bg_primary, fallback: currentTheme.bg },
    { key: "custom_bg_secondary", label: "面板背景", value: custom_bg_secondary, fallback: currentTheme.panel },
    { key: "custom_bg_tertiary", label: "工具栏背景", value: custom_bg_tertiary, fallback: currentTheme.panel },
    { key: "custom_border", label: "边框颜色", value: custom_border, fallback: currentTheme.border },
  ]

  return (
    <div className="flex h-screen overflow-hidden bg-[var(--color-bg-primary)]">
      {/* Left nav */}
      <div className="w-[200px] min-w-[200px] border-r border-[var(--color-border)] bg-[var(--color-bg-secondary)] flex flex-col">
        <div className="px-5 py-4 border-b border-[var(--color-border)]">
          <span className="font-bold text-base text-[var(--color-text-primary)]">⚙ 设置</span>
        </div>
        <div className="flex-1 py-2">
          {sections.map(s => (
            <button key={s.key} onClick={() => setSection(s.key)}
              className={`w-full text-left px-5 py-3 text-sm transition-colors ${
                section === s.key
                  ? "bg-[var(--color-accent)]/15 text-[var(--color-accent)] border-r-[3px] border-[var(--color-accent)] font-medium"
                  : "text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-primary)] hover:text-[var(--color-text-primary)]"
              }`}>
              <span className="mr-3">{s.icon}</span>{s.label}
            </button>
          ))}
        </div>
      </div>

      {/* Right content */}
      <div className="flex-1 overflow-y-auto p-8">
        {section === "general" && (
          <div className="space-y-5">
            <h2 className="text-xl font-bold text-[var(--color-text-primary)] mb-6">通用设置</h2>
            <Field label="语言">
              <select value={language} onChange={async e => { await setSetting("language", e.target.value) }}
                className="w-52 px-4 py-2.5 bg-[var(--color-bg-primary)] border border-[var(--color-border)] rounded-lg text-sm text-[var(--color-text-primary)]">
                <option value="zh">中文</option>
                <option value="en">English</option>
              </select>
            </Field>

	            <Field label="字体大小" desc="使用像素值调整全局字体大小">
	              <div className="flex items-center gap-4">
	                <input
	                  type="range"
	                  draggable={false}
	                  min="12"
	                  max="20"
	                  step="1"
	                  value={ui_scale}
	                  onPointerDown={e => e.stopPropagation()}
	                  onMouseDown={e => e.stopPropagation()}
	                  onDragStart={e => e.preventDefault()}
	                  onChange={e => setSetting("ui_scale", e.target.value)}
	                  className="flex-1 cursor-pointer accent-[var(--color-accent)]"
	                />
	                <input
	                  type="number"
	                  min="12"
	                  max="20"
	                  value={ui_scale}
	                  onChange={e => setSetting("ui_scale", e.target.value)}
	                  className="w-20 px-3 py-2 bg-[var(--color-bg-primary)] border border-[var(--color-border)] rounded-lg text-sm text-[var(--color-text-primary)]"
	                />
	                <span className="w-8 text-sm text-[var(--color-text-secondary)]">px</span>
	              </div>
	            </Field>
	            <Field label="界面密度" desc="调整面板标题栏、分割线和控件尺寸">
	              <div className="flex gap-2">
	                {["compact","normal","comfortable"].map(d => (
	                  <button key={d} onClick={() => setSetting("ui_density", d)}
	                    className={"flex-1 py-2 text-sm rounded-lg border transition-colors " + (ui_density === d ? "bg-[var(--color-accent)]/15 border-[var(--color-accent)] text-[var(--color-accent)] font-medium" : "border-[var(--color-border)] text-[var(--color-text-secondary)] hover:border-[var(--color-accent)]/50")}>
	                    {d === "compact" ? "紧凑" : d === "normal" ? "标准" : "舒适"}
	                  </button>
	                ))}
	              </div>
	            </Field>
            <Field label="随机标签数范围">
              <div className="flex items-center gap-3">
                <input type="number" value={random_min} onChange={e => setSetting("random_min", e.target.value)}
                  className="w-24 px-4 py-2.5 bg-[var(--color-bg-primary)] border border-[var(--color-border)] rounded-lg text-sm" />
                <span className="text-[var(--color-text-secondary)] text-sm">至</span>
                <input type="number" value={random_max} onChange={e => setSetting("random_max", e.target.value)}
                  className="w-24 px-4 py-2.5 bg-[var(--color-bg-primary)] border border-[var(--color-border)] rounded-lg text-sm" />
              </div>
            </Field>
            <div className="mt-6 px-4 py-3 rounded-lg border border-[var(--color-accent)]/30 bg-[var(--color-accent)]/5 text-sm text-[var(--color-text-secondary)]">
              提示：由于多窗口限制，若设置或历史记录未同步，请手动按 Ctrl+R 刷新页面。
            </div>
          </div>
        )}

        {section === "appearance" && (
          <div className="space-y-5">
            <h2 className="text-xl font-bold text-[var(--color-text-primary)] mb-6">外观</h2>
            <Field label="主题" desc="切换页面背景、面板层级、边框和默认强调色">
              <div className="grid grid-cols-4 gap-3">
                {THEMES.map(tm => (
                  <button
                    key={tm.key}
                    onClick={async () => {
                      setAccentInput(tm.color)
                      await setSetting("theme", tm.key)
                      await setSetting("custom_accent", tm.color)
                      await setSetting("custom_bg_primary", "")
                      await setSetting("custom_bg_secondary", "")
                      await setSetting("custom_bg_tertiary", "")
                      await setSetting("custom_border", "")
                    }}
                    className={`overflow-hidden rounded-lg border-2 text-left text-sm transition-all ${
                      theme === tm.key ? "border-[var(--color-accent)] bg-[var(--color-accent)]/10 text-[var(--color-accent)] scale-[1.02]" : "border-[var(--color-border)] text-[var(--color-text-secondary)] hover:border-[var(--color-accent)]/50"
                    }`}
                  >
                    <div className="h-14 border-b border-black/10 p-2" style={{ backgroundColor: tm.bg }}>
                      <div className="h-full rounded border p-1.5" style={{ backgroundColor: tm.panel, borderColor: tm.border }}>
                        <div className="mb-1 h-1.5 w-10 rounded" style={{ backgroundColor: tm.color }} />
                        <div className="h-1.5 w-16 rounded bg-white/25" />
                      </div>
                    </div>
                    <div className="px-3 py-2 font-medium">{tm.zh}</div>
                  </button>
                ))}
              </div>
            </Field>
            <Field label="自定义强调色">
              <div className="flex gap-3 items-center">
                <input type="color" value={accentInput} onChange={e => setAccentInput(e.target.value)}
                  className="w-12 h-10 rounded-lg border border-[var(--color-border)] cursor-pointer" />
                <input value={accentInput} onChange={e => setAccentInput(e.target.value)}
                  className="flex-1 px-4 py-2.5 bg-[var(--color-bg-primary)] border border-[var(--color-border)] rounded-lg text-sm" />
                <button onClick={() => { setSetting("custom_accent", accentInput); showToast("已保存", "success") }}
                  className="px-5 py-2.5 text-sm bg-[var(--color-accent)] text-white rounded-lg hover:opacity-90">保存</button>
              </div>
            </Field>
            <Field label="界面颜色" desc="可单独覆盖页面、面板、工具栏和边框；点默认回到当前主题颜色">
              <div className="grid grid-cols-2 gap-3">
                {colorControls.map(item => (
                  <div key={item.key} className="flex items-center gap-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-secondary)] px-3 py-2.5">
                    <input
                      type="color"
                      value={item.value || item.fallback}
                      onChange={e => setSetting(item.key, e.target.value)}
                      className="h-9 w-11 shrink-0 cursor-pointer rounded-md border border-[var(--color-border)] bg-transparent"
                    />
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-medium text-[var(--color-text-primary)]">{item.label}</div>
                      <div className="font-mono text-xs text-[var(--color-text-secondary)]">{item.value || "主题默认"}</div>
                    </div>
                    <button
                      onClick={() => setSetting(item.key, "")}
                      className="shrink-0 rounded-md border border-[var(--color-border)] px-3 py-1.5 text-xs text-[var(--color-text-secondary)] hover:border-[var(--color-accent)]/50 hover:text-[var(--color-accent)]"
                    >
                      默认
                    </button>
                  </div>
                ))}
              </div>
            </Field>
          </div>
        )}

        {section === "api" && (
          <div className="space-y-4">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-xl font-bold text-[var(--color-text-primary)]">API 供应商</h2>
              <button onClick={() => { setEditingProvider(null); setShowProviderEditor(true) }}
                className="px-4 py-2 text-sm bg-[var(--color-accent)] text-white rounded-lg hover:opacity-90 font-medium">
                + 新增供应商
              </button>
            </div>

            {showProviderEditor ? (
              <div className="border border-[var(--color-border)] rounded-xl overflow-hidden">
                <ProviderEditor
                  key={editingProvider?.id || "new"}
                  provider={editingProvider}
                  onSave={async (data) => {
                    try { await saveProvider(data); setShowProviderEditor(false); setEditingProvider(null); showToast("已保存", "success") }
                    catch (e: any) { showToast("保存失败: " + (e.message || ""), "error") }
                  }}
                  onCancel={() => { setShowProviderEditor(false); setEditingProvider(null) }}
                />
              </div>
            ) : (
              <>
                {providers.length === 0 ? (
                  <div className="text-center py-16 text-[var(--color-text-secondary)]">
                    <div className="text-5xl mb-4">🔌</div>
                    <div className="text-base">尚未配置 API 供应商</div>
                    <div className="text-sm mt-2 opacity-70">点击「新增供应商」开始配置</div>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {providers.map(p => (
                      <div key={p.id} onClick={() => { if (!p.is_active) setActive(p.id) }}
                        className={`flex items-center gap-4 px-5 py-4 rounded-xl border-2 transition-all cursor-pointer ${
                          p.is_active
                            ? "border-[var(--color-accent)] bg-[var(--color-accent)]/10 shadow-sm"
                            : "border-[var(--color-border)] hover:border-[var(--color-accent)]/40 hover:bg-[var(--color-bg-secondary)]"
                        }`}>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-3">
                            <span className="text-base font-semibold text-[var(--color-text-primary)] truncate">{p.name}</span>
                            {p.is_active && (
                              <span className="text-xs px-2.5 py-1 bg-[var(--color-accent)] text-white rounded-full font-medium">当前</span>
                            )}
                          </div>
                          <div className="text-sm text-[var(--color-text-secondary)] truncate mt-1">{p.base_url} · {p.default_model}</div>
                          {p.models.length > 0 && (
                            <div className="flex gap-1.5 mt-2 flex-wrap">
                              {p.models.slice(0, 5).map(m => (
                                <span key={m} className="text-xs px-2 py-0.5 bg-[var(--color-bg-primary)] rounded-md text-[var(--color-text-secondary)] border border-[var(--color-border)]">{m}</span>
                              ))}
                              {p.models.length > 5 && <span className="text-xs text-[var(--color-text-secondary)] self-center">+{p.models.length - 5}</span>}
                            </div>
                          )}
                        </div>
                        <div className="flex gap-1.5 shrink-0" onClick={e => e.stopPropagation()}>
                          <button onClick={() => { setEditingProvider(p); setShowProviderEditor(true) }}
                            className="px-3 py-1.5 text-sm border border-[var(--color-border)] rounded-lg hover:border-[var(--color-accent)]/50 hover:text-[var(--color-accent)] transition-colors">✏️</button>
                          <button onClick={() => { if (confirm("删除供应商「" + p.name + "」？")) deleteProvider(p.id) }}
                            className="px-3 py-1.5 text-sm border border-[var(--color-border)] rounded-lg hover:border-red-400 hover:text-red-400 transition-colors">🗑</button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
                {activeProvider && !showProviderEditor && (
                  <div className="mt-4 p-4 rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-secondary)]">
                    <div className="grid grid-cols-2 gap-2 text-sm">
                      <div className="text-[var(--color-text-secondary)]">当前供应商</div><div className="text-[var(--color-accent)] font-medium text-right">{activeProvider.name}</div>
                      <div className="text-[var(--color-text-secondary)]">默认模型</div><div className="text-[var(--color-text-primary)] text-right">{activeProvider.default_model}</div>
                      <div className="text-[var(--color-text-secondary)]">协议</div><div className="text-[var(--color-text-primary)] text-right">{activeProvider.protocol === "chat_completions" ? "Chat Completions" : "Responses API"}</div>
                      <div className="text-[var(--color-text-secondary)]">可用模型</div><div className="text-[var(--color-text-primary)] text-right">{activeProvider.models.length} 个</div>
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        )}

        {section === "shortcuts" && (
          <div className="space-y-4">
            <h2 className="text-xl font-bold text-[var(--color-text-primary)] mb-6">快捷键管理</h2>
            <div className="text-sm text-[var(--color-text-secondary)] mb-4">点击快捷键进行修改，按新组合键后自动保存</div>
            <div className="space-y-2">
              {Object.entries(shortcutLabels).map(([key, label]) => (
                <div key={key} className="flex items-center gap-4 px-4 py-3 rounded-lg border border-[var(--color-border)] hover:bg-[var(--color-bg-secondary)]">
                  <span className="text-sm text-[var(--color-text-primary)] w-28 font-medium">{label}</span>
                  <div className="flex-1 flex items-center gap-2">
                    {editingShortcut === key ? (
                      <input
                        autoFocus
                        value={shortcuts[key] || ""}
                        onKeyDown={e => {
                          e.preventDefault()
                          const keys: string[] = []
                          if (e.ctrlKey) keys.push("Ctrl")
                          if (e.shiftKey) keys.push("Shift")
                          if (e.altKey) keys.push("Alt")
                          if (e.key !== "Control" && e.key !== "Shift" && e.key !== "Alt") keys.push(e.key === " " ? "Space" : e.key)
                          const combo = keys.join("+") || ""
                          if (e.key === "Backspace" || e.key === "Delete") { saveShortcut(key, ""); return }
                          if (keys.length > 0) saveShortcut(key, combo)
                        }}
                        className="px-3 py-1.5 bg-[var(--color-bg-primary)] border-2 border-[var(--color-accent)] rounded-lg text-sm text-[var(--color-text-primary)] outline-none w-48"
                        placeholder="按下新快捷键..."
                        onBlur={() => setEditingShortcut(null)}
                      />
                    ) : (
                      <button onClick={() => setEditingShortcut(key)}
                        className="px-3 py-1.5 bg-[var(--color-bg-primary)] border border-[var(--color-border)] rounded-lg text-sm font-mono text-[var(--color-accent)] hover:border-[var(--color-accent)] min-w-[80px]">
                        {shortcuts[key] || "（未设置）"}
                      </button>
                    )}
                    <button onClick={() => saveShortcut(key, "")}
                      className="text-xs text-[var(--color-text-secondary)] hover:text-red-400 px-2 py-1"
                      title="清除快捷键">✕ 清除</button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {section === "data" && (
          <div className="space-y-5">
            <h2 className="text-xl font-bold text-[var(--color-text-primary)] mb-6">数据管理</h2>
            <Field label="数据库" desc="备份和恢复全部数据">
              <div className="flex gap-3">
                <button onClick={() => window.api.db.export()} className="flex-1 py-4 text-sm border border-[var(--color-border)] rounded-xl hover:bg-[var(--color-accent)]/10 transition-colors font-medium">📤 导出数据库</button>
                <button onClick={() => window.api.db.import()} className="flex-1 py-4 text-sm border border-[var(--color-border)] rounded-xl hover:bg-[var(--color-accent)]/10 transition-colors font-medium">📥 导入数据库</button>
              </div>
            </Field>
          </div>
        )}

        {section === "about" && (
          <div className="space-y-3">
            <h2 className="text-xl font-bold text-[var(--color-text-primary)] mb-6">关于</h2>
            <div className="text-2xl font-bold text-[var(--color-text-primary)]">魔导书 Grimoire</div>
            <div className="text-sm text-[var(--color-text-secondary)]">版本 v7.0.0 · GPL-3.0</div>
            <div className="text-sm text-[var(--color-text-secondary)]">Electron + React + TypeScript + Tailwind CSS</div>
          </div>
        )}
      </div>
    </div>
  )
}

function Field({ label, desc, children }: { label: string; desc?: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-sm font-semibold text-[var(--color-text-primary)] mb-2">{label}</div>
      {desc && <div className="text-xs text-[var(--color-text-secondary)] mb-2">{desc}</div>}
      {children}
    </div>
  )
}

function showToast(message: string, type: "success" | "error" | "info") {
  window.dispatchEvent(new CustomEvent("grimoire:toast", { detail: { message, type } }))
}
