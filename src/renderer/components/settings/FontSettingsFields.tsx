// 通用设置 → 字体：三个槽位（界面 / 标题 / 等宽）。
//
// 三个槽位对应项目里真实存在的三层字体语义（--font-sans / --font-display / --font-mono），
// 不是一个「全局字体」下拉糊住所有场景：等宽槽位影响提示词原文与日志对齐，标题槽位只影响 h1–h3。
//
// 数据来源：主进程 `system:listFonts` → font-list（已有服务，带缓存）。枚举失败时列表为空，
// 用户仍能选「跟随系统默认」，不会把设置页卡死。

import { useEffect, useState } from 'react'
import { useSettingsStore } from '../../stores/settings.store'
import { buildFontStack, type FontSlot } from '../../font-application'

const SLOT_META: Record<FontSlot, { settingKey: 'font_ui' | 'font_display' | 'font_mono'; label: string; desc: string; preview: string }> = {
  ui: { settingKey: 'font_ui', label: '界面字体', desc: '控件、正文与菜单', preview: '魔导书 Grimoire 0123' },
  display: { settingKey: 'font_display', label: '标题字体', desc: '面板标题与 h1–h3', preview: '面板标题 Title' },
  mono: { settingKey: 'font_mono', label: '等宽字体', desc: '提示词原文、日志与代码', preview: '1girl, solo, {long hair:1.2}' },
}

const SLOT_ORDER: FontSlot[] = ['ui', 'display', 'mono']

export function FontSettingsFields() {
  const settings = useSettingsStore()
  const [fonts, setFonts] = useState<string[]>([])
  const [fontError, setFontError] = useState<string | null>(null)

  useEffect(() => {
    let disposed = false
    const api = (window.api as unknown as { system?: { listFonts?: () => Promise<string[]> } }).system
    if (!api?.listFonts) return
    void api.listFonts()
      .then((list) => { if (!disposed) setFonts(Array.isArray(list) ? list : []) })
      .catch(() => { if (!disposed) setFontError('无法读取系统字体，仅能使用默认字体') })
    return () => { disposed = true }
  }, [])

  const current = (slot: FontSlot): string => String(settings[SLOT_META[slot].settingKey] ?? '')

  return (
    <div className="space-y-3">
      {SLOT_ORDER.map((slot) => {
        const meta = SLOT_META[slot]
        const value = current(slot)
        const known = value && fonts.includes(value)
        return (
          <div key={slot} className="space-y-1.5">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs font-medium text-[var(--color-text-primary)]">{meta.label}</span>
              <span className="text-[10px] text-[var(--color-text-secondary)]">{meta.desc}</span>
              {slot === 'mono' && <span className="ui-badge text-[10px]">非等宽字体会破坏对齐</span>}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <select
                className="ui-field min-w-[10rem] flex-1"
                aria-label={meta.label}
                value={known ? value : ''}
                onChange={(event) => void settings.setSetting(meta.settingKey, event.target.value)}
              >
                <option value="">跟随系统默认</option>
                {/* 已选但不在列表里（例如字体被卸载）：保留一个占位项，避免静默改回默认 */}
                {value && !known && <option value={value}>{value}（未在系统中找到）</option>}
                {fonts.map((font) => <option key={font} value={font}>{font}</option>)}
              </select>
              <span
                className="min-w-0 flex-1 truncate rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-bg-primary)] px-2 py-1.5 text-xs text-[var(--color-text-primary)]"
                style={{ fontFamily: buildFontStack(slot, value) }}
                title={buildFontStack(slot, value)}
              >
                {meta.preview}
              </span>
            </div>
          </div>
        )
      })}
      {fonts.length === 0 && !fontError && <div className="text-[10px] text-[var(--color-text-secondary)]">正在读取系统字体…</div>}
      {fontError && <div className="ui-inline-note ui-inline-note-warning text-[11px]" role="status">{fontError}</div>}
    </div>
  )
}
