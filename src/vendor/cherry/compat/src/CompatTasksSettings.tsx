import { useId } from 'react'
import TasksSettings from '../../source/src/renderer/pages/settings/TasksSettings'
import { CompatSettingsActionBoundary } from './CompatSettingsActionBoundary'

/** Source index/detail share this one page. The caller's router supplies taskId
 * through source useParams({ strict: false }); TasksSettings has NO taskId prop.
 * The wrapper neither parses a URL nor invents an unused parameter prop. */
export function CompatTasksSettings() {
  const noteId = useId()
  return (
    <div className="flex min-h-0 flex-1 flex-col" data-ui="compat.settings.scheduled-tasks">
      <p id={noteId} role="note" aria-label="定时任务设置能力边界" className="mx-4 mt-4 rounded border border-amber-500/30 p-3 text-sm">
        源 TasksSettings 已挂载。源任务列表、详情与日志查询尚未接入；请求失败后源页面仍可能显示“没有任务”或“任务不存在”，并提示加载失败，这不代表查询成功或确实没有任务。关联的智能体读取失败也不证明没有智能体。
        创建、编辑、运行、暂停/恢复与删除服务尚未接入。源页面没有只读动作接口，页内原生表单和按钮操作已统一禁用，包括搜索、筛选、历史标签和返回；设置侧栏导航不受影响，安全锚点链接不被禁用。此页不启动调度器、不创建执行会话，也不宣称支持 Cherry 技能或定时任务执行。
      </p>
      <CompatSettingsActionBoundary label="源定时任务设置" describedBy={noteId}>
        <TasksSettings />
      </CompatSettingsActionBoundary>
    </div>
  )
}
