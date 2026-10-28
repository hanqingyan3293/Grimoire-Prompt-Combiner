import i18n from 'i18next'

// User-visible strings that name the upstream product (M1.5.5).
//
// The vendored locale packs describe Cherry Studio's features. Some of those sentences are shown as
// Grimoire copy and are simply false here. Attribution belongs in the About page and the license
// files, not in feature descriptions, so the few strings that read as product claims are overridden
// at load time instead of being copied into every locale file.
const OVERRIDES: Record<string, Record<string, string>> = {
  'zh-CN': {
    'apiGateway.description': '通过 OpenAI 兼容的 HTTP API 暴露魔导书的 AI 能力',
    'apiGateway.required.description': '该模型将通过本地 API 网关桥接；开启后会随应用启动，也可以在设置里关闭。',
  },
  'en-US': {
    'apiGateway.description': "Expose Grimoire's AI features over an OpenAI-compatible HTTP API",
  },
}

export function applyBrandOverrides(): void {
  for (const [language, bundle] of Object.entries(OVERRIDES)) {
    i18n.addResourceBundle(language, 'translation', bundle, true, true)
  }
}
