// 魔导书 Grimoire v7 — Provider 编辑器
import React, { useState, useEffect } from "react"
import type { Provider } from "@shared/types"

interface Props {
  provider: Provider | null
  onSave: (data: Partial<Provider> & { id?: string }) => Promise<void>
  onCancel: () => void
}

export function ProviderEditor({ provider, onSave, onCancel }: Props) {
  const isNew = !provider
  const [name, setName] = useState(provider?.name || "")
  const [accessMode, setAccessMode] = useState<"login" | "api">(provider?.access_mode || "api")
  const [protocol, setProtocol] = useState<"chat_completions" | "responses">(provider?.protocol || "chat_completions")
  const [defaultModel, setDefaultModel] = useState(provider?.default_model || "gpt-4o")
  const [testModel, setTestModel] = useState(provider?.test_model || "gpt-4o-mini")
  const [contextSize, setContextSize] = useState(provider?.context_size?.toString() || "")
  const [baseUrl, setBaseUrl] = useState(provider?.base_url || "https://api.openai.com/v1")
  const [apiKey, setApiKey] = useState("")
  const [keyVisible, setKeyVisible] = useState(false)
  const [models, setModels] = useState<string[]>(provider?.models || [])
  const [configToml, setConfigToml] = useState(provider?.config_toml || "")
  const [authJson, setAuthJson] = useState(provider?.auth_json || "")

  const [fetchingModels, setFetchingModels] = useState(false)
  const [availableModels, setAvailableModels] = useState<string[]>([])
  const [modelError, setModelError] = useState("")
  const [showModelPicker, setShowModelPicker] = useState(false)
  const [modelSearch, setModelSearch] = useState("")

  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<{ ok: boolean; msg: string } | null>(null)

  useEffect(() => {
    if (isNew && !name && baseUrl) {
      try {
        const host = new URL(baseUrl).hostname
        setName(host.replace("api.", ""))
      } catch {}
    }
  }, [baseUrl])

  const handleFetchModels = async () => {
    if (!baseUrl || !apiKey) {
      setModelError("请先填写 Base URL 和 API Key")
      return
    }
    setFetchingModels(true)
    setModelError("")
    try {
      const result = await window.api.providers.fetchModels(baseUrl, apiKey)
      if (result.success && result.models) {
        setAvailableModels(result.models.sort())
        setShowModelPicker(true)
      } else {
        setModelError(result.error || "获取失败")
      }
    } catch (e: any) {
      setModelError(e.message)
    }
    setFetchingModels(false)
  }

  const toggleModel = (modelId: string) => {
    setModels(prev =>
      prev.includes(modelId) ? prev.filter(m => m !== modelId) : [...prev, modelId]
    )
  }

  const handleTest = async () => {
    if (!baseUrl || !apiKey) {
      setTestResult({ ok: false, msg: "请先填写 Base URL 和 API Key" })
      return
    }
    setTesting(true)
    setTestResult(null)
    try {
      const result = await window.api.providers.test(baseUrl, apiKey, testModel || defaultModel)
      setTestResult({ ok: result.success, msg: result.success ? result.message || "连接成功" : result.error || "失败" })
    } catch (e: any) {
      setTestResult({ ok: false, msg: e.message })
    }
    setTesting(false)
  }

  const handleSave = async () => {
    await onSave({
      id: provider?.id,
      name: name || "未命名",
      access_mode: accessMode,
      protocol,
      base_url: baseUrl,
      api_key: apiKey || provider?.api_key || "",
      default_model: defaultModel,
      test_model: testModel,
      context_size: contextSize ? parseInt(contextSize) : null,
      models,
      config_toml: configToml,
      auth_json: authJson,
    })
  }

  const filteredModels = availableModels.filter(m =>
    m.toLowerCase().includes(modelSearch.toLowerCase())
  )

  return (
    <div className="flex flex-col" style={{ height: "100%" }}>
      <div className="flex items-center justify-between px-5 py-3 border-b border-[var(--color-border)]">
        <span className="font-bold text-sm text-[var(--color-text-primary)]">
          {isNew ? "新增供应商" : "编辑供应商"}
        </span>
        <button onClick={onCancel} className="text-[var(--color-text-secondary)] hover:text-red-400 text-lg">✕</button>
      </div>

      <div className="flex-1 overflow-y-auto p-5 space-y-4" style={{ minHeight: 0 }}>
        <Field label="名称" desc="供应商显示名称，用于快速识别">
          <input value={name} onChange={e => setName(e.target.value)} placeholder="例如：OpenAI、NovelAI"
            className="w-full px-3 py-2 bg-[var(--color-bg-primary)] border border-[var(--color-border)] rounded text-sm text-[var(--color-text-primary)] focus:outline-none focus:border-[var(--color-accent)]" />
        </Field>

        <Field label="接入模式">
          <div className="flex gap-2">
            {(["api", "login"] as const).map(mode => (
              <button key={mode} onClick={() => setAccessMode(mode)}
                className={`flex-1 py-2 text-sm rounded border transition-colors ${
                  accessMode === mode
                    ? "border-[var(--color-accent)] bg-[var(--color-accent)]/15 text-[var(--color-accent)]"
                    : "border-[var(--color-border)] text-[var(--color-text-secondary)] hover:border-[var(--color-accent)]/50"
                }`}>
                {mode === "api" ? "🔑 纯 API" : "🔐 官方登录"}
              </button>
            ))}
          </div>
        </Field>

        <Field label="上游协议">
          <div className="flex gap-2">
            {(["chat_completions", "responses"] as const).map(proto => (
              <button key={proto} onClick={() => setProtocol(proto)}
                className={`flex-1 py-2 text-sm rounded border transition-colors ${
                  protocol === proto
                    ? "border-[var(--color-accent)] bg-[var(--color-accent)]/15 text-[var(--color-accent)]"
                    : "border-[var(--color-border)] text-[var(--color-text-secondary)] hover:border-[var(--color-accent)]/50"
                }`}>
                {proto === "chat_completions" ? "Chat Completions" : "Responses API"}
              </button>
            ))}
          </div>
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Base URL">
            <input value={baseUrl} onChange={e => setBaseUrl(e.target.value)} placeholder="https://api.openai.com/v1"
              className="w-full px-3 py-2 bg-[var(--color-bg-primary)] border border-[var(--color-border)] rounded text-sm text-[var(--color-text-primary)] focus:outline-none focus:border-[var(--color-accent)]" />
          </Field>
          <Field label="API Key">
            <div className="flex gap-1">
              <input type={keyVisible ? "text" : "password"} value={apiKey}
                onChange={e => setApiKey(e.target.value)}
                placeholder={provider?.api_key ? "••••••••（留空不修改）" : "sk-..."}
                className="flex-1 px-3 py-2 bg-[var(--color-bg-primary)] border border-[var(--color-border)] rounded text-sm text-[var(--color-text-primary)] focus:outline-none focus:border-[var(--color-accent)]" />
              <button onClick={() => setKeyVisible(!keyVisible)}
                className="px-2 text-sm border border-[var(--color-border)] rounded text-[var(--color-text-secondary)]">👁</button>
            </div>
          </Field>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Field label="默认配置模型" desc="AI 助手默认使用的模型">
            <input value={defaultModel} onChange={e => setDefaultModel(e.target.value)} placeholder="gpt-4o"
              className="w-full px-3 py-2 bg-[var(--color-bg-primary)] border border-[var(--color-border)] rounded text-sm text-[var(--color-text-primary)] focus:outline-none focus:border-[var(--color-accent)]" />
          </Field>
          <Field label="测试模型" desc="测试连接时使用的模型">
            <input value={testModel} onChange={e => setTestModel(e.target.value)} placeholder="gpt-4o-mini"
              className="w-full px-3 py-2 bg-[var(--color-bg-primary)] border border-[var(--color-border)] rounded text-sm text-[var(--color-text-primary)] focus:outline-none focus:border-[var(--color-accent)]" />
          </Field>
        </div>

        <Field label="上下文大小" desc="留空则使用模型默认值">
          <input type="number" value={contextSize} onChange={e => setContextSize(e.target.value)} placeholder="例如：128000"
            className="w-full px-3 py-2 bg-[var(--color-bg-primary)] border border-[var(--color-border)] rounded text-sm text-[var(--color-text-primary)] focus:outline-none focus:border-[var(--color-accent)]" />
        </Field>

        <div className="flex gap-3">
          <button onClick={handleTest} disabled={testing}
            className="flex-1 py-2 text-sm bg-[var(--color-accent)]/15 text-[var(--color-accent)] rounded border border-[var(--color-accent)]/30 hover:bg-[var(--color-accent)]/25 disabled:opacity-50 transition-colors">
            {testing ? "⏳ 测试中..." : "🔌 测试连接"}
          </button>
          <button onClick={handleFetchModels} disabled={fetchingModels}
            className="flex-1 py-2 text-sm bg-[var(--color-accent)]/15 text-[var(--color-accent)] rounded border border-[var(--color-accent)]/30 hover:bg-[var(--color-accent)]/25 disabled:opacity-50 transition-colors">
            {fetchingModels ? "⏳ 获取中..." : "📋 从上游获取模型列表"}
          </button>
        </div>

        {testResult && (
          <div className={`p-3 rounded text-sm ${testResult.ok ? "bg-green-500/10 text-green-400 border border-green-500/20" : "bg-red-500/10 text-red-400 border border-red-500/20"}`}>
            {testResult.ok ? "✅ " : "❌ "}{testResult.msg}
          </div>
        )}

        {showModelPicker && (
          <div className="border border-[var(--color-border)] rounded p-3 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium text-[var(--color-text-primary)]">可用模型列表</span>
              <button onClick={() => setShowModelPicker(false)} className="text-xs text-[var(--color-text-secondary)] hover:text-[var(--color-accent)]">收起</button>
            </div>
            {modelError && <div className="text-xs text-red-400">{modelError}</div>}
            <input value={modelSearch} onChange={e => setModelSearch(e.target.value)}
              placeholder="搜索模型..."
              className="w-full px-3 py-1.5 bg-[var(--color-bg-primary)] border border-[var(--color-border)] rounded text-xs text-[var(--color-text-primary)] focus:outline-none focus:border-[var(--color-accent)]" />
            <div className="flex gap-2 mb-1">
              <button onClick={() => setModels([...new Set([...models, ...availableModels])])}
                className="text-xs text-[var(--color-accent)] hover:underline">全选</button>
              <button onClick={() => setModels([])}
                className="text-xs text-[var(--color-text-secondary)] hover:underline">取消全选</button>
              <span className="text-xs text-[var(--color-text-secondary)] ml-auto">已选 {models.length}/{availableModels.length}</span>
            </div>
            <div className="max-h-48 overflow-y-auto space-y-1">
              {filteredModels.map(m => {
                const checked = models.includes(m)
                return (
                  <label key={m} className={`flex items-center gap-2 px-2 py-1 rounded text-xs cursor-pointer transition-colors ${checked ? "bg-[var(--color-accent)]/10" : "hover:bg-[var(--color-bg-primary)]"}`}>
                    <input type="checkbox" checked={checked} onChange={() => toggleModel(m)}
                      className="accent-[var(--color-accent)]" />
                    <span className={checked ? "text-[var(--color-accent)]" : "text-[var(--color-text-secondary)]"}>{m}</span>
                  </label>
                )
              })}
            </div>
          </div>
        )}

        {models.length > 0 && (
          <Field label={`已选模型 (${models.length})`}>
            <div className="flex flex-wrap gap-1">
              {models.map(m => (
                <span key={m} className="inline-flex items-center gap-1 px-2 py-0.5 text-xs bg-[var(--color-accent)]/10 text-[var(--color-accent)] rounded border border-[var(--color-accent)]/20">
                  {m}
                  <button onClick={() => toggleModel(m)} className="hover:text-red-400 ml-0.5">×</button>
                </span>
              ))}
            </div>
          </Field>
        )}

        <Field label="config.toml 编辑" desc="通用配置文件">
          <textarea value={configToml} onChange={e => setConfigToml(e.target.value)}
            rows={6}
            placeholder={`# config.toml\n[provider]\nname = "${name || "my-provider"}"\nbase_url = "${baseUrl}"\nmodel = "${defaultModel}"`}
            className="w-full px-3 py-2 bg-[var(--color-bg-tertiary)] border-2 border-[var(--color-border)] rounded text-xs font-mono text-[var(--color-text-primary)] cursor-text focus:outline-none focus:border-[var(--color-accent)] focus:ring-2 focus:ring-[var(--color-accent)]/20 focus:bg-[var(--color-bg-primary)] resize-y transition-colors"
            spellCheck={false} />
        </Field>

        <Field label="auth.json 编辑" desc="认证配置文件">
          <textarea value={authJson} onChange={e => setAuthJson(e.target.value)}
            rows={6}
            placeholder={`{\n  "api_key": "...",\n  "base_url": "${baseUrl}",\n  "model": "${defaultModel}"\n}`}
            className="w-full px-3 py-2 bg-[var(--color-bg-tertiary)] border-2 border-[var(--color-border)] rounded text-xs font-mono text-[var(--color-text-primary)] cursor-text focus:outline-none focus:border-[var(--color-accent)] focus:ring-2 focus:ring-[var(--color-accent)]/20 focus:bg-[var(--color-bg-primary)] resize-y transition-colors"
            spellCheck={false} />
        </Field>
      </div>

      <div className="shrink-0 flex gap-3 px-5 py-3 border-t border-[var(--color-border)]">
        <button onClick={onCancel}
          className="flex-1 py-2 text-sm border border-[var(--color-border)] rounded text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-primary)] transition-colors">
          取消
        </button>
        <button onClick={handleSave}
          disabled={!name.trim()}
          className="flex-1 py-2 text-sm bg-[var(--color-accent)] text-white rounded hover:opacity-90 disabled:opacity-50 transition-colors">
          💾 保存供应商
        </button>
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