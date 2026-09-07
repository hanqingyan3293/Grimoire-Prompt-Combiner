// 魔导书 Grimoire v7 — 主内容区
import React, { useState, useCallback, useRef, useEffect as useEff } from "react"
import { useI18n } from "../../i18n/context"
import { usePromptsStore } from "../../stores/prompts.store"
import { useTagsStore } from "../../stores/tags.store"
import { useSettingsStore } from "../../stores/settings.store"
import { TagCards } from "../tags/TagCards"
import type { PanelTag } from "../../../shared/types"
import { Clipboard, Eraser, Dices, ListChecks, Redo2, RotateCcw, Search, Trash2, X } from 'lucide-react'
import { Badge } from '../ui/Badge'
import { Button, IconButton } from '../ui/Button'
import { Modal } from '../ui/Modal'

function promptChipScale(value: string): string {
  const fontSize = Number.parseInt(value, 10)
  if (fontSize <= 13) return "text-[10px] gap-1"
  if (fontSize >= 16) return "text-sm gap-2"
  return "text-xs gap-1.5"
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

  const scaleClass = promptChipScale(ui_scale)
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
	      const target = e.target as HTMLElement | null
	      const tagName = target?.tagName
	      const isEditingText =
	        target?.isContentEditable ||
	        tagName === "INPUT" ||
	        tagName === "TEXTAREA" ||
	        tagName === "SELECT"
	      if (isEditingText) return
	      if (e.ctrlKey && e.key === "z") { e.preventDefault(); if (canUndo()) undo() }
	      if (e.ctrlKey && e.key === "y") { e.preventDefault(); if (canRedo()) redo() }
	    }
    window.addEventListener("keydown", handler)
    return () => window.removeEventListener("keydown", handler)
  }, [positive, negative])

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
      <div className="ui-toolbar flex flex-wrap items-center gap-1.5 px-3 py-2">
        <IconButton icon={RotateCcw} onClick={undo} disabled={!canUndo()} label="撤销" title="撤销（Ctrl+Z）" />
        <IconButton icon={Redo2} onClick={redo} disabled={!canRedo()} label="重做" title="重做（Ctrl+Y）" />
        <div className="w-px h-4 bg-[var(--color-border)] mx-1" />
        <Button size="sm" icon={ListChecks} onClick={deduplicate}>去重</Button>
        <Button size="sm" icon={Dices} onClick={() => randomPick(availableTags, parseInt(random_min) || 3, parseInt(random_max) || 16)}>随机抽取</Button>
        <div className="w-px h-4 bg-[var(--color-border)] mx-1" />
        <Button size="sm" variant="ghost" icon={Eraser} onClick={clearPositive} className="text-[var(--color-success)]">清正面</Button>
        <Button size="sm" variant="ghost" icon={Eraser} onClick={clearNegative} className="text-[var(--color-danger)]">清负面</Button>
        <Button size="sm" variant="danger" icon={Trash2} onClick={clearAll}>全部清空</Button>
      </div>

      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <div className="flex-1 overflow-auto border-b border-[var(--color-border)]">
          <TagCards />
        </div>

        <div className="ui-prompt-section overflow-auto" style={{ maxHeight: "30%", minHeight: "100px" }}>
          <div className="px-3 py-2">
            <div className="mb-2 flex items-center gap-2"><Badge tone="success">正面</Badge><span className="text-xs text-[var(--color-muted-foreground)]">{positive.length} 个标签</span></div>
            <TagChipList tags={positive} onRemove={removePositive} onWeightChange={updateWeight} scaleClass={scaleClass} tone="positive" />
          </div>
          <div className="px-3 py-2 border-t border-[var(--color-border)]">
            <div className="mb-2 flex items-center gap-2"><Badge tone="danger">负面</Badge><span className="text-xs text-[var(--color-muted-foreground)]">{negative.length} 个标签</span></div>
            <TagChipList tags={negative} onRemove={removeNegative} onWeightChange={updateWeight} scaleClass={scaleClass} tone="negative" />
          </div>
        </div>

        <div className="ui-prompt-section shrink-0 p-3">
          <div className="flex items-center justify-between mb-2 flex-wrap gap-1">
            <span className="ui-section-label">输出</span>
            <div className="flex items-center gap-1">
              <Button size="sm" icon={Clipboard} onClick={() => handleCopy("zh")}>复制中文</Button>
              <Button size="sm" icon={Clipboard} onClick={() => handleCopy("en")}>复制英文</Button>
              <IconButton icon={Search} onClick={() => setMagnifierOpen(true)} label="放大查看" />
            </div>
          </div>
          <textarea readOnly value={getFullPrompt()}
            placeholder={positive.length === 0 && negative.length === 0 ? "请选择标签..." : ""}
            className="w-full h-20 px-3 py-2 bg-[var(--color-bg-primary)] border border-[var(--color-border)] rounded text-sm text-[var(--color-text-primary)] font-mono resize-none focus:outline-none focus:border-[var(--color-accent)]" />
        </div>

        <Modal title="输出预览" open={magnifierOpen} onClose={() => setMagnifierOpen(false)} maxWidth="max-w-[800px]">
              <div className="space-y-4">
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <Badge tone="accent">中文</Badge>
                    <Button size="sm" icon={Clipboard} onClick={() => copyText(getPromptByLang("zh"))}>复制中文</Button>
                  </div>
                  <textarea readOnly value={getPromptByLang("zh")}
                    className="w-full h-28 px-3 py-2 bg-[var(--color-bg-secondary)] border border-[var(--color-border)] rounded text-sm text-[var(--color-text-primary)] font-mono resize-none" />
                </div>
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <Badge tone="accent">English</Badge>
                    <Button size="sm" icon={Clipboard} onClick={() => copyText(getPromptByLang("en"))}>复制英文</Button>
                  </div>
                  <textarea readOnly value={getPromptByLang("en")}
                    className="w-full h-28 px-3 py-2 bg-[var(--color-bg-secondary)] border border-[var(--color-border)] rounded text-sm text-[var(--color-text-primary)] font-mono resize-none" />
                </div>
              </div>
        </Modal>
      </div>
    </div>
  )
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

function TagChipList({ tags, onRemove, onWeightChange, scaleClass, tone }: {
  tags: PanelTag[]; onRemove: (id: string) => void; onWeightChange: (id: string, w: number) => void; scaleClass: string; tone: 'positive' | 'negative'
}) {
  if (tags.length === 0) return <div className="text-xs text-[var(--color-text-secondary)] py-1">暂无</div>
  return (
    <div className="flex flex-wrap gap-1.5">
      {tags.map(pt => (
        <div key={pt.tag.id} className={`ui-prompt-chip ui-prompt-chip-${tone} flex items-center ${scaleClass} group px-2`}>
          <span className="text-[var(--color-text-primary)] whitespace-nowrap">{pt.tag.zh}</span>
          <input type="range" min="0.1" max="2.0" step="0.1" value={pt.weight} onChange={e => onWeightChange(pt.tag.id, parseFloat(e.target.value))} className={`h-1 w-10 ${tone === 'negative' ? 'accent-[var(--color-danger)]' : 'accent-[var(--color-accent)]'}`} aria-label={`${pt.tag.zh}权重`} />
          <WeightInput tagId={pt.tag.id} value={pt.weight} onChange={(v) => onWeightChange(pt.tag.id, v)} />
          <IconButton icon={X} onClick={() => onRemove(pt.tag.id)} label={`移除${pt.tag.zh}`} className="h-6 w-6 min-w-6 opacity-0 group-hover:opacity-100" />
        </div>
      ))}
    </div>
  )
}

function showToast(message: string, type: "success" | "error" | "info") {
  window.dispatchEvent(new CustomEvent("grimoire:toast", { detail: { message, type } }))
}
