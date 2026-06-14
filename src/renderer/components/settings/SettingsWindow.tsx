// 魔导书 Grimoire v7 — 设置窗口（独立窗口版）
import React, { useState, useEffect, useRef } from "react"
import { useSettingsStore } from "../../stores/settings.store"
import { useProviderStore } from "../../stores/providers.store"
import { ProviderEditor } from "./ProviderEditor"
import type { Provider } from "@shared/types"

const THEMES = [
  { key: "neon", zh: "霓虹", color: "#a855f7" },
  { key: "clean", zh: "简洁", color: "#3b82f6" },
  { key: "gold", zh: "金色", color: "#f59e0b" },
  { key: "midnight", zh: "暗夜", color: "#6366f1" },
  { key: "sakura", zh: "樱花", color: "#ec4899" },
  { key: "forest", zh: "森林", color: "#22c55e" },
  { key: "sunset", zh: "日落", color: "#f97316" },
]

type Section = "general" | "appearance" | "api" | "data" | "about"

export function SettingsWindow({ onClose }: { onClose: () => void }) {
  const { theme, language, custom_accent, ui_scale, random_min, random_max, setSetting } = useSettingsStore()
  const { providers, activeProvider, loadProviders, saveProvider, deleteProvider, setActive } = useProviderStore()
  const [section, setSection] = useState<Section>("general")
  const [accentInput, setAccentInput] = useState(custom_accent)
  const initialized = useRef(false)

  const [editingProvider, setEditingProvider] = useState<Provider | null>(null)
  const [showProviderEditor, setShowProviderEditor] = useState(false)

  useEffect(() => {
    if (!initialized.current) {
      initialized.current = true
      setAccentInput(custom_accent)
      loadProviders()
    }
  }, [])

  const sections: { key: Section; label: string; icon: string }[] = [
    { key: "general", label: "通用", icon: "⚙" },
    { key: "appearance", label: "外观", icon: "🎨" },
    { key: "api", label: "API 配置", icon: "🔌" },
    { key: "data", label: "数据管理", icon: "💾" },
    { key: "about", label: "关于", icon: "ℹ" },
  ]

  return (
    <div className="flex h-screen overflow-hidden bg-[var(--color-bg-primary)]">
      {/* Left nav */}
      <div className="w-[180px] min-w-[180px] border-r border-[var(--color-border)] bg-[var(--color-bg-secondary)] flex flex-col">
        <div className="px-4 py-3 border-b border-[var(--color-border)]">
          <span className="font-bold text-sm text-[var(--color-text-primary)]">⚙ 设置</span>
        </div>
        <div className="flex-1 py-2">
          {sections.map(s => (
            <button key={s.key} onClick={() => setSection(s.key)}
              className={`w-full text-left px-4 py-2.5 text-sm transition-colors ${
                section === s.key
                  ? "bg-[var(--color-accent)]/10 text-[var(--color-accent)] border-r-2 border-[var(--color-accent)]"
                  : "text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-primary)]"
              }`}>
              <span className="mr-2">{s.icon}</span>{s.label}
            </button>
          ))}
        </div>
      </div>

      {/* Right content */}
      <div className="flex-1 overflow-y-auto p-6">
        {section === "general" && (
          <div className="space-y-4">
            <h2 className="text-lg font-bold text-[var(--color-text-primary)] mb-4">通用设置</h2>
            <Field label="语言">
              <select value={language} onChange={async e => { await setSetting("language", e.target.value) }}
                className="w-48 px-3 py-2 bg-[var(--color-bg-primary)] border border-[var(--color-border)] rounded text-sm text-[var(--color-text-primary)]">
                <option value="zh">中文</option>
                <option value="en">English</option>
              </select>
            </Field>
            <Field label="随机标签数范围">
              <div className="flex items-center gap-2">
                <input type="number" value={random_min} onChange={e => setSetting("random_min", e.target.value)}
                  className="w-20 px-3 py-2 bg-[var(--color-bg-primary)] border border-[var(--color-border)] rounded text-sm" />
                <span className="text-[var(--color-text-secondary)]">—</span>
                <input type="number" value={random_max} onChange={e => setSetting("random_max", e.target.value)}
                  className="w-20 px-3 py-2 bg-[var(--color-bg-primary)] border border-[var(--color-border)] rounded text-sm" />
              </div>
            </Field>
          </div>
        )}

        {section === "appearance" && (
          <div className="space-y-4">
            <h2 className="text-lg font-bold text-[var(--color-text-primary)] mb-4">外观</h2>
            <Field label="主题">
              <div className="grid grid-cols-4 gap-2">
                {THEMES.map(tm => (
                  <button key={tm.key} onClick={() => setSetting("theme", tm.key)}
                    className={`py-2 text-xs rounded-lg border transition-colors ${
                      theme === tm.key ? "border-[var(--color-accent)] bg-[var(--color-accent)]/15 text-[var(--color-accent)]" : "border-[var(--color-border)] text-[var(--color-text-secondary)] hover:border-[var(--color-accent)]/50"
                    }`}>
                    <div className="w-4 h-4 rounded-full mx-auto mb-1" style={{ backgroundColor: tm.color }} />
                    {tm.zh}
                  </button>
                ))}
              </div>
            </Field>
            <Field label="自定义强调色">
              <div className="flex gap-2 items-center">
                <input type="color" value={accentInput} onChange={e => setAccentInput(e.target.value)}
                  className="w-10 h-8 rounded border border-[var(--color-border)] cursor-pointer" />
                <input type="text" value={accentInput} onChange={e => setAccentInput(e.target.value)}
                  className="flex-1 px-3 py-2 bg-[var(--color-bg-primary)] border border-[var(--color-border)] rounded text-sm" />
                <button onClick={() => { setSetting("custom_accent", accentInput); showToast("已保存", "success") }}
                  className="px-4 py-2 text-sm bg-[var(--color-accent)] text-white rounded">保存</button>
              </div>
            </Field>
          </div>
        )}

        {section === "api" && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-bold text-[var(--color-text-primary)]">API 供应商</h2>
              <button onClick={() => { setEditingProvider(null); setShowProviderEditor(true) }}
                className="px-3 py-1.5 text-sm bg-[var(--color-accent)] text-white rounded hover:opacity-90">
                + 新增供应商
              </button>
            </div>

            {showProviderEditor ? (
              <div className="border border-[var(--color-border)] rounded-lg overflow-hidden">
                <ProviderEditor
                  key={editingProvider?.id || "new"}
                  provider={editingProvider}
                  onSave={async (data) => {
                    try {
                      await saveProvider(data)
                      setShowProviderEditor(false)
                      setEditingProvider(null)
                      showToast("供应商已保存", "success")
                    } catch (e: any) {
                      showToast("保存失败: " + (e.message || ""), "error")
                    }
                  }}
                  onCancel={() => { setShowProviderEditor(false); setEditingProvider(null) }}
                />
              </div>
            ) : (
              <>
                {providers.length === 0 ? (
                  <div className="text-center py-12 text-[var(--color-text-secondary)]">
                    <div className="text-4xl mb-3">🔌</div>
                    <div className="text-sm">尚未配置 API 供应商</div>
                    <div className="text-xs mt-1">点击「新增供应商」开始配置</div>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {providers.map(p => (
                      <div key={p.id}
                        className={`flex items-center gap-3 px-4 py-3 rounded-lg border transition-colors ${
                          p.is_active ? "border-[var(--color-accent)] bg-[var(--color-accent)]/10" : "border-[var(--color-border)] hover:border-[var(--color-accent)]/40"
                        }`}>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-medium text-[var(--color-text-primary)] truncate">{p.name}</span>
                            {p.is_active && <span className="text-[10px] px-1.5 py-0.5 bg-[var(--color-accent)]/20 text-[var(--color-accent)] rounded">当前</span>}
                          </div>
                          <div className="text-xs text-[var(--color-text-secondary)] truncate mt-0.5">{p.base_url} · {p.default_model}</div>
                          {p.models.length > 0 && (
                            <div className="flex gap-1 mt-1 flex-wrap">
                              {p.models.slice(0, 4).map(m => <span key={m} className="text-[10px] px-1.5 py-0.5 bg-[var(--color-bg-primary)] rounded text-[var(--color-text-secondary)]">{m}</span>)}
                              {p.models.length > 4 && <span className="text-[10px] text-[var(--color-text-secondary)]">+{p.models.length - 4}</span>}
                            </div>
                          )}
                        </div>
                        <div className="flex gap-1 shrink-0">
                          {!p.is_active && <button onClick={() => setActive(p.id)} className="px-2 py-1 text-xs border border-[var(--color-accent)]/30 text-[var(--color-accent)] rounded hover:bg-[var(--color-accent)]/15">切换</button>}
                          <button onClick={() => { setEditingProvider(p); setShowProviderEditor(true) }} className="px-2 py-1 text-xs border border-[var(--color-border)] rounded hover:border-[var(--color-accent)]/40">✏️</button>
                          <button onClick={() => { if (confirm("删除供应商「" + p.name + "」？")) deleteProvider(p.id) }} className="px-2 py-1 text-xs border border-[var(--color-border)] rounded hover:border-red-400 hover:text-red-400">🗑</button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
                {activeProvider && (
                  <div className="mt-4 p-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-secondary)]">
                    <div className="text-xs text-[var(--color-text-secondary)] space-y-1">
                      <div className="flex justify-between"><span>当前供应商</span><span className="text-[var(--color-accent)]">{activeProvider.name}</span></div>
                      <div className="flex justify-between"><span>模型</span><span>{activeProvider.default_model}</span></div>
                      <div className="flex justify-between"><span>协议</span><span>{activeProvider.protocol === "chat_completions" ? "Chat Completions" : "Responses API"}</span></div>
                      <div className="flex justify-between"><span>可用模型数</span><span>{activeProvider.models.length}</span></div>
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        )}

        {section === "data" && (
          <div className="space-y-4">
            <h2 className="text-lg font-bold text-[var(--color-text-primary)] mb-4">数据管理</h2>
            <Field label="数据库" desc="备份和恢复全部数据（标签、预设、历史、设置、对话）">
              <div className="flex gap-3">
                <button onClick={() => window.api.db.export()} className="flex-1 py-3 text-sm border border-[var(--color-border)] rounded hover:bg-[var(--color-accent)]/10">📤 导出数据库</button>
                <button onClick={() => window.api.db.import()} className="flex-1 py-3 text-sm border border-[var(--color-border)] rounded hover:bg-[var(--color-accent)]/10">📥 导入数据库</button>
              </div>
            </Field>
          </div>
        )}

        {section === "about" && (
          <div className="space-y-3 text-sm text-[var(--color-text-secondary)]">
            <h2 className="text-lg font-bold text-[var(--color-text-primary)] mb-4">关于</h2>
            <div className="text-lg font-bold text-[var(--color-text-primary)]">魔导书 Grimoire</div>
            <div>版本 v7.0.0</div>
            <div>协议 GPL-3.0</div>
            <div>技术栈 Electron + React + TypeScript + Tailwind CSS</div>
            <a href="#" onClick={e => { e.preventDefault(); require("electron").shell.openExternal("https://github.com/hanqingyan3293/Grimoire-Prompt-Combiner") }}
              className="text-[var(--color-accent)] hover:underline mt-2 inline-block">GitHub</a>
          </div>
        )}
      </div>
    </div>
  )
}

function Field({ label, desc, children }: { label: string; desc?: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-sm font-medium text-[var(--color-text-primary)] mb-1">{label}</div>
      {desc && <div className="text-xs text-[var(--color-text-secondary)] mb-1.5">{desc}</div>}
      {children}
    </div>
  )
}

function showToast(message: string, type: "success" | "error" | "info") {
  window.dispatchEvent(new CustomEvent("grimoire:toast", { detail: { message, type } }))
}
