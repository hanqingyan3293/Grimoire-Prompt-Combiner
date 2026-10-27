import LocalModelsSection from '../../source/src/renderer/pages/settings/DependenciesSettings/LocalModelsSection'
import { SettingsContentColumn } from '../../source/src/renderer/components/SettingsPrimitives'

export function CompatLocalModelsSettings() {
  return (
    <SettingsContentColumn>
      <p role="alert" className="mb-4 rounded border border-amber-500/30 p-3 text-sm">
        源本地模型设置已挂载；local_model.list 和加速能力服务尚未接入。下方无模型卡片表示目录未能读取，不表示没有已安装模型。当前不提供下载、移除或有效的加速开关；这些操作必须由主进程模型管理服务接入后开放。
      </p>
      <LocalModelsSection />
    </SettingsContentColumn>
  )
}
