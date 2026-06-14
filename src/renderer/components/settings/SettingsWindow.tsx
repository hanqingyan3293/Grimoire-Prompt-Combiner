// 魔导书 Grimoire v7 — 设置窗口（PS 首选项风格）
import React, { useState, useEffect, useRef } from "react"
import { useSettingsStore } from "../../stores/settings.store"

const THEMES = [
  { key: "neon", zh: "霓虹", color: "#a855f7" },
  { key: "clean", zh: "简洁", color: "#3b82f6" },
  { key: "gold", zh: "金色", color: "#f59e0b" },
  { key: "midnight", zh: "暗夜", color: "#6366f1" },
  { key: "sakura", zh: "樱花", color: "#ec4899" },
  { key: "forest", zh: "森林", color: "#22c55e" },
  { key: "sunset", zh: "日落", color: "#f97316" },
]

const UI_SCALES = [
  { key: "small", zh: "小", desc: "紧凑" },
  { key: "medium", zh: "中", desc: "标准" },
  { key: "large", zh: "大", desc: "宽松" },
]

type Section = "general" | "appearance" | "api" | "data" | "about"

export function SettingsWindow({ onClose }: { onClose: () => void }) {
  const { api_key, api_endpoint, api_model, theme, language, custom_accent, ui_scale, random_min, random_max, setSetting } = useSettingsStore()
  const [section, setSection] = useState<Section>("general")
  const [keyInput, setKeyInput] = useState("")
  const [endpointInput, setEndpointInput] = useState(api_endpoint)
  const [modelInput, setModelInput] = useState(api_model)
  const [accentInput, setAccentInput] = useState(custom_accent)
  const [keyVisible, setKeyVisible] = useState(false)
  const [testResult, setTestResult] = useState<string | null>(null)
  const [testing, setTesting] = useState(false)
  const [minimized, setMinimized] = useState(false)
  const [winSize, setWinSize] = useState({ w: 780, h: 560 })
  const [pos, setPos] = useState({ x: 0, y: 0 })
  const [dragging, setDragging] = useState(false)
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 })
  const [resizing, setResizing] = useState(false)
  const [resizeStart, setResizeStart] = useState({ x: 0, y: 0, w: 0, h: 0 })
  const initialized = useRef(false)

  useEffect(() => {
    if (!initialized.current) {
      initialized.current = true
      setEndpointInput(api_endpoint); setModelInput(api_model); setAccentInput(custom_accent)
    }
  }, [])

  // Drag the whole window from the header bar
  const onHeaderMouseDown = (e: React.MouseEvent) => {
    if ((e.target as HTMLElement).tagName === "BUTTON") return
    setDragging(true); setDragStart({ x: e.clientX - pos.x, y: e.clientY - pos.y })
  }

  const onResizeMouseDown = (e: React.MouseEvent) => {
    e.preventDefault(); e.stopPropagation()
    setResizing(true)
    setResizeStart({ x: e.clientX, y: e.clientY, w: winSize.w, h: winSize.h })
  }

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (dragging) setPos({ x: e.clientX - dragStart.x, y: e.clientY - dragStart.y })
      if (resizing) setWinSize({ w: Math.max(500, resizeStart.w + (e.clientX - resizeStart.x)), h: Math.max(400, resizeStart.h + (e.clientY - resizeStart.y)) })
    }
    const onUp = () => { setDragging(false); setResizing(false) }
    if (dragging || resizing) {
      window.addEventListener("mousemove", onMove)
      window.addEventListener("mouseup", onUp)
      return () => { window.removeEventListener("mousemove", onMove); window.removeEventListener("mouseup", onUp) }
    }
  }, [dragging, resizing, dragStart, resizeStart])

  const sections: { key: Section; label: string }[] = [
    { key: "general", label: "通用" },
    { key: "appearance", label: "外观" },
    { key: "api", label: "API 配置" },
    { key: "data", label: "数据管理" },
    { key: "about", label: "关于" },
  ]

  const handleTestConnection = async () => {
    if (!keyInput && !api_key) { setTestResult("请先输入 API Key"); return }
    setTesting(true); setTestResult(null)
    const key = keyInput || api_key
    const ep = endpointInput.replace(/\/+$/, "") + "/chat/completions"
    try {
      const res = await fetch(ep, { method: "POST", headers: { "Content-Type": "application/json", "Authorization": `Bearer ${key}` }, body: JSON.stringify({ model: modelInput || "gpt-4o", messages: [{ role: "user", content: "hi" }], max_tokens: 1 }) })
      if (res.ok || res.status === 400) setTestResult("连接成功！API Key 有效")
      else if (res.status === 401) setTestResult("API Key 无效")
      else setTestResult("状态码 " + res.status)
    } catch (e) { setTestResult("网络错误: " + (e instanceof Error ? e.message : "未知")) }
    setTesting(false)
  }

  const handleSaveKey = async () => { if (keyInput) { await setSetting("api_key", keyInput); setKeyInput(""); showToast("已保存", "success") } }

  if (minimized) {
    return (
      <div className="fixed z-50 bottom-4 right-4">
        <button onClick={() => setMinimized(false)} className="px-4 py-2 bg-[var(--color-bg-secondary)] border border-[var(--color-border)] rounded shadow-lg text-sm text-[var(--color-text-primary)] hover:border-[var(--color-accent)]">⚙ 设置</button>
      </div>
    )
  }

  return (
    <div className="fixed inset-0 z-50 pointer-events-none">
      <div className="absolute bg-[var(--color-bg-secondary)] border border-[var(--color-border)] rounded shadow-2xl flex flex-col overflow-hidden pointer-events-auto"
        style={{ width: winSize.w, maxWidth: "95vw", height: winSize.h, maxHeight: "90vh", left: `calc(50% + ${pos.x}px)`, top: `calc(50% + ${pos.y}px)`, transform: "translate(-50%, -50%)" }}>
        
        {/* Title bar (PS style - drag area) */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-[var(--color-border)] bg-[var(--color-bg-primary)]" onMouseDown={onHeaderMouseDown} style={{ cursor: dragging ? "grabbing" : "grab" }}>
          <span className="font-bold text-base text-[var(--color-text-primary)]">设置</span>
          <div className="flex gap-3">
            <button onClick={() => setMinimized(true)} className="text-xl text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] leading-none px-1">─</button>
            <button onClick={onClose} className="text-xl text-[var(--color-text-secondary)] hover:text-red-400 leading-none px-1">✕</button>
          </div>
        </div>

        {/* Body: left nav + right content */}
        <div className="flex-1 flex overflow-hidden">
          {/* Left nav */}
          <div className="w-40 border-r border-[var(--color-border)] bg-[var(--color-bg-primary)]/60 p-3 flex flex-col">
            <nav className="flex-1 space-y-0.5">
              {sections.map(s => (
                <button key={s.key} onClick={() => setSection(s.key)}
                  className={`w-full text-left px-3 py-2 text-sm rounded transition-colors ${section === s.key ? "bg-[var(--color-accent)]/15 text-[var(--color-accent)] font-medium" : "text-[var(--color-text-secondary)] hover:bg-[var(--color-accent)]/10"}`}>
                  {s.label}
                </button>
              ))}
            </nav>
          </div>

          {/* Right content */}
          <div className="flex-1 overflow-auto p-6">
            {section === "general" && (
              <div className="space-y-5">
                <Field label="语言">
                  <select value={language} onChange={e => setSetting("language", e.target.value)} className="w-full px-3 py-2 bg-[var(--color-bg-primary)] border border-[var(--color-border)] rounded text-sm text-[var(--color-text-primary)]">
                    <option value="zh">中文</option><option value="en">English</option>
                  </select>
                </Field>
                <Field label="随机标签数量" desc="随机选取标签的最小和最大数量">
                  <div className="flex gap-3 items-center">
                    <input type="number" value={random_min} onChange={e => setSetting("random_min", e.target.value)} className="w-24 px-3 py-2 bg-[var(--color-bg-primary)] border border-[var(--color-border)] rounded text-sm" min="1" />
                    <span className="text-xs text-[var(--color-text-secondary)]">至</span>
                    <input type="number" value={random_max} onChange={e => setSetting("random_max", e.target.value)} className="w-24 px-3 py-2 bg-[var(--color-bg-primary)] border border-[var(--color-border)] rounded text-sm" min="1" />
                  </div>
                </Field>
              </div>
            )}

            {section === "appearance" && (
              <div className="space-y-5">
                <Field label="UI 大小">
                  <div className="grid grid-cols-3 gap-2">
                    {UI_SCALES.map(s => (
                      <button key={s.key} onClick={() => setSetting("ui_scale", s.key)} className={`py-2.5 text-sm rounded border transition-all ${ui_scale === s.key ? "border-[var(--color-accent)] bg-[var(--color-accent)]/15 ring-1 ring-[var(--color-accent)]" : "border-[var(--color-border)]"}`}>{s.zh}<span className="opacity-50 ml-1">({s.desc})</span></button>
                    ))}
                  </div>
                </Field>
                <Field label="主题">
                  <div className="grid grid-cols-4 gap-2">
                    {THEMES.map(tm => (
                      <button key={tm.key} onClick={() => setSetting("theme", tm.key)} className={`py-2.5 text-sm rounded border transition-all ${theme === tm.key ? "border-[var(--color-accent)] bg-[var(--color-accent)]/15 ring-1 ring-[var(--color-accent)]" : "border-[var(--color-border)] hover:border-[var(--color-accent)]/50"}`}>
                        <div className="w-3 h-3 rounded-full mx-auto mb-1" style={{ backgroundColor: tm.color }} />{tm.zh}
                      </button>
                    ))}
                  </div>
                </Field>
                <Field label="自定义强调色">
                  <div className="flex gap-2 items-center">
                    <input type="color" value={accentInput} onChange={e => setAccentInput(e.target.value)} className="w-10 h-10 rounded border border-[var(--color-border)] cursor-pointer" />
                    <input value={accentInput} onChange={e => setAccentInput(e.target.value)} className="flex-1 px-3 py-2 bg-[var(--color-bg-primary)] border border-[var(--color-border)] rounded text-sm font-mono" />
                    <button onClick={() => { setSetting("custom_accent", accentInput); document.documentElement.style.setProperty("--color-accent", accentInput); showToast("已保存", "success") }} className="px-4 py-2 text-sm bg-[var(--color-accent)] text-white rounded">保存</button>
                  </div>
                </Field>
              </div>
            )}

            {section === "api" && (
              <div className="space-y-4">
                <Field label="API Key">
                  <div className="flex gap-2">
                    <input type={keyVisible ? "text" : "password"} value={keyInput || (api_key ? "••••••••" : "")} onChange={e => setKeyInput(e.target.value)} placeholder="sk-..." className="flex-1 px-3 py-2 bg-[var(--color-bg-primary)] border border-[var(--color-border)] rounded text-sm" />
                    <button onClick={() => setKeyVisible(!keyVisible)} className="px-3 py-2 text-sm border border-[var(--color-border)] rounded">👁</button>
                    <button onClick={handleSaveKey} className="px-4 py-2 text-sm bg-[var(--color-accent)] text-white rounded">保存</button>
                  </div>
                </Field>
                <Field label="API 地址">
                  <div className="flex gap-2">
                    <input value={endpointInput} onChange={e => { setEndpointInput(e.target.value); setSetting("api_endpoint", e.target.value) }} className="flex-1 px-3 py-2 bg-[var(--color-bg-primary)] border border-[var(--color-border)] rounded text-sm" />
                  </div>
                </Field>
                <Field label="模型">
                  <select value={modelInput} onChange={e => { setModelInput(e.target.value); setSetting("api_model", e.target.value) }} className="w-full px-3 py-2 bg-[var(--color-bg-primary)] border border-[var(--color-border)] rounded text-sm">
                    {["gpt-4o","gpt-4o-mini","gpt-4-turbo","gpt-3.5-turbo","claude-3-5-sonnet-20241022"].map(m => <option key={m} value={m}>{m}</option>)}
                  </select>
                </Field>
                <div className="pt-2 border-t border-[var(--color-border)]">
                  <button onClick={handleTestConnection} disabled={testing} className="px-4 py-2 text-sm bg-[var(--color-accent)]/15 text-[var(--color-accent)] rounded border border-[var(--color-accent)]/30 hover:bg-[var(--color-accent)]/25 disabled:opacity-50">{testing ? "测试中..." : "测试连接"}</button>
                  {testResult && <div className={`mt-2 p-3 rounded text-sm ${testResult.startsWith("连接成功") ? "bg-green-500/10 text-green-400" : "bg-red-500/10 text-red-400"}`}>{testResult}</div>}
                </div>
              </div>
            )}

            {section === "data" && (
              <div className="space-y-4">
                <Field label="数据库" desc="备份和恢复全部数据（含标签、预设、历史、设置）">
                  <div className="flex gap-3">
                    <button onClick={() => window.api.db.export()} className="flex-1 py-3 text-sm border border-[var(--color-border)] rounded hover:bg-[var(--color-accent)]/10">导出数据库</button>
                    <button onClick={() => window.api.db.import()} className="flex-1 py-3 text-sm border border-[var(--color-border)] rounded hover:bg-[var(--color-accent)]/10">导入数据库</button>
                  </div>
                </Field>
              </div>
            )}

            {section === "about" && (
              <div className="space-y-3 text-sm text-[var(--color-text-secondary)]">
                <div className="text-lg font-bold text-[var(--color-text-primary)]">魔导书 Grimoire</div>
                <div>版本 v7.0.0</div><div>协议 GPL-3.0</div>
                <div>技术栈 Electron + React + TypeScript + Tailwind CSS</div>
                <a href="https://github.com/hanqingyan3293/Grimoire-Prompt-Combiner" className="text-[var(--color-accent)] hover:underline mt-2 inline-block">GitHub</a>
              </div>
            )}
          </div>
        </div>

        {/* Resize handle */}
        <div onMouseDown={onResizeMouseDown} className="absolute bottom-0 right-0 w-4 h-4 cursor-se-resize z-10" style={{ background: "linear-gradient(135deg, transparent 60%, var(--color-border) 60%)" }} />
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
