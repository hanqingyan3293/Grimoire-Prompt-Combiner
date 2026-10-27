import ModelSettings from '../../source/src/renderer/pages/settings/ModelSettings/ModelSettings'
import { validateModelSettingsSearch } from '../../source/src/renderer/pages/settings/ModelSettings/modelSettingsFocus'
import { useSearch } from './shims/tanstack-router'

/** Source selectors and preference/DataApi hooks are reused unchanged. Persistence
 * is available; runtime adoption of these Cherry preferences is a separate contract.
 * The source prop disables BOTH drawers and their mounting (not CSS interception).
 */
export function CompatModelSettings() {
  const { focus } = validateModelSettingsSearch(useSearch({ strict: false }))
  return (
    <div className="flex min-h-0 flex-1 flex-col" data-ui="compat.settings.model">
      <section role="note" aria-label="模型设置能力边界" className="mx-4 mt-4 rounded border border-amber-500/30 bg-amber-500/10 p-4 text-sm text-foreground">
        <p>源 ModelSettings 已挂载：四个模型选择器读取现有 Provider / Model 目录，并将选择保存到 Grimoire 的 Cherry 偏好设置。</p>
        <p className="mt-2">保存配置不代表执行已接入：chat.default_model_id、快捷助手、翻译和绘画模型偏好的运行时消费者尚未验证。当前聊天的模型选择仍由聊天页管理。</p>
        <p className="mt-2">主题命名与翻译配置侧栏暂不开放：对应执行链尚未接入。默认模型保留源行为，仅级联填充尚未设置的快捷助手和翻译模型；绘画模型独立保存。</p>
      </section>
      <ModelSettings focus={focus} autoFillEmptyModels={false} showSettingsButton={false} showPaintingModel />
    </div>
  )
}
