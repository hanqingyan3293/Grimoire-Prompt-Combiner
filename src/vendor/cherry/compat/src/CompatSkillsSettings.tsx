import { useId, type ReactNode } from 'react'
import { SkillLauncherProvider } from '../../source/src/renderer/hooks/useSkillLauncher'
import { SkillDetails } from '../../source/src/renderer/pages/settings/SkillDetails/SkillDetails'
import { SkillsSettings } from '../../source/src/renderer/pages/settings/SkillsSettings'
import { CompatSettingsActionBoundary } from './CompatSettingsActionBoundary'

function SkillSettingsBoundary({ children, detail = false }: { children: ReactNode; detail?: boolean }) {
  const noteId = useId()
  return (
    <div className="flex min-h-0 flex-1 flex-col" data-ui={detail ? 'compat.settings.skill-detail' : 'compat.settings.skills'}>
      <p id={noteId} role="note" aria-label="技能设置能力边界" className="mx-4 mt-4 rounded border border-amber-500/30 p-3 text-sm">
        源 {detail ? 'SkillDetails' : 'SkillsSettings'} 已挂载。技能目录、系统发现与详情读取使用真实请求；尚未接入时保留源错误态，不把失败当作空目录。
        安装/导入、启用、试用/创建技能会话、卸载、远程更新及目录编辑服务尚未接入。源页面没有只读动作接口，页内原生表单和按钮操作已统一禁用，包括搜索、范围标签、重试和返回；设置侧栏导航不受影响，安全锚点链接不被禁用。不提供虚构技能、磁盘路径或执行实现，也不宣称技能功能已完整接入。
      </p>
      <CompatSettingsActionBoundary label={detail ? '源技能详情' : '源技能设置'} describedBy={noteId}>
        {children}
      </CompatSettingsActionBoundary>
    </div>
  )
}

/** Reuse the genuine launcher context unchanged. It requires no TabsProvider and
 * performs no mutation on mount; its launch/enable entry points remain disabled. */
export function CompatSkillsSettings() {
  return (
    <SkillLauncherProvider>
      <SkillSettingsBoundary>
        <SkillsSettings />
      </SkillSettingsBoundary>
    </SkillLauncherProvider>
  )
}

/** The caller supplies the already-admitted source route parameter. No hash
 * parsing, folder-path inference or placeholder skill identity is done here. */
export function CompatSkillDetails({ skillId }: { skillId: string }) {
  return (
    <SkillLauncherProvider>
      <SkillSettingsBoundary detail>
        <SkillDetails skillId={skillId} />
      </SkillSettingsBoundary>
    </SkillLauncherProvider>
  )
}
