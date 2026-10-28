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
    // Enabled: credentials now have a dedicated encrypted path (cherry-credential.service), and the
    // executor exists (SearXNG / Tavily). Providers outside those two report an explicit refusal.
    readOnly: false,
    Component: lazy(() => import('../../source/src/renderer/pages/settings/WebSearchSettings/WebSearchSettings')),
    limitation: '源联网搜索设置已挂载且可编辑。真正执行搜索的是 SearXNG（自建、免 key）与 Tavily（需 key），其余供应商的「测试」会明确报「本构建不支持该供应商」。供应商凭据经主进程专用通道加密存储，渲染层读回一律脱敏（显示 ********），明文只在本进程内使用。'
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
    // Enabled: capture works (desktopCapturer → validated PNG → media/screenshots), the accelerator is
    // registered as a real global shortcut, and the OCR switch is hidden because there is no OCR service.
    readOnly: false,
    Component: lazy(() => import('../../source/src/renderer/pages/settings/ScreenshotSettings/ScreenshotSettings')),
    limitation: '截图与全局快捷键已真实接入：按键触发 desktopCapturer 截屏，图片经 PNG 校验后落到媒体目录并复制到剪贴板；关闭开关会立即释放快捷键，冲突会在日志中回报。本构建没有 OCR 服务（WD14 是标注不是 OCR），「自动 OCR」开关已隐藏，源组件按平台显示的 OCR 文案不代表可用。'
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
