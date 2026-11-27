// 用户可选字体：把设置里的字体族拼成带回落链的 CSS 变量值。
//
// 三条来自实测的约束：
//  1. **必须保留回落链**。选中的字体如果只有拉丁字形，中文会掉到系统默认；所以值形如
//     `"选中字体", "Microsoft YaHei UI", sans-serif`，而不是只写一个族名。
//  2. **必须校验**。字体名来自主进程枚举，但设置是用户可以手改的 JSON，`"; } body {` 这类值
//     直接拼进 style 就是注入。这里只接受「字母/数字/空格/中文/连字符/点」且长度 ≤ 120。
//  3. **等宽槽位要提示**。选了非等宽字体会破坏日志与提示词原文的对齐，UI 上要标出来，
//     但技术上不阻止（用户可能有自己的等宽字体没被枚举到）。

export type FontSlot = 'ui' | 'display' | 'mono'

export const FONT_SLOT_CSS_VAR: Record<FontSlot, string> = {
  ui: '--font-sans',
  display: '--font-display',
  mono: '--font-mono',
}

/** 与 index.css 的默认链保持一致：清空选择时回到这些值。 */
const SLOT_FALLBACK: Record<FontSlot, string> = {
  ui: '"Segoe UI Variable Text", "Segoe UI", "Microsoft YaHei UI", "Microsoft YaHei", sans-serif',
  display: '"Segoe UI Variable Display", "Segoe UI", "Microsoft YaHei UI", sans-serif',
  mono: '"Consolas", "Monaco", monospace',
}

// 字体名只可能是「字母/数字/空格/点/下划线/连字符/加号」；括号也不放行 ——
// `url(evil)` 这类值必须被拒，即使浏览器本来也不会把它当字体族解析。
const ALLOWED = /^[\p{L}\p{N} ._\-+]+$/u
const MAX_LENGTH = 120

/** 接受一个字体族名，返回去掉包裹引号的干净名字；不合法返回空字符串。 */
export function normalizeFontFamily(value: unknown): string {
  if (typeof value !== 'string') return ''
  const trimmed = value.trim().replace(/^"(.*)"$/, '$1').trim()
  if (!trimmed || trimmed.length > MAX_LENGTH) return ''
  if (!ALLOWED.test(trimmed)) return ''
  return trimmed
}

/** 拼出该槽位的完整 CSS 字体栈；非法/空值直接回落默认链。 */
export function buildFontStack(slot: FontSlot, value: unknown): string {
  const family = normalizeFontFamily(value)
  if (!family) return SLOT_FALLBACK[slot]
  // 这个字族名 `Consolas` 这类不带空格的也要加引号：CSS 里裸名只在它是合法标识符时才等价。
  return `"${family}", ${SLOT_FALLBACK[slot]}`
}

export function applyFontSlot(slot: FontSlot, value: unknown): void {
  if (typeof document === 'undefined') return
  document.documentElement.style.setProperty(FONT_SLOT_CSS_VAR[slot], buildFontStack(slot, value))
}

/** 启动时一次性应用三个槽位。 */
export function applyFontPreferences(values: Partial<Record<FontSlot, string | null | undefined>>): void {
  applyFontSlot('ui', values.ui)
  applyFontSlot('display', values.display)
  applyFontSlot('mono', values.mono)
}

/** 设置键 → 槽位。 */
export function fontSlotForKey(key: string): FontSlot | null {
  if (key === 'font_ui') return 'ui'
  if (key === 'font_display') return 'display'
  if (key === 'font_mono') return 'mono'
  return null
}
