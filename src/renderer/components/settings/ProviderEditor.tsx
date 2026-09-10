// 魔导书 Grimoire v7 — Provider 编辑器
import React, { useState, useEffect } from "react"
import { CheckCircle2, Eye, EyeOff, ListFilter, LoaderCircle, PlugZap, Save, X } from "lucide-react"
import { Button, IconButton } from "../ui/Button"
import type { Provider, ProviderSaveInput } from "@shared/types"

interface Props {
  provider: Provider | null
  onSave: (data: ProviderSaveInput) => Promise<void>
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
  const [configToml, setConfigToml] = useState("")
  const [authJson, setAuthJson] = useState("")

  const [fetchingModels, setFetchingModels] = useState(false)
  const [availableModels, setAvailableModels] = useState<string[]>([])
  const [modelError, setModelError] = useState("")
  const [showModelPicker, setShowModelPicker] = useState(false)
  const [modelSearch, setModelSearch] = useState("")

  const [testing, setTesting] = useState(false)
  const [saving, setSaving] = useState(false)
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
    setSaving(true)
    try {
      await onSave({
        id: provider?.id,
        name: name || "未命名",
        access_mode: accessMode,
        protocol,
        base_url: baseUrl,
        api_key: apiKey || undefined,
        default_model: defaultModel,
        test_model: testModel,
        context_size: contextSize ? parseInt(contextSize) : null,
        models,
        config_toml: configToml || undefined,
        auth_json: authJson || undefined,
      })
    } finally {
      setSaving(false)
    }
  }

  const filteredModels = availableModels.filter(m =>
    m.toLowerCase().includes(modelSearch.toLowerCase())
  )

  return (
    <div className="flex flex-col" style={{ height: "100%" }}>
      <div className="flex shrink-0 items-center justify-between px-5 py-3.5 border-b border-[var(--color-border)]">
        <span className="font-semibold text-sm text-[var(--color-text-primary)]">
          {isNew ? "新增供应商" : "编辑供应商"}
        </span>
        <IconButton icon={X} label='关闭供应商编辑器' onClick={onCancel} />
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-5 space-y-5" style={{ minHeight: 0 }}>
        <Field label="名称" desc="供应商显示名称，用于快速识别">
          <input value={name} onChange={e => setName(e.target.value)} placeholder="例如：OpenAI、NovelAI"
            className="ui-field" />
        </Field>

        <Field label="接入模式">
          <div className="ui-segmented grid grid-cols-2" role='group' aria-label='接入模式'>
            {(["api", "login"] as const).map(mode => (
              <button key={mode} onClick={() => setAccessMode(mode)}
                aria-pressed={accessMode === mode} className={`ui-segmented-item text-sm ${
                  accessMode === mode
                    ? "ui-segmented-item-active"
                    : ""
                }`}>
                {mode === "api" ? "纯 API" : "官方登录"}
              </button>
            ))}
          </div>
        </Field>

        <Field label="上游协议">
          <div className="ui-segmented grid grid-cols-2" role='group' aria-label='上游协议'>
            {(["chat_completions", "responses"] as const).map(proto => (
              <button key={proto} onClick={() => setProtocol(proto)}
                aria-pressed={protocol === proto} className={`ui-segmented-item text-sm ${
                  protocol === proto
                    ? "ui-segmented-item-active"
                    : ""
                }`}>
                {proto === "chat_completions" ? "Chat Completions" : "Responses API"}
              </button>
            ))}
          </div>
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Base URL">
            <input value={baseUrl} onChange={e => setBaseUrl(e.target.value)} placeholder="https://api.openai.com/v1"
              className="ui-field" />
          </Field>
          <Field label="API Key">
            <div className="flex gap-1">
              <input type={keyVisible ? "text" : "password"} value={apiKey}
                onChange={e => setApiKey(e.target.value)}
                placeholder={provider?.has_api_key ? "••••••••（留空不修改）" : "sk-..."}
                className="ui-field flex-1" />
              <IconButton icon={keyVisible ? EyeOff : Eye} label={keyVisible ? '隐藏 API Key' : '显示 API Key'} onClick={() => setKeyVisible(!keyVisible)} />
            </div>
          </Field>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Field label="默认配置模型" desc="AI 助手默认使用的模型">
            <input value={defaultModel} onChange={e => setDefaultModel(e.target.value)} placeholder="gpt-4o"
              className="ui-field" />
          </Field>
          <Field label="测试模型" desc="测试连接时使用的模型">
            <input value={testModel} onChange={e => setTestModel(e.target.value)} placeholder="gpt-4o-mini"
              className="ui-field" />
          </Field>
        </div>

        <Field label="上下文大小" desc="留空则使用模型默认值">
          <input type="number" value={contextSize} onChange={e => setContextSize(e.target.value)} placeholder="例如：128000"
            className="ui-field" />
        </Field>

        <div className="flex gap-3">
          <Button icon={testing ? LoaderCircle : PlugZap} onClick={() => void handleTest()} disabled={testing} className={"flex-1 " + (testing ? 'ui-spin-icon' : '')}>{testing ? "测试中..." : "测试连接"}</Button>
          <Button icon={fetchingModels ? LoaderCircle : ListFilter} onClick={() => void handleFetchModels()} disabled={fetchingModels} className={"flex-1 " + (fetchingModels ? 'ui-spin-icon' : '')}>{fetchingModels ? "获取中..." : "获取模型列表"}</Button>
        </div>
        {modelError && !showModelPicker && <div className='ui-inline-note ui-inline-note-danger text-sm' role='alert'>{modelError}</div>}

        {testResult && (
          <div className={`ui-inline-note text-sm ${testResult.ok ? "ui-inline-note-success" : "ui-inline-note-danger"}`} role={testResult.ok ? 'status' : 'alert'}>
            <CheckCircle2 size={15} aria-hidden='true' />{testResult.msg}
          </div>
        )}

        {showModelPicker && (
          <div className="border border-[var(--color-border)] rounded p-3 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium text-[var(--color-text-primary)]">可用模型列表</span>
              <button onClick={() => setShowModelPicker(false)} className="text-xs text-[var(--color-text-secondary)] hover:text-[var(--color-accent-text)]">收起</button>
            </div>
            {modelError && <div className='ui-inline-note ui-inline-note-danger text-xs' role='alert'>{modelError}</div>}
            <input value={modelSearch} onChange={e => setModelSearch(e.target.value)}
              placeholder="搜索模型..."
              aria-label='搜索模型' className="ui-field" />
            <div className="flex gap-2 mb-1">
              <button onClick={() => setModels([...new Set([...models, ...availableModels])])}
                className="text-xs text-[var(--color-accent-text)] hover:underline">全选</button>
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
                    <span className={checked ? "text-[var(--color-accent-text)]" : "text-[var(--color-text-secondary)]"}>{m}</span>
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
                <span key={m} className="ui-prompt-chip ui-prompt-chip-positive inline-flex gap-1 px-2 text-xs text-[var(--color-accent-text)]">
                  <span className='max-w-64 truncate'>{m}</span>
                  <IconButton icon={X} label={`移除模型 ${m}`} onClick={() => toggleModel(m)} className='h-5 w-5 flex-none' />
                </span>
              ))}
            </div>
          </Field>
        )}

        <Field label="config.toml 编辑" desc={provider?.has_auth_config ? "已配置，输入新内容可替换" : "通用配置文件"}>
          <textarea value={configToml} onChange={e => setConfigToml(e.target.value)}
            rows={6}
            placeholder={`# config.toml\n[provider]\nname = "${name || "my-provider"}"\nbase_url = "${baseUrl}"\nmodel = "${defaultModel}"`}
            className="ui-field w-full resize-y font-mono text-xs"
            spellCheck={false} />
        </Field>

        <Field label="auth.json 编辑" desc={provider?.has_auth_config ? "已配置，输入新内容可替换" : "认证配置文件"}>
          <textarea value={authJson} onChange={e => setAuthJson(e.target.value)}
            rows={6}
            placeholder={`{\n  "api_key": "...",\n  "base_url": "${baseUrl}",\n  "model": "${defaultModel}"\n}`}
            className="ui-field w-full resize-y font-mono text-xs"
            spellCheck={false} />
        </Field>
      </div>

      <div className="shrink-0 flex gap-3 px-5 py-3.5 border-t border-[var(--color-border)]">
        <Button onClick={onCancel} className='flex-1' disabled={saving}>取消</Button>
        <Button variant='primary' icon={Save} onClick={() => void handleSave()} disabled={!name.trim() || saving} className='flex-1'>{saving ? '保存中' : '保存供应商'}</Button>
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
