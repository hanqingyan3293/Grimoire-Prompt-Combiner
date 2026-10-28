import { lazy, Suspense } from 'react'
import type { CompatRoute } from './route-registry'
import { CompatRemainingSettings } from './CompatRemainingSettings'
import { getSettingsDiagnostic } from './settings-route-descriptors'
import { CompatDomainCapabilities } from './CompatDomainCapabilities'
import { CompatPreferenceWiring } from './CompatPreferenceWiring'
// The source helper reads `window.electron.process.platform`; the compat window has no such
// global, so `isWin` was always false there and the selection page silently degraded to its
// diagnostic on every OS (found by the route audit, 2026-10-27). Detect from the UA instead.
const isWindowsHost = typeof navigator !== 'undefined' && /Windows/i.test(navigator.userAgent)

// Source views stay behind native read-only controls until their effect consumers exist.
// Credential-bearing settings are redacted in main and again before preference caching;
// generic credential writes reject before optimistic state. No fake window/runtime provider.
const SOURCE_SETTINGS = {
  'settings-general': {
    Component: lazy(() => import('../../source/src/renderer/pages/settings/GeneralSettings/GeneralSettings')),
    // Every control this page shows now has a real consumer (see cherry-preference-consumers); the
    // two switches that could not take effect are hidden by compat CSS, so the page is editable.
    readOnly: false,
    limitation: '源通用设置已挂载且可编辑：页面上每个开关都有真实消费者（开机自启、防休眠、代理三键、上下文四键、重试四键、开发者模式、Agent 语言、硬件加速）。另有 2 个在 Grimoire 里无处生效的开关（私网抓取、提交归因）已隐藏，底部接线报告里注明原因。'
  },
  'settings-api-gateway': {
    Component: lazy(() => import('../../source/src/renderer/pages/settings/ToolSettings/ApiGatewaySettings/ApiGatewaySettings')),
    // Grimoire now runs a real OpenAI-compatible gateway (api-gateway.service), and the running
    // badge is fed from `api_gateway.status`; the page's controls therefore change real state.
    readOnly: false,
    limitation: '源 API 网关设置已挂载且可编辑：启动/停止/重启调用真实网关（OpenAI 兼容，转发到当前供应商），运行状态来自 api_gateway.status，端口与密钥取自本页保存的偏好。'
  },
  'settings-websearch': {
    // Still read-only, but for a NEW reason: the search executor exists (websearch.service), while the
    // provider credentials cannot be written — `chat.web_search.provider_overrides` is a protected
    // preference and the dedicated credential adapter is not connected. Enabling the page now would let
    // a user type an API key and silently fail to save it.
    readOnly: true,
    Component: lazy(() => import('../../source/src/renderer/pages/settings/WebSearchSettings/WebSearchSettings')),
    limitation: '源联网搜索设置已挂载，保持只读：搜索执行方已实现（SearXNG/Tavily 适配器 + 正文提取 + 8 条测试），但供应商凭据写不进去——chat.web_search.provider_overrides 属于受保护凭据偏好，专用凭据适配器尚未接入，通用写入会被主进程拒绝。解禁前必须先做该适配器，否则用户填了 key 也存不下来。'
  },
  'settings-selection-assistant': {
    readOnly: true,
    Component: lazy(() => import('../../source/src/renderer/pages/settings/SelectionAssistantSettings/SelectionAssistantSettings')),
    limitation: '源划词助手设置在 Windows 上只读挂载。原生 selection-hook、工具栏/动作窗口、全局快捷键和执行消费者尚未接通；控件不改变系统或偏好，设置导航链接仍使用真实路由。'
  },
  'settings-browser': {
    readOnly: true,
    Component: lazy(() => import('../../source/src/renderer/pages/settings/BrowserSettings').then(module => ({ default: module.BrowserSettings }))),
    limitation: '浏览器偏好的执行消费者与导入/清理服务尚未接入。表单及动作按钮已由原生 disabled fieldset 禁用，历史记录弹窗也不开放：它需要真实 TabsProvider，不能用空 tab 上下文替代。'
  },
  'settings-screenshot': {
    readOnly: true,
    Component: lazy(() => import('../../source/src/renderer/pages/settings/ScreenshotSettings/ScreenshotSettings')),
    limitation: '截图、全局快捷键与 OCR 执行服务尚未接入，表单及动作按钮已禁用。快捷键文本只是已保存的绑定；源组件按操作系统显示的 OCR 标签不代表识别服务可用，local_model 的默认状态也不代表已完成模型探测。只保留到已登记设置页的导航链接。'
  }
} as const

type SourceSettingsId = keyof typeof SOURCE_SETTINGS

export function isCompatSourceSettingsRoute(id: string): id is SourceSettingsId {
  return Object.prototype.hasOwnProperty.call(SOURCE_SETTINGS, id)
}

/** An authentic source view, with native controls disabled until effect consumers exist.
 * Native fieldset semantics (not CSS interception) prevent both preference writes and
 * unavailable actions. Source read effects still run through the real error boundaries.
 */
export function CompatSourceSettings({ route }: { route: CompatRoute }) {
  if (!isCompatSourceSettingsRoute(route.id)) return <CompatRemainingSettings route={route} />
  if (route.id === 'settings-screenshot' && typeof window.api?.shortcut?.onRegistrationConflict !== 'function') {
    return <CompatRemainingSettings route={route} />
  }
  if (route.id === 'settings-selection-assistant' && !isWindowsHost) return <CompatRemainingSettings route={route} />
  const { Component, limitation } = SOURCE_SETTINGS[route.id]
  const descriptor = route.id === 'settings-general' ? {
    title: '通用设置',
    missing: [
      'agent.commit_attribution.enabled：Grimoire Agent 不创建 git 提交，开关已隐藏',
      'app.fetch.allow_private_network：没有面向用户的抓取入口，开关已隐藏',
      'app.user.id：源用于匿名标识，页面上没有对应控件',
    ],
    nextAction: '页面上每个可见开关都已生效；将来若接入抓取或提交归因能力，再解除对应开关的隐藏。'
  } : getSettingsDiagnostic(route.id)
  if (!descriptor) return <CompatRemainingSettings route={route} />
  const noteId = 'compat-source-settings-' + route.id
  return (
    <div className="flex min-h-0 w-full flex-col" data-ui="compat.settings.source-readonly" data-settings-route={route.id}>
      <section role="note" id={noteId} aria-label={descriptor.title + '能力边界'} className="mx-4 mt-4 rounded border border-amber-500/30 bg-amber-500/10 p-4 text-sm text-foreground">
        <h1 className="font-medium">{descriptor.title}（PARTIALLY_MIGRATED · {SOURCE_SETTINGS[route.id as SourceSettingsId].readOnly === false ? '可编辑' : '源页面只读'}）</h1>
        <p className="mt-2">{limitation}</p>
        <p className="mt-2">{SOURCE_SETTINGS[route.id as SourceSettingsId].readOnly === false ? '本页可编辑：修改会立即生效并按上述消费者作用到主进程。' : '不保存配置、不注册全局行为、不启动服务；下方未接入功能不是可用能力。'}</p>
        <ul className="mt-2 list-disc pl-5">{descriptor.missing.map(item => <li key={item}>{item}</li>)}</ul>
        <p className="mt-2">下一步：{descriptor.nextAction}</p>
      </section>
      {route.id === 'settings-general' ? <CompatPreferenceWiring /> : null}
      {route.id === 'settings-general' ? <CompatDomainCapabilities /> : null}
      <fieldset disabled={SOURCE_SETTINGS[route.id as SourceSettingsId].readOnly !== false} aria-describedby={noteId} aria-label={descriptor.title + (SOURCE_SETTINGS[route.id as SourceSettingsId].readOnly === false ? '' : '（只读）')} className="m-0 min-w-0 border-0 p-0">
        <Suspense fallback={<p role="status" className="p-4 text-sm text-muted-foreground">加载源设置页面…</p>}>
          <Component />
        </Suspense>
      </fieldset>
    </div>
  )
}
