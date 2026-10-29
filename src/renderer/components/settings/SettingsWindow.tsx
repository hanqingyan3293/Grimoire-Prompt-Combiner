// 魔导书 Grimoire v7 — 设置窗口（独立窗口版）
import React, { useState, useEffect, useRef } from "react"
import { AlertTriangle, Bot, CheckCircle2, Database, Download, Info, Keyboard, LoaderCircle, Palette, PanelsTopLeft, Pencil, Plug, Plus, RefreshCw, Save, Settings, ShieldCheck, Trash2, Upload, X } from "lucide-react"
import { App as AntApp } from "antd"
import type { LucideIcon } from "lucide-react"
import { useSettingsStore } from "../../stores/settings.store"
import { useProviderStore } from "../../stores/providers.store"
import { ProviderEditor } from "./ProviderEditor"
import { Badge } from "../ui/Badge"
import { Button, IconButton } from "../ui/Button"
import { EmptyState, PanelHeader, StatusBadge } from "../ui/Feedback"
import { Modal } from "../ui/Modal"
import type { Provider } from "@shared/types"
import { AppConfigPanel } from "@canvas/components/layout/app-config-modal"
import { useAgentStore } from "@canvas/stores/use-agent-store"

const THEMES = [
  { key: "neon", zh: "霓虹", color: "#a855f7" },
  { key: "clean", zh: "澄蓝", color: "#3b82f6" },
  { key: "gold", zh: "金色", color: "#f59e0b" },
  { key: "midnight", zh: "靛蓝", color: "#6366f1" },
  { key: "sakura", zh: "樱花", color: "#ec4899" },
  { key: "forest", zh: "森林", color: "#22c55e" },
  { key: "sunset", zh: "日落", color: "#f97316" },
]

type Section = "general" | "appearance" | "api" | "ai" | "canvas" | "shortcuts" | "data" | "about"

const DEFAULT_SHORTCUTS: Record<string, string> = {
  "chat.send": "Enter",
  "chat.newline": "Shift+Enter",
  "global.search": "Ctrl+F",
  "global.undo": "Ctrl+Z",
  "global.redo": "Ctrl+Shift+Z",
  "global.copy": "Ctrl+C",
  "global.close": "Escape",
}

const SECTIONS: { key: Section; label: string; description: string; icon: LucideIcon; keywords: string }[] = [
  { key: "general", label: "通用", description: "语言、字号和界面密度", icon: Settings, keywords: "语言 language 字号 字体大小 密度 紧凑 舒适 随机标签" },
  { key: "appearance", label: "外观", description: "深浅模式与主题色", icon: Palette, keywords: "主题 颜色 色轮 深色 浅色 跟随系统 强调色 accent 背景 边框" },
  { key: "api", label: "API 配置", description: "模型供应商与认证", icon: Plug, keywords: "供应商 provider 模型 密钥 key 接口 base url 连接测试" },
  { key: "ai", label: "AI 工作台", description: "Runtime、权限、MCP 和会话", icon: Bot, keywords: "智能体 agent 运行时 runtime 权限 mcp 会话 session 工具" },
  { key: "canvas", label: "无限画布", description: "原版画布、Agent 和同步配置", icon: PanelsTopLeft, keywords: "画布 canvas 节点 同步 代理" },
  { key: "shortcuts", label: "快捷键", description: "键盘操作映射", icon: Keyboard, keywords: "快捷键 键盘 组合键 冲突" },
  { key: "data", label: "数据", description: "备份、迁移与诊断", icon: Database, keywords: "数据 备份 导入 导出 迁移 诊断 日志 缓存" },
  { key: "about", label: "关于", description: "版本与技术信息", icon: Info, keywords: "关于 版本 许可证 更新" },
]

export function SettingsWindow({ onClose, embedded = false }: { onClose?: () => void; embedded?: boolean }) {
  const {
    theme,
    appearance_mode,
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
    setThemePreference,
  } = useSettingsStore()
  const { providers, activeProvider, loading: providersLoading, loadProviders, saveProvider, deleteProvider, setActive } = useProviderStore()
  const [section, setSection] = useState<Section>("general")
  // The settings panel is a full page now, so a way to find a setting by name matters more
  // than it did in a 900×680 window. Matches the section label, its description and its
  // keywords — enough for the vocabulary people actually type (主题/颜色/密钥/快捷键).
  const [settingsQuery, setSettingsQuery] = useState("")
  // In the settings PANEL every category is stacked on one page (the Cherry-style layout);
  // in the separate window the rail still switches between them. Collapse state is per
  // category and local — it is a view preference, not a persisted setting.
  const [collapsedSections, setCollapsedSections] = useState<Record<string, boolean>>({})
  const [accentInput, setAccentInput] = useState(custom_accent)
  const [shortcuts, setShortcuts] = useState<Record<string, string>>({})
  const [editingShortcut, setEditingShortcut] = useState<string | null>(null)
  const initialized = useRef(false)

  const [editingProvider, setEditingProvider] = useState<Provider | null>(null)
  const [showProviderEditor, setShowProviderEditor] = useState(false)
  const [migrationPreview, setMigrationPreview] = useState<Awaited<ReturnType<typeof window.api.migration.selectFriendPrompts>>>(null)
  const [migrationBusy, setMigrationBusy] = useState(false)
  const [migrationMessage, setMigrationMessage] = useState('')
  const [dataBusy, setDataBusy] = useState<'export' | 'import' | 'logs' | null>(null)
  const [dataMessage, setDataMessage] = useState<{ tone: 'success' | 'danger' | 'info'; text: string } | null>(null)
  const [errorLogs, setErrorLogs] = useState<Awaited<ReturnType<typeof window.api.error.getAll>>>([])
  const [providerToDelete, setProviderToDelete] = useState<Provider | null>(null)
  const [providerDeleteBusy, setProviderDeleteBusy] = useState(false)

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
      const raw = await window.api.settings.getAll()
      const saved: Record<string, string> = {}
      for (const [k, v] of Object.entries(DEFAULT_SHORTCUTS)) {
        const savedValue = raw["shortcut_" + k]
        saved[k] = typeof savedValue === "string" ? savedValue : v
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

  const shortcutLabels: Record<string, string> = {
    "chat.send": "发送消息", "chat.newline": "换行",
    "global.search": "搜索", "global.undo": "撤销",
    "global.redo": "重做", "global.copy": "复制", "global.close": "关闭窗口",
  }

  const selectFriendPromptIndex = async () => {
    setMigrationMessage('')
    try {
      setMigrationPreview(await window.api.migration.selectFriendPrompts())
    } catch (error) {
      setMigrationMessage(error instanceof Error ? error.message : '扫描失败')
    }
  }

  const importFriendPromptIndex = async () => {
    if (!migrationPreview) return
    setMigrationBusy(true)
    setMigrationMessage('')
    try {
      const result = await window.api.migration.importFriendPrompts(migrationPreview.token, migrationPreview.fingerprint)
      setMigrationMessage(`导入完成：新增 ${result.addedCount} 条，重复 ${result.duplicates.length} 条，跳过 ${result.skipped} 条`)
      setMigrationPreview(null)
    } catch (error) {
      setMigrationMessage(error instanceof Error ? error.message : '导入失败')
    } finally {
      setMigrationBusy(false)
    }
  }

  const runDatabaseAction = async (action: 'export' | 'import') => {
    setDataBusy(action)
    setDataMessage(null)
    try {
      const completed = action === 'export' ? await window.api.db.export() : await window.api.db.import()
      if (completed) setDataMessage({ tone: 'success', text: action === 'export' ? '数据库备份已导出' : '数据库已导入并刷新' })
    } catch (error) {
      setDataMessage({ tone: 'danger', text: error instanceof Error ? error.message : action === 'export' ? '数据库导出失败' : '数据库导入失败' })
    } finally {
      setDataBusy(null)
    }
  }

  const loadErrorLogs = async () => {
    setDataBusy('logs')
    setDataMessage(null)
    try {
      const logs = await window.api.error.getAll()
      setErrorLogs(logs)
      setDataMessage({ tone: 'info', text: logs.length ? `已读取 ${logs.length} 条诊断记录` : '当前没有诊断错误记录' })
    } catch (error) {
      setDataMessage({ tone: 'danger', text: error instanceof Error ? error.message : '诊断日志读取失败' })
    } finally {
      setDataBusy(null)
    }
  }

  const confirmDeleteProvider = async () => {
    if (!providerToDelete) return
    setProviderDeleteBusy(true)
    try {
      await deleteProvider(providerToDelete.id)
      showToast('供应商已删除', 'success')
      setProviderToDelete(null)
    } catch (error) {
      showToast('删除失败: ' + (error instanceof Error ? error.message : '未知错误'), 'error')
    } finally {
      setProviderDeleteBusy(false)
    }
  }

  const activateProvider = async (provider: Provider) => {
    try {
      await setActive(provider.id)
      showToast(`已切换到 ${provider.name}`, 'success')
    } catch (error) {
      showToast('切换失败: ' + (error instanceof Error ? error.message : '未知错误'), 'error')
    }
  }

  const effectiveAppearance = appearance_mode === 'system'
    ? (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
    : appearance_mode
  const appearanceDefaults = effectiveAppearance === 'dark'
    ? { primary: '#0f1115', secondary: '#181b21', tertiary: '#20242c', border: '#353b46' }
    : { primary: '#f8fafc', secondary: '#ffffff', tertiary: '#f1f5f9', border: '#cbd5e1' }
  const colorControls = [
    { key: "custom_bg_primary", label: "页面背景", value: custom_bg_primary, fallback: appearanceDefaults.primary },
    { key: "custom_bg_secondary", label: "面板背景", value: custom_bg_secondary, fallback: appearanceDefaults.secondary },
    { key: "custom_bg_tertiary", label: "工具栏背景", value: custom_bg_tertiary, fallback: appearanceDefaults.tertiary },
    { key: "custom_border", label: "边框颜色", value: custom_border, fallback: appearanceDefaults.border },
  ]

  const showSection = (key: Section) => (embedded ? true : section === key)
  const toggleSection = (key: string) => setCollapsedSections(previous => ({ ...previous, [key]: !previous[key] }))
  const normalizedQuery = settingsQuery.trim().toLowerCase()
  const filteredSections = normalizedQuery
    ? SECTIONS.filter(entry => (entry.label + entry.description + entry.keywords).toLowerCase().includes(normalizedQuery))
    : SECTIONS

  return (
    // Embedded in a panel the shell stacks: a 220px fixed sidebar cannot share a 210px panel with content
    // (the measurement showed inputs collapsed to 7-18px). Sections become a wrapping strip on top instead.
    <div className={embedded ? "flex h-full min-h-0 flex-col overflow-hidden bg-[var(--color-bg-primary)]" : "flex h-screen overflow-hidden bg-[var(--color-bg-primary)]"}>
      {/* Left nav */}
      <aside className={"ui-app-chrome flex flex-col " + (embedded ? "w-full min-w-0 shrink-0 border-b border-[var(--color-border)]" : "w-[220px] min-w-[220px] border-r border-[var(--color-border)]")}>
        <div className="flex items-center justify-between border-b border-[var(--color-border)] px-5 py-4">
          <span className="flex items-center gap-2 text-base font-semibold text-[var(--color-text-primary)]"><Settings size={18} className='text-[var(--color-accent-text)]' aria-hidden='true' />设置</span>
          {onClose ? <IconButton icon={X} label='关闭设置' onClick={onClose} /> : null}
        </div>
        <div className="px-3 pt-3">
          <input
            value={settingsQuery}
            onChange={e => setSettingsQuery(e.target.value)}
            placeholder="搜索设置…"
            aria-label="搜索设置"
            className="ui-field w-full"
          />
        </div>
        <nav className={embedded ? "flex flex-wrap gap-1 p-2" : "flex-1 space-y-1 overflow-y-auto p-2"} aria-label='设置分区'>
          {filteredSections.length === 0 ? <p className="px-3 py-2 text-xs text-[var(--color-text-secondary)]">没有匹配的设置</p> : null}
          {filteredSections.map(s => (
            <button key={s.key} onClick={() => {
              if (!embedded) { setSection(s.key); return }
              document.getElementById('settings-section-' + s.key)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
            }}
              aria-current={section === s.key ? 'page' : undefined}
              className={`ui-settings-nav-item px-3 py-2 text-left text-sm ${embedded ? 'w-auto' : 'w-full py-2.5'} ${
                section === s.key
                  ? "ui-settings-nav-item-active"
                  : "text-[var(--color-text-secondary)]"
              }`}>
              <s.icon size={16} aria-hidden='true' /><span><span className='block font-medium'>{s.label}</span>{embedded ? null : <span className='mt-0.5 block text-[10px] opacity-70'>{s.description}</span>}</span>
            </button>
          ))}
        </nav>
      </aside>

      {/* Right content */}
      <div className="ui-settings-scroll min-h-0 flex-1 overflow-y-auto p-4 sm:p-7">
        <div className="ui-settings-content mx-auto w-full max-w-5xl pb-5">
        {showSection("general") && (
          <SettingsSectionCard id="general" title="通用设置" collapsed={collapsedSections["general"] === true} onToggle={() => toggleSection("general")}>
          <div className="space-y-5">
            <PanelHeader icon={Settings} title='通用设置' description='调整语言、字号、界面密度和随机标签范围' />
            <Field label="语言">
              <select value={language} onChange={async e => { await setSetting("language", e.target.value) }}
                className="ui-field w-52">
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
                  className="ui-field w-20"
	                />
	                <span className="w-8 text-sm text-[var(--color-text-secondary)]">px</span>
	              </div>
	            </Field>
	            <Field label="界面密度" desc="调整面板标题栏、分割线和控件尺寸">
              <div className="ui-segmented grid grid-cols-3" role='group' aria-label='界面密度'>
                {["compact","normal","comfortable"].map(d => (
                  <button key={d} onClick={() => setSetting("ui_density", d)}
                    aria-pressed={ui_density === d}
                    className={"ui-segmented-item text-sm " + (ui_density === d ? "ui-segmented-item-active" : "")}>
	                    {d === "compact" ? "紧凑" : d === "normal" ? "标准" : "舒适"}
	                  </button>
	                ))}
	              </div>
	            </Field>
            <Field label="随机标签数范围">
              <div className="flex items-center gap-3">
                <input type="number" value={random_min} onChange={e => setSetting("random_min", e.target.value)}
                  aria-label='随机标签最小数量' className="ui-field w-24" />
                <span className="text-[var(--color-text-secondary)] text-sm">至</span>
                <input type="number" value={random_max} onChange={e => setSetting("random_max", e.target.value)}
                  aria-label='随机标签最大数量' className="ui-field w-24" />
              </div>
            </Field>
            <div className="ui-inline-note ui-inline-note-info text-sm" role='note'><Info size={16} className='shrink-0' aria-hidden='true' /><span>
              提示：由于多窗口限制，若设置或历史记录未同步，请手动按 Ctrl+R 刷新页面。
            </span></div>
          </div>
          </SettingsSectionCard>
        )}

        {showSection("appearance") && (
          <SettingsSectionCard id="appearance" title="外观" collapsed={collapsedSections["appearance"] === true} onToggle={() => toggleSection("appearance")}>
          <div className="space-y-5">
            <PanelHeader icon={Palette} title='外观' description='深浅外观与 7 种色轮强调色相互独立组合' />
            <Field label="外观模式" desc="背景与文字使用浅色、深色或跟随 Windows；主题色独立选择">
              <div className="ui-segmented grid grid-cols-3" role='group' aria-label='外观模式'>
                {[["system", "跟随系统"], ["light", "浅色"], ["dark", "深色"]].map(([value, label]) => (
                  <button key={value} onClick={() => setSetting("appearance_mode", value)} aria-pressed={appearance_mode === value} className={"ui-segmented-item text-sm " + (appearance_mode === value ? "ui-segmented-item-active" : "")}>
                    {label}
                  </button>
                ))}
              </div>
            </Field>
            <Field label="主题色" desc="七种内置色来自同一色轮体系，可与浅色、深色或跟随系统任意组合">
              <div className="grid grid-cols-4 gap-3">
                {THEMES.map(tm => (
                  <button
                    key={tm.key}
                    onClick={async () => {
                      setAccentInput(tm.color)
                      await setThemePreference(tm.key, tm.color)
                      await setSetting("custom_bg_primary", "")
                      await setSetting("custom_bg_secondary", "")
                      await setSetting("custom_bg_tertiary", "")
                      await setSetting("custom_border", "")
                    }}
                    aria-pressed={theme === tm.key}
                    className={`ui-theme-swatch overflow-hidden text-left text-sm ${
                      theme === tm.key ? "ui-theme-swatch-active text-[var(--color-accent-text)]" : "text-[var(--color-text-secondary)]"
                    }`}
                  >
                    <div className="ui-theme-accent-preview" style={{ backgroundColor: tm.color }}><span /><span /><span /></div>
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
                  aria-label='强调色十六进制值' className="ui-field flex-1" />
                <Button variant='primary' icon={Save} onClick={() => { setSetting("custom_accent", accentInput); showToast("已保存", "success") }}>保存</Button>
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
                    <Button size='sm' variant='ghost' onClick={() => setSetting(item.key, "")}>默认</Button>
                  </div>
                ))}
              </div>
            </Field>
          </div>
          </SettingsSectionCard>
        )}

        {showSection("api") && (
          <SettingsSectionCard id="api" title="API 配置" collapsed={collapsedSections["api"] === true} onToggle={() => toggleSection("api")}>
          <div className="space-y-4">
            <PanelHeader icon={Plug} title='API 供应商' description='管理模型接口、协议和本地保存的认证信息' actions={!showProviderEditor && <Button variant='primary' icon={Plus} onClick={() => { setEditingProvider(null); setShowProviderEditor(true) }}>新增供应商</Button>} />

            {showProviderEditor ? (
              <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/35 p-4 backdrop-blur-[2px]" role="dialog" aria-modal="true" aria-label={editingProvider ? '编辑供应商' : '新增供应商'}>
                <div className="flex h-[min(760px,calc(100vh-32px))] w-[min(920px,calc(100vw-32px))] min-w-0 flex-col overflow-hidden rounded-xl border border-[var(--color-border-strong)] bg-[var(--color-bg-primary)] shadow-[0_24px_80px_rgba(0,0,0,.42)]">
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
              </div>
            ) : (
              <>
                {providersLoading ? (
                  <div className='ui-empty-state flex-col gap-2 text-sm' role='status'><LoaderCircle size={20} className='ui-spin text-[var(--color-accent)]' aria-hidden='true' />正在加载供应商</div>
                ) : providers.length === 0 ? (
                  <EmptyState icon={Plug} title='尚未配置 API 供应商' description='添加一个兼容 Chat Completions 或 Responses API 的供应商' action={<Button size='sm' variant='primary' icon={Plus} onClick={() => { setEditingProvider(null); setShowProviderEditor(true) }}>新增供应商</Button>} />
                ) : (
                  <div className="grid gap-3 md:grid-cols-2">
                    {providers.filter(Boolean).map(p => {
                      const providerModels = Array.isArray(p.models) ? p.models : []
                      return (
                      <article key={p.id}
                        className={`ui-list-card flex min-h-52 flex-col justify-between gap-4 p-4 ${
                          p.is_active
                            ? "border-[var(--color-accent)] bg-[var(--color-accent)]/10"
                            : ""
                        }`}>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-start justify-between gap-3">
                            <span className="text-base font-semibold text-[var(--color-text-primary)] truncate">{p.name}</span>
                            {p.is_active && (
                              <StatusBadge tone='success'>当前</StatusBadge>
                            )}
                          </div>
                          <div className="mt-2 truncate text-xs text-[var(--color-text-secondary)]" title={p.base_url}>{p.base_url}</div>
                          <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
                            <div className="rounded-lg bg-[var(--color-bg-secondary)] p-2"><div className="text-[var(--color-text-secondary)]">协议</div><div className="mt-1 font-medium text-[var(--color-text-primary)]">{p.protocol === "chat_completions" ? "Chat Completions" : "Responses API"}</div></div>
                            <div className="rounded-lg bg-[var(--color-bg-secondary)] p-2"><div className="text-[var(--color-text-secondary)]">模型</div><div className="mt-1 font-medium text-[var(--color-text-primary)]">{providerModels.length} 个</div></div>
                            <div className="rounded-lg bg-[var(--color-bg-secondary)] p-2"><div className="text-[var(--color-text-secondary)]">默认模型</div><div className="mt-1 truncate font-medium text-[var(--color-text-primary)]">{p.default_model || "未设置"}</div></div>
                            <div className="rounded-lg bg-[var(--color-bg-secondary)] p-2"><div className="text-[var(--color-text-secondary)]">认证</div><div className="mt-1 font-medium text-[var(--color-text-primary)]">{p.has_api_key ? "已配置" : "未配置"}</div></div>
                          </div>
                          {providerModels.length > 0 && (
                            <div className="flex gap-1.5 mt-2 flex-wrap">
                              {providerModels.slice(0, 5).map(m => (
                                <Badge key={m}>{m}</Badge>
                              ))}
                              {providerModels.length > 5 && <span className="text-xs text-[var(--color-text-secondary)] self-center">+{providerModels.length - 5}</span>}
                            </div>
                          )}
                        </div>
                        <div className="flex flex-wrap justify-end gap-1.5 border-t border-[var(--color-border)] pt-3">
                          {!p.is_active && <Button size='sm' variant='ghost' onClick={() => void activateProvider(p)}>设为当前</Button>}
                          <IconButton icon={Pencil} label={`编辑供应商 ${p.name}`} onClick={() => { setEditingProvider(p); setShowProviderEditor(true) }} />
                          <IconButton icon={Trash2} label={`删除供应商 ${p.name}`} onClick={() => setProviderToDelete(p)} className='ui-icon-button-danger' />
                        </div>
                      </article>
                      )
                    })}
                  </div>
                )}
                {activeProvider && !showProviderEditor && (
                  <div className="ui-list-card ui-list-card-no-hover mt-4 p-4">
                    <div className="grid grid-cols-2 gap-2 text-sm">
                      <div className="text-[var(--color-text-secondary)]">当前供应商</div><div className="text-[var(--color-accent-text)] font-medium text-right">{activeProvider.name}</div>
                      <div className="text-[var(--color-text-secondary)]">默认模型</div><div className="text-[var(--color-text-primary)] text-right">{activeProvider.default_model}</div>
                      <div className="text-[var(--color-text-secondary)]">协议</div><div className="text-[var(--color-text-primary)] text-right">{activeProvider.protocol === "chat_completions" ? "Chat Completions" : "Responses API"}</div>
                      <div className="text-[var(--color-text-secondary)]">可用模型</div><div className="text-[var(--color-text-primary)] text-right">{Array.isArray(activeProvider.models) ? activeProvider.models.length : 0} 个</div>
                    </div>
                  </div>
                )}
                <AiCatalogPanel />
              </>
            )}
          </div>
          </SettingsSectionCard>
        )}

        {showSection("ai") && (
          <SettingsSectionCard id="ai" title="AI 工作台" collapsed={collapsedSections["ai"] === true} onToggle={() => toggleSection("ai")}>
            <AiSettingsPanel />
          </SettingsSectionCard>
        )}

        {showSection("canvas") && (
          <SettingsSectionCard id="canvas" title="无限画布" collapsed={collapsedSections["canvas"] === true} onToggle={() => toggleSection("canvas")}>
            <CanvasSettingsSection />
          </SettingsSectionCard>
        )}

        {showSection("shortcuts") && (
          <SettingsSectionCard id="shortcuts" title="快捷键" collapsed={collapsedSections["shortcuts"] === true} onToggle={() => toggleSection("shortcuts")}>
          <div className="space-y-4">
            <PanelHeader icon={Keyboard} title='快捷键管理' description='选择快捷键后按下新组合键，设置会自动保存' />
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
                        aria-label={`设置${label}快捷键`} className="ui-field w-48 border-[var(--color-accent)]"
                        placeholder="按下新快捷键..."
                        onBlur={() => setEditingShortcut(null)}
                      />
                    ) : (
                      <button onClick={() => setEditingShortcut(key)}
                        aria-label={`修改${label}快捷键`} className="ui-button ui-button-secondary ui-button-sm min-w-[80px] font-mono text-[var(--color-accent-text)]">
                        {shortcuts[key] || "（未设置）"}
                      </button>
                    )}
                    <Button size='sm' variant='ghost' icon={Trash2} onClick={() => saveShortcut(key, "")}>清除</Button>
                  </div>
                </div>
              ))}
            </div>
          </div>
          </SettingsSectionCard>
        )}

        {showSection("data") && (
          <SettingsSectionCard id="data" title="数据" collapsed={collapsedSections["data"] === true} onToggle={() => toggleSection("data")}>
          <div className="space-y-5">
            <PanelHeader icon={Database} title='数据管理' description='备份和恢复数据库，迁移朋友项目提示词并查看诊断记录' />
            <Field label="数据库" desc="备份和恢复全部数据">
              <div className="flex gap-3">
                <Button icon={Download} onClick={() => void runDatabaseAction('export')} disabled={dataBusy !== null} className='flex-1'>导出数据库</Button>
                <Button icon={Upload} onClick={() => void runDatabaseAction('import')} disabled={dataBusy !== null} className='flex-1'>导入数据库</Button>
              </div>
            </Field>
            <Field label="朋友项目迁移" desc="先扫描提示词索引，再确认导入；不会导入 API Key">
              <Button icon={RefreshCw} onClick={() => void selectFriendPromptIndex()} disabled={migrationBusy} className='w-full'>扫描朋友项目提示词索引</Button>
              {migrationPreview && (
                <div className="ui-list-card ui-list-card-no-hover mt-3 space-y-3 p-3 text-sm">
                  <div className="grid grid-cols-3 gap-2 text-center">
                    <Metric label='可导入' value={migrationPreview.additions} tone='accent' />
                    <Metric label='重复' value={migrationPreview.duplicates} tone='warning' />
                    <Metric label='跳过' value={migrationPreview.skipped} tone='neutral' />
                  </div>
                  {migrationPreview.warnings.map(warning => <div key={warning} className="ui-inline-note ui-inline-note-warning text-xs"><AlertTriangle size={14} className='shrink-0' aria-hidden='true' /><span>{warning}</span></div>)}
                  <div className="flex gap-2">
                    <Button variant='primary' icon={Upload} onClick={() => void importFriendPromptIndex()} disabled={migrationBusy || migrationPreview.additions === 0} className='flex-1'>确认导入</Button>
                    <Button onClick={() => setMigrationPreview(null)} disabled={migrationBusy} className='flex-1'>取消</Button>
                  </div>
                </div>
              )}
              {migrationMessage && <div className='ui-inline-note ui-inline-note-info mt-3 text-xs' role='status'><Info size={14} aria-hidden='true' /><span>{migrationMessage}</span></div>}
            </Field>
            <Field label='诊断日志' desc='读取应用已脱敏的错误记录，便于开发阶段定位问题'>
              <Button icon={RefreshCw} onClick={() => void loadErrorLogs()} disabled={dataBusy !== null}>{dataBusy === 'logs' ? '读取中' : '刷新诊断日志'}</Button>
              {errorLogs.length > 0 && <div className='mt-3 max-h-64 space-y-2 overflow-auto'>{errorLogs.slice(0, 20).map(log => <article key={log.id} className='ui-list-card ui-list-card-no-hover p-3'><div className='flex items-start justify-between gap-3'><div className='min-w-0 text-xs font-medium text-[var(--color-danger)]'>{log.message}</div><Badge>{log.created_at}</Badge></div>{log.context && <div className='mt-2 text-[11px] text-[var(--color-text-secondary)]'>{log.context}</div>}</article>)}</div>}
            </Field>
            {dataMessage && <div className={`ui-inline-note ui-inline-note-${dataMessage.tone} text-xs`} role={dataMessage.tone === 'danger' ? 'alert' : 'status'}>{dataMessage.tone === 'success' ? <CheckCircle2 size={15} aria-hidden='true' /> : dataMessage.tone === 'danger' ? <AlertTriangle size={15} aria-hidden='true' /> : <Info size={15} aria-hidden='true' />}<span>{dataMessage.text}</span></div>}
          </div>
          </SettingsSectionCard>
        )}

        {showSection("about") && (
          <SettingsSectionCard id="about" title="关于" collapsed={collapsedSections["about"] === true} onToggle={() => toggleSection("about")}>
          <div className="space-y-3">
            <PanelHeader icon={Info} title='关于' description='应用版本、许可证和技术栈' />
            <div className="text-2xl font-bold text-[var(--color-text-primary)]">魔导书 Grimoire</div>
            <div className="text-sm text-[var(--color-text-secondary)]">版本 v7.2.0 · AGPL-3.0-only</div>
            <div className="text-sm text-[var(--color-text-secondary)]">作者：hanqingyan3293 · GitHub：github.com/hanqingyan3293/Grimoire-Prompt-Combiner</div>
            <div className="text-sm text-[var(--color-text-secondary)]">Electron + React + TypeScript + Vite + Tailwind CSS + SQLite</div>
            <div className="text-sm leading-6 text-[var(--color-text-secondary)]">本项目是开源软件，允许使用、研究、修改和再分发。分发修改后的版本或通过网络提供服务时，请按照 AGPL-3.0 的要求提供对应源代码和许可证文本。</div>
          </div>
          </SettingsSectionCard>
        )}
        </div>
      </div>
      <Modal title='删除供应商' open={providerToDelete !== null} onClose={() => setProviderToDelete(null)}>
        <p className='text-sm text-[var(--color-text-primary)]'>确认删除供应商“{providerToDelete?.name}”？保存的配置与认证信息将一并移除。</p>
        <div className='mt-4 flex gap-2'><Button onClick={() => setProviderToDelete(null)} className='flex-1' disabled={providerDeleteBusy}>取消</Button><Button variant='danger' icon={Trash2} onClick={() => void confirmDeleteProvider()} className='flex-1' disabled={providerDeleteBusy}>{providerDeleteBusy ? '删除中' : '删除'}</Button></div>
      </Modal>
    </div>
  )
}

function CanvasSettingsSection() {
  const url = useAgentStore(state => state.url)
  const token = useAgentStore(state => state.token)
  const permissionMode = useAgentStore(state => state.permissionMode)
  const connected = useAgentStore(state => state.connected)
  const activity = useAgentStore(state => state.activity)
  const setAgentState = useAgentStore(state => state.setAgentState)
  const connectAgent = useAgentStore(state => state.connectAgent)
  const disconnectAgent = useAgentStore(state => state.disconnectAgent)
  const [urlDraft, setUrlDraft] = useState(url)
  const [tokenDraft, setTokenDraft] = useState(token)

  useEffect(() => {
    setUrlDraft(url)
    setTokenDraft(token)
  }, [token, url])

  const saveAgentConfig = (connect: boolean) => {
    const endpoint = urlDraft.trim().replace(/\/$/, "")
    const nextToken = tokenDraft.trim()
    setAgentState({ url: endpoint, token: nextToken, permissionMode })
    localStorage.setItem("canvas-agent-url", endpoint)
    localStorage.setItem("canvas-agent-token", nextToken)
    if (connect) connectAgent()
  }

  return (
    <div className="space-y-5">
      <PanelHeader icon={PanelsTopLeft} title="无限画布" description="原版无限画布配置、模型渠道、提示词源、同步和 Agent 连接" />
      <section className="ui-list-card space-y-4 p-4">
        <div className="text-sm font-semibold text-[var(--color-text-primary)]">Codex / Canvas Agent</div>
        <Field label="Agent 地址" desc="默认连接本机 Canvas Agent 服务">
          <input className="ui-field w-full" value={urlDraft} onChange={event => setUrlDraft(event.target.value)} placeholder="http://127.0.0.1:17371" />
        </Field>
        <Field label="Agent Token">
          <input type="password" className="ui-field w-full" value={tokenDraft} onChange={event => setTokenDraft(event.target.value)} placeholder="输入 Agent Token" />
        </Field>
        <Field label="权限模式" desc="控制 Agent 执行画布工具和本地操作时的确认策略">
          <select className="ui-field w-full" value={permissionMode} onChange={event => setAgentState({ permissionMode: event.target.value as typeof permissionMode })}>
            <option value="request">每次请求确认</option>
            <option value="automatic">自动允许低风险操作</option>
            <option value="full">完全自动</option>
          </select>
        </Field>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="primary" onClick={() => saveAgentConfig(true)}>{connected ? "重新连接 Agent" : "保存并连接 Agent"}</Button>
          {connected ? <Button onClick={() => disconnectAgent()}>断开连接</Button> : null}
          <span className="text-xs text-[var(--color-text-secondary)]">{activity || (connected ? "已连接" : "未连接")}</span>
        </div>
      </section>
      <section className="ui-list-card p-4">
        <AntApp>
          <AppConfigPanel showDoneButton={false} initialTab="channels" />
        </AntApp>
      </section>
    </div>
  )
}

function AiCatalogPanel() {
  const [query, setQuery] = useState('')
  const [providers, setProviders] = useState<Array<{ id: string; name?: string; description?: string }>>([])
  const [models, setModels] = useState<Array<{ id: string; name?: string; ownedBy?: string; capabilities?: string[]; contextWindow?: number }>>([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    let disposed = false
    setLoading(true)
    const catalog = window.api?.ai?.sessions?.catalog
    if (!catalog || typeof catalog.providers !== 'function' || typeof catalog.models !== 'function') {
      setProviders([])
      setModels([])
      setLoading(false)
      return () => { disposed = true }
    }
    Promise.all([catalog.providers({ query }), catalog.models({ query, limit: 80 })]).then(([providerRows, modelRows]) => {
      if (disposed) return
      setProviders(providerRows as typeof providers)
      setModels(modelRows as typeof models)
    }).catch(() => {}).finally(() => { if (!disposed) setLoading(false) })
    return () => { disposed = true }
  }, [query])

  return (
    <section className='ui-list-card ui-list-card-no-hover mt-4 space-y-3 p-4'>
      <div className='flex items-start justify-between gap-3'><div><div className='text-sm font-semibold text-[var(--color-text-primary)]'>Provider Catalog</div><div className='mt-1 text-xs text-[var(--color-text-secondary)]'>Cherry Provider Catalog 元数据，仅用于供应商和模型发现；认证仍使用本地供应商配置。</div></div><span className='text-xs text-[var(--color-text-secondary)]'>{loading ? '加载中' : providers.length + ' 个供应商 · ' + models.length + ' 个模型'}</span></div>
      <input className='ui-field w-full' value={query} onChange={event => setQuery(event.target.value)} placeholder='搜索供应商或模型目录' aria-label='搜索 Provider Catalog' />
      {(providers.length > 0 || models.length > 0) && <div className='grid gap-3 md:grid-cols-2'><div className='min-w-0'><div className='mb-2 text-xs font-medium text-[var(--color-text-secondary)]'>供应商</div><div className='max-h-40 space-y-1 overflow-auto'>{providers.slice(0, 20).map(item => <div key={item.id} className='rounded border border-[var(--color-border)] px-2 py-1.5 text-xs'><div className='font-medium text-[var(--color-text-primary)]'>{item.name || item.id}</div><div className='truncate text-[10px] text-[var(--color-text-secondary)]'>{item.description || item.id}</div></div>)}</div></div><div className='min-w-0'><div className='mb-2 text-xs font-medium text-[var(--color-text-secondary)]'>模型能力</div><div className='max-h-40 space-y-1 overflow-auto'>{models.slice(0, 20).map(item => <div key={item.id} className='rounded border border-[var(--color-border)] px-2 py-1.5 text-xs'><div className='truncate font-medium text-[var(--color-text-primary)]'>{item.name || item.id}</div><div className='mt-1 flex flex-wrap gap-1 text-[10px] text-[var(--color-text-secondary)]'><span>{item.ownedBy || '未知供应商'}</span>{item.contextWindow && <span>上下文 {item.contextWindow}</span>}{(item.capabilities || []).slice(0, 3).map(capability => <span key={capability} className='rounded bg-[var(--color-bg-tertiary)] px-1'>{capability}</span>)}</div></div>)}</div></div></div>}
    </section>
  )
}

function AiSettingsPanel() {
  const [runtimes, setRuntimes] = useState<Array<{ kind: string; available: boolean; version: string | null; message: string }>>([])
  const [mcpServers, setMcpServers] = useState<Array<{ id: string; name: string; status: string; tools: Array<{ name: string }> }>>([])
  const [permissionMode, setPermissionMode] = useState('request')
  const [legacyUi, setLegacyUi] = useState(false)
  const [loading, setLoading] = useState(false)
  const [loadError, setLoadError] = useState('')

  const load = async () => {
    setLoading(true)
    setLoadError('')
    try {
      const runtimeApi = window.api?.ai?.sessions?.runtimes
      const mcpApi = window.api?.agent?.mcp
      const [settings, runtimeRows, servers] = await Promise.all([
        window.api.settings.getAll(),
        runtimeApi && typeof runtimeApi.list === 'function' ? runtimeApi.list() : Promise.resolve([]),
        mcpApi && typeof mcpApi.list === 'function' ? mcpApi.list() : Promise.resolve([]),
      ])
      setPermissionMode(typeof settings.ai_permission_mode === 'string' ? settings.ai_permission_mode : 'request')
      const legacyValue = settings['dev.aiLegacyUi'] ?? settings.dev_aiLegacyUi
      setLegacyUi(legacyValue === 'true' || legacyValue === '1')
      setRuntimes(runtimeRows)
      setMcpServers(servers)
      if (!runtimeApi || typeof runtimeApi.list !== 'function' || !mcpApi || typeof mcpApi.list !== 'function') setLoadError('当前窗口的部分 AI 能力未加载，请完全关闭 Grimoire 后使用启动脚本重新启动。')
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : '读取 AI 设置失败')
    } finally { setLoading(false) }
  }

  useEffect(() => { void load() }, [])

  const saveSetting = async (key: string, value: string) => {
    await window.api.settings.set(key, value)
    if (key === 'ai_permission_mode') setPermissionMode(value)
    if (key === 'dev.aiLegacyUi') setLegacyUi(value === 'true')
  }

  return <div className="space-y-4"><PanelHeader icon={Bot} title="AI 工作台" description="统一 Agent、Runtime、Provider、MCP 和权限配置" actions={<Button size="sm" variant="secondary" icon={RefreshCw} onClick={() => void load()} disabled={loading}>刷新状态</Button>} />{loadError && <div className="ui-inline-note ui-inline-note-warning text-xs" role="alert">{loadError}</div>}<section className="ui-list-card space-y-3 p-4"><div className="flex items-start gap-3"><ShieldCheck size={18} className="mt-0.5 text-[var(--color-accent-text)]" /><div><div className="text-sm font-semibold text-[var(--color-text-primary)]">权限模式</div><div className="mt-1 text-xs text-[var(--color-text-secondary)]">控制 Agent、内置工具和 MCP 工具执行危险操作前是否需要确认。</div></div></div><select className="ui-field w-full" value={permissionMode} onChange={event => void saveSetting('ai_permission_mode', event.target.value)} aria-label="AI 权限模式"><option value="request">请求确认：危险操作逐次确认</option><option value="automatic">自动：只自动允许安全读取</option><option value="full">完全允许：跳过工具确认</option></select></section><section className="ui-list-card space-y-3 p-4"><div className="flex items-center justify-between"><div><div className="text-sm font-semibold text-[var(--color-text-primary)]">Agent Runtime</div><div className="mt-1 text-xs text-[var(--color-text-secondary)]">Pi、OpenCode、Codex 和 Provider Runtime 的准备状态。</div></div><button type="button" className="text-xs text-[var(--color-accent-text)]" onClick={() => void load()}>重新检测</button></div><div className="grid gap-2 md:grid-cols-2">{runtimes.map(runtime => <div key={runtime.kind} className="rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-secondary)] p-3"><div className="flex items-center justify-between gap-2"><span className="text-xs font-medium text-[var(--color-text-primary)]">{runtime.kind}</span><span className={runtime.available ? 'text-xs text-emerald-500' : 'text-xs text-amber-500'}>{runtime.available ? '可用' : '不可用'}</span></div><div className="mt-1 text-[10px] text-[var(--color-text-secondary)]">{runtime.version || runtime.message}</div></div>)}</div></section><section className="ui-list-card space-y-3 p-4"><div className="flex items-center justify-between"><div><div className="text-sm font-semibold text-[var(--color-text-primary)]">MCP 服务</div><div className="mt-1 text-xs text-[var(--color-text-secondary)]">默认采用手动启用工具；具体工具选择在 Agent 工作台 MCP 模式中完成。</div></div><span className="text-xs text-[var(--color-text-secondary)]">{mcpServers.length} 个 Server</span></div><div className="space-y-1.5">{mcpServers.length ? mcpServers.map(server => <div key={server.id} className="flex items-center justify-between gap-3 rounded-lg border border-[var(--color-border)] px-3 py-2 text-xs"><span className="min-w-0 truncate text-[var(--color-text-primary)]">{server.name}</span><span className={server.status === 'connected' ? 'text-emerald-500' : 'text-[var(--color-text-secondary)]'}>{server.status} · {server.tools.length} 工具</span></div>) : <div className="text-xs text-[var(--color-text-secondary)]">尚未配置 MCP Server</div>}</div></section><section className="ui-list-card space-y-3 p-4"><div className="text-sm font-semibold text-[var(--color-text-primary)]">兼容与诊断</div><label className="flex items-center justify-between gap-3 rounded-lg border border-[var(--color-border)] px-3 py-2 text-xs"><span><span className="block font-medium text-[var(--color-text-primary)]">隐藏旧 AI UI 回滚开关</span><span className="mt-1 block text-[10px] text-[var(--color-text-secondary)]">默认关闭；仅在新工作台诊断异常时临时启用。</span></span><input type="checkbox" checked={legacyUi} onChange={event => void saveSetting('dev.aiLegacyUi', event.target.checked ? 'true' : 'false')} className="accent-[var(--color-accent)]" /></label><Button size="sm" variant="primary" icon={Bot} onClick={() => void window.api.window.openAI()}>打开统一 Agent 工作台</Button></section></div>
}

function Field({ label, desc, children }: { label: string; desc?: string; children: React.ReactNode }) {
  return (
    <div className="border-b border-[var(--color-border)] py-4 first:pt-0 last:border-b-0">
      <div className="mb-2 text-sm font-semibold text-[var(--color-text-primary)]">{label}</div>
      {desc && <div className="mb-3 text-xs text-[var(--color-text-secondary)]">{desc}</div>}
      {children}
    </div>
  )
}

function Metric({ label, value, tone }: { label: string; value: number; tone: 'neutral' | 'accent' | 'warning' }) {
  return <div className='rounded-md border border-[var(--color-border)] bg-[var(--color-surface-subtle)] p-2'><strong className='block text-base text-[var(--color-text-primary)]'>{value}</strong><Badge tone={tone}>{label}</Badge></div>
}

function showToast(message: string, type: "success" | "error" | "info") {
  window.dispatchEvent(new CustomEvent("grimoire:toast", { detail: { message, type } }))
}

/**
 * One collapsible category card. The header stays visible while collapsed so a reader can
 * still see which category is hidden; expanded, only the chevron shows and the section's own
 * heading carries the title (avoids printing it twice).
 */
function SettingsSectionCard({ id, title, collapsed, onToggle, children }: {
  id: string
  title: string
  collapsed: boolean
  onToggle: () => void
  children: React.ReactNode
}) {
  return (
    <section
      id={'settings-section-' + id}
      data-ui="settings.section"
      data-section={id}
      className="mb-4 rounded-[var(--gr-radius-lg)] border border-[var(--color-border)] bg-[var(--color-bg-secondary)]/50"
    >
      <div className="flex items-center justify-between gap-2 border-b border-transparent px-3 py-1.5">
        <span className="truncate text-xs font-medium text-[var(--color-text-secondary)]">{collapsed ? title : ''}</span>
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={!collapsed}
          aria-label={(collapsed ? '展开' : '折叠') + title}
          className="shrink-0 rounded px-2 py-0.5 text-[11px] text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-tertiary)] hover:text-[var(--color-accent-text)]"
        >
          {collapsed ? '展开 ▾' : '折叠 ▴'}
        </button>
      </div>
      {collapsed ? null : <div className="px-3 pb-3">{children}</div>}
    </section>
  )
}
