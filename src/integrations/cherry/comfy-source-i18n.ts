/**
 * Replacement for the source's @main/i18n module.
 *
 * These are the exact strings from the read-only source main catalogs:
 *   src/vendor/cherry/source/src/main/i18n/locales/zh-cn.json
 *   src/vendor/cherry/source/src/main/i18n/locales/en-us.json
 * Only keys reached by comfyuiTransport.ts and comfyuiHttp.ts are carried.
 * The resolver mirrors the source's flat-key + {{var}} interpolation rules.
 */
type Catalog = Record<string, string>

const ZH_CN: Catalog = {
  'paintings.comfyui.image_download_timeout': '下载已完成的图像超时（{{seconds}} 秒）',
  'paintings.comfyui.image_fetch_failed': 'ComfyUI 无法返回已生成的图像',
  'paintings.comfyui.no_image': 'ComfyUI 已完成但没有生成图像',
  'paintings.comfyui.no_prompt_id': 'ComfyUI 已接受工作流但未返回提示词 ID',
  'paintings.comfyui.no_prompt_node': 'ComfyUI 工作流“{{workflow}}”没有采样器用作正向条件输入的文本节点，因此无处写入提示词',
  'paintings.comfyui.poll_timeout': 'ComfyUI 未能在 {{seconds}} 秒内完成',
  'paintings.comfyui.request_failed': '请求 ComfyUI 服务器失败',
  'paintings.comfyui.request_timeout': 'ComfyUI 未能在 {{seconds}} 秒内响应',
  'paintings.comfyui.workflow_failed': 'ComfyUI 工作流执行失败：',
  'paintings.comfyui.workflow_rejected': 'ComfyUI 拒绝了该工作流（HTTP {{status}}）',
}

const EN_US: Catalog = {
  'paintings.comfyui.image_download_timeout': 'Downloading a finished image timed out after {{seconds}}s',
  'paintings.comfyui.image_fetch_failed': 'ComfyUI could not return a finished image',
  'paintings.comfyui.no_image': 'ComfyUI finished without producing an image',
  'paintings.comfyui.no_prompt_id': 'ComfyUI accepted the workflow but returned no prompt id',
  'paintings.comfyui.no_prompt_node': 'ComfyUI workflow "{{workflow}}" has no text node the sampler consumes as positive conditioning, so there is nowhere to put the prompt',
  'paintings.comfyui.poll_timeout': 'ComfyUI did not finish within {{seconds}}s',
  'paintings.comfyui.request_failed': 'The request to the ComfyUI server failed',
  'paintings.comfyui.request_timeout': 'ComfyUI did not answer within {{seconds}}s',
  'paintings.comfyui.workflow_failed': 'ComfyUI workflow failed:',
  'paintings.comfyui.workflow_rejected': 'ComfyUI rejected the workflow (HTTP {{status}})',
}

function activeCatalog(): Catalog {
  const locale = process.env.GRIMOIRE_LOCALE || 'zh-CN'
  return locale.toLowerCase().startsWith('en') ? EN_US : ZH_CN
}

export function t(key: string, params?: Record<string, string | number>): string {
  const bridge = globalThis.__grimoireComfySourceBridge
  if (bridge) return bridge.t(key, params)
  const value = activeCatalog()[key] ?? key
  if (!params) return value
  return value.replace(/\{\{\s*(\w+)\s*\}\}/g, (match, name: string) => name in params ? String(params[name]) : match)
}
