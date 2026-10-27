import { lazy, Suspense } from 'react'
import type { CompatRoute } from './route-registry'
import { CompatRemainingSettings } from './CompatRemainingSettings'
import { getSettingsDiagnostic } from './settings-route-descriptors'
import { CompatDomainCapabilities } from './CompatDomainCapabilities'
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
    limitation: '源通用设置已挂载。托盘、启动、代理、防休眠、重试与上下文设置的完整消费者仍未验收，因此表单只读，不会写入偏好或重启应用。已有 Grimoire 行为不会被此页更改。'
  },
  'settings-api-gateway': {
    Component: lazy(() => import('../../source/src/renderer/pages/settings/ToolSettings/ApiGatewaySettings/ApiGatewaySettings')),
    limitation: '源 API 网关设置已挂载。凭据在主进程投影时脱敏，通用偏好写入不允许保存或替换凭据。启动、停止、重启、密钥生成与复制控件只读；源运行指示没有真实网关状态支持，不能视为已确认停止或运行。'
  },
  'settings-websearch': {
    Component: lazy(() => import('../../source/src/renderer/pages/settings/WebSearchSettings/WebSearchSettings')),
    limitation: '源联网搜索设置已挂载。已保存的 API key 和认证密码在 IPC 返回与 renderer 缓存前脱敏；供应商配置与搜索/抓取执行尚未接通，表单和凭据弹窗入口只读，不发起网络搜索，也不把未查询的认证状态当作无密钥。'
  },
  'settings-selection-assistant': {
    Component: lazy(() => import('../../source/src/renderer/pages/settings/SelectionAssistantSettings/SelectionAssistantSettings')),
    limitation: '源划词助手设置在 Windows 上只读挂载。原生 selection-hook、工具栏/动作窗口、全局快捷键和执行消费者尚未接通；控件不改变系统或偏好，设置导航链接仍使用真实路由。'
  },
  'settings-browser': {
    Component: lazy(() => import('../../source/src/renderer/pages/settings/BrowserSettings').then(module => ({ default: module.BrowserSettings }))),
    limitation: '浏览器偏好的执行消费者与导入/清理服务尚未接入。表单及动作按钮已由原生 disabled fieldset 禁用，历史记录弹窗也不开放：它需要真实 TabsProvider，不能用空 tab 上下文替代。'
  },
  'settings-screenshot': {
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
    missing: ['托盘/关闭策略与启动行为', '通用偏好完整消费链、模型重试和上下文策略'],
    nextAction: '逐组验证现有 main 消费者并接入缺失服务后，再开放对应源控件。'
  } : getSettingsDiagnostic(route.id)
  if (!descriptor) return <CompatRemainingSettings route={route} />
  const noteId = 'compat-source-settings-' + route.id
  return (
    <div className="flex min-h-0 w-full flex-col" data-ui="compat.settings.source-readonly" data-settings-route={route.id}>
      <section role="note" id={noteId} aria-label={descriptor.title + '能力边界'} className="mx-4 mt-4 rounded border border-amber-500/30 bg-amber-500/10 p-4 text-sm text-foreground">
        <h1 className="font-medium">{descriptor.title}（PARTIALLY_MIGRATED · 源页面只读）</h1>
        <p className="mt-2">{limitation}</p>
        <p className="mt-2">不保存配置、不注册全局行为、不启动服务；下方未接入功能不是可用能力。</p>
        <ul className="mt-2 list-disc pl-5">{descriptor.missing.map(item => <li key={item}>{item}</li>)}</ul>
        <p className="mt-2">下一步：{descriptor.nextAction}</p>
      </section>
      {route.id === 'settings-general' ? <CompatDomainCapabilities /> : null}
      <fieldset disabled aria-describedby={noteId} aria-label={descriptor.title + '（只读）'} className="m-0 min-w-0 border-0 p-0">
        <Suspense fallback={<p role="status" className="p-4 text-sm text-muted-foreground">加载源设置页面…</p>}>
          <Component />
        </Suspense>
      </fieldset>
    </div>
  )
}
