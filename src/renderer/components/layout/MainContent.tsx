// 魔导书 Grimoire v7 — 主内容区
import React, { useState, useCallback, useRef, useEffect as useEff } from "react"
import { useI18n } from "../../i18n/context"
import { usePromptsStore } from "../../stores/prompts.store"
import { useTagsStore } from "../../stores/tags.store"
import { useSettingsStore } from "../../stores/settings.store"
import { TagCards } from "../tags/TagCards"
import type { PanelTag } from "../../../shared/types"

const SCALE_CHIP: Record<string, string> = {
  small: "text-[10px] px-2 py-0.5 gap-1",
  medium: "text-xs px-2.5 py-1 gap-1.5",
  large: "text-sm px-3 py-1.5 gap-2",
}

export function MainContent() {
  const { t } = useI18n()
  const {
    positive, negative, removePositive, removeNegative, updateWeight,
    clearPositive, clearNegative, clearAll,
    undo, redo, canUndo, canRedo,
    deduplicate, randomPick, getFullPrompt,
  } = usePromptsStore()
  const { categories, selectedSubIds, tags: allTags } = useTagsStore()
  const { random_min, random_max, ui_scale } = useSettingsStore()

  const scaleClass = SCALE_CHIP[ui_scale] || SCALE_CHIP.medium
  const [magnifierOpen, setMagnifierOpen] = useState(false)

  const getPromptByLang = useCallback((lang: "zh" | "en"): string => {
    const posParts: string[] = []
    const negParts: string[] = []
    for (const pt of positive) {
      const text = lang === "zh" ? pt.tag.zh : pt.tag.en
      posParts.push(pt.weight === 1 ? text : `(${text}:${pt.weight})`)
    }
    for (const pt of negative) {
      const text = lang === "zh" ? pt.tag.zh : pt.tag.en
      negParts.push(pt.weight === 1 ? text : `(${text}:${pt.weight})`)
    }
    let result = posParts.join(", ")
    if (negParts.length > 0) {
      result += "\n--neg " + negParts.join(", ")
    }
    return result
  }, [positive, negative])

  const copyText = async (text: string) => {
    if (!text) return
    try { await navigator.clipboard.writeText(text); showToast("已复制", "success") }
    catch { showToast("复制失败", "error") }
  }

  const handleCopy = async (lang?: "zh" | "en") => {
    const text = lang ? getPromptByLang(lang) : getFullPrompt()
    if (!text) return
    await copyText(text)
    try { await window.api.history.add({ prompt: text, positive_count: positive.length, negative_count: negative.length }) } catch { /* ok */ }
  }

  const availableTags = React.useMemo(() => {
    if (selectedSubIds.size === 0) return allTags
    const filtered = new Set<string>()
    for (const cat of categories) {
      for (const sub of cat.subcategories) {
        if (selectedSubIds.has(sub.id)) {
          for (const tag of sub.tags) filtered.add(tag.id)
        }
      }
    }
    return allTags.filter(t => filtered.has(t.id))
  }, [allTags, categories, selectedSubIds])

  React.useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.key === "z") { e.preventDefault(); if (canUndo()) undo() }
      if (e.ctrlKey && e.key === "y") { e.preventDefault(); if (canRedo()) redo() }
    }
    window.addEventListener("keydown", handler)
    return () => window.removeEventListener("keydown", handler)
  }, [positive, negative])

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
      <div className="flex items-center gap-1 px-3 py-1.5 border-b border-[var(--color-border)] bg-[var(--color-bg-secondary)]">
        <ToolBtn onClick={undo} disabled={!canUndo()} title="Ctrl+Z">↩</ToolBtn>
        <ToolBtn onClick={redo} disabled={!canRedo()} title="Ctrl+Y">↪</ToolBtn>
        <div className="w-px h-4 bg-[var(--color-border)] mx-1" />
        <ToolBtn onClick={deduplicate} title="去重">🞇</ToolBtn>
        <ToolBtn onClick={() => randomPick(availableTags, parseInt(random_min) || 3, parseInt(random_max) || 16)} title="随机">🎉</ToolBtn>
        <div className="w-px h-4 bg-[var(--color-border)] mx-1" />
        <button onClick={clearPositive} className="px-2 py-1 text-xs text-green-400 hover:bg-green-500/10 rounded">清正面</button>
        <button onClick={clearNegative} className="px-2 py-1 text-xs text-red-400 hover:bg-red-500/10 rounded">清负面</button>
        <button onClick={clearAll} className="px-2 py-1 text-xs text-[var(--color-text-secondary)] hover:bg-[var(--color-accent)]/10 rounded">全部清空</button>
      </div>

      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <div className="flex-1 overflow-auto border-b border-[var(--color-border)]">
          <TagCards />
        </div>

        <div className="border-b border-[var(--color-border)] overflow-auto" style={{ maxHeight: "30%", minHeight: "100px" }}>
          <div className="px-3 py-2">
            <div className="text-xs font-medium text-green-400 mb-1.5">✓ 正面 ({positive.length})</div>
            <TagChipList tags={positive} onRemove={removePositive} onWeightChange={updateWeight} scaleClass={scaleClass} accent="#a855f7" />
          </div>
          <div className="px-3 py-2 border-t border-[var(--color-border)]">
            <div className="text-xs font-medium text-red-400 mb-1.5">☒ 负面 ({negative.length})</div>
            <TagChipList tags={negative} onRemove={removeNegative} onWeightChange={updateWeight} scaleClass={scaleClass} accent="#ef4444" />
          </div>
        </div>

        <div className="shrink-0 p-3 bg-[var(--color-bg-secondary)]">
          <div className="flex items-center justify-between mb-2 flex-wrap gap-1">
            <span className="text-xs font-medium text-[var(--color-text-secondary)]">输出</span>
            <div className="flex items-center gap-1">
              <button onClick={() => handleCopy("zh")} className="px-3 py-1.5 text-xs bg-[var(--color-bg-primary)] border border-[var(--color-border)] text-[var(--color-text-primary)] rounded hover:bg-[var(--color-accent)]/10">📋 复制中文</button>
              <button onClick={() => handleCopy("en")} className="px-3 py-1.5 text-xs bg-[var(--color-bg-primary)] border border-[var(--color-border)] text-[var(--color-text-primary)] rounded hover:bg-[var(--color-accent)]/10">📋 复制英文</button>
              <button onClick={() => setMagnifierOpen(true)} className="px-3 py-1.5 text-xs bg-[var(--color-bg-primary)] border border-[var(--color-border)] text-[var(--color-text-primary)] rounded hover:bg-[var(--color-accent)]/10" title="放大查看">🔍</button>
            </div>
          </div>
          <textarea readOnly value={getFullPrompt()}
            placeholder={positive.length === 0 && negative.length === 0 ? "请选择标签..." : ""}
            className="w-full h-20 px-3 py-2 bg-[var(--color-bg-primary)] border border-[var(--color-border)] rounded text-sm text-[var(--color-text-primary)] font-mono resize-none focus:outline-none focus:border-[var(--color-accent)]" />
        </div>

        {/* Magnifier Modal */}
        {magnifierOpen && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50" onClick={() => setMagnifierOpen(false)}>
            <div className="bg-[var(--color-bg-primary)] border border-[var(--color-border)] rounded-lg shadow-2xl w-[90vw] max-w-[800px] max-h-[85vh] flex flex-col" onClick={e => e.stopPropagation()}>
              <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--color-border)]">
                <span className="text-sm font-medium text-[var(--color-text-primary)]">🔍 输出预览</span>
                <button onClick={() => setMagnifierOpen(false)} className="text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] text-lg leading-none">✕</button>
              </div>
              <div className="flex-1 overflow-auto p-4 space-y-4">
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs font-medium text-green-400">中文</span>
                    <button onClick={() => copyText(getPromptByLang("zh"))} className="px-3 py-1 text-xs bg-[var(--color-accent)]/10 border border-[var(--color-accent)]/30 text-[var(--color-accent)] rounded hover:bg-[var(--color-accent)]/20">📋 复制中文</button>
                  </div>
                  <textarea readOnly value={getPromptByLang("zh")}
                    className="w-full h-28 px-3 py-2 bg-[var(--color-bg-secondary)] border border-[var(--color-border)] rounded text-sm text-[var(--color-text-primary)] font-mono resize-none" />
                </div>
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs font-medium text-[var(--color-accent)]">English</span>
                    <button onClick={() => copyText(getPromptByLang("en"))} className="px-3 py-1 text-xs bg-[var(--color-accent)]/10 border border-[var(--color-accent)]/30 text-[var(--color-accent)] rounded hover:bg-[var(--color-accent)]/20">📋 复制英文</button>
                  </div>
                  <textarea readOnly value={getPromptByLang("en")}
                    className="w-full h-28 px-3 py-2 bg-[var(--color-bg-secondary)] border border-[var(--color-border)] rounded text-sm text-[var(--color-text-primary)] font-mono resize-none" />
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function ToolBtn({ onClick, disabled, title, children }: { onClick: () => void; disabled?: boolean; title: string; children: React.ReactNode }) {
  return <button onClick={onClick} disabled={disabled} title={title} className="w-7 h-7 flex items-center justify-center rounded text-xs hover:bg-[var(--color-accent)]/20 disabled:opacity-30 disabled:cursor-not-allowed">{children}</button>
}

function WeightInput({ tagId, value, onChange }: { tagId: string; value: number; onChange: (v: number) => void }) {
  const [text, setText] = useState(String(value))
  const inputRef = useRef<HTMLInputElement>(null)
  const isFocused = useRef(false)

  useEff(() => {
    if (!isFocused.current) setText(String(value))
  }, [value])

  const commit = (raw: string) => {
    isFocused.current = false
    const n = parseFloat(raw)
    if (isNaN(n) || n < 0.1) { onChange(1.0); setText("1") }
    else if (n > 2.0) { onChange(2.0); setText("2") }
    else { const clamped = Math.round(n * 100) / 100; onChange(clamped); setText(String(clamped)) }
  }

  return (
    <input type="text" ref={inputRef} value={text}
      onFocus={() => { isFocused.current = true }}
      onChange={e => {
        const raw = e.target.value
        if (raw === "" || raw === "." || /^\d*\.?\d{0,2}$/.test(raw)) {
          setText(raw)
        }
      }}
      onBlur={e => commit(e.target.value)}
      onKeyDown={e => { if (e.key === "Enter") { commit(text); inputRef.current?.blur() } }}
      className="w-12 px-1 py-0.5 text-xs text-center bg-[var(--color-bg-primary)] border border-[var(--color-border)] rounded text-[var(--color-text-primary)] focus:border-[var(--color-accent)]"
    />
  )
}

function TagChipList({ tags, onRemove, onWeightChange, scaleClass, accent }: {
  tags: PanelTag[]; onRemove: (id: string) => void; onWeightChange: (id: string, w: number) => void; scaleClass: string; accent: string
}) {
  if (tags.length === 0) return <div className="text-xs text-[var(--color-text-secondary)] py-1">暂无</div>
  return (
    <div className="flex flex-wrap gap-1.5">
      {tags.map(pt => (
        <div key={pt.tag.id} className={`flex items-center ${scaleClass} rounded border group`} style={{ backgroundColor: `${accent}15`, borderColor: `${accent}30` }}>
          <span className="text-[var(--color-text-primary)] whitespace-nowrap">{pt.tag.zh}</span>
          <input type="range" min="0.1" max="2.0" step="0.1" value={pt.weight} onChange={e => onWeightChange(pt.tag.id, parseFloat(e.target.value))} className="w-10 h-1" style={{ accentColor: accent }} />
          <WeightInput tagId={pt.tag.id} value={pt.weight} onChange={(v) => onWeightChange(pt.tag.id, v)} />
          <button onClick={() => onRemove(pt.tag.id)} className="text-[var(--color-text-secondary)] hover:text-red-400 opacity-0 group-hover:opacity-100">✕</button>
        </div>
      ))}
    </div>
  )
}

function showToast(message: string, type: "success" | "error" | "info") {
  window.dispatchEvent(new CustomEvent("grimoire:toast", { detail: { message, type } }))
}
