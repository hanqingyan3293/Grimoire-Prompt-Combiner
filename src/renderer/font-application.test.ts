import { describe, expect, it } from 'vitest'
import { buildFontStack, fontSlotForKey, normalizeFontFamily } from './font-application'

describe('font application', () => {
  it('accepts a plain family name and strips wrapping quotes', () => {
    expect(normalizeFontFamily('Microsoft YaHei')).toBe('Microsoft YaHei')
    expect(normalizeFontFamily('"Source Han Sans SC"')).toBe('Source Han Sans SC')
    expect(normalizeFontFamily('  ')).toBe('')
    expect(normalizeFontFamily(null)).toBe('')
  })

  it('rejects values that could escape the CSS declaration', () => {
    expect(normalizeFontFamily('Arial; } body { background: red')).toBe('')
    expect(normalizeFontFamily('Arial"}')).toBe('')
    expect(normalizeFontFamily('url(evil)')).toBe('')
    expect(normalizeFontFamily('x'.repeat(121))).toBe('')
  })

  it('always keeps a fallback chain so Chinese glyphs still render', () => {
    const stack = buildFontStack('ui', 'Arial')
    expect(stack.startsWith('"Arial",')).toBe(true)
    expect(stack).toContain('Microsoft YaHei UI')
    expect(stack).toContain('sans-serif')
  })

  it('falls back to the slot default for empty or invalid values', () => {
    expect(buildFontStack('mono', '')).toContain('Consolas')
    expect(buildFontStack('mono', 'Arial;')).toContain('Consolas')
    expect(buildFontStack('display', 'Inter')).toContain('Segoe UI Variable Display')
  })

  it('maps setting keys to slots and ignores others', () => {
    expect(fontSlotForKey('font_ui')).toBe('ui')
    expect(fontSlotForKey('font_display')).toBe('display')
    expect(fontSlotForKey('font_mono')).toBe('mono')
    expect(fontSlotForKey('ui_scale')).toBeNull()
  })
})
